import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth.jsx";
import { CallForm } from "./FollowUpManagement.jsx";
import { NewOrganizationModal } from "./Organizations.jsx";
import QuickContactModal from "../components/QuickContactModal.jsx";
import CommercialSessions from "../components/CommercialSessions.jsx";

const storageKey = (id) => `commercial-dashboard-filters:${id || "anonymous"}`;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const displayDate = (value) => value ? new Date(value).toLocaleDateString("es-PY") : "-";
const displayDay = (value) => { const day = String(value || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : '-'; };
const displayTime = (value) => String(value || "").slice(11, 16);
const canManageFollowups = (role) => ['admin', 'venta', 'ventas', 'vendedor', 'seller', 'sales', 'commercial', 'comercial'].includes(String(role || '').toLowerCase());
const PRIMARY_VIEWS = [
  { key: 'priorities', label: 'Prioridades' },
  { key: 'prospects', label: 'Prospectos' },
  { key: 'quotes', label: 'Cotizaciones' },
  { key: 'closing', label: 'Por cerrar' },
];
const SECONDARY_VIEWS = [
  { key: 'overdue', label: 'Seguimientos vencidos' },
  { key: 'missing', label: 'Sin próximo paso' },
  { key: 'unquoted', label: 'Sin cotizar' },
  { key: 'expiring', label: 'Ofertas por vencer' },
  { key: 'recent', label: 'Recientes' },
];
const VIEW_NAMES = {
  priorities: "Qué necesita atención hoy",
  overdue: "Seguimientos vencidos",
  missing: "Sin próximo paso",
  unquoted: "Pendientes de cotizar",
  prospects: "Prospectos por contactar",
  quotes: "Cotizaciones por atender",
  expiring: "Ofertas vencidas o por vencer",
  closing: "Operaciones por cerrar",
  recent: "Operaciones recientes",
  sessions: "Sesiones de trabajo",
};

function Metric({ label, value, selected, urgent, onClick }) {
  return <button
    type="button"
    onClick={onClick}
    aria-pressed={selected}
    className={`group flex min-w-0 items-center justify-between gap-2 border-b-2 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 sm:border-b-0 sm:border-r last:sm:border-r-0 ${selected ? "border-b-teal-700 bg-teal-50/60 sm:shadow-[inset_0_-2px_0_#0f766e]" : "border-b-transparent"}`}
  >
    <span className="min-w-0 text-xs font-medium leading-tight text-slate-600">{label}</span>
    <span className="flex shrink-0 items-center gap-2">
      <strong className={`text-xl leading-none ${urgent && Number(value) > 0 ? "text-red-700" : "text-slate-900"}`}>{value}</strong>
      <span aria-hidden="true" className="text-slate-400 group-hover:text-teal-700">›</span>
    </span>
  </button>;
}

function FollowupPanel({ deal, user, onSaved, onDirtyChange, actionRequest, panelRef, onCall, callLoading, refreshKey, queuePosition, queueLength, onQueueMove }) {
  const [entries, setEntries] = useState([]);
  const [type, setType] = useState("note");
  const [activityType, setActivityType] = useState("call");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { onDirtyChange(Boolean(title.trim() || content.trim())); }, [title, content, onDirtyChange]);
  useEffect(() => {
    if (deal?.next_action?.key === "primer_contacto") { setType("activity"); setActivityType("call"); setDueAt(`${today()}T09:00`); }
    else if (deal?.next_action?.key === "programar") { setType("task"); setDueAt(`${today()}T09:00`); }
  }, [deal?.id]);
  useEffect(() => {
    if (!deal || actionRequest?.dealId !== deal.id) return;
    if (!title.trim() && !content.trim()) {
      setType(actionRequest.key === "programar" ? "task" : "activity");
      setActivityType("call");
      if (!dueAt) setDueAt(`${today()}T09:00`);
    }
    const frame = requestAnimationFrame(() => {
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      panelRef.current?.querySelector("[data-followup-field]")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [actionRequest]);

  const loadFeed = useCallback(async () => {
    if (!deal?.id) return;
    setLoading(true);
    try {
      const [{ data }, { data: calls }] = await Promise.all([
        api.get(`/operations/${deal.id}/followup-feed`),
        api.get(`/operations/${deal.id}/history-calls`).catch(() => ({ data: [] })),
      ]);
      const callEntries = (Array.isArray(calls) ? calls : []).map((call) => ({
        id: `call-${call.id}`,
        title: `Llamada · ${call.subject || "Sin asunto"}`,
        content: [call.outcome?.replaceAll("_", " "), call.notes].filter(Boolean).join(" · "),
        created_at: call.happened_at || call.created_at,
      }));
      setEntries([...(data?.items || []), ...callEntries].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)));
    } catch { setError("No se pudo cargar el seguimiento."); }
    finally { setLoading(false); }
  }, [deal?.id]);
  useEffect(() => { loadFeed(); }, [loadFeed, refreshKey]);

  function changeType(next) {
    setType(next);
    setError("");
    if (next !== "note" && !dueAt) setDueAt(`${today()}T09:00`);
  }
  async function save() {
    if (type === "note" && !content.trim()) return setError("Escribí una nota.");
    if (type !== "note" && (!title.trim() || !dueAt)) return setError("Completá el título, la fecha y la hora.");
    setSaving(true); setError("");
    try {
      await api.post(`/operations/${deal.id}/followup-feed`, {
        entry_type: type === "activity" ? activityType : type,
        title: title.trim(), content: content.trim(), due_at: type === "note" ? null : dueAt,
        priority: "medium", assigned_to: deal.advisor_user_id || user?.id || null, done: false,
      });
      setTitle(""); setContent(""); setDueAt("");
      await loadFeed();
      onSaved(deal.id);
    } catch (e) { setError(e?.response?.data?.error || "No se pudo guardar el seguimiento."); }
    finally { setSaving(false); }
  }
  if (!deal) return <aside className="border-t bg-white p-6 text-sm text-slate-500 xl:border-l xl:border-t-0">Seleccioná una operación de la lista para ver su seguimiento.</aside>;
  return <aside ref={panelRef} className="min-w-0 border-t bg-white xl:border-l xl:border-t-0">
    <div className="border-b px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/operations/${deal.id}`} className="text-base font-semibold text-blue-700 hover:underline">{deal.reference || `#${deal.id}`}</Link>
          <h2 className="truncate text-sm font-semibold text-slate-900" title={deal.org_name || deal.title}>{deal.org_name || deal.title || 'Sin cliente'}</h2>
          {deal.title && <p className="truncate text-xs text-slate-500" title={deal.title}>{deal.title}</p>}
        </div>
        <Link to={`/operations/${deal.id}`} className="shrink-0 rounded border px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Abrir operación</Link>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 text-xs">
        <div><span className="block text-slate-500">Etapa</span><strong className="mt-1 block truncate font-medium" title={deal.stage_name || ''}>{deal.stage_name || '-'}</strong></div>
        <div><span className="block text-slate-500">Responsable</span><strong className="mt-1 block truncate font-medium" title={deal.advisor_name || ''}>{deal.advisor_name || '-'}</strong></div>
      </div>
      {deal.expected_close_date && <div className="mt-3 flex flex-wrap items-baseline justify-between gap-1 text-xs"><span className="text-slate-500">Cierre estimado por el cliente</span><strong className={deal.closing_days_remaining != null && deal.closing_days_remaining <= 0 ? 'text-red-700' : 'text-slate-900'}>{displayDay(deal.expected_close_date)}</strong></div>}
      <div className="mt-3 border-l-2 border-teal-600 bg-teal-50/60 px-3 py-2 text-xs"><span className="block text-slate-500">Próximo paso</span><strong className="mt-0.5 block text-slate-900">{deal.next_action?.label || 'Revisar operación'}</strong><span className="text-slate-600">{deal.next_action?.reason || (deal.next_activity_at ? displayDate(deal.next_activity_at) : 'Sin fecha programada')}</span></div>
      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-500">
        <span>{queuePosition} de {queueLength} en esta vista</span>
        <div className="flex gap-1"><button type="button" onClick={() => onQueueMove(-1)} disabled={queuePosition <= 1} className="rounded border px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-40">Anterior</button><button type="button" onClick={() => onQueueMove(1)} disabled={queuePosition >= queueLength} className="rounded border px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-40">Siguiente</button></div>
      </div>
    </div>
    <div className="flex border-b text-sm" role="tablist" aria-label="Tipo de seguimiento">
      {["note", "task", "activity"].map((value) => <button key={value} type="button" role="tab" aria-selected={type === value} onClick={() => changeType(value)} className={`flex-1 border-b-2 px-2 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 ${type === value ? "border-teal-700 font-semibold text-teal-800" : "border-transparent text-slate-600 hover:bg-slate-50"}`}>{({ note: "Nota", task: "Tarea", activity: "Actividad" })[value]}</button>)}
    </div>
    <div className="space-y-3 px-4 py-4">
      {type === "activity" && <label className="block text-xs font-medium text-slate-700">Tipo de actividad<select value={activityType} onChange={(e) => setActivityType(e.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-2 text-sm"><option value="call">Llamada</option><option value="meeting">Reunión</option><option value="email">Correo</option><option value="activity">General</option></select></label>}
      {type !== "note" && <label className="block text-xs font-medium text-slate-700">Título<input data-followup-field value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder={type === "task" ? "Llamar al cliente" : "Contacto comercial"} /></label>}
      {type !== "task" && <label className="block text-xs font-medium text-slate-700">{type === "note" ? "Nota" : "Descripción"}<textarea data-followup-field value={content} onChange={(e) => setContent(e.target.value)} className="mt-1 min-h-24 w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Escribir..." /></label>}
      {type !== "note" && <label className="block text-xs font-medium text-slate-700">Fecha y hora<input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm" /></label>}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      <button type="button" disabled={saving} onClick={save} className="w-full rounded bg-teal-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50">{saving ? "Guardando..." : "Guardar seguimiento"}</button>
      <button type="button" onClick={() => onCall(deal)} disabled={callLoading} className="w-full rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">{callLoading ? "Cargando..." : "Registrar llamada"}</button>
    </div>
    <div className="border-t px-4 py-4">
      <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-semibold uppercase text-slate-700">Actividad reciente</h3><Link to={`/operations/${deal.id}`} className="text-xs text-blue-700 hover:underline">Ver historial</Link></div>
      {loading ? <p className="mt-3 text-xs text-slate-500">Cargando...</p> : entries.length ? <div className="mt-3 max-h-52 space-y-3 overflow-y-auto">{entries.slice(0, 4).map((entry) => <div key={entry.id} className="border-l-2 border-slate-300 pl-3 text-xs"><div className="flex justify-between gap-2"><strong className="min-w-0 truncate" title={entry.title || 'Nota'}>{entry.title || "Nota"}</strong><span className="shrink-0 text-slate-500">{displayDate(entry.created_at)}</span></div>{entry.content && <p className="mt-1 line-clamp-2 text-slate-600">{entry.content}</p>}</div>)}</div> : <p className="mt-3 text-xs text-slate-500">Todavía no hay seguimiento registrado.</p>}
    </div>
  </aside>;
}

export default function CommercialDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = String(user?.role || "").toLowerCase() === "admin";
  const [filters, setFilters] = useState(() => {
    try { return { userId: "", businessUnit: "", view: "priorities", ...JSON.parse(localStorage.getItem(storageKey(user?.id)) || "{}") }; }
    catch { return { userId: "", businessUnit: "", view: "priorities" }; }
  });
  const [users, setUsers] = useState([]);
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draftDirty, setDraftDirty] = useState(false);
  const [visibleCount, setVisibleCount] = useState(30);
  const [actionRequest, setActionRequest] = useState(null);
  const panelRef = useRef(null);
  const [callDeal, setCallDeal] = useState(null);
  const [callContacts, setCallContacts] = useState([]);
  const [callLoading, setCallLoading] = useState(false);
  const [callRefreshKey, setCallRefreshKey] = useState(0);
  const [agendaExpanded, setAgendaExpanded] = useState(false);
  const [queueMessage, setQueueMessage] = useState("");
  const [organizationModalOpen, setOrganizationModalOpen] = useState(false);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  const latestRequest = useRef(0);
  const lastWorkView = useRef(filters.view === 'sessions' ? 'priorities' : filters.view);
  const inSessions = filters.view === 'sessions';
  const load = useCallback(async (selection = { userId: filters.userId, businessUnit: filters.businessUnit }) => {
    const requestId = ++latestRequest.current;
    setLoading(true); setError("");
    try {
      const { data: payload } = await api.get("/commercial-dashboard", { params: {
        ...(isAdmin && selection.userId ? { user_id: selection.userId } : {}),
        ...(selection.businessUnit ? { business_unit: selection.businessUnit } : {}),
      } });
      if (requestId === latestRequest.current) setData(payload || null);
      return payload;
    } catch (e) { if (requestId === latestRequest.current) setError(e?.response?.data?.error || "No se pudo cargar el dashboard comercial."); }
    finally { if (requestId === latestRequest.current) setLoading(false); }
  }, [filters.userId, filters.businessUnit, isAdmin]);
  useEffect(() => { if (!inSessions) load(); }, [load, inSessions]);
  useEffect(() => {
    if (!isAdmin) return;
    api.get("/users/select", { params: { active: 1 } }).then(({ data: rows }) => setUsers(Array.isArray(rows) ? rows : [])).catch(() => setUsers([]));
  }, [isAdmin]);
  useEffect(() => { localStorage.setItem(storageKey(user?.id), JSON.stringify(filters)); }, [filters, user?.id]);
  useEffect(() => { if (filters.view !== 'sessions') lastWorkView.current = filters.view; }, [filters.view]);

  const rows = useMemo(() => {
    if (filters.view === "sessions") return [];
    if (filters.view === "expiring") return data?.expiring_quotes || [];
    if (filters.view === "prospects") return data?.prospects || [];
    if (filters.view === "quotes") return data?.quote_followups || [];
    if (filters.view === "closing") return data?.closing_soon || [];
    if (filters.view === "recent") return data?.top_deals || [];
    if (filters.view === "overdue") return (data?.next_actions || []).filter((row) => Number(row.overdue_activities) > 0);
    if (filters.view === "missing") return (data?.next_actions || []).filter((row) => !row.next_activity_at);
    if (filters.view === "unquoted") return (data?.next_actions || []).filter((row) => !row.has_quote);
    return (data?.next_actions || []).filter((row) => row.next_action?.priority !== "normal");
  }, [data, filters.view]);
  useEffect(() => { setVisibleCount(30); }, [filters.view, filters.userId, filters.businessUnit]);
  const visibleRows = rows.slice(0, visibleCount);
  useEffect(() => { if (!rows.some((row) => row.id === selectedId)) setSelectedId(rows[0]?.id || null); }, [rows, selectedId]);
  const selectedDeal = rows.find((row) => row.id === selectedId) || null;
  const selectedIndex = rows.findIndex((row) => row.id === selectedId);
  const summary = data?.summary || {};
  const stages = data?.journey || [];
  const agenda = [...(data?.agenda || [])].sort((a, b) => Number(b.overdue) - Number(a.overdue) || String(a.due_at || '').localeCompare(String(b.due_at || '')));
  const onDirtyChange = useCallback((dirty) => setDraftDirty(dirty), []);
  function selectDeal(id) {
    if (id !== selectedId && draftDirty && !window.confirm("Hay un seguimiento sin guardar. ¿Descartarlo?")) return false;
    setSelectedId(id);
    setQueueMessage("");
    return true;
  }
  function moveQueue(offset) {
    const target = rows[selectedIndex + offset];
    if (!target || !selectDeal(target.id)) return;
    if (selectedIndex + offset >= visibleCount) setVisibleCount(selectedIndex + offset + 1);
  }
  function advanceQueue(completedDealId) {
    const currentIndex = rows.findIndex((row) => row.id === completedDealId);
    if (currentIndex < 0) { setQueueMessage("Guardado."); return; }
    const next = rows[currentIndex + 1];
    if (next) {
      if (currentIndex + 1 >= visibleCount) setVisibleCount(currentIndex + 2);
      setSelectedId(next.id);
      setQueueMessage(`Guardado. Siguiente operación: ${next.reference || `#${next.id}`}.`);
    } else {
      setQueueMessage("Guardado. Llegaste al final de esta vista.");
    }
  }
  function handleSaved(dealId) {
    advanceQueue(dealId);
    load();
  }
  function setFilter(key, value) {
    if (draftDirty && !window.confirm("Hay un seguimiento sin guardar. ¿Descartarlo?")) return;
    setFilters((old) => ({ ...old, [key]: value }));
  }
  function openAction(row) {
    if (["cotizar", "resolver_vencidos", "vigencia_oferta"].includes(row.next_action?.key)) return navigate(`/operations/${row.id}`);
    if (!selectDeal(row.id)) return;
    setActionRequest((current) => ({ dealId: row.id, key: row.next_action?.key, sequence: (current?.sequence || 0) + 1 }));
  }
  async function openCall(deal) {
    setCallLoading(true);
    try {
      const contacts = deal.org_id
        ? await api.get("/contacts", { params: { org_id: deal.org_id, limit: 200 } })
        : { data: [] };
      setCallContacts(Array.isArray(contacts.data) ? contacts.data : []);
      setCallDeal(deal);
    } catch { setCallContacts([]); setCallDeal(deal); }
    finally { setCallLoading(false); }
  }
  function handleOrganizationCreated(created) {
    setNotice({ text: `Organización ${created?.name || created?.razon_social || ''} creada.`, dealId: created?.prospect?.id || null, reference: created?.prospect?.reference || null });
    const nextFilters = { ...filters, businessUnit: 'atm-industrial', userId: isAdmin ? '' : filters.userId, view: 'prospects' };
    setFilters(nextFilters);
    load(nextFilters);
  }
  function handleContactCreated(created) {
    setNotice({ text: `Contacto creado en ${created.org_name || 'la organización'}.` });
    load();
  }

  return <div className="min-w-0 space-y-4 pb-8 text-slate-900">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
      <div className="min-w-0"><h1 className="text-xl font-semibold">Dashboard comercial</h1><p className="mt-0.5 text-xs text-slate-500">{new Intl.DateTimeFormat('es-PY', { timeZone: 'America/Asuncion', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</p><div className="mt-3 flex gap-1 text-xs"><button type="button" onClick={() => setFilter('view', lastWorkView.current)} aria-pressed={filters.view !== 'sessions'} className={`border-b-2 px-2 py-1.5 ${filters.view !== 'sessions' ? 'border-teal-700 font-semibold text-teal-800' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>Cartera</button><button type="button" onClick={() => setFilter('view', 'sessions')} aria-pressed={filters.view === 'sessions'} className={`border-b-2 px-2 py-1.5 ${filters.view === 'sessions' ? 'border-teal-700 font-semibold text-teal-800' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>Sesiones</button></div></div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select aria-label="Unidad" value={filters.businessUnit} onChange={(e) => setFilter("businessUnit", e.target.value)} className="max-w-44 rounded border border-slate-300 bg-white px-3 py-2"><option value="">Cargo + Industrial</option><option value="atm-cargo">ATM Cargo</option><option value="atm-industrial">ATM Industrial</option></select>
        {isAdmin && <select aria-label="Comercial" value={filters.userId} onChange={(e) => setFilter("userId", e.target.value)} className="max-w-48 rounded border border-slate-300 bg-white px-3 py-2"><option value="">Todos los comerciales</option>{users.map((person) => <option key={person.id} value={person.id}>{person.name || person.email}</option>)}</select>}
        <button type="button" onClick={() => setOrganizationModalOpen(true)} className="rounded bg-teal-700 px-3 py-2 font-medium text-white hover:bg-teal-800"><span aria-hidden="true" className="mr-1.5 text-base leading-none">+</span>Nueva organización</button>
        <button type="button" onClick={() => setContactModalOpen(true)} className="rounded border border-slate-300 bg-white px-3 py-2 font-medium text-teal-800 hover:bg-slate-50"><span aria-hidden="true" className="mr-1.5 text-base leading-none">+</span>Nuevo contacto</button>
      </div>
    </header>
    {notice && <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-l-4 border-emerald-600 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"><span>{notice.text} {notice.dealId && <Link to={`/operations/${notice.dealId}`} className="font-semibold underline">Abrir {notice.reference || 'prospecto'}</Link>}</span><button type="button" onClick={() => setNotice(null)} className="text-xs font-medium">Cerrar</button></div>}
    {!inSessions && error && <p role="alert" className="border-l-4 border-red-500 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {inSessions ? <CommercialSessions businessUnit={filters.businessUnit} userId={filters.userId} isAdmin={isAdmin} /> : <>
    <section aria-label="Indicadores comerciales" className="grid grid-cols-2 overflow-hidden rounded border border-slate-200 bg-white sm:grid-cols-4">
      <Metric label="Seguimientos vencidos" value={summary.overdue_activities || 0} urgent selected={filters.view === "overdue"} onClick={() => setFilter("view", "overdue")} />
      <Metric label="Sin próximo paso" value={summary.missing_next_activity || 0} selected={filters.view === "missing"} onClick={() => setFilter("view", "missing")} />
      <Metric label="Sin cotizar" value={summary.unquoted_deals || 0} selected={filters.view === "unquoted"} onClick={() => setFilter("view", "unquoted")} />
      <Metric label="Ofertas por vencer" value={summary.expiring_quotes || 0} urgent selected={filters.view === "expiring"} onClick={() => setFilter("view", "expiring")} />
    </section>
    {queueMessage && <p role="status" className="border-l-4 border-emerald-600 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{queueMessage}</p>}
    <section className="min-w-0 overflow-hidden rounded border border-slate-200 bg-white xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(310px,25%)]">
      <div className="min-w-0">
        <section aria-labelledby="commercial-agenda-title" className="border-b">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"><h2 id="commercial-agenda-title" className="text-sm font-semibold">Agenda de hoy <span className="ml-1 font-normal text-slate-500">{agenda.length}</span></h2>{canManageFollowups(user?.role) && <Link to="/followup-management?tab=agenda" className="text-xs font-medium text-blue-700 hover:underline">Abrir agenda completa</Link>}</div>
          {agenda.length ? <div className="divide-y border-t border-slate-100">{agenda.slice(0, agendaExpanded ? 50 : 3).map((item) => <div key={item.id} className="flex min-w-0 items-center gap-3 px-4 py-2 text-xs">
            <span className={`w-20 shrink-0 border-l-2 pl-2 font-semibold ${item.overdue ? 'border-red-500 text-red-700' : 'border-teal-600 text-teal-800'}`}>{item.overdue ? 'Vencida' : displayTime(item.due_at) || 'Hoy'}</span>
            <div className="min-w-0 flex-1"><span className="block truncate font-medium text-slate-900" title={item.title || 'Seguimiento'}>{item.title || 'Seguimiento'}</span><span className="block truncate text-slate-500" title={item.org_name}>{item.org_name}</span></div>
            <Link to={`/operations/${item.deal_id}`} className="shrink-0 font-medium text-blue-700 hover:underline">{item.reference}</Link>
          </div>)}</div> : <p className="border-t border-slate-100 px-4 py-4 text-sm text-slate-500">No hay seguimientos para hoy.</p>}
          {agenda.length > 3 && <div className="border-t border-slate-100 px-4 py-2"><button type="button" onClick={() => setAgendaExpanded((value) => !value)} className="text-xs font-medium text-blue-700 hover:underline">{agendaExpanded ? 'Mostrar menos' : `Ver ${Math.min(agenda.length - 3, 47)} más`}</button>{data?.agenda_has_more && agendaExpanded && <span className="ml-3 text-xs text-slate-500">Hay más registros en la agenda completa.</span>}</div>}
        </section>
        <section aria-labelledby="commercial-work-title" className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Vistas comerciales">
              {PRIMARY_VIEWS.map((view) => <button key={view.key} type="button" onClick={() => setFilter('view', view.key)} aria-pressed={filters.view === view.key} className={`border-b-2 px-2.5 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 ${filters.view === view.key ? 'border-teal-700 font-semibold text-teal-800' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>{view.label}</button>)}
              <select aria-label="Otras vistas" value={SECONDARY_VIEWS.some((view) => view.key === filters.view) ? filters.view : ''} onChange={(e) => e.target.value && setFilter('view', e.target.value)} className="max-w-48 rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"><option value="">Otras vistas</option>{SECONDARY_VIEWS.map((view) => <option key={view.key} value={view.key}>{view.label}</option>)}</select>
            </div>
            {canManageFollowups(user?.role) && <Link to="/followup-management" className="text-xs text-blue-700 hover:underline">Gestión de seguimiento</Link>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs text-slate-500"><h2 id="commercial-work-title" className="font-medium text-slate-700">{VIEW_NAMES[filters.view] || VIEW_NAMES.priorities}</h2><span>{loading ? 'Actualizando...' : `${rows.length} operación${rows.length === 1 ? '' : 'es'}`}</span></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[790px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-3 py-2 text-left font-medium">Operación</th><th className="px-3 py-2 text-left font-medium">Cliente</th><th className="px-3 py-2 text-left font-medium">Etapa / fechas</th><th className="px-3 py-2 text-left font-medium">Último contacto</th><th className="px-3 py-2 text-left font-medium">Próxima acción</th><th className="px-3 py-2 text-right font-medium">Acción</th></tr></thead>
              <tbody>
                {visibleRows.map((row) => <tr key={row.id} className={`border-t border-slate-100 ${selectedId === row.id ? 'bg-teal-50/70 shadow-[inset_3px_0_0_#0f766e]' : 'hover:bg-slate-50'}`}>
                  <td className="max-w-44 px-3 py-2"><Link to={`/operations/${row.id}`} aria-label={`Abrir operación ${row.reference || `#${row.id}`}`} className="font-semibold text-blue-700 hover:underline">{row.reference || `#${row.id}`}</Link><span className="block truncate text-xs text-slate-500" title={row.title || row.business_unit_name || ''}>{row.title || row.business_unit_name || '-'}</span></td>
                  <td className="max-w-44 p-0"><button type="button" onClick={() => selectDeal(row.id)} aria-pressed={selectedId === row.id} title={row.org_name || 'Sin cliente'} className="flex min-h-[58px] w-full flex-col justify-center px-3 py-2 text-left hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"><span className="block w-full truncate font-medium text-slate-900">{row.org_name || 'Sin cliente'}</span><span className="block w-full truncate text-xs text-slate-500">{row.business_unit_name || '-'}</span></button></td>
                  <td className="max-w-36 px-3 py-2 text-xs"><span className="block truncate" title={row.stage_name || ''}>{row.stage_name || '-'}</span>{row.expected_close_date && <span className={`block truncate ${row.closing_days_remaining != null && row.closing_days_remaining <= 0 ? 'font-medium text-red-700' : 'text-slate-500'}`} title={row.closing_reason || 'Fecha estimada de cierre'}>Cierre: {displayDay(row.expected_close_date)}</span>}{row.has_quote && <span className={`block truncate ${row.offer_days_remaining != null && row.offer_days_remaining <= 3 ? 'font-medium text-red-700' : 'text-slate-500'}`} title={row.offer_expires_on || row.offer_validity_text || ''}>{row.offer_days_remaining != null ? row.offer_days_remaining < 0 ? `Oferta vencida hace ${Math.abs(row.offer_days_remaining)} d` : `Oferta vence en ${row.offer_days_remaining} d` : row.offer_validity_text || 'Oferta sin vigencia'}</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs"><span className="block">{row.last_contact_at ? displayDate(row.last_contact_at) : 'Sin contacto'}</span>{row.days_since_contact != null && <span className="text-slate-500">Hace {row.days_since_contact} d</span>}</td>
                  <td className="max-w-44 px-3 py-2 text-xs"><span className={`block truncate font-medium ${row.next_action?.priority === 'alta' ? 'text-red-700' : 'text-slate-800'}`} title={row.next_action?.label || ''}>{row.next_action?.label || 'Revisar'}</span><span className="block truncate text-slate-500" title={row.next_action?.reason || ''}>{row.next_action?.reason || (row.next_activity_at ? displayDate(row.next_activity_at) : 'Sin fecha')}</span></td>
                  <td className="px-3 py-2 text-right"><button type="button" onClick={() => openAction(row)} className="whitespace-nowrap rounded border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-white">{['cotizar', 'resolver_vencidos', 'vigencia_oferta'].includes(row.next_action?.key) ? 'Abrir' : 'Registrar'}</button></td>
                </tr>)}
                {!rows.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">{loading ? 'Cargando operaciones...' : 'No hay operaciones en esta vista.'}</td></tr>}
              </tbody>
            </table>
          </div>
          {rows.length > visibleCount && <div className="border-t px-4 py-2 text-center"><button type="button" onClick={() => setVisibleCount((count) => count + 30)} className="text-xs font-medium text-blue-700 hover:underline">Mostrar más ({rows.length - visibleCount} restantes)</button></div>}
        </section>
      </div>
      <FollowupPanel key={selectedDeal?.id || "empty"} deal={selectedDeal} user={user} onSaved={handleSaved} onDirtyChange={onDirtyChange} actionRequest={actionRequest} panelRef={panelRef} onCall={openCall} callLoading={callLoading} refreshKey={callRefreshKey} queuePosition={selectedIndex + 1} queueLength={rows.length} onQueueMove={moveQueue} />
    </section>
    </>}
    {callDeal && <CallForm
      call={{
        org_id: callDeal.org_id || "",
        contact_id: callDeal.contact_id || "",
        deal_id: callDeal.id,
        phone_number: callContacts.find((contact) => Number(contact.id) === Number(callDeal.contact_id))?.phone || "",
      }}
      orgs={callDeal.org_id ? [{ id: callDeal.org_id, name: callDeal.org_name || "Cliente" }] : []}
      contacts={callContacts}
      deals={[callDeal]}
      onClose={() => setCallDeal(null)}
      onSaved={() => { setCallRefreshKey((key) => key + 1); handleSaved(callDeal.id); }}
    />}
    {organizationModalOpen && <NewOrganizationModal
      onClose={() => setOrganizationModalOpen(false)}
      onCreated={handleOrganizationCreated}
      initialExecutiveId={Number(isAdmin && filters.userId ? filters.userId : user?.id) || null}
    />}
    {contactModalOpen && <QuickContactModal
      initialOrganization={selectedDeal?.org_id ? { id: selectedDeal.org_id, name: selectedDeal.org_name } : null}
      ownerUserId={Number(isAdmin && filters.userId ? filters.userId : user?.id) || null}
      onClose={() => setContactModalOpen(false)}
      onCreated={handleContactCreated}
    />}
    {filters.view !== 'sessions' && <section className="border-t border-slate-200 pt-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">De prospección a cotización</h2><div className="flex gap-4 text-xs"><Link to="/" className="text-blue-700 hover:underline">Ver pipeline</Link><Link to="/quotes" className="text-blue-700 hover:underline">Ver cotizaciones</Link></div></div><div className="grid overflow-hidden rounded border border-slate-200 bg-white sm:grid-cols-2 lg:grid-cols-5">{stages.map((stage) => <div key={stage.key} className="min-w-0 border-b border-slate-100 px-4 py-3 sm:border-b-0 sm:border-r last:border-r-0"><span className="block truncate text-xs text-slate-600" title={stage.label}>{stage.label}</span><strong className="mt-1 block text-lg">{stage.count}</strong></div>)}{!stages.length && <p className="p-3 text-sm text-slate-500">Sin etapas para mostrar.</p>}</div></section>}
  </div>;
}
