import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

function dayInParaguay() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function shiftDay(day, offset) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function dayLabel(day) {
  return new Intl.DateTimeFormat('es-PY', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(`${day}T00:00:00Z`));
}

const KIND_LABELS = {
  activity: 'Actividad', call: 'Llamada', note: 'Nota', task: 'Tarea',
  quote: 'Cotización', change: 'Cambio', file: 'Archivo',
  organization: 'Organización', contact: 'Contacto',
};

const KIND_GROUPS = {
  activity: 'followup', call: 'followup', note: 'followup', task: 'followup',
  quote: 'quote',
};

const GROUP_COLORS = {
  followup: 'bg-teal-600', quote: 'bg-blue-600', other: 'bg-amber-500',
};

const CALL_OUTCOME_LABELS = {
  no_contesta: 'No contesta', interesado: 'Interesado', no_interesado: 'No interesado',
  volver_a_llamar: 'Volver a llamar', en_negociacion: 'En negociación',
};

function SessionCharts({ events, from, to, onShowCalls }) {
  const { daily, hourly, kinds, callOutcomes, completedCalls, pendingCalls, maxDaily, maxHourly } = useMemo(() => {
    const byDay = new Map();
    const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
    const byKind = new Map();
    const byCallOutcome = new Map();
    let completedCallCount = 0;
    let pendingCallCount = 0;
    for (let day = from; day <= to; day = shiftDay(day, 1)) {
      byDay.set(day, { day, count: 0, followup: 0, quote: 0, other: 0 });
    }
    for (const item of events) {
      const stamp = String(item.occurred_at || '');
      const date = byDay.get(stamp.slice(0, 10));
      if (date) {
        date.count += 1;
        date[KIND_GROUPS[item.kind] || 'other'] += 1;
      }
      const hour = Number(stamp.slice(11, 13));
      if (Number.isInteger(hour) && hour >= 0 && hour < 24) byHour[hour].count += 1;
      byKind.set(item.kind, (byKind.get(item.kind) || 0) + 1);
      if (item.kind === 'call') {
        if (item.call_status === 'completed') {
          completedCallCount += 1;
          const outcome = item.call_outcome || 'sin_resultado';
          byCallOutcome.set(outcome, (byCallOutcome.get(outcome) || 0) + 1);
        } else pendingCallCount += 1;
      }
    }
    const dailyRows = [...byDay.values()];
    const kindRows = [...byKind].map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
    return {
      daily: dailyRows, hourly: byHour, kinds: kindRows,
      callOutcomes: [...byCallOutcome].map(([outcome, count]) => ({ outcome, count }))
        .sort((a, b) => b.count - a.count || a.outcome.localeCompare(b.outcome)),
      completedCalls: completedCallCount, pendingCalls: pendingCallCount,
      maxDaily: Math.max(1, ...dailyRows.map((row) => row.count)),
      maxHourly: Math.max(1, ...byHour.map((row) => row.count)),
    };
  }, [events, from, to]);

  if (!events.length) return <p className="px-4 py-10 text-center text-sm text-slate-500">No hay actividad registrada para este periodo y filtros.</p>;

  return <div className="divide-y divide-slate-200">
    <section className="px-4 py-5" aria-label="Llamadas y resultados">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-sm font-semibold text-slate-900">Llamadas y resultados</h3><p className="mt-1 text-xs text-slate-600">{completedCalls} registrada{completedCalls === 1 ? '' : 's'}{pendingCalls ? ` · ${pendingCalls} sin resultado` : ''}</p></div>
        <button type="button" onClick={onShowCalls} className="text-xs font-medium text-teal-800 hover:underline">Ver llamadas</button>
      </div>
      {callOutcomes.length ? <div className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">{callOutcomes.map(({ outcome, count }) => <div key={outcome} className="grid grid-cols-[120px_minmax(0,1fr)_35px] items-center gap-2 text-xs">
        <span className="truncate text-slate-600" title={CALL_OUTCOME_LABELS[outcome] || 'Sin resultado'}>{CALL_OUTCOME_LABELS[outcome] || 'Sin resultado'}</span>
        <div className="h-3 bg-slate-100"><div className="h-full bg-teal-600" style={{ width: `${count / completedCalls * 100}%` }} /></div>
        <span className="text-right font-medium tabular-nums text-slate-800">{count}</span>
      </div>)}</div> : <p className="mt-4 text-xs text-slate-500">No hay llamadas completadas en este periodo.</p>}
    </section>
    <section className="px-4 py-5" aria-label="Movimiento por día">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Movimiento por día</h3>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          <span><i className="mr-1 inline-block h-2.5 w-2.5 bg-teal-600" />Seguimiento</span>
          <span><i className="mr-1 inline-block h-2.5 w-2.5 bg-blue-600" />Cotizaciones</span>
          <span><i className="mr-1 inline-block h-2.5 w-2.5 bg-amber-500" />Otros registros</span>
        </div>
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="flex h-48 min-w-max items-end gap-2 border-b border-slate-200 pb-2">
          {daily.map((row) => <div key={row.day} className="flex w-11 shrink-0 flex-col items-center justify-end gap-1 text-center" title={`${dayLabel(row.day)}: ${row.count} registros`}>
            <span className="text-xs tabular-nums text-slate-700">{row.count || ''}</span>
            <div className="flex w-7 flex-col justify-end overflow-hidden bg-slate-100" style={{ height: 132 }} aria-label={`${dayLabel(row.day)}: ${row.count} registros`}>
              {['other', 'quote', 'followup'].map((group) => row[group] > 0 && <div key={group} className={GROUP_COLORS[group]} style={{ height: `${row[group] / maxDaily * 100}%` }} />)}
            </div>
            <span className="text-[11px] tabular-nums text-slate-500">{row.day.slice(8, 10)}/{row.day.slice(5, 7)}</span>
          </div>)}
        </div>
      </div>
    </section>
    <div className="grid md:grid-cols-2 md:divide-x md:divide-slate-200">
      <section className="px-4 py-5" aria-label="Registros por tipo">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">Registros por tipo</h3>
        <div className="space-y-3">{kinds.map(({ kind, count }) => <div key={kind} className="grid grid-cols-[110px_minmax(0,1fr)_35px] items-center gap-2 text-xs">
          <span className="truncate text-slate-600" title={KIND_LABELS[kind] || kind}>{KIND_LABELS[kind] || kind}</span>
          <div className="h-3 bg-slate-100"><div className={GROUP_COLORS[KIND_GROUPS[kind] || 'other']} style={{ width: `${count / events.length * 100}%`, height: '100%' }} /></div>
          <span className="text-right font-medium tabular-nums text-slate-800">{count}</span>
        </div>)}</div>
      </section>
      <section className="border-t border-slate-200 px-4 py-5 md:border-t-0" aria-label="Movimiento por hora">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">Movimiento por hora</h3>
        <div className="flex h-40 items-end gap-1 border-b border-slate-200">
          {hourly.map(({ hour, count }) => <div key={hour} className="flex min-w-0 flex-1 flex-col items-center justify-end" title={`${String(hour).padStart(2, '0')}:00: ${count} registros`}>
            <div className="w-full max-w-5 bg-teal-600" style={{ height: `${count ? Math.max(4, count / maxHourly * 124) : 0}px` }} aria-label={`${String(hour).padStart(2, '0')}:00: ${count} registros`} />
          </div>)}
        </div>
        <div className="mt-1 flex justify-between text-[11px] tabular-nums text-slate-500"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div>
      </section>
    </div>
  </div>;
}

export default function CommercialSessions({ businessUnit, userId, isAdmin }) {
  const today = useMemo(dayInParaguay, []);
  const yesterday = useMemo(() => shiftDay(today, -1), [today]);
  const [from, setFrom] = useState(yesterday);
  const [to, setTo] = useState(yesterday);
  const [timeFrom, setTimeFrom] = useState('00:00');
  const [timeTo, setTimeTo] = useState('23:59');
  const [kind, setKind] = useState('');
  const [view, setView] = useState('activity');
  const [events, setEvents] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const rangeError = useMemo(() => {
    if (!from || !to || from > to) return 'Selecciona un periodo de fechas valido.';
    const days = Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);
    if (days > 30) return 'El periodo puede abarcar hasta 31 dias.';
    if (timeFrom > timeTo) return 'La hora inicial debe ser anterior a la hora final.';
    return '';
  }, [from, to, timeFrom, timeTo]);

  useEffect(() => {
    if (rangeError) return;
    let active = true;
    setLoading(true);
    setError('');
    setEvents([]);
    setTruncated(false);
    api.get('/commercial-dashboard/sessions', { params: {
      from, to,
      ...(businessUnit ? { business_unit: businessUnit } : {}),
      ...(isAdmin && userId ? { user_id: userId } : {}),
    } }).then(({ data }) => {
      if (!active) return;
      setEvents(Array.isArray(data?.events) ? data.events : []);
      setTruncated(Boolean(data?.truncated));
    }).catch((requestError) => {
      if (active) setError(requestError?.response?.data?.error || 'No se pudo cargar la actividad del periodo.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [from, to, businessUnit, userId, isAdmin, rangeError]);

  const visible = useMemo(() => rangeError ? [] : events.filter((item) => {
    const time = String(item.occurred_at || '').slice(11, 16);
    return time >= timeFrom && time <= timeTo && (!kind || item.kind === kind);
  }), [events, timeFrom, timeTo, kind, rangeError]);
  const days = useMemo(() => {
    const groups = new Map();
    for (const item of visible) {
      const day = String(item.occurred_at || '').slice(0, 10);
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(item);
    }
    return [...groups];
  }, [visible]);
  const operationCount = new Set(visible.map((item) => item.deal_id).filter(Boolean)).size;
  const completedCallCount = visible.filter((item) => item.kind === 'call' && item.call_status === 'completed').length;

  function choosePreset(first, last) {
    setFrom(first);
    setTo(last);
  }

  return <section aria-label="Sesiones comerciales" className="overflow-hidden rounded border border-slate-200 bg-white">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
      <div><h2 className="text-sm font-semibold">Sesiones de trabajo</h2><p className="mt-0.5 text-xs text-slate-500">Actividad registrada en la cartera comercial</p></div>
      <div className="flex gap-1 rounded border border-slate-200 p-1 text-xs" role="group" aria-label="Periodo rapido">
        <button type="button" onClick={() => choosePreset(today, today)} aria-pressed={from === today && to === today} className={`rounded px-3 py-1.5 ${from === today && to === today ? 'bg-teal-700 text-white' : 'hover:bg-slate-50'}`}>Hoy</button>
        <button type="button" onClick={() => choosePreset(yesterday, yesterday)} aria-pressed={from === yesterday && to === yesterday} className={`rounded px-3 py-1.5 ${from === yesterday && to === yesterday ? 'bg-teal-700 text-white' : 'hover:bg-slate-50'}`}>Ayer</button>
        <button type="button" onClick={() => choosePreset(shiftDay(today, -6), today)} aria-pressed={from === shiftDay(today, -6) && to === today} className={`rounded px-3 py-1.5 ${from === shiftDay(today, -6) && to === today ? 'bg-teal-700 text-white' : 'hover:bg-slate-50'}`}>7 días</button>
      </div>
    </div>
    <div className="flex flex-wrap items-end gap-3 border-b bg-slate-50/60 px-4 py-3 text-xs">
      <label className="font-medium text-slate-700">Desde<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded border border-slate-300 bg-white px-2 py-1.5 text-sm" /></label>
      <label className="font-medium text-slate-700">Hasta<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded border border-slate-300 bg-white px-2 py-1.5 text-sm" /></label>
      <label className="font-medium text-slate-700">Hora inicial<input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} className="mt-1 block rounded border border-slate-300 bg-white px-2 py-1.5 text-sm" /></label>
      <label className="font-medium text-slate-700">Hora final<input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} className="mt-1 block rounded border border-slate-300 bg-white px-2 py-1.5 text-sm" /></label>
      <label className="font-medium text-slate-700">Tipo<select value={kind} onChange={(e) => setKind(e.target.value)} className="mt-1 block rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"><option value="">Todos</option>{Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    {rangeError && <p role="alert" className="border-b bg-amber-50 px-4 py-3 text-sm text-amber-900">{rangeError}</p>}
    {error && <p role="alert" className="border-b bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
    {truncated && <p role="status" className="border-b bg-amber-50 px-4 py-3 text-sm text-amber-900">Hay más registros en este periodo. Selecciona menos días para verlos todos.</p>}
    <div className="flex flex-wrap gap-6 border-b px-4 py-3 text-xs text-slate-600"><span><strong className="mr-1 text-base text-slate-900">{visible.length}</strong>registros</span><span><strong className="mr-1 text-base text-teal-800">{completedCallCount}</strong>llamadas</span><span><strong className="mr-1 text-base text-slate-900">{operationCount}</strong>operaciones</span><span><strong className="mr-1 text-base text-slate-900">{days.length}</strong>días con actividad</span>{loading && <span className="text-teal-700">Actualizando...</span>}</div>
    <div className="flex gap-1 border-b px-4 pt-2" role="tablist" aria-label="Vista de sesiones">
      <button type="button" role="tab" id="sessions-activity-tab" aria-controls="sessions-view" aria-selected={view === 'activity'} onClick={() => setView('activity')} className={`border-b-2 px-3 py-2 text-sm font-medium ${view === 'activity' ? 'border-teal-700 text-teal-800' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>Actividad</button>
      <button type="button" role="tab" id="sessions-charts-tab" aria-controls="sessions-view" aria-selected={view === 'charts'} onClick={() => setView('charts')} className={`border-b-2 px-3 py-2 text-sm font-medium ${view === 'charts' ? 'border-teal-700 text-teal-800' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>Gráficos</button>
    </div>
    <div id="sessions-view" role="tabpanel" aria-labelledby={view === 'charts' ? 'sessions-charts-tab' : 'sessions-activity-tab'}>
    {!rangeError && !error && !loading && view === 'charts' && <SessionCharts events={visible} from={from} to={to} onShowCalls={() => { setKind('call'); setView('activity'); }} />}
    {!rangeError && !error && !loading && view === 'activity' && !visible.length && <p className="px-4 py-10 text-center text-sm text-slate-500">No hay actividad registrada para este periodo y filtros.</p>}
    {!rangeError && !error && !loading && view === 'activity' && days.map(([day, items]) => <section key={day} className="border-b last:border-b-0" aria-label={dayLabel(day)}>
      <div className="flex items-center justify-between bg-slate-50 px-4 py-2"><h3 className="text-sm font-semibold capitalize">{dayLabel(day)}</h3><span className="text-xs text-slate-500">{items.length} registro{items.length === 1 ? '' : 's'}</span></div>
      <div className="divide-y divide-slate-100">{items.map((item) => <div key={item.id} className="grid gap-1 px-4 py-3 text-sm lg:grid-cols-[55px_100px_minmax(0,1fr)_170px] lg:items-start lg:gap-3">
        <time className="font-medium text-slate-600" dateTime={item.occurred_at}>{String(item.occurred_at || '').slice(11, 16)}</time>
        <span className={`w-fit rounded px-2 py-0.5 text-xs font-medium ${item.kind === 'call' ? 'bg-teal-50 text-teal-800' : 'bg-slate-100 text-slate-700'}`}>{KIND_LABELS[item.kind] || 'Registro'}</span>
        <div className="min-w-0"><p className="font-medium text-slate-900">{item.title}</p>{item.detail && <p className="mt-0.5 break-words text-xs text-slate-600">{item.detail}</p>}{item.actor_name && <p className="mt-1 text-xs text-slate-500">{item.actor_name}</p>}</div>
        <div className="min-w-0 text-xs lg:text-right"><span className="block truncate text-slate-500" title={item.org_name || ''}>{item.org_name || ''}</span>{item.deal_id ? <Link to={`/operations/${item.deal_id}`} className="font-medium text-blue-700 hover:underline">{item.reference || 'Abrir operación'}</Link> : item.contact_id ? <Link to={`/contacts/${item.contact_id}`} className="font-medium text-blue-700 hover:underline">Abrir contacto</Link> : item.organization_id ? <Link to={`/organizations/${item.organization_id}`} className="font-medium text-blue-700 hover:underline">Abrir organización</Link> : null}</div>
      </div>)}</div>
    </section>)}
    </div>
  </section>;
}
