import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api.js';

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const currentYear = Number(new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Asuncion', year: 'numeric',
}).format(new Date()));

function formatAmount(value, currency) {
  if (value == null || !['USD', 'PYG'].includes(currency)) return '-';
  return `${currency === 'PYG' ? 'Gs.' : 'USD'} ${new Intl.NumberFormat('es-PY', {
    minimumFractionDigits: currency === 'PYG' ? 0 : 2,
    maximumFractionDigits: currency === 'PYG' ? 0 : 2,
  }).format(Number(value))}`;
}

function sourceName(confirmation) {
  if (confirmation?.source === 'factura') return confirmation.document_number ? `Factura ${confirmation.document_number}` : 'Factura';
  return ({ purchase_order: 'Orden de compra', email: 'Correo', other: 'Otro comprobante' })[confirmation?.method] || 'Comprobante';
}

function displayDate(date) {
  return String(date || '').split('-').reverse().join('/');
}

function queryParams(filters) {
  return {
    year: filters.year,
    ...(filters.month ? { month: filters.month } : {}),
    ...(filters.business_unit ? { business_unit: filters.business_unit } : {}),
    ...(filters.advisor_id ? { advisor_id: filters.advisor_id } : {}),
    ...(filters.client ? { client: filters.client } : {}),
    ...(filters.pending ? { pending: 1 } : {}),
  };
}

export default function ConfirmedSalesReport() {
  const [draft, setDraft] = useState({ year: currentYear, month: '', business_unit: '', advisor_id: '', client: '', pending: false });
  const [filters, setFilters] = useState(draft);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState('');
  const [expandedMonth, setExpandedMonth] = useState('');

  useEffect(() => {
    let active = true;
    setExpandedMonth('');
    setLoading(true);
    setReport(null);
    setError('');
    api.get('/sales-report', { params: queryParams(filters) })
      .then(({ data }) => { if (active) setReport(data); })
      .catch((requestError) => { if (active) setError(requestError?.response?.data?.error || 'No se pudo cargar el informe de ventas.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters]);

  const totals = useMemo(() => {
    const map = new Map();
    for (const month of report?.months || []) {
      const current = map.get(month.currency) || { currency: month.currency, count: 0, pending_count: 0, purchase: 0, sale: 0, profit: 0 };
      current.count += month.count;
      current.pending_count += month.pending_count;
      current.purchase += month.purchase;
      current.sale += month.sale;
      current.profit += month.profit;
      map.set(month.currency, current);
    }
    return Array.from(map.values()).sort((a, b) => a.currency.localeCompare(b.currency));
  }, [report]);

  async function download(format) {
    setExporting(format);
    setError('');
    try {
      const { data } = await api.get(`/sales-report/export/${format}`, {
        params: queryParams(filters), responseType: 'blob',
      });
      const url = URL.createObjectURL(data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `informe-ventas-${filters.year}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (downloadError) {
      setError(downloadError?.response?.data?.error || 'No se pudo exportar el informe.');
    } finally {
      setExporting('');
    }
  }

  return (
    <div className="space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Informe de ventas</h1>
          <p className="text-sm text-slate-600">Operaciones confirmadas · Importes presupuestados de la ultima revision</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => download('xlsx')} disabled={!!exporting || loading} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
            {exporting === 'xlsx' ? 'Exportando...' : 'Excel'}
          </button>
          <button type="button" onClick={() => download('pdf')} disabled={!!exporting || loading} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
            {exporting === 'pdf' ? 'Exportando...' : 'PDF'}
          </button>
        </div>
      </header>

      <form onSubmit={(event) => { event.preventDefault(); setFilters({ ...draft }); }} className="grid grid-cols-2 gap-3 border-b pb-4 text-sm md:grid-cols-[90px_130px_170px_190px_minmax(160px,1fr)_auto_auto] md:items-end">
        <label className="grid gap-1">Año
          <input type="number" min="2000" max="2100" value={draft.year} onChange={(event) => setDraft({ ...draft, year: event.target.value })} className="w-full rounded border px-2 py-2" />
        </label>
        <label className="grid gap-1">Mes
          <select value={draft.month} onChange={(event) => setDraft({ ...draft, month: event.target.value })} className="w-full rounded border bg-white px-2 py-2">
            <option value="">Todo el año</option>
            {MONTHS.map((month, index) => <option key={month} value={String(index + 1).padStart(2, '0')}>{month}</option>)}
          </select>
        </label>
        <label className="grid gap-1">Unidad
          <select value={draft.business_unit} onChange={(event) => setDraft({ ...draft, business_unit: event.target.value })} className="w-full rounded border bg-white px-2 py-2">
            <option value="">Cargo e Industrial</option>
            <option value="atm-cargo">ATM Cargo</option>
            <option value="atm-industrial">ATM Industrial</option>
          </select>
        </label>
        <label className="grid gap-1">Ejecutivo
          <select value={draft.advisor_id} onChange={(event) => setDraft({ ...draft, advisor_id: event.target.value })} className="w-full rounded border bg-white px-2 py-2">
            <option value="">Todos</option>
            {(report?.advisors || []).map((advisor) => <option key={advisor.id} value={advisor.id}>{advisor.name}</option>)}
          </select>
        </label>
        <label className="col-span-2 grid gap-1 md:col-span-1">Cliente
          <input value={draft.client} onChange={(event) => setDraft({ ...draft, client: event.target.value })} className="w-full rounded border px-2 py-2" />
        </label>
        <label className="col-span-2 flex items-center gap-2 whitespace-nowrap pb-2 md:col-span-1">
          <input type="checkbox" checked={draft.pending} onChange={(event) => setDraft({ ...draft, pending: event.target.checked })} />
          Pendientes
        </label>
        <button type="submit" disabled={loading} className="col-span-2 rounded bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-50 md:col-span-1">Aplicar</button>
      </form>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Cargando informe...</p>}

      {!loading && report && (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Resumen mensual {filters.year}</h2>
              <span className="text-sm text-slate-600">{report.rows.length} operaciones</span>
            </div>
            {totals.map((total) => {
              const activeMonth = report.months.find((month) => `${month.month}|${month.currency}` === expandedMonth && month.currency === total.currency);
              const monthRows = activeMonth
                ? report.rows.filter((row) => row.confirmation.date.slice(0, 7) === activeMonth.month && row.currency === total.currency)
                : [];
              return <div key={total.currency} className="border-b pb-3">
                <div className="mb-1 text-sm font-semibold">{total.currency} · {total.count} operaciones · {total.pending_count} pendientes</div>
                <div className="overflow-x-auto">
                <table className="min-w-[650px] w-full border-collapse text-sm">
                  <thead><tr className="bg-slate-100 text-left"><th className="px-2 py-1">Mes</th><th className="px-2 py-1 text-right">Operaciones</th><th className="px-2 py-1 text-right">Pendientes</th><th className="px-2 py-1 text-right">Compra</th><th className="px-2 py-1 text-right">Venta</th><th className="px-2 py-1 text-right">Profit</th></tr></thead>
                  <tbody>
                    {report.months.filter((month) => month.currency === total.currency).map((month) => (
                      <tr key={month.month} className="border-t">
                        <td className="px-2 py-1">
                          <button
                            type="button"
                            aria-expanded={expandedMonth === `${month.month}|${total.currency}`}
                            title={`Ver operaciones de ${MONTHS[Number(month.month.slice(5, 7)) - 1]}`}
                            onClick={() => setExpandedMonth((current) => current === `${month.month}|${total.currency}` ? '' : `${month.month}|${total.currency}`)}
                            className="inline-flex items-center gap-2 whitespace-nowrap rounded px-1 py-1 font-medium text-blue-700 hover:bg-blue-50 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
                          >
                            <span aria-hidden="true" className="w-3 text-slate-500">{expandedMonth === `${month.month}|${total.currency}` ? '▾' : '▸'}</span>
                            {MONTHS[Number(month.month.slice(5, 7)) - 1]}
                          </button>
                        </td>
                        <td className="px-2 py-1 text-right">{month.count}</td>
                        <td className="px-2 py-1 text-right">{month.pending_count || '-'}</td>
                        <td className="px-2 py-1 text-right">{formatAmount(month.purchase, total.currency)}</td>
                        <td className="px-2 py-1 text-right">{formatAmount(month.sale, total.currency)}</td>
                        <td className="px-2 py-1 text-right font-semibold text-emerald-800">{formatAmount(month.profit, total.currency)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 font-semibold"><td className="px-2 py-2">Total</td><td className="px-2 py-2 text-right">{total.count}</td><td className="px-2 py-2 text-right">{total.pending_count}</td><td className="px-2 py-2 text-right">{formatAmount(total.purchase, total.currency)}</td><td className="px-2 py-2 text-right">{formatAmount(total.sale, total.currency)}</td><td className="px-2 py-2 text-right text-emerald-800">{formatAmount(total.profit, total.currency)}</td></tr>
                  </tbody>
                </table>
                </div>
                {activeMonth && (
                  <div className="mt-3 border-t border-slate-200" aria-label={`Operaciones de ${MONTHS[Number(activeMonth.month.slice(5, 7)) - 1]} ${filters.year} en ${total.currency}`}>
                    <div className="py-2 text-sm font-semibold">
                      {MONTHS[Number(activeMonth.month.slice(5, 7)) - 1]} {filters.year} · {total.currency} · {monthRows.length} {monthRows.length === 1 ? 'operación' : 'operaciones'}
                    </div>
                    {monthRows.map((row) => (
                      <div key={row.id} className="grid gap-1 border-t border-slate-100 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
                        <div className="min-w-0">
                          <Link to={`/operations/${row.id}`} className="font-semibold text-blue-700 hover:underline">{row.reference}</Link>
                          {row.title && <span className="ml-2 break-words text-slate-700">{row.title}</span>}
                          <div className="text-xs text-slate-600">{row.client_name || '-'} · {row.business_unit_name} · {row.advisor_name || '-'}</div>
                        </div>
                        <div className="sm:text-right">
                          <div className="text-xs text-slate-600">{displayDate(row.confirmation.date)} · {sourceName(row.confirmation)}</div>
                          <div className={`font-semibold ${row.profit != null && row.profit < 0 ? 'text-red-700' : 'text-emerald-800'}`}>
                            {row.complete ? `Profit ${formatAmount(row.profit, row.currency)}` : 'Pendiente de importes'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>;
            })}
            {!totals.length && <p className="py-3 text-sm text-slate-500">No hay operaciones confirmadas para estos filtros.</p>}
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">Operaciones</h2>
            <div className="overflow-x-auto border-t">
              <table className="min-w-[1300px] w-full border-collapse text-sm">
                <thead><tr className="bg-slate-100 text-left"><th className="px-2 py-2">Fecha</th><th className="px-2 py-2">Confirmación</th><th className="px-2 py-2">Operación</th><th className="px-2 py-2">Cliente</th><th className="px-2 py-2">Unidad</th><th className="px-2 py-2">Ejecutivo</th><th className="px-2 py-2">Revisión</th><th className="px-2 py-2 text-right">Compra</th><th className="px-2 py-2 text-right">Venta</th><th className="px-2 py-2 text-right">Profit</th></tr></thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={row.id} className="border-t align-top hover:bg-slate-50">
                      <td className="whitespace-nowrap px-2 py-2">{displayDate(row.confirmation.date)}</td>
                      <td className="px-2 py-2">
                        {row.confirmation.source === 'factura' ? <Link className="text-blue-700 hover:underline" to={`/invoices/${row.confirmation.document_id}`}>{sourceName(row.confirmation)}</Link>
                          : <a className="text-blue-700 hover:underline" href={`/api/deals/${row.id}/files/${row.confirmation.document_id}/download`} target="_blank" rel="noreferrer">{sourceName(row.confirmation)}</a>}
                      </td>
                      <td className="px-2 py-2"><Link className="font-medium text-blue-700 hover:underline" to={`/operations/${row.id}`}>{row.reference}</Link>{row.title && <div className="max-w-48 truncate text-xs text-slate-500" title={row.title}>{row.title}</div>}</td>
                      <td className="px-2 py-2">{row.client_name || '-'}</td>
                      <td className="px-2 py-2">{row.business_unit_name}</td>
                      <td className="px-2 py-2">{row.advisor_name || '-'}</td>
                      <td className="px-2 py-2">{row.revision || <span className="text-amber-700">Sin revisión</span>}{!row.complete && <div className="text-xs font-medium text-amber-700">Pendiente de importes</div>}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right">{formatAmount(row.purchase, row.currency)}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right">{formatAmount(row.sale, row.currency)}</td>
                      <td className={`whitespace-nowrap px-2 py-2 text-right font-semibold ${row.profit != null && row.profit < 0 ? 'text-red-700' : 'text-emerald-800'}`}>{formatAmount(row.profit, row.currency)}</td>
                    </tr>
                  ))}
                  {!report.rows.length && <tr><td colSpan={10} className="px-2 py-6 text-center text-slate-500">Sin operaciones para mostrar.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
