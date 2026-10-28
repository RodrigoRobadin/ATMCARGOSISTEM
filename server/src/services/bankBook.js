function cents(value) {
  const result = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(result)) throw new Error('Importe del Libro banco fuera de rango');
  return result;
}

const money = (value) => (value / 100).toFixed(2);

export function buildBankBook(openingAmount, entries) {
  let balance = cents(openingAmount);
  let credits = 0;
  let debits = 0;
  const rows = entries.map((entry) => {
    const credit = cents(entry.credit);
    const debit = cents(entry.debit);
    if (credit < 0 || debit < 0 || (credit > 0) === (debit > 0)) {
      throw new Error('Movimiento del Libro banco inválido');
    }
    balance += credit - debit;
    if (!Number.isSafeInteger(balance)) throw new Error('Saldo del Libro banco fuera de rango');
    credits += credit;
    debits += debit;
    return { ...entry, credit: money(credit), debit: money(debit), balance: money(balance) };
  });
  return { rows, credits: money(credits), debits: money(debits), calculated_balance: money(balance) };
}

export async function loadBankBookRows(conn, account, balanceDate) {
  const accountValues = [...new Set([account.alias, account.account_number].filter(Boolean))];
  const currency = account.currency_code;
  const sourceParams = [balanceDate, currency, ...accountValues];
  const accountPlaceholders = accountValues.map(() => '?').join(', ');
  const [receipts] = await conn.query(`SELECT 'receipt' AS source_type, r.id AS source_id,
      r.issue_date AS movement_date, r.created_at, 'Cobro de cliente' AS description,
      r.receipt_number AS document_number, r.reference_number, r.net_amount AS credit, 0 AS debit
    FROM receipts r WHERE r.status = 'emitido' AND r.issue_date >= ?
      AND UPPER(r.currency_code) = ? AND r.bank_account IN (${accountPlaceholders})
      AND LOWER(COALESCE(r.payment_method, '')) NOT IN ('', 'efectivo')`, sourceParams);
  const [orders] = await conn.query(`SELECT 'payment_order' AS source_type, p.id AS source_id,
      p.payment_date AS movement_date, p.created_at, CONCAT('Orden de pago ', o.order_number) AS description,
      o.order_number AS document_number, p.order_id, p.reference_number, 0 AS credit, p.amount AS debit
    FROM ap_payment_order_payments p JOIN ap_payment_orders o ON o.id = p.order_id
    WHERE p.payment_date >= ? AND o.currency_code = ?
      AND p.company_account IN (${accountPlaceholders})
      AND LOWER(p.method) <> 'efectivo'`, sourceParams);
  const [operationExpenses] = await conn.query(`SELECT 'operation_expense' AS source_type, p.id AS source_id,
      p.payment_date AS movement_date, p.created_at, 'Pago de gasto operativo' AS description,
      i.receipt_number AS document_number, p.reference_number, 0 AS credit, p.amount AS debit,
      i.operation_id, i.operation_type,
      CASE WHEN i.operation_type = 'service' THEN sc.reference ELSE d.reference END AS operation_reference
    FROM operation_expense_payments p JOIN operation_expense_invoices i ON i.id = p.invoice_id
    LEFT JOIN deals d ON i.operation_type <> 'service' AND d.id = i.operation_id
    LEFT JOIN service_cases sc ON i.operation_type = 'service' AND sc.id = i.operation_id
    WHERE p.payment_date >= ? AND i.currency_code = ? AND p.account IN (${accountPlaceholders})
      AND p.status = 'confirmado' AND LOWER(COALESCE(p.method, '')) NOT IN ('', 'efectivo')
      AND NOT EXISTS (SELECT 1 FROM ap_payment_order_allocations a
        JOIN ap_payment_order_items oi ON oi.id = a.item_id
        WHERE a.source_payment_id = p.id AND oi.source_type = 'operation-expense')`, sourceParams);
  const [adminExpenses] = await conn.query(`SELECT 'admin_expense' AS source_type, p.id AS source_id,
      p.payment_date AS movement_date, p.created_at, 'Pago de gasto administrativo' AS description,
      COALESCE(NULLIF(p.receipt_number, ''), e.receipt_number) AS document_number,
      p.reference_number, 0 AS credit, p.amount AS debit
    FROM admin_expense_payments p JOIN admin_expenses e ON e.id = p.expense_id
    WHERE p.payment_date >= ? AND p.currency_code = ?
      AND p.account IN (${accountPlaceholders}) AND p.status = 'confirmado'
      AND LOWER(COALESCE(p.method, '')) NOT IN ('', 'efectivo')
      AND NOT EXISTS (SELECT 1 FROM ap_payment_order_allocations a
        JOIN ap_payment_order_items oi ON oi.id = a.item_id
        WHERE a.source_payment_id = p.id AND oi.source_type = 'admin-expense')`, sourceParams);
  const [purchases] = currency === 'PYG' ? await conn.query(`SELECT 'purchase_invoice' AS source_type,
      p.id AS source_id, p.payment_date AS movement_date, p.created_at,
      'Pago de factura de compra' AS description,
      COALESCE(NULLIF(i.supplier_invoice_number, ''), i.invoice_number) AS document_number,
      p.reference_number, p.invoice_id AS purchase_invoice_id, 0 AS credit, p.amount AS debit
    FROM purchase_invoice_payments p JOIN purchase_invoices i ON i.id = p.invoice_id
    WHERE p.payment_date >= ?
      AND p.account IN (${accountPlaceholders}) AND p.payment_method <> 'efectivo'
      AND NOT EXISTS (SELECT 1 FROM ap_payment_order_allocations a
        JOIN ap_payment_order_items oi ON oi.id = a.item_id
        WHERE a.source_payment_id = p.id AND oi.source_type = 'purchase-invoice')`,
  [balanceDate, ...accountValues]) : [[]];
  const [manual] = await conn.query(`SELECT 'manual' AS source_type, id AS source_id,
      movement_date, created_at, description, NULL AS document_number, reference_number,
      CASE WHEN direction = 'credit' THEN amount ELSE 0 END AS credit,
      CASE WHEN direction = 'debit' THEN amount ELSE 0 END AS debit,
      reverses_entry_id
    FROM bank_book_manual_entries WHERE account_param_id = ? AND movement_date >= ?`,
  [account.id, balanceDate]);
  const [transfers] = await conn.query(`SELECT 'transfer' AS source_type, t.id AS source_id,
      t.movement_date, t.created_at,
      CASE WHEN t.from_account_param_id = ? THEN CONCAT('Transferencia a ', t.to_account_label)
           ELSE CONCAT('Transferencia de ', t.from_account_label) END AS description,
      CONCAT('TR-', LPAD(t.id, 6, '0')) AS document_number,
      t.reference_number, t.observations,
      CASE WHEN t.to_account_param_id = ? THEN t.amount ELSE 0 END AS credit,
      CASE WHEN t.from_account_param_id = ? THEN t.amount ELSE 0 END AS debit,
      t.reverses_transfer_id, reversed.id AS reversed_by
    FROM bank_internal_transfers t
    LEFT JOIN bank_internal_transfers reversed ON reversed.reverses_transfer_id = t.id
    WHERE (t.from_account_param_id = ? OR t.to_account_param_id = ?)
      AND t.movement_date >= ?`,
  [account.id, account.id, account.id, account.id, account.id, balanceDate]);
  const addOperation = (row, type, id, reference) => {
    if (!id || !reference) return;
    row.operation_links ||= [];
    if (!row.operation_links.some((link) => link.type === type && Number(link.id) === Number(id))) {
      row.operation_links.push({ type, id, reference });
    }
  };
  for (const row of operationExpenses) {
    addOperation(row, row.operation_type === 'service' ? 'service' : 'deal', row.operation_id, row.operation_reference);
  }
  if (receipts.length) {
    const byId = new Map(receipts.map((row) => [Number(row.source_id), row]));
    const ids = [...byId.keys()];
    const [links] = await conn.query(`SELECT r.id AS receipt_id,
        CASE WHEN i.service_case_id IS NOT NULL THEN 'service' ELSE 'deal' END AS operation_type,
        COALESCE(i.service_case_id, i.deal_id) AS operation_id,
        CASE WHEN i.service_case_id IS NOT NULL THEN sc.reference ELSE d.reference END AS operation_reference
      FROM receipts r
      LEFT JOIN receipt_applications ra ON ra.receipt_id = r.id
      JOIN invoices i ON i.id = COALESCE(ra.invoice_id, r.invoice_id)
      LEFT JOIN deals d ON d.id = i.deal_id
      LEFT JOIN service_cases sc ON sc.id = i.service_case_id
      WHERE r.id IN (${ids.map(() => '?').join(',')})`, ids);
    for (const link of links) addOperation(byId.get(Number(link.receipt_id)), link.operation_type,
      link.operation_id, link.operation_reference);
  }
  if (orders.length) {
    const byOrder = new Map();
    for (const row of orders) {
      if (!byOrder.has(Number(row.order_id))) byOrder.set(Number(row.order_id), []);
      byOrder.get(Number(row.order_id)).push(row);
    }
    const ids = [...byOrder.keys()];
    const [links] = await conn.query(`SELECT oi.order_id,
        CASE WHEN e.operation_type = 'service' THEN 'service' ELSE 'deal' END AS operation_type,
        e.operation_id,
        CASE WHEN e.operation_type = 'service' THEN sc.reference ELSE d.reference END AS operation_reference
      FROM ap_payment_order_items oi
      JOIN operation_expense_invoices e ON oi.source_type = 'operation-expense' AND e.id = oi.source_id
      LEFT JOIN deals d ON e.operation_type <> 'service' AND d.id = e.operation_id
      LEFT JOIN service_cases sc ON e.operation_type = 'service' AND sc.id = e.operation_id
      WHERE oi.order_id IN (${ids.map(() => '?').join(',')})`, ids);
    for (const link of links) for (const row of byOrder.get(Number(link.order_id)) || []) {
      addOperation(row, link.operation_type, link.operation_id, link.operation_reference);
    }
  }
  return [...receipts, ...orders, ...operationExpenses, ...adminExpenses, ...purchases, ...manual, ...transfers]
    .sort((a, b) => String(a.movement_date).localeCompare(String(b.movement_date)) ||
      String(a.created_at).localeCompare(String(b.created_at)) ||
      String(a.source_type).localeCompare(String(b.source_type)) || Number(a.source_id) - Number(b.source_id));
}

export async function countUnassignedBankBookRows(conn, currency, balanceDate, toDate = null) {
  const [accounts] = await conn.query(
    "SELECT value FROM param_values WHERE `key` = 'company_bank_account' AND active = 1"
  );
  const known = new Set();
  for (const row of accounts) {
    let value;
    try { value = JSON.parse(row.value); } catch { value = { alias: row.value }; }
    if (String(value.currency_code || value.currency || 'PYG').toUpperCase() !== currency) continue;
    for (const label of [value.alias || value.bank_name, value.account_number]) {
      if (String(label || '').trim()) known.add(String(label).trim());
    }
  }
  if (!known.size) return 0;
  const placeholders = [...known].map(() => '?').join(', ');
  const unknown = (column) => `(${column} IS NULL OR TRIM(${column}) = '' OR ${column} NOT IN (${placeholders}))`;
  const params = [balanceDate, currency, ...(toDate ? [toDate] : []), ...known];
  const through = (column) => toDate ? `AND ${column} <= ?` : '';
  const queries = [
    `SELECT COUNT(*) AS total FROM receipts r WHERE r.status = 'emitido' AND r.issue_date >= ?
      AND UPPER(r.currency_code) = ? ${through('r.issue_date')}
      AND LOWER(COALESCE(r.payment_method, '')) NOT IN ('', 'efectivo')
      AND ${unknown('r.bank_account')}`,
    `SELECT COUNT(*) AS total FROM ap_payment_order_payments p
      JOIN ap_payment_orders o ON o.id = p.order_id WHERE p.payment_date >= ?
      AND o.currency_code = ? ${through('p.payment_date')}
      AND LOWER(p.method) <> 'efectivo' AND ${unknown('p.company_account')}`,
    `SELECT COUNT(*) AS total FROM operation_expense_payments p
      JOIN operation_expense_invoices i ON i.id = p.invoice_id
      WHERE p.payment_date >= ? AND i.currency_code = ? ${through('p.payment_date')}
      AND p.status = 'confirmado'
      AND LOWER(COALESCE(p.method, '')) NOT IN ('', 'efectivo') AND ${unknown('p.account')}
      AND NOT EXISTS (SELECT 1 FROM ap_payment_order_allocations a
        JOIN ap_payment_order_items oi ON oi.id = a.item_id
        WHERE a.source_payment_id = p.id AND oi.source_type = 'operation-expense')`,
    `SELECT COUNT(*) AS total FROM admin_expense_payments p
      WHERE p.payment_date >= ? AND p.currency_code = ? ${through('p.payment_date')}
      AND p.status = 'confirmado'
      AND LOWER(COALESCE(p.method, '')) NOT IN ('', 'efectivo') AND ${unknown('p.account')}
      AND NOT EXISTS (SELECT 1 FROM ap_payment_order_allocations a
        JOIN ap_payment_order_items oi ON oi.id = a.item_id
        WHERE a.source_payment_id = p.id AND oi.source_type = 'admin-expense')`,
  ];
  if (currency === 'PYG') {
    queries.push(`SELECT COUNT(*) AS total FROM purchase_invoice_payments p
      WHERE p.payment_date >= ? AND ? = 'PYG' ${through('p.payment_date')}
      AND p.payment_method <> 'efectivo'
      AND ${unknown('p.account')}
      AND NOT EXISTS (SELECT 1 FROM ap_payment_order_allocations a
        JOIN ap_payment_order_items oi ON oi.id = a.item_id
        WHERE a.source_payment_id = p.id AND oi.source_type = 'purchase-invoice')`);
  }
  let count = 0;
  for (const sql of queries) {
    const [[row]] = await conn.query(sql, params);
    count += Number(row.total);
  }
  return count;
}
