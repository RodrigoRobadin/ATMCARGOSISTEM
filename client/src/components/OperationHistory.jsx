import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const FILTERS = [
  ['all', 'Todo'], ['activity', 'Actividades'], ['note', 'Notas'],
  ['call', 'Llamadas'], ['file', 'Archivos'], ['document', 'Documentos'], ['change', 'Cambios'],
];

const dateLabel = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es-PY', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

function buildHistory({ deal, followupItems, files, fileLabels, invoices, calls, changes }) {
  const activityRows = followupItems.map((item) => ({
    id: `followup-${item.id}`,
    kind: item.entry_type === 'note' || item.type === 'note' ? 'note' : 'activity',
    title: item.title || (item.entry_type === 'note' ? 'Nota' : 'Actividad'),
    description: item.content || '',
    date: item.created_at,
    meta: [item.created_by_name, item.done ? 'Completada' : null, item.due_at ? `Vence ${dateLabel(item.due_at)}` : null].filter(Boolean).join(' · '),
  }));
  const callRows = calls.map((item) => ({
    id: `call-${item.id}`, kind: 'call', title: item.subject || 'Llamada',
    description: item.notes || '', date: item.happened_at || item.created_at,
    meta: [item.user_name, item.contact_name, item.outcome].filter(Boolean).join(' · '),
  }));
  const fileRows = files.map((item) => ({
    id: `file-${item.id}`, kind: 'file',
    title: fileLabels[item.id] || item.display_name || item.custom_name || item.filename || 'Archivo',
    date: item.created_at, meta: 'Archivo cargado', selection: `f-${item.id}`,
  }));
  const documentRows = invoices.map((item) => ({
    id: `document-${item.kind}-${item.id}`, kind: 'document',
    title: `${item.kind === 'credit_note' ? 'Nota de crédito' : 'Factura'} ${item.number || item.id}`,
    date: item.created_at || item.issue_date, meta: item.status || '',
    selection: `doc-${item.kind}-${item.id}`,
  }));
  const changeRows = changes.filter((item) => ['deal', 'prospect'].includes(item.entity)).map((item) => ({
    id: `change-${item.id}`, kind: 'change',
    title: item.description || (item.action === 'create' ? 'Operación creada' : 'Operación modificada'),
    date: item.created_at, meta: item.actor_name || 'Sistema',
    description: Object.keys(item.meta?.changes || {}).slice(0, 4).join(', '),
  }));
  if (deal?.created_at && !changes.some((item) =>
    ['deal', 'prospect'].includes(item.entity) && item.action === 'create'
  )) {
    changeRows.push({ id: 'operation-created', kind: 'change', title: 'Operación creada', date: deal.created_at, meta: '' });
  }
  return [...activityRows, ...callRows, ...fileRows, ...documentRows, ...changeRows]
    .filter((item) => item.date && !Number.isNaN(new Date(item.date).getTime()))
    .sort((a, b) => new Date(b.date) - new Date(a.date) || a.id.localeCompare(b.id));
}

export default function OperationHistory({ deal, followupItems = [], files = [], fileLabels = {}, invoices = [], onSelectDocument }) {
  const [calls, setCalls] = useState([]);
  const [changes, setChanges] = useState([]);
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(15);
  const [refresh, setRefresh] = useState(0);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!deal?.id) return;
    let active = true;
    Promise.allSettled([
      api.get(`/operations/${deal.id}/history-calls`),
      api.get(`/audit/record/deal/${deal.id}`),
    ]).then(([callsResult, changesResult]) => {
      if (!active) return;
      if (callsResult.status === 'fulfilled') setCalls(Array.isArray(callsResult.value.data) ? callsResult.value.data : []);
      if (changesResult.status === 'fulfilled') setChanges(Array.isArray(changesResult.value.data) ? changesResult.value.data : []);
      setUnavailable(callsResult.status !== 'fulfilled' || changesResult.status !== 'fulfilled');
    });
    return () => { active = false; };
  }, [deal?.id, refresh, followupItems, files, invoices]);

  const history = useMemo(() => buildHistory({ deal, followupItems, files, fileLabels, invoices, calls, changes }),
    [deal, followupItems, files, fileLabels, invoices, calls, changes]);
  const filtered = filter === 'all' ? history : history.filter((item) => item.kind === filter);

  return (
    <section className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-900">Historial de la operación <span className="text-sm font-normal text-slate-500">({history.length})</span></h3>
        <button type="button" onClick={() => setRefresh((value) => value + 1)} className="text-xs font-medium text-blue-700 hover:underline">Actualizar</button>
      </div>
      <div className="mt-3 flex gap-1 overflow-x-auto border-b border-slate-200 pb-2">
        {FILTERS.map(([key, label]) => (
          <button key={key} type="button" onClick={() => { setFilter(key); setLimit(15); }}
            className={`min-w-max rounded-md px-3 py-1.5 text-xs font-medium ${filter === key ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}>
            {label} ({key === 'all' ? history.length : history.filter((item) => item.kind === key).length})
          </button>
        ))}
      </div>
      {unavailable && <p className="mt-3 text-xs text-amber-700">Algunas fuentes del historial no están disponibles. Podés intentar actualizar.</p>}
      {filtered.length ? (
        <div className="relative mt-4 before:absolute before:bottom-4 before:left-[15px] before:top-4 before:w-px before:bg-slate-200">
          {filtered.slice(0, limit).map((item) => (
            <article key={item.id} className="relative flex gap-3 pb-4">
              <div className="relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-[10px] font-bold text-slate-600" aria-hidden="true">
                {{ activity: 'A', note: 'N', call: 'L', file: 'AR', document: 'DO', change: 'OP' }[item.kind]}
              </div>
              <div className="min-w-0 flex-1 border-b border-slate-100 pb-3">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  {item.selection ? (
                    <button type="button" onClick={() => onSelectDocument(item.selection)} className="min-w-0 break-words text-left text-sm font-semibold text-blue-700 hover:underline">{item.title}</button>
                  ) : <span className="min-w-0 break-words text-sm font-semibold text-slate-900">{item.title}</span>}
                  <time className="shrink-0 text-xs text-slate-500" dateTime={item.date}>{dateLabel(item.date)}</time>
                </div>
                {item.meta && <p className="mt-0.5 text-xs text-slate-500">{item.meta}</p>}
                {item.description && <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-sm text-slate-700" title={item.description}>{item.description}</p>}
              </div>
            </article>
          ))}
        </div>
      ) : <p className="py-5 text-sm text-slate-500">No hay registros en esta categoría.</p>}
      {filtered.length > limit && <button type="button" onClick={() => setLimit((value) => value + 15)} className="mt-1 text-sm font-medium text-blue-700 hover:underline">Ver más</button>}
    </section>
  );
}
