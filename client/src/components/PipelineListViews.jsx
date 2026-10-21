import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { expectedCloseMonth, groupForecastOperations } from '../utils/pipelineForecast.js';

const views = [
  { key: 'funnel', label: 'Embudo' },
  { key: 'table', label: 'Tabla' },
  { key: 'forecast', label: 'Pronóstico' },
];

function dateLabel(value) {
  return expectedCloseMonth(value)
    ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('es-PY')
    : '—';
}

function monthLabel(value) {
  const [year, month] = value.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('es-PY', { month: 'long', year: 'numeric' });
}

function profitDetails(deal, quoteTotals) {
  const quote = quoteTotals[deal.id];
  const amount = Number(quote?.profit_total_display);
  if (quote?.profit_total_display == null || !Number.isFinite(amount)) return null;
  const currency = ['PYG', 'GS'].includes(String(quote.profit_total_currency || '').toUpperCase()) ? 'Gs' : 'USD';
  return { amount, currency };
}

function profitLabel(profit) {
  if (!profit) return '—';
  const decimals = profit.currency === 'Gs' ? 0 : 2;
  return `${profit.currency} ${profit.amount.toLocaleString('es-PY', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

function dealLink(deal, stages) {
  const stage = stages.find((item) => Number(item.id) === Number(deal.stage_id));
  const prospect = deal.record_type === 'prospect' || String(stage?.name || '').toLowerCase() === 'prospecto';
  return prospect && deal.org_id ? `/organizations/${deal.org_id}` : `/operations/${deal.id}`;
}

function ExpectedCloseCell({ deal, isProspect, onSaved }) {
  const saved = String(deal.expected_close_date || '').slice(0, 10);
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(saved);
    setError('');
  }, [deal.id, saved]);

  async function save() {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.patch(`/deals/${deal.id}/expected-close-date`, {
        expected_close_date: draft || null,
      });
      onSaved(deal.id, data.expected_close_date);
    } catch (requestError) {
      setError(requestError?.response?.data?.error || 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  if (isProspect) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex min-w-44 flex-wrap items-center gap-1">
      <input type="date" aria-label={`Fecha estimada de cierre de ${deal.reference || deal.title}`} value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="w-36 rounded border border-slate-300 bg-white px-2 py-1 text-xs" />
      {draft !== saved && (
        <button type="button" onClick={save} disabled={busy}
          className="rounded border border-emerald-300 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">
          {busy ? 'Guardando...' : 'Guardar'}
        </button>
      )}
      {error && <span role="alert" className="w-full text-xs text-red-700">{error}</span>}
    </div>
  );
}

export function PipelineViewSwitch({ value, onChange }) {
  return (
    <div role="group" aria-label="Vista del pipeline" className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
      {views.map((view) => (
        <button key={view.key} type="button" onClick={() => onChange(view.key)}
          aria-pressed={value === view.key}
          className={`rounded px-3 py-1.5 text-sm ${value === view.key ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}>
          {view.label}
        </button>
      ))}
    </div>
  );
}

export default function PipelineListViews({ view, deals, stages, stageLabel, quoteTotals, onExpectedCloseSaved }) {
  const [month, setMonth] = useState('');
  const [withoutDate, setWithoutDate] = useState(false);

  const filtered = useMemo(() => deals.filter((deal) =>
    !(withoutDate && view === 'table' && expectedCloseMonth(deal.expected_close_date))
  ), [deals, withoutDate, view]);
  const forecastGroups = useMemo(() => groupForecastOperations(filtered, stages), [filtered, stages]);
  const months = forecastGroups.map((group) => group.month);
  const visibleGroups = month ? forecastGroups.filter((group) => group.month === month) : forecastGroups;
  const stageName = (deal) => {
    const stage = stages.find((item) => Number(item.id) === Number(deal.stage_id));
    return stage ? stageLabel(stage) : '—';
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {view === 'table' && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={withoutDate} onChange={(event) => setWithoutDate(event.target.checked)} />
            Sin fecha estimada
          </label>
        )}
        {view === 'forecast' && (
          <select aria-label="Filtrar por mes de cierre" value={month} onChange={(event) => setMonth(event.target.value)}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="">Todos los meses</option>
            {months.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}
          </select>
        )}
        <span className="text-xs text-slate-500">{view === 'forecast' ? visibleGroups.reduce((sum, group) => sum + group.operations.length, 0) : filtered.length} operaciones</span>
      </div>

      {view === 'table' && (
        <div className="overflow-x-auto border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-xs text-slate-600">
              <tr>{['Operación', 'Cliente', 'Etapa', 'Ejecutivo', 'Cierre estimado', 'Profit'].map((label) =>
                <th key={label} scope="col" className="px-3 py-2 font-semibold">{label}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map((deal) => (
                <tr key={deal.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="min-w-48 px-3 py-2">
                    <a href={dealLink(deal, stages)} target="_blank" rel="noreferrer" className="font-medium text-blue-700 hover:underline">
                      {deal.reference || deal.title || `Operación ${deal.id}`}
                    </a>
                    {deal.reference && deal.title && <div className="max-w-64 truncate text-xs text-slate-500" title={deal.title}>{deal.title}</div>}
                  </td>
                  <td className="px-3 py-2">{deal.org_name || '—'}</td>
                  <td className="px-3 py-2">{stageName(deal)}</td>
                  <td className="px-3 py-2">{deal.deal_advisor_name || '—'}</td>
                  <td className="px-3 py-2"><ExpectedCloseCell deal={deal} isProspect={deal.record_type === 'prospect' || stageName(deal).trim().toLowerCase() === 'prospecto'} onSaved={onExpectedCloseSaved} /></td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-emerald-800">{profitLabel(profitDetails(deal, quoteTotals))}</td>
                </tr>
              ))}
              {!filtered.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No hay operaciones con estos filtros.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {view === 'forecast' && (
        <div className="space-y-5">
          {!visibleGroups.length && <p className="border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">No hay operaciones con fecha estimada de cierre para estos filtros.</p>}
          {visibleGroups.map((group) => {
            const totals = {};
            let missingProfit = 0;
            for (const deal of group.operations) {
              const profit = profitDetails(deal, quoteTotals);
              if (profit) totals[profit.currency] = (totals[profit.currency] || 0) + profit.amount;
              else missingProfit += 1;
            }
            return (
              <section key={group.month} className="border-t border-slate-300 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
                  <h3 className="text-sm font-semibold capitalize">{monthLabel(group.month)} <span className="ml-2 text-xs font-normal text-slate-500">{group.operations.length} operaciones</span></h3>
                  <div className="flex flex-wrap gap-3 text-xs font-medium text-emerald-800">
                    {Object.entries(totals).map(([currency, amount]) => <span key={currency}>{profitLabel({ currency, amount })}</span>)}
                    {missingProfit > 0 && <span className="text-amber-800">{missingProfit} sin profit</span>}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-100 text-xs text-slate-600"><tr>
                      {['Cierre estimado', 'Operación', 'Cliente', 'Etapa', 'Ejecutivo', 'Profit'].map((label) =>
                        <th key={label} scope="col" className="px-3 py-2 font-semibold">{label}</th>)}
                    </tr></thead>
                    <tbody>{group.operations.map((deal) => (
                      <tr key={deal.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="whitespace-nowrap px-3 py-2">{dateLabel(deal.expected_close_date)}</td>
                        <td className="min-w-44 px-3 py-2"><a href={dealLink(deal, stages)} target="_blank" rel="noreferrer" className="font-medium text-blue-700 hover:underline">{deal.reference || deal.title}</a></td>
                        <td className="px-3 py-2">{deal.org_name || '—'}</td>
                        <td className="px-3 py-2">{stageName(deal)}</td>
                        <td className="px-3 py-2">{deal.deal_advisor_name || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-medium text-emerald-800">{profitLabel(profitDetails(deal, quoteTotals))}</td>
                      </tr>))}</tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
