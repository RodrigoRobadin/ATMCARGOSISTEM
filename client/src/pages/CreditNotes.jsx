import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const statusStyles = {
  borrador: 'bg-slate-100 text-slate-700',
  emitida: 'bg-blue-100 text-blue-700',
  anulada: 'bg-red-100 text-red-700',
};

const statusLabels = {
  borrador: 'Borrador',
  emitida: 'Emitida',
  anulada: 'Anulada',
};

function normalizeCurrency(value) {
  const code = String(value || '').toUpperCase();
  return code === 'GS' ? 'PYG' : code || 'USD';
}

function fmtMoney(value, currency) {
  const code = normalizeCurrency(currency);
  return new Intl.NumberFormat('es-PY', {
    style: 'currency',
    currency: code,
    minimumFractionDigits: code === 'PYG' ? 0 : 2,
    maximumFractionDigits: code === 'PYG' ? 0 : 2,
  }).format(Number(value || 0));
}

function fmtDate(value) {
  if (!value) return '-';
  const raw = String(value).slice(0, 10);
  const [year, month, day] = raw.split('-').map(Number);
  if (!year || !month || !day) return '-';
  return new Date(year, month - 1, day).toLocaleDateString('es-PY');
}

function operationPath(note) {
  if (note?.service_case_id) return `/service/cases/${note.service_case_id}?tab=administracion`;
  if (note?.deal_id) return `/operations/${note.deal_id}?tab=administracion`;
  return '';
}

export default function CreditNotes() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [filters, setFilters] = useState({
    status: '',
    search: '',
    from_date: '',
    to_date: '',
  });

  async function loadRows() {
    setLoading(true);
    try {
      const params = {};
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params[key] = value;
      });
      const { data } = await api.get('/invoices/credit-notes', { params });
      setRows(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error loading credit notes:', error);
      alert(error.response?.data?.error || 'No se pudieron cargar las notas de credito');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(loadRows, filters.search ? 250 : 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  async function openPdf(note) {
    setBusyId(note.id);
    try {
      const response = await api.get(`/invoices/credit-notes/${note.id}/pdf`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(
        new Blob([response.data], { type: 'application/pdf' })
      );
      window.open(url, '_blank');
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (error) {
      alert(error.response?.data?.error || 'No se pudo abrir el PDF');
    } finally {
      setBusyId(null);
    }
  }

  async function issueNote(note) {
    if (!confirm(`Emitir la nota de credito ${note.credit_note_number}?`)) return;
    setBusyId(note.id);
    try {
      await api.post(`/invoices/credit-notes/${note.id}/issue`);
      await loadRows();
    } catch (error) {
      alert(error.response?.data?.error || 'No se pudo emitir la nota de credito');
    } finally {
      setBusyId(null);
    }
  }

  async function cancelNote(note) {
    if (!confirm(`Anular la nota de credito ${note.credit_note_number}?`)) return;
    setBusyId(note.id);
    try {
      await api.post(`/invoices/credit-notes/${note.id}/cancel`);
      await loadRows();
    } catch (error) {
      alert(error.response?.data?.error || 'No se pudo anular la nota de credito');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-white">
          Notas de credito
        </h1>
        <p className="text-sm text-slate-500">
          Documentos de clientes ordenados por numero correlativo, del mas reciente al mas antiguo.
        </p>
      </div>

      <div className="mb-6 rounded-lg border bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Estado
            <select
              className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({ ...current, status: event.target.value }))
              }
            >
              <option value="">Todos</option>
              <option value="borrador">Borrador</option>
              <option value="emitida">Emitida</option>
              <option value="anulada">Anulada</option>
            </select>
          </label>

          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Buscar
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              value={filters.search}
              onChange={(event) =>
                setFilters((current) => ({ ...current, search: event.target.value }))
              }
              placeholder="NC, factura, cliente u operacion"
            />
          </label>

          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Desde
            <input
              type="date"
              className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              value={filters.from_date}
              onChange={(event) =>
                setFilters((current) => ({ ...current, from_date: event.target.value }))
              }
            />
          </label>

          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Hasta
            <input
              type="date"
              className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              value={filters.to_date}
              onChange={(event) =>
                setFilters((current) => ({ ...current, to_date: event.target.value }))
              }
            />
          </label>
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center text-slate-500">Cargando...</div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border bg-white py-10 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-900">
          No se encontraron notas de credito.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white dark:border-slate-700 dark:bg-slate-900">
          <table className="w-full table-fixed text-sm">
            <thead className="border-b bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
              <tr>
                <th className="w-40 px-2 py-2 text-left">Numero NC</th>
                <th className="w-40 px-2 py-2 text-left">Factura afectada</th>
                <th className="px-2 py-2 text-left">Operacion</th>
                <th className="px-2 py-2 text-left">Cliente</th>
                <th className="w-24 px-2 py-2 text-left">Emision</th>
                <th className="px-2 py-2 text-left">Motivo</th>
                <th className="w-32 px-2 py-2 text-right">Total</th>
                <th className="w-24 px-2 py-2 text-center">Estado</th>
                <th className="w-44 px-2 py-2 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {rows.map((note) => {
                const opPath = operationPath(note);
                const busy = busyId === note.id;
                return (
                  <tr
                    key={note.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <td className="whitespace-nowrap px-2 py-2 font-semibold text-slate-900 dark:text-white">
                      {note.credit_note_number}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">
                      <Link
                        className="font-medium text-blue-600 hover:underline"
                        to={`/invoices/${note.invoice_id}`}
                      >
                        {note.invoice_number || `#${note.invoice_id}`}
                      </Link>
                    </td>
                    <td className="px-2 py-2">
                      {opPath ? (
                        <Link
                          className="font-medium text-blue-600 hover:underline"
                          to={opPath}
                        >
                          {note.operation_reference || 'Ver operacion'}
                        </Link>
                      ) : (
                        <span className="text-slate-400">Sin operacion</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="truncate" title={note.organization_name || ''}>
                        {note.organization_name || '-'}
                      </div>
                      <div className="text-xs text-slate-500">{note.organization_ruc || ''}</div>
                    </td>
                    <td className="px-2 py-2 text-slate-600 dark:text-slate-300">
                      {fmtDate(note.issue_date || note.created_at)}
                    </td>
                    <td className="px-2 py-2">
                      <div className="truncate" title={note.reason || ''}>
                        {note.reason || '-'}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right font-semibold">
                      {fmtMoney(note.total_amount, note.currency_code)}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span
                        className={`rounded px-2 py-1 text-xs font-medium ${
                          statusStyles[note.status] || statusStyles.borrador
                        }`}
                      >
                        {statusLabels[note.status] || note.status}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap justify-center gap-1">
                        <Link
                          to={`/invoices/${note.invoice_id}`}
                          className="rounded bg-slate-700 px-2 py-1 text-xs text-white hover:bg-slate-800"
                        >
                          Ver
                        </Link>
                        <button
                          type="button"
                          onClick={() => openPdf(note)}
                          disabled={busy}
                          className="rounded bg-amber-600 px-2 py-1 text-xs text-white hover:bg-amber-700 disabled:opacity-50"
                        >
                          PDF
                        </button>
                        {note.status === 'borrador' && (
                          <button
                            type="button"
                            onClick={() => issueNote(note)}
                            disabled={busy}
                            className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            Emitir
                          </button>
                        )}
                        {note.status !== 'anulada' && (
                          <button
                            type="button"
                            onClick={() => cancelNote(note)}
                            disabled={busy}
                            className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            Anular
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
