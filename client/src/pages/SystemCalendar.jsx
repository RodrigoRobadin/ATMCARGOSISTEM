import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const TYPE_GROUPS = [
  {
    label: 'Seguimiento',
    items: [
      ['followup_task', 'Tareas y recordatorios'],
      ['commercial_visit', 'Visitas comerciales'],
      ['route_visit', 'Recorridos'],
    ],
  },
  {
    label: 'Logística industrial',
    items: [
      ['manufacturing_start', 'Inicio de fabricación'],
      ['factory_departure', 'Salida de fábrica'],
      ['paraguay_arrival', 'Llegada a Paraguay'],
      ['installation', 'Instalación'],
    ],
  },
  {
    label: 'Servicio',
    items: [['service_visit', 'Servicios técnicos']],
  },
];

const ALL_TYPES = TYPE_GROUPS.flatMap((group) => group.items.map(([value]) => value));

const TYPE_META = {
  followup_task: { label: 'Tarea', dot: 'bg-amber-500', chip: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100' },
  commercial_visit: { label: 'Visita comercial', dot: 'bg-sky-500', chip: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-100' },
  route_visit: { label: 'Recorrido', dot: 'bg-emerald-600', chip: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100' },
  manufacturing_start: { label: 'Inicio de fabricación', dot: 'bg-cyan-600', chip: 'border-cyan-200 bg-cyan-50 text-cyan-900 dark:border-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-100' },
  factory_departure: { label: 'Salida de fábrica', dot: 'bg-indigo-500', chip: 'border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-100' },
  paraguay_arrival: { label: 'Llegada a Paraguay', dot: 'bg-violet-500', chip: 'border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-100' },
  installation: { label: 'Instalación', dot: 'bg-teal-600', chip: 'border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-100' },
  service_visit: { label: 'Servicio técnico', dot: 'bg-rose-500', chip: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-100' },
};

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function pad(value) {
  return String(value).padStart(2, '0');
}

function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function buildGrid(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  first.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first);
    date.setDate(first.getDate() + index);
    return date;
  });
}

function formatDate(value, includeTime = false) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleString('es-PY', includeTime
    ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function eventTime(event) {
  if (event.all_day) return '';
  const value = String(event.starts_at || '');
  return value.length >= 16 ? value.slice(11, 16) : '';
}

function statusLabel(status) {
  const labels = {
    pending: 'Pendiente', done: 'Completada', canceled: 'Cancelada', cancelled: 'Cancelada',
    scheduled: 'Programada', confirmed: 'Confirmada', completed: 'Completada', rescheduled: 'Reprogramada',
    programada: 'Programada', cerrada: 'Cerrada', validated: 'Validada', planned: 'Prevista', overdue: 'Atrasada',
  };
  return labels[String(status || '').toLowerCase()] || status || 'Sin estado';
}

export default function SystemCalendar({ embedded = false }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [events, setEvents] = useState([]);
  const [selectedTypes, setSelectedTypes] = useState(() => new Set(ALL_TYPES));
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState([]);

  const days = useMemo(() => buildGrid(month), [month]);
  const rangeFrom = dateKey(days[0]);
  const rangeTo = dateKey(days[days.length - 1]);

  const load = useCallback(async () => {
    if (!selectedTypes.size) {
      setEvents([]);
      setWarnings([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/system-calendar/events', {
        params: { from: rangeFrom, to: rangeTo, types: [...selectedTypes].join(',') },
      });
      setEvents(Array.isArray(data?.events) ? data.events : []);
      setWarnings(Array.isArray(data?.warnings) ? data.warnings : []);
    } catch (requestError) {
      setError(requestError?.response?.data?.error || 'No se pudo cargar el calendario general.');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [rangeFrom, rangeTo, selectedTypes]);

  useEffect(() => { load(); }, [load]);

  const filteredEvents = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('es');
    if (!needle) return events;
    return events.filter((event) => [event.title, event.organization, event.reference, event.responsible, event.location]
      .some((value) => String(value || '').toLocaleLowerCase('es').includes(needle)));
  }, [events, search]);

  const eventsByDay = useMemo(() => {
    const map = new Map();
    filteredEvents.forEach((event) => {
      const key = dateKey(event.starts_at);
      if (!key) return;
      map.set(key, [...(map.get(key) || []), event]);
    });
    return map;
  }, [filteredEvents]);

  function toggleType(type) {
    setSelectedTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function moveMonth(delta) {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  function goToday() {
    const today = new Date();
    setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
  }

  const todayKey = dateKey(new Date());

  return (
    <div className={embedded ? 'space-y-3' : 'mx-auto w-full max-w-[1700px] space-y-3 p-4 md:p-6'}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase text-slate-500 dark:text-slate-400">Agenda compartida</div>
          <h1 className={`${embedded ? 'text-xl' : 'text-2xl'} font-semibold text-slate-950 dark:text-white`}>Calendario general</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Logística, seguimiento, recorridos y servicios técnicos. No incluye cobros.</p>
        </div>
        <div className="flex items-center gap-2">
          {embedded && <a href="/calendar" target="_blank" rel="noreferrer" className="rounded border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800">Abrir en otra pestaña</a>}
          <button type="button" onClick={() => setFiltersOpen((open) => !open)} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800">Filtros</button>
        </div>
      </header>

      {filtersOpen && (
        <section className="border-y border-slate-200 bg-white py-3 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            {TYPE_GROUPS.map((group) => (
              <fieldset key={group.label}>
                <legend className="mb-1 text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">{group.label}</legend>
                <div className="flex flex-wrap gap-2">
                  {group.items.map(([value, label]) => (
                    <label key={value} className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-xs text-slate-700 dark:text-slate-200">
                      <input type="checkbox" checked={selectedTypes.has(value)} onChange={() => toggleType(value)} className="h-4 w-4 accent-slate-900" />
                      <span className={`h-2 w-2 rounded-full ${TYPE_META[value].dot}`} />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <label className="ml-auto min-w-56 text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
              Buscar
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Empresa, referencia o responsable" className="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-normal normal-case text-slate-900 outline-none focus:border-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            </label>
          </div>
        </section>
      )}

      <section className="overflow-hidden border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => moveMonth(-1)} title="Mes anterior" className="h-8 w-8 rounded border border-slate-300 text-lg hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">‹</button>
            <button type="button" onClick={() => moveMonth(1)} title="Mes siguiente" className="h-8 w-8 rounded border border-slate-300 text-lg hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">›</button>
            <h2 className="ml-1 text-base font-semibold">{MONTHS[month.getMonth()]} {month.getFullYear()}</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-slate-500 sm:inline">{filteredEvents.length} eventos</span>
            <button type="button" onClick={goToday} className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">Hoy</button>
          </div>
        </div>

        {error && <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error} <button type="button" className="ml-2 underline" onClick={load}>Reintentar</button></div>}
        {!!warnings.length && <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Algunas fuentes no estan disponibles: {warnings.join(', ')}.</div>}

        <div className="overflow-x-auto">
          <div className="min-w-[880px]">
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
              {WEEKDAYS.map((day) => <div key={day} className="border-r border-slate-200 py-1.5 text-center text-[11px] font-semibold uppercase text-slate-500 last:border-r-0 dark:border-slate-700">{day}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {days.map((day) => {
                const key = dateKey(day);
                const dayEvents = eventsByDay.get(key) || [];
                const inMonth = day.getMonth() === month.getMonth();
                const isToday = key === todayKey;
                return (
                  <div key={key} className={`h-[88px] overflow-hidden border-b border-r border-slate-200 p-1 last:border-r-0 dark:border-slate-700 ${inMonth ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/70 dark:bg-slate-950/60'}`}>
                    <div className={`mb-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium ${isToday ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : inMonth ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-600'}`}>{day.getDate()}</div>
                    <div className="space-y-0.5">
                      {dayEvents.slice(0, 3).map((event) => {
                        const meta = TYPE_META[event.type] || TYPE_META.followup_task;
                        return (
                          <button key={event.id} type="button" onClick={() => setSelectedEvent(event)} title={`${event.title}${event.organization ? ` - ${event.organization}` : ''}`} className={`flex h-[17px] w-full items-center gap-1 overflow-hidden rounded-sm border px-1 text-left text-[10px] leading-none hover:brightness-95 ${meta.chip}`}>
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
                            {eventTime(event) && <b className="shrink-0 font-semibold">{eventTime(event)}</b>}
                            <span className="truncate">{event.title}{event.organization ? ` - ${event.organization}` : ''}</span>
                          </button>
                        );
                      })}
                      {dayEvents.length > 3 && <button type="button" onClick={() => setSelectedDay({ date: day, events: dayEvents })} className="block w-full px-1 text-left text-[10px] text-slate-500 hover:underline">+{dayEvents.length - 3} más</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {loading && <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700">Actualizando calendario...</div>}
      </section>

      {selectedDay && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/35" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedDay(null); }}>
          <aside className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-2xl dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4">
              <div><div className="text-xs font-semibold uppercase text-slate-500">Agenda del día</div><h2 className="mt-1 text-xl font-semibold">{selectedDay.date.toLocaleDateString('es-PY', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</h2></div>
              <button type="button" onClick={() => setSelectedDay(null)} title="Cerrar" className="h-8 w-8 rounded border border-slate-300 text-lg dark:border-slate-700">×</button>
            </div>
            <div className="mt-5 divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-700 dark:border-slate-700">
              {selectedDay.events.map((event) => {
                const meta = TYPE_META[event.type] || TYPE_META.followup_task;
                return <button key={event.id} type="button" onClick={() => { setSelectedDay(null); setSelectedEvent(event); }} className="flex w-full items-start gap-3 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800"><span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} /><span className="min-w-0"><span className="block text-xs text-slate-500">{eventTime(event) || 'Todo el día'} · {meta.label}</span><span className="block truncate text-sm font-medium">{event.title}</span>{event.organization && <span className="block truncate text-xs text-slate-500">{event.organization}</span>}</span></button>;
              })}
            </div>
          </aside>
        </div>
      )}

      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/35" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedEvent(null); }}>
          <aside className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-2xl dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500"><span className={`h-2.5 w-2.5 rounded-full ${(TYPE_META[selectedEvent.type] || TYPE_META.followup_task).dot}`} />{(TYPE_META[selectedEvent.type] || TYPE_META.followup_task).label}</div>
                <h2 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">{selectedEvent.title}</h2>
              </div>
              <button type="button" onClick={() => setSelectedEvent(null)} title="Cerrar" className="h-8 w-8 rounded border border-slate-300 text-lg dark:border-slate-700">×</button>
            </div>

            <dl className="mt-6 divide-y divide-slate-200 border-y border-slate-200 text-sm dark:divide-slate-700 dark:border-slate-700">
              <div className="grid grid-cols-[120px_1fr] gap-3 py-3"><dt className="text-slate-500">Fecha prevista</dt><dd>{formatDate(selectedEvent.starts_at, !selectedEvent.all_day)}</dd></div>
              {selectedEvent.actual_date && <div className="grid grid-cols-[120px_1fr] gap-3 py-3"><dt className="text-slate-500">Fecha real</dt><dd><span>{formatDate(selectedEvent.actual_date)}</span>{selectedEvent.delayed && <span className="ml-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-200">{selectedEvent.delay_days} días de atraso</span>}</dd></div>}
              <div className="grid grid-cols-[120px_1fr] gap-3 py-3"><dt className="text-slate-500">Estado</dt><dd>{statusLabel(selectedEvent.status)}</dd></div>
              {selectedEvent.organization && <div className="grid grid-cols-[120px_1fr] gap-3 py-3"><dt className="text-slate-500">Organización</dt><dd>{selectedEvent.organization}</dd></div>}
              {selectedEvent.reference && <div className="grid grid-cols-[120px_1fr] gap-3 py-3"><dt className="text-slate-500">Referencia</dt><dd>{selectedEvent.reference}</dd></div>}
              {selectedEvent.responsible && <div className="grid grid-cols-[120px_1fr] gap-3 py-3"><dt className="text-slate-500">Responsable</dt><dd>{selectedEvent.responsible}</dd></div>}
              {selectedEvent.location && <div className="grid grid-cols-[120px_1fr] gap-3 py-3"><dt className="text-slate-500">Ubicación</dt><dd>{selectedEvent.location}</dd></div>}
              {selectedEvent.detail && <div className="grid grid-cols-[120px_1fr] gap-3 py-3"><dt className="text-slate-500">Detalle</dt><dd>{selectedEvent.detail}</dd></div>}
              {selectedEvent.notes && <div className="grid grid-cols-[120px_1fr] gap-3 py-3"><dt className="text-slate-500">Observación</dt><dd className="whitespace-pre-wrap">{selectedEvent.notes}</dd></div>}
            </dl>

            {selectedEvent.source_url && (
              <div className="mt-5 flex gap-2">
                <a href={selectedEvent.source_url} className="rounded bg-slate-950 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-slate-950">Abrir registro</a>
                <a href={selectedEvent.source_url} target="_blank" rel="noreferrer" className="rounded border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">Nueva pestaña</a>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
