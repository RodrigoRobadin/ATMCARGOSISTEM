// client/src/pages/OrganizationDetail.jsx
import React, { useEffect, useState } from 'react';
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

const ALL_MODALITIES = ['aerea', 'maritima', 'fluvial'];

function parseModalitiesCSV(csv) {
  if (!csv) return [];
  return String(csv)
    .split(',')
    .map(s => s.trim().toLowerCase())
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
      email: ''
    };
  }
  const nameFromParts = [user.first_name, user.last_name].filter(Boolean).join(' ');
  let name = user.name || nameFromParts || user.username || user.email || (fallbackId != null ? `Usuario #${fallbackId}` : null);
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
    return list.find(u => Number(u.id) === Number(uid)) || null;
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
  const withScore = candidates.map(k => {
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
      const maybeName = raw.name || [raw.first_name, raw.last_name].filter(Boolean).join(' ') || raw.username || raw.email || null;
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
      if (nestedId && USER_ID_KEY_REGEXES.some(rx => rx.test(k))) genericCandidates.push(k);
      continue;
    }
    const id = coerceId(v);
    if (id && USER_ID_KEY_REGEXES.some(rx => rx.test(k))) genericCandidates.push(k);
  }
  const bestKey = pickBestIdKey(genericCandidates);
  if (bestKey) {
    const id = coerceId(org[bestKey]);
    if (id) return { id, name: null };
  }

  if (org.owner && typeof org.owner === 'object') {
    const nestedId = coerceId(org.owner.id ?? org.owner.user_id ?? org.owner.userId);
    if (nestedId) return { id: nestedId, name: null };
    const maybeName = org.owner.name || [org.owner.first_name, org.owner.last_name].filter(Boolean).join(' ') || org.owner.username || org.owner.email || null;
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
    const cf = customFields.find(x => (x?.key || '').toLowerCase() === k.toLowerCase());
    if (!cf) continue;
    const raw = (cf.value ?? cf.default_value);
    const id = coerceId(raw);
    if (id) return { id, name: null };
    if (typeof raw === 'string' && raw.trim() && !/^\d+$/.test(raw.trim())) {
      return { id: null, name: raw.trim() };
    }
  }
  return { id: null, name: null };
}

export default function OrganizationDetail() {
  const { id } = useParams();
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  // tabs panel principal
  const [tab, setTab] = useState('activity'); // activity | notes | files | docs
  const [composer, setComposer] = useState('');

  // actividades
  const [acts, setActs] = useState([]);
  const [actsLoading, setActsLoading] = useState(false);

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
  const [customFields, setCustomFields] = useState([]); // [{id,key,label,type,value}]
  const [cfSupported, setCfSupported] = useState(true);
  const [openAddCF, setOpenAddCF] = useState(false);

  // ===== Ejecutivo de cuenta =====
  const [accountExec, setAccountExec] = useState(null); // { id, name, email } | null
  const [execLoading, setExecLoading] = useState(false);
  const [execIdRaw, setExecIdRaw] = useState(null);
  const [execNameRaw, setExecNameRaw] = useState(null);

  // edición inline del ejecutivo
  const [editExec, setEditExec] = useState(false);
  const [execSelection, setExecSelection] = useState(null);
  const [savingExec, setSavingExec] = useState(false);

  // === helpers de carga ===
  async function loadOrg() {
    const { data } = await api.get(`/organizations/${id}`);
    setOrg(data);
  }
  async function loadActivities() {
    setActsLoading(true);
    try {
      const { data } = await api.get('/activities', { params: { org_id: Number(id) } });
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

  // cargar organización + tratos + CF
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        setLoading(true);
        await loadOrg();
        await loadOrgDeals();
        await loadCustomFields();
      } catch (e) {
        if (!cancel) setErr('No se pudo cargar la organización.');
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
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
    return () => { cancel = true; };
  }, [tab, id]);

  // Resolver ejecutivo de cuenta en cuanto tengamos org y/o CF
  useEffect(() => {
    let live = true;
    (async () => {
      setExecLoading(true);
      setExecIdRaw(null);
      setExecNameRaw(null);
      setAccountExec(null);

      if (!org) { if (live) setExecLoading(false); return; }

      const fromOrg = getExecFromOrg(org);
      const fromCF  = (!fromOrg.id && !fromOrg.name) ? getExecFromCF(customFields) : { id: null, name: null };

      const execId       = fromOrg.id || fromCF.id || null;
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
        if (live) setAccountExec({ id: null, name: String(nameFallback), email: '' });
      }

      if (live) setExecLoading(false);
    })();
    return () => { live = false; };
  }, [org, customFields]);

  // inicializar selección cuando cambia lo detectado
  useEffect(() => {
    setExecSelection(accountExec?.id ?? (execIdRaw ?? null));
  }, [accountExec?.id, execIdRaw, id]);

  async function saveExecAssignment() {
    setSavingExec(true);
    try {
      await api.patch(`/organizations/${id}`, { owner_user_id: execSelection ?? null });
      await loadOrg(); // recarga datos, vuelve a resolver el ejecutivo
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

  if (loading) return <p className="text-sm text-slate-600">Cargando…</p>;
  if (err) return <p className="text-sm text-red-600">{err}</p>;
  if (!org) return <p className="text-sm text-slate-600">Organización no encontrada.</p>;

  return (
    <div className="space-y-4">
      {/* ====== Header estilo Pipedrive ====== */}
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">🏢</div>
            <div className="min-w-0">
              <div className="text-xl font-semibold truncate">
                {org.razon_social || org.name || '—'}
              </div>
              <div className="text-xs text-slate-600 truncate">
                Propietario: {org.owner_user_id || '—'} • Visibilidad: {org.visibility || 'company'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-2 text-sm rounded-lg border" onClick={()=>alert('Próximamente: seguir/seguidores')}>1 seguidor</button>
            <button className="px-3 py-2 text-sm rounded-lg bg-emerald-600 text-white" onClick={()=>setOpenDeal(true)}>+ Trato</button>
            <button className="px-3 py-2 text-sm rounded-lg border" onClick={()=>setOpenEdit(true)}>Editar</button>
            <button className="px-3 py-2 text-sm rounded-lg border" onClick={()=>alert('Opciones')}>⋯</button>
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
              <button className="text-sm text-blue-600 hover:underline" onClick={()=>setOpenEdit(true)}>Editar</button>
            </header>
            <div className="p-4">
              <div className="space-y-2">
                <FieldRow label="Razón Social" value={org.razon_social || org.name} />
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
                  {org.created_at ? new Date(org.created_at).toLocaleDateString() : '—'}
                </FieldRow>
              </div>
            </div>
          </section>

          {/* Campos personalizados */}
          <section className="bg-white rounded-2xl shadow">
            <header className="px-4 py-3 border-b font-medium flex items-center justify-between">
              <span>Campos personalizados</span>
              {cfSupported && (
                <button className="text-sm text-blue-600 hover:underline" onClick={()=>setOpenAddCF(true)}>
                  + Añadir campo
                </button>
              )}
            </header>

            <div className="p-4 space-y-2">
              {!cfSupported && (
                <div className="text-sm text-slate-600">
                  (Aún no hay endpoint para campos personalizados. Cuando agregues la API,
                  este panel cargará y guardará valores automáticamente).
                </div>
              )}

              {cfSupported && (cfLoading ? (
                <div className="text-sm text-slate-600">Cargando campos…</div>
              ) : customFields.length ? (
                <ul className="space-y-2">
                  {customFields.map(cf => (
                    <li key={cf.id} className="flex items-center justify-between gap-2">
                      <div className="text-sm">
                        <div className="font-medium">{cf.label || cf.key}</div>
                        <div className="text-slate-600 text-xs">{cf.type || 'text'} • {cf.key}</div>
                      </div>
                      <InlineCFEditor
                        cf={cf}
                        onSave={async (newValue)=>{
                          try {
                            await api.put(`/organizations/${id}/custom-fields/${cf.id}`, { value: newValue });
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
                <div className="text-sm text-slate-600">No hay campos personalizados.</div>
              ))}
            </div>
          </section>

          {/* Tratos */}
          <section className="bg-white rounded-2xl shadow">
            <header className="px-4 py-3 border-b font-medium flex items-center justify-between">
              <span>Tratos</span>
              <button className="text-sm text-blue-600 hover:underline" onClick={()=>setOpenDeal(true)}>+ Añadir</button>
            </header>
            <div className="p-4 text-sm">
              {dealsLoading ? (
                <div className="text-slate-600">Cargando tratos…</div>
              ) : orgDeals.length ? (
                <ul className="space-y-2">
                  {orgDeals.map(d => (
                    <li key={d.id} className="flex items-center justify-between">
                      <span className="truncate">{d.title}</span>
                      <span className="text-slate-600">${Number(d.value || 0).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-slate-600">Sin tratos vinculados.</div>
              )}
            </div>
          </section>

          {/* Personas */}
          <section className="bg-white rounded-2xl shadow">
            <header className="px-4 py-3 border-b font-medium flex items-center justify-between">
              <span>Personas</span>
              <button className="text-sm text-blue-600 hover:underline" onClick={()=>setOpenPerson(true)}>+ Persona</button>
            </header>
            <div className="p-4">
              <ul className="space-y-2">
                {(org.contacts || []).map(c => (
                  <li key={c.id} className="text-sm">
                    {c.name} <span className="text-slate-500">({c.email || 'sin email'})</span>
                  </li>
                ))}
                {!org.contacts?.length && <div className="text-sm text-slate-600">Sin personas.</div>}
              </ul>
            </div>
          </section>

          {/* ===== Ejecutivo de cuenta ===== */}
          <section className="bg-white rounded-2xl shadow">
            <header className="px-4 py-3 border-b font-medium flex items-center justify-between">
              <span>Ejecutivo de cuenta</span>
              <button
                className="text-sm text-blue-600 hover:underline"
                onClick={()=> setEditExec(v => !v)}
              >
                {editExec ? 'Cancelar' : 'Editar'}
              </button>
            </header>
            <div className="p-4 text-sm">
              {execLoading ? (
                <div className="text-slate-600">Cargando ejecutivo…</div>
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
                      onClick={()=>{ setEditExec(false); setExecSelection(accountExec?.id ?? execIdRaw ?? null); }}
                      disabled={savingExec}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : accountExec ? (
                <div>
                  <div className="font-medium">{accountExec.name}</div>
                  <div className="text-slate-600">{accountExec.email || '—'}</div>
                </div>
              ) : execIdRaw != null ? (
                <div className="text-slate-600">Usuario #{String(execIdRaw)} no accesible</div>
              ) : execNameRaw ? (
                <div><div className="font-medium">{execNameRaw}</div></div>
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
                  { key: 'notes',    label: 'Notas',     icon: '📝' },
                  { key: 'files',    label: 'Archivos',  icon: '📎' },
                  { key: 'docs',     label: 'Documentos',icon: '📄' },
                ].map(t => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`px-3 py-2 rounded-t-lg text-sm ${tab === t.key ? 'bg-black text-white' : 'hover:bg-slate-100'}`}
                  >
                    <span className="mr-1">{t.icon}</span>{t.label}
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
                  onChange={(e)=>setComposer(e.target.value)}
                />
                <div className="mt-2 flex items-center gap-2">
                  <button className="px-3 py-2 text-sm rounded-lg bg-black text-white" onClick={saveQuickActivity}>Guardar</button>
                  <button className="px-3 py-2 text-sm rounded-lg border" onClick={()=>setComposer('')}>Cancelar</button>
                </div>
              </div>
            )}

            {/* Contenido del tab */}
            <div className="p-4">
              {tab === 'activity' && (
                <div className="space-y-3">
                  <div className="text-sm text-slate-600 mb-2">
                    Enfoque — Aquí aparecerán actividades programadas, notas ancladas, borradores, etc.
                  </div>

                  <button className="text-blue-600 hover:underline text-sm" onClick={()=>setOpenAct(true)}>
                    + Programar una actividad
                  </button>

                  <h4 className="mt-4 font-medium">Historial</h4>
                  {actsLoading ? (
                    <div className="text-sm text-slate-600">Cargando actividades…</div>
                  ) : acts.length ? (
                    <ul className="space-y-2">
                      {acts.map(a => (
                        <li key={a.id} className="border rounded-xl p-3">
                          <div className="text-sm font-medium">{a.type || 'actividad'} — {a.subject || 'sin asunto'}</div>
                          <div className="text-xs text-slate-600">
                            Vence: {a.due_date || '—'} • Creado: {a.created_at ? new Date(a.created_at).toLocaleDateString() : '—'}
                          </div>
                          {a.notes && <div className="text-sm mt-1">{a.notes}</div>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-sm text-slate-500">Sin actividades.</div>
                  )}
                </div>
              )}

              {tab === 'notes' && <div className="text-sm text-slate-600">Notas (placeholder).</div>}
              {tab === 'files' && <div className="text-sm text-slate-600">Archivos (placeholder).</div>}
              {tab === 'docs'  && <div className="text-sm text-slate-600">Documentos (placeholder).</div>}
            </div>
          </div>

          {/* Volver */}
          <div>
            <Link to="/organizations" className="text-blue-600 hover:underline">← Volver a lista</Link>
          </div>
        </section>
      </div>

      {/* Modales */}
      {openAct && (
        <NewActivityModal
          orgId={id}
          onClose={()=>setOpenAct(false)}
          onCreated={async ()=>{ if (tab !== 'activity') setTab('activity'); await loadActivities(); }}
        />
      )}

      {openDeal && (
        <NewDealModal
          orgId={id}
          onClose={()=>setOpenDeal(false)}
          onCreated={async ()=>{ await loadOrgDeals(); }}
        />
      )}

      {openPerson && (
        <NewPersonModal
          orgId={id}
          onClose={()=>setOpenPerson(false)}
          onCreated={async ()=>{ await loadOrg(); }}
        />
      )}

      {openEdit && (
        <EditOrgModal
          org={org}
          onClose={()=>setOpenEdit(false)}
          onSaved={async ()=>{ await loadOrg(); }}
        />
      )}

      {openAddCF && (
        <AddCustomFieldModal
          orgId={id}
          onClose={()=>setOpenAddCF(false)}
          onCreated={async ()=>{ await loadCustomFields(); }}
        />
      )}
    </div>
  );
}

/* ===== Inline editor / Modales ===== */
function InlineCFEditor({ cf, onSave }) {
  const [v, setV] = useState(cf.value ?? '');
  const [saving, setSaving] = useState(false);
  async function save(){ setSaving(true); try { await onSave(v); } finally { setSaving(false); } }
  return (
    <div className="flex items-center gap-2">
      {cf.type === 'number' ? (
        <input type="number" className="border rounded-lg px-2 py-1 text-sm w-40" value={v} onChange={e=>setV(e.target.value)} />
      ) : cf.type === 'date' ? (
        <input type="date" className="border rounded-lg px-2 py-1 text-sm" value={v || ''} onChange={e=>setV(e.target.value)} />
      ) : (
        <input className="border rounded-lg px-2 py-1 text-sm w-48" value={v} onChange={e=>setV(e.target.value)} />
      )}
      <button className="px-2 py-1 text-xs rounded border" onClick={save} disabled={saving}>
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
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  function upd(k, v){ setForm(prev=>({ ...prev, [k]: v })); }
  const parsedModalities = parseModalitiesCSV(form.modalities_supported);
  function toggleModality(m){
    const next = parsedModalities.includes(m)
      ? parsedModalities.filter(x=>x!==m)
      : [...parsedModalities, m];
    upd('modalities_supported', toCSV(next));
  }
  async function submit(e){
    e.preventDefault(); setErr(''); setSaving(true);
    try {
      const payload = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : v]));
      if (payload?.owner_user_id != null) {
        const n = Number(payload.owner_user_id);
        payload.owner_user_id = Number.isFinite(n) && n > 0 ? n : null;
      }
      payload.is_agent = payload.is_agent ? 1 : 0;
      await api.patch(`/organizations/${org.id}`, payload);
      onSaved?.(); onClose?.();
    } catch { setErr('No se pudo guardar los cambios.'); }
    finally { setSaving(false); }
  }
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <form onSubmit={submit} className="bg-white rounded-2xl p-4 w-full max-w-2xl space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Editar organización</h3>
          <button type="button" onClick={onClose} className="text-sm">✕</button>
        </div>
        {err && <div className="text-sm text-red-600">{err}</div>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block text-sm">Nombre
            <input className="w-full border rounded-lg px-3 py-2" value={form.name} onChange={e=>upd('name', e.target.value)} />
          </label>
          <label className="block text-sm">Industria
            <input className="w-full border rounded-lg px-3 py-2" value={form.industry} onChange={e=>upd('industry', e.target.value)} />
          </label>
          <label className="block text-sm">Teléfono
            <input className="w-full border rounded-lg px-3 py-2" value={form.phone} onChange={e=>upd('phone', e.target.value)} />
          </label>
          <label className="block text-sm">Website
            <input className="w-full border rounded-lg px-3 py-2" value={form.website} onChange={e=>upd('website', e.target.value)} />
          </label>
          <label className="block text-sm">RUC
            <input className="w-full border rounded-lg px-3 py-2" value={form.ruc ?? ''} onChange={e=>upd('ruc', e.target.value)} />
          </label>
          <label className="block text-sm">Dirección
            <input className="w-full border rounded-lg px-3 py-2" value={form.address} onChange={e=>upd('address', e.target.value)} />
          </label>
          <label className="block text-sm">Ciudad
            <input className="w-full border rounded-lg px-3 py-2" value={form.city} onChange={e=>upd('city', e.target.value)} />
          </label>
          <label className="block text-sm">País
            <input className="w-full border rounded-lg px-3 py-2" value={form.country} onChange={e=>upd('country', e.target.value)} />
          </label>
          <label className="block text-sm">Etiqueta
            <input className="w-full border rounded-lg px-3 py-2" value={form.label} onChange={e=>upd('label', e.target.value)} />
          </label>

          {/* Reemplazado por selector */}
          <div className="md:col-span-2">
            <AccountExecutiveSelect
              value={form.owner_user_id ? Number(form.owner_user_id) : null}
              onChange={(v)=>upd('owner_user_id', v)}
              onlyActive={false}
              label="Ejecutivo / Owner"
              placeholder="— Sin asignar —"
            />
          </div>

          <label className="block text-sm">Visibilidad
            <select className="w-full border rounded-lg px-3 py-2" value={form.visibility} onChange={e=>upd('visibility', e.target.value)}>
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
              <input type="checkbox" checked={!!Number(form.is_agent)} onChange={e=>upd('is_agent', e.target.checked ? 1 : 0)} />
              <span>Marcar como agente</span>
            </label>
          </label>
          <div className="md:col-span-2">
            <div className="text-sm mb-2">Modalidades soportadas</div>
            <div className="flex flex-wrap gap-3 text-sm">
              {ALL_MODALITIES.map(m => (
                <label key={m} className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={parseModalitiesCSV(form.modalities_supported).includes(m)}
                    onChange={()=>{
                      const parsed = parseModalitiesCSV(form.modalities_supported);
                      const next = parsed.includes(m) ? parsed.filter(x=>x!==m) : [...parsed, m];
                      upd('modalities_supported', toCSV(next));
                    }}
                  />
                  <span className="capitalize">{m}</span>
                </label>
              ))}
            </div>
            <div className="text-xs text-slate-500 mt-1">Se guardan como CSV en <code>modalities_supported</code>.</div>
          </div>
        </div>
        <label className="block text-sm">Notas
          <textarea className="w-full border rounded-lg px-3 py-2" rows={4} value={form.notes ?? ''} onChange={e=>upd('notes', e.target.value)} />
        </label>
        <div className="pt-2 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 border rounded-lg">Cancelar</button>
          <button className="px-3 py-2 rounded-lg bg-black text-white disabled:opacity-60" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  );
}

function AddCustomFieldModal({ orgId, onClose, onCreated }) {
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [type, setType] = useState('text');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e){
    e.preventDefault();
    setErr('');
    if (!key.trim() || !label.trim()) { setErr('Completá clave y etiqueta.'); return; }
    setSaving(true);
    try {
      await api.post(`/organizations/${orgId}/custom-fields`, { key: key.trim(), label: label.trim(), type, value: value ?? null });
      onCreated?.(); onClose?.();
    } catch { setErr('No se pudo crear el campo (verifica que el endpoint exista).'); }
    finally { setSaving(false); }
  }
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <form onSubmit={submit} className="bg-white rounded-2xl p-4 w-full max-w-lg space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Nuevo campo personalizado</h3>
          <button type="button" onClick={onClose} className="text-sm">✕</button>
        </div>
        {err && <div className="text-sm text-red-600">{err}</div>}
        <label className="block text-sm">Etiqueta visible
          <input className="w-full border rounded-lg px-3 py-2" value={label} onChange={e=>setLabel(e.target.value)} />
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block text-sm">Clave (sin espacios)
            <input className="w-full border rounded-lg px-3 py-2" value={key} onChange={e=>setKey(e.target.value)} placeholder="ej: tax_id" />
          </label>
          <label className="block text-sm">Tipo
            <select className="w-full border rounded-lg px-3 py-2" value={type} onChange={e=>setType(e.target.value)}>
              <option value="text">Texto</option>
              <option value="number">Número</option>
              <option value="date">Fecha</option>
            </select>
          </label>
        </div>
        <label className="block text-sm">Valor inicial
          <input className="w-full border rounded-lg px-3 py-2" value={value} onChange={e=>setValue(e.target.value)} />
        </label>
        <div className="pt-2 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 border rounded-lg">Cancelar</button>
          <button className="px-3 py-2 rounded-lg bg-black text-white disabled:opacity-60" disabled={saving}>
            {saving ? 'Guardando…' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  );
}

function NewActivityModal({ orgId, onClose, onCreated }) {
  const [type, setType] = useState('task');
  const [subject, setSubject] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e){
    e.preventDefault(); setErr('');
    if (!subject.trim() && !notes.trim()) { setErr('Escribí al menos asunto o notas.'); return; }
    setSaving(true);
    try {
      await api.post('/activities', { type, subject: subject.trim(), due_date: dueDate || null, done: 0, org_id: Number(orgId), notes: notes || null });
      onCreated?.(); onClose?.();
    } catch { setErr('No se pudo crear la actividad.'); }
    finally { setSaving(false); }
  }
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <form onSubmit={submit} className="bg-white rounded-2xl p-4 w-full max-w-lg space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Nueva actividad</h3>
          <button type="button" onClick={onClose} className="text-sm">✕</button>
        </div>
        {err && <div className="text-sm text-red-600">{err}</div>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block text-sm">Tipo
            <select className="w-full border rounded-lg px-3 py-2" value={type} onChange={e=>setType(e.target.value)}>
              <option value="task">Tarea</option>
              <option value="call">Llamada</option>
              <option value="meeting">Reunión</option>
              <option value="email">Email</option>
              <option value="note">Nota</option>
            </select>
          </label>
          <label className="block text-sm">Vence (YYYY-MM-DD)
            <input className="w-full border rounded-lg px-3 py-2" type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} />
          </label>
        </div>
        <label className="block text-sm">Asunto
          <input className="w-full border rounded-lg px-3 py-2" value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Ej: Llamar para propuesta" />
        </label>
        <label className="block text-sm">Notas
          <textarea className="w-full border rounded-lg px-3 py-2" rows={4} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Detalles, acuerdos, etc." />
        </label>
        <div className="pt-2 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 border rounded-lg">Cancelar</button>
          <button className="px-3 py-2 rounded-lg bg-black text-white disabled:opacity-60" disabled={saving}>
            {saving ? 'Guardando…' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  );
}

function NewDealModal({ orgId, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [stageId, setStageId] = useState('');
  const [pipelines, setPipelines] = useState([]);
  const [stages, setStages] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const { data: p } = await api.get('/pipelines');
        if (!cancel) {
          const list = Array.isArray(p) ? p : [];
          setPipelines(list);
          const pid = list?.[0]?.id ? String(list[0].id) : '';
          setPipelineId(pid);
        }
      } catch {}
    })();
    return () => { cancel = true; };
  }, []);

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!pipelineId) { setStages([]); setStageId(''); return; }
      try {
        const { data: s } = await api.get(`/pipelines/${pipelineId}/stages`);
        if (!cancel) {
          const list = Array.isArray(s) ? s : [];
          setStages(list);
          setStageId(list?.[0]?.id ? String(list[0].id) : '');
        }
      } catch {}
    })();
    return () => { cancel = true; };
  }, [pipelineId]);

  async function submit(e){
    e.preventDefault();
    setErr('');
    if (!title.trim() || !stageId || !pipelineId) {
      setErr('Completá título, pipeline y etapa.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/deals', {
        title: title.trim(),
        value: value ? Number(value) : 0,
        pipeline_id: Number(pipelineId),
        stage_id: Number(stageId),
        org_id: Number(orgId),
      });
      onCreated?.();
      onClose?.();
    } catch (e) {
      setErr('No se pudo crear el trato.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <form onSubmit={submit} className="bg-white rounded-2xl p-4 w-full max-w-lg space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Nuevo trato</h3>
          <button type="button" onClick={onClose} className="text-sm">✕</button>
        </div>

        {err && <div className="text-sm text-red-600">{err}</div>}

        <label className="block text-sm">Título
          <input className="w-full border rounded-lg px-3 py-2" value={title} onChange={e=>setTitle(e.target.value)} />
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block text-sm">Valor
            <input className="w-full border rounded-lg px-3 py-2" type="number" min="0"
              value={value} onChange={e=>setValue(e.target.value)} />
          </label>

          <label className="block text-sm">Pipeline
            <select className="w-full border rounded-lg px-3 py-2"
              value={pipelineId} onChange={e=>setPipelineId(e.target.value)}>
              <option value="">Seleccionar…</option>
              {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>

        <label className="block text-sm">Etapa
          <select className="w-full border rounded-lg px-3 py-2"
            value={stageId} onChange={e=>setStageId(e.target.value)} disabled={!stages.length}>
            <option value="">Seleccionar…</option>
            {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>

        <div className="pt-2 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 border rounded-lg">Cancelar</button>
          <button className="px-3 py-2 rounded-lg bg-black text-white disabled:opacity-60" disabled={saving}>
            {saving ? 'Guardando…' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  );
}

function NewPersonModal({ orgId, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e){
    e.preventDefault();
    setErr('');
    if (!name.trim() && !email.trim()) { setErr('Completá al menos nombre o email.'); return; }
    setSaving(true);
    try {
      await api.post('/contacts', { name: name.trim() || null, email: email || null, phone: phone || null, title: title || null, org_id: Number(orgId) });
      onCreated?.(); onClose?.();
    } catch (e) { setErr('No se pudo crear la persona.'); }
    finally { setSaving(false); }
  }
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <form onSubmit={submit} className="bg-white rounded-2xl p-4 w-full max-w-md space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Nueva persona</h3>
          <button type="button" onClick={onClose} className="text-sm">✕</button>
        </div>
        {err && <div className="text-sm text-red-600">{err}</div>}
        <label className="block text-sm">Nombre
          <input className="w-full border rounded-lg px-3 py-2" value={name} onChange={e=>setName(e.target.value)} />
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block text-sm">Email
            <input className="w-full border rounded-lg px-3 py-2" value={email} onChange={e=>setEmail(e.target.value)} />
          </label>
          <label className="block textsm">Teléfono
            <input className="w-full border rounded-lg px-3 py-2" value={phone} onChange={e=>setPhone(e.target.value)} />
          </label>
        </div>
        <label className="block text-sm">Cargo (opcional)
          <input className="w-full border rounded-lg px-3 py-2" value={title} onChange={e=>setTitle(e.target.value)} />
        </label>
        <div className="pt-2 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 border rounded-lg">Cancelar</button>
          <button className="px-3 py-2 rounded-lg bg-black text-white disabled:opacity-60" disabled={saving}>
            {saving ? 'Guardando…' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  );
}
