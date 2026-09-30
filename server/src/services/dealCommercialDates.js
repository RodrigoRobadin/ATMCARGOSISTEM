import { auditSnapshot, recordAuditChange } from './audit.js';

const protectedKeys = new Set(['f_inicio', 'f_cotiz', 'f_confirm', 'confirm_method', 'confirm_file_id']);

export function isProtectedCommercialDateKey(key) {
  return protectedKeys.has(String(key || '').toLowerCase());
}

export function paraguayDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function hasQuotedSaleValue(computed, snapshot = null) {
  const amount = Number(computed?.oferta?.totals?.total_sales_usd ?? computed?.mobile_summary?.sale_amount);
  if (Number.isFinite(amount) && amount > 0) return true;
  let items = snapshot?.industrial_items_json;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch { items = null; }
  }
  const positive = (value) => {
    const text = String(value ?? '').trim();
    const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
    return Number(normalized) > 0;
  };
  return Array.isArray(items) && items.some((item) =>
    item?.include !== false && positive(item?.cantidad ?? item?.quantity ?? item?.qty) &&
    positive(item?.precio ?? item?.unit_price ?? item?.sale_price)
  );
}

export async function setDealCustomField(conn, req, dealId, key, label, type, value) {
  const [[existing]] = await conn.query(
    'SELECT id FROM deal_custom_fields WHERE deal_id = ? AND `key` = ? LIMIT 1 FOR UPDATE',
    [dealId, key]
  );
  const before = existing ? await auditSnapshot(conn, 'deal_custom_field', existing.id) : null;
  let fieldId = existing?.id;
  if (existing) {
    await conn.query(
      'UPDATE deal_custom_fields SET label = ?, `type` = ?, `value` = ? WHERE id = ?',
      [label, type, value, fieldId]
    );
  } else {
    const [result] = await conn.query(
      'INSERT INTO deal_custom_fields (deal_id, `key`, label, `type`, `value`) VALUES (?,?,?,?,?)',
      [dealId, key, label, type, value]
    );
    fieldId = result.insertId;
  }
  await recordAuditChange(conn, {
    req, action: existing ? 'update' : 'create', entity: 'deal_custom_field', entityId: fieldId,
    rootEntity: 'deal', rootEntityId: dealId, before,
    after: await auditSnapshot(conn, 'deal_custom_field', fieldId),
    description: `Actualizo ${label.toLowerCase()} de la operacion`,
  });
  return fieldId;
}

export async function recordFirstQuoteDate(conn, req, dealId, computed, snapshot = null) {
  if (!Number(dealId) || !hasQuotedSaleValue(computed, snapshot)) return false;
  const [[deal]] = await conn.query('SELECT id FROM deals WHERE id = ? FOR UPDATE', [dealId]);
  if (!deal) return false;
  const [[field]] = await conn.query(
    "SELECT id, `value` FROM deal_custom_fields WHERE deal_id = ? AND `key` = 'f_cotiz' LIMIT 1 FOR UPDATE",
    [dealId]
  );
  if (field?.value) return false;
  await setDealCustomField(conn, req, Number(dealId), 'f_cotiz', 'F. Cotiz', 'text', paraguayDate());
  return true;
}
