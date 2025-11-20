// client/src/pages/OrganizationDetail.jsx
import React, { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import AccountExecutiveSelect from '../components/AccountExecutiveSelect.jsx';

function FieldRow({ label, value, children }) {
  return (
    <div className="flex items-start justify-between py-2 border-b last:border-b-0">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="text-sm text-slate-900 text-right min-w-0">
        {children ?? (value || '—')}
      </div>
    </div>
  );
}

function Badge({ children }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-700 ml-1">
      {children}
    </span>
  );
}

// 👇 agrego terrestre también por si lo usás
const ALL_MODALITIES = ['aerea', 'maritima', 'terrestre', 'fluvial'];

function parseModalitiesCSV(csv) {
  if (!csv) return [];
  return String(csv)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
function toCSV(arr) {
  return Array.isArray(arr) ? arr.join(',') : '';
}

/* ===== Helpers: Users / Ejecutivo de cuenta ===== */
function coerceId(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    return null;
  }
  if (typeof v === 'object') {
    const id = coerceId(v.id ?? v.user_id ?? v.userId ?? null);
    return id ?? null;
  }
  return null;
}

function extractUserDisplay(user, fallbackId = null) {
  if (!user) {
    return {
      name: fallbackId != null ? `Usuario #${fallbackId}` : null,
      email: '',
    };
  }
  const nameFromParts = [user.first_name, user.last_name]
    .filter(Boolean)
    .join(' ');
  let name =
    user.name ||
    nameFromParts ||
    user.username ||
    user.email ||
    (fallbackId != null ? `Usuario #${fallbackId}` : null);
  const email = user.email || '';
  return { name, email };
}

/* ====== Caché y fallbacks para /users ====== */
let USERS_CACHE = null;

async function fetchUsersIndex() {
  if (USERS_CACHE) return USERS_CACHE;
  try {
    const { data } = await api.get('/users/select', { params: { active: 0 } });
    USERS_CACHE = Array.isArray(data) ? data : [];
    if (USERS_CACHE.length) return USERS_CACHE;
  } catch {}
  try {
    const { data } = await api.get('/users');
    USERS_CACHE = Array.isArray(data) ? data : [];
  } catch {
    USERS_CACHE = [];
  }
  return USERS_CACHE;
}

async function fetchUserRecordById(uid) {
  if (!uid) return null;
  try {
    const { data } = await api.get(`/users/${uid}`);
    return data || null;
  } catch {
    const list = await fetchUsersIndex();
    return list.find((u) => Number(u.id) === Number(uid)) || null;
  }
}

/* ===== Detección flexible del “ejecutivo” en la organización ===== */
const DIRECT_ID_KEYS = [
  'account_exec_id',
  'account_executive_id',
  'exec_user_id',
  'account_manager_id',
  'manager_user_id',
  'sales_rep_id',
  'assigned_user_id',
  'user_id',
  'userId',
  'owner_user_id',
  'ownerId',
  'ejecutivo_cuenta_id',
  'ejecutivo_de_cuenta_id',
  'account_exec_user_id',
];

const DIRECT_NAME_KEYS = [
  'account_exec_name',
  'exec_user_name',
  'account_manager_name',
  'sales_rep_name',
  'user_name',
  'ejecutivo_cuenta',
  'ejecutivo_de_cuenta',
  'account_exec',
];

const USER_ID_KEY_REGEXES = [
  /(account|acct).*exec.*(_)?user.*id$/i,
  /(account|acct).*exec.*id$/i,
  /exec.*(_)?user.*id$/i,
  /exec.*id$/i,
  /assigned.*(_)?user.*id$/i,
  /manager.*(_)?user.*id$/i,
  /owner.*(_)?user.*id$/i,
  /(^|_)user(id)?s?$/i,
  /(^|_)user_?id$/i,
  /owner(id)?$/i,
];

function pickBestIdKey(candidates) {
  if (!candidates.length) return null;
  const withScore = candidates.map((k) => {
    let score = 0;
    if (/exec/i.test(k)) score += 5;
    if (/account/i.test(k)) score += 3;
    if (/assigned/i.test(k)) score += 2;
    if (/owner/i.test(k)) score += 1;
    return { k, score };
  });
  withScore.sort((a, b) => b.score - a.score);
  return withScore[0].k;
}

function getExecFromOrg(org) {
  if (!org) return { id: null, name: null };

  for (const k of DIRECT_ID_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(org, k)) continue;
    const id = coerceId(org[k]);
    if (id) return { id, name: null };
    const raw = org[k];
    if (typeof raw === 'object' && raw) {
      const nestedId = coerceId(raw.id ?? raw.user_id ?? raw.userId);
      if (nestedId) return { id: nestedId, name: null };
      const maybeName =
        raw.name ||
        [raw.first_name, raw.last_name].filter(Boolean).join(' ') ||
        raw.username ||
        raw.email ||
        null;
      if (maybeName) return { id: null, name: String(maybeName) };
    }
    if (typeof raw === 'string' && raw.trim() && !/^\d+$/.test(raw.trim())) {
      return { id: null, name: raw.trim() };
    }
  }

  for (const k of DIRECT_NAME_KEYS) {
    if (Object.prototype.hasOwnProperty.call(org, k) && org[k]) {
      return { id: null, name: String(org[k]) };
    }
  }

  const genericCandidates = [];
  for (const [k, v] of Object.entries(org)) {
    if (v == null) continue;
    if (typeof v === 'object') {
      const nestedId = coerceId(v.id ?? v.user_id ?? v.userId);
      if (nestedId && USER_ID_KEY_REGEXES.some((rx) => rx.test(k)))
        genericCandidates.push(k);
      continue;
    }
    const id = coerceId(v);
    if (id && USER_ID_KEY_REGEXES.some((rx) => rx.test(k)))
      genericCandidates.push(k);
  }
  const bestKey = pickBestIdKey(genericCandidates);
  if (bestKey) {
    const id = coerceId(org[bestKey]);
    if (id) return { id, name: null };
  }

  if (org.owner && typeof org.owner === 'object') {
    const nestedId = coerceId(org.owner.id ?? org.owner.user_id ?? org.owner.userId);
    if (nestedId) return { id: nestedId, name: null };
    const maybeName =
      org.owner.name ||
      [org.owner.first_name, org.owner.last_name].filter(Boolean).join(' ') ||
      org.owner.username ||
      org.owner.email ||
      null;
    if (maybeName) return { id: null, name: String(maybeName) };
  }

  return { id: null, name: null };
}

function getExecFromCF(customFields) {
  if (!Array.isArray(customFields)) return { id: null, name: null };
  const idKeys = [
    'account_exec_id',
    'account_executive_id',
    'ejecutivo_cuenta',
    'ejecutivo_de_cuenta',
    'sales_rep_id',
    'assigned_user_id',
    'user_id',
    'user',
    'owner_user_id',
    'ownerId',
  ];
  for (const k of idKeys) {
    const cf = customFields.find(
      (x) => (x?.key || '').toLowerCase() === k.toLowerCase()
    );
    if (!cf) continue;
    const raw = cf.value ?? cf.default_value;
    const id = coerceId(raw);
    if (id) return { id, name: null };
    if (typeof raw === 'string' && raw.trim() && !/^\d+$/.test(raw.trim())) {
      return { id: null, name: raw.trim() };
    }
  }
  return { id: null, name: null };
}

/* ===== Helpers Notas ===== */
function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return String(dateStr);
  return d.toLocaleDateString();
}
function fmtTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Normaliza un row de activity (type=note) a nuestro esquema de nota
function normalizeNoteFromActivity(r) {
  if (!r) return null;
  const id = r.id ?? r.activity_id ?? null;
  const content = r.notes ?? r.subject ?? r.content ?? '';
  const created =
    r.created_at ??
    r.updated_at ??
    r.due_date ??
    null;

  const user_id =
    coerceId(r.user_id) ??
    coerceId(r.owner_user_id) ??
    coerceId(r.created_by) ??
    coerceId(r.created_by_user_id) ??
    null;

  const user_name =
    r.user_name ??
    r.created_by_name ??
    (r.user && (r.user.name || r.user.username || r.user.email)) ??
    null;

  return {
    id,
    content: String(content || ''),
    created_at: created,
    user_id,
    user_name,
  };
}

// Enriquecer con nombres de usuario desde cache
async function enrichNotesAuthors(list) {
  if (!Array.isArray(list) || !list.length) return [];
  const cache = await fetchUsersIndex();
  const map = new Map(cache.map((u) => [Number(u.id), u]));
  return list.map((n) => {
    if (n.user_name) return n;
    const uid = Number(n.user_id || 0);
    if (uid && map.has(uid)) {
      const { name } = extractUserDisplay(map.get(uid), uid);
      return { ...n, user_name: name };
    }
    return n;
  });
}

export default function OrganizationDetail() {
  const { id } = useParams();
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  // tabs panel principal
  const [tab, setTab] = useState('activity'); // activity | timeline | notes | files | docs
  const [composer, setComposer] = useState('');

  // actividades
  const [acts, setActs] = useState([]);
  const [actsLoading, setActsLoading] = useState(false);

  // NOTAS (vía /activities type=note)
  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteDate, setNoteDate] = useState('');
  const [noteTime, setNoteTime] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // modales
  const [openAct, setOpenAct] = useState(false);
  const [openDeal, setOpenDeal] = useState(false);
  const [openPerson, setOpenPerson] = useState(false);
  const [openEdit, setOpenEdit] = useState(false); // editar detalles

  // tratos de esta organización
  const [orgDeals, setOrgDeals] = useState([]);
  const [dealsLoading, setDealsLoading] = useState(false);

  // ===== Campos personalizados =====
  const [cfLoading, setCfLoading] = useState(false);
  const [customFields, setCustomFields] = useState([]);
  const [cfSupported, setCfSupported] = useState(true);
  const [openAddCF, setOpenAddCF] = useState(false);

  // ===== Ejecutivo de cuenta =====
  const [accountExec, setAccountExec] = useState(null);
  const [execLoading, setExecLoading] = useState(false);
  const [execIdRaw, setExecIdRaw] = useState(null);
  const [execNameRaw, setExecNameRaw] = useState(null);

  // edición inline del ejecutivo
  const [editExec, setEditExec] = useState(false);
  const [execSelection, setExecSelection] = useState(null);
  const [savingExec, setSavingExec] = useState(false);

  // Rutas de flete asociadas a la organización
  const [fleteRoutes, setFleteRoutes] = useState([]);
  const [fleteRoutesLoading, setFleteRoutesLoading] = useState(false);

  // === helpers de carga ===
  async function loadOrg() {
    const { data } = await api.get(`/organizations/${id}`);
    setOrg(data);
  }
  async function loadActivities() {
    setActsLoading(true);
    try {
      const { data } = await api.get('/activities', {
        params: { org_id: Number(id) },
      });
      setActs(Array.isArray(data) ? data : []);
    } finally {
      setActsLoading(false);
    }
  }
  async function loadOrgDeals() {
    setDealsLoading(true);
    try {
      const { data } = await api.get('/deals', { params: { org_id: Number(id) } });
      setOrgDeals(Array.isArray(data) ? data : []);
    } catch {
      setOrgDeals([]);
    } finally {
      setDealsLoading(false);
    }
  }
  async function loadCustomFields() {
    setCfLoading(true);
    try {
      const { data } = await api.get(`/organizations/${id}/custom-fields`);
      if (Array.isArray(data)) setCustomFields(data);
      setCfSupported(true);
    } catch {
      setCfSupported(false);
      setCustomFields([]);
    } finally {
      setCfLoading(false);
    }
  }

  async function loadFleteRoutes() {
    setFleteRoutesLoading(true);
    try {
      const { data } = await api.get(`/organizations/${id}/flete-routes`);
      setFleteRoutes(Array.isArray(data) ? data : []);
    } catch {
      setFleteRoutes([]);
    } finally {
      setFleteRoutesLoading(false);
    }
  }

  // ===== NOTAS: lectura =====
  async function loadNotes() {
    setNotesLoading(true);
    try {
      const { data } = await api.get('/activities', {
        params: { org_id: Number(id), type: 'note' },
      });
      const list = Array.isArray(data) ? data : [];
      const norm = list.map(normalizeNoteFromActivity).filter(Boolean);
      setNotes(await enrichNotesAuthors(norm));
    } finally {
      setNotesLoading(false);
    }
  }

  // Alta de nota
  async function addOrgNote() {
    const text = (noteText || '').trim();
    if (!text) return;
    setSavingNote(true);
    try {
      const hasDT = !!noteDate || !!noteTime;
      const created_at = (() => {
        if (!hasDT) return null;
        const d = noteDate || new Date().toISOString().slice(0, 10);
        const t = (noteTime || '00:00') + ':00';
        return `${d}T${t}`;
      })();

      const payload = {
        type: 'note',
        subject: null,
        notes: text,
        org_id: Number(id),
        done: 1,
      };
      if (created_at) payload.created_at = created_at;

      await api.post('/activities', payload);
      await loadNotes();
      setNoteText('');
      setNoteDate('');
      setNoteTime('');
    } catch {
      alert('No se pudo crear la nota.');
    } finally {
      setSavingNote(false);
    }
  }

  // cargar organización + tratos + CF + rutas de flete
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        setLoading(true);
        await loadOrg();
        await loadOrgDeals();
        await loadCustomFields();
        await loadFleteRoutes();
      } catch (e) {
        if (!cancel) setErr('No se pudo cargar la organización.');
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [id]);

  // cargar actividades cuando el tab es "activity"
  useEffect(() => {
    if (tab !== 'activity') return;
    let cancel = false;
    (async () => {
      try {
        await loadActivities();
      } catch {
        if (!cancel) setActs([]);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [tab, id]);

  // cargar notas cuando el tab es "notes"
  useEffect(() => {
    if (tab !== 'notes') return;
    let cancel = false;
    (async () => {
      try {
        await loadNotes();
      } catch {
        if (!cancel) setNotes([]);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [tab, id]);

  // Resolver ejecutivo de cuenta
  useEffect(() => {
    let live = true;
    (async () => {
      setExecLoading(true);
      setExecIdRaw(null);
      setExecNameRaw(null);
      setAccountExec(null);

      if (!org) {
        if (live) setExecLoading(false);
        return;
      }

      const fromOrg = getExecFromOrg(org);
      const fromCF =
        !fromOrg.id && !fromOrg.name
          ? getExecFromCF(customFields)
          : { id: null, name: null };

      const execId = fromOrg.id || fromCF.id || null;
      const nameFallback = fromOrg.name || fromCF.name || null;

      if (execId != null) setExecIdRaw(execId);
      if (nameFallback != null) setExecNameRaw(nameFallback);

      if (execId) {
        const rec = await fetchUserRecordById(execId);
        if (!live) return;
        const { name, email } = extractUserDisplay(rec, execId);
        if (name) {
          setAccountExec({ id: Number(execId), name, email });
          setExecLoading(false);
          return;
        }
      }

      if (nameFallback) {
        if (live)
          setAccountExec({
            id: null,
            name: String(nameFallback),
            email: '',
          });
      }

      if (live) setExecLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [org, customFields]);

  // inicializar selección cuando cambia lo detectado
  useEffect(() => {
    setExecSelection(accountExec?.id ?? execIdRaw ?? null);
  }, [accountExec?.id, execIdRaw, id]);

  /* ===== Timeline combinado (actividades + tratos) ===== */
  const timelineItems = useMemo(() => {
    const items = [];

    // Actividades
    acts.forEach((a) => {
      const date = a.due_date || a.created_at;
      items.push({
        id: `act-${a.id}`,
        kind: 'activity',
        title: a.subject || 'Actividad',
        description: a.notes || '',
        date,
      });
    });

    // Tratos
    orgDeals.forEach((d) => {
      const date = d.updated_at || d.created_at;
      items.push({
        id: `deal-${d.id}`,
        kind: 'deal',
        title: d.title || 'Trato',
        description: d.value
          ? `Valor: ${Number(d.value).toLocaleString()} ${
              d.currency || ''
            }`
          : '',
        date,
      });
    });

    return items
      .filter((i) => i.date)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [acts, orgDeals]);

  async function saveExecAssignment() {
    setSavingExec(true);
    try {
      await api.patch(`/organizations/${id}`, {
        owner_user_id: execSelection ?? null,
      });
      await loadOrg();
      setEditExec(false);
    } catch {
      alert('No se pudo guardar el ejecutivo.');
    } finally {
      setSavingExec(false);
    }
  }

  async function saveQuickActivity() {
    const subject = (composer || '').trim();
    if (!subject) return;
    try {
      await api.post('/activities', {
        type: 'task',
        subject,
        org_id: Number(id),
        done: 0,
      });
      setComposer('');
      if (tab !== 'activity') setTab('activity');
      await loadActivities();
    } catch {
      alert('No se pudo guardar la actividad.');
    }
  }

  if (loading)
    return <p className="text-sm text-slate-600">Cargando…</p>;
  if (err) return <p className="text-sm text-red-600">{err}</p>;
  if (!org)
    return (
      <p className="text-sm text-slate-600">Organización no encontrada.</p>
    );

  // 👇 Detectamos si es organización de Flete
  const isFreightOrg =
    (org.tipo_org || '').toLowerCase().includes('flete') ||
    (org.rubro || '').toLowerCase().includes('flete');

  const freightModalities = parseModalitiesCSV(org.modalities_supported);

  return (
    <div className="space-y-4">
      {/* ====== Header estilo Pipedrive ====== */}
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
              🏢
            </div>
            <div className="min-w-0">
              <div className="text-xl font-semibold truncate">
                {org.razon_social || org.name || '—'}
              </div>
              <div className="text-xs text-slate-600 truncate">
                Propietario: {org.owner_user_id || '—'} • Visibilidad:{' '}
                {org.visibility || 'company'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-2 text-sm rounded-lg border"
              onClick={() =>
                alert('Próximamente: seguir/seguidores')
              }
            >
              1 seguidor
            </button>
            <button
              className="px-3 py-2 text-sm rounded-lg bg-emerald-600 text-white"
              onClick={() => setOpenDeal(true)}
            >
              + Trato
            </button>
            <button
              className="px-3 py-2 text-sm rounded-lg border"
              onClick={() => setOpenEdit(true)}
            >
              Editar
            </button>
            <button
              className="px-3 py-2 text-sm rounded-lg border"
              onClick={() => alert('Opciones')}
            >
              ⋯
            </button>
          </div>
        </div>
      </div>

      {/* ====== Layout de dos columnas ====== */}
      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
        {/* ===== Sidebar izquierda ===== */}
        <aside className="space-y-4">
          {/* Detalles */}
          <section className="bg-white rounded-2xl shadow">
            <header className="px-4 py-3 border-b font-medium flex items-center justify-between">
              <span>Detalles</span>
              <button
                className="text-sm text-blue-600 hover:underline"
                onClick={() => setOpenEdit(true)}
              >
                Editar
              </button>
            </header>
            <div className="p-4">
              <div className="space-y-2">
                <FieldRow
                  label="Razón Social"
                  value={org.razon_social || org.name}
                />
                <FieldRow label="RUC" value={org.ruc} />
                <FieldRow label="Dirección" value={org.address} />
                <FieldRow label="Email" value={org.email} />
                <FieldRow label="Ciudad" value={org.city} />
                <FieldRow label="País" value={org.country} />
                <FieldRow label="Teléfono" value={org.phone} />
                <FieldRow label="Rubro" value={org.rubro} />
                <FieldRow label="Tipo org" value={org.tipo_org} />
                <FieldRow label="Operación" value={org.operacion} />
                <FieldRow label="Notas" value={org.notes} />
                <FieldRow label="Creado">
                  {org.created_at
                    ? new Date(org.created_at).toLocaleDateString()
                    : '—'}
                </FieldRow>
              </div>
            </div>
          </section>

          {/* 👇 Hoja de ruta (solo flete) */}
          {isFreightOrg && (
            <section className="bg-white rounded-2xl shadow">
              <header className="px-4 py-3 border-b font-medium flex items-center justify-between">
                <span>Hoja de ruta (flete)</span>
                <button
                  className="text-sm text-blue-600 hover:underline"
                  onClick={() => setOpenEdit(true)}
                >
                  Editar
                </button>
              </header>
              <div className="p-4 space-y-3 text-sm">
                <FieldRow label="Tipo de flete">
                  {freightModalities.length ? (
                    <div className="flex flex-wrap justify-end gap-1">
                      {freightModalities.map((m) => (
                        <span
                          key={m}
                          className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-xs text-slate-700"
                        >
                          {m === 'aerea' && '✈️ Aéreo'}
                          {m === 'maritima' && '🚢 Marítimo'}
                          {m === 'terrestre' && '🚚 Terrestre'}
                          {m === 'fluvial' && '🛳 Fluvial'}
                          {m !== 'aerea' &&
                            m !== 'maritima' &&
                            m !== 'terrestre' &&
                            m !== 'fluvial' &&
                            m}
                        </span>
                      ))}
                    </div>
                  ) : (
                    '—'
                  )}
                </FieldRow>

                <div>
                  <div className="text-xs text-slate-500 mb-1 text-left">
                    Cobertura / Hoja de ruta (texto libre)
                  </div>
                  <div className="text-sm text-slate-900 whitespace-pre-wrap text-right">
                    {org.hoja_ruta || '—'}
                  </div>
                </div>

                <div className="pt-2">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs text-slate-500">
                      Rutas registradas (estructura)
                    </div>
                    {fleteRoutesLoading && (
                      <span className="text-[11px] text-slate-500">
                        Cargando…
                      </span>
                    )}
                  </div>
                  {!fleteRoutesLoading && fleteRoutes.length === 0 && (
                    <div className="text-xs text-slate-500 text-right">
                      No hay rutas estructuradas cargadas para este
                      proveedor.
                    </div>
                  )}
                  {fleteRoutes.length > 0 && (
                    <ul className="space-y-1 text-xs text-right">
                      {fleteRoutes.map((r) => (
                        <li key={r.id}>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 mr-1 capitalize">
                            {r.modality === 'aereo' && '✈️ Aéreo'}
                            {r.modality === 'maritimo' && '🚢 Marítimo'}
                            {r.modality === 'terrestre' && '🚚 Terrestre'}
                            {r.modality !== 'aereo' &&
                              r.modality !== 'maritimo' &&
                              r.modality !== 'terrestre' &&
                              (r.modality || '')}
                          </span>
                          <span>
                            {r.origin || 'Cualquier origen'} →{' '}
                            {r.destination || 'Cualquier destino'}
                          </span>
                          {(r.origin_country || r.destination_country) && (
                            <span className="ml-1 text-slate-500">
                              ({r.origin_country || '?'} →{' '}
                              {r.destination_country || '?'})
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* Campos personalizados */}
          <section className="bg-white rounded-2xl shadow">
            <header className="px-4 py-3 border-b font-medium flex items-center justify-between">
              <span>Campos personalizados</span>
              {cfSupported && (
                <button
                  className="text-sm text-blue-600 hover:underline"
                  onClick={() => setOpenAddCF(true)}
                >
                  + Añadir campo
                </button>
              )}
            </header>

            <div className="p-4 space-y-2">
              {!cfSupported && (
                <div className="text-sm text-slate-600">
                  (Aún no hay endpoint para campos personalizados. Cuando
                  agregues la API, este panel cargará y guardará valores
                  automáticamente).
                </div>
              )}

              {cfSupported &&
                (cfLoading ? (
                  <div className="text-sm text-slate-600">
                    Cargando campos…
                  </div>
                ) : customFields.length ? (
                  <ul className="space-y-2">
                    {customFields.map((cf) => (
                      <li
                        key={cf.id}
                        className="flex items-center justify-between gap-2"
                      >
                        <div className="text-sm">
                          <div className="font-medium">
                            {cf.label || cf.key}
                          </div>
                          <div className="text-slate-600 text-xs">
                            {cf.type || 'text'} • {cf.key}
                          </div>
                        </div>
                        <InlineCFEditor
                          cf={cf}
                          onSave={async (newValue) => {
                            try {
                              await api.put(
                                `/organizations/${id}/custom-fields/${cf.id}`,
                                { value: newValue }
                              );
                              await loadCustomFields();
                            } catch {
                              alert('No se pudo guardar el campo.');
                            }
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-sm text-slate-600">
                    No hay campos personalizados.
                  </div>
                ))}
            </div>
          </section>

          {/* Tratos */}
          <section className="bg-white rounded-2xl shadow">
            <header className="px-4 py-3 border-b font-medium flex items-center justify-between">
              <span>Tratos</span>
              <button
                className="text-sm text-blue-600 hover:underline"
                onClick={() => setOpenDeal(true)}
              >
                + Añadir
              </button>
            </header>
            <div className="p-4 text-sm">
              {dealsLoading ? (
                <div className="text-slate-600">Cargando tratos…</div>
              ) : orgDeals.length ? (
                <ul className="space-y-2">
                  {orgDeals.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between"
                    >
                      <span className="truncate">{d.title}</span>
                      <span className="text-slate-600">
                        ${Number(d.value || 0).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-slate-600">
                  Sin tratos vinculados.
                </div>
              )}
            </div>
          </section>

          {/* Personas */}
          <section className="bg-white rounded-2xl shadow">
            <header className="px-4 py-3 border-b font-medium flex items-center justify-between">
              <span>Personas</span>
              <button
                className="text-sm text-blue-600 hover:underline"
                onClick={() => setOpenPerson(true)}
              >
                + Persona
              </button>
            </header>
            <div className="p-4">
              <ul className="space-y-2">
                {(org.contacts || []).map((c) => (
                  <li key={c.id} className="text-sm">
                    {c.name}{' '}
                    <span className="text-slate-500">
                      ({c.email || 'sin email'})
                    </span>
                  </li>
                ))}
                {!org.contacts?.length && (
                  <div className="text-sm text-slate-600">
                    Sin personas.
                  </div>
                )}
              </ul>
            </div>
          </section>

          {/* ===== Ejecutivo de cuenta ===== */}
          <section className="bg-white rounded-2xl shadow">
            <header className="px-4 py-3 border-b font-medium flex items-center justify-between">
              <span>Ejecutivo de cuenta</span>
              <button
                className="text-sm text-blue-600 hover:underline"
                onClick={() => setEditExec((v) => !v)}
              >
                {editExec ? 'Cancelar' : 'Editar'}
              </button>
            </header>
            <div className="p-4 text-sm">
              {execLoading ? (
                <div className="text-slate-600">
                  Cargando ejecutivo…
                </div>
              ) : editExec ? (
                <div className="space-y-2">
                  <AccountExecutiveSelect
                    value={execSelection ?? null}
                    onChange={setExecSelection}
                    onlyActive={false}
                    label="Seleccionar"
                    placeholder="— Sin asignar —"
                  />
                  <div className="pt-1 flex gap-2">
                    <button
                      className="px-3 py-2 text-sm rounded-lg bg-black text-white disabled:opacity-60"
                      onClick={saveExecAssignment}
                      disabled={savingExec}
                    >
                      {savingExec ? 'Guardando…' : 'Guardar'}
                    </button>
                    <button
                      className="px-3 py-2 text-sm rounded-lg border"
                      onClick={() => {
                        setEditExec(false);
                        setExecSelection(
                          accountExec?.id ?? execIdRaw ?? null
                        );
                      }}
                      disabled={savingExec}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : accountExec ? (
                <div>
                  <div className="font-medium">{accountExec.name}</div>
                  <div className="text-slate-600">
                    {accountExec.email || '—'}
                  </div>
                </div>
              ) : execIdRaw != null ? (
                <div className="text-slate-600">
                  Usuario #{String(execIdRaw)} no accesible
                </div>
              ) : execNameRaw ? (
                <div>
                  <div className="font-medium">{execNameRaw}</div>
                </div>
              ) : (
                <div className="text-slate-600">— Sin asignar —</div>
              )}
            </div>
          </section>
        </aside>

        {/* ===== Panel principal ===== */}
        <section className="space-y-4">
          {/* Tabs */}
          <div className="bg-white rounded-2xl shadow">
            <div className="px-4 pt-3 border-b">
              <div className="flex items-center gap-2">
                {[
                  { key: 'activity', label: 'Actividad', icon: '📅' },
                  { key: 'timeline', label: 'Timeline', icon: '⏱️' },
                  { key: 'notes', label: 'Notas', icon: '📝' },
                  { key: 'files', label: 'Archivos', icon: '📎' },
                  { key: 'docs', label: 'Documentos', icon: '📄' },
                ].map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`px-3 py-2 rounded-t-lg text-sm ${
                      tab === t.key
                        ? 'bg-black text-white'
                        : 'hover:bg-slate-100'
                    }`}
                  >
                    <span className="mr-1">{t.icon}</span>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Composer (solo en Actividad) */}
            {tab === 'activity' && (
              <div className="p-4 border-b">
                <textarea
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  rows={2}
                  placeholder="Haz clic aquí para añadir una actividad…"
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    className="px-3 py-2 text-sm rounded-lg bg-black text-white"
                    onClick={saveQuickActivity}
                  >
                    Guardar
                  </button>
                  <button
                    className="px-3 py-2 text-sm rounded-lg border"
                    onClick={() => setComposer('')}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* Composer Notas (solo en Notas) */}
            {tab === 'notes' && (
              <div className="p-4 border-b">
                <label className="block text-sm mb-2">Nueva nota</label>
                <textarea
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  rows={3}
                  placeholder="Escribí la nota…"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                />
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
                  <div className="text-xs text-slate-600">
                    Si dejás la fecha y hora vacías, se usará la fecha/hora
                    actual del servidor.
                  </div>
                  <label className="text-sm">
                    <div className="text-slate-600 mb-1">Fecha</div>
                    <input
                      type="date"
                      className="border rounded-lg px-2 py-1 text-sm"
                      value={noteDate}
                      onChange={(e) => setNoteDate(e.target.value)}
                    />
                  </label>
                  <label className="text-sm">
                    <div className="text-slate-600 mb-1">Hora</div>
                    <input
                      type="time"
                      className="border rounded-lg px-2 py-1 text-sm"
                      value={noteTime}
                      onChange={(e) => setNoteTime(e.target.value)}
                    />
                  </label>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    className="px-3 py-2 text-sm rounded-lg bg-black text-white disabled:opacity-60"
                    onClick={addOrgNote}
                    disabled={savingNote || !noteText.trim()}
                  >
                    {savingNote ? 'Guardando…' : 'Guardar nota'}
                  </button>
                  <button
                    className="px-3 py-2 text-sm rounded-lg border"
                    onClick={() => {
                      setNoteText('');
                      setNoteDate('');
                      setNoteTime('');
                    }}
                    disabled={savingNote}
                  >
                    Limpiar
                  </button>
                </div>
              </div>
            )}

            {/* Contenido del tab */}
            <div className="p-4">
              {tab === 'activity' && (
                <div className="space-y-3">
                  <div className="text-sm text-slate-600 mb-2">
                    Enfoque — Aquí aparecerán actividades programadas, notas
                    ancladas, borradores, etc.
                  </div>

                  <button
                    className="text-blue-600 hover:underline text-sm"
                    onClick={() => setOpenAct(true)}
                  >
                    + Programar una actividad
                  </button>

                  <h4 className="mt-4 font-medium">Historial</h4>
                  {actsLoading ? (
                    <div className="text-sm text-slate-600">
                      Cargando actividades…
                    </div>
                  ) : acts.length ? (
                    <ul className="space-y-2">
                      {acts.map((a) => (
                        <li
                          key={a.id}
                          className="border rounded-xl p-3"
                        >
                          <div className="text-sm font-medium">
                            {a.type || 'actividad'} —{' '}
                            {a.subject || 'sin asunto'}
                          </div>
                          <div className="text-xs text-slate-600">
                            Vence: {a.due_date || '—'} • Creado:{' '}
                            {a.created_at
                              ? new Date(
                                  a.created_at
                                ).toLocaleDateString()
                              : '—'}
                          </div>
                          {a.notes && (
                            <div className="text-sm mt-1">
                              {a.notes}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-sm text-slate-500">
                      Sin actividades.
                    </div>
                  )}
                </div>
              )}

              {tab === 'timeline' && (
                <div className="space-y-3">
                  <h4 className="font-medium">Timeline</h4>
                  {timelineItems.length ? (
                    <ul className="space-y-2">
                      {timelineItems.map((item) => (
                        <li
                          key={item.id}
                          className="flex items-start gap-2"
                        >
                          <div className="mt-1">
                            {item.kind === 'activity' && '📅'}
                            {item.kind === 'deal' && '💼'}
                            {item.kind !== 'activity' &&
                              item.kind !== 'deal' &&
                              '•'}
                          </div>
                          <div className="flex-1 border rounded-xl p-3">
                            <div className="flex justify-between text-xs text-slate-600 mb-1">
                              <span className="uppercase tracking-wide">
                                {item.kind === 'activity'
                                  ? 'Actividad'
                                  : item.kind === 'deal'
                                  ? 'Trato'
                                  : item.kind}
                              </span>
                              <span>
                                {fmtDate(item.date)}{' '}
                                {fmtTime(item.date)}
                              </span>
                            </div>
                            <div className="text-sm font-medium">
                              {item.title}
                            </div>
                            {item.description && (
                              <div className="text-sm text-slate-700 whitespace-pre-wrap mt-1">
                                {item.description}
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-sm text-slate-500">
                      No hay eventos aún en el timeline.
                    </div>
                  )}
                </div>
              )}

              {tab === 'notes' && (
                <div className="space-y-3">
                  <h4 className="font-medium">Notas</h4>
                  {notesLoading ? (
                    <div className="text-sm text-slate-600">
                      Cargando notas…
                    </div>
                  ) : notes.length ? (
                    <ul className="space-y-2">
                      {notes
                        .slice()
                        .sort(
                          (a, b) =>
                            new Date(b.created_at || 0) -
                            new Date(a.created_at || 0)
                        )
                        .map((n) => (
                          <li
                            key={
                              n.id ||
                              `${n.created_at}-${Math.random()}`
                            }
                            className="border rounded-xl p-3"
                          >
                            <div className="text-sm whitespace-pre-wrap">
                              {n.content || '—'}
                            </div>
                            <div className="text-xs text-slate-600 mt-1">
                              {n.user_name ||
                                (n.user_id
                                  ? `Usuario #${n.user_id}`
                                  : '—')}{' '}
                              • {fmtDate(n.created_at)}{' '}
                              {fmtTime(n.created_at)}
                            </div>
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <div className="text-sm text-slate-500">
                      Sin notas todavía.
                    </div>
                  )}
                </div>
              )}

              {tab === 'files' && (
                <div className="text-sm text-slate-600">
                  Archivos (placeholder).
                </div>
              )}
              {tab === 'docs' && (
                <div className="text-sm text-slate-600">
                  Documentos (placeholder).
                </div>
              )}
            </div>
          </div>

          {/* Volver */}
          <div>
            <Link
              to="/organizations"
              className="text-blue-600 hover:underline"
            >
              ← Volver a lista
            </Link>
          </div>
        </section>
      </div>

      {/* Modales */}
      {openAct && (
        <NewActivityModal
          orgId={id}
          onClose={() => setOpenAct(false)}
          onCreated={async () => {
            if (tab !== 'activity') setTab('activity');
            await loadActivities();
          }}
        />
      )}

      {openDeal && (
        <NewDealModal
          orgId={id}
          onClose={() => setOpenDeal(false)}
          onCreated={async () => {
            await loadOrgDeals();
          }}
        />
      )}

      {openPerson && (
        <NewPersonModal
          orgId={id}
          onClose={() => setOpenPerson(false)}
          onCreated={async () => {
            await loadOrg();
          }}
        />
      )}

      {openEdit && (
        <EditOrgModal
          org={org}
          onClose={() => setOpenEdit(false)}
          onSaved={async () => {
            await loadOrg();
            await loadFleteRoutes();
          }}
        />
      )}

      {openAddCF && (
        <AddCustomFieldModal
          orgId={id}
          onClose={() => setOpenAddCF(false)}
          onCreated={async () => {
            await loadCustomFields();
          }}
        />
      )}
    </div>
  );
}

/* ===== Inline editor / Modales ===== */
function InlineCFEditor({ cf, onSave }) {
  const [v, setV] = useState(cf.value ?? '');
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await onSave(v);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="flex items-center gap-2">
      {cf.type === 'number' ? (
        <input
          type="number"
          className="border rounded-lg px-2 py-1 text-sm w-40"
          value={v}
          onChange={(e) => setV(e.target.value)}
        />
      ) : cf.type === 'date' ? (
        <input
          type="date"
          className="border rounded-lg px-2 py-1 text-sm"
          value={v || ''}
          onChange={(e) => setV(e.target.value)}
        />
      ) : (
        <input
          className="border rounded-lg px-2 py-1 text-sm w-48"
          value={v}
          onChange={(e) => setV(e.target.value)}
        />
      )}
      <button
        className="px-2 py-1 text-xs rounded border"
        onClick={save}
        disabled={saving}
      >
        {saving ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  );
}

function EditOrgModal({ org, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: org.name || '',
    industry: org.industry || '',
    phone: org.phone || '',
    website: org.website || '',
    ruc: org.ruc || '',
    address: org.address || '',
    city: org.city || '',
    country: org.country || '',
    label: org.label || '',
    owner_user_id: org.owner_user_id || null,
    visibility: org.visibility || 'company',
    notes: org.notes || '',
    is_agent: Number(org.is_agent) ? 1 : 0,
    modalities_supported: org.modalities_supported || null,
    hoja_ruta: org.hoja_ruta || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  function upd(k, v) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }
  const parsedModalities = parseModalitiesCSV(
    form.modalities_supported
  );
  function toggleModality(m) {
    const next = parsedModalities.includes(m)
      ? parsedModalities.filter((x) => x !== m)
      : [...parsedModalities, m];
    upd('modalities_supported', toCSV(next));
  }

  const isFreight =
    (org.tipo_org || '').toLowerCase().includes('flete') ||
    (org.rubro || '').toLowerCase().includes('flete');

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setSaving(true);
    try {
      const payload = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [
          k,
          v === '' ? null : v,
        ])
      );
      if (payload?.owner_user_id != null) {
        const n = Number(payload.owner_user_id);
        payload.owner_user_id =
          Number.isFinite(n) && n > 0 ? n : null;
      }
      payload.is_agent = payload.is_agent ? 1 : 0;
      await api.patch(`/organizations/${org.id}`, payload);
      onSaved?.();
      onClose?.();
    } catch {
      setErr('No se pudo guardar los cambios.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <form
        onSubmit={submit}
        className="bg-white rounded-2xl p-4 w-full max-w-2xl space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            Editar organización
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm"
          >
            ✕
          </button>
        </div>
        {err && (
          <div className="text-sm text-red-600">{err}</div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block text-sm">
            Nombre
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={form.name}
              onChange={(e) => upd('name', e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Industria
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={form.industry}
              onChange={(e) => upd('industry', e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Teléfono
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={form.phone}
              onChange={(e) => upd('phone', e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Website
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={form.website}
              onChange={(e) => upd('website', e.target.value)}
            />
          </label>
          <label className="block text-sm">
            RUC
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={form.ruc ?? ''}
              onChange={(e) => upd('ruc', e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Dirección
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={form.address}
              onChange={(e) => upd('address', e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Ciudad
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={form.city}
              onChange={(e) => upd('city', e.target.value)}
            />
          </label>
          <label className="block text-sm">
            País
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={form.country}
              onChange={(e) => upd('country', e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Etiqueta
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={form.label}
              onChange={(e) => upd('label', e.target.value)}
            />
          </label>

          {/* Reemplazado por selector */}
          <div className="md:col-span-2">
            <AccountExecutiveSelect
              value={
                form.owner_user_id
                  ? Number(form.owner_user_id)
                  : null
              }
              onChange={(v) => upd('owner_user_id', v)}
              onlyActive={false}
              label="Ejecutivo / Owner"
              placeholder="— Sin asignar —"
            />
          </div>

          <label className="block text-sm">
            Visibilidad
            <select
              className="w-full border rounded-lg px-3 py-2"
              value={form.visibility}
              onChange={(e) =>
                upd('visibility', e.target.value)
              }
            >
              <option value="company">company</option>
              <option value="shared">shared</option>
              <option value="private">private</option>
            </select>
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="block text-sm md:col-span-1">
            <span className="block mb-2">¿Es agente?</span>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!Number(form.is_agent)}
                onChange={(e) =>
                  upd('is_agent', e.target.checked ? 1 : 0)
                }
              />
              <span>Marcar como agente</span>
            </label>
          </label>
          <div className="md:col-span-2">
            <div className="text-sm mb-2">
              Modalidades soportadas
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              {ALL_MODALITIES.map((m) => (
                <label
                  key={m}
                  className="inline-flex items-center gap-2"
                >
                  <input
                    type="checkbox"
                    checked={parseModalitiesCSV(
                      form.modalities_supported
                    ).includes(m)}
                    onChange={() => toggleModality(m)}
                  />
                  <span className="capitalize">{m}</span>
                </label>
              ))}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Se guardan como CSV en{' '}
              <code>modalities_supported</code>.
            </div>
          </div>
        </div>

        {/* Hoja de ruta (solo si es Flete) */}
        {isFreight && (
          <label className="block text-sm">
            Hoja de ruta (cobertura de flete)
            <textarea
              className="w-full border rounded-lg px-3 py-2"
              rows={3}
              placeholder="Ej: Aéreo: AR–BR–CL / Marítimo: Asia–Latam vía Panamá..."
              value={form.hoja_ruta ?? ''}
              onChange={(e) =>
                upd('hoja_ruta', e.target.value)
              }
            />
            <div className="text-xs text-slate-500 mt-1">
              Describí las rutas típicas, países y puertos que cubre
              este proveedor. Luego se podrá usar para filtrar
              proveedores por origen/destino.
            </div>
          </label>
        )}

        <label className="block text-sm">
          Notas
          <textarea
            className="w-full border rounded-lg px-3 py-2"
            rows={4}
            value={form.notes ?? ''}
            onChange={(e) => upd('notes', e.target.value)}
          />
        </label>
        <div className="pt-2 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 border rounded-lg"
          >
            Cancelar
          </button>
          <button
            className="px-3 py-2 rounded-lg bg-black text-white disabled:opacity-60"
            disabled={saving}
          >
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* 
  🔻 Desde acá para abajo podés dejar tus versiones actuales de:
  - AddCustomFieldModal
  - NewActivityModal
  - NewDealModal
  - NewPersonModal

  Si ya las tenías implementadas más completas en este archivo,
  copiá SOLO todo lo de arriba y conservá tus componentes de modal.
*/

// ... AddCustomFieldModal, NewActivityModal, NewDealModal, NewPersonModal

/* Modal para crear campo personalizado (stub simple) */
function AddCustomFieldModal({ orgId, onClose, onCreated }) {
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [type, setType] = useState('text');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!label.trim() || !key.trim()) {
      setErr('Completá etiqueta y clave.');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/organizations/${orgId}/custom-fields`, {
        label,
        key,
        type,
      });
      onCreated?.();
      onClose?.();
    } catch {
      setErr('No se pudo crear el campo (API pendiente o error).');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <form
        onSubmit={submit}
        className="bg-white rounded-2xl p-4 w-full max-w-md space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Nuevo campo personalizado</h3>
          <button type="button" onClick={onClose} className="text-sm">
            ✕
          </button>
        </div>
        {err && <div className="text-sm text-red-600">{err}</div>}
        <label className="block text-sm">
          Etiqueta
          <input
            className="w-full border rounded-lg px-3 py-2"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Clave (key)
          <input
            className="w-full border rounded-lg px-3 py-2"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Tipo
          <select
            className="w-full border rounded-lg px-3 py-2"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="text">Texto</option>
            <option value="number">Número</option>
            <option value="date">Fecha</option>
          </select>
        </label>
        <div className="pt-2 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 border rounded-lg"
          >
            Cancelar
          </button>
          <button
            className="px-3 py-2 rounded-lg bg-black text-white disabled:opacity-60"
            disabled={saving}
          >
            {saving ? 'Creando…' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* Modal: nueva actividad */
function NewActivityModal({ orgId, onClose, onCreated }) {
  const [type, setType] = useState('task');
  const [subject, setSubject] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!subject.trim()) {
      setErr('El asunto es obligatorio.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/activities', {
        type,
        subject,
        org_id: Number(orgId),
        due_date: dueDate || null,
        notes: notes || null,
        done: 0,
      });
      onCreated?.();
      onClose?.();
    } catch {
      setErr('No se pudo crear la actividad.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <form
        onSubmit={submit}
        className="bg-white rounded-2xl p-4 w-full max-w-md space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Nueva actividad</h3>
          <button type="button" onClick={onClose} className="text-sm">
            ✕
          </button>
        </div>
        {err && <div className="text-sm text-red-600">{err}</div>}
        <label className="block text-sm">
          Tipo
          <select
            className="w-full border rounded-lg px-3 py-2"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="task">Tarea</option>
            <option value="call">Llamada</option>
            <option value="meeting">Reunión</option>
            <option value="deadline">Vencimiento</option>
          </select>
        </label>
        <label className="block text-sm">
          Asunto
          <input
            className="w-full border rounded-lg px-3 py-2"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Fecha de vencimiento
          <input
            type="date"
            className="w-full border rounded-lg px-3 py-2"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Notas
          <textarea
            className="w-full border rounded-lg px-3 py-2"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <div className="pt-2 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 border rounded-lg"
          >
            Cancelar
          </button>
          <button
            className="px-3 py-2 rounded-lg bg-black text-white disabled:opacity-60"
            disabled={saving}
          >
            {saving ? 'Guardando…' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* Modal: nuevo trato */
function NewDealModal({ orgId, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!title.trim()) {
      setErr('El título es obligatorio.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/deals', {
        title,
        value: value ? Number(value) : null,
        currency,
        org_id: Number(orgId),
      });
      onCreated?.();
      onClose?.();
    } catch {
      setErr('No se pudo crear el trato.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <form
        onSubmit={submit}
        className="bg-white rounded-2xl p-4 w-full max-w-md space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Nuevo trato</h3>
          <button type="button" onClick={onClose} className="text-sm">
            ✕
          </button>
        </div>
        {err && <div className="text-sm text-red-600">{err}</div>}
        <label className="block text-sm">
          Título
          <input
            className="w-full border rounded-lg px-3 py-2"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Importe
          <input
            type="number"
            className="w-full border rounded-lg px-3 py-2"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Moneda
          <select
            className="w-full border rounded-lg px-3 py-2"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            <option value="USD">USD</option>
            <option value="PYG">PYG</option>
            <option value="BRL">BRL</option>
            <option value="EUR">EUR</option>
          </select>
        </label>
        <div className="pt-2 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 border rounded-lg"
          >
            Cancelar
          </button>
          <button
            className="px-3 py-2 rounded-lg bg-black text-white disabled:opacity-60"
            disabled={saving}
          >
            {saving ? 'Guardando…' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* Modal: nueva persona/contacto */
function NewPersonModal({ orgId, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!name.trim()) {
      setErr('El nombre es obligatorio.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/contacts', {
        name,
        email: email || null,
        phone: phone || null,
        title: title || null,
        org_id: Number(orgId),
      });
      onCreated?.();
      onClose?.();
    } catch {
      setErr('No se pudo crear la persona.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <form
        onSubmit={submit}
        className="bg-white rounded-2xl p-4 w-full max-w-md space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Nueva persona</h3>
          <button type="button" onClick={onClose} className="text-sm">
            ✕
          </button>
        </div>
        {err && <div className="text-sm text-red-600">{err}</div>}
        <label className="block text-sm">
          Nombre
          <input
            className="w-full border rounded-lg px-3 py-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Email
          <input
            className="w-full border rounded-lg px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Teléfono
          <input
            className="w-full border rounded-lg px-3 py-2"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Cargo / Título
          <input
            className="w-full border rounded-lg px-3 py-2"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="pt-2 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 border rounded-lg"
          >
            Cancelar
          </button>
          <button
            className="px-3 py-2 rounded-lg bg-black text-white disabled:opacity-60"
            disabled={saving}
          >
            {saving ? 'Guardando…' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  );
}