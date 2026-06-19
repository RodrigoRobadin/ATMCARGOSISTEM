import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';

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

function summarizeQuoteComputed(computed = {}) {
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
    total_sales_usd: totalSales == null ? null : num(totalSales),
    profit_total_usd: profit == null ? null : num(profit),
  };
}

function toSheetNumber(value) {
  if (value === '' || value === null || value === undefined) return 0;
  const normalized = String(value).replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarizeCostSheetData(data = {}) {
  const totals = data?.totals || {};
  const profit = toSheetNumber(totals.profitGeneral ?? totals.profit_total_usd ?? totals.profit);
  const sales =
    toSheetNumber(totals.totalVentas ?? totals.total_sales_usd ?? totals.totalVenta) ||
    toSheetNumber(totals.totalVentaCliente);
  return {
    total_sales_usd: sales || null,
    profit_total_usd: profit || null,
  };
}

function pickDealMetrics(deal, quoteByDeal, costSheetByDeal) {
  const quote = quoteByDeal.get(Number(deal.id));
  const costSheet = costSheetByDeal.get(Number(deal.id));
  const source = quote || costSheet || {};
  return {
    has_quote: Boolean(deal.has_quote || quote || costSheet),
    sales: num(source.total_sales_usd ?? deal.value),
    profit: num(source.profit_total_usd),
  };
}

function daysUntil(value) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return Math.ceil((dt.getTime() - Date.now()) / 86400000);
}

function buildNextAction(deal) {
  if (!deal.has_quote) {
    return {
      key: 'cotizar',
      label: 'Cotizar',
      priority: 'alta',
      reason: 'Operacion abierta sin presupuesto',
    };
  }
  if (Number(deal.overdue_activities || 0) > 0) {
    return {
      key: 'resolver_vencidos',
      label: 'Resolver seguimiento vencido',
      priority: 'alta',
      reason: `${Number(deal.overdue_activities || 0)} actividad(es) vencida(s)`,
    };
  }
  if (deal.is_closing_soon) {
    return {
      key: 'cerrar',
      label: 'Cerrar venta',
      priority: 'alta',
      reason: 'Etapa de alta probabilidad',
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
             d.stage_id, d.advisor_user_id, du.name AS advisor_name,
             s.name AS stage_name, s.probability, s.stuck_days,
             COALESCE(da.total_activities, 0) AS total_activities,
             da.last_activity_at,
             da.next_activity_at,
             COALESCE(da.pending_count, 0) AS pending_activities,
             COALESCE(da.overdue_count, 0) AS overdue_activities,
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
                 MIN(CASE WHEN done = 0 AND due_date IS NOT NULL THEN due_date ELSE NULL END) AS next_activity_at,
                 SUM(CASE WHEN done = 0 THEN 1 ELSE 0 END) AS pending_count,
                 SUM(CASE WHEN done = 0 AND due_date IS NOT NULL AND due_date < CURDATE() THEN 1 ELSE 0 END) AS overdue_count
            FROM activities
           WHERE deal_id IS NOT NULL
           GROUP BY deal_id
        ) da ON da.deal_id = d.id
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

    if (dealIds.length) {
      const [quoteRows] = await pool.query(
        `SELECT deal_id, computed_json
           FROM quotes
          WHERE deal_id IN (?)`,
        [dealIds]
      ).catch(() => [[]]);
      for (const row of quoteRows || []) {
        quoteByDeal.set(Number(row.deal_id), summarizeQuoteComputed(safeJson(row.computed_json, {}) || {}));
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
    }

    const enriched = (deals || []).map((deal) => {
      const metrics = pickDealMetrics(deal, quoteByDeal, costSheetByDeal);
      const lastActivity = deal.last_activity_at || deal.created_at;
      const ageDays = lastActivity ? Math.floor((Date.now() - new Date(lastActivity).getTime()) / 86400000) : null;
      const stuckLimit = Number(deal.stuck_days || 0) || 15;
      const probability = Number(deal.probability || 0);
      const baseDeal = {
        ...deal,
        has_quote: metrics.has_quote,
        sales_amount: metrics.sales,
        profit_amount: metrics.profit,
        age_days: ageDays,
        days_until_next_activity: daysUntil(deal.next_activity_at),
        is_stuck: ageDays != null && ageDays > stuckLimit,
        is_closing_soon:
          probability >= 70 ||
          /(cotiz|confirm|cerr|negoci)/i.test(String(deal.stage_name || '')),
      };
      return {
        ...baseDeal,
        next_action: buildNextAction(baseDeal),
      };
    });

    const byStageMap = new Map();
    const summary = {
      open_deals: enriched.length,
      pipeline_value: 0,
      estimated_profit: 0,
      quoted_deals: 0,
      unquoted_deals: 0,
      overdue_activities: 0,
      pending_activities: 0,
      stuck_deals: 0,
      closing_soon_count: 0,
      missing_next_activity: 0,
      high_priority_actions: 0,
    };

    for (const deal of enriched) {
      summary.pipeline_value += num(deal.sales_amount || deal.value);
      summary.estimated_profit += num(deal.profit_amount);
      summary.quoted_deals += deal.has_quote ? 1 : 0;
      summary.unquoted_deals += deal.has_quote ? 0 : 1;
      summary.overdue_activities += Number(deal.overdue_activities || 0);
      summary.pending_activities += Number(deal.pending_activities || 0);
      summary.stuck_deals += deal.is_stuck ? 1 : 0;
      summary.closing_soon_count += deal.is_closing_soon ? 1 : 0;
      summary.missing_next_activity += deal.next_activity_at ? 0 : 1;
      summary.high_priority_actions += deal.next_action?.priority === 'alta' ? 1 : 0;

      const key = String(deal.stage_id || 'sin');
      const current = byStageMap.get(key) || {
        stage_id: deal.stage_id,
        stage_name: deal.stage_name || 'Sin etapa',
        count: 0,
        value: 0,
        profit: 0,
      };
      current.count += 1;
      current.value += num(deal.sales_amount || deal.value);
      current.profit += num(deal.profit_amount);
      byStageMap.set(key, current);
    }

    const actionPriority = { alta: 0, media: 1, normal: 2 };
    const nextActions = [...enriched]
      .sort((a, b) => {
        const pa = actionPriority[a.next_action?.priority] ?? 9;
        const pb = actionPriority[b.next_action?.priority] ?? 9;
        if (pa !== pb) return pa - pb;
        return num(b.profit_amount || b.sales_amount || b.value) - num(a.profit_amount || a.sales_amount || a.value);
      })
      .slice(0, 15);

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
      next_actions: nextActions,
      followup_alerts: followupAlerts,
      closing_soon: enriched.filter((d) => d.is_closing_soon).slice(0, 12),
      stuck: enriched.filter((d) => d.is_stuck).slice(0, 12),
      top_deals: [...enriched]
        .sort((a, b) => num(b.profit_amount || b.sales_amount || b.value) - num(a.profit_amount || a.sales_amount || a.value))
        .slice(0, 12),
    });
  } catch (e) {
    console.error('[commercial-dashboard] error:', e?.message || e);
    res.status(500).json({ error: 'No se pudo cargar dashboard comercial' });
  }
});

export default router;
