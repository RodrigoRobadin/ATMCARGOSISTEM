// client/src/pages/InvoiceDetail.jsx
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../api';

const statusStyles = {
  borrador: { label: 'Borrador', cls: 'bg-gray-100 text-gray-700' },
  emitida: { label: 'Emitida', cls: 'bg-blue-100 text-blue-700' },
  pago_parcial: { label: 'Pago parcial', cls: 'bg-yellow-100 text-yellow-700' },
  pagada: { label: 'Pagada', cls: 'bg-green-100 text-green-700' },
  anulada: { label: 'Anulada', cls: 'bg-red-100 text-red-700' },
  vencida: { label: 'Vencida', cls: 'bg-orange-100 text-orange-700' },
};

const fmtMoney = (v) =>
  new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'USD' }).format(
    Number(v || 0),
  );
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('es-PY') : '—');

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPayment, setShowPayment] = useState(false);
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [viewingCredit, setViewingCredit] = useState(null);
  const [creditNotes, setCreditNotes] = useState([]);

  useEffect(() => {
    loadInvoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function loadInvoice() {
    setLoading(true);
    try {
      const { data } = await api.get(`/invoices/${id}`);
      setInvoice(data);
      loadCreditNotes(id);
    } catch (e) {
      console.error('Error loading invoice', e);
      alert(e.response?.data?.error || 'No se pudo cargar la factura');
      navigate('/invoices');
    } finally {
      setLoading(false);
    }
  }

  async function loadCreditNotes(invoiceId) {
    try {
      const { data } = await api.get(`/invoices/${invoiceId}/credit-notes`);
      setCreditNotes(data || []);
    } catch (e) {
      console.error('Error loading credit notes', e);
    }
  }

  async function handleIssue() {
    if (!invoice) return;
    if (!confirm(`¿Emitir la factura ${invoice.invoice_number}?`)) return;
    try {
      await api.post(`/invoices/${invoice.id}/issue`);
      await loadInvoice();
      alert('Factura emitida');
    } catch (e) {
      console.error('Error issuing invoice', e);
      alert(e.response?.data?.error || 'No se pudo emitir');
    }
  }

  async function handleCancel() {
    if (!invoice) return;
    const reason = prompt('Motivo de anulación:');
    if (!reason) return;
    try {
      await api.post(`/invoices/${invoice.id}/cancel`, { reason });
      await loadInvoice();
      alert('Factura anulada');
    } catch (e) {
      console.error('Error canceling invoice', e);
      alert(e.response?.data?.error || 'No se pudo anular');
    }
  }

  async function handleDelete() {
    if (!invoice) return;
    if (!confirm(`¿Eliminar la factura ${invoice.invoice_number}?`)) return;
    try {
      await api.delete(`/invoices/${invoice.id}`);
      alert('Factura eliminada');
      navigate('/invoices');
    } catch (e) {
      console.error('Error deleting invoice', e);
      alert(e.response?.data?.error || 'No se pudo eliminar');
    }
  }

async function handlePdf() {
    if (!invoice) return;
    try {
      const res = await api.get(`/invoices/${invoice.id}/pdf`, { responseType: 'blob' });
      const file = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(file);
      window.open(url, '_blank');
    } catch (e) {
      console.error('Error downloading PDF', e);
      alert(e.response?.data?.error || 'No se pudo descargar el PDF');
    }
  }
  const availableCredit = Math.max(0, Number(invoice?.total_amount || 0) - Number(invoice?.credited_total || 0));


  if (loading) return <div className="p-6">Cargando factura...</div>;
  if (!invoice) return <div className="p-6">No se encontró la factura</div>;

  return (
    <div className="p-6 space-y-6">
      {invoice.canceled_by_credit_note_id && (
        <div className="p-3 border border-amber-300 bg-amber-50 text-amber-800 rounded">
          Factura anulada por nota de crédito {invoice.cancellation_reason || ''} (NC ID: {invoice.canceled_by_credit_note_id})
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-slate-500">
            <Link to="/invoices" className="hover:underline">
              ← Volver a facturas
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-slate-800">{invoice.invoice_number}</h1>
          <div className="flex items-center gap-3 mt-2">
            <span className={`px-2 py-1 rounded text-xs font-medium ${status.cls}`}>
              {status.label}
            </span>
            <span className="text-sm text-slate-500">
              Emitida: {fmtDate(invoice.issue_date)} | Vence: {fmtDate(invoice.due_date)}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {invoice.status === 'borrador' && (
            <>
              <button onClick={handleIssue} className="btn bg-blue-600 text-white hover:bg-blue-700">
                Emitir
              </button>
              <button
                onClick={handleDelete}
                className="btn bg-red-600 text-white hover:bg-red-700"
              >
                Eliminar
              </button>
            </>
          )}
          {(invoice.status === 'emitida' || invoice.status === 'pago_parcial' || invoice.status === 'pagada') && (
            <>
              <button
                onClick={() => setShowPayment(true)}
                className="btn bg-green-600 text-white hover:bg-green-700"
              >
                Registrar pago
              </button>
              <button onClick={handleCancel} className="btn border border-slate-300">
                Anular
              </button>
              <button
                onClick={() => setShowCreditModal(true)}
                className="btn bg-amber-600 text-white hover:bg-amber-700"
              >
                Nota de crédito
              </button>
            </>
          )}
          <button
            onClick={handlePdf}
            className="btn bg-amber-600 text-white hover:bg-amber-700"
          >
            Descargar PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border rounded-lg p-4 space-y-1">
          <h3 className="font-semibold">Cliente</h3>
          <div className="text-sm text-slate-700">{invoice.organization_name}</div>
          <div className="text-sm text-slate-500">
            Doc: {invoice.customer_doc || invoice.organization_ruc || '-'} · {invoice.customer_doc_type || '-'}
          </div>
          <div className="text-sm text-slate-500">
            {invoice.customer_address || invoice.organization_address || '-'}
          </div>
          <div className="text-sm text-slate-500">
            {invoice.customer_email || 'Sin email'}
          </div>
        </div>
      <div className="bg-white border rounded-lg p-4 space-y-1">
        <h3 className="font-semibold">Totales</h3>
        <div className="flex justify-between text-sm">
          <span>Subtotal</span>
          <span className="font-medium">{fmtMoney(invoice.subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Impuesto</span>
            <span className="font-medium">{fmtMoney(invoice.tax_amount)}</span>
        </div>
        <div className="flex justify-between text-base font-semibold text-slate-800">
          <span>Total</span>
          <span>{fmtMoney(invoice.total_amount)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>Notas de crédito</span>
          <span className="font-medium text-amber-700">
            {fmtMoney(invoice.credited_total || 0)}
          </span>
        </div>
        <div className="flex justify-between text-sm font-semibold text-slate-800">
          <span>Total neto</span>
          <span>{fmtMoney(invoice.net_total_amount ?? (invoice.total_amount - (invoice.credited_total || 0)))}</span>
        </div>
        <div className="flex justify-between text-sm text-slate-600">
          <span>Pagado</span>
          <span>{fmtMoney(invoice.paid_amount)}</span>
        </div>
        <div className="flex justify-between text-sm text-orange-600">
          <span>Saldo</span>
          <span className="font-semibold">
            {fmtMoney(invoice.net_balance ?? invoice.balance)}
          </span>
        </div>
      </div>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold">Ítems</div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-4 py-2">Descripción</th>
              <th className="px-4 py-2 w-20">Cant.</th>
              <th className="px-4 py-2 w-32">Precio</th>
              <th className="px-4 py-2 w-32">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {(invoice.items || []).map((it) => (
              <tr key={it.id} className="border-t">
                <td className="px-4 py-2">{it.description || '—'}</td>
                <td className="px-4 py-2">{it.quantity}</td>
                <td className="px-4 py-2">{fmtMoney(it.unit_price)}</td>
                <td className="px-4 py-2 font-medium">{fmtMoney(it.subtotal)}</td>
              </tr>
            ))}
            {(!invoice.items || invoice.items.length === 0) && (
              <tr>
                <td className="px-4 py-3 text-center text-slate-500" colSpan={4}>
                  Sin ítems
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <span className="font-semibold">Pagos</span>
          {(invoice.status === 'emitida' || invoice.status === 'pago_parcial') && (
            <button
              onClick={() => setShowPayment(true)}
              className="text-sm px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700"
            >
              Registrar pago
            </button>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2">Método</th>
              <th className="px-4 py-2">Referencia</th>
              <th className="px-4 py-2">Monto</th>
              <th className="px-4 py-2">Registrado por</th>
            </tr>
          </thead>
          <tbody>
            {(invoice.payments || []).map((p) => (
              <tr key={p.id} className="border-t">
                <td className="px-4 py-2">{fmtDate(p.payment_date)}</td>
                <td className="px-4 py-2 capitalize">{p.payment_method}</td>
                <td className="px-4 py-2">{p.reference_number || '—'}</td>
                <td className="px-4 py-2 font-medium">{fmtMoney(p.amount)}</td>
                <td className="px-4 py-2">{p.registered_by_name || '—'}</td>
              </tr>
            ))}
            {(!invoice.payments || invoice.payments.length === 0) && (
              <tr>
                <td className="px-4 py-3 text-center text-slate-500" colSpan={5}>
                  Sin pagos registrados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <span className="font-semibold">Notas de crédito</span>
          {(invoice.status === 'emitida' || invoice.status === 'pago_parcial' || invoice.status === 'pagada') && (
            <button
              onClick={() => setShowCreditModal(true)}
              className="text-sm px-3 py-1 bg-amber-600 text-white rounded hover:bg-amber-700"
            >
              Nueva nota de crédito
            </button>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-4 py-2">Número</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2 text-right">Monto</th>
              <th className="px-4 py-2 text-center">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {(creditNotes || []).map((cn) => (
              <tr key={cn.id} className="border-t">
                <td className="px-4 py-2">{cn.credit_note_number}</td>
                <td className="px-4 py-2 capitalize">{cn.status}</td>
                <td className="px-4 py-2">{fmtDate(cn.issue_date)}</td>
                <td className="px-4 py-2 text-right font-medium">{fmtMoney(cn.total_amount)}</td>
                <td className="px-4 py-2 text-center">
                  <button
                    className="text-xs px-2 py-1 bg-slate-600 text-white rounded hover:bg-slate-700"
                    onClick={() => setViewingCredit(cn.id)}
                  >
                    Ver
                  </button>
                </td>
              </tr>
            ))}
            {(!creditNotes || creditNotes.length === 0) && (
              <tr>
                <td className="px-4 py-3 text-center text-slate-500" colSpan={5}>
                  Sin notas de crédito
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showPayment && (
        <PaymentModal
          invoice={invoice}
          onClose={() => setShowPayment(false)}
          onSuccess={async () => {
            setShowPayment(false);
            await loadInvoice();
          }}
        />
      )}

      {showCreditModal && (
        <CreditNoteModal
          invoice={invoice}
          availableCredit={availableCredit}
          onClose={() => setShowCreditModal(false)}
          onSuccess={async () => {
            setShowCreditModal(false);
            await loadInvoice();
          }}
        />
      )}

      {viewingCredit && (
        <CreditNoteViewModal
          creditNoteId={viewingCredit}
          onClose={() => setViewingCredit(null)}
          onRefresh={async () => {
            await loadInvoice();
          }}
        />
      )}
    </div>
  );
}

function PaymentModal({ invoice, onClose, onSuccess }) {
  const [form, setForm] = useState({
    payment_date: new Date().toISOString().split('T')[0],
    amount: '',
    payment_method: 'transferencia',
    reference_number: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.amount || Number(form.amount) <= 0) {
      alert('Ingrese un monto válido');
      return;
    }
    if (Number(form.amount) > Number(invoice.balance)) {
      alert('El monto no puede ser mayor al saldo pendiente');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/invoices/${invoice.id}/payments`, {
        ...form,
        amount: Number(form.amount),
      });
      alert('Pago registrado');
      onSuccess();
    } catch (e) {
      console.error('Error registering payment', e);
      alert(e.response?.data?.error || 'No se pudo registrar el pago');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 md:p-6 z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Registrar pago</h3>
          <button onClick={onClose} className="text-2xl leading-none">
            ×
          </button>
        </div>

        <div className="mb-4 p-3 bg-slate-50 rounded text-sm">
          <div className="font-medium">{invoice.invoice_number}</div>
          <div className="text-slate-600">{invoice.organization_name}</div>
          <div className="mt-2 flex justify-between">
            <span>Saldo pendiente:</span>
            <span className="font-bold text-orange-600">{fmtMoney(invoice.balance)}</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Fecha de pago</label>
            <input
              type="date"
              className="w-full border rounded-lg px-3 py-2"
              value={form.payment_date}
              onChange={(e) => setForm({ ...form, payment_date: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Monto</label>
            <input
              type="number"
              step="0.01"
              className="w-full border rounded-lg px-3 py-2"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0.00"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Método de pago</label>
            <select
              className="w-full border rounded-lg px-3 py-2"
              value={form.payment_method}
              onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
              required
            >
              <option value="transferencia">Transferencia</option>
              <option value="efectivo">Efectivo</option>
              <option value="cheque">Cheque</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="otro">Otro</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Referencia</label>
            <input
              type="text"
              className="w-full border rounded-lg px-3 py-2"
              value={form.reference_number}
              onChange={(e) => setForm({ ...form, reference_number: e.target.value })}
              placeholder="Ej: Transferencia #12345"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notas</label>
            <textarea
              className="w-full border rounded-lg px-3 py-2"
              rows="2"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Notas adicionales..."
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border rounded-lg hover:bg-slate-50"
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              disabled={saving}
            >
              {saving ? 'Guardando...' : 'Registrar pago'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreditNoteModal({ invoice, availableCredit, onClose, onSuccess }) {
  const [form, setForm] = useState({
    reason: '',
    percentage: 100,
  });
  const [saving, setSaving] = useState(false);

  const factor = Math.max(0, Math.min(100, Number(form.percentage) || 0)) / 100;
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const creditItems = items.map((it, idx) => {
    const qty = Number(it.quantity || 1);
    const unit = Number(it.unit_price || 0) * factor;
    const subtotal = qty * unit;
    return {
      description: it.description || 'Item',
      quantity: qty,
      unit_price: Number(unit.toFixed(2)),
      subtotal: Number(subtotal.toFixed(2)),
      tax_rate: it.tax_rate ?? 10,
      item_order: it.item_order ?? idx,
    };
  });
  const totals = creditItems.reduce(
    (acc, it) => {
      acc.subtotal += it.subtotal;
      acc.tax += (it.subtotal * (Number(it.tax_rate || 0))) / 100;
      return acc;
    },
    { subtotal: 0, tax: 0 }
  );
  totals.total = totals.subtotal + totals.tax;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!invoice) return;
    if (totals.total <= 0) {
      alert('El monto debe ser mayor a cero');
      return;
    }
    setSaving(true);
    try {
      await api.post('/invoices/credit-notes', {
        invoice_id: invoice.id,
        reason: form.reason,
        items: creditItems,
      });
      alert('Nota de crédito creada');
      onSuccess();
    } catch (err) {
      console.error('Error creating credit note', err);
      alert(err.response?.data?.error || 'No se pudo crear la nota de crédito');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 md:p-6 z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Nueva nota de crédito</h3>
          <button onClick={onClose} className="text-2xl leading-none">×</button>
        </div>

        <div className="mb-4 p-3 bg-slate-50 rounded text-sm">
          <div className="font-medium">{invoice.invoice_number}</div>
          <div className="text-slate-600">{invoice.organization_name}</div>
          <div className="mt-2 flex justify-between">
            <span>Disponible para acreditar:</span>
            <span className="font-bold text-amber-700">{fmtMoney(availableCredit)}</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Motivo</label>
            <input
              type="text"
              className="w-full border rounded-lg px-3 py-2"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="Ej: devolución parcial"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Porcentaje a acreditar</label>
            <input
              type="number"
              min="1"
              max="100"
              className="w-full border rounded-lg px-3 py-2"
              value={form.percentage}
              onChange={(e) => setForm({ ...form, percentage: e.target.value })}
            />
            <p className="text-xs text-slate-500 mt-1">
              Se prorratea sobre los ítems de la factura. Valor estimado: {fmtMoney(totals.total)}.
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border rounded-lg hover:bg-slate-50"
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              type="submit"
      className="flex-1 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
      disabled={saving}
    >
      {saving ? 'Guardando...' : 'Crear nota de crédito'}
    </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreditNoteViewModal({ creditNoteId, onClose, onRefresh }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [canceling, setCanceling] = useState(false);

  useEffect(() => {
    loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creditNoteId]);

  async function loadDetail() {
    setLoading(true);
    try {
      const { data } = await api.get(`/invoices/credit-notes/${creditNoteId}`);
      setData(data);
    } catch (e) {
      console.error('Error loading credit note', e);
      alert(e.response?.data?.error || 'No se pudo cargar la nota de crédito');
      onClose();
    } finally {
      setLoading(false);
    }
  }

  async function handleIssue() {
    if (!data) return;
    if (!confirm(`¿Emitir la nota de crédito ${data.credit_note_number}?`)) return;
    setIssuing(true);
    try {
      await api.post(`/invoices/credit-notes/${creditNoteId}/issue`);
      await loadDetail();
      onRefresh?.();
      alert('Nota de crédito emitida');
    } catch (e) {
      console.error('Error issuing credit note', e);
      alert(e.response?.data?.error || 'No se pudo emitir la nota de crédito');
    } finally {
      setIssuing(false);
    }
  }

  async function handleCancel() {
    if (!data) return;
    if (!confirm(`¿Anular la nota de crédito ${data.credit_note_number}?`)) return;
    setCanceling(true);
    try {
      await api.post(`/invoices/credit-notes/${creditNoteId}/cancel`);
      await loadDetail();
      onRefresh?.();
      alert('Nota de crédito anulada');
    } catch (e) {
      console.error('Error canceling credit note', e);
      alert(e.response?.data?.error || 'No se pudo anular la nota de crédito');
    } finally {
      setCanceling(false);
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 md:p-6 z-50">
        <div className="bg-white rounded-lg p-6 w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
          <div>Cargando nota de crédito...</div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 md:p-6 z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-2xl shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm text-slate-500">Nota de credito</div>
            <div className="text-xl font-bold">{data.credit_note_number}</div>
            <div className="text-sm text-slate-500">
              Estado: {data.status} · {fmtDate(data.issue_date)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data.status === 'borrador' && (
              <button
                onClick={handleIssue}
                className="px-3 py-1 rounded bg-amber-600 text-white text-sm hover:bg-amber-700 disabled:opacity-50"
                disabled={issuing}
              >
                {issuing ? 'Emitiendo…' : 'Emitir'}
              </button>
            )}
            {data.status !== 'anulada' && (
              <button
                onClick={handleCancel}
                className="px-3 py-1 rounded border border-slate-300 text-sm hover:bg-slate-50 disabled:opacity-50"
                disabled={canceling}
              >
                {canceling ? 'Anulando…' : 'Anular'}
              </button>
            )}
            <button onClick={onClose} className="text-2xl leading-none">×</button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="bg-slate-50 rounded p-3 text-sm">
            <div className="font-semibold">Factura</div>
            <div>{data.invoice?.invoice_number}</div>
            <div className="text-slate-600">{data.invoice?.organization_name}</div>
          </div>
          <div className="bg-slate-50 rounded p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span className="font-medium">{fmtMoney(data.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Impuesto</span>
              <span className="font-medium">{fmtMoney(data.tax_amount)}</span>
            </div>
            <div className="flex justify-between font-semibold text-slate-800">
              <span>Total</span>
              <span>{fmtMoney(data.total_amount)}</span>
            </div>
            <div className="flex justify-between">
              <span>Motivo</span>
              <span className="text-slate-700">{data.reason || 'N/D'}</span>
            </div>
          </div>
        </div>

        <div className="bg-white border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b font-semibold">Ítems</div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-4 py-2">Descripción</th>
                <th className="px-4 py-2 w-20">Cant.</th>
                <th className="px-4 py-2 w-32">Precio</th>
                <th className="px-4 py-2 w-32">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {(data.items || []).map((it) => (
                <tr key={it.id} className="border-t">
                  <td className="px-4 py-2">{it.description || 'N/D'}</td>
                  <td className="px-4 py-2">{it.quantity}</td>
                  <td className="px-4 py-2">{fmtMoney(it.unit_price)}</td>
                  <td className="px-4 py-2 font-medium">{fmtMoney(it.subtotal)}</td>
                </tr>
              ))}
              {(!data.items || data.items.length === 0) && (
                <tr>
                  <td className="px-4 py-3 text-center text-slate-500" colSpan={4}>
                    Sin ítems
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
