import { randomUUID } from 'crypto';
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middlewares/auth.js';
import { logAudit } from '../services/audit.js';
import { getAssistantConfig } from '../services/assistantConfig.js';

const router = Router();

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const MAX_TOOL_ROUNDS = 6;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 12;
const RATE_LIMIT_MAX_IN_FLIGHT = 2;
const PENDING_ACTION_TTL_MS = 30 * 60 * 1000;
const assistantRateBuckets = new Map();
const assistantInFlight = new Map();
const assistantPendingActions = new Map();
const LATEST_DEAL_QUOTE_JOIN = `
      LEFT JOIN quotes q ON q.id = (
        SELECT q2.id
        FROM quotes q2
        WHERE q2.deal_id = d.id
        ORDER BY q2.updated_at DESC, q2.id DESC
        LIMIT 1
      )
`;
const DEAL_QUOTE_SALE_VALUE_SQL =
  "CAST(JSON_UNQUOTE(JSON_EXTRACT(q.computed_json, '$.oferta.totals.total_sales_usd')) AS DECIMAL(15,2))";
const NORMALIZED_DEAL_REFERENCE_SQL =
  "REPLACE(REPLACE(REPLACE(REPLACE(UPPER(COALESCE(d.reference, '')), 'OP', ''), '-', ''), ' ', ''), '/', '')";

function getAssistantAccess(req) {
  const role = String(req?.user?.role || '').toLowerCase();
  const isService = role === 'service';

  return {
    role: role || 'unknown',
    canViewOperations: true,
    canViewOrganizations: true,
    canViewContacts: true,
    canViewService: role === 'admin' || isService,
    canViewFollowup: !isService,
  };
}

function toolPermissionError(tool, access) {
  return {
    error: 'permission_denied',
    tool,
    role: access.role,
    message: 'Tu rol no tiene permiso para consultar esta informacion desde el asistente.',
  };
}

function canUseTool(name, access) {
  if (name === 'get_service_cases_summary') return access.canViewService;
  if (name === 'get_followup_summary') return access.canViewFollowup;
  return true;
}

function buildAssistantInstructions(access) {
  const nowInAsuncion = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Asuncion',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date()).replace(',', '');
  const allowed = [
    access.canViewOperations ? 'operaciones' : null,
    access.canViewOrganizations ? 'organizaciones' : null,
    access.canViewContacts ? 'contactos' : null,
    access.canViewService ? 'servicio y mantenimiento' : null,
    access.canViewFollowup ? 'seguimiento' : null,
  ].filter(Boolean);

  return [
    ASSISTANT_INSTRUCTIONS,
    `La fecha y hora actual en America/Asuncion es ${nowInAsuncion}.`,
    `El rol del usuario autenticado es "${access.role}".`,
    `Solo puedes responder con informacion de estos modulos permitidos: ${allowed.join(', ') || 'ninguno'}.`,
    'Si una consulta pide un modulo no permitido, responde que no tiene permiso y no inventes datos.',
  ].join(' ');
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function safeJsonParse(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function cleanText(value, maxLen = 4000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function parseOptionalBoolean(value) {
  if (typeof value === 'boolean') return value;
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  if (['true', '1', 'si', 'sí', 'yes'].includes(text)) return true;
  if (['false', '0', 'no'].includes(text)) return false;
  return null;
}

function normalizeDateTimeInput(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const normalized = text.replace('T', ' ').replace(/\.\d+$/, '');
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?$/);
  if (!match) return null;
  return `${match[1]} ${match[2]}`;
}

function getCurrentAsuncionParts() {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Asuncion',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date()).map((part) => [part.type, part.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: String(parts.weekday || '').toLowerCase(),
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
  };
}

function addDaysToParts(parts, days) {
  const base = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  base.setUTCDate(base.getUTCDate() + days);
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  };
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDateTimeParts(dateParts, hour, minute) {
  return `${dateParts.year}-${pad2(dateParts.month)}-${pad2(dateParts.day)} ${pad2(hour)}:${pad2(minute)}`;
}

function parseAssistantTime(text) {
  const normalized = String(text || '').toLowerCase();
  const match = normalized.match(/(?:a\s+las\s+|a\s+la\s+|alas\s+|)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = String(match[3] || '').toLowerCase();
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  return { hour, minute };
}

function parseNaturalAssistantDateTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const text = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const direct = normalizeDateTimeInput(raw);
  if (direct) return direct;

  const dateOnlyIso = text.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dateOnlyIso) return `${dateOnlyIso[1]} 09:00`;

  const dateOnlySlash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dateOnlySlash) {
    const [, dd, mm, yyyy] = dateOnlySlash;
    return `${yyyy}-${pad2(mm)}-${pad2(dd)} 09:00`;
  }

  const now = getCurrentAsuncionParts();
  const time = parseAssistantTime(text) || { hour: 9, minute: 0 };
  const weekdayMap = {
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    sunday: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
    domingo: 0,
  };
  const currentWeekday = weekdayMap[now.weekday] ?? new Date(Date.UTC(now.year, now.month - 1, now.day)).getUTCDay();

  if (/\bpasado manana\b/.test(text)) {
    return formatDateTimeParts(addDaysToParts(now, 2), time.hour, time.minute);
  }
  if (/\bmanana\b/.test(text)) {
    return formatDateTimeParts(addDaysToParts(now, 1), time.hour, time.minute);
  }
  if (/\bhoy\b/.test(text)) {
    return formatDateTimeParts(now, time.hour, time.minute);
  }

  for (const [name, weekday] of Object.entries(weekdayMap)) {
    if (!text.includes(name)) continue;
    let delta = (weekday - currentWeekday + 7) % 7;
    if (delta === 0) delta = 7;
    return formatDateTimeParts(addDaysToParts(now, delta), time.hour, time.minute);
  }

  return null;
}

function formatAssistantActionDueAt(value) {
  const normalized = parseNaturalAssistantDateTime(value);
  if (!normalized) return null;
  return normalized;
}

function prunePendingAssistantActions(now = Date.now()) {
  for (const [id, action] of assistantPendingActions.entries()) {
    if (!action || action.expiresAt <= now) assistantPendingActions.delete(id);
  }
}

function getPendingActionOwner(req) {
  return String(req?.user?.id || getRequesterKey(req));
}

function buildPendingFollowupSummary(operation, entryType, payload) {
  const typeLabels = {
    note: 'nota',
    activity: 'actividad',
    reminder: 'recordatorio',
    task: 'tarea',
  };
  const dueText = payload.due_at ? ` para ${payload.due_at}` : '';
  const titleText = payload.title ? `: ${payload.title}` : '';
  return `Crear ${typeLabels[entryType] || 'seguimiento'} en ${operation.reference || `operacion ${operation.id}`}${titleText}${dueText}.`;
}

function normalizeOperationReferenceCandidates(value) {
  const raw = cleanText(value, 80).toUpperCase();
  if (!raw) {
    return {
      raw: '',
      digits: '',
      formatted: '',
      likeRaw: '',
      likeFormatted: '',
    };
  }

  const digits = (raw.match(/\d+/g) || []).join('');
  const formatted = digits ? `OP-${digits.padStart(6, '0')}` : '';
  const normalizedRaw = raw.replace(/[^A-Z0-9]/g, '').replace(/^OP/, '');

  return {
    raw,
    digits,
    formatted,
    normalizedRaw,
    likeRaw: `%${raw}%`,
    likeFormatted: formatted ? `%${formatted}%` : '',
  };
}

function extractOperationReferenceHint(text) {
  const raw = cleanText(text, 200).toUpperCase();
  if (!raw) return null;

  const opMatch = raw.match(/\bOP[\s-]*(\d{1,6})\b/);
  if (opMatch?.[1]) {
    const digits = opMatch[1];
    return `OP-${digits.padStart(6, '0')}`;
  }

  const numericMatches = raw.match(/\b\d{3,6}\b/g) || [];
  const candidates = numericMatches.filter((value) => {
    if (value.length === 4) {
      const year = Number(value);
      if (year >= 1900 && year <= 2100) return false;
    }
    return true;
  });
  if (!candidates.length) return null;

  const digits = candidates[0];
  return `OP-${digits.padStart(6, '0')}`;
}

function shouldAutoResolveOperationMessage(message, normalizedReference) {
  const text = cleanText(message, 240).toLowerCase();
  if (!normalizedReference) return false;
  if (/^\s*op[\s-]*\d{1,6}\s*$/i.test(message) || /^\s*\d{3,6}\s*$/.test(message)) return true;
  return /(busca|buscar|ver|mostra|mostrar|resumen|detalle|seguimiento|cotiza|cotizacion|estado|operacion)/i.test(text);
}

function buildOperationSummaryAnswer(result) {
  const op = result?.operation;
  if (!op) return '';
  const lines = [
    `Operacion ${op.reference || `#${op.id}`}`,
    `Estado: ${op.status || '-'}`,
    `Cliente: ${op.org_name || '-'}`,
    `Contacto: ${op.contact_name || '-'}`,
    `Unidad: ${op.business_unit_name || op.business_unit_slug || '-'}`,
    `Cotizacion: ${Number(op.has_quote || 0) ? 'si' : 'no'}`,
  ];
  if (op.operation_sale_value_usd !== null && op.operation_sale_value_usd !== undefined) {
    lines.push(`Valor de venta USD: ${op.operation_sale_value_usd}`);
  }
  if (result?.followup) {
    lines.push(
      `Seguimiento pendiente: ${Number(result.followup.pending_followup_tasks || 0)} tarea(s), ${Number(result.followup.overdue_followup_tasks || 0)} vencida(s)`
    );
  }
  return lines.join('\n');
}

function buildResolvedOperationInstruction(result) {
  const op = result?.operation;
  if (!op) return '';
  return [
    `La referencia pedida ya fue resuelta en backend: ${op.reference || `operacion ${op.id}`}.`,
    `ID interno: ${op.id}.`,
    `Estado: ${op.status || '-'}.`,
    `Cliente: ${op.org_name || '-'}.`,
    `Contacto: ${op.contact_name || '-'}.`,
    `Tiene cotizacion: ${Number(op.has_quote || 0) ? 'si' : 'no'}.`,
    `Valor de venta USD: ${op.operation_sale_value_usd ?? 0}.`,
    `Tareas pendientes: ${Number(result?.followup?.pending_followup_tasks || 0)}.`,
  ].join(' ');
}

function detectOperationIntent(message) {
  const text = cleanText(message, 240).toLowerCase();
  if (!text) return null;

  if (/(seguimiento|tarea|tareas|actividad|actividades|recordatorio|recordatorios|nota|notas)/i.test(text)) {
    return 'followup';
  }
  if (/(cotiza|cotizacion|cotización|presupuesto|valor|venta|monto|quote)/i.test(text)) {
    return 'quote';
  }
  if (/(estado|resumen|detalle|ver|mostrar|mostrame|mu[eé]strame|decime|decir|como esta|cómo está|que tiene|qué tiene)/i.test(text)) {
    return 'summary';
  }
  if (/^\s*(op[\s-]*\d{1,6}|\d{3,6})\s*$/i.test(message)) {
    return 'summary';
  }
  return null;
}

function detectFollowupActionIntent(message) {
  const text = cleanText(message, 260).toLowerCase();
  if (!text) return null;

  const wantsCreate = /(crea|crear|creame|créame|agrega|agregar|anota|anotar|recorda|recordame|recordar|genera|genera una|carga|cargar)/i.test(text);
  if (!wantsCreate) return null;

  if (/(tarea|seguimiento pendiente)/i.test(text)) return 'task';
  if (/(recordatorio|recordame|recordar)/i.test(text)) return 'reminder';
  if (/(nota|anota|comentario)/i.test(text)) return 'note';
  if (/(actividad|registrar actividad)/i.test(text)) return 'activity';
  return 'activity';
}

function buildFollowupActionInstruction(entryType, resolvedOperation) {
  const typeLabel = {
    task: 'tarea',
    reminder: 'recordatorio',
    note: 'nota',
    activity: 'actividad',
  }[entryType] || 'seguimiento';

  const operationText = resolvedOperation?.operation?.reference || resolvedOperation?.reference || 'la operacion detectada';
  return [
    `La consulta parece pedir crear una ${typeLabel} en ${operationText}.`,
    'Si ya tienes datos suficientes, usa prepare_operation_followup_action.',
    'Si faltan datos obligatorios, pide solo la aclaracion minima necesaria.',
    'Para task el titulo y due_at son obligatorios.',
    'Para reminder due_at es obligatorio.',
    'Para note content es obligatorio.',
  ].join(' ');
}

function extractFollowupActionDraft(message, entryType) {
  const raw = String(message || '').trim();
  const quoted = raw.match(/"([^"]+)"/)?.[1]?.trim() || raw.match(/'([^']+)'/)?.[1]?.trim() || '';
  const afterQueDiga = raw.match(/que diga\s+(.+)$/i)?.[1]?.trim() || raw.match(/que diga:\s*(.+)$/i)?.[1]?.trim() || '';
  const simplified = (quoted || afterQueDiga || '')
    .replace(/^["']|["']$/g, '')
    .trim();

  if (entryType === 'task') {
    const taskTitle =
      simplified ||
      raw
        .replace(/.*\b(tarea|seguimiento pendiente)\b/gi, '')
        .replace(/.*\boperacion\b\s*\d+/gi, '')
        .replace(/.*\bop[\s-]*\d+/gi, '')
        .replace(/^(que diga|para|que)\s+/i, '')
        .trim();
    return {
      title: cleanText(taskTitle, 180) || null,
      content: null,
      due_at: null,
    };
  }

  if (entryType === 'note') {
    return {
      title: null,
      content: cleanText(simplified || raw, 2000) || null,
      due_at: null,
    };
  }

  if (entryType === 'reminder') {
    return {
      title: cleanText(simplified, 180) || null,
      content: cleanText(simplified, 2000) || null,
      due_at: null,
    };
  }

  return {
    title: cleanText(simplified, 180) || null,
    content: cleanText(simplified, 2000) || null,
    due_at: null,
  };
}

function normalizeEntityText(value) {
  return cleanText(value, 200)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function detectCrmEntityType(message) {
  const text = cleanText(message, 240).toLowerCase();
  if (!text) return null;
  if (/(servicio|mantenimiento|caso|ticket|orden de servicio|os[-\s]*\d+)/i.test(text)) return 'service_case';
  if (/(contacto|persona|email|correo|telefono|tel[eé]fono|celular)/i.test(text)) return 'contact';
  if (/(cliente|empresa|organizacion|organización|ruc)/i.test(text)) return 'organization';
  return null;
}

function extractCrmEntityLookupText(message) {
  const raw = cleanText(message, 240);
  if (!raw) return '';
  return raw
    .replace(/\b(op[\s-]*\d{1,6}|\d{3,6})\b/gi, ' ')
    .replace(/\b(busca|buscar|buscame|búscame|dame|dam[eé]|decime|mostrar|mostrame|mu[eé]strame|ver|resumen|detalle|estado|de|del|la|el|los|las|un|una|por|favor|cliente|empresa|organizacion|organización|contacto|persona|correo|email|telefono|tel[eé]fono|servicio|mantenimiento|caso|ticket|orden)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isStrongOrganizationMatch(result, lookup) {
  const item = Array.isArray(result) ? (result.length === 1 ? result[0] : null) : result;
  if (!item) return false;
  const normalizedLookup = normalizeEntityText(lookup);
  if (!normalizedLookup || normalizedLookup.length < 3) return false;
  const fields = [item.name, item.razon_social, item.ruc].map(normalizeEntityText);
  return fields.some((value) => value && (value === normalizedLookup || value.includes(normalizedLookup)));
}

function isStrongContactMatch(result, lookup) {
  const item = Array.isArray(result) ? (result.length === 1 ? result[0] : null) : result;
  if (!item) return false;
  const normalizedLookup = normalizeEntityText(lookup);
  if (!normalizedLookup || normalizedLookup.length < 3) return false;
  const fields = [item.name, item.email, item.phone, item.org_name].map(normalizeEntityText);
  return fields.some((value) => value && (value === normalizedLookup || value.includes(normalizedLookup)));
}

function buildOrganizationSummaryAnswer(result) {
  const org = result?.organization;
  if (!org) return '';
  const ops = result?.summaries?.operations || {};
  const contacts = result?.summaries?.contacts || {};
  const service = result?.summaries?.service_cases || {};
  return [
    `Cliente ${org.name || org.razon_social || `#${org.id}`}`,
    `RUC: ${org.ruc || '-'}`,
    `Operaciones abiertas: ${Number(ops.open_operations || 0)}`,
    `Valor abierto USD: ${Number(ops.open_operations_sale_value_usd || 0)}`,
    `Contactos: ${Number(contacts.total_contacts || 0)}`,
    `Servicios abiertos: ${Number(service.open_service_cases || 0)}`,
  ].join('\n');
}

function buildContactSummaryAnswer(result) {
  const contact = result?.contact;
  if (!contact) return '';
  const summary = result?.summary || {};
  return [
    `Contacto ${contact.name || `#${contact.id}`}`,
    `Cliente: ${contact.org_name || '-'}`,
    `Email: ${contact.email || '-'}`,
    `Telefono: ${contact.phone || '-'}`,
    `Operaciones recientes: ${Number(summary.total_operations || 0)}`,
    `Actividades recientes: ${Number(summary.total_activities || 0)}`,
  ].join('\n');
}

function extractServiceReferenceHint(text) {
  const raw = cleanText(text, 200).toUpperCase();
  if (!raw) return null;
  const refMatch = raw.match(/\b([A-Z]{1,4})[\s-]*(\d{2,8})\b/);
  if (!refMatch) return null;
  const prefix = refMatch[1];
  if (prefix === 'OP') return null;
  return `${prefix}-${refMatch[2].padStart(6, '0')}`;
}

async function resolveServiceCase(args) {
  const serviceCaseId = Number(args?.service_case_id || 0);
  const query = cleanText(args?.query, 120);
  const reference = cleanText(args?.reference, 80);

  if (serviceCaseId > 0) {
    const [[row]] = await pool.query(
      `
        SELECT sc.id, sc.reference, sc.status, sc.scheduled_date, sc.created_at, o.name AS org_name
        FROM service_cases sc
        LEFT JOIN organizations o ON o.id = sc.org_id
        WHERE sc.id = ?
        LIMIT 1
      `,
      [serviceCaseId]
    );
    return row || null;
  }

  const lookup = reference || query;
  if (!lookup) return null;
  const ref = extractServiceReferenceHint(lookup) || lookup.toUpperCase();

  const [matches] = await pool.query(
    `
      SELECT
        sc.id,
        sc.reference,
        sc.status,
        sc.scheduled_date,
        sc.created_at,
        o.name AS org_name
      FROM service_cases sc
      LEFT JOIN organizations o ON o.id = sc.org_id
      WHERE
        sc.reference LIKE ?
        OR UPPER(sc.reference) = ?
        OR o.name LIKE ?
        OR sc.status LIKE ?
      ORDER BY
        CASE
          WHEN UPPER(sc.reference) = ? THEN 0
          WHEN sc.reference LIKE ? THEN 1
          ELSE 2
        END,
        sc.id DESC
      LIMIT 5
    `,
    [`%${lookup}%`, ref, `%${lookup}%`, `%${lookup}%`, ref, `%${lookup}%`]
  );

  if (matches.length === 1) return matches[0];
  return matches;
}

async function getServiceCaseSummary(args) {
  const resolved = await resolveServiceCase(args);
  if (!resolved) return { error: 'service_case_no_encontrado' };
  if (Array.isArray(resolved)) {
    return {
      status: 'ambiguous',
      matches: resolved.map((row) => ({
        id: row.id,
        reference: row.reference,
        status: row.status,
        org_name: row.org_name,
      })),
    };
  }

  return { service_case: resolved };
}

function isStrongServiceCaseMatch(result, lookup) {
  const item = result?.service_case;
  if (!item) return false;
  const normalizedLookup = normalizeEntityText(lookup);
  if (!normalizedLookup || normalizedLookup.length < 2) return false;
  const fields = [item.reference, item.org_name, item.status].map(normalizeEntityText);
  return fields.some((value) => value && (value === normalizedLookup || value.includes(normalizedLookup)));
}

function buildServiceCaseSummaryAnswer(result) {
  const item = result?.service_case;
  if (!item) return '';
  return [
    `Caso de servicio ${item.reference || `#${item.id}`}`,
    `Estado: ${item.status || '-'}`,
    `Cliente: ${item.org_name || '-'}`,
    `Programado: ${item.scheduled_date || '-'}`,
  ].join('\n');
}

function buildOperationIntentAnswer(result, intent) {
  const op = result?.operation;
  if (!op) return '';

  if (intent === 'followup') {
    const lines = [
      `Seguimiento de ${op.reference || `operacion ${op.id}`}`,
      `Estado: ${op.status || '-'}`,
      `Pendientes: ${Number(result?.followup?.pending_followup_tasks || 0)}`,
      `Vencidas: ${Number(result?.followup?.overdue_followup_tasks || 0)}`,
    ];
    if (Array.isArray(result?.recent_activities) && result.recent_activities.length > 0) {
      lines.push('Actividades recientes:');
      result.recent_activities.slice(0, 3).forEach((row) => {
        lines.push(`- ${row.subject || row.type || 'Actividad'}${row.due_date ? ` (${row.due_date})` : ''}`);
      });
    }
    return lines.join('\n');
  }

  if (intent === 'quote') {
    return [
      `Cotizacion de ${op.reference || `operacion ${op.id}`}`,
      `Estado: ${op.status || '-'}`,
      `Cliente: ${op.org_name || '-'}`,
      `Cotizacion cargada: ${Number(op.has_quote || 0) ? 'si' : 'no'}`,
      `Valor de venta USD: ${op.operation_sale_value_usd ?? 0}`,
    ].join('\n');
  }

  return buildOperationSummaryAnswer(result);
}

function getRequesterKey(req) {
  const userId = req?.user?.id;
  if (userId !== null && userId !== undefined && userId !== '') {
    return `user:${userId}`;
  }
  const ip = (req?.ip || req?.headers?.['x-forwarded-for'] || 'unknown').toString().slice(0, 80);
  return `ip:${ip}`;
}

function pruneAssistantRateBuckets(now = Date.now()) {
  for (const [key, bucket] of assistantRateBuckets.entries()) {
    if (!bucket || bucket.resetAt < now - RATE_LIMIT_WINDOW_MS) {
      assistantRateBuckets.delete(key);
    }
  }
}

function checkAssistantRateLimit(req) {
  const now = Date.now();
  const key = getRequesterKey(req);
  const active = assistantInFlight.get(key) || 0;

  if (active >= RATE_LIMIT_MAX_IN_FLIGHT) {
    return {
      ok: false,
      key,
      status: 429,
      retryAfterSeconds: 5,
      message: 'Ya hay consultas del asistente en proceso. Espera unos segundos antes de enviar otra.',
    };
  }

  let bucket = assistantRateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = {
      count: 0,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    };
  }

  if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      ok: false,
      key,
      status: 429,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      message: 'Se alcanzo el limite de consultas del asistente. Intenta nuevamente en unos segundos.',
    };
  }

  bucket.count += 1;
  assistantRateBuckets.set(key, bucket);

  if (assistantRateBuckets.size > 500) {
    pruneAssistantRateBuckets(now);
  }

  return {
    ok: true,
    key,
    remaining: Math.max(0, RATE_LIMIT_MAX_REQUESTS - bucket.count),
    resetAt: bucket.resetAt,
  };
}

function incrementAssistantInFlight(key) {
  assistantInFlight.set(key, (assistantInFlight.get(key) || 0) + 1);
}

function decrementAssistantInFlight(key) {
  const next = Math.max(0, (assistantInFlight.get(key) || 0) - 1);
  if (next === 0) assistantInFlight.delete(key);
  else assistantInFlight.set(key, next);
}

function extractResponseText(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const chunks = [];
  for (const item of response?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join('\n').trim();
}

function getToolCalls(response) {
  return (response?.output || []).filter((item) => item?.type === 'function_call');
}

function buildBusinessUnitWhere(businessUnitSlug, params, alias = 'bu') {
  const slug = cleanText(businessUnitSlug, 80).toLowerCase();
  if (!slug) return '';
  params.push(slug);
  return ` AND LOWER(COALESCE(${alias}.key_slug, '')) = ? `;
}

async function searchCrmEntities(args, context = {}) {
  const access = context.access || { canViewService: false };
  const query = cleanText(args?.query, 120);
  const limit = clampInt(args?.limit, 5, 1, 10);
  if (!query) {
    return { error: 'query_requerido' };
  }

  const like = `%${query}%`;

  const [deals] = await pool.query(
    `
      SELECT
        d.id,
        d.reference,
        d.title,
        d.value AS deal_value,
        ${DEAL_QUOTE_SALE_VALUE_SQL} AS operation_sale_value_usd,
        d.status,
        o.name AS org_name,
        c.name AS contact_name,
        bu.name AS business_unit_name
      FROM deals d
      LEFT JOIN organizations o ON o.id = d.org_id
      LEFT JOIN contacts c ON c.id = d.contact_id
      LEFT JOIN business_units bu ON bu.id = d.business_unit_id
      ${LATEST_DEAL_QUOTE_JOIN}
      WHERE
        d.reference LIKE ?
        OR d.title LIKE ?
        OR o.name LIKE ?
        OR c.name LIKE ?
      ORDER BY d.id DESC
      LIMIT ?
    `,
    [like, like, like, like, limit]
  );

  const [organizations] = await pool.query(
    `
      SELECT id, name, razon_social, ruc, city, country
      FROM organizations
      WHERE name LIKE ? OR razon_social LIKE ? OR ruc LIKE ?
      ORDER BY id DESC
      LIMIT ?
    `,
    [like, like, like, limit]
  );

  const [contacts] = await pool.query(
    `
      SELECT c.id, c.name, c.email, c.phone, o.name AS org_name
      FROM contacts c
      LEFT JOIN organizations o ON o.id = c.org_id
      WHERE c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR o.name LIKE ?
      ORDER BY c.id DESC
      LIMIT ?
    `,
    [like, like, like, like, limit]
  );

  let services = [];
  if (access.canViewService) {
    [services] = await pool.query(
      `
        SELECT
          sc.id,
          sc.reference,
          sc.status,
          o.name AS org_name
        FROM service_cases sc
        LEFT JOIN organizations o ON o.id = sc.org_id
        WHERE sc.reference LIKE ? OR o.name LIKE ? OR sc.status LIKE ?
        ORDER BY sc.id DESC
        LIMIT ?
      `,
      [like, like, like, limit]
    );
  }

  return {
    query,
    deals,
    organizations,
    contacts,
    services,
    permission_scope: {
      service_visible: Boolean(access.canViewService),
    },
  };
}

async function getOpenOperationsSummary(args) {
  const limit = clampInt(args?.limit, 10, 1, 20);
  const params = [];
  const buWhere = buildBusinessUnitWhere(args?.business_unit_slug, params);

  const [[summary]] = await pool.query(
    `
      SELECT
        COUNT(*) AS total_open_operations,
        SUM(CASE WHEN q.id IS NOT NULL THEN 1 ELSE 0 END) AS operations_with_quote,
        SUM(CASE WHEN q.id IS NULL THEN 1 ELSE 0 END) AS operations_without_quote,
        COALESCE(SUM(COALESCE(${DEAL_QUOTE_SALE_VALUE_SQL}, 0)), 0) AS total_open_sales_value_usd,
        COALESCE(SUM(COALESCE(${DEAL_QUOTE_SALE_VALUE_SQL}, 0)), 0) AS total_open_value
      FROM deals d
      ${LATEST_DEAL_QUOTE_JOIN}
      LEFT JOIN business_units bu ON bu.id = d.business_unit_id
      WHERE LOWER(COALESCE(d.status, 'open')) = 'open'
      ${buWhere}
    `,
    params
  );

  const [items] = await pool.query(
    `
      SELECT
        d.id,
        d.reference,
        d.title,
        d.value AS deal_value,
        d.created_at,
        o.name AS org_name,
        c.name AS contact_name,
        bu.name AS business_unit_name,
        CASE WHEN q.id IS NOT NULL THEN 1 ELSE 0 END AS has_quote,
        ${DEAL_QUOTE_SALE_VALUE_SQL} AS quote_total_sales_usd,
        ${DEAL_QUOTE_SALE_VALUE_SQL} AS operation_sale_value_usd
      FROM deals d
      LEFT JOIN organizations o ON o.id = d.org_id
      LEFT JOIN contacts c ON c.id = d.contact_id
      ${LATEST_DEAL_QUOTE_JOIN}
      LEFT JOIN business_units bu ON bu.id = d.business_unit_id
      WHERE LOWER(COALESCE(d.status, 'open')) = 'open'
      ${buWhere}
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT ?
    `,
    [...params, limit]
  );

  return {
    filters: {
      business_unit_slug: cleanText(args?.business_unit_slug, 80) || null,
    },
    summary,
    items,
  };
}

async function listOperationsWithoutQuote(args) {
  const limit = clampInt(args?.limit, 10, 1, 20);
  const params = [];
  const buWhere = buildBusinessUnitWhere(args?.business_unit_slug, params);

  const [[summary]] = await pool.query(
    `
      SELECT COUNT(*) AS total
      FROM deals d
      ${LATEST_DEAL_QUOTE_JOIN}
      LEFT JOIN business_units bu ON bu.id = d.business_unit_id
      WHERE LOWER(COALESCE(d.status, 'open')) = 'open'
        AND q.id IS NULL
        ${buWhere}
    `,
    params
  );

  const [items] = await pool.query(
    `
      SELECT
        d.id,
        d.reference,
        d.title,
        d.value AS deal_value,
        d.created_at,
        o.name AS org_name,
        c.name AS contact_name,
        bu.name AS business_unit_name
      FROM deals d
      LEFT JOIN organizations o ON o.id = d.org_id
      LEFT JOIN contacts c ON c.id = d.contact_id
      ${LATEST_DEAL_QUOTE_JOIN}
      LEFT JOIN business_units bu ON bu.id = d.business_unit_id
      WHERE LOWER(COALESCE(d.status, 'open')) = 'open'
        AND q.id IS NULL
        ${buWhere}
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT ?
    `,
    [...params, limit]
  );

  return {
    filters: {
      business_unit_slug: cleanText(args?.business_unit_slug, 80) || null,
    },
    total: Number(summary?.total || 0),
    items,
  };
}

async function listOperationsWithQuoteDelay(args) {
  const limit = clampInt(args?.limit, 10, 1, 20);
  const minDelayDays = clampInt(args?.min_delay_days, 15, 1, 365);
  const params = [];
  const buWhere = buildBusinessUnitWhere(args?.business_unit_slug, params);
  const quoteDateExpr = `
    COALESCE(
      STR_TO_DATE(LEFT(cf.value, 10), '%Y-%m-%d'),
      STR_TO_DATE(LEFT(cf.value, 10), '%d/%m/%Y')
    )
  `;

  const [[summary]] = await pool.query(
    `
      SELECT COUNT(*) AS total
      FROM deals d
      INNER JOIN deal_custom_fields cf ON cf.deal_id = d.id AND cf.\`key\` = 'f_cotiz'
      LEFT JOIN business_units bu ON bu.id = d.business_unit_id
      WHERE LOWER(COALESCE(d.status, 'open')) = 'open'
        AND ${quoteDateExpr} IS NOT NULL
        ${buWhere}
        AND DATEDIFF(CURDATE(), ${quoteDateExpr}) >= ?
    `,
    [...params, minDelayDays]
  );

  const [items] = await pool.query(
    `
      SELECT
        d.id,
        d.reference,
        d.title,
        d.value AS deal_value,
        d.created_at,
        o.name AS org_name,
        bu.name AS business_unit_name,
        cf.value AS quote_date_raw,
        DATEDIFF(CURDATE(), ${quoteDateExpr}) AS quote_age_days,
        GREATEST(DATEDIFF(CURDATE(), ${quoteDateExpr}) - 15, 0) AS overdue_days,
        ${DEAL_QUOTE_SALE_VALUE_SQL} AS quote_total_sales_usd,
        ${DEAL_QUOTE_SALE_VALUE_SQL} AS operation_sale_value_usd
      FROM deals d
      INNER JOIN deal_custom_fields cf ON cf.deal_id = d.id AND cf.\`key\` = 'f_cotiz'
      ${LATEST_DEAL_QUOTE_JOIN}
      LEFT JOIN organizations o ON o.id = d.org_id
      LEFT JOIN business_units bu ON bu.id = d.business_unit_id
      WHERE LOWER(COALESCE(d.status, 'open')) = 'open'
        AND ${quoteDateExpr} IS NOT NULL
        ${buWhere}
        AND DATEDIFF(CURDATE(), ${quoteDateExpr}) >= ?
      ORDER BY overdue_days DESC, quote_age_days DESC, d.created_at ASC
      LIMIT ?
    `,
    [...params, minDelayDays, limit]
  );

  return {
    filters: {
      business_unit_slug: cleanText(args?.business_unit_slug, 80) || null,
      min_delay_days: minDelayDays,
    },
    total: Number(summary?.total || 0),
    items,
  };
}

async function searchOperationsAdvanced(args) {
  const limit = clampInt(args?.limit, 10, 1, 25);
  const generalQuery = cleanText(args?.query, 120);
  const orgQuery = cleanText(args?.org_query, 120);
  const contactQuery = cleanText(args?.contact_query, 120);
  const referenceQuery = cleanText(args?.reference_query, 120);
  const businessUnitSlug = cleanText(args?.business_unit_slug, 80).toLowerCase();
  const rawStatus = cleanText(args?.status, 40).toLowerCase();
  const status = rawStatus === 'all' ? '' : rawStatus;
  const hasQuote = parseOptionalBoolean(args?.has_quote);
  const hasAnyFilter = Boolean(
    generalQuery ||
      orgQuery ||
      contactQuery ||
      referenceQuery ||
      businessUnitSlug ||
      status ||
      hasQuote !== null ||
      args?.min_sale_value_usd !== undefined ||
      args?.max_sale_value_usd !== undefined ||
      args?.min_quote_delay_days !== undefined
  );

  if (!hasAnyFilter) {
    return {
      error: 'filtros_requeridos',
      message:
        'Para una busqueda avanzada de operaciones debes indicar al menos un filtro, por ejemplo query, cliente, referencia, estado o rango de valor.',
    };
  }

  const minSaleValue = Number(args?.min_sale_value_usd);
  const maxSaleValue = Number(args?.max_sale_value_usd);
  const minQuoteDelayDays =
    args?.min_quote_delay_days === undefined || args?.min_quote_delay_days === null || args?.min_quote_delay_days === ''
      ? null
      : clampInt(args?.min_quote_delay_days, 15, 1, 365);

  const quoteDateExpr = `
    COALESCE(
      STR_TO_DATE(LEFT(cf.value, 10), '%Y-%m-%d'),
      STR_TO_DATE(LEFT(cf.value, 10), '%d/%m/%Y')
    )
  `;

  const where = [];
  const params = [];

  if (generalQuery) {
    const like = `%${generalQuery}%`;
    where.push(`(d.reference LIKE ? OR d.title LIKE ? OR o.name LIKE ? OR c.name LIKE ? OR c.email LIKE ?)`); 
    params.push(like, like, like, like, like);
  }

  if (orgQuery) {
    const like = `%${orgQuery}%`;
    where.push(`(o.name LIKE ? OR o.razon_social LIKE ? OR o.ruc LIKE ?)`); 
    params.push(like, like, like);
  }

  if (contactQuery) {
    const like = `%${contactQuery}%`;
    where.push(`(c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)`); 
    params.push(like, like, like);
  }

  if (referenceQuery) {
    const ref = normalizeOperationReferenceCandidates(referenceQuery);
    where.push(`(
      d.reference LIKE ?
      OR UPPER(d.reference) = ?
      OR UPPER(d.reference) = ?
      OR (? <> '' AND ${NORMALIZED_DEAL_REFERENCE_SQL} = ?)
    )`);
    params.push(
      ref.likeRaw,
      ref.raw,
      ref.formatted || ref.raw,
      ref.normalizedRaw || ref.digits,
      ref.normalizedRaw || ref.digits
    );
  }

  if (status) {
    where.push(`LOWER(COALESCE(d.status, 'open')) = ?`);
    params.push(status);
  }

  if (businessUnitSlug) {
    where.push(`LOWER(COALESCE(bu.key_slug, '')) = ?`);
    params.push(businessUnitSlug);
  }

  if (hasQuote === true) {
    where.push(`q.id IS NOT NULL`);
  } else if (hasQuote === false) {
    where.push(`q.id IS NULL`);
  }

  if (Number.isFinite(minSaleValue)) {
    where.push(`COALESCE(${DEAL_QUOTE_SALE_VALUE_SQL}, 0) >= ?`);
    params.push(minSaleValue);
  }

  if (Number.isFinite(maxSaleValue)) {
    where.push(`COALESCE(${DEAL_QUOTE_SALE_VALUE_SQL}, 0) <= ?`);
    params.push(maxSaleValue);
  }

  if (minQuoteDelayDays !== null) {
    where.push(`${quoteDateExpr} IS NOT NULL`);
    where.push(`DATEDIFF(CURDATE(), ${quoteDateExpr}) >= ?`);
    params.push(minQuoteDelayDays);
  }

  const whereSql = where.length ? `WHERE ${where.join('\n        AND ')}` : '';
  const fromSql = `
      FROM deals d
      LEFT JOIN organizations o ON o.id = d.org_id
      LEFT JOIN contacts c ON c.id = d.contact_id
      LEFT JOIN business_units bu ON bu.id = d.business_unit_id
      LEFT JOIN deal_custom_fields cf ON cf.deal_id = d.id AND cf.\`key\` = 'f_cotiz'
      ${LATEST_DEAL_QUOTE_JOIN}
  `;

  const [[summary]] = await pool.query(
    `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN LOWER(COALESCE(d.status, 'open')) = 'open' THEN 1 ELSE 0 END) AS open_operations,
        SUM(CASE WHEN q.id IS NOT NULL THEN 1 ELSE 0 END) AS operations_with_quote,
        SUM(CASE WHEN q.id IS NULL THEN 1 ELSE 0 END) AS operations_without_quote,
        COALESCE(SUM(COALESCE(${DEAL_QUOTE_SALE_VALUE_SQL}, 0)), 0) AS total_sales_value_usd
      ${fromSql}
      ${whereSql}
    `,
    params
  );

  const [items] = await pool.query(
    `
      SELECT
        d.id,
        d.reference,
        d.title,
        d.status,
        d.created_at,
        d.org_id,
        o.name AS org_name,
        d.contact_id,
        c.name AS contact_name,
        c.email AS contact_email,
        bu.key_slug AS business_unit_slug,
        bu.name AS business_unit_name,
        d.value AS deal_value,
        CASE WHEN q.id IS NOT NULL THEN 1 ELSE 0 END AS has_quote,
        ${DEAL_QUOTE_SALE_VALUE_SQL} AS operation_sale_value_usd,
        cf.value AS quote_date_raw,
        CASE
          WHEN ${quoteDateExpr} IS NOT NULL THEN DATEDIFF(CURDATE(), ${quoteDateExpr})
          ELSE NULL
        END AS quote_age_days,
        CASE
          WHEN ${quoteDateExpr} IS NOT NULL THEN GREATEST(DATEDIFF(CURDATE(), ${quoteDateExpr}) - 15, 0)
          ELSE NULL
        END AS overdue_days
      ${fromSql}
      ${whereSql}
      ORDER BY
        COALESCE(overdue_days, -1) DESC,
        d.created_at DESC,
        d.id DESC
      LIMIT ?
    `,
    [...params, limit]
  );

  return {
    filters: {
      query: generalQuery || null,
      org_query: orgQuery || null,
      contact_query: contactQuery || null,
      reference_query: referenceQuery || null,
      business_unit_slug: businessUnitSlug || null,
      status: status || null,
      has_quote: hasQuote,
      min_sale_value_usd: Number.isFinite(minSaleValue) ? minSaleValue : null,
      max_sale_value_usd: Number.isFinite(maxSaleValue) ? maxSaleValue : null,
      min_quote_delay_days: minQuoteDelayDays,
    },
    summary: {
      total: Number(summary?.total || 0),
      open_operations: Number(summary?.open_operations || 0),
      operations_with_quote: Number(summary?.operations_with_quote || 0),
      operations_without_quote: Number(summary?.operations_without_quote || 0),
      total_sales_value_usd: Number(summary?.total_sales_value_usd || 0),
    },
    items,
  };
}

async function resolveOperationForFollowup(args) {
  const operationId = Number(args?.operation_id || 0);
  const reference = cleanText(args?.reference, 80);
  const query = cleanText(args?.query, 120);

  if (operationId > 0) {
    const [[row]] = await pool.query(
      `
        SELECT d.id, d.reference, d.title, d.org_id, d.contact_id
        FROM deals d
        WHERE d.id = ?
        LIMIT 1
      `,
      [operationId]
    );
    return row || null;
  }

  const lookup = reference || query;
  if (!lookup) return null;
  const ref = normalizeOperationReferenceCandidates(lookup);

  const [matches] = await pool.query(
    `
      SELECT
        d.id,
        d.reference,
        d.title,
        d.org_id,
        d.contact_id,
        o.name AS org_name,
        c.name AS contact_name
      FROM deals d
      LEFT JOIN organizations o ON o.id = d.org_id
      LEFT JOIN contacts c ON c.id = d.contact_id
      WHERE
        d.reference LIKE ?
        OR UPPER(d.reference) = ?
        OR UPPER(d.reference) = ?
        OR (
          ? <> '' AND ${NORMALIZED_DEAL_REFERENCE_SQL} = ?
        )
        OR d.title LIKE ?
        OR o.name LIKE ?
        OR c.name LIKE ?
      ORDER BY
        CASE
          WHEN UPPER(d.reference) = ? THEN 0
          WHEN UPPER(d.reference) = ? THEN 0
          WHEN ? <> '' AND ${NORMALIZED_DEAL_REFERENCE_SQL} = ? THEN 0
          WHEN d.reference LIKE ? THEN 1
          WHEN ? <> '' AND d.reference LIKE ? THEN 1
          ELSE 3
        END,
        d.id DESC
      LIMIT 5
    `,
    [
      ref.likeRaw,
      ref.raw,
      ref.formatted || ref.raw,
      ref.normalizedRaw || ref.digits,
      ref.normalizedRaw || ref.digits,
      `%${lookup}%`,
      `%${lookup}%`,
      `%${lookup}%`,
      ref.raw,
      ref.formatted || ref.raw,
      ref.normalizedRaw || ref.digits,
      ref.normalizedRaw || ref.digits,
      ref.likeRaw,
      ref.formatted,
      ref.likeFormatted,
    ]
  );

  if (matches.length === 1) return matches[0];
  return matches;
}

async function getOperationSummary(args) {
  const resolved = await resolveOperationForFollowup(args);
  if (!resolved) {
    return { error: 'operacion_no_encontrada' };
  }
  if (Array.isArray(resolved)) {
    return {
      status: 'ambiguous',
      matches: resolved.map((row) => ({
        id: row.id,
        reference: row.reference,
        title: row.title,
        org_name: row.org_name,
        contact_name: row.contact_name,
      })),
    };
  }

  const operation = resolved;

  const [[detail]] = await pool.query(
    `
      SELECT
        d.id,
        d.reference,
        d.title,
        d.status,
        d.created_at,
        d.updated_at,
        d.value AS deal_value,
        d.org_id,
        o.name AS org_name,
        o.ruc AS org_ruc,
        d.contact_id,
        c.name AS contact_name,
        c.email AS contact_email,
        bu.key_slug AS business_unit_slug,
        bu.name AS business_unit_name,
        CASE WHEN q.id IS NOT NULL THEN 1 ELSE 0 END AS has_quote,
        ${DEAL_QUOTE_SALE_VALUE_SQL} AS operation_sale_value_usd
      FROM deals d
      LEFT JOIN organizations o ON o.id = d.org_id
      LEFT JOIN contacts c ON c.id = d.contact_id
      LEFT JOIN business_units bu ON bu.id = d.business_unit_id
      ${LATEST_DEAL_QUOTE_JOIN}
      WHERE d.id = ?
      LIMIT 1
    `,
    [operation.id]
  );

  const [[followupSummary]] = await pool.query(
    `
      SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_followup_tasks,
        SUM(CASE WHEN status = 'pending' AND due_at < NOW() THEN 1 ELSE 0 END) AS overdue_followup_tasks
      FROM followup_tasks
      WHERE deal_id = ?
    `,
    [operation.id]
  );

  const [recentActivities] = await pool.query(
    `
      SELECT
        id,
        type,
        subject,
        due_date,
        done,
        notes,
        created_at
      FROM activities
      WHERE deal_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 5
    `,
    [operation.id]
  );

  return {
    operation: detail,
    followup: {
      pending_followup_tasks: Number(followupSummary?.pending_followup_tasks || 0),
      overdue_followup_tasks: Number(followupSummary?.overdue_followup_tasks || 0),
    },
    recent_activities: recentActivities,
  };
}

async function createPendingAssistantAction(req, action) {
  const id = randomUUID();
  const now = Date.now();
  const pending = {
    id,
    ownerKey: getPendingActionOwner(req),
    createdAt: now,
    expiresAt: now + PENDING_ACTION_TTL_MS,
    ...action,
  };
  assistantPendingActions.set(id, pending);
  if (assistantPendingActions.size > 200) prunePendingAssistantActions(now);
  return pending;
}

async function prepareOperationFollowupAction(args, context = {}) {
  const req = context.req;
  const entryType = cleanText(args?.entry_type, 20).toLowerCase();
  const title = cleanText(args?.title, 180);
  const content = cleanText(args?.content, 2000);
  const dueAt = formatAssistantActionDueAt(args?.due_at);
  const priority = cleanText(args?.priority, 20).toLowerCase() || 'medium';

  if (!['note', 'activity', 'reminder', 'task'].includes(entryType)) {
    return { error: 'entry_type_invalido' };
  }
  if (entryType === 'task' && !title) return { error: 'title_requerido_para_task' };
  if (entryType === 'note' && !content) return { error: 'content_requerido_para_note' };
  if ((entryType === 'reminder' || entryType === 'task') && !dueAt) return { error: 'due_at_requerido' };
  if (entryType === 'activity' && !title && !content) return { error: 'titulo_o_contenido_requerido' };

  const resolved = await resolveOperationForFollowup(args);
  if (!resolved) return { error: 'operacion_no_encontrada' };
  if (Array.isArray(resolved)) {
    return {
      status: 'ambiguous',
      matches: resolved.map((row) => ({
        id: row.id,
        reference: row.reference,
        title: row.title,
        org_name: row.org_name,
        contact_name: row.contact_name,
      })),
    };
  }

  const operation = resolved;
  const payload = {
    entry_type: entryType,
    title: title || null,
    content: content || null,
    due_at: dueAt,
    priority: ['low', 'medium', 'high'].includes(priority) ? priority : 'medium',
  };
  const summary = buildPendingFollowupSummary(operation, entryType, payload);
  const pending = await createPendingAssistantAction(req, {
    action_type: 'create_operation_followup',
    target: {
      deal_id: operation.id,
      reference: operation.reference || null,
      title: operation.title || null,
    },
    payload,
    summary,
  });

  return {
    status: 'confirmation_required',
    message: summary,
    operation: {
      id: operation.id,
      reference: operation.reference,
      title: operation.title,
    },
    pending_action: {
      id: pending.id,
      action_type: pending.action_type,
      target: pending.target,
      payload: pending.payload,
      summary: pending.summary,
      expires_at: new Date(pending.expiresAt).toISOString(),
    },
  };
}

async function resolveOrganization(args) {
  const organizationId = Number(args?.organization_id || 0);
  const query = cleanText(args?.query, 120);

  if (organizationId > 0) {
    const [[row]] = await pool.query(
      `
        SELECT
          id, name, razon_social, ruc, city, country, industry, phone, email, website,
          tipo_org, rubro, operacion
        FROM organizations
        WHERE id = ?
        LIMIT 1
      `,
      [organizationId]
    );
    return row || null;
  }

  if (!query) return null;

  const [matches] = await pool.query(
    `
      SELECT
        id, name, razon_social, ruc, city, country, industry, phone, email, website,
        tipo_org, rubro, operacion
      FROM organizations
      WHERE
        name LIKE ?
        OR razon_social LIKE ?
        OR ruc LIKE ?
      ORDER BY
        CASE
          WHEN LOWER(name) = LOWER(?) THEN 0
          WHEN LOWER(razon_social) = LOWER(?) THEN 0
          WHEN LOWER(ruc) = LOWER(?) THEN 0
          ELSE 1
        END,
        id DESC
      LIMIT 5
    `,
    [`%${query}%`, `%${query}%`, `%${query}%`, query, query, query]
  );

  return matches;
}

async function getOrganizationSummary(args) {
  const resolved = await resolveOrganization(args);
  if (!resolved) {
    return { error: 'organizacion_no_encontrada' };
  }
  if (Array.isArray(resolved) && resolved.length !== 1) {
    return {
      status: 'ambiguous',
      matches: resolved.map((row) => ({
        id: row.id,
        name: row.name,
        razon_social: row.razon_social,
        ruc: row.ruc,
        city: row.city,
        country: row.country,
      })),
    };
  }

  const organization = Array.isArray(resolved) ? resolved[0] : resolved;

  const [[operationSummary]] = await pool.query(
    `
      SELECT
        COUNT(*) AS total_operations,
        SUM(CASE WHEN LOWER(COALESCE(d.status, 'open')) = 'open' THEN 1 ELSE 0 END) AS open_operations,
        SUM(CASE WHEN q.id IS NOT NULL THEN 1 ELSE 0 END) AS operations_with_quote,
        COALESCE(SUM(CASE WHEN LOWER(COALESCE(d.status, 'open')) = 'open' THEN COALESCE(${DEAL_QUOTE_SALE_VALUE_SQL}, 0) ELSE 0 END), 0) AS open_operations_sale_value_usd,
        COALESCE(SUM(CASE WHEN LOWER(COALESCE(d.status, 'open')) = 'open' THEN COALESCE(${DEAL_QUOTE_SALE_VALUE_SQL}, 0) ELSE 0 END), 0) AS open_operations_value
      FROM deals d
      ${LATEST_DEAL_QUOTE_JOIN}
      WHERE d.org_id = ?
    `,
    [organization.id]
  );

  const [[contactSummary]] = await pool.query(
    `
      SELECT COUNT(*) AS total_contacts
      FROM contacts
      WHERE org_id = ? AND deleted_at IS NULL
    `,
    [organization.id]
  );

  const [[serviceSummary]] = await pool.query(
    `
      SELECT
        COUNT(*) AS total_service_cases,
        SUM(CASE WHEN LOWER(COALESCE(status, 'abierto')) IN ('abierto', 'en_proceso') THEN 1 ELSE 0 END) AS open_service_cases
      FROM service_cases
      WHERE org_id = ?
    `,
    [organization.id]
  );

  const [[followupSummary]] = await pool.query(
    `
      SELECT COUNT(*) AS pending_followup_tasks
      FROM followup_tasks
      WHERE org_id = ? AND status = 'pending'
    `,
    [organization.id]
  );

  const [recentOperations] = await pool.query(
    `
      SELECT
        d.id,
        d.reference,
        d.title,
        d.value AS deal_value,
        ${DEAL_QUOTE_SALE_VALUE_SQL} AS operation_sale_value_usd,
        d.status,
        d.created_at,
        CASE WHEN q.id IS NOT NULL THEN 1 ELSE 0 END AS has_quote
      FROM deals d
      ${LATEST_DEAL_QUOTE_JOIN}
      WHERE d.org_id = ?
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT 5
    `,
    [organization.id]
  );

  const [recentContacts] = await pool.query(
    `
      SELECT id, name, email, phone, title
      FROM contacts
      WHERE org_id = ? AND deleted_at IS NULL
      ORDER BY id DESC
      LIMIT 5
    `,
    [organization.id]
  );

  const [recentServices] = await pool.query(
    `
      SELECT id, reference, status, scheduled_date, created_at
      FROM service_cases
      WHERE org_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 5
    `,
    [organization.id]
  );

  return {
    organization,
    summaries: {
      operations: operationSummary,
      contacts: contactSummary,
      service_cases: serviceSummary,
      followup_tasks: followupSummary,
    },
    recent_operations: recentOperations,
    recent_contacts: recentContacts,
    recent_service_cases: recentServices,
  };
}

async function resolveContact(args) {
  const contactId = Number(args?.contact_id || 0);
  const query = cleanText(args?.query, 120);

  if (contactId > 0) {
    const [[row]] = await pool.query(
      `
        SELECT c.id, c.name, c.email, c.phone, c.title, c.org_id, o.name AS org_name
        FROM contacts c
        LEFT JOIN organizations o ON o.id = c.org_id
        WHERE c.id = ?
        LIMIT 1
      `,
      [contactId]
    );
    return row || null;
  }

  if (!query) return null;

  const [matches] = await pool.query(
    `
      SELECT c.id, c.name, c.email, c.phone, c.title, c.org_id, o.name AS org_name
      FROM contacts c
      LEFT JOIN organizations o ON o.id = c.org_id
      WHERE
        c.name LIKE ?
        OR c.email LIKE ?
        OR c.phone LIKE ?
        OR o.name LIKE ?
      ORDER BY
        CASE
          WHEN LOWER(c.name) = LOWER(?) THEN 0
          WHEN LOWER(c.email) = LOWER(?) THEN 0
          ELSE 1
        END,
        c.id DESC
      LIMIT 5
    `,
    [`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, query, query]
  );

  return matches;
}

async function getContactSummary(args) {
  const resolved = await resolveContact(args);
  if (!resolved) {
    return { error: 'contacto_no_encontrado' };
  }
  if (Array.isArray(resolved) && resolved.length !== 1) {
    return {
      status: 'ambiguous',
      matches: resolved.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        org_name: row.org_name,
      })),
    };
  }

  const contact = Array.isArray(resolved) ? resolved[0] : resolved;

  const [operations] = await pool.query(
    `
      SELECT
        d.id,
        d.reference,
        d.title,
        d.value AS deal_value,
        ${DEAL_QUOTE_SALE_VALUE_SQL} AS operation_sale_value_usd,
        d.status,
        d.created_at,
        CASE WHEN q.id IS NOT NULL THEN 1 ELSE 0 END AS has_quote
      FROM deals d
      ${LATEST_DEAL_QUOTE_JOIN}
      WHERE d.contact_id = ?
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT 10
    `,
    [contact.id]
  );

  const [activities] = await pool.query(
    `
      SELECT id, type, subject, due_date, done, created_at
      FROM activities
      WHERE person_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 10
    `,
    [contact.id]
  );

  return {
    contact,
    summary: {
      total_operations: operations.length,
      total_activities: activities.length,
    },
    recent_operations: operations,
    recent_activities: activities,
  };
}

async function getServiceCasesSummary(args) {
  const limit = clampInt(args?.limit, 10, 1, 20);

  const [[summary]] = await pool.query(
    `
      SELECT
        COUNT(*) AS total_service_cases,
        SUM(CASE WHEN LOWER(COALESCE(status, 'abierto')) = 'abierto' THEN 1 ELSE 0 END) AS open_cases,
        SUM(CASE WHEN LOWER(COALESCE(status, '')) = 'en_proceso' THEN 1 ELSE 0 END) AS in_progress_cases,
        SUM(CASE WHEN LOWER(COALESCE(status, '')) = 'cerrado' THEN 1 ELSE 0 END) AS closed_cases
      FROM service_cases
    `
  );

  const [items] = await pool.query(
    `
      SELECT
        sc.id,
        sc.reference,
        sc.status,
        sc.scheduled_date,
        sc.created_at,
        o.name AS org_name,
        ss.name AS stage_name
      FROM service_cases sc
      LEFT JOIN organizations o ON o.id = sc.org_id
      LEFT JOIN service_stages ss ON ss.id = sc.stage_id
      ORDER BY sc.created_at DESC, sc.id DESC
      LIMIT ?
    `,
    [limit]
  );

  return { summary, items };
}

async function getFollowupSummary(args) {
  const limit = clampInt(args?.limit, 10, 1, 20);

  const [[summary]] = await pool.query(
    `
      SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_tasks,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS completed_tasks
      FROM followup_tasks
    `
  );

  const [items] = await pool.query(
    `
      SELECT
        t.id,
        t.title,
        t.status,
        t.due_at,
        o.name AS org_name,
        c.name AS contact_name,
        d.reference AS deal_reference
      FROM followup_tasks t
      LEFT JOIN organizations o ON o.id = t.org_id
      LEFT JOIN contacts c ON c.id = t.contact_id
      LEFT JOIN deals d ON d.id = t.deal_id
      WHERE t.status = 'pending'
      ORDER BY t.due_at ASC, t.id DESC
      LIMIT ?
    `,
    [limit]
  );

  return { summary, items };
}

const ASSISTANT_INSTRUCTIONS = [
  'Eres el asistente interno de GRUPO ATM.',
  'Trabajas en fase 2.1: consultas y acciones asistidas con confirmacion.',
  'Puedes proponer crear notas, actividades, recordatorios y tareas dentro de operaciones, pero nunca ejecutarlas sin confirmacion explicita del usuario.',
  'No puedes aprobar, eliminar ni sugerir que ya ejecutaste una accion sobre el sistema antes de confirmar.',
  'Si el usuario pide datos del sistema, primero usa las tools internas antes de responder.',
  'No inventes operaciones, montos, estados, clientes ni fechas.',
  'Cuando hables del valor de una operacion usa operation_sale_value_usd o total_open_sales_value_usd; esos campos salen de la venta del presupuesto/cotizacion.',
  'No uses deal_value como valor de venta; deal_value es solo dato interno/fallback.',
  'Si el usuario pide una busqueda especifica de operaciones con filtros, usa search_operations_advanced.',
  'Si el usuario pide una operacion puntual por numero o referencia, usa get_operation_summary.',
  'Si el usuario pide crear seguimiento en una operacion, usa prepare_operation_followup_action y luego pide confirmacion.',
  'Cuando una accion requiera fecha y hora, usa formato YYYY-MM-DD HH:mm si la fecha es clara.',
  'Si la busqueda es ambigua, pide una aclaracion corta.',
  'Responde en espanol, claro y directo.',
  'Cuando listes registros, prioriza resumen y luego los items mas relevantes.',
].join(' ');

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    name: 'search_crm_entities',
    description: 'Busca operaciones, organizaciones, contactos y servicios por texto libre.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Texto de busqueda, por ejemplo referencia, cliente o contacto.' },
        limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Cantidad maxima por bloque.' },
      },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'get_open_operations_summary',
    description: 'Resume operaciones abiertas, cuantas tienen cotizacion y el valor total de venta presupuestado.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        business_unit_slug: { type: 'string', description: 'Slug opcional de unidad de negocio, por ejemplo atm-cargo.' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Cuantas operaciones recientes incluir.' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'search_operations_advanced',
    description: 'Busca operaciones con filtros especificos por cliente, contacto, referencia, estado, unidad de negocio, cotizacion, atraso y valor de venta.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Texto general para buscar por referencia, titulo, cliente o contacto.' },
        org_query: { type: 'string', description: 'Filtro especifico por cliente, organizacion o RUC.' },
        contact_query: { type: 'string', description: 'Filtro especifico por nombre, email o telefono del contacto.' },
        reference_query: { type: 'string', description: 'Filtro por referencia de la operacion.' },
        business_unit_slug: { type: 'string', description: 'Slug opcional de unidad de negocio, por ejemplo atm-cargo.' },
        status: { type: 'string', description: 'Estado exacto de la operacion, por ejemplo open, won, lost o all.' },
        has_quote: { type: 'boolean', description: 'true si debe tener cotizacion, false si no debe tenerla.' },
        min_sale_value_usd: { type: 'number', description: 'Valor minimo de venta en USD.' },
        max_sale_value_usd: { type: 'number', description: 'Valor maximo de venta en USD.' },
        min_quote_delay_days: { type: 'integer', minimum: 1, maximum: 365, description: 'Atraso minimo usando la fecha de cotizacion f_cotiz.' },
        limit: { type: 'integer', minimum: 1, maximum: 25, description: 'Cantidad maxima de operaciones a listar.' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'get_operation_summary',
    description: 'Busca una operacion puntual por ID o numero/referencia y devuelve su resumen, cliente, contacto, estado, cotizacion y seguimiento.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        operation_id: { type: 'integer', minimum: 1, description: 'ID exacto de la operacion si se conoce.' },
        reference: { type: 'string', description: 'Numero o referencia de la operacion, por ejemplo OP-000510.' },
        query: { type: 'string', description: 'Texto alternativo para buscar por referencia, titulo, cliente o contacto.' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'list_operations_without_quote',
    description: 'Lista operaciones abiertas que todavia no tienen cotizacion.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        business_unit_slug: { type: 'string', description: 'Slug opcional de unidad de negocio.' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Cantidad maxima a listar.' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'list_operations_with_quote_delay',
    description: 'Lista operaciones abiertas con atraso tomando la fecha de cotizacion registrada en el campo f_cotiz.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        business_unit_slug: { type: 'string', description: 'Slug opcional de unidad de negocio.' },
        min_delay_days: { type: 'integer', minimum: 1, maximum: 365, description: 'Edad minima de la cotizacion para considerar atraso.' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Cantidad maxima a listar.' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'get_organization_summary',
    description: 'Resume un cliente u organizacion con operaciones, contactos, servicios y tareas pendientes.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        organization_id: { type: 'integer', minimum: 1, description: 'ID exacto de la organizacion si se conoce.' },
        query: { type: 'string', description: 'Nombre, razon social o RUC para encontrar la organizacion.' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'get_contact_summary',
    description: 'Resume un contacto con sus operaciones y actividades recientes.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        contact_id: { type: 'integer', minimum: 1, description: 'ID exacto del contacto si se conoce.' },
        query: { type: 'string', description: 'Nombre, email, telefono o cliente del contacto.' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'get_service_cases_summary',
    description: 'Resume los casos de servicio y mantenimiento.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Cantidad maxima de casos recientes.' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'get_service_case_summary',
    description: 'Busca un caso de servicio puntual por ID o referencia y devuelve su resumen.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        service_case_id: { type: 'integer', minimum: 1, description: 'ID exacto del caso si se conoce.' },
        reference: { type: 'string', description: 'Referencia del caso de servicio.' },
        query: { type: 'string', description: 'Texto alternativo para buscar por referencia o cliente.' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'get_followup_summary',
    description: 'Resume tareas de seguimiento pendientes.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Cantidad maxima de tareas pendientes.' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'prepare_operation_followup_action',
    description: 'Prepara una accion para crear una nota, actividad, recordatorio o tarea en una operacion. No ejecuta nada; solo deja la accion lista para confirmar.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        operation_id: { type: 'integer', minimum: 1, description: 'ID exacto de la operacion si se conoce.' },
        reference: { type: 'string', description: 'Referencia exacta o parcial de la operacion, por ejemplo OP-000510.' },
        query: { type: 'string', description: 'Texto alternativo para encontrar la operacion si no hay referencia exacta.' },
        entry_type: { type: 'string', enum: ['note', 'activity', 'reminder', 'task'], description: 'Tipo de seguimiento a crear.' },
        title: { type: 'string', description: 'Titulo o asunto. Obligatorio para task; opcional para note, activity y reminder.' },
        content: { type: 'string', description: 'Detalle o cuerpo. Obligatorio para note; opcional para activity y reminder.' },
        due_at: { type: 'string', description: 'Fecha y hora para reminder o task en formato YYYY-MM-DD HH:mm.' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Prioridad de la tarea. Solo aplica a task.' },
      },
      required: ['entry_type'],
    },
  },
];

function getToolDefinitionsForAccess(access) {
  return TOOL_DEFINITIONS.filter((tool) => canUseTool(tool.name, access));
}

function linkKey(type, id) {
  return `${type}:${id}`;
}

function addAssistantLink(map, type, id, label, href) {
  if (id === null || id === undefined || id === '') return;
  const cleanLabel = cleanText(label || `${type} ${id}`, 120);
  if (!cleanLabel || !href) return;
  const key = linkKey(type, id);
  if (!map.has(key)) {
    map.set(key, {
      type,
      id,
      label: cleanLabel,
      href,
    });
  }
}

function collectAssistantLinksFromToolOutput(name, output, map, access) {
  if (!output || typeof output !== 'object' || output.error) return;

  const addDeal = (row) => {
    if (!row?.id || !access.canViewOperations) return;
    addAssistantLink(map, 'deal', row.id, row.reference || row.title || `Operacion ${row.id}`, `/operations/${row.id}`);
  };
  const addOrg = (row) => {
    if (!row?.id && !row?.org_id) return;
    if (!access.canViewOrganizations) return;
    const id = row.id || row.org_id;
    addAssistantLink(map, 'organization', id, row.name || row.org_name || row.razon_social || `Organizacion ${id}`, `/organizations/${id}`);
  };
  const addContact = (row) => {
    if (!row?.id && !row?.contact_id) return;
    if (!access.canViewContacts) return;
    const id = row.id || row.contact_id;
    addAssistantLink(map, 'contact', id, row.name || row.contact_name || `Contacto ${id}`, `/contacts/${id}`);
  };
  const addService = (row) => {
    if (!row?.id || !access.canViewService) return;
    addAssistantLink(map, 'service_case', row.id, row.reference || `Servicio ${row.id}`, `/service/cases/${row.id}`);
  };
  const addPendingOperation = (row) => {
    if (!row?.deal_id || !access.canViewOperations) return;
    addAssistantLink(map, 'deal', row.deal_id, row.reference || row.title || `Operacion ${row.deal_id}`, `/operations/${row.deal_id}`);
  };

  if (Array.isArray(output.deals)) output.deals.forEach(addDeal);
  if (Array.isArray(output.items)) {
    if (name === 'get_service_cases_summary') {
      output.items.forEach(addService);
    } else {
      output.items.forEach(addDeal);
    }
  }
  if (Array.isArray(output.recent_operations)) output.recent_operations.forEach(addDeal);

  if (Array.isArray(output.organizations)) output.organizations.forEach(addOrg);
  if (output.organization) addOrg(output.organization);
  if (Array.isArray(output.matches)) {
    output.matches.forEach((row) => {
      if (name === 'get_contact_summary') addContact(row);
      else addOrg(row);
    });
  }

  if (Array.isArray(output.contacts)) output.contacts.forEach(addContact);
  if (output.contact) addContact(output.contact);
  if (Array.isArray(output.recent_contacts)) output.recent_contacts.forEach(addContact);

  if (Array.isArray(output.services)) output.services.forEach(addService);
  if (Array.isArray(output.recent_service_cases)) output.recent_service_cases.forEach(addService);
  if (output.service_case) addService(output.service_case);
  if (output.operation) addDeal(output.operation);
  if (output.pending_action?.target) addPendingOperation(output.pending_action.target);
}

const TOOL_HANDLERS = {
  search_crm_entities: searchCrmEntities,
  get_open_operations_summary: getOpenOperationsSummary,
  search_operations_advanced: searchOperationsAdvanced,
  get_operation_summary: getOperationSummary,
  list_operations_without_quote: listOperationsWithoutQuote,
  list_operations_with_quote_delay: listOperationsWithQuoteDelay,
  get_organization_summary: getOrganizationSummary,
  get_contact_summary: getContactSummary,
  get_service_cases_summary: getServiceCasesSummary,
  get_service_case_summary: getServiceCaseSummary,
  get_followup_summary: getFollowupSummary,
  prepare_operation_followup_action: prepareOperationFollowupAction,
};

async function executeTool(name, args, context = {}) {
  const access = context.access || { role: 'unknown' };
  if (!canUseTool(name, access)) {
    return toolPermissionError(name, access);
  }

  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    return { error: 'tool_no_disponible', tool: name };
  }
  try {
    return await handler(args || {}, context);
  } catch (error) {
    console.error(`[assistant] tool ${name} error:`, error?.message || error);
    return {
      error: 'tool_execution_failed',
      tool: name,
      message: error?.message || 'Error ejecutando tool',
    };
  }
}

async function executeCreateOperationFollowup(action, req) {
  const dealId = Number(action?.target?.deal_id || 0);
  const entryType = cleanText(action?.payload?.entry_type, 20).toLowerCase();
  const title = cleanText(action?.payload?.title, 180);
  const content = cleanText(action?.payload?.content, 2000);
  const dueAt = normalizeDateTimeInput(action?.payload?.due_at);
  const priority = cleanText(action?.payload?.priority, 20).toLowerCase() || 'medium';
  const userId = Number(req.user?.id) || null;

  if (!dealId) throw new Error('Operacion invalida para la accion asistida');

  const [[deal]] = await pool.query(
    `
      SELECT d.id, d.reference, d.org_id, d.contact_id
      FROM deals d
      WHERE d.id = ?
      LIMIT 1
    `,
    [dealId]
  );

  if (!deal) {
    const error = new Error('Operacion no encontrada');
    error.status = 404;
    throw error;
  }

  if (entryType === 'task') {
    if (!title || !dueAt) {
      const error = new Error('La tarea requiere titulo y vencimiento');
      error.status = 400;
      throw error;
    }
    const [ins] = await pool.query(
      `
      INSERT INTO followup_tasks
        (user_id, org_id, contact_id, deal_id, title, priority, status, due_at)
      VALUES (?,?,?,?,?,?, 'pending', ?)
      `,
      [
        userId,
        deal.org_id || null,
        deal.contact_id || null,
        deal.id,
        title,
        ['low', 'medium', 'high'].includes(priority) ? priority : 'medium',
        `${dueAt}:00`,
      ]
    );

    return {
      source_type: 'task',
      id: ins.insertId,
      answer: `Se creo la tarea en ${deal.reference || `operacion ${deal.id}`}.`,
      link: {
        type: 'deal',
        id: deal.id,
        label: deal.reference || `Operacion ${deal.id}`,
        href: `/operations/${deal.id}`,
      },
    };
  }

  const activityType =
    entryType === 'note' ? 'note' : entryType === 'reminder' ? 'reminder' : 'activity';
  const subject =
    title ||
    (entryType === 'note'
      ? `Nota en ${deal.reference || 'operacion'}`
      : entryType === 'reminder'
      ? `Recordatorio en ${deal.reference || 'operacion'}`
      : `Actividad en ${deal.reference || 'operacion'}`);

  if (entryType === 'note' && !content) {
    const error = new Error('La nota requiere contenido');
    error.status = 400;
    throw error;
  }
  if (entryType === 'reminder' && !dueAt) {
    const error = new Error('El recordatorio requiere fecha y hora');
    error.status = 400;
    throw error;
  }

  const [ins] = await pool.query(
    `
    INSERT INTO activities
      (type, subject, due_date, done, org_id, person_id, deal_id, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?,?)
    `,
    [
      activityType,
      subject,
      dueAt ? `${dueAt}:00` : null,
      0,
      deal.org_id || null,
      deal.contact_id || null,
      deal.id,
      content || null,
      userId,
    ]
  );

  const typeLabel =
    entryType === 'note' ? 'nota' : entryType === 'reminder' ? 'recordatorio' : 'actividad';
  return {
    source_type: 'activity',
    id: ins.insertId,
    answer: `Se creo la ${typeLabel} en ${deal.reference || `operacion ${deal.id}`}.`,
    link: {
      type: 'deal',
      id: deal.id,
      label: deal.reference || `Operacion ${deal.id}`,
      href: `/operations/${deal.id}`,
    },
  };
}

async function callOpenAI(payload, apiKey) {
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY no configurada');
    error.code = 'missing_openai_key';
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  let response;
  try {
    response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Timeout llamando al modelo');
      timeoutError.code = 'openai_timeout';
      throw timeoutError;
    }
    throw error;
  }
  clearTimeout(timer);

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = data?.error?.message || `OpenAI error ${response.status}`;
    const error = new Error(msg);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

function toOpenAIInput(history, message) {
  const items = [];
  for (const row of history || []) {
    const role = row?.role === 'assistant' ? 'assistant' : 'user';
    const text = cleanText(row?.content, 3000);
    if (!text) continue;
    items.push({
      type: 'message',
      role,
      content: [
        {
          type: role === 'assistant' ? 'output_text' : 'input_text',
          text,
        },
      ],
    });
  }

  const userMessage = cleanText(message, 4000);
  items.push({
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text: userMessage }],
  });
  return items;
}

router.get('/status', requireAuth, async (_req, res) => {
  const assistantConfig = getAssistantConfig();
  const access = getAssistantAccess(_req);
  res.json({
    enabled: true,
    phase: 'assisted-actions',
    provider: 'openai',
    configured: assistantConfig.configured,
    model: assistantConfig.model,
    rate_limit: {
      max_requests: RATE_LIMIT_MAX_REQUESTS,
      window_seconds: Math.round(RATE_LIMIT_WINDOW_MS / 1000),
      max_in_flight: RATE_LIMIT_MAX_IN_FLIGHT,
    },
    role: access.role,
    permissions: {
      operations: access.canViewOperations,
      organizations: access.canViewOrganizations,
      contacts: access.canViewContacts,
      service: access.canViewService,
      followup: access.canViewFollowup,
    },
  });
});

router.post('/confirm-action', requireAuth, async (req, res) => {
  const actionId = cleanText(req.body?.action_id, 120);
  if (!actionId) {
    return res.status(400).json({ error: 'action_id_requerido' });
  }

  prunePendingAssistantActions();
  const pending = assistantPendingActions.get(actionId);
  if (!pending) {
    return res.status(404).json({
      error: 'assistant_action_not_found',
      message: 'La accion pendiente ya no esta disponible.',
    });
  }
  if (pending.ownerKey !== getPendingActionOwner(req)) {
    return res.status(403).json({
      error: 'assistant_action_forbidden',
      message: 'No puedes confirmar una accion creada por otro usuario.',
    });
  }

  try {
    let result;
    if (pending.action_type === 'create_operation_followup') {
      result = await executeCreateOperationFollowup(pending, req);
    } else {
      return res.status(400).json({
        error: 'assistant_action_invalid',
        message: 'Tipo de accion no soportado.',
      });
    }

    assistantPendingActions.delete(actionId);

    await logAudit({
      req,
      action: 'assistant_confirm_action',
      entity: 'assistant',
      description: 'Accion asistida confirmada',
      meta: {
        phase: 'assisted-actions',
        action_type: pending.action_type,
        target: pending.target,
        payload: pending.payload,
      },
    });

    return res.json({
      ok: true,
      phase: 'assisted-actions',
      answer: result.answer,
      links: result.link ? [result.link] : [],
      action_result: {
        action_id: actionId,
        action_type: pending.action_type,
        source_type: result.source_type,
        id: result.id,
      },
    });
  } catch (error) {
    console.error('[assistant] confirm-action error:', error?.message || error);
    return res.status(error?.status || 500).json({
      error: 'assistant_action_failed',
      message: 'No se pudo ejecutar la accion asistida.',
      detail: error?.message || 'Error interno',
    });
  }
});

router.post('/respond', requireAuth, async (req, res) => {
  const message = cleanText(req.body?.message, 4000);
  const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
  const history = rawHistory
    .filter((row) => row && (row.role === 'user' || row.role === 'assistant'))
    .slice(-12)
    .map((row) => ({
      role: row.role,
      content: cleanText(row.content, 3000),
    }))
    .filter((row) => row.content);

  if (!message) {
    return res.status(400).json({ error: 'message_requerido' });
  }

  const rateLimit = checkAssistantRateLimit(req);
  if (!rateLimit.ok) {
    return res
      .status(rateLimit.status)
      .set('Retry-After', String(rateLimit.retryAfterSeconds || 1))
      .json({
        error: 'assistant_rate_limited',
        message: rateLimit.message,
        retry_after_seconds: rateLimit.retryAfterSeconds,
      });
  }

  const toolNamesUsed = [];
  const assistantConfig = getAssistantConfig();
  const model = assistantConfig.model;
  const access = getAssistantAccess(req);
  const operationReferenceHint = extractOperationReferenceHint(message);
  const operationIntent = detectOperationIntent(message);
  const followupActionIntent = detectFollowupActionIntent(message);
  const crmEntityType = detectCrmEntityType(message);
  const crmEntityLookup = extractCrmEntityLookupText(message);
  const followupActionDraft = followupActionIntent ? extractFollowupActionDraft(message, followupActionIntent) : null;
  const normalizedMessageRef =
    operationReferenceHint || (/^\s*op[\s-]*\d{1,6}\s*$/i.test(message) || /^\s*\d{3,6}\s*$/.test(message)
      ? normalizeOperationReferenceCandidates(message).formatted
      : null);
  const tools = getToolDefinitionsForAccess(access);
  const linkMap = new Map();
  let pendingAction = null;

  try {
    incrementAssistantInFlight(rateLimit.key);
    let hintedOperationResult = null;
    if (normalizedMessageRef && access.canViewOperations) {
      hintedOperationResult = await getOperationSummary({ reference: normalizedMessageRef });
      collectAssistantLinksFromToolOutput('get_operation_summary', hintedOperationResult, linkMap, access);
      if (hintedOperationResult?.operation?.id) {
        toolNamesUsed.push('get_operation_summary:auto_reference');
      }
      if (
        hintedOperationResult?.operation?.id &&
        !followupActionIntent &&
        shouldAutoResolveOperationMessage(message, normalizedMessageRef)
      ) {
        const finalText =
          buildOperationIntentAnswer(hintedOperationResult, operationIntent || 'summary') ||
          buildOperationSummaryAnswer(hintedOperationResult);
        await logAudit({
          req,
          action: 'assistant_query',
          entity: 'assistant',
          description: 'Consulta al asistente IA',
          meta: {
            phase: 'assisted-actions',
            model,
            role: access.role,
            message,
            tools_used: Array.from(new Set(toolNamesUsed)),
            auto_resolved_reference: normalizedMessageRef,
            auto_resolved_intent: operationIntent || 'summary',
          },
        });

        return res.json({
          ok: true,
          phase: 'assisted-actions',
          answer: buildOperationIntentAnswer(hintedOperationResult, operationIntent || 'summary') || finalText,
          tools_used: Array.from(new Set(toolNamesUsed)),
          links: Array.from(linkMap.values()).slice(0, 12),
          model,
          rate_limit: {
            remaining: rateLimit.remaining,
            reset_at: new Date(rateLimit.resetAt).toISOString(),
          },
        });
      }
    }

    let hintedOrganizationResult = null;
    let hintedContactResult = null;
    let hintedServiceCaseResult = null;
    if (!normalizedMessageRef && crmEntityLookup) {
      if (crmEntityType === 'service_case' && access.canViewService) {
        hintedServiceCaseResult = await getServiceCaseSummary({
          reference: extractServiceReferenceHint(message) || undefined,
          query: crmEntityLookup,
        });
        collectAssistantLinksFromToolOutput('get_service_case_summary', hintedServiceCaseResult, linkMap, access);
        if (hintedServiceCaseResult?.service_case?.id && isStrongServiceCaseMatch(hintedServiceCaseResult, extractServiceReferenceHint(message) || crmEntityLookup)) {
          toolNamesUsed.push('get_service_case_summary:auto_match');
          await logAudit({
            req,
            action: 'assistant_query',
            entity: 'assistant',
            description: 'Consulta al asistente IA',
            meta: {
              phase: 'assisted-actions',
              model,
              role: access.role,
              message,
              tools_used: Array.from(new Set(toolNamesUsed)),
              auto_resolved_entity: 'service_case',
              auto_resolved_lookup: extractServiceReferenceHint(message) || crmEntityLookup,
            },
          });

          return res.json({
            ok: true,
            phase: 'assisted-actions',
            answer: buildServiceCaseSummaryAnswer(hintedServiceCaseResult),
            tools_used: Array.from(new Set(toolNamesUsed)),
            links: Array.from(linkMap.values()).slice(0, 12),
            model,
            rate_limit: {
              remaining: rateLimit.remaining,
              reset_at: new Date(rateLimit.resetAt).toISOString(),
            },
          });
        }
      }

      if ((crmEntityType === 'organization' || !crmEntityType) && access.canViewOrganizations) {
        hintedOrganizationResult = await getOrganizationSummary({ query: crmEntityLookup });
        collectAssistantLinksFromToolOutput('get_organization_summary', hintedOrganizationResult, linkMap, access);
        if (hintedOrganizationResult?.organization?.id && isStrongOrganizationMatch(hintedOrganizationResult.organization, crmEntityLookup)) {
          toolNamesUsed.push('get_organization_summary:auto_match');
          await logAudit({
            req,
            action: 'assistant_query',
            entity: 'assistant',
            description: 'Consulta al asistente IA',
            meta: {
              phase: 'assisted-actions',
              model,
              role: access.role,
              message,
              tools_used: Array.from(new Set(toolNamesUsed)),
              auto_resolved_entity: 'organization',
              auto_resolved_lookup: crmEntityLookup,
            },
          });

          return res.json({
            ok: true,
            phase: 'assisted-actions',
            answer: buildOrganizationSummaryAnswer(hintedOrganizationResult),
            tools_used: Array.from(new Set(toolNamesUsed)),
            links: Array.from(linkMap.values()).slice(0, 12),
            model,
            rate_limit: {
              remaining: rateLimit.remaining,
              reset_at: new Date(rateLimit.resetAt).toISOString(),
            },
          });
        }
      }

      if ((crmEntityType === 'contact' || !crmEntityType) && access.canViewContacts) {
        hintedContactResult = await getContactSummary({ query: crmEntityLookup });
        collectAssistantLinksFromToolOutput('get_contact_summary', hintedContactResult, linkMap, access);
        if (hintedContactResult?.contact?.id && isStrongContactMatch(hintedContactResult.contact, crmEntityLookup)) {
          toolNamesUsed.push('get_contact_summary:auto_match');
          await logAudit({
            req,
            action: 'assistant_query',
            entity: 'assistant',
            description: 'Consulta al asistente IA',
            meta: {
              phase: 'assisted-actions',
              model,
              role: access.role,
              message,
              tools_used: Array.from(new Set(toolNamesUsed)),
              auto_resolved_entity: 'contact',
              auto_resolved_lookup: crmEntityLookup,
            },
          });

          return res.json({
            ok: true,
            phase: 'assisted-actions',
            answer: buildContactSummaryAnswer(hintedContactResult),
            tools_used: Array.from(new Set(toolNamesUsed)),
            links: Array.from(linkMap.values()).slice(0, 12),
            model,
            rate_limit: {
              remaining: rateLimit.remaining,
              reset_at: new Date(rateLimit.resetAt).toISOString(),
            },
          });
        }
      }
    }

    const instructions = [
      buildAssistantInstructions(access),
      normalizedMessageRef
        ? `La consulta actual menciona una posible referencia de operacion: "${normalizedMessageRef}". Si el pedido apunta a una operacion puntual, prioriza get_operation_summary usando esa referencia.`
        : null,
      operationIntent ? `La intencion detectada en la consulta es "${operationIntent}".` : null,
      followupActionIntent && hintedOperationResult?.operation?.id
        ? buildFollowupActionInstruction(followupActionIntent, hintedOperationResult)
        : null,
      followupActionIntent && followupActionDraft
        ? `Borrador detectado para la accion: ${JSON.stringify(followupActionDraft)}. Usa esos datos si son coherentes con el pedido del usuario.`
        : null,
      followupActionIntent
        ? 'Si el usuario pide crear seguimiento, no respondas solo con el resumen de la operacion. Debes preparar una accion con confirmacion usando prepare_operation_followup_action o pedir el dato faltante minimo.'
        : null,
      crmEntityType ? `La entidad sugerida en la consulta es "${crmEntityType}".` : null,
      crmEntityLookup ? `El texto principal a resolver en la consulta es "${crmEntityLookup}".` : null,
      hintedServiceCaseResult?.service_case?.id
        ? `El caso de servicio ya fue resuelto en backend: ${hintedServiceCaseResult.service_case.reference}.`
        : null,
      hintedOperationResult?.operation?.id ? buildResolvedOperationInstruction(hintedOperationResult) : null,
    ]
      .filter(Boolean)
      .join(' ');

    let response = await callOpenAI({
      model,
      instructions,
      tools,
      input: toOpenAIInput(history, message),
    }, assistantConfig.apiKey);

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const toolCalls = getToolCalls(response);
      if (!toolCalls.length) break;

      const toolOutputs = [];
      for (const call of toolCalls) {
        const args = safeJsonParse(call.arguments, {});
        toolNamesUsed.push(call.name);
        const output = await executeTool(call.name, args, { req, access });
        collectAssistantLinksFromToolOutput(call.name, output, linkMap, access);
        if (!pendingAction && output?.pending_action?.id) {
          pendingAction = output.pending_action;
        }
        toolOutputs.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(output),
        });
      }

      response = await callOpenAI({
        model,
        previous_response_id: response.id,
        instructions,
        tools,
        input: toolOutputs,
      }, assistantConfig.apiKey);
    }

    const text = extractResponseText(response);
    let finalText =
      text ||
      'No pude generar una respuesta util con los datos actuales. Proba con una consulta mas especifica.';
    if (pendingAction) {
      finalText = `${finalText}\n\nRevisa la accion propuesta y confirma si quieres ejecutarla.`;
    }

    await logAudit({
      req,
      action: 'assistant_query',
      entity: 'assistant',
      description: 'Consulta al asistente IA',
      meta: {
        phase: pendingAction ? 'assisted-actions' : 'read-only',
        model,
        role: access.role,
        message,
        tools_used: Array.from(new Set(toolNamesUsed)),
        pending_action: pendingAction
          ? {
              id: pendingAction.id,
              action_type: pendingAction.action_type,
              target: pendingAction.target,
            }
          : null,
      },
    });

    return res.json({
      ok: true,
      phase: pendingAction ? 'assisted-actions' : 'read-only',
      answer: finalText,
      tools_used: Array.from(new Set(toolNamesUsed)),
      links: Array.from(linkMap.values()).slice(0, 12),
      pending_action: pendingAction,
      model,
      rate_limit: {
        remaining: rateLimit.remaining,
        reset_at: new Date(rateLimit.resetAt).toISOString(),
      },
    });
  } catch (error) {
    console.error('[assistant] respond error:', error?.message || error);
    if (error?.payload) {
      console.error('[assistant] upstream payload:', JSON.stringify(error.payload));
    }
    return res.status(error?.code === 'missing_openai_key' ? 503 : 500).json({
      error: 'assistant_failed',
      message:
        error?.code === 'missing_openai_key'
          ? 'El asistente no esta configurado todavia.'
          : 'No se pudo procesar la consulta del asistente.',
      detail:
        error?.code === 'missing_openai_key'
          ? 'OPENAI_API_KEY faltante'
          : (error?.message || 'Error interno del asistente'),
    });
  } finally {
    decrementAssistantInFlight(rateLimit.key);
  }
});

export default router;
