import { pool } from '../src/services/db.js';

function arg(name, fallback = '') {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return { __parse_error: error?.message || String(error) };
  }
}

function pick(obj, path) {
  return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

async function tableExists(name) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS total
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [name]
  );
  return Number(row?.total || 0) > 0;
}

async function columnsFor(name) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [name]
  );
  return rows.map((row) => row.COLUMN_NAME);
}

async function main() {
  const operationId = Number(arg('operation'));
  const opType = String(arg('op_type', 'deal')).toLowerCase();
  const quoteRevisionId = Number(arg('quote_revision_id') || 0) || null;
  const costSheetVersion = Number(arg('cost_sheet_version_number') || 0) || null;

  if (!operationId) {
    console.error('Uso: node server/scripts/diagnoseExpenseControl.js --operation=113 --quote_revision_id=13');
    process.exitCode = 1;
    return;
  }

  const [[dbInfo]] = await pool.query('SELECT DATABASE() AS db, @@hostname AS host, @@version AS version');
  console.log('DB:', dbInfo);
  console.log('Args:', { operationId, opType, quoteRevisionId, costSheetVersion });

  for (const table of [
    'quotes',
    'quote_revisions',
    'deal_cost_sheets',
    'deal_cost_sheet_versions',
    'operation_expense_invoices',
    'operation_expense_invoice_items',
    'operation_expense_control_settings',
  ]) {
    const exists = await tableExists(table);
    console.log(`Table ${table}:`, exists ? 'OK' : 'MISSING');
    if (exists && table.startsWith('operation_expense')) {
      console.log(`Columns ${table}:`, (await columnsFor(table)).join(', '));
    }
  }

  const [[settings]] = await pool.query(
    `SELECT *
       FROM operation_expense_control_settings
      WHERE operation_id = ? AND operation_type = ?
      LIMIT 1`,
    [operationId, opType]
  ).catch(() => [[null]]);
  console.log('Control settings:', settings || null);

  const [expenseRows] = await pool.query(
    `SELECT e.id, e.operation_id, e.operation_type, e.currency_code, e.amount_total,
            e.expense_rubro, e.expense_concept, e.status,
            COUNT(it.id) AS item_count,
            GROUP_CONCAT(DISTINCT it.expense_rubro ORDER BY it.expense_rubro SEPARATOR ', ') AS item_rubros
       FROM operation_expense_invoices e
       LEFT JOIN operation_expense_invoice_items it ON it.invoice_id = e.id
      WHERE e.operation_id = ? AND e.operation_type = ?
      GROUP BY e.id
      ORDER BY e.id DESC`,
    [operationId, opType]
  );
  console.log('Expense invoices:', expenseRows);

  if (quoteRevisionId) {
    const [[revision]] = await pool.query(
      `SELECT qr.id, qr.quote_id, qr.name, q.deal_id, q.ref_code, q.revision,
              CHAR_LENGTH(qr.computed_json) AS computed_len,
              qr.computed_json
         FROM quote_revisions qr
         JOIN quotes q ON q.id = qr.quote_id
        WHERE qr.id = ?
        LIMIT 1`,
      [quoteRevisionId]
    );
    console.log('Selected quote revision:', revision ? {
      id: revision.id,
      quote_id: revision.quote_id,
      deal_id: revision.deal_id,
      name: revision.name,
      ref_code: revision.ref_code,
      revision: revision.revision,
      computed_len: revision.computed_len,
      belongs_to_operation: Number(revision.deal_id) === Number(operationId),
    } : null);

    const computed = parseJson(revision?.computed_json);
    console.log('Computed parse error:', computed?.__parse_error || null);
    console.log('Computed totals:', {
      total_buy_usd: pick(computed, 'operacion.totals.total_buy_usd'),
      total_sell_usd: pick(computed, 'operacion.totals.total_sell_usd'),
      profit_total_usd: pick(computed, 'operacion.totals.profit_total_usd'),
      oferta_total_sales_usd: pick(computed, 'oferta.totals.total_sales_usd'),
      rubros_keys: Object.keys(pick(computed, 'operacion.rubros') || {}),
    });
  } else {
    const [[quote]] = await pool.query(
      `SELECT id, deal_id, ref_code, revision, CHAR_LENGTH(computed_json) AS computed_len, computed_json
         FROM quotes
        WHERE deal_id = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT 1`,
      [operationId]
    );
    const computed = parseJson(quote?.computed_json);
    console.log('Current quote:', quote ? {
      id: quote.id,
      deal_id: quote.deal_id,
      ref_code: quote.ref_code,
      revision: quote.revision,
      computed_len: quote.computed_len,
    } : null);
    console.log('Current quote totals:', {
      total_buy_usd: pick(computed, 'operacion.totals.total_buy_usd'),
      total_sell_usd: pick(computed, 'operacion.totals.total_sell_usd'),
      rubros_keys: Object.keys(pick(computed, 'operacion.rubros') || {}),
    });
  }

  if (costSheetVersion) {
    const [[version]] = await pool.query(
      `SELECT id, deal_id, version_number, revision_name, CHAR_LENGTH(data) AS data_len, data
         FROM deal_cost_sheet_versions
        WHERE deal_id = ? AND version_number = ?
        LIMIT 1`,
      [operationId, costSheetVersion]
    );
    const data = parseJson(version?.data);
    console.log('Cost sheet version:', version ? {
      id: version.id,
      deal_id: version.deal_id,
      version_number: version.version_number,
      revision_name: version.revision_name,
      data_len: version.data_len,
    } : null);
    console.log('Cost sheet totals:', data?.totals || null);
  }
}

main()
  .catch((error) => {
    console.error('DIAG ERROR:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
