// server/src/routes/adminFinance.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import ExcelJS from 'exceljs';

const router = Router();

function parseDate(value) {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function toYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function diffDays(a, b) {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function addDays(d, days) {
  const nd = new Date(d.getTime());
  nd.setDate(nd.getDate() + days);
  return nd;
}

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthRange(from, to) {
  const out = [];
  const cur = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  while (cur <= end) {
    out.push(monthKey(cur));
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

function todayYMD() {
  return toYMD(new Date());
}

function normalizeCurrency(code = '') {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return 'PYG';
  if (c === 'GS') return 'PYG';
  return c;
}

function num(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function addCurrency(target, currency, amount) {
  const key = normalizeCurrency(currency);
  target[key] = Number(((target[key] || 0) + num(amount)).toFixed(2));
}

function round2(value) {
  return Number(num(value).toFixed(2));
}

function parseJson(value, fallback = null) {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value || fallback;
  } catch {
    return fallback;
  }
}

async function tableExists(tableName) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS cnt
       FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  return Number(row?.cnt || 0) > 0;
}

async function ensureCashFlowTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS finance_cash_flow_adjustments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      source_type VARCHAR(64) NOT NULL,
      source_id INT NOT NULL,
      direction VARCHAR(16) NOT NULL,
      expected_date DATE NULL,
      expected_amount DECIMAL(18,2) NULL,
      currency_code VARCHAR(8) NULL,
      note VARCHAR(255) NULL,
      updated_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_finance_cash_flow_source (source_type, source_id, direction),
      INDEX idx_finance_cash_flow_date (expected_date),
      INDEX idx_finance_cash_flow_direction (direction)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

ensureCashFlowTables().catch((err) =>
  console.error('[admin-finance] init cash flow tables', err?.message || err)
);

async function getParamValue(key) {
  try {
    const [[row]] = await pool.query(
      `SELECT value FROM params WHERE \`key\` = ? AND (active IS NULL OR active <> 0) ORDER BY ord LIMIT 1`,
      [key]
    );
    if (row?.value != null) return row.value;
  } catch {}
  try {
    const [[row]] = await pool.query(
      `SELECT \`value\` FROM param_values WHERE \`key\` = ? AND (active IS NULL OR active <> 0) ORDER BY ord LIMIT 1`,
      [key]
    );
    if (row?.value != null) return row.value;
  } catch {}
  return null;
}

async function upsertParamValue(key, value) {
  try {
    const [[row]] = await pool.query(
      `SELECT id FROM param_values WHERE \`key\` = ? ORDER BY id LIMIT 1`,
      [key]
    );
    if (row?.id) {
      await pool.query(`UPDATE param_values SET value = ?, active = 1 WHERE id = ?`, [value, row.id]);
      return;
    }
    await pool.query(
      `INSERT INTO param_values (\`key\`, value, ord, active) VALUES (?, ?, 0, 1)`,
      [key, value]
    );
  } catch (err) {
    const [[row]] = await pool.query(
      `SELECT id FROM params WHERE \`key\` = ? ORDER BY id LIMIT 1`,
      [key]
    );
    if (row?.id) await pool.query(`UPDATE params SET value = ?, active = 1 WHERE id = ?`, [value, row.id]);
    else await pool.query(`INSERT INTO params (\`key\`, value, ord, active) VALUES (?, ?, 0, 1)`, [key, value]);
  }
}

async function getCashFlowSettings() {
  const enabledRaw = await getParamValue('finance_cash_flow_rule_enabled');
  const ruleRaw = await getParamValue('finance_cash_flow_rule_json');
  const defaultRule = [
    { percentage: 60, days: 0 },
    { percentage: 30, days: 60 },
    { percentage: 10, days: 67 },
  ];
  const parsedRule = parseJson(ruleRaw, defaultRule);
  const rule = Array.isArray(parsedRule) && parsedRule.length
    ? parsedRule
        .map((item) => ({
          percentage: num(item?.percentage),
          days: Number(item?.days || 0) || 0,
        }))
        .filter((item) => item.percentage > 0)
    : defaultRule;
  return {
    rule_enabled: enabledRaw == null ? true : !['0', 'false', 'no'].includes(String(enabledRaw).toLowerCase()),
    collection_rule: rule,
  };
}

async function getMonthlyGoals() {
  const raw = await getParamValue('finance_cash_flow_monthly_goals_json');
  const parsed = parseJson(raw, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function monthlyGoalKey({ year, businessUnitId = '', currency }) {
  return [year || '', businessUnitId || 'all', normalizeCurrency(currency)].join('|');
}

function getGoalForMonth(goals, { month, businessUnitId, currency }) {
  const year = String(month || '').slice(0, 4);
  const monthNum = Number(String(month || '').slice(5, 7));
  const specific = goals[monthlyGoalKey({ year, businessUnitId, currency })];
  const global = goals[monthlyGoalKey({ year, businessUnitId: '', currency })];
  const source = specific || global || {};
  const value = Array.isArray(source)
    ? source.find((row) => Number(row?.month) === monthNum)?.amount
    : source[String(monthNum).padStart(2, '0')] ?? source[String(monthNum)];
  return round2(value || 0);
}

function deepFindNumber(obj, keys = []) {
  if (!obj || typeof obj !== 'object') return null;
  const wanted = new Set(keys);
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    for (const [key, value] of Object.entries(cur)) {
      if (wanted.has(key) && Number.isFinite(Number(value))) return Number(value);
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return null;
}

function convertCurrencyAmount(amount, fromCurrency, toCurrency, exchangeRate) {
  const value = num(amount);
  const from = normalizeCurrency(fromCurrency);
  const to = normalizeCurrency(toCurrency);
  const rate = num(exchangeRate) || 1;
  if (from === to) return value;
  if (from === 'USD' && to === 'PYG') return value * rate;
  if (from === 'PYG' && to === 'USD') return rate > 0 ? value / rate : value;
  return value;
}

function compactText(values = [], fallback = '-') {
  const out = values
    .flat()
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return out.length ? Array.from(new Set(out)).slice(0, 3).join(', ') : fallback;
}

function extractOperationBudget(row) {
  const invoiceCurrency = normalizeCurrency(row.currency_code);
  const exchangeRate = num(row.exchange_rate) || 1;
  const pct = Math.max(0, num(row.percentage || 100));
  const invoiceTotal = num(row.total_amount);
  const fallbackSale = pct > 0 ? invoiceTotal * (100 / pct) : invoiceTotal;
  let purchase = null;
  let sale = null;
  let profit = null;
  let sourceCurrency = invoiceCurrency;
  let brand = '';
  let description = row.invoice_items_description || '';
  let sourceStatus = 'ok';

  const costSheet = parseJson(row.cost_sheet_data, null);
  const inputs = parseJson(row.quote_inputs_json || row.service_inputs_json, null);
  const computed = parseJson(row.quote_computed_json || row.service_computed_json, null);

  if (costSheet) {
    const header = costSheet.header || {};
    sourceCurrency = normalizeCurrency(header.operationCurrency || header.currency || invoiceCurrency);
    purchase = deepFindNumber(costSheet.totals || costSheet, ['totalCostos', 'total_costos', 'total_buy_usd', 'totalCompra', 'total_cost']);
    sale = deepFindNumber(costSheet.totals || costSheet, ['totalVentas', 'total_ventas', 'total_sales_usd', 'total_sell_usd', 'totalVenta']);
    profit = deepFindNumber(costSheet.totals || costSheet, ['profitGeneral', 'profit_general', 'profit_total_usd', 'profit']);
    const saleRows = Array.isArray(costSheet.ventaRows) ? costSheet.ventaRows : [];
    description = compactText([description, saleRows.map((it) => it?.concepto)], description || '-');
  } else if (computed || inputs) {
    sourceCurrency = normalizeCurrency(inputs?.operation_currency || computed?.meta?.operation_currency || invoiceCurrency);
    purchase =
      deepFindNumber(computed?.operacion?.totals, ['total_buy_usd', 'total_buy', 'totalCostos']) ??
      deepFindNumber(computed, ['total_buy_usd', 'total_buy']);
    sale =
      deepFindNumber(computed?.operacion?.totals, ['total_sell_usd', 'total_sell', 'total_sales_usd']) ??
      deepFindNumber(computed?.oferta?.totals, ['total_sales_usd', 'total_sell_usd', 'total_sales']) ??
      deepFindNumber(computed, ['total_sales_usd', 'total_sell_usd']);
    profit =
      deepFindNumber(computed?.operacion?.totals, ['profit_total_usd', 'profitGeneral', 'profit_general']) ??
      deepFindNumber(computed, ['profit_total_usd', 'profitGeneral', 'profit']);
    const items = Array.isArray(inputs?.items) ? inputs.items : Array.isArray(computed?.oferta?.items) ? computed.oferta.items : [];
    brand = compactText(items.map((it) => it?.brand || it?.marca), '');
    description = compactText([description, items.map((it) => it?.description || it?.product_name)], description || '-');
  }

  if (sale == null || sale <= 0) {
    sale = fallbackSale;
    sourceStatus = 'sin_revision';
  }
  if (purchase == null) purchase = 0;
  if (profit == null) profit = sale - purchase;

  const budgetSale = round2(convertCurrencyAmount(sale, sourceCurrency, invoiceCurrency, exchangeRate));
  const budgetPurchase = round2(convertCurrencyAmount(purchase, sourceCurrency, invoiceCurrency, exchangeRate));
  const budgetProfit = round2(convertCurrencyAmount(profit, sourceCurrency, invoiceCurrency, exchangeRate));
  const profitRatio = budgetSale ? budgetProfit / budgetSale : 0;
  const purchaseRatio = budgetSale ? budgetPurchase / budgetSale : 0;

  return {
    budget_sale: budgetSale,
    budget_purchase: budgetPurchase,
    budget_profit: budgetProfit,
    profit_ratio: profitRatio,
    purchase_ratio: purchaseRatio,
    brand: brand || row.primary_supplier_name || '-',
    description: description || '-',
    source_status: sourceStatus,
  };
}

function expectedDateForInvoice(row, settings) {
  const issue = parseDate(row.issue_date) || new Date();
  const condition = String(row.payment_condition || '').toLowerCase();
  if (condition === 'contado') return toYMD(issue);
  const pct = num(row.percentage || 100);
  if (settings.rule_enabled) {
    const match = (settings.collection_rule || []).find((rule) => Math.abs(num(rule.percentage) - pct) < 0.01);
    if (match) return toYMD(addDays(issue, match.days));
  }
  if (row.due_date) return toYMD(parseDate(row.due_date));
  const termsMatch = String(row.payment_terms || '').match(/(\d+)/);
  if (termsMatch) return toYMD(addDays(issue, Number(termsMatch[1]) || 0));
  return toYMD(addDays(issue, 30));
}

function classifyScheduleDate(dateValue, fromStr, toStr) {
  if (!dateValue) return 'sin_fecha';
  const date = String(dateValue).slice(0, 10);
  if (date < todayYMD()) return 'vencido';
  if (date >= fromStr && date <= toStr) return 'periodo';
  if (date > toStr) return 'futuro';
  return 'fuera_periodo';
}

function sourceKey(sourceType, sourceId, direction) {
  return `${sourceType}:${sourceId}:${direction}`;
}

function applyAdjustment(doc, adjustments) {
  const adj = adjustments.get(sourceKey(doc.source_type, doc.source_id, doc.direction));
  if (!adj) return doc;
  return {
    ...doc,
    expected_date: adj.expected_date ? String(adj.expected_date).slice(0, 10) : doc.expected_date,
    amount: adj.expected_amount != null ? num(adj.expected_amount) : doc.amount,
    currency_code: adj.currency_code || doc.currency_code,
    adjustment_note: adj.note || '',
    adjusted: true,
  };
}

function pushSummary(summary, doc) {
  const currency = normalizeCurrency(doc.currency_code);
  if (!summary[currency]) {
    summary[currency] = {
      collected_real: 0,
      receivable_projected: 0,
      paid_real: 0,
      payable_projected: 0,
      net_expected: 0,
    };
  }
  if (doc.direction === 'in') {
    if (doc.kind === 'actual') summary[currency].collected_real += num(doc.amount);
    else summary[currency].receivable_projected += num(doc.amount);
  } else if (doc.direction === 'out') {
    if (doc.kind === 'actual') summary[currency].paid_real += num(doc.amount);
    else summary[currency].payable_projected += num(doc.amount);
  }
  summary[currency].net_expected = Number(
    (
      summary[currency].collected_real +
      summary[currency].receivable_projected -
      summary[currency].paid_real -
      summary[currency].payable_projected
    ).toFixed(2)
  );
}

function pushMonthly(monthly, doc) {
  const date = doc.expected_date || doc.actual_date;
  if (!date) return;
  const ym = String(date).slice(0, 7);
  const currency = normalizeCurrency(doc.currency_code);
  if (!monthly[ym]) monthly[ym] = { month: ym, by_currency: {} };
  if (!monthly[ym].by_currency[currency]) {
    monthly[ym].by_currency[currency] = { incoming: 0, outgoing: 0, net: 0 };
  }
  const bucket = monthly[ym].by_currency[currency];
  if (doc.direction === 'in') bucket.incoming += num(doc.amount);
  else bucket.outgoing += num(doc.amount);
  bucket.net = Number((bucket.incoming - bucket.outgoing).toFixed(2));
}

function pushCalendar(calendar, doc) {
  const date = doc.expected_date || doc.actual_date;
  if (!date) return;
  const day = String(date).slice(0, 10);
  const currency = normalizeCurrency(doc.currency_code);
  if (!calendar[day]) calendar[day] = { date: day, by_currency: {}, documents: [] };
  if (!calendar[day].by_currency[currency]) {
    calendar[day].by_currency[currency] = { incoming: 0, outgoing: 0, net: 0 };
  }
  const bucket = calendar[day].by_currency[currency];
  if (doc.direction === 'in') bucket.incoming += num(doc.amount);
  else bucket.outgoing += num(doc.amount);
  bucket.net = Number((bucket.incoming - bucket.outgoing).toFixed(2));
  calendar[day].documents.push({
    source_type: doc.source_type,
    source_id: doc.source_id,
    direction: doc.direction,
    kind: doc.kind,
    label: doc.label,
    party_name: doc.party_name || '',
    operation_reference: doc.operation_reference || '',
    amount: doc.amount,
    currency_code: currency,
    status: doc.status,
    schedule_status: doc.schedule_status || '',
  });
}

function salesKey({ month, operationReference, currency }) {
  return [month, operationReference || 'Sin operacion', normalizeCurrency(currency)].join('|');
}

function ensureSalesRow(map, seed) {
  const key = salesKey(seed);
  if (!map.has(key)) {
    map.set(key, {
      key,
      month: seed.month,
      currency_code: normalizeCurrency(seed.currency),
      business_unit_id: seed.business_unit_id || null,
      business_unit_key: seed.business_unit_key || '',
      operation_id: seed.operation_id || null,
      operation_type: seed.operation_type || '',
      operation_reference: seed.operationReference || 'Sin operacion',
      client_name: seed.client_name || '',
      origin: seed.origin || '-',
      destination: seed.destination || '-',
      provider_brand: seed.provider_brand || '-',
      description: seed.description || '-',
      budget_purchase: 0,
      budget_sale: 0,
      budget_profit: 0,
      real_profit: null,
      collected: 0,
      receivable: 0,
      paid: 0,
      payable: 0,
      purchase_real: 0,
      warnings: [],
      documents: [],
    });
  }
  const row = map.get(key);
  for (const field of ['client_name', 'origin', 'destination', 'provider_brand', 'description']) {
    if ((!row[field] || row[field] === '-') && seed[field]) row[field] = seed[field];
  }
  if (!row.operation_id && seed.operation_id) row.operation_id = seed.operation_id;
  if (!row.business_unit_id && seed.business_unit_id) row.business_unit_id = seed.business_unit_id;
  if (!row.business_unit_key && seed.business_unit_key) row.business_unit_key = seed.business_unit_key;
  if (!row.operation_type && seed.operation_type) row.operation_type = seed.operation_type;
  return row;
}

function pushSalesInvoice(map, row, amount, kind, expectedDate, budget) {
  const month = String(expectedDate || row.issue_date || '').slice(0, 7);
  if (!month) return;
  const saleAmount = round2(amount);
  const purchaseAmount = round2(saleAmount * (budget.purchase_ratio || 0));
  const profitAmount = round2(saleAmount * (budget.profit_ratio || 0));
  const target = ensureSalesRow(map, {
    month,
    currency: row.currency_code,
    business_unit_id: row.business_unit_id,
    business_unit_key: row.business_unit_key,
    operation_id: row.operation_id,
    operation_type: row.operation_type,
    operationReference: row.operation_reference,
    client_name: row.organization_name,
    origin: row.origin || '-',
    destination: row.destination || '-',
    provider_brand: budget.brand || row.primary_supplier_name || '-',
    description: budget.description || row.invoice_items_description || '-',
  });
  target.budget_sale += saleAmount;
  target.budget_purchase += purchaseAmount;
  target.budget_profit += profitAmount;
  if (kind === 'actual') target.collected += saleAmount;
  else target.receivable += saleAmount;
  if (budget.source_status !== 'ok') target.warnings.push('Sin revision/costo presupuestado completo');
  target.documents.push({
    source_type: kind === 'actual' ? 'receipt' : 'invoice',
    source_id: row.source_id || row.id,
    label: row.receipt_number || row.invoice_number || `Factura #${row.id}`,
    kind,
    direction: 'in',
    amount: saleAmount,
    currency_code: normalizeCurrency(row.currency_code),
    date: expectedDate,
  });
}

function pushSalesPurchase(map, doc) {
  const month = String(doc.expected_date || doc.actual_date || '').slice(0, 7);
  const operationReference = doc.operation_reference || '';
  if (!month || !operationReference) return;
  const target = ensureSalesRow(map, {
    month,
    currency: doc.currency_code,
    operationReference,
    client_name: doc.party_name || '',
    provider_brand: doc.party_name || '-',
  });
  const amount = round2(doc.amount);
  target.purchase_real += amount;
  if (doc.kind === 'actual') target.paid += amount;
  else target.payable += amount;
  target.documents.push({
    source_type: doc.source_type,
    source_id: doc.source_id,
    label: doc.label,
    kind: doc.kind,
    direction: 'out',
    amount,
    currency_code: normalizeCurrency(doc.currency_code),
    date: doc.expected_date || doc.actual_date || null,
  });
}

function buildSalesAnalytics({ invoiceRows = [], receiptRows = [], outgoingDocs = [], goals = {}, businessUnitId = null }) {
  const map = new Map();
  for (const row of invoiceRows || []) {
    if (num(row.balance) <= 0) continue;
    const budget = extractOperationBudget(row);
    pushSalesInvoice(map, row, row.balance, 'projected', row.expected_date, budget);
  }
  for (const row of receiptRows || []) {
    const budget = extractOperationBudget(row);
    pushSalesInvoice(map, row, row.amount, 'actual', row.actual_date || row.date, budget);
  }
  for (const doc of outgoingDocs || []) pushSalesPurchase(map, doc);

  const operations = Array.from(map.values()).map((row) => {
    const realProfit = row.purchase_real > 0 ? round2(row.collected + row.receivable - row.purchase_real) : null;
    const budgetProfit = round2(row.budget_profit);
    const meta = getGoalForMonth(goals, {
      month: row.month,
      businessUnitId: businessUnitId || row.business_unit_id || '',
      currency: row.currency_code,
    });
    return {
      ...row,
      budget_purchase: round2(row.budget_purchase),
      budget_sale: round2(row.budget_sale),
      budget_profit: budgetProfit,
      real_profit: realProfit,
      collected: round2(row.collected),
      receivable: round2(row.receivable),
      paid: round2(row.paid),
      payable: round2(row.payable),
      purchase_real: round2(row.purchase_real),
      meta,
      meta_difference: round2(budgetProfit - meta),
      warnings: Array.from(new Set(row.warnings)),
    };
  });

  const monthMap = new Map();
  for (const row of operations) {
    const key = `${row.month}|${row.currency_code}`;
    if (!monthMap.has(key)) {
      monthMap.set(key, {
        month: row.month,
        currency_code: row.currency_code,
        budget_purchase: 0,
        budget_sale: 0,
        budget_profit: 0,
        real_profit: 0,
        collected: 0,
        receivable: 0,
        paid: 0,
        payable: 0,
        meta: getGoalForMonth(goals, { month: row.month, businessUnitId, currency: row.currency_code }),
        operations_count: 0,
        warnings_count: 0,
      });
    }
    const month = monthMap.get(key);
    month.budget_purchase += row.budget_purchase;
    month.budget_sale += row.budget_sale;
    month.budget_profit += row.budget_profit;
    if (row.real_profit != null) month.real_profit += row.real_profit;
    month.collected += row.collected;
    month.receivable += row.receivable;
    month.paid += row.paid;
    month.payable += row.payable;
    month.operations_count += 1;
    month.warnings_count += row.warnings.length ? 1 : 0;
  }

  const months = Array.from(monthMap.values()).map((row) => ({
    ...row,
    budget_purchase: round2(row.budget_purchase),
    budget_sale: round2(row.budget_sale),
    budget_profit: round2(row.budget_profit),
    real_profit: round2(row.real_profit),
    collected: round2(row.collected),
    receivable: round2(row.receivable),
    paid: round2(row.paid),
    payable: round2(row.payable),
    meta_difference: round2(row.budget_profit - row.meta),
  }));

  return {
    sales_months: months.sort((a, b) => a.month.localeCompare(b.month) || a.currency_code.localeCompare(b.currency_code)),
    sales_operations: operations.sort((a, b) => a.month.localeCompare(b.month) || a.operation_reference.localeCompare(b.operation_reference)),
  };
}

function buildCashFlowDiagnostics({ visibleDocs = [], salesOperations = [] }) {
  const issues = [];
  const pushIssue = (issue) => {
    const severity = issue.severity || 'media';
    issues.push({
      id: `${issue.category || 'general'}-${issue.source_type || 'row'}-${issue.source_id || issue.operation_reference || issues.length}-${issues.length}`,
      severity,
      category: issue.category || 'general',
      title: issue.title || 'Revisar dato',
      detail: issue.detail || '',
      action: issue.action || '',
      source_type: issue.source_type || '',
      source_id: issue.source_id || null,
      operation_reference: issue.operation_reference || '',
      party_name: issue.party_name || '',
      document_number: issue.document_number || issue.label || '',
      currency_code: normalizeCurrency(issue.currency_code || 'PYG'),
      amount: round2(issue.amount || 0),
      expected_date: issue.expected_date || null,
    });
  };

  for (const doc of visibleDocs || []) {
    if (doc.kind === 'projected' && !doc.expected_date) {
      pushIssue({
        severity: 'alta',
        category: 'fechas',
        title: doc.direction === 'in' ? 'Cobro proyectado sin fecha' : 'Pago proyectado sin fecha',
        detail: 'El documento queda fuera del calendario hasta cargar vencimiento o ajuste manual.',
        action: 'Cargar vencimiento o ajustar fecha en Gerencia.',
        ...doc,
      });
    }
    if (doc.kind === 'projected' && doc.schedule_status === 'overdue') {
      pushIssue({
        severity: 'alta',
        category: 'vencidos',
        title: doc.direction === 'in' ? 'Cobro vencido pendiente' : 'Pago vencido pendiente',
        detail: 'El documento ya pasó su fecha esperada y todavía tiene saldo.',
        action: doc.direction === 'in' ? 'Registrar cobro o reprogramar fecha.' : 'Registrar pago o reprogramar fecha.',
        ...doc,
      });
    }
    if (doc.source_type === 'invoice' && !doc.operation_reference) {
      pushIssue({
        severity: 'media',
        category: 'vinculos',
        title: 'Factura de venta sin operación vinculada',
        detail: 'La factura entra en caja, pero no puede alimentar bien el profit por operación.',
        action: 'Vincular la factura a una operación o revisar su origen.',
        ...doc,
      });
    }
    if (doc.source_type === 'operation_expense_invoice' && !doc.operation_reference) {
      pushIssue({
        severity: 'media',
        category: 'vinculos',
        title: 'Compra operativa sin operación vinculada',
        detail: 'El egreso aparece, pero no impacta correctamente el profit de una operación.',
        action: 'Vincular la factura de compra a la operación correcta.',
        ...doc,
      });
    }
    if (!doc.party_name) {
      pushIssue({
        severity: 'baja',
        category: 'terceros',
        title: doc.direction === 'in' ? 'Documento sin cliente visible' : 'Documento sin proveedor visible',
        detail: 'El movimiento existe, pero el reporte gerencial pierde trazabilidad.',
        action: 'Completar cliente/proveedor en el documento.',
        ...doc,
      });
    }
    if (num(doc.amount) <= 0) {
      pushIssue({
        severity: 'media',
        category: 'montos',
        title: 'Documento con monto cero o inválido',
        detail: 'Un monto en cero distorsiona reportes y proyecciones.',
        action: 'Revisar total, saldo o ajuste manual.',
        ...doc,
      });
    }
    if (doc.source_type === 'invoice' && doc.kind === 'projected' && num(doc.percentage) <= 0) {
      pushIssue({
        severity: 'media',
        category: 'facturacion',
        title: 'Factura sin porcentaje de cobro',
        detail: 'Para 60/30/10 conviene guardar el porcentaje para distribuir venta y profit correctamente.',
        action: 'Revisar la factura y su porcentaje de facturación.',
        ...doc,
      });
    }
  }

  for (const row of salesOperations || []) {
    const opInfo = {
      source_type: 'operation',
      source_id: row.operation_id || null,
      operation_reference: row.operation_reference,
      party_name: row.client_name,
      currency_code: row.currency_code,
      amount: row.budget_sale,
      expected_date: row.month ? `${row.month}-01` : null,
    };
    if (row.real_profit == null && (num(row.budget_sale) > 0 || num(row.collected) > 0 || num(row.receivable) > 0)) {
      pushIssue({
        ...opInfo,
        severity: 'media',
        category: 'costos_reales',
        title: 'Operación sin costo real detectado',
        detail: 'El profit real queda pendiente porque no hay compras reales/pagos asociados detectados para la operación.',
        action: 'Cargar o vincular facturas de compra/costos finales.',
      });
    }
    if (num(row.budget_sale) > 0 && num(row.budget_purchase) <= 0) {
      pushIssue({
        ...opInfo,
        severity: 'alta',
        category: 'presupuesto',
        title: 'Venta sin compra presupuestada',
        detail: 'La operación tiene venta, pero no se detectó compra presupuestada.',
        action: 'Revisar revisión/planilla oficial usada por la factura.',
      });
    }
    if (num(row.budget_sale) > 0 && row.warnings?.length) {
      for (const warning of row.warnings) {
        pushIssue({
          ...opInfo,
          severity: 'media',
          category: 'revision',
          title: warning,
          detail: 'Gerencia no pudo leer completamente la fuente presupuestaria de esta operación.',
          action: 'Verificar revisión facturada/seleccionada y costos guardados.',
        });
      }
    }
  }

  const summary = issues.reduce((acc, issue) => {
    acc.total += 1;
    acc.by_severity[issue.severity] = (acc.by_severity[issue.severity] || 0) + 1;
    acc.by_category[issue.category] = (acc.by_category[issue.category] || 0) + 1;
    return acc;
  }, { total: 0, by_severity: {}, by_category: {} });

  const severityOrder = { alta: 0, media: 1, baja: 2 };
  issues.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9) || String(a.category).localeCompare(String(b.category)));
  return { summary, issues: issues.slice(0, 250) };
}
function normalizeMoneyBuckets(obj) {
  for (const value of Object.values(obj || {})) {
    if (value?.by_currency) {
      for (const b of Object.values(value.by_currency)) {
        b.incoming = Number(num(b.incoming).toFixed(2));
        b.outgoing = Number(num(b.outgoing).toFixed(2));
        b.net = Number(num(b.net).toFixed(2));
      }
    } else if (value) {
      for (const k of Object.keys(value)) value[k] = Number(num(value[k]).toFixed(2));
    }
  }
}

async function buildCashFlowData(query = {}) {
  await ensureCashFlowTables();
  const settings = await getCashFlowSettings();
  const monthlyGoals = await getMonthlyGoals();
  const now = new Date();
  const from = parseDate(query.from) || startOfMonth(now);
  const to = parseDate(query.to) || addDays(new Date(now.getFullYear(), now.getMonth() + 1, 0), 0);
  const fromStr = toYMD(from);
  const toStr = toYMD(to);
  const businessUnitId = query.business_unit_id ? Number(query.business_unit_id) : null;
  const currencyFilter = query.currency_code ? normalizeCurrency(query.currency_code) : '';

  const [adjustmentRows] = await pool.query(`SELECT * FROM finance_cash_flow_adjustments`);
  const adjustments = new Map((adjustmentRows || []).map((row) => [
    sourceKey(row.source_type, row.source_id, row.direction),
    row,
  ]));

  const docs = [];
  const buFilter = businessUnitId ? 'AND COALESCE(d.business_unit_id, bu_service.id) = ?' : '';

  const [receiptRows] = await pool.query(
    `
    SELECT r.id AS source_id, r.receipt_number, COALESCE(r.issue_date, DATE(r.created_at)) AS date,
           i.id, i.invoice_number, i.issue_date, i.due_date, i.payment_terms, i.payment_condition,
           i.percentage, i.exchange_rate,
           COALESCE(r.currency_code, i.currency_code, 'PYG') AS currency_code,
           r.net_amount AS amount,
           COALESCE(NULLIF(i.net_total_amount,0), i.total_amount, 0) AS total_amount,
           o.name AS organization_name,
           COALESCE(d.reference, sc.reference) AS operation_reference,
           COALESCE(d.id, sc.id) AS operation_id,
           CASE WHEN i.service_case_id IS NOT NULL THEN 'service' ELSE 'deal' END AS operation_type,
           COALESCE(d.business_unit_id, bu_service.id) AS business_unit_id,
           COALESCE(bu.key_slug, bu_service.key_slug) AS business_unit_key,
           COALESCE(cf_origin.value, scf_origin.value, '') AS origin,
           COALESCE(cf_dest.value, scf_dest.value, '') AS destination,
           csv.data AS cost_sheet_data,
           COALESCE(qr.inputs_json, q.inputs_json) AS quote_inputs_json,
           COALESCE(qr.computed_json, q.computed_json) AS quote_computed_json,
           sq.inputs_json AS service_inputs_json,
           sq.computed_json AS service_computed_json,
           inv_items.description AS invoice_items_description,
           op_sup.primary_supplier_name
      FROM receipts r
      JOIN invoices i ON i.id = r.invoice_id
      LEFT JOIN organizations o ON o.id = i.organization_id
      LEFT JOIN deals d ON d.id = i.deal_id
      LEFT JOIN service_cases sc ON sc.id = i.service_case_id
      LEFT JOIN business_units bu ON bu.id = d.business_unit_id
      LEFT JOIN business_units bu_service ON bu_service.key_slug = 'atm-industrial'
      LEFT JOIN deal_custom_fields cf_origin ON cf_origin.deal_id = d.id AND cf_origin.\`key\` = 'origen_pto'
      LEFT JOIN deal_custom_fields cf_dest ON cf_dest.deal_id = d.id AND cf_dest.\`key\` = 'destino_pto'
      LEFT JOIN service_case_custom_fields scf_origin ON scf_origin.service_case_id = sc.id AND scf_origin.\`key\` IN ('origen_pto','origen','origin')
      LEFT JOIN service_case_custom_fields scf_dest ON scf_dest.service_case_id = sc.id AND scf_dest.\`key\` IN ('destino_pto','destino','destination')
      LEFT JOIN deal_cost_sheet_versions csv ON csv.deal_id = i.deal_id AND csv.version_number = i.cost_sheet_version_number
      LEFT JOIN quotes q ON q.deal_id = i.deal_id
      LEFT JOIN quote_revisions qr ON qr.id = i.quote_revision_id AND qr.quote_id = q.id
      LEFT JOIN service_quotes sq ON sq.service_case_id = i.service_case_id
      LEFT JOIN (
        SELECT invoice_id, GROUP_CONCAT(description ORDER BY item_order, id SEPARATOR ', ') AS description
          FROM invoice_items
         GROUP BY invoice_id
      ) inv_items ON inv_items.invoice_id = i.id
      LEFT JOIN (
        SELECT operation_id, operation_type, MAX(supplier_name) AS primary_supplier_name
          FROM operation_expense_invoices
         GROUP BY operation_id, operation_type
      ) op_sup ON op_sup.operation_id = COALESCE(i.deal_id, i.service_case_id)
              AND op_sup.operation_type = CASE WHEN i.service_case_id IS NOT NULL THEN 'service' ELSE 'deal' END
     WHERE r.status <> 'anulado'
       AND COALESCE(r.issue_date, DATE(r.created_at)) BETWEEN ? AND ?
       ${buFilter}
    `,
    businessUnitId ? [fromStr, toStr, businessUnitId] : [fromStr, toStr]
  );
  for (const row of receiptRows || []) {
    docs.push({
      source_type: 'receipt',
      source_id: row.source_id,
      direction: 'in',
      kind: 'actual',
      expected_date: String(row.date).slice(0, 10),
      actual_date: String(row.date).slice(0, 10),
      label: row.receipt_number || `Recibo #${row.id}`,
      party_name: row.organization_name || '',
      operation_reference: row.operation_reference || '',
      document_number: row.invoice_number || row.receipt_number || '',
      amount: num(row.amount),
      paid_amount: num(row.amount),
      balance: 0,
      currency_code: normalizeCurrency(row.currency_code),
      status: 'cobrado',
    });
  }

  const [invoiceRows] = await pool.query(
    `
    SELECT i.id, i.invoice_number, i.issue_date, i.due_date, i.payment_terms, i.payment_condition,
           i.percentage, i.exchange_rate, COALESCE(i.currency_code, 'PYG') AS currency_code,
           COALESCE(NULLIF(i.net_total_amount,0), i.total_amount, 0) AS total_amount,
           COALESCE(rc.paid_amount, i.paid_amount, 0) AS paid_amount,
           GREATEST(0, COALESCE(NULLIF(i.net_total_amount,0), i.total_amount, 0) - COALESCE(rc.paid_amount, i.paid_amount, 0)) AS balance,
           o.name AS organization_name, COALESCE(d.reference, sc.reference) AS operation_reference,
           COALESCE(d.id, sc.id) AS operation_id,
           CASE WHEN i.service_case_id IS NOT NULL THEN 'service' ELSE 'deal' END AS operation_type,
           COALESCE(d.business_unit_id, bu_service.id) AS business_unit_id,
           COALESCE(bu.key_slug, bu_service.key_slug) AS business_unit_key,
           COALESCE(cf_origin.value, scf_origin.value, '') AS origin,
           COALESCE(cf_dest.value, scf_dest.value, '') AS destination,
           csv.data AS cost_sheet_data,
           COALESCE(qr.inputs_json, q.inputs_json) AS quote_inputs_json,
           COALESCE(qr.computed_json, q.computed_json) AS quote_computed_json,
           sq.inputs_json AS service_inputs_json,
           sq.computed_json AS service_computed_json,
           inv_items.description AS invoice_items_description,
           op_sup.primary_supplier_name
      FROM invoices i
      LEFT JOIN organizations o ON o.id = i.organization_id
      LEFT JOIN deals d ON d.id = i.deal_id
      LEFT JOIN service_cases sc ON sc.id = i.service_case_id
      LEFT JOIN business_units bu ON bu.id = d.business_unit_id
      LEFT JOIN business_units bu_service ON bu_service.key_slug = 'atm-industrial'
      LEFT JOIN deal_custom_fields cf_origin ON cf_origin.deal_id = d.id AND cf_origin.\`key\` = 'origen_pto'
      LEFT JOIN deal_custom_fields cf_dest ON cf_dest.deal_id = d.id AND cf_dest.\`key\` = 'destino_pto'
      LEFT JOIN service_case_custom_fields scf_origin ON scf_origin.service_case_id = sc.id AND scf_origin.\`key\` IN ('origen_pto','origen','origin')
      LEFT JOIN service_case_custom_fields scf_dest ON scf_dest.service_case_id = sc.id AND scf_dest.\`key\` IN ('destino_pto','destino','destination')
      LEFT JOIN deal_cost_sheet_versions csv ON csv.deal_id = i.deal_id AND csv.version_number = i.cost_sheet_version_number
      LEFT JOIN quotes q ON q.deal_id = i.deal_id
      LEFT JOIN quote_revisions qr ON qr.id = i.quote_revision_id AND qr.quote_id = q.id
      LEFT JOIN service_quotes sq ON sq.service_case_id = i.service_case_id
      LEFT JOIN (
        SELECT invoice_id, GROUP_CONCAT(description ORDER BY item_order, id SEPARATOR ', ') AS description
          FROM invoice_items
         GROUP BY invoice_id
      ) inv_items ON inv_items.invoice_id = i.id
      LEFT JOIN (
        SELECT operation_id, operation_type, MAX(supplier_name) AS primary_supplier_name
          FROM operation_expense_invoices
         GROUP BY operation_id, operation_type
      ) op_sup ON op_sup.operation_id = COALESCE(i.deal_id, i.service_case_id)
              AND op_sup.operation_type = CASE WHEN i.service_case_id IS NOT NULL THEN 'service' ELSE 'deal' END
      LEFT JOIN (
        SELECT invoice_id, SUM(amount) AS paid_amount
          FROM receipts
         WHERE status <> 'anulado'
         GROUP BY invoice_id
      ) rc ON rc.invoice_id = i.id
     WHERE i.status NOT IN ('anulada','borrador')
       AND GREATEST(0, COALESCE(NULLIF(i.net_total_amount,0), i.total_amount, 0) - COALESCE(rc.paid_amount, i.paid_amount, 0)) > 0.009
       ${buFilter}
    `,
    businessUnitId ? [businessUnitId] : []
  );
  for (const row of invoiceRows || []) {
    let doc = {
      source_type: 'invoice',
      source_id: row.id,
      direction: 'in',
      kind: 'projected',
      expected_date: expectedDateForInvoice(row, settings),
      label: row.invoice_number || `Factura #${row.id}`,
      party_name: row.organization_name || '',
      operation_reference: row.operation_reference || '',
      document_number: row.invoice_number || '',
      amount: num(row.balance),
      paid_amount: num(row.paid_amount),
      balance: num(row.balance),
      total_amount: num(row.total_amount),
      currency_code: normalizeCurrency(row.currency_code),
      percentage: row.percentage,
      payment_condition: row.payment_condition || '',
      status: 'por_cobrar',
    };
    doc = applyAdjustment(doc, adjustments);
    doc.schedule_status = classifyScheduleDate(doc.expected_date, fromStr, toStr);
    row.expected_date = doc.expected_date;
    row.balance = doc.amount;
    row.currency_code = doc.currency_code;
    docs.push(doc);
  }

  const [opPayRows] = await pool.query(
    `
    SELECT p.id, p.payment_date AS date, p.amount, COALESCE(p.currency_code, e.currency_code, 'PYG') AS currency_code,
           e.receipt_number, e.supplier_name, COALESCE(d.reference, sc.reference) AS operation_reference
      FROM operation_expense_payments p
      JOIN operation_expense_invoices e ON e.id = p.invoice_id
      LEFT JOIN deals d ON d.id = e.operation_id AND e.operation_type = 'deal'
      LEFT JOIN service_cases sc ON sc.id = e.operation_id AND e.operation_type IN ('service', 'service_case')
      LEFT JOIN business_units bu_service ON bu_service.key_slug = 'atm-industrial'
     WHERE p.status <> 'anulado'
       AND p.payment_date BETWEEN ? AND ?
       ${buFilter}
    `,
    businessUnitId ? [fromStr, toStr, businessUnitId] : [fromStr, toStr]
  ).catch(() => [[]]);
  for (const row of opPayRows || []) {
    docs.push({
      source_type: 'operation_expense_payment',
      source_id: row.id,
      direction: 'out',
      kind: 'actual',
      expected_date: String(row.date).slice(0, 10),
      actual_date: String(row.date).slice(0, 10),
      label: row.receipt_number || `Pago operativo #${row.id}`,
      party_name: row.supplier_name || '',
      operation_reference: row.operation_reference || '',
      amount: num(row.amount),
      paid_amount: num(row.amount),
      balance: 0,
      currency_code: normalizeCurrency(row.currency_code),
      status: 'pagado',
    });
  }

  const [adminPayRows] = await pool.query(
    `
    SELECT p.id, p.payment_date AS date, p.amount, COALESCE(p.currency_code, e.currency_code, 'PYG') AS currency_code,
           e.receipt_number, COALESCE(e.supplier_name, prov.name) AS supplier_name, e.description
      FROM admin_expense_payments p
      JOIN admin_expenses e ON e.id = p.expense_id
      LEFT JOIN admin_expense_providers prov ON prov.id = e.provider_id
     WHERE p.status <> 'anulado'
       AND p.payment_date BETWEEN ? AND ?
    `,
    [fromStr, toStr]
  ).catch(() => [[]]);
  for (const row of adminPayRows || []) {
    docs.push({
      source_type: 'admin_expense_payment',
      source_id: row.id,
      direction: 'out',
      kind: 'actual',
      expected_date: String(row.date).slice(0, 10),
      actual_date: String(row.date).slice(0, 10),
      label: row.receipt_number || row.description || `Pago gasto #${row.id}`,
      party_name: row.supplier_name || '',
      amount: num(row.amount),
      paid_amount: num(row.amount),
      balance: 0,
      currency_code: normalizeCurrency(row.currency_code),
      status: 'pagado',
    });
  }

  const [opExpenseRows] = await pool.query(
    `
    SELECT e.id, e.invoice_date, e.due_date, e.receipt_number, e.supplier_name,
           COALESCE(e.currency_code, 'PYG') AS currency_code,
           COALESCE(e.amount_total, 0) AS total_amount,
           COALESCE(e.paid_amount, 0) AS paid_amount,
           COALESCE(e.balance, COALESCE(e.amount_total, 0) - COALESCE(e.paid_amount, 0)) AS balance,
           COALESCE(d.reference, sc.reference) AS operation_reference,
           po.order_number, po.status AS payment_order_status
      FROM operation_expense_invoices e
      LEFT JOIN deals d ON d.id = e.operation_id AND e.operation_type = 'deal'
      LEFT JOIN service_cases sc ON sc.id = e.operation_id AND e.operation_type IN ('service', 'service_case')
      LEFT JOIN business_units bu_service ON bu_service.key_slug = 'atm-industrial'
      LEFT JOIN (
        SELECT poi.invoice_id, MAX(po.id) AS order_id
          FROM operation_expense_payment_order_items poi
          JOIN operation_expense_payment_orders po ON po.id = poi.order_id
         GROUP BY poi.invoice_id
      ) pol ON pol.invoice_id = e.id
      LEFT JOIN operation_expense_payment_orders po ON po.id = pol.order_id
     WHERE COALESCE(e.balance, COALESCE(e.amount_total, 0) - COALESCE(e.paid_amount, 0)) > 0.009
       AND LOWER(COALESCE(e.status,'')) <> 'anulada'
       ${buFilter}
    `,
    businessUnitId ? [businessUnitId] : []
  ).catch(() => [[]]);
  for (const row of opExpenseRows || []) {
    let doc = {
      source_type: 'operation_expense_invoice',
      source_id: row.id,
      direction: 'out',
      kind: 'projected',
      expected_date: row.due_date ? String(row.due_date).slice(0, 10) : null,
      label: row.receipt_number || `Compra operativa #${row.id}`,
      party_name: row.supplier_name || '',
      operation_reference: row.operation_reference || '',
      amount: num(row.balance),
      paid_amount: num(row.paid_amount),
      balance: num(row.balance),
      total_amount: num(row.total_amount),
      currency_code: normalizeCurrency(row.currency_code),
      status: row.payment_order_status ? `OP ${row.payment_order_status}` : 'por_pagar',
      payment_order_number: row.order_number || '',
    };
    doc = applyAdjustment(doc, adjustments);
    doc.schedule_status = classifyScheduleDate(doc.expected_date, fromStr, toStr);
    docs.push(doc);
  }

  const [adminExpenseRows] = await pool.query(
    `
    SELECT e.id, e.expense_date, e.invoice_date, e.due_date, e.receipt_number, e.description,
           COALESCE(e.supplier_name, prov.name) AS supplier_name,
           COALESCE(e.currency_code, 'PYG') AS currency_code,
           COALESCE(e.amount, 0) AS total_amount,
           COALESCE(pay.paid_amount, 0) AS paid_amount,
           GREATEST(0, COALESCE(e.amount, 0) - COALESCE(pay.paid_amount, 0)) AS balance
      FROM admin_expenses e
      LEFT JOIN admin_expense_providers prov ON prov.id = e.provider_id
      LEFT JOIN (
        SELECT expense_id, SUM(amount) AS paid_amount
          FROM admin_expense_payments
         WHERE status <> 'anulado'
         GROUP BY expense_id
      ) pay ON pay.expense_id = e.id
     WHERE LOWER(COALESCE(e.status,'')) <> 'anulado'
       AND GREATEST(0, COALESCE(e.amount, 0) - COALESCE(pay.paid_amount, 0)) > 0.009
    `
  ).catch(() => [[]]);
  for (const row of adminExpenseRows || []) {
    let doc = {
      source_type: 'admin_expense',
      source_id: row.id,
      direction: 'out',
      kind: 'projected',
      expected_date: row.due_date ? String(row.due_date).slice(0, 10) : null,
      label: row.receipt_number || row.description || `Gasto #${row.id}`,
      party_name: row.supplier_name || '',
      amount: num(row.balance),
      paid_amount: num(row.paid_amount),
      balance: num(row.balance),
      total_amount: num(row.total_amount),
      currency_code: normalizeCurrency(row.currency_code),
      status: 'por_pagar',
    };
    doc = applyAdjustment(doc, adjustments);
    doc.schedule_status = classifyScheduleDate(doc.expected_date, fromStr, toStr);
    docs.push(doc);
  }

  let filteredDocs = docs.map((doc) => ({ ...doc, currency_code: normalizeCurrency(doc.currency_code) }));
  if (currencyFilter) filteredDocs = filteredDocs.filter((doc) => doc.currency_code === currencyFilter);

  const inRangeOrUnplanned = (doc) => {
    const date = doc.expected_date || doc.actual_date;
    if (!date) return doc.kind === 'projected';
    const ymd = String(date).slice(0, 10);
    return ymd >= fromStr && ymd <= toStr;
  };
  const visibleDocs = filteredDocs.filter(inRangeOrUnplanned);
  const visibleSourceKeys = new Set(
    visibleDocs.map((doc) => sourceKey(doc.source_type, doc.source_id, doc.direction))
  );
  const visibleInvoiceRows = (invoiceRows || []).filter((row) =>
    visibleSourceKeys.has(sourceKey('invoice', row.id, 'in'))
  );
  const visibleReceiptRows = (receiptRows || []).filter((row) =>
    visibleSourceKeys.has(sourceKey('receipt', row.source_id, 'in'))
  );
  const visibleOutgoingDocs = visibleDocs.filter((doc) => doc.direction === 'out' && doc.operation_reference);

  const summary = {};
  const monthly = {};
  const calendar = {};
  for (const doc of visibleDocs) {
    pushSummary(summary, doc);
    pushMonthly(monthly, doc);
    pushCalendar(calendar, doc);
  }
  normalizeMoneyBuckets(summary);
  normalizeMoneyBuckets(monthly);
  normalizeMoneyBuckets(calendar);

  const projected = visibleDocs.filter((doc) => doc.kind === 'projected');
  const salesAnalytics = buildSalesAnalytics({
    invoiceRows: visibleInvoiceRows,
    receiptRows: visibleReceiptRows,
    outgoingDocs: visibleOutgoingDocs,
    goals: monthlyGoals,
    businessUnitId,
  });
  const diagnostics = buildCashFlowDiagnostics({
    visibleDocs,
    salesOperations: salesAnalytics.sales_operations,
  });
  return {
    range: { from: fromStr, to: toStr },
    settings,
    summary_by_currency: summary,
    monthly: Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month)),
    calendar_days: Object.values(calendar).sort((a, b) => a.date.localeCompare(b.date)),
    incoming_documents: visibleDocs.filter((doc) => doc.direction === 'in').sort((a, b) => String(a.expected_date || a.actual_date || '').localeCompare(String(b.expected_date || b.actual_date || ''))),
    outgoing_documents: visibleDocs.filter((doc) => doc.direction === 'out').sort((a, b) => String(a.expected_date || a.actual_date || '').localeCompare(String(b.expected_date || b.actual_date || ''))),
    unplanned_documents: projected.filter((doc) => !doc.expected_date),
    sales_months: salesAnalytics.sales_months,
    sales_operations: salesAnalytics.sales_operations,
    monthly_goals: monthlyGoals,
    meta: {
      business_unit_id: businessUnitId,
      currency_code: currencyFilter || '',
      outgoing_scope: 'operation_expenses_and_admin_expenses',
    },
  };
}

async function buildFinanceData(query) {
  const now = new Date();
  const fromRaw = parseDate(query.from);
  const toRaw = parseDate(query.to);
  const from = fromRaw || startOfMonth(now);
  const to = toRaw || now;

  const businessUnitId = query.business_unit_id ? Number(query.business_unit_id) : null;
  const buFilter = businessUnitId ? 'AND d.business_unit_id = ?' : '';

  const days = diffDays(from, to) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));

  const fromStr = toYMD(from);
  const toStr = toYMD(to);
  const prevFromStr = toYMD(prevFrom);
  const prevToStr = toYMD(prevTo);

  const rateRaw = await getParamValue('admin_expense_exchange_rate');
  const rate = Number(rateRaw || 0) || 1;

  const currencyFilter = `(i.currency_code IS NULL OR i.currency_code = '' OR UPPER(i.currency_code) = 'USD')`;

  const [[invRow]] = await pool.query(
    `
    SELECT
      COALESCE(SUM(
        CASE
          WHEN i.status NOT IN ('anulada','borrador')
            THEN COALESCE(NULLIF(i.net_total_amount,0), i.total_amount, 0)
          ELSE 0
        END
      ),0) AS invoiced
    FROM invoices i
    LEFT JOIN deals d ON d.id = i.deal_id
    WHERE i.issue_date BETWEEN ? AND ?
      AND ${currencyFilter}
      ${buFilter}
    `,
    businessUnitId ? [fromStr, toStr, businessUnitId] : [fromStr, toStr]
  );

  const [[invPrevRow]] = await pool.query(
    `
    SELECT
      COALESCE(SUM(
        CASE
          WHEN i.status NOT IN ('anulada','borrador')
            THEN COALESCE(NULLIF(i.net_total_amount,0), i.total_amount, 0)
          ELSE 0
        END
      ),0) AS invoiced
    FROM invoices i
    LEFT JOIN deals d ON d.id = i.deal_id
    WHERE i.issue_date BETWEEN ? AND ?
      AND ${currencyFilter}
      ${buFilter}
    `,
    businessUnitId ? [prevFromStr, prevToStr, businessUnitId] : [prevFromStr, prevToStr]
  );

    const [[paidRow]] = await pool.query(
      `
      SELECT COALESCE(SUM(r.net_amount),0) AS paid
      FROM receipts r
      JOIN invoices i ON i.id = r.invoice_id
      LEFT JOIN deals d ON d.id = i.deal_id
      WHERE r.status <> 'anulado'
      AND COALESCE(r.issue_date, DATE(r.created_at)) BETWEEN ? AND ?
      AND (COALESCE(r.currency_code, i.currency_code, 'USD') = 'USD')
      ${buFilter}
      `,
      businessUnitId ? [fromStr, toStr, businessUnitId] : [fromStr, toStr]
    );

    const [[paidPrevRow]] = await pool.query(
      `
      SELECT COALESCE(SUM(r.net_amount),0) AS paid
      FROM receipts r
      JOIN invoices i ON i.id = r.invoice_id
      LEFT JOIN deals d ON d.id = i.deal_id
      WHERE r.status <> 'anulado'
      AND COALESCE(r.issue_date, DATE(r.created_at)) BETWEEN ? AND ?
      AND (COALESCE(r.currency_code, i.currency_code, 'USD') = 'USD')
      ${buFilter}
      `,
      businessUnitId ? [prevFromStr, prevToStr, businessUnitId] : [prevFromStr, prevToStr]
    );

  const [[pendingRow]] = await pool.query(
    `
    SELECT COALESCE(SUM(i.net_balance),0) AS pending
    FROM invoices i
    LEFT JOIN deals d ON d.id = i.deal_id
    WHERE i.issue_date <= ?
      AND i.status NOT IN ('anulada','borrador')
      AND ${currencyFilter}
      ${buFilter}
    `,
    businessUnitId ? [toStr, businessUnitId] : [toStr]
  );

  const [[pendingPrevRow]] = await pool.query(
    `
    SELECT COALESCE(SUM(i.net_balance),0) AS pending
    FROM invoices i
    LEFT JOIN deals d ON d.id = i.deal_id
    WHERE i.issue_date <= ?
      AND i.status NOT IN ('anulada','borrador')
      AND ${currencyFilter}
      ${buFilter}
    `,
    businessUnitId ? [prevToStr, businessUnitId] : [prevToStr]
  );

  const [[expRow]] = await pool.query(
    `
    SELECT COALESCE(SUM(
      CASE
        WHEN e.currency_code IS NULL OR e.currency_code = '' OR UPPER(e.currency_code) = 'USD'
          THEN e.amount
        ELSE e.amount / ?
      END
    ),0) AS expenses
    FROM admin_expenses e
    WHERE e.expense_date BETWEEN ? AND ?
    `,
    [rate, fromStr, toStr]
  );

  const [[expPrevRow]] = await pool.query(
    `
    SELECT COALESCE(SUM(
      CASE
        WHEN e.currency_code IS NULL OR e.currency_code = '' OR UPPER(e.currency_code) = 'USD'
          THEN e.amount
        ELSE e.amount / ?
      END
    ),0) AS expenses
    FROM admin_expenses e
    WHERE e.expense_date BETWEEN ? AND ?
    `,
    [rate, prevFromStr, prevToStr]
  );

  const invoiced = Number(invRow?.invoiced || 0);
  const paid = Number(paidRow?.paid || 0);
  const pending = Number(pendingRow?.pending || 0);
  const expenses = Number(expRow?.expenses || 0);
  const profit = invoiced - expenses;

  const prevInvoiced = Number(invPrevRow?.invoiced || 0);
  const prevPaid = Number(paidPrevRow?.paid || 0);
  const prevPending = Number(pendingPrevRow?.pending || 0);
  const prevExpenses = Number(expPrevRow?.expenses || 0);
  const prevProfit = prevInvoiced - prevExpenses;

  const labels = monthRange(from, to);

  const [invSeries] = await pool.query(
    `
    SELECT DATE_FORMAT(i.issue_date, '%Y-%m') AS ym,
           COALESCE(SUM(
             CASE
               WHEN i.status NOT IN ('anulada','borrador')
                 THEN COALESCE(NULLIF(i.net_total_amount,0), i.total_amount, 0)
               ELSE 0
             END
           ),0) AS total
    FROM invoices i
    LEFT JOIN deals d ON d.id = i.deal_id
    WHERE i.issue_date BETWEEN ? AND ?
      AND ${currencyFilter}
      ${buFilter}
    GROUP BY ym
    ORDER BY ym
    `,
    businessUnitId ? [fromStr, toStr, businessUnitId] : [fromStr, toStr]
  );

    const [paidSeries] = await pool.query(
      `
    SELECT DATE_FORMAT(COALESCE(r.issue_date, DATE(r.created_at)), '%Y-%m') AS ym,
           COALESCE(SUM(r.net_amount),0) AS total
    FROM receipts r
    JOIN invoices i ON i.id = r.invoice_id
    LEFT JOIN deals d ON d.id = i.deal_id
    WHERE r.status <> 'anulado'
      AND COALESCE(r.issue_date, DATE(r.created_at)) BETWEEN ? AND ?
      AND (COALESCE(r.currency_code, i.currency_code, 'USD') = 'USD')
      ${buFilter}
    GROUP BY ym
    ORDER BY ym
    `,
      businessUnitId ? [fromStr, toStr, businessUnitId] : [fromStr, toStr]
    );

  const [expSeries] = await pool.query(
    `
    SELECT DATE_FORMAT(e.expense_date, '%Y-%m') AS ym,
           COALESCE(SUM(
             CASE
               WHEN e.currency_code IS NULL OR e.currency_code = '' OR UPPER(e.currency_code) = 'USD'
                 THEN e.amount
               ELSE e.amount / ?
             END
           ),0) AS total
    FROM admin_expenses e
    WHERE e.expense_date BETWEEN ? AND ?
    GROUP BY ym
    ORDER BY ym
    `,
    [rate, fromStr, toStr]
  );

  const toSeries = (rows) => {
    const map = new Map((rows || []).map((r) => [r.ym, Number(r.total || 0)]));
    return labels.map((k) => map.get(k) || 0);
  };

  const [pendingItems] = await pool.query(
    `
    SELECT i.id, i.invoice_number, i.issue_date, i.net_balance,
           o.name AS organization_name
    FROM invoices i
    LEFT JOIN organizations o ON o.id = i.organization_id
    LEFT JOIN deals d ON d.id = i.deal_id
    WHERE i.issue_date BETWEEN ? AND ?
      AND i.status NOT IN ('anulada','borrador')
      AND i.net_balance > 0
      AND ${currencyFilter}
      ${buFilter}
    ORDER BY i.net_balance DESC
    LIMIT 10
    `,
    businessUnitId ? [fromStr, toStr, businessUnitId] : [fromStr, toStr]
  );

    const [paidItems] = await pool.query(
      `
    SELECT r.id, r.receipt_number, COALESCE(r.issue_date, DATE(r.created_at)) AS issue_date, r.net_amount,
           i.invoice_number, o.name AS organization_name
    FROM receipts r
    JOIN invoices i ON i.id = r.invoice_id
    LEFT JOIN organizations o ON o.id = i.organization_id
    LEFT JOIN deals d ON d.id = i.deal_id
    WHERE r.status <> 'anulado'
      AND COALESCE(r.issue_date, DATE(r.created_at)) BETWEEN ? AND ?
      AND (COALESCE(r.currency_code, i.currency_code, 'USD') = 'USD')
      ${buFilter}
    ORDER BY r.issue_date DESC
    LIMIT 10
    `,
      businessUnitId ? [fromStr, toStr, businessUnitId] : [fromStr, toStr]
    );

  const [expenseItems] = await pool.query(
    `
    SELECT e.id, e.expense_date, e.description, e.status, e.currency_code,
           CASE
             WHEN e.currency_code IS NULL OR e.currency_code = '' OR UPPER(e.currency_code) = 'USD'
               THEN e.amount
             ELSE e.amount / ?
           END AS amount_usd,
           COALESCE(e.supplier_name, p.name) AS supplier_name
    FROM admin_expenses e
    LEFT JOIN admin_expense_providers p ON p.id = e.provider_id
    WHERE e.expense_date BETWEEN ? AND ?
    ORDER BY e.expense_date DESC
    LIMIT 10
    `,
    [rate, fromStr, toStr]
  );

  return {
    range: {
      from: fromStr,
      to: toStr,
      prev_from: prevFromStr,
      prev_to: prevToStr,
      days,
    },
    kpi: { invoiced, paid, pending, expenses, profit },
    prev: {
      invoiced: prevInvoiced,
      paid: prevPaid,
      pending: prevPending,
      expenses: prevExpenses,
      profit: prevProfit,
    },
    series: {
      labels,
      invoiced: toSeries(invSeries),
      paid: toSeries(paidSeries),
      expenses: toSeries(expSeries),
    },
    lists: {
      pending: pendingItems || [],
      paid: paidItems || [],
      expenses: expenseItems || [],
    },
    meta: {
      business_unit_id: businessUnitId,
      expenses_scope: 'company',
      exchange_rate: rate,
    },
  };
}

router.get('/', requireAuth, requireRole(['admin', 'finanzas']), async (req, res) => {
  try {
    const data = await buildFinanceData(req.query);
    res.json(data);
  } catch (e) {
    console.error('[admin-finance]', e?.message || e);
    res.status(500).json({ error: 'No se pudo cargar el dashboard financiero' });
  }
});

router.get('/cash-flow', requireAuth, requireRole(['admin', 'finanzas']), async (req, res) => {
  try {
    const data = await buildCashFlowData(req.query);
    res.json(data);
  } catch (e) {
    console.error('[admin-finance][cash-flow]', e?.message || e);
    res.status(500).json({ error: 'No se pudo cargar el flujo de caja' });
  }
});

router.patch('/cash-flow/adjustment', requireAuth, requireRole(['admin', 'finanzas']), async (req, res) => {
  try {
    await ensureCashFlowTables();
    const sourceType = String(req.body?.source_type || '').trim();
    const sourceId = Number(req.body?.source_id || 0);
    const direction = String(req.body?.direction || '').trim();
    if (!sourceType || !sourceId || !['in', 'out'].includes(direction)) {
      return res.status(400).json({ error: 'source_type, source_id y direction son requeridos' });
    }
    const expectedDate = req.body?.expected_date || null;
    const expectedAmount = req.body?.expected_amount === '' || req.body?.expected_amount == null
      ? null
      : Number(req.body.expected_amount);
    if (expectedAmount != null && (!Number.isFinite(expectedAmount) || expectedAmount < 0)) {
      return res.status(400).json({ error: 'Monto esperado invalido' });
    }
    await pool.query(
      `INSERT INTO finance_cash_flow_adjustments
        (source_type, source_id, direction, expected_date, expected_amount, currency_code, note, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        expected_date = VALUES(expected_date),
        expected_amount = VALUES(expected_amount),
        currency_code = VALUES(currency_code),
        note = VALUES(note),
        updated_by = VALUES(updated_by)`,
      [
        sourceType,
        sourceId,
        direction,
        expectedDate,
        expectedAmount,
        req.body?.currency_code ? normalizeCurrency(req.body.currency_code) : null,
        String(req.body?.note || '').trim().slice(0, 255) || null,
        req.user?.id || null,
      ]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin-finance][adjustment]', e?.message || e);
    res.status(500).json({ error: 'No se pudo guardar el ajuste' });
  }
});

router.delete('/cash-flow/adjustment', requireAuth, requireRole(['admin', 'finanzas']), async (req, res) => {
  try {
    await ensureCashFlowTables();
    const sourceType = String(req.query?.source_type || '').trim();
    const sourceId = Number(req.query?.source_id || 0);
    const direction = String(req.query?.direction || '').trim();
    if (!sourceType || !sourceId || !['in', 'out'].includes(direction)) {
      return res.status(400).json({ error: 'source_type, source_id y direction son requeridos' });
    }
    await pool.query(
      `DELETE FROM finance_cash_flow_adjustments WHERE source_type = ? AND source_id = ? AND direction = ?`,
      [sourceType, sourceId, direction]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin-finance][adjustment-delete]', e?.message || e);
    res.status(500).json({ error: 'No se pudo eliminar el ajuste' });
  }
});

router.patch('/cash-flow/monthly-goals', requireAuth, requireRole(['admin']), async (req, res) => {
  try {
    const year = Number(req.body?.year || 0);
    const businessUnitId = req.body?.business_unit_id === '' || req.body?.business_unit_id == null
      ? ''
      : Number(req.body.business_unit_id);
    const currency = normalizeCurrency(req.body?.currency_code || 'USD');
    const rawGoals = Array.isArray(req.body?.goals) ? req.body.goals : [];
    if (!year || year < 2000 || year > 2100) {
      return res.status(400).json({ error: 'AÃ±o invalido' });
    }
    const goals = {};
    for (const item of rawGoals) {
      const month = Number(item?.month || 0);
      const amount = num(item?.amount);
      if (month >= 1 && month <= 12) goals[String(month).padStart(2, '0')] = round2(amount);
    }
    const allGoals = await getMonthlyGoals();
    allGoals[monthlyGoalKey({ year, businessUnitId, currency })] = goals;
    await upsertParamValue('finance_cash_flow_monthly_goals_json', JSON.stringify(allGoals));
    res.json({ ok: true, monthly_goals: allGoals });
  } catch (e) {
    console.error('[admin-finance][monthly-goals]', e?.message || e);
    res.status(500).json({ error: 'No se pudieron guardar las metas mensuales' });
  }
});

router.patch('/cash-flow/settings', requireAuth, requireRole(['admin']), async (req, res) => {
  try {
    const enabled = req.body?.rule_enabled ? '1' : '0';
    const rawRule = Array.isArray(req.body?.collection_rule) ? req.body.collection_rule : [];
    const rule = rawRule
      .map((item) => ({ percentage: num(item?.percentage), days: Number(item?.days || 0) || 0 }))
      .filter((item) => item.percentage > 0)
      .slice(0, 12);
    if (!rule.length) return res.status(400).json({ error: 'Debe cargar al menos una regla de cobro' });
    await upsertParamValue('finance_cash_flow_rule_enabled', enabled);
    await upsertParamValue('finance_cash_flow_rule_json', JSON.stringify(rule));
    res.json({ ok: true, settings: await getCashFlowSettings() });
  } catch (e) {
    console.error('[admin-finance][settings]', e?.message || e);
    res.status(500).json({ error: 'No se pudo guardar la configuracion' });
  }
});

router.get('/export', requireAuth, requireRole(['admin', 'finanzas']), async (req, res) => {
  try {
    const data = await buildFinanceData(req.query);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'CRM';
    wb.created = new Date();

    const summary = wb.addWorksheet('Resumen');
    summary.addRow(['Desde', data.range.from, 'Hasta', data.range.to]);
    summary.addRow([]);
    summary.addRow(['KPI', 'Valor USD', 'Periodo anterior USD']);
    summary.addRow(['Facturado', data.kpi.invoiced, data.prev.invoiced]);
    summary.addRow(['Cobrado', data.kpi.paid, data.prev.paid]);
    summary.addRow(['Pendiente', data.kpi.pending, data.prev.pending]);
    summary.addRow(['Gastos', data.kpi.expenses, data.prev.expenses]);
    summary.addRow(['Utilidad', data.kpi.profit, data.prev.profit]);
    summary.addRow([]);
    summary.addRow(['Nota', 'Gastos incluyen toda la empresa (sin filtro de unidad).']);

    const series = wb.addWorksheet('Series');
    series.addRow(['Mes', 'Facturado', 'Cobrado', 'Gastos']);
    data.series.labels.forEach((label, i) => {
      series.addRow([
        label,
        data.series.invoiced[i] || 0,
        data.series.paid[i] || 0,
        data.series.expenses[i] || 0,
      ]);
    });

    const pending = wb.addWorksheet('Pendiente');
    pending.addRow(['Factura', 'Cliente', 'Fecha', 'Saldo']);
    (data.lists.pending || []).forEach((r) => {
      pending.addRow([r.invoice_number, r.organization_name, r.issue_date, r.net_balance]);
    });

    const paid = wb.addWorksheet('Cobros');
    paid.addRow(['Recibo', 'Factura', 'Cliente', 'Fecha', 'Monto']);
    (data.lists.paid || []).forEach((r) => {
      paid.addRow([r.receipt_number, r.invoice_number, r.organization_name, r.issue_date, r.net_amount]);
    });

    const exp = wb.addWorksheet('Gastos');
    exp.addRow(['Fecha', 'Proveedor', 'Detalle', 'Monto USD']);
    (data.lists.expenses || []).forEach((r) => {
      exp.addRow([r.expense_date, r.supplier_name, r.description, r.amount_usd]);
    });

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="finance-${data.range.from}_to_${data.range.to}.xlsx"`
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('[admin-finance][export]', e?.message || e);
    res.status(500).json({ error: 'No se pudo exportar' });
  }
});

export default router;


