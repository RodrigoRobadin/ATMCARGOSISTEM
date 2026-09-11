import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, API_BASE } from '../api';
import { useAuth } from '../auth.jsx';
import AccountExecutiveSelect from './AccountExecutiveSelect.jsx';

const ACTIVITY_TYPES = [
  ['call', 'Llamada'],
  ['meeting', 'Reunión'],
  ['task', 'Tarea'],
  ['email', 'Correo electrónico'],
];
const OUTCOMES = [
  ['no_contesta', 'No contesta'],
  ['interesado', 'Interesado'],
  ['no_interesado', 'No interesado'],
  ['volver_a_llamar', 'Volver a llamar'],
  ['en_negociacion', 'En negociación'],
];
const NEED_TASK = new Set(['interesado', 'volver_a_llamar', 'en_negociacion']);
const FILTERS = [
  ['all', 'Todo'], ['activity', 'Actividades'], ['note', 'Notas'],
  ['call', 'Llamadas'], ['file', 'Archivos'], ['deal', 'Operaciones'],
];
const pad = (value) => String(value).padStart(2, '0');

function dateInput(offsetDays = 0) {
  const value = new Date();
  value.setDate(value.getDate() + offsetDays);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}
function timeInput(offsetMinutes = 0) {
  const value = new Date(Date.now() + offsetMinutes * 60000);
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}
function dateTimeInput(offsetDays = 0) {
  return `${dateInput(offsetDays)}T${timeInput()}`;
}
function formatDateTime(value) {
  if (!value) return 'Sin fecha';
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString('es-PY', { dateStyle: 'medium', timeStyle: 'short' });
}
function resolveUploadUrl(value) {
  if (!value || /^https?:\/\//i.test(value)) return value || '#';
  if (typeof window === 'undefined') return value;
  if (/^https?:\/\//i.test(API_BASE)) {
    try { return `${new URL(API_BASE).origin}${value.startsWith('/') ? '' : '/'}${value}`; } catch {}
  }
  return `${window.location.origin}${value.startsWith('/') ? '' : '/'}${value}`;
}
function outcomeLabel(value) {
  return OUTCOMES.find(([key]) => key === value)?.[1] || value || 'Sin resultado';
}
function priorityLabel(value) {
  return value === 'high' ? 'Alta' : value === 'low' ? 'Baja' : 'Media';
}
function priorityClass(value) {
  if (value === 'high') return 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300';
  if (value === 'low') return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
  return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300';
}
function Empty({ children }) {
  return <div className="border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">{children}</div>;
}
function Title({ children, count }) {
  return <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{children}{Number.isFinite(count) ? <span className="ml-1 font-normal text-slate-400">({count})</span> : null}</div>;
}

export default function OrganizationEngagementPanel({ org = null, person = null, activities = [], activitiesLoading, deals = [], accountExec, onActivitiesChanged }) {
  const { user } = useAuth();
  const isPerson = Boolean(person);
  const entity = person || org;
  const entityId = Number(entity?.id);
  const orgId = Number(person?.org_id || org?.id) || null;
  const contacts = isPerson ? [person] : (Array.isArray(org?.contacts) ? org.contacts : []);
  const subjectLabel = isPerson ? 'persona' : 'organización';
  const fileEntityType = isPerson ? 'contact' : 'organization';
  const fileInputRef = useRef(null);
  const [tab, setTab] = useState('activity');
  const [filter, setFilter] = useState('all');
  const [expandFocus, setExpandFocus] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [calls, setCalls] = useState([]);
  const [callAccessError, setCallAccessError] = useState('');
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [activity, setActivity] = useState({
    subject: '', type: 'call', due_date: dateInput(), due_time: timeInput(60),
    priority: 'medium', notes: '', assigned_to: '', person_id: person?.id || '',
  });
  const [call, setCall] = useState({
    subject: 'Llamada', contact_id: person?.id || '', deal_id: '', phone_number: person?.phone || org?.phone || '',
    happened_at: dateTimeInput(), duration_min: 0, outcome: 'no_contesta', notes: '',
    task_title: '', task_due: dateTimeInput(1), priority: 'medium',
  });

  useEffect(() => {
    setActivity((current) => current.assigned_to ? current : { ...current, assigned_to: accountExec?.id || user?.id || '' });
  }, [accountExec?.id, user?.id]);

  async function loadCalls() {
    try {
      const params = isPerson ? { contact_id: entityId, limit: 200 } : { org_id: entityId, limit: 200 };
      const { data } = await api.get('/followups/calls', { params });
      setCalls(Array.isArray(data) ? data : data?.rows || []);
      setCallAccessError('');
    } catch (error) {
      setCalls([]);
      setCallAccessError(error?.response?.status === 403 ? 'Tu rol no tiene acceso al historial de llamadas.' : 'No se pudieron cargar las llamadas.');
    }
  }
  async function loadFiles() {
    try {
      const { data } = await api.get('/mobile/attachments', { params: { entity_type: fileEntityType, entity_id: entityId } });
      setFiles(Array.isArray(data) ? data : []);
    } catch { setFiles([]); }
  }
  useEffect(() => {
    loadCalls();
    loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, fileEntityType, isPerson]);

  async function saveActivity(event) {
    event.preventDefault();
    if (!activity.subject.trim()) return;
    setSaving(true); setMessage('');
    try {
      await api.post('/activities', {
        type: activity.type, subject: activity.subject.trim(),
        due_date: `${activity.due_date} ${activity.due_time}:00`, priority: activity.priority,
        notes: activity.notes.trim() || null, assigned_to: activity.assigned_to || null,
        person_id: isPerson ? entityId : (activity.person_id || null), org_id: orgId, done: 0,
      });
      setActivity((current) => ({ ...current, subject: '', notes: '', due_date: dateInput(), due_time: timeInput(60) }));
      setMessage('Actividad guardada.');
      await onActivitiesChanged?.();
    } catch (error) { setMessage(error?.response?.data?.error || 'No se pudo guardar la actividad.'); }
    finally { setSaving(false); }
  }
  async function saveNote(event) {
    event.preventDefault();
    if (!noteText.trim()) return;
    setSaving(true); setMessage('');
    try {
      await api.post('/activities', { type: 'note', subject: null, notes: noteText.trim(), person_id: isPerson ? entityId : null, org_id: orgId, done: 1 });
      setNoteText(''); setMessage('Nota guardada.');
      await onActivitiesChanged?.();
    } catch (error) { setMessage(error?.response?.data?.error || 'No se pudo guardar la nota.'); }
    finally { setSaving(false); }
  }
  async function saveCall(event) {
    event.preventDefault();
    if (call.outcome !== 'no_contesta' && !call.notes.trim()) return setMessage('El contexto de la llamada es obligatorio.');
    if (NEED_TASK.has(call.outcome) && (!call.task_title.trim() || !call.task_due)) return setMessage('Este resultado requiere una próxima tarea con fecha y hora.');
    setSaving(true); setMessage('');
    try {
      const payload = {
        org_id: orgId, contact_id: isPerson ? entityId : (call.contact_id || null), deal_id: call.deal_id || null,
        subject: call.subject.trim() || 'Llamada', phone_number: call.phone_number.trim() || null,
        happened_at: call.happened_at, duration_min: Number(call.duration_min || 0),
        outcome: call.outcome, notes: call.notes.trim(),
        task: call.task_title.trim() && call.task_due ? { title: call.task_title.trim(), due_at: call.task_due, priority: call.priority, reminder_minutes: 30 } : null,
      };
      const { data: started } = await api.post('/followups/calls/start', { ...payload, source: 'web', started_at: call.happened_at });
      await api.patch(`/followups/calls/${started.id}/complete`, payload);
      setCall((current) => ({ ...current, subject: 'Llamada', happened_at: dateTimeInput(), duration_min: 0, notes: '', task_title: '', task_due: dateTimeInput(1) }));
      setMessage('Llamada registrada en Gestión de seguimiento.');
      await loadCalls();
    } catch (error) { setMessage(error?.response?.data?.error || 'No se pudo registrar la llamada.'); }
    finally { setSaving(false); }
  }
  async function completeActivity(item) {
    try { await api.patch(`/activities/${item.id}`, { done: 1 }); await onActivitiesChanged?.(); }
    catch (error) { setMessage(error?.response?.data?.error || 'No se pudo completar la actividad.'); }
  }
  async function uploadFiles(selected) {
    const list = Array.from(selected || []);
    if (!list.length) return;
    setUploading(true); setMessage('');
    try {
      for (const file of list) {
        const form = new FormData();
        form.append('entity_type', fileEntityType); form.append('entity_id', String(entityId));
        form.append('type', fileEntityType); form.append('file', file);
        await api.post('/mobile/attachments', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      setMessage(list.length === 1 ? 'Archivo guardado.' : 'Archivos guardados.');
      await loadFiles();
    } catch (error) { setMessage(error?.response?.data?.error || 'No se pudieron cargar los archivos.'); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  }

  const focus = useMemo(() => activities
    .filter((item) => item.type !== 'note' && !Number(item.done))
    .sort((a, b) => new Date(a.due_date || '2999-12-31') - new Date(b.due_date || '2999-12-31')), [activities]);

  const history = useMemo(() => {
    const activityRows = activities.map((item) => ({
      id: `activity-${item.id}`, kind: item.type === 'note' ? 'note' : 'activity',
      title: item.type === 'note' ? 'Nota' : item.subject || 'Actividad', description: item.notes || '',
      date: item.created_at || item.due_date,
      meta: item.type === 'note' ? item.created_by_name || '' : [ACTIVITY_TYPES.find(([key]) => key === item.type)?.[1] || item.type, formatDateTime(item.due_date), item.assigned_to_name].filter(Boolean).join(' · '),
    }));
    const callRows = calls.map((item) => ({ id: `call-${item.id}`, kind: 'call', title: item.subject || 'Llamada', description: item.notes || '', date: item.happened_at || item.created_at, meta: [outcomeLabel(item.outcome), item.contact_name, item.user_name].filter(Boolean).join(' · ') }));
    const dealRows = deals.map((item) => ({ id: `deal-${item.id}`, kind: 'deal', title: item.reference || item.title || `Operación #${item.id}`, description: item.reference && item.title ? item.title : '', date: item.updated_at || item.created_at, meta: item.stage_name || item.currency || '', href: `/operations/${item.id}` }));
    const fileRows = files.map((item) => ({ id: `file-${item.id}`, kind: 'file', title: item.original_name || item.filename || 'Archivo', description: item.mime_type || '', date: item.created_at, meta: item.size_bytes ? `${Math.max(1, Math.round(Number(item.size_bytes) / 1024))} KB` : '', href: resolveUploadUrl(item.url), external: true }));
    return [...activityRows, ...callRows, ...dealRows, ...fileRows].filter((item) => item.date).sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [activities, calls, deals, files]);
  const visibleHistory = filter === 'all' ? history : history.filter((item) => item.kind === filter);

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex overflow-x-auto border-b border-slate-200 dark:border-slate-700">
          {[
            ['activity', 'Actividad', 'A'], ['note', 'Nota', 'N'],
            ['call', 'Llamada', '☎'], ['files', 'Archivos', 'AD'],
          ].map(([key, label, icon]) => (
            <button key={key} type="button" onClick={() => { setTab(key); setMessage(''); }} className={`flex min-w-max items-center gap-2 border-b-2 px-4 py-3 text-sm ${tab === key ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'border-transparent text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
              <span className="inline-flex h-5 min-w-5 items-center justify-center text-[10px] font-bold" aria-hidden="true">{icon}</span>{label}
            </button>
          ))}
        </div>

        {message ? <div className={`border-b px-5 py-2 text-sm ${/guardad|registrad/i.test(message) ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'}`}>{message}</div> : null}

        {tab === 'activity' ? (
          <form onSubmit={saveActivity} className="space-y-4 p-5">
            <input value={activity.subject} onChange={(event) => setActivity((current) => ({ ...current, subject: event.target.value }))} placeholder="Título / asunto de la actividad" className="w-full border-0 border-b border-slate-200 px-0 py-2 text-lg font-medium outline-none focus:border-blue-600 focus:ring-0 dark:border-slate-700 dark:bg-slate-900" required />
            <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo de actividad">
              {ACTIVITY_TYPES.map(([value, label]) => (
                <button key={value} type="button" onClick={() => setActivity((current) => ({ ...current, type: value }))} className={`rounded-md border px-3 py-2 text-sm ${activity.type === value ? 'border-blue-600 bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}>{label}</button>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-sm text-slate-600 dark:text-slate-300">Fecha de vencimiento
                <input type="date" value={activity.due_date} onChange={(event) => setActivity((current) => ({ ...current, due_date: event.target.value }))} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-slate-700 dark:bg-slate-800" required />
              </label>
              <label className="text-sm text-slate-600 dark:text-slate-300">Horario
                <input type="time" value={activity.due_time} onChange={(event) => setActivity((current) => ({ ...current, due_time: event.target.value }))} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-slate-700 dark:bg-slate-800" required />
              </label>
              <label className="text-sm text-slate-600 dark:text-slate-300">Prioridad
                <select value={activity.priority} onChange={(event) => setActivity((current) => ({ ...current, priority: event.target.value }))} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-slate-700 dark:bg-slate-800"><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option></select>
              </label>
            </div>
            <textarea value={activity.notes} onChange={(event) => setActivity((current) => ({ ...current, notes: event.target.value }))} rows={4} placeholder="Notas de la actividad" className="w-full rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/20" />
            <div className="grid gap-3 md:grid-cols-2">
              <AccountExecutiveSelect value={activity.assigned_to || null} onChange={(value) => setActivity((current) => ({ ...current, assigned_to: value || '' }))} onlyActive={false} label="Ejecutivo de cuenta" placeholder="Seleccionar ejecutivo" />
              <label className="text-sm text-slate-600 dark:text-slate-300">{isPerson ? 'Persona' : 'Persona de la organización'}
                <select disabled={isPerson} value={isPerson ? entityId : activity.person_id} onChange={(event) => setActivity((current) => ({ ...current, person_id: event.target.value }))} className="mt-1 w-full rounded-md border px-3 py-2 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:disabled:bg-slate-900"><option value="">Sin persona específica</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select>
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
              <button type="button" onClick={() => setActivity((current) => ({ ...current, subject: '', notes: '' }))} className="rounded-md border px-4 py-2 text-sm dark:border-slate-700">Cancelar</button>
              <button disabled={saving || !activity.subject.trim()} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar actividad'}</button>
            </div>
          </form>
        ) : null}

        {tab === 'note' ? (
          <form onSubmit={saveNote} className="p-5">
            <textarea autoFocus value={noteText} onChange={(event) => setNoteText(event.target.value)} rows={7} placeholder={`Escribir una nota sobre esta ${subjectLabel}...`} className="w-full resize-y border-0 bg-amber-50 px-4 py-3 text-sm outline-none ring-1 ring-amber-200 focus:ring-2 focus:ring-amber-400 dark:bg-amber-950/30 dark:ring-amber-900" />
            <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setNoteText('')} className="rounded-md border px-4 py-2 text-sm dark:border-slate-700">Cancelar</button><button disabled={saving || !noteText.trim()} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar nota'}</button></div>
          </form>
        ) : null}

        {tab === 'call' ? (
          <form onSubmit={saveCall} className="grid gap-4 p-5 md:grid-cols-2">
            {callAccessError ? <div className="md:col-span-2 text-sm text-amber-700">{callAccessError}</div> : null}
            <label className="text-sm text-slate-600 dark:text-slate-300 md:col-span-2">Asunto<input value={call.subject} onChange={(event) => setCall((current) => ({ ...current, subject: event.target.value }))} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-slate-700 dark:bg-slate-800" /></label>
            <label className="text-sm text-slate-600 dark:text-slate-300">Contacto
              <select disabled={isPerson} value={isPerson ? entityId : call.contact_id} onChange={(event) => { const contact = contacts.find((item) => String(item.id) === String(event.target.value)); setCall((current) => ({ ...current, contact_id: event.target.value, phone_number: contact?.phone || current.phone_number })); }} className="mt-1 w-full rounded-md border px-3 py-2 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:disabled:bg-slate-900"><option value="">Organización</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select>
            </label>
            <label className="text-sm text-slate-600 dark:text-slate-300">Operación relacionada<select value={call.deal_id} onChange={(event) => setCall((current) => ({ ...current, deal_id: event.target.value }))} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-slate-700 dark:bg-slate-800"><option value="">Sin operación</option>{deals.map((deal) => <option key={deal.id} value={deal.id}>{deal.reference || deal.title || `#${deal.id}`}</option>)}</select></label>
            <label className="text-sm text-slate-600 dark:text-slate-300">Teléfono<input value={call.phone_number} onChange={(event) => setCall((current) => ({ ...current, phone_number: event.target.value }))} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-slate-700 dark:bg-slate-800" /></label>
            <label className="text-sm text-slate-600 dark:text-slate-300">Fecha y hora<input type="datetime-local" value={call.happened_at} onChange={(event) => setCall((current) => ({ ...current, happened_at: event.target.value }))} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-slate-700 dark:bg-slate-800" required /></label>
            <label className="text-sm text-slate-600 dark:text-slate-300">Resultado<select value={call.outcome} onChange={(event) => setCall((current) => ({ ...current, outcome: event.target.value }))} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-slate-700 dark:bg-slate-800">{OUTCOMES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="text-sm text-slate-600 dark:text-slate-300">Duración (minutos)<input type="number" min="0" value={call.duration_min} onChange={(event) => setCall((current) => ({ ...current, duration_min: event.target.value }))} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-slate-700 dark:bg-slate-800" /></label>
            <label className="text-sm text-slate-600 dark:text-slate-300 md:col-span-2">Contexto de la llamada<textarea value={call.notes} onChange={(event) => setCall((current) => ({ ...current, notes: event.target.value }))} rows={4} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-slate-700 dark:bg-slate-800" placeholder={call.outcome === 'no_contesta' ? 'Opcional cuando no contesta' : 'Qué se habló con el cliente'} /></label>
            {NEED_TASK.has(call.outcome) ? <><label className="text-sm text-slate-600 dark:text-slate-300">Próxima tarea<input value={call.task_title} onChange={(event) => setCall((current) => ({ ...current, task_title: event.target.value }))} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-slate-700 dark:bg-slate-800" /></label><label className="text-sm text-slate-600 dark:text-slate-300">Vencimiento<input type="datetime-local" value={call.task_due} onChange={(event) => setCall((current) => ({ ...current, task_due: event.target.value }))} className="mt-1 w-full rounded-md border px-3 py-2 dark:border-slate-700 dark:bg-slate-800" /></label></> : null}
            <div className="flex justify-end border-t border-slate-100 pt-4 md:col-span-2 dark:border-slate-800"><button disabled={saving} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Guardando...' : 'Registrar llamada'}</button></div>
          </form>
        ) : null}

        {tab === 'files' ? (
          <div className="space-y-4 p-5">
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => uploadFiles(event.target.files)} />
            <div className="flex items-center justify-between gap-3"><div><Title count={files.length}>Archivos de la {subjectLabel}</Title><p className="mt-1 text-xs text-slate-500">Documentos, imágenes y referencias importantes.</p></div><button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{uploading ? 'Subiendo...' : 'Cargar archivos'}</button></div>
            {files.length ? <div className="divide-y divide-slate-100 border-y border-slate-100 dark:divide-slate-800 dark:border-slate-800">{files.map((file) => <a key={file.id} href={resolveUploadUrl(file.url)} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 px-2 py-3 hover:bg-slate-50 dark:hover:bg-slate-800"><span className="min-w-0"><span className="block truncate text-sm font-medium">{file.original_name || file.filename}</span><span className="block text-xs text-slate-500">{file.mime_type || 'Archivo'} · {formatDateTime(file.created_at)}</span></span><span className="text-sm text-blue-600">Abrir</span></a>)}</div> : <Empty>No hay archivos cargados para esta {subjectLabel}.</Empty>}
          </div>
        ) : null}
      </section>
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <Title count={focus.length}>Enfoque</Title>
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300"><input type="checkbox" checked={expandFocus} onChange={(event) => setExpandFocus(event.target.checked)} />Expandir todos</label>
        </div>
        {activitiesLoading ? <div className="text-sm text-slate-500">Cargando actividades...</div> : null}
        {!activitiesLoading && focus.length ? (
          <div className="space-y-2">
            {(expandFocus ? focus : focus.slice(0, 3)).map((item) => {
              const overdue = item.due_date && new Date(String(item.due_date).replace(' ', 'T')) < new Date();
              return (
                <article key={item.id} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                  <button type="button" onClick={() => completeActivity(item)} className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-300 text-xs hover:border-emerald-600 hover:text-emerald-600" title="Marcar como completada">✓</button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><div className="font-semibold text-slate-900 dark:text-slate-100">{item.subject || 'Actividad'}</div><span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${priorityClass(item.priority)}`}>{priorityLabel(item.priority)}</span>{overdue ? <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold text-white">Vencida</span> : null}</div>
                    <div className="mt-1 text-xs text-slate-500">{formatDateTime(item.due_date)} · {item.assigned_to_name || item.created_by_name || 'Sin asignar'}{item.person_name ? ` · ${item.person_name}` : ''}</div>
                    {expandFocus && item.notes ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{item.notes}</p> : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
        {!activitiesLoading && !focus.length ? <Empty>No hay actividades pendientes para esta {subjectLabel}.</Empty> : null}
      </section>

      <section>
        <Title count={history.length}>Historial</Title>
        <div className="mt-3 flex gap-1 overflow-x-auto border-b border-slate-200 pb-2 dark:border-slate-700">
          {FILTERS.map(([key, label]) => {
            const count = key === 'all' ? history.length : history.filter((item) => item.kind === key).length;
            return <button key={key} type="button" onClick={() => setFilter(key)} className={`min-w-max rounded-md px-3 py-1.5 text-xs font-medium ${filter === key ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>{label} ({count})</button>;
          })}
        </div>
        {visibleHistory.length ? (
          <div className="relative mt-4 space-y-0 before:absolute before:bottom-3 before:left-[15px] before:top-3 before:w-px before:bg-slate-200 dark:before:bg-slate-700">
            {visibleHistory.map((item) => (
              <article key={item.id} className="relative flex gap-4 pb-5">
                <div className="relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-[10px] font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-900">{item.kind === 'activity' ? 'A' : item.kind === 'note' ? 'N' : item.kind === 'call' ? '☎' : item.kind === 'file' ? 'AD' : 'OP'}</div>
                <div className={`min-w-0 flex-1 ${item.kind === 'note' ? 'rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30' : 'pt-1'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    {item.href ? (item.external ? <a href={item.href} target="_blank" rel="noreferrer" className="text-sm font-semibold text-blue-700 hover:underline dark:text-blue-300">{item.title}</a> : <Link to={item.href} className="text-sm font-semibold text-blue-700 hover:underline dark:text-blue-300">{item.title}</Link>) : <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.title}</div>}
                    <time className="text-xs text-slate-400">{formatDateTime(item.date)}</time>
                  </div>
                  {item.meta ? <div className="mt-0.5 text-xs text-slate-500">{item.meta}</div> : null}
                  {item.description ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{item.description}</p> : null}
                </div>
              </article>
            ))}
          </div>
        ) : <Empty>No hay elementos en esta categoría.</Empty>}
      </section>
    </div>
  );
}
