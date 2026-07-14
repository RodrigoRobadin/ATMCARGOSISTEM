// client/src/pages/Invoices.jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import InvoiceCreateModal from '../components/InvoiceCreateModal.jsx';

const statusStyles = {
  borrador: 'bg-gray-100 text-gray-700',
  emitida: 'bg-blue-100 text-blue-700',
  pago_parcial: 'bg-yellow-100 text-yellow-700',
  pagada: 'bg-green-100 text-green-700',
  anulada: 'bg-red-100 text-red-700',
  vencida: 'bg-orange-100 text-orange-700',
};

const statusLabels = {
  borrador: 'Borrador',
  emitida: 'Emitida',
  pago_parcial: 'Pago Parcial',
  pagada: 'Pagada',
  anulada: 'Anulada',
  vencida: 'Vencida',
};

const normalizeCurrency = (code) => {
  const c = String(code || '').toUpperCase();
  if (c === 'GS') return 'PYG';
  return c || 'USD';
};

const fmtMoney = (v, currency) =>
  new Intl.NumberFormat('es-PY', {
    style: 'currency',
    currency: normalizeCurrency(currency),
  }).format(v || 0);
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('es-PY') : '—');

export default function Invoices() {
  const [loading, setLoading] = useState(false);
  const [invoices, setInvoices] = useState([]);
  const [filters, setFilters] = useState({
    status: '',
    search: '',
    from_date: '',
    to_date: '',
  });

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);

  useEffect(() => {
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  async function loadInvoices() {
    setLoading(true);
    try {
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.search) params.search = filters.search;
      if (filters.from_date) params.from_date = filters.from_date;
      if (filters.to_date) params.to_date = filters.to_date;

      const { data } = await api.get('/invoices', { params });
      setInvoices(data || []);
    } catch (e) {
      console.error('Error loading invoices:', e);
      alert('Error al cargar facturas');
    } finally {
      setLoading(false);
    }
  }

  async function handleIssue(invoice) {
    if (!confirm(`¿Emitir la factura ${invoice.invoice_number}?`)) return;
    try {
      await api.post(`/invoices/${invoice.id}/issue`);
      alert('Factura emitida correctamente');
      loadInvoices();
    } catch (e) {
      console.error('Error issuing invoice:', e);
      alert(formatApiError(e, 'Error al emitir factura'));
    }
  }

  async function handleDelete(invoice) {
    if (!confirm(`¿Eliminar la factura ${invoice.invoice_number}?`)) return;
    try {
      await api.delete(`/invoices/${invoice.id}`);
      alert('Factura eliminada correctamente');
      loadInvoices();
    } catch (e) {
      console.error('Error deleting invoice:', e);
      alert(e.response?.data?.error || 'Error al eliminar factura');
    }
  }

  function openPaymentModal(invoice) {
    setSelectedInvoice(invoice);
    setShowPaymentModal(true);
  }

  async function handlePdf(invoiceId) {
    try {
      const res = await api.get(`/invoices/${invoiceId}/pdf`, { responseType: 'blob' });
      const file = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(file);
      window.open(url, '_blank');
    } catch (e) {
      console.error('Error downloading PDF', e);
      alert(e.response?.data?.error || 'No se pudo descargar el PDF');
    }
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Facturas</h1>
          <p className="text-slate-500 text-sm">Gestión de facturas y cobranzas</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
        >
          + Nueva factura
        </button>
      </div>

      {/* Filters */}
      <div className="mb-6 bg-white border rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Estado</label>
            <select
              className="w-full border rounded-lg px-3 py-2"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">Todos</option>
              <option value="borrador">Borrador</option>
              <option value="emitida">Emitida</option>
              <option value="pago_parcial">Pago Parcial</option>
              <option value="pagada">Pagada</option>
              <option value="anulada">Anulada</option>
              <option value="vencida">Vencida</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Buscar</label>
            <input
              type="text"
              className="w-full border rounded-lg px-3 py-2"
              placeholder="Número o cliente..."
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Desde</label>
            <input
              type="date"
              className="w-full border rounded-lg px-3 py-2"
              value={filters.from_date}
              onChange={(e) => setFilters({ ...filters, from_date: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Hasta</label>
            <input
              type="date"
              className="w-full border rounded-lg px-3 py-2"
              value={filters.to_date}
              onChange={(e) => setFilters({ ...filters, to_date: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-8 text-slate-500">Cargando...</div>
      ) : invoices.length === 0 ? (
        <div className="text-center py-8 text-slate-500">No se encontraron facturas</div>
      ) : (
        <div className="bg-white border rounded-lg overflow-x-auto">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="w-40 px-2 py-2 text-left text-xs font-medium text-slate-700 uppercase">Numero factura</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-slate-700 uppercase">Operacion</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-slate-700 uppercase">Cliente</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-slate-700 uppercase">%</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-slate-700 uppercase">Emision</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-slate-700 uppercase">Vencimiento</th>
                <th className="px-2 py-2 text-right text-xs font-medium text-slate-700 uppercase">Total</th>
                <th className="px-2 py-2 text-right text-xs font-medium text-slate-700 uppercase">Saldo</th>
                <th className="px-2 py-2 text-center text-xs font-medium text-slate-700 uppercase">Estado</th>
                <th className="px-2 py-2 text-center text-xs font-medium text-slate-700 uppercase">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="hover:bg-slate-50">
                  <td className="w-40 px-2 py-2 whitespace-nowrap">
                    <Link to={`/invoices/${invoice.id}`} className="font-medium text-blue-600 hover:underline">
                      {invoice.invoice_number || `#${invoice.id}`}
                    </Link>
                    <div className="text-xs text-slate-500 mt-0.5">ID {invoice.id}</div>
                  </td>
                  <td className="px-2 py-2 text-sm">
                    {invoice.deal_reference ? (
                      <Link
                        to={invoice.service_case_id ? `/service/cases/${invoice.service_case_id}?tab=administracion` : `/operations/${invoice.deal_id || ''}?tab=administracion`}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {invoice.deal_reference}
                      </Link>
                    ) : (
                      <span className="text-slate-400">Sin operacion</span>
                    )}
                    {invoice.deal_title && invoice.deal_title !== invoice.deal_reference ? (
                      <div className="text-xs text-slate-500 mt-0.5">{invoice.deal_title}</div>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-sm">{invoice.organization_name || '—'}</td>
                  <td className="px-2 py-2 text-sm text-slate-700">{invoice.percentage ? `${invoice.percentage}%` : '100%'}</td>
                  <td className="px-2 py-2 text-sm text-slate-600">{fmtDate(invoice.issue_date)}</td>
                  <td className="px-2 py-2 text-sm text-slate-600">{fmtDate(invoice.due_date)}</td>
                  <td className="px-2 py-2 text-sm text-right font-medium">
                    {fmtMoney(invoice.total_amount, invoice.currency_code || invoice.currency_resolved)}
                  </td>
                  <td className="px-2 py-2 text-sm text-right">
                    <span className={invoice.balance > 0 ? 'text-orange-600 font-medium' : 'text-green-600'}>
                      {fmtMoney(invoice.balance, invoice.currency_code || invoice.currency_resolved)}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-center">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${statusStyles[invoice.status] || statusStyles.borrador}`}>
                      {statusLabels[invoice.status] || invoice.status}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-center gap-1 flex-wrap">
                      {invoice.status === 'borrador' && (
                        <>
                          <button onClick={() => handleIssue(invoice)} className="text-[11px] px-1.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">
                            Emitir
                          </button>
                          <button onClick={() => handleDelete(invoice)} className="text-[11px] px-1.5 py-1 bg-red-600 text-white rounded hover:bg-red-700">
                            Eliminar
                          </button>
                        </>
                      )}
                      {(invoice.status === 'emitida' || invoice.status === 'pago_parcial') && (
                        <button onClick={() => openPaymentModal(invoice)} className="text-[11px] px-1.5 py-1 bg-green-600 text-white rounded hover:bg-green-700">
                          Pago
                        </button>
                      )}
                      <Link to={`/invoices/${invoice.id}`} className="text-[11px] px-1.5 py-1 bg-slate-600 text-white rounded hover:bg-slate-700">
                        Ver
                      </Link>
                      <button onClick={() => handlePdf(invoice.id)} className="text-[11px] px-1.5 py-1 bg-amber-600 text-white rounded hover:bg-amber-700">
                        PDF
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* Payment Modal */}
      {showPaymentModal && selectedInvoice && (
        <PaymentModal
          invoice={selectedInvoice}
          onClose={() => {
            setShowPaymentModal(false);
            setSelectedInvoice(null);
          }}
          onSuccess={() => {
            loadInvoices();
            setShowPaymentModal(false);
            setSelectedInvoice(null);
          }}
        />
      )}

      {/* Create Invoice Modal */}
      {showCreateModal && (
        <CreateInvoiceModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={(invoiceId) => {
            setShowCreateModal(false);
            loadInvoices();
            if (invoiceId) window.open(`/invoices/${invoiceId}`, '_blank');
          }}
        />
      )}
    </div>
  );
}


