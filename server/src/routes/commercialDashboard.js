import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';
import { loadCommercialSessions, validateSessionRange } from '../services/commercialSessions.js';

const router = Router();

function safeJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function num(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeCurrency(value, fallback = 'USD') {
  const source = value == null || String(value).trim() === '' ? fallback : value;
  const code = String(source == null ? '' : source).trim().toUpperCase();
  return code === 'GS' ? 'PYG' : code;
}

function toOperationCurrency(value, currencyCode, exchangeRate) {
  const amount = num(value);
  const currency = normalizeCurrency(currencyCode);
  const rate = num(exchangeRate);
  return currency === 'PYG' && rate > 0 ? amount * rate : amount;
}

function summarizeQuoteComputed(computed = {}, inputs = {}, snapshot = {}) {
  const currencyCode = normalizeCurrency(
    computed?.meta?.operation_currency || inputs?.operation_currency || 'USD'
  );
  const exchangeRate =
    num(
      computed?.meta?.exchange_rate_atm_gs_per_usd ||
        computed?.meta?.exchange_rate_operation_sell_usd ||
        inputs?.exchange_rate_atm_gs_per_usd ||
        inputs?.exchange_rate_operation_sell_usd
    ) || 1;
  const totalSales =
    computed?.oferta?.totals?.total_sales_usd ??
    computed?.operacion?.totals?.total_sales_usd ??
    computed?.totals?.total_sales_usd ??
    null;
  const profit =
    computed?.operacion?.totals?.profit_total_usd ??
    computed?.operacion?.totals?.profitGeneral ??
    computed?.operacion?.totals?.profit_general ??
    computed?.totals?.profit_total_usd ??
    null;
  return {
    currency_code: currencyCode,
    total_sales: totalSales == null ? null : toOperationCurrency(totalSales, currencyCode, exchangeRate),
    profit_total: profit == null ? null : toOperationCurrency(profit, currencyCode, exchangeRate),
    validity_text: snapshot?.validez_oferta || snapshot?.offer_validity || inputs?.validez_oferta || null,
  };
}

function toSheetNumber(value) {
  if (value === '' || value === null || value === undefined) return 0;
  const normalized = String(value).replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarizeCostSheetData(data = {}) {
  const header = data?.header || {};
  const totals = data?.totals || {};
  const currencyCode = normalizeCurrency(header.operationCurrency || header.currency || 'USD');
  const profit = toSheetNumber(totals.profitGeneral ?? totals.profit_total_usd ?? totals.profit);
  const sales =
    toSheetNumber(totals.totalVentas ?? totals.total_sales_usd ?? totals.totalVenta) ||
    toSheetNumber(totals.totalVentaCliente);
  return {
    currency_code: currencyCode,
    total_sales: sales || null,
    profit_total: profit || null,
  };
}

function pickDealMetrics(deal, quoteByDeal, costSheetByDeal) {
  const quote = quoteByDeal.get(Number(deal.id));
  const costSheet = costSheetByDeal.get(Number(deal.id));
  const source = quote || costSheet || {};
  return {
    has_quote: Boolean(deal.has_quote || quote || costSheet),
    currency_code: source.currency_code || null,
    sales: num(source.total_sales),
    profit: num(source.profit_total),
    validity_text: quote?.validity_text || null,
  };
}

export function offerExpiry(quoteDate, validityText, todayDate) {
  const match = String(validityText || '').trim().match(/^(\d{1,3})\s*(?:d[ií]as?)?\s*(?:(?:corridos|calendario|calendarios))?\s*$/i);
  if (!match || !/^\d{4}-\d{2}-\d{2}$/.test(String(quoteDate || ''))) return null;
  const date = new Date(`${quoteDate}T00:00:00Z`);
  const today = new Date(`${todayDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || Number.isNaN(today.getTime()) || date.toISOString().slice(0, 10) !== quoteDate) return null;
  date.setUTCDate(date.getUTCDate() + Number(match[1]));
  return {
    expires_on: date.toISOString().slice(0, 10),
    days_remaining: Math.round((date.getTime() - today.getTime()) / 86400000),
  };
}

function paraguayToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function daysUntil(value) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return Math.ceil((dt.getTime() - Date.now()) / 86400000);
}

export function closingAssessment(deal, todayDate) {
  const expectedCloseDate = String(deal.expected_close_date || '').slice(0, 10);
  const expected = /^\d{4}-\d{2}-\d{2}$/.test(expectedCloseDate)
    ? new Date(`${expectedCloseDate}T00:00:00Z`)
    : null;
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(todayDate || ''))
    ? new Date(`${todayDate}T00:00:00Z`)
    : null;
  const validDate = expected && today && !Number.isNaN(expected.getTime()) && !Number.isNaN(today.getTime()) &&
    expected.toISOString().slice(0, 10) === expectedCloseDate && today.toISOString().slice(0, 10) === todayDate;
  const daysRemaining = validDate ? Math.round((expected.getTime() - today.getTime()) / 86400000) : null;
  const byDate = daysRemaining != null && daysRemaining <= 30;
  const byStage = Number(deal.probability || 0) >= 70 || /(confirm|cerr|negoci)/i.test(String(deal.stage_name || ''));
  const isProspect = deal.record_type === 'prospect' || /prospect/i.test(String(deal.stage_name || ''));
  return {
    expected_close_date: validDate ? expectedCloseDate : null,
    closing_days_remaining: daysRemaining,
    is_closing_soon: !isProspect && (byDate || byStage),
    closing_reason: byDate
      ? daysRemaining < 0 ? `Cierre estimado vencido hace ${Math.abs(daysRemaining)} día(s)`
        : daysRemaining === 0 ? 'Cierre estimado para hoy' : `Cierre estimado en ${daysRemaining} día(s)`
      : byStage ? 'Etapa de alta probabilidad' : null,
  };
}

export function buildNextAction(deal) {
  if (Number(deal.overdue_activities || 0) > 0) {
    return {
      key: 'resolver_vencidos',
      label: 'Resolver seguimiento',
      priority: 'alta',
      reason: `${Number(deal.overdue_activities || 0)} seguimiento(s) vencido(s)`,
    };
  }
  if (deal.is_prospect && !deal.last_contact_at) {
    return {
      key: 'primer_contacto',
      label: 'Registrar primer contacto',
      priority: 'alta',
      reason: 'Prospecto sin contacto registrado',
    };
  }
  if (!deal.has_quote) {
    return {
      key: 'cotizar',
      label: 'Cotizar',
      priority: 'alta',
      reason: 'Operacion abierta sin presupuesto',
    };
  }
  if (deal.offer_days_remaining != null && deal.offer_days_remaining <= 3) {
    return {
      key: 'vigencia_oferta',
      label: deal.offer_days_remaining < 0 ? 'Renovar oferta' : 'Revisar vigencia',
      priority: 'alta',
      reason: deal.offer_days_remaining < 0
        ? `Oferta vencida hace ${Math.abs(deal.offer_days_remaining)} día(s)`
        : `Oferta vence en ${deal.offer_days_remaining} día(s)`,
    };
  }
  if (deal.quote_followup_due) {
    return {
      key: 'seguimiento_cotizacion',
      label: 'Dar seguimiento',
      priority: 'alta',
      reason: 'Cotización sin seguimiento reciente',
    };
  }
  if (deal.is_closing_soon) {
    return {
      key: 'cerrar',
      label: 'Cerrar venta',
      priority: 'alta',
      reason: deal.closing_reason || 'Etapa de alta probabilidad',
    };
  }
  if (deal.is_stuck) {
    return {
      key: 'reactivar',
      label: 'Reactivar',
      priority: 'media',
      reason: `${deal.age_days || 0} dias sin actividad`,
    };
  }
  if (!deal.next_activity_at) {
    return {
      key: 'programar',
      label: 'Programar seguimiento',
      priority: 'media',
      reason: 'Sin proxima actividad registrada',
    };
  }
  return {
    key: 'seguir',
    label: 'Dar seguimiento',
    priority: 'normal',
    reason: 'Tiene actividad futura',
  };
}

export function commercialJourneyKey(deal) {
  if (deal.is_prospect) return 'prospect';
  if (deal.is_closing_soon) return 'closing';
  if (deal.has_quote) return 'quoted';
  return /cotiz/i.test(String(deal.stage_name || '')) ? 'to_quote' : 'followup';
}

router.get('/sessions', requireAuth, async (req, res) => {
  const today = new Date(`${paraguayToday()}T00:00:00Z`);
  today.setUTCDate(today.getUTCDate() - 1);
  const yesterday = today.toISOString().slice(0, 10);
  const from = String(req.query.from || yesterday);
  const to = String(req.query.to || from);
  const rangeError = validateSessionRange(from, to);
  if (rangeError) return res.status(400).json({ error: rangeError });

  const businessUnit = String(req.query.business_unit || '').trim().toLowerCase();
  if (businessUnit && !['atm-cargo', 'atm-industrial'].includes(businessUnit)) {
    return res.status(400).json({ error: 'Unidad de negocio invalida.' });
  }
  const isAdmin = String(req.user?.role || '').toLowerCase() === 'admin';
  const requestedUserId = Number(req.query.user_id);
  const advisorUserId = isAdmin
    ? (Number.isInteger(requestedUserId) && requestedUserId > 0 ? requestedUserId : null)
    : Number(req.user?.id || 0);
  if (!isAdmin && !advisorUserId) return res.status(401).json({ error: 'No auth' });
  try {
    const result = await loadCommercialSessions(pool, { from, to, businessUnit, advisorUserId });
    res.json({ from, to, ...result });
  } catch (error) {
    console.error('[commercial-dashboard:sessions]', error);
    res.status(500).json({ error: 'No se pudieron cargar las sesiones comerciales.' });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    const isAdmin = role === 'admin';
    const requestedUserId = req.query.user_id ? Number(req.query.user_id) : null;
    const selectedUserId = isAdmin ? (Number.isFinite(requestedUserId) && requestedUserId > 0 ? requestedUserId : null) : Number(req.user?.id || 0);
    const businessUnit = String(req.query.business_unit || '').trim().toLowerCase();
    const fromDate = req.query.from_date ? String(req.query.from_date) : '';
    const toDate = req.query.to_date ? String(req.query.to_date) : '';

    const where = [
      "LOWER(COALESCE(bu.key_slug, '')) IN ('atm-cargo', 'atm-industrial')",
      "LOWER(COALESCE(d.status, 'open')) <> 'closed'",
      "COALESCE(NULLIF(LOWER(d.commercial_outcome), ''), 'active') = 'active'",
    ];
    const params = [];

    if (selectedUserId) {
      where.push('d.advisor_user_id = ?');
      params.push(selectedUserId);
    }
    if (businessUnit && ['atm-cargo', 'atm-industrial'].includes(businessUnit)) {
      where.push('LOWER(bu.key_slug) = ?');
      params.push(businessUnit);
    }
    if (fromDate) {
      where.push('DATE(d.created_at) >= ?');
      params.push(fromDate);
    }
    if (toDate) {
      where.push('DATE(d.created_at) <= ?');
      params.push(toDate);
    }

    const [deals] = await pool.query(
      `
      SELECT d.id, d.reference, d.title, d.value, d.status, d.created_at,
             d.org_id, d.contact_id,
             d.stage_id, d.advisor_user_id, du.name AS advisor_name,
             s.name AS stage_name, s.probability, s.stuck_days,
             COALESCE(da.total_activities, 0) AS total_activities,
             da.last_activity_at, da.last_contact_at,
             fc.last_call_at,
             da.next_activity_at,
             COALESCE(da.pending_count, 0) AS pending_activities,
             COALESCE(da.overdue_count, 0) AS overdue_activities,
             ft.last_task_at, ft.next_task_at,
             COALESCE(ft.pending_count, 0) AS pending_tasks,
             COALESCE(ft.overdue_count, 0) AS overdue_tasks,
             COALESCE(qs.has_quote, 0) AS has_quote,
             qs.last_quote_at,
             o.name AS org_name,
             bu.name AS business_unit_name,
             bu.key_slug AS business_unit_key
        FROM deals d
        LEFT JOIN users du ON du.id = d.advisor_user_id
        LEFT JOIN stages s ON s.id = d.stage_id
        LEFT JOIN organizations o ON o.id = d.org_id
        LEFT JOIN business_units bu ON bu.id = d.business_unit_id
        LEFT JOIN (
          SELECT deal_id,
                 COUNT(*) AS total_activities,
                 MAX(created_at) AS last_activity_at,
                 MAX(CASE WHEN done = 1 AND type IN ('call', 'meeting', 'email') THEN COALESCE(due_date, created_at) ELSE NULL END) AS last_contact_at,
                 MIN(CASE WHEN done = 0 AND due_date IS NOT NULL THEN due_date ELSE NULL END) AS next_activity_at,
                 SUM(CASE WHEN done = 0 THEN 1 ELSE 0 END) AS pending_count,
                 SUM(CASE WHEN done = 0 AND due_date IS NOT NULL AND due_date < CURDATE() THEN 1 ELSE 0 END) AS overdue_count
            FROM activities
           WHERE deal_id IS NOT NULL
           GROUP BY deal_id
        ) da ON da.deal_id = d.id
        LEFT JOIN (
          SELECT deal_id, MAX(happened_at) AS last_call_at
            FROM followup_calls
           WHERE deal_id IS NOT NULL AND status = 'completed'
           GROUP BY deal_id
        ) fc ON fc.deal_id = d.id
        LEFT JOIN (
          SELECT deal_id,
                 MAX(created_at) AS last_task_at,
                 MIN(CASE WHEN status = 'pending' THEN due_at ELSE NULL END) AS next_task_at,
                 SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
                 SUM(CASE WHEN status = 'pending' AND due_at < NOW() THEN 1 ELSE 0 END) AS overdue_count
            FROM followup_tasks WHERE deal_id IS NOT NULL GROUP BY deal_id
        ) ft ON ft.deal_id = d.id
        LEFT JOIN (
          SELECT deal_id, 1 AS has_quote, MAX(updated_at) AS last_quote_at
            FROM quotes
           WHERE deal_id IS NOT NULL
           GROUP BY deal_id
        ) qs ON qs.deal_id = d.id
       WHERE ${where.join(' AND ')}
       ORDER BY d.created_at DESC
      `,
      params
    );

    const dealIds = (deals || []).map((d) => Number(d.id)).filter(Boolean);
    const quoteByDeal = new Map();
    const costSheetByDeal = new Map();
    const fieldsByDeal = new Map();

    if (dealIds.length) {
      const [quoteRows] = await pool.query(
        `SELECT id, deal_id, computed_json, inputs_json, document_snapshot_json
           FROM quotes
          WHERE deal_id IN (?)
          ORDER BY deal_id, id DESC`,
        [dealIds]
      ).catch(() => [[]]);
      const latestQuotes = new Map();
      for (const row of quoteRows || []) {
        if (latestQuotes.has(Number(row.deal_id))) continue;
        latestQuotes.set(Number(row.deal_id), row);
        quoteByDeal.set(
          Number(row.deal_id),
          summarizeQuoteComputed(safeJson(row.computed_json, {}) || {}, safeJson(row.inputs_json, {}) || {}, safeJson(row.document_snapshot_json, {}) || {})
        );
      }
      const quoteIds = [...latestQuotes.values()].map((row) => Number(row.id));
      if (quoteIds.length) {
        const [revisions] = await pool.query(
          `SELECT quote_id, computed_json, inputs_json, document_snapshot_json
             FROM quote_revisions
            WHERE quote_id IN (?)
            ORDER BY quote_id, id DESC`,
          [quoteIds]
        ).catch(() => [[]]);
        const seen = new Set();
        const dealByQuote = new Map([...latestQuotes.values()].map((row) => [Number(row.id), Number(row.deal_id)]));
        for (const revision of revisions || []) {
          const quoteId = Number(revision.quote_id);
          if (seen.has(quoteId)) continue;
          seen.add(quoteId);
          quoteByDeal.set(dealByQuote.get(quoteId), summarizeQuoteComputed(
            safeJson(revision.computed_json, {}) || {}, safeJson(revision.inputs_json, {}) || {}, safeJson(revision.document_snapshot_json, {}) || {}
          ));
        }
      }

      const [costRows] = await pool.query(
        `SELECT v.deal_id, v.data
           FROM deal_cost_sheet_versions v
           INNER JOIN (
             SELECT deal_id, MAX(version_number) AS max_version
               FROM deal_cost_sheet_versions
              WHERE deal_id IN (?)
              GROUP BY deal_id
           ) latest ON latest.deal_id = v.deal_id AND latest.max_version = v.version_number`,
        [dealIds]
      ).catch(() => [[]]);
      for (const row of costRows || []) {
        costSheetByDeal.set(Number(row.deal_id), summarizeCostSheetData(safeJson(row.data, {}) || {}));
      }

      const [fields] = await pool.query(
        "SELECT id, deal_id, `key`, `value` FROM deal_custom_fields WHERE deal_id IN (?) AND `key` IN ('f_cotiz', 'validez_oferta', 'expected_close_date') ORDER BY id DESC",
        [dealIds]
      );
      for (const field of fields) {
        const dealId = Number(field.deal_id);
        const values = fieldsByDeal.get(dealId) || {};
        if (values[field.key] === undefined) values[field.key] = field.value;
        fieldsByDeal.set(dealId, values);
      }
    }

    const today = paraguayToday();
    const enriched = (deals || []).map((deal) => {
      const metrics = pickDealMetrics(deal, quoteByDeal, costSheetByDeal);
      const commercialFields = fieldsByDeal.get(Number(deal.id)) || {};
      const validityText = metrics.validity_text || commercialFields.validez_oferta || null;
      const quotedOn = String(commercialFields.f_cotiz || '').slice(0, 10) || null;
      const expiry = metrics.has_quote ? offerExpiry(quotedOn, validityText, today) : null;
      const lastActivity = [deal.last_activity_at, deal.last_task_at, deal.last_call_at]
        .filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || deal.created_at;
      const lastContact = [deal.last_contact_at, deal.last_call_at]
        .filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null;
      const ageDays = lastActivity ? Math.floor((Date.now() - new Date(lastActivity).getTime()) / 86400000) : null;
      const stuckLimit = Number(deal.stuck_days || 0) || 15;
      const probability = Number(deal.probability || 0);
      const nextActivity = [deal.next_activity_at, deal.next_task_at]
        .filter(Boolean).sort((a, b) => new Date(a) - new Date(b))[0] || null;
      const lastQuoteFollowup = [deal.last_quote_at, lastContact]
        .filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null;
      const quoteAgeDays = lastQuoteFollowup
        ? Math.floor((Date.now() - new Date(lastQuoteFollowup).getTime()) / 86400000) : null;
      const closing = closingAssessment({
        probability,
        stage_name: deal.stage_name,
        record_type: deal.record_type,
        expected_close_date: commercialFields.expected_close_date,
      }, today);
      const baseDeal = {
        ...deal,
        ...closing,
        is_prospect: deal.record_type === 'prospect' || /prospect/i.test(String(deal.stage_name || '')),
        last_contact_at: lastContact,
        days_since_contact: lastContact ? Math.max(0, Math.floor((Date.now() - new Date(lastContact).getTime()) / 86400000)) : null,
        has_quote: metrics.has_quote,
        currency_code: metrics.currency_code,
        sales_amount: metrics.sales,
        profit_amount: metrics.profit,
        quoted_on: quotedOn,
        offer_validity_text: validityText,
        offer_expires_on: expiry?.expires_on || null,
        offer_days_remaining: expiry?.days_remaining ?? null,
        age_days: ageDays,
        next_activity_at: nextActivity,
        pending_activities: Number(deal.pending_activities || 0) + Number(deal.pending_tasks || 0),
        overdue_activities: Number(deal.overdue_activities || 0) + Number(deal.overdue_tasks || 0),
        days_until_next_activity: daysUntil(nextActivity),
        quote_age_days: quoteAgeDays,
        quote_followup_due: metrics.has_quote && quoteAgeDays != null && quoteAgeDays >= 7 && (!nextActivity || new Date(nextActivity) < new Date()),
        is_stuck: ageDays != null && ageDays > stuckLimit,
      };
      return {
        ...baseDeal,
        next_action: buildNextAction(baseDeal),
      };
    });

    let agenda = [];
    let agendaHasMore = false;
    if (dealIds.length) {
      const [[activities], [tasks]] = await Promise.all([
        pool.query(
          `SELECT id, deal_id, subject AS title, type,
                  DATE_FORMAT(due_date, '%Y-%m-%d') AS due_day,
                  DATE_FORMAT(due_date, '%Y-%m-%d %H:%i') AS due_at
             FROM activities
            WHERE deal_id IN (?) AND done = 0 AND due_date IS NOT NULL AND DATE(due_date) <= ?
            ORDER BY due_date DESC LIMIT 100`,
          [dealIds, today]
        ),
        pool.query(
          `SELECT id, deal_id, title, 'task' AS type,
                  DATE_FORMAT(due_at, '%Y-%m-%d') AS due_day,
                  DATE_FORMAT(due_at, '%Y-%m-%d %H:%i') AS due_at
             FROM followup_tasks
            WHERE deal_id IN (?) AND status = 'pending' AND due_at IS NOT NULL AND DATE(due_at) <= ?
            ORDER BY due_at DESC LIMIT 100`,
          [dealIds, today]
        ),
      ]);
      const dealById = new Map(enriched.map((deal) => [Number(deal.id), deal]));
      agenda = [...activities, ...tasks].map((entry) => {
        const deal = dealById.get(Number(entry.deal_id));
        return {
          ...entry,
          id: `${entry.type === 'task' ? 'task' : 'activity'}-${entry.id}`,
          reference: deal?.reference || `#${entry.deal_id}`,
          org_name: deal?.org_name || 'Sin cliente',
          overdue: entry.due_day < today,
        };
      }).sort((a, b) => Number(a.overdue) - Number(b.overdue) || String(b.due_at).localeCompare(String(a.due_at)));
      agendaHasMore = activities.length === 100 || tasks.length === 100 || agenda.length > 50;
      agenda = agenda.slice(0, 50);
    }

    const byStageMap = new Map();
    const summary = {
      open_deals: enriched.length,
      pipeline_value_by_currency: {},
      estimated_profit_by_currency: {},
      quoted_deals: 0,
      unquoted_deals: 0,
      overdue_activities: 0,
      pending_activities: 0,
      stuck_deals: 0,
      closing_soon_count: 0,
      missing_next_activity: 0,
      high_priority_actions: 0,
      new_prospects: 0,
      quote_followups: 0,
      expiring_quotes: 0,
    };
    const journey = [
      { key: 'prospect', label: 'Prospecto', count: 0 },
      { key: 'followup', label: 'En seguimiento', count: 0 },
      { key: 'to_quote', label: 'A cotizar', count: 0 },
      { key: 'quoted', label: 'Cotizada', count: 0 },
      { key: 'closing', label: 'Por cerrar', count: 0 },
    ];

    const addCurrencyAmount = (bucket, currencyCode, amount) => {
      const currency = normalizeCurrency(currencyCode, '');
      if (!currency) return;
      bucket[currency] = num(bucket[currency]) + num(amount);
    };

    for (const deal of enriched) {
      const journeyKey = commercialJourneyKey(deal);
      journey.find((item) => item.key === journeyKey).count += 1;
      addCurrencyAmount(summary.pipeline_value_by_currency, deal.currency_code, deal.sales_amount);
      addCurrencyAmount(summary.estimated_profit_by_currency, deal.currency_code, deal.profit_amount);
      summary.quoted_deals += deal.has_quote ? 1 : 0;
      summary.unquoted_deals += deal.has_quote ? 0 : 1;
      summary.overdue_activities += Number(deal.overdue_activities || 0);
      summary.pending_activities += Number(deal.pending_activities || 0);
      summary.stuck_deals += deal.is_stuck ? 1 : 0;
      summary.closing_soon_count += deal.is_closing_soon ? 1 : 0;
      summary.missing_next_activity += deal.next_activity_at ? 0 : 1;
      summary.high_priority_actions += deal.next_action?.priority === 'alta' ? 1 : 0;
      summary.new_prospects += deal.is_prospect && !deal.last_contact_at ? 1 : 0;
      summary.quote_followups += deal.quote_followup_due ? 1 : 0;
      summary.expiring_quotes += deal.offer_days_remaining != null && deal.offer_days_remaining <= 3 ? 1 : 0;

      const key = String(deal.stage_id || 'sin');
      const current = byStageMap.get(key) || {
        stage_id: deal.stage_id,
        stage_name: deal.stage_name || 'Sin etapa',
        count: 0,
        value_by_currency: {},
        profit_by_currency: {},
      };
      current.count += 1;
      addCurrencyAmount(current.value_by_currency, deal.currency_code, deal.sales_amount);
      addCurrencyAmount(current.profit_by_currency, deal.currency_code, deal.profit_amount);
      byStageMap.set(key, current);
    }

    const actionPriority = { alta: 0, media: 1, normal: 2 };
    const nextActions = [...enriched]
      .sort((a, b) => {
        const pa = actionPriority[a.next_action?.priority] ?? 9;
        const pb = actionPriority[b.next_action?.priority] ?? 9;
        if (pa !== pb) return pa - pb;
        return num(b.profit_amount || b.sales_amount || b.value) - num(a.profit_amount || a.sales_amount || a.value);
      });

    const followupAlerts = {
      no_quote: enriched.filter((d) => !d.has_quote).slice(0, 12),
      no_next_activity: enriched.filter((d) => !d.next_activity_at).slice(0, 12),
      overdue_activity: enriched.filter((d) => Number(d.overdue_activities || 0) > 0).slice(0, 12),
      stale_quoted: enriched
        .filter((d) => d.has_quote && d.age_days != null && d.age_days >= 7 && !d.is_closing_soon)
        .slice(0, 12),
    };

    const selectedUser = selectedUserId
      ? {
          id: selectedUserId,
          name: enriched.find((d) => Number(d.advisor_user_id) === Number(selectedUserId))?.advisor_name || null,
        }
      : null;

    res.json({
      selected_user: selectedUser,
      summary,
      by_stage: Array.from(byStageMap.values()),
      journey,
      agenda,
      agenda_has_more: agendaHasMore,
      next_actions: nextActions,
      expiring_quotes: enriched.filter((d) => d.offer_days_remaining != null && d.offer_days_remaining <= 3),
      prospects: enriched.filter((d) => d.is_prospect && !d.last_contact_at),
      quote_followups: enriched.filter((d) => d.quote_followup_due),
      followup_alerts: followupAlerts,
      closing_soon: enriched.filter((d) => d.is_closing_soon)
        .sort((a, b) => (a.closing_days_remaining ?? Infinity) - (b.closing_days_remaining ?? Infinity) || Number(a.id) - Number(b.id)),
      stuck: enriched.filter((d) => d.is_stuck).slice(0, 12),
      top_deals: [...enriched]
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .slice(0, 12),
    });
  } catch (e) {
    console.error('[commercial-dashboard] error:', e?.message || e);
    res.status(500).json({ error: 'No se pudo cargar dashboard comercial' });
  }
});

export default router;
