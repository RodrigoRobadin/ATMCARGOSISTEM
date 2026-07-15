import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth.jsx';
import AdminActivity from './AdminActivity.jsx';
import VisitsCalendar from '../components/visits/VisitsCalendar.jsx';
import VisitForm from '../components/visits/VisitForm.jsx';
import VisitsList from '../components/visits/VisitsList.jsx';
import RoutesList from '../components/routes/RoutesList.jsx';

const TABS = [
  ['summary', 'Resumen'],
  ['agenda', 'Agenda'],
  ['calls', 'Llamadas'],
  ['goals', 'Objetivos'],
  ['visits', 'Visitas'],
  ['routes', 'Recorridos'],
];

const OUTCOMES = [
  ['no_contesta', 'No contesta'],
  ['interesado', 'Interesado'],
  ['no_interesado', 'No interesado'],
  ['volver_a_llamar', 'Volver a llamar'],
  ['en_negociacion', 'En negociacion'],
];
const NEED_TASK = new Set(['interesado', 'volver_a_llamar', 'en_negociacion']);

const pad = (value) => String(value).padStart(2, '0');
function localDateTime(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function dateOnly(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function monthStart() {
  const date = new Date();
  return dateOnly(new Date(date.getFullYear(), date.getMonth(), 1));
}
function formatDate(value) {
  if (!value) return '-';
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('es-PY');
}
function outcomeLabel(value) {
  return OUTCOMES.find(([key]) => key === value)?.[1] || value || '-';
}
function taskBucket(task) {
  if (task.status === 'done') return 'done';
  if (task.status === 'canceled') return 'canceled';
  const due = task.due_at ? new Date(String(task.due_at).replace(' ', 'T')) : null;
  if (!due || Number.isNaN(due.getTime())) return 'upcoming';
  const now = new Date();
  const today = dateOnly(now);
  const key = dateOnly(due);
  if (due < now && key !== today) return 'overdue';
  if (key === today) return 'today';
  return 'upcoming';
}
function downloadBlob(response, fallbackName) {
  const blob = new Blob([response.data], { type: response.headers?.['content-type'] || 'application/octet-stream' });
  const disposition = response.headers?.['content-disposition'] || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = match?.[1] || fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function Kpi({ label, value, tone = 'default' }) {
  const color = tone === 'danger' ? 'text-red-700' : tone === 'good' ? 'text-emerald-700' : 'text-slate-900';
  return (
    <div className="border-r px-4 py-3 last:border-r-0">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{Number(value || 0).toLocaleString('es-PY')}</div>
    </div>
  );
}

function CallForm({ call, orgs, contacts, deals, onClose, onSaved }) {
  const isEdit = Boolean(call?.id);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => ({
    org_id: call?.org_id || '',
    contact_id: call?.contact_id || '',
    deal_id: call?.deal_id || '',
    subject: call?.subject || 'Llamada',
    phone_number: call?.phone_number || '',
    happened_at: call?.happened_at ? String(call.happened_at).slice(0, 16).replace(' ', 'T') : localDateTime(),
    outcome: call?.outcome || 'no_contesta',
    notes: call?.notes || '',
    duration_min: call?.duration_min || 0,
    task_title: call?.task_title || '',
    task_due: call?.task_due_at ? String(call.task_due_at).slice(0, 16).replace(' ', 'T') : localDateTime(1),
    priority: call?.task_priority || 'medium',
    reminder_minutes: call?.reminder_minutes ?? 30,
  }));
  const filteredContacts = contacts.filter((item) => !form.org_id || String(item.org_id) === String(form.org_id));
  const filteredDeals = deals.filter((item) => !form.org_id || String(item.org_id) === String(form.org_id));

  function patch(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(event) {
    event.preventDefault();
    if (form.outcome !== 'no_contesta' && !form.notes.trim()) return alert('El contexto de la llamada es obligatorio.');
    if (NEED_TASK.has(form.outcome) && (!form.task_title.trim() || !form.task_due)) return alert('Este resultado requiere una proxima tarea con fecha.');
    setSaving(true);
    try {
      const payload = {
        ...form,
        org_id: form.org_id || null,
        contact_id: form.contact_id || null,
        deal_id: form.deal_id || null,
        duration_min: Number(form.duration_min || 0),
        task: form.task_title && form.task_due ? {
          title: form.task_title,
          due_at: form.task_due,
          priority: form.priority,
          reminder_minutes: Number(form.reminder_minutes || 30),
        } : null,
      };
      if (isEdit) {
        await api.patch(`/followups/calls/${call.id}`, payload);
      } else {
        const { data: started } = await api.post('/followups/calls/start', { ...payload, source: 'web', started_at: form.happened_at });
        await api.patch(`/followups/calls/${started.id}/complete`, payload);
      }
      onSaved();
      onClose();
    } catch (error) {
      alert(error?.response?.data?.error || 'No se pudo guardar la llamada.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] bg-black/35 p-3">
      <form onSubmit={save} className="ml-auto flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="text-lg font-semibold">{isEdit ? 'Editar llamada' : 'Registrar llamada'}</div>
          <button type="button" onClick={onClose} className="rounded border px-3 py-1.5 text-sm">Cerrar</button>
        </div>
        <div className="grid flex-1 gap-4 overflow-auto p-5 md:grid-cols-2">
          <label className="text-sm">Organizacion
            <select value={form.org_id} onChange={(event) => { patch('org_id', event.target.value); patch('contact_id', ''); patch('deal_id', ''); }} className="mt-1 w-full rounded border px-3 py-2">
              <option value="">Sin organizacion</option>
              {orgs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="text-sm">Contacto / cliente
            <select value={form.contact_id} onChange={(event) => patch('contact_id', event.target.value)} className="mt-1 w-full rounded border px-3 py-2">
              <option value="">Sin contacto</option>
              {filteredContacts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="text-sm">Operacion
            <select value={form.deal_id} onChange={(event) => patch('deal_id', event.target.value)} className="mt-1 w-full rounded border px-3 py-2">
              <option value="">Sin operacion</option>
              {filteredDeals.map((item) => <option key={item.id} value={item.id}>{item.reference || `OP #${item.id}`}</option>)}
            </select>
          </label>
          <label className="text-sm">Telefono
            <input value={form.phone_number} onChange={(event) => patch('phone_number', event.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
          </label>
          <label className="text-sm">Fecha y hora
            <input type="datetime-local" value={form.happened_at} onChange={(event) => patch('happened_at', event.target.value)} className="mt-1 w-full rounded border px-3 py-2" required />
          </label>
          <label className="text-sm">Duracion (minutos)
            <input type="number" min="0" value={form.duration_min} onChange={(event) => patch('duration_min', event.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
          </label>
          <label className="text-sm md:col-span-2">Asunto
            <input value={form.subject} onChange={(event) => patch('subject', event.target.value)} className="mt-1 w-full rounded border px-3 py-2" required />
          </label>
          <label className="text-sm">Resultado
            <select value={form.outcome} onChange={(event) => patch('outcome', event.target.value)} className="mt-1 w-full rounded border px-3 py-2">
              {OUTCOMES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="text-sm">Prioridad
            <select value={form.priority} onChange={(event) => patch('priority', event.target.value)} className="mt-1 w-full rounded border px-3 py-2">
              <option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option>
            </select>
          </label>
          <label className="text-sm md:col-span-2">Contexto de la llamada
            <textarea rows={5} value={form.notes} onChange={(event) => patch('notes', event.target.value)} className="mt-1 w-full rounded border px-3 py-2" placeholder={form.outcome === 'no_contesta' ? 'Opcional' : 'Que se hablo con el cliente'} />
          </label>
          <label className="text-sm">Proxima accion
            <input value={form.task_title} onChange={(event) => patch('task_title', event.target.value)} className="mt-1 w-full rounded border px-3 py-2" placeholder="Volver a llamar, enviar propuesta..." />
          </label>
          <label className="text-sm">Fecha de recordatorio
            <input type="datetime-local" value={form.task_due} onChange={(event) => patch('task_due', event.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-4">
          <button type="button" onClick={onClose} className="rounded border px-4 py-2 text-sm">Cancelar</button>
          <button disabled={saving} className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar'}</button>
        </div>
      </form>
    </div>
  );
}

function HistoryDrawer({ call, onClose }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!call?.id) return;
    api.get(`/followups/calls/${call.id}/history`).then((response) => setRows(response.data || [])).catch(() => setRows([]));
  }, [call]);
  if (!call) return null;
  return (
    <div className="fixed inset-0 z-[95] bg-black/30">
      <div className="ml-auto h-full w-full max-w-xl overflow-auto bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between border-b pb-4">
          <div><div className="text-lg font-semibold">Historial de llamada</div><div className="text-sm text-slate-500">{call.org_name || call.contact_name || `#${call.id}`}</div></div>
          <button onClick={onClose} className="rounded border px-3 py-1.5 text-sm">Cerrar</button>
        </div>
        <div className="divide-y">
          {rows.map((row) => (
            <div key={row.id} className="py-4 text-sm">
              <div className="flex justify-between gap-3"><b>{row.description || row.action}</b><span className="text-xs text-slate-500">{formatDate(row.created_at)}</span></div>
              <div className="mt-1 text-xs text-slate-500">{row.user_name || `Usuario #${row.user_id || '-'}`}</div>
              {row.meta ? <details className="mt-2"><summary className="cursor-pointer text-xs text-blue-700">Ver cambios</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-[11px]">{typeof row.meta === 'string' ? row.meta : JSON.stringify(row.meta, null, 2)}</pre></details> : null}
            </div>
          ))}
          {!rows.length ? <div className="py-8 text-center text-sm text-slate-500">Sin eventos registrados.</div> : null}
        </div>
      </div>
    </div>
  );
}

export default function FollowUpManagement() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const requestedTab = searchParams.get('tab') || 'summary';
  const selectedTaskId = Number(searchParams.get('task_id') || 0);
  const availableTabs = useMemo(() => isAdmin ? [...TABS, ['audit', 'Auditoria']] : TABS, [isAdmin]);
  const tab = availableTabs.some(([key]) => key === requestedTab) ? requestedTab : 'summary';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState('');
  const [summary, setSummary] = useState({});
  const [calls, setCalls] = useState([]);
  const [callsTotal, setCallsTotal] = useState(0);
  const [agenda, setAgenda] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [deals, setDeals] = useState([]);
  const [visits, setVisits] = useState([]);
  const [notes, setNotes] = useState([]);
  const [noteForm, setNoteForm] = useState({ org_id: '', contact_id: '', deal_id: '', content: '' });
  const [callForm, setCallForm] = useState(null);
  const [historyCall, setHistoryCall] = useState(null);
  const [agendaFilter, setAgendaFilter] = useState('overdue');
  const [filters, setFilters] = useState({ from: monthStart(), to: dateOnly(new Date()), q: '', outcome: '', status: '', source: '', task_status: '', org_id: '', contact_id: '', deal_id: '' });
  const [callsOffset, setCallsOffset] = useState(0);
  const callsLimit = 100;
  const [auditRows, setAuditRows] = useState([]);
  const [auditFilters, setAuditFilters] = useState({ action: '', entity: '', since: '' });
  const now = new Date();
  const [goalYear, setGoalYear] = useState(now.getFullYear());
  const [goalMonth, setGoalMonth] = useState(now.getMonth() + 1);
  const [goalForm, setGoalForm] = useState({ target_prospects: '', target_contacts: '', target_pipeline_amount: '' });
  const [savingGoal, setSavingGoal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const params = { ...filters, limit: callsLimit, offset: callsOffset };
    Object.keys(params).forEach((key) => { if (params[key] === '') delete params[key]; });
    if (isAdmin && userId) params.user_id = userId;
    try {
      const requests = [
        api.get('/followups/summary', { params }),
        api.get('/followups/calls', { params }),
        api.get('/followups/agenda', { params: isAdmin && userId ? { user_id: userId } : {} }),
        api.get('/organizations'),
        api.get('/contacts'),
        api.get('/deals', { params: { limit: 500 } }),
        api.get('/visits', { params: isAdmin && userId ? { user_id: userId } : {} }),
        api.get('/followups/notes', { params: isAdmin && userId ? { user_id: userId, limit: 100 } : { limit: 100 } }),
      ];
      if (isAdmin && !users.length) requests.push(api.get('/users'));
      const results = await Promise.all(requests);
      setSummary(results[0].data || {});
      setCalls(results[1].data?.rows || []); setCallsTotal(Number(results[1].data?.total || 0));
      setAgenda(results[2].data || []); setOrgs(Array.isArray(results[3].data) ? results[3].data : []);
      setContacts(Array.isArray(results[4].data) ? results[4].data : []);
      setDeals(Array.isArray(results[5].data) ? results[5].data : results[5].data?.rows || []);
      setVisits(Array.isArray(results[6].data) ? results[6].data : []);
      setNotes(Array.isArray(results[7].data) ? results[7].data : []);
      if (isAdmin && results[8]) setUsers(Array.isArray(results[8].data) ? results[8].data : []);
    } catch (requestError) {
      setError(requestError?.response?.data?.error || 'No se pudo cargar Gestion de seguimiento.');
    } finally { setLoading(false); }
  }, [filters, isAdmin, userId, users.length, callsOffset]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setCallsOffset(0); }, [filters, userId]);
  useEffect(() => {
    if (!selectedTaskId || !agenda.length) return;
    const selected = agenda.find((item) => Number(item.id) === selectedTaskId);
    if (selected) setAgendaFilter(taskBucket(selected));
  }, [selectedTaskId, agenda]);

  useEffect(() => {
    if (tab !== 'goals') return;
    const params = { year: goalYear, month: goalMonth };
    if (isAdmin && userId) params.user_id = userId;
    api.get('/sales-goals', { params }).then(({ data }) => {
      const row = Array.isArray(data) ? data[0] : null;
      setGoalForm({
        target_prospects: String(row?.target_prospects ?? ''),
        target_contacts: String(row?.target_contacts ?? ''),
        target_pipeline_amount: String(row?.target_pipeline_amount ?? ''),
      });
    }).catch(() => setGoalForm({ target_prospects: '', target_contacts: '', target_pipeline_amount: '' }));
  }, [tab, goalYear, goalMonth, isAdmin, userId]);

  async function loadAudit() {
    if (!isAdmin) return;
    const params = { limit: 300 };
    if (auditFilters.action) params.action = auditFilters.action;
    if (auditFilters.entity) params.entity = auditFilters.entity;
    if (auditFilters.since) params.from = auditFilters.since;
    if (userId) params.user_id = userId;
    const { data } = await api.get('/audit', { params });
    setAuditRows(data || []);
  }
  useEffect(() => { if (tab === 'audit') loadAudit().catch(() => setAuditRows([])); }, [tab, userId]);

  function selectTab(next) {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next); setSearchParams(params);
  }

  const agendaRows = useMemo(() => agenda.filter((task) => taskBucket(task) === agendaFilter), [agenda, agendaFilter]);
  const callsReport = useMemo(() => {
    const grouped = new Map();
    calls.forEach((call) => {
      const key = `${call.org_id || 0}-${call.contact_id || 0}`;
      const current = grouped.get(key) || {
        org_name: call.org_name || '-', contact_name: call.contact_name || '-', total: 0, last: null,
      };
      current.total += 1;
      if (!current.last || new Date(call.happened_at) > new Date(current.last.happened_at)) current.last = call;
      grouped.set(key, current);
    });
    return Array.from(grouped.values()).sort((a, b) => String(a.org_name).localeCompare(String(b.org_name)));
  }, [calls]);

  async function updateTask(task, patch) {
    try { await api.patch(`/followups/agenda/${task.id}`, patch); await load(); }
    catch (err) { alert(err?.response?.data?.error || 'No se pudo actualizar la tarea.'); }
  }

  async function invalidateCall(call) {
    const reason = window.prompt('Motivo de invalidacion:');
    if (!reason?.trim()) return;
    try { await api.post(`/followups/calls/${call.id}/invalidate`, { reason }); await load(); }
    catch (err) { alert(err?.response?.data?.error || 'No se pudo invalidar la llamada.'); }
  }

  async function exportCalls(format) {
    const params = { ...filters, format };
    if (isAdmin && userId) params.user_id = userId;
    Object.keys(params).forEach((key) => { if (params[key] === '') delete params[key]; });
    try {
      const response = await api.get('/followups/calls/export', { params, responseType: 'blob' });
      downloadBlob(response, `informe-llamadas.${format}`);
    } catch { alert('No se pudo exportar el informe.'); }
  }

  async function saveNote(event) {
    event.preventDefault();
    if (!noteForm.content.trim()) return;
    try {
      await api.post('/followups/notes', {
        ...noteForm,
        org_id: noteForm.org_id || null,
        contact_id: noteForm.contact_id || null,
        deal_id: noteForm.deal_id || null,
        source: 'web',
      });
      setNoteForm({ org_id: '', contact_id: '', deal_id: '', content: '' });
      await load();
    } catch (err) { alert(err?.response?.data?.error || 'No se pudo guardar la nota.'); }
  }

  async function saveGoal(event) {
    event.preventDefault();
    if (isAdmin && !userId) return alert('Selecciona un comercial para guardar objetivos.');
    setSavingGoal(true);
    try {
      await api.post('/sales-goals', {
        year: goalYear, month: goalMonth,
        ...(isAdmin ? { user_id: Number(userId) } : {}),
        target_prospects: Number(goalForm.target_prospects || 0),
        target_contacts: Number(goalForm.target_contacts || 0),
        target_pipeline_amount: Number(goalForm.target_pipeline_amount || 0),
      });
      alert('Objetivos guardados.');
    } catch { alert('No se pudieron guardar los objetivos.'); }
    finally { setSavingGoal(false); }
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <div><div className="text-xs text-slate-500">Comercial</div><h1 className="text-2xl font-semibold">Gestion de seguimiento</h1></div>
        {isAdmin ? <label className="text-sm">Comercial
          <select value={userId} onChange={(event) => setUserId(event.target.value)} className="ml-2 rounded border px-3 py-2">
            <option value="">Todo el equipo</option>
            {users.filter((item) => item.is_active !== 0).map((item) => <option key={item.id} value={item.id}>{item.name || item.email}</option>)}
          </select>
        </label> : <div className="text-sm text-slate-500">{user?.name || user?.email}</div>}
      </div>

      <div className="flex flex-wrap gap-2 border-b pb-3">
        {availableTabs.map(([key, label]) => <button key={key} type="button" onClick={() => selectTab(key)} className={`rounded px-3 py-2 text-sm ${tab === key ? 'bg-black text-white' : 'border bg-white hover:bg-slate-50'}`}>{label}</button>)}
      </div>
      {error ? <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {loading ? <div className="py-8 text-center text-sm text-slate-500">Cargando...</div> : null}

      {!loading && tab === 'summary' ? <div className="space-y-4">
        <div className="grid overflow-hidden border bg-white sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Llamadas del periodo" value={summary.total_calls} />
          <Kpi label="Llamadas hoy" value={summary.calls_today} />
          <Kpi label="Resultados pendientes" value={summary.pending_results} tone={summary.pending_results ? 'danger' : 'default'} />
          <Kpi label="Tareas vencidas" value={summary.overdue_tasks} tone={summary.overdue_tasks ? 'danger' : 'default'} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="border bg-white"><div className="border-b px-4 py-3 font-semibold">Proximas acciones</div><div className="divide-y">
            {agenda.filter((item) => item.status === 'pending').slice(0, 8).map((item) => <button key={item.id} onClick={() => selectTab('agenda')} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50"><span><b>{item.title}</b><span className="ml-2 text-slate-500">{item.org_name || item.contact_name || ''}</span></span><span className={taskBucket(item) === 'overdue' ? 'text-red-700' : 'text-slate-500'}>{formatDate(item.due_at)}</span></button>)}
            {!agenda.some((item) => item.status === 'pending') ? <div className="px-4 py-8 text-center text-sm text-slate-500">Sin tareas pendientes.</div> : null}
          </div></section>
          <section className="border bg-white"><div className="flex items-center justify-between border-b px-4 py-3"><b>Llamadas recientes</b><button onClick={() => setCallForm({})} className="rounded bg-black px-3 py-1.5 text-sm text-white">Nueva llamada</button></div><div className="divide-y">
            {calls.slice(0, 8).map((call) => <button key={call.id} onClick={() => setCallForm(call)} className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50"><span><b>{call.org_name || call.contact_name || 'Sin cliente'}</b><span className="mt-1 block text-slate-500">{call.notes || call.subject}</span></span><span className="whitespace-nowrap text-xs text-slate-500">{formatDate(call.happened_at)}</span></button>)}
          </div></section>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="border bg-white">
            <div className="border-b px-4 py-3 font-semibold">Nota de seguimiento</div>
            <form onSubmit={saveNote} className="space-y-3 p-4">
              <div className="grid gap-2 sm:grid-cols-3">
                <select value={noteForm.org_id} onChange={(e)=>setNoteForm({...noteForm,org_id:e.target.value,contact_id:'',deal_id:''})} className="rounded border px-2 py-2 text-sm"><option value="">Organizacion</option>{orgs.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select>
                <select value={noteForm.contact_id} onChange={(e)=>setNoteForm({...noteForm,contact_id:e.target.value})} className="rounded border px-2 py-2 text-sm"><option value="">Contacto</option>{contacts.filter((item)=>!noteForm.org_id||String(item.org_id)===String(noteForm.org_id)).map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select>
                <select value={noteForm.deal_id} onChange={(e)=>setNoteForm({...noteForm,deal_id:e.target.value})} className="rounded border px-2 py-2 text-sm"><option value="">Operacion</option>{deals.filter((item)=>!noteForm.org_id||String(item.org_id)===String(noteForm.org_id)).map((item)=><option key={item.id} value={item.id}>{item.reference||`OP #${item.id}`}</option>)}</select>
              </div>
              <textarea required rows={3} value={noteForm.content} onChange={(e)=>setNoteForm({...noteForm,content:e.target.value})} placeholder="Contexto, acuerdo o dato importante..." className="w-full rounded border px-3 py-2 text-sm" />
              <button className="rounded bg-black px-3 py-2 text-sm text-white">Guardar nota</button>
            </form>
          </section>
          <section className="border bg-white">
            <div className="border-b px-4 py-3 font-semibold">Notas recientes</div>
            <div className="max-h-[310px] divide-y overflow-auto">{notes.slice(0,12).map((note)=><div key={note.id} className="px-4 py-3 text-sm"><div className="flex justify-between gap-2"><b>{note.org_name||note.contact_name||'Sin cliente'}</b><span className="text-xs text-slate-500">{formatDate(note.created_at)}</span></div><div className="mt-1 whitespace-pre-wrap text-slate-700">{note.content}</div><div className="mt-1 text-xs text-slate-500">{note.user_name||''}{note.deal_reference?` - ${note.deal_reference}`:''}</div></div>)}{!notes.length?<div className="px-4 py-8 text-center text-sm text-slate-500">Sin notas registradas.</div>:null}</div>
          </section>
        </div>
        <section className="border bg-white">
          <div className="border-b px-4 py-3"><b>Resumen agrupado de llamadas</b><span className="ml-2 text-xs text-slate-500">Organizacion y contacto</span></div>
          <div className="overflow-auto"><table className="min-w-[850px] w-full text-sm"><thead className="bg-slate-100"><tr><th className="px-3 py-2 text-left">Organizacion</th><th className="px-3 py-2 text-left">Contacto</th><th className="px-3 py-2 text-right">Llamadas</th><th className="px-3 py-2 text-left">Ultima llamada</th><th className="px-3 py-2 text-left">Resultado</th><th className="px-3 py-2 text-left">Ultimo contexto</th></tr></thead><tbody>{callsReport.map((row,index)=><tr key={`${row.org_name}-${row.contact_name}-${index}`} className="border-t"><td className="px-3 py-2">{row.org_name}</td><td className="px-3 py-2">{row.contact_name}</td><td className="px-3 py-2 text-right">{row.total}</td><td className="px-3 py-2">{formatDate(row.last?.happened_at)}</td><td className="px-3 py-2">{outcomeLabel(row.last?.outcome)}</td><td className="max-w-[360px] px-3 py-2">{row.last?.notes||'-'}</td></tr>)}</tbody></table></div>
        </section>
      </div> : null}

      {!loading && tab === 'agenda' ? <div className="space-y-3">
        <div className="flex flex-wrap gap-2">{[['overdue','Vencidas'],['today','Hoy'],['upcoming','Proximas'],['done','Completadas'],['canceled','Canceladas']].map(([key,label]) => <button key={key} onClick={() => setAgendaFilter(key)} className={`rounded px-3 py-2 text-sm ${agendaFilter === key ? 'bg-black text-white' : 'border bg-white'}`}>{label} ({agenda.filter((item) => taskBucket(item) === key).length})</button>)}</div>
        <div className="overflow-auto border bg-white"><table className="min-w-[900px] w-full text-sm"><thead className="bg-slate-100"><tr><th className="px-3 py-2 text-left">Vencimiento</th><th className="px-3 py-2 text-left">Tarea</th><th className="px-3 py-2 text-left">Cliente</th><th className="px-3 py-2 text-left">Operacion</th><th className="px-3 py-2 text-left">Responsable</th><th className="px-3 py-2 text-right">Acciones</th></tr></thead><tbody>
          {agendaRows.map((task) => <tr key={task.id} className={`border-t ${Number(task.id)===selectedTaskId?'bg-amber-50 ring-1 ring-inset ring-amber-300':''}`}> <td className={`px-3 py-2 ${taskBucket(task)==='overdue'?'font-semibold text-red-700':''}`}>{formatDate(task.due_at)}</td><td className="px-3 py-2"><b>{task.title}</b><div className="text-xs text-slate-500">{task.priority}</div></td><td className="px-3 py-2">{task.org_name || task.contact_name || '-'}</td><td className="px-3 py-2">{task.deal_reference || '-'}</td><td className="px-3 py-2">{task.user_name || '-'}</td><td className="px-3 py-2 text-right">{task.status==='pending'?<><button onClick={() => updateTask(task,{status:'done'})} className="mr-2 rounded border px-2 py-1">Completar</button><button onClick={() => updateTask(task,{status:'canceled'})} className="rounded border px-2 py-1">Cancelar</button></>:<button onClick={() => updateTask(task,{status:'pending'})} className="rounded border px-2 py-1">Reabrir</button>}</td></tr>)}
          {!agendaRows.length ? <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">Sin tareas en esta vista.</td></tr> : null}
        </tbody></table></div>
      </div> : null}

      {!loading && tab === 'calls' ? <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2 border bg-white p-3">
          <label className="text-xs">Desde<input type="date" value={filters.from} onChange={(e)=>setFilters({...filters,from:e.target.value})} className="mt-1 block rounded border px-2 py-1.5 text-sm" /></label>
          <label className="text-xs">Hasta<input type="date" value={filters.to} onChange={(e)=>setFilters({...filters,to:e.target.value})} className="mt-1 block rounded border px-2 py-1.5 text-sm" /></label>
          <label className="text-xs">Resultado<select value={filters.outcome} onChange={(e)=>setFilters({...filters,outcome:e.target.value})} className="mt-1 block rounded border px-2 py-1.5 text-sm"><option value="">Todos</option>{OUTCOMES.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
          <label className="text-xs">Estado<select value={filters.status} onChange={(e)=>setFilters({...filters,status:e.target.value})} className="mt-1 block rounded border px-2 py-1.5 text-sm"><option value="">Activas</option><option value="pending_result">Pendiente resultado</option><option value="completed">Completada</option><option value="invalidated">Invalidada</option></select></label>
          <label className="text-xs">Origen<select value={filters.source} onChange={(e)=>setFilters({...filters,source:e.target.value})} className="mt-1 block rounded border px-2 py-1.5 text-sm"><option value="">Todos</option><option value="mobile">Movil</option><option value="web">Web</option><option value="legacy">Legacy</option></select></label>
          <label className="text-xs">Tarea<select value={filters.task_status} onChange={(e)=>setFilters({...filters,task_status:e.target.value})} className="mt-1 block rounded border px-2 py-1.5 text-sm"><option value="">Todas</option><option value="pending">Pendiente</option><option value="done">Completada</option><option value="canceled">Cancelada</option><option value="sin_tarea">Sin tarea</option></select></label>
          <label className="text-xs">Organizacion<select value={filters.org_id} onChange={(e)=>setFilters({...filters,org_id:e.target.value,contact_id:'',deal_id:''})} className="mt-1 block max-w-[200px] rounded border px-2 py-1.5 text-sm"><option value="">Todas</option>{orgs.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="text-xs">Contacto<select value={filters.contact_id} onChange={(e)=>setFilters({...filters,contact_id:e.target.value})} className="mt-1 block max-w-[180px] rounded border px-2 py-1.5 text-sm"><option value="">Todos</option>{contacts.filter((item)=>!filters.org_id||String(item.org_id)===String(filters.org_id)).map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="text-xs">Operacion<select value={filters.deal_id} onChange={(e)=>setFilters({...filters,deal_id:e.target.value})} className="mt-1 block max-w-[180px] rounded border px-2 py-1.5 text-sm"><option value="">Todas</option>{deals.filter((item)=>!filters.org_id||String(item.org_id)===String(filters.org_id)).map((item)=><option key={item.id} value={item.id}>{item.reference||`OP #${item.id}`}</option>)}</select></label>
          <label className="min-w-[220px] flex-1 text-xs">Buscar<input value={filters.q} onChange={(e)=>setFilters({...filters,q:e.target.value})} placeholder="Cliente, contexto, operacion..." className="mt-1 block w-full rounded border px-2 py-1.5 text-sm" /></label>
          <button onClick={load} className="rounded border px-3 py-2 text-sm">Aplicar</button>
          <button onClick={() => exportCalls('xlsx')} className="rounded border px-3 py-2 text-sm">Excel</button>
          <button onClick={() => exportCalls('pdf')} className="rounded border px-3 py-2 text-sm">PDF</button>
          <button onClick={() => setCallForm({})} className="rounded bg-black px-3 py-2 text-sm text-white">Nueva llamada</button>
        </div>
        <div className="text-sm text-slate-500">{callsTotal} llamada(s)</div>
        <div className="overflow-auto border bg-white"><table className="min-w-[1380px] w-full text-sm"><thead className="bg-slate-100"><tr>{['Fecha y hora','Comercial','Organizacion','Contacto','Operacion','Contexto','Resultado','Duracion','Proxima tarea','Estado','Origen','Acciones'].map((label)=><th key={label} className="px-3 py-2 text-left">{label}</th>)}</tr></thead><tbody>
          {calls.map((call)=><tr key={call.id} className="border-t align-top"><td className="whitespace-nowrap px-3 py-2">{formatDate(call.happened_at)}</td><td className="px-3 py-2">{call.user_name||call.user_email||'-'}</td><td className="px-3 py-2">{call.org_id?<button onClick={()=>navigate(`/organizations/${call.org_id}`)} className="text-blue-700 hover:underline">{call.org_name||`#${call.org_id}`}</button>:'-'}</td><td className="px-3 py-2">{call.contact_id?<button onClick={()=>navigate(`/contacts/${call.contact_id}`)} className="text-blue-700 hover:underline">{call.contact_name||`#${call.contact_id}`}</button>:'-'}</td><td className="px-3 py-2">{call.deal_id?<button onClick={()=>navigate(`/operations/${call.deal_id}`)} className="text-blue-700 hover:underline">{call.deal_reference||`OP #${call.deal_id}`}</button>:'-'}</td><td className="max-w-[280px] whitespace-pre-wrap px-3 py-2">{call.notes||'-'}</td><td className="px-3 py-2">{outcomeLabel(call.outcome)}</td><td className="px-3 py-2">{Number(call.duration_min||0)} min</td><td className="px-3 py-2"><b>{call.task_title||'-'}</b>{call.task_due_at?<div className="text-xs text-slate-500">{formatDate(call.task_due_at)}</div>:null}</td><td className="px-3 py-2">{call.status==='pending_result'?<span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Pendiente</span>:call.status}</td><td className="px-3 py-2">{call.source}</td><td className="whitespace-nowrap px-3 py-2"><button onClick={()=>setCallForm(call)} className="mr-2 rounded border px-2 py-1">Editar</button><button onClick={()=>setHistoryCall(call)} className="mr-2 rounded border px-2 py-1">Historial</button>{isAdmin?<button onClick={()=>invalidateCall(call)} className="rounded border border-red-200 px-2 py-1 text-red-700">Invalidar</button>:null}</td></tr>)}
          {!calls.length?<tr><td colSpan={12} className="px-3 py-8 text-center text-slate-500">Sin llamadas para los filtros aplicados.</td></tr>:null}
        </tbody></table></div>
        <div className="flex items-center justify-end gap-3 text-sm"><button disabled={callsOffset===0} onClick={()=>setCallsOffset(Math.max(0,callsOffset-callsLimit))} className="rounded border px-3 py-1.5 disabled:opacity-40">Anterior</button><span>{callsTotal ? `${callsOffset+1}-${Math.min(callsOffset+calls.length,callsTotal)} de ${callsTotal}` : '0 llamadas'}</span><button disabled={callsOffset+calls.length>=callsTotal} onClick={()=>setCallsOffset(callsOffset+callsLimit)} className="rounded border px-3 py-1.5 disabled:opacity-40">Siguiente</button></div>
      </div> : null}

      {!loading && tab === 'goals' ? <form onSubmit={saveGoal} className="max-w-4xl border bg-white p-5"><div className="mb-4 flex gap-3"><label className="text-sm">Año<input type="number" value={goalYear} onChange={(e)=>setGoalYear(Number(e.target.value))} className="ml-2 w-24 rounded border px-2 py-1.5" /></label><label className="text-sm">Mes<select value={goalMonth} onChange={(e)=>setGoalMonth(Number(e.target.value))} className="ml-2 rounded border px-2 py-1.5">{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{new Date(2026,i,1).toLocaleDateString('es-PY',{month:'long'})}</option>)}</select></label></div><div className="grid gap-4 md:grid-cols-3"><label className="text-sm">Prospectos<input type="number" min="0" value={goalForm.target_prospects} onChange={(e)=>setGoalForm({...goalForm,target_prospects:e.target.value})} className="mt-1 w-full rounded border px-3 py-2" /></label><label className="text-sm">Contactos<input type="number" min="0" value={goalForm.target_contacts} onChange={(e)=>setGoalForm({...goalForm,target_contacts:e.target.value})} className="mt-1 w-full rounded border px-3 py-2" /></label><label className="text-sm">Monto pipeline<input type="number" min="0" step="0.01" value={goalForm.target_pipeline_amount} onChange={(e)=>setGoalForm({...goalForm,target_pipeline_amount:e.target.value})} className="mt-1 w-full rounded border px-3 py-2" /></label></div><button disabled={savingGoal} className="mt-4 rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50">{savingGoal?'Guardando...':'Guardar objetivos'}</button></form> : null}

      {!loading && tab === 'visits' ? <div className="space-y-4"><VisitsCalendar visits={visits} tasks={agenda.filter((item)=>item.status==='pending')} /><VisitForm orgs={orgs} contacts={contacts} onSuccess={load} /><VisitsList visits={visits} onRefresh={load} orgs={orgs} contacts={contacts} /></div> : null}
      {!loading && tab === 'routes' ? <RoutesList userId={isAdmin ? userId : ''} onSelectRoute={() => {}} /> : null}
      {!loading && tab === 'audit' && isAdmin ? <div className="space-y-5"><AdminActivity /><section className="border bg-white"><div className="flex flex-wrap items-end gap-2 border-b p-4"><b className="mr-auto">Historial de auditoria</b><input placeholder="Accion" value={auditFilters.action} onChange={(e)=>setAuditFilters({...auditFilters,action:e.target.value})} className="rounded border px-2 py-1.5 text-sm" /><input placeholder="Entidad" value={auditFilters.entity} onChange={(e)=>setAuditFilters({...auditFilters,entity:e.target.value})} className="rounded border px-2 py-1.5 text-sm" /><input type="date" value={auditFilters.since} onChange={(e)=>setAuditFilters({...auditFilters,since:e.target.value})} className="rounded border px-2 py-1.5 text-sm" /><button onClick={()=>loadAudit()} className="rounded border px-3 py-1.5 text-sm">Aplicar</button></div><div className="overflow-auto"><table className="min-w-[900px] w-full text-sm"><thead className="bg-slate-100"><tr><th className="px-3 py-2 text-left">Fecha</th><th className="px-3 py-2 text-left">Usuario</th><th className="px-3 py-2 text-left">Accion</th><th className="px-3 py-2 text-left">Entidad</th><th className="px-3 py-2 text-left">Detalle</th></tr></thead><tbody>{auditRows.map((row)=><tr key={row.id} className="border-t"><td className="px-3 py-2">{formatDate(row.created_at)}</td><td className="px-3 py-2">{row.user_name||row.user_id||'-'}</td><td className="px-3 py-2">{row.action}</td><td className="px-3 py-2">{row.entity} #{row.entity_id||'-'}</td><td className="px-3 py-2">{row.description||'-'}</td></tr>)}</tbody></table></div></section></div> : null}

      {callForm ? <CallForm call={callForm.id ? callForm : null} orgs={orgs} contacts={contacts} deals={deals} onClose={()=>setCallForm(null)} onSaved={load} /> : null}
      {historyCall ? <HistoryDrawer call={historyCall} onClose={()=>setHistoryCall(null)} /> : null}
    </div>
  );
}
