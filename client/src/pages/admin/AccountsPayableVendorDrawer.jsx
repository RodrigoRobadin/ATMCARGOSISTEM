import React, { useEffect, useState } from 'react';
import { api } from '../../api';

const PAYMENT_METHODS = ['Transferencia', 'Efectivo', 'Cheque', 'Tarjeta', 'Otro'];

function fmtMoney(amount, currencyCode = 'PYG') {
  const value = Number(amount || 0);
  const currency = String(currencyCode || 'PYG').toUpperCase();
  return `${currency} ${value.toLocaleString('es-PY', {
    minimumFractionDigits: currency === 'USD' ? 2 : 0,
    maximumFractionDigits: currency === 'USD' ? 2 : 0,
  })}`;
}

function fmtDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleDateString('es-PY');
  } catch {
    return value;
  }
}

function SummaryBox({ label, value, tone = 'slate' }) {
  const toneMap = {
    slate: 'bg-slate-50 text-slate-700',
    blue: 'bg-blue-50 text-blue-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
  };
  return (
    <div className="border rounded-xl p-4 bg-white">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-2 inline-flex rounded-lg px-3 py-1.5 text-sm font-semibold ${toneMap[tone] || toneMap.slate}`}>
        {value}
      </div>
    </div>
  );
}

function StatusChip({ label, tone = 'slate' }) {
  const toneMap = {
    slate: 'bg-slate-100 text-slate-700',
    blue: 'bg-blue-100 text-blue-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${toneMap[tone] || toneMap.slate}`}>
      {label}
    </span>
  );
}

function getRowStatusMeta(row) {
  const rawStatus = String(row?.movement_status || '').trim();
  const status = rawStatus.toLowerCase();
  const dueDate = row?.due_date ? new Date(row.due_date) : null;
  const isOverdue =
    row?.movement_kind === 'factura' &&
    dueDate &&
    dueDate < new Date() &&
    !status.includes('pagad') &&
    !status.includes('cancel');

  if (row?.movement_kind === 'payment_order') {
    if (status.includes('anulad')) return { label: 'OP anulada', tone: 'red' };
    if (status.includes('aprob')) return { label: 'OP aprobada', tone: 'blue' };
    if (status.includes('pag')) return { label: 'OP pagada', tone: 'emerald' };
    return { label: 'Con OP', tone: 'amber' };
  }

  if (status.includes('anulad')) return { label: 'Anulado', tone: 'red' };
  if (status.includes('parcial')) return { label: 'Parcial', tone: 'blue' };
  if (status.includes('pagad') || status.includes('cancel')) return { label: 'Pagado', tone: 'emerald' };
  if (isOverdue) return { label: 'Vencido', tone: 'red' };
  if (row?.movement_kind === 'payment') return { label: 'Pago aplicado', tone: 'emerald' };
  if (status.includes('pend')) return { label: 'Pendiente', tone: 'amber' };
  return { label: rawStatus || '-', tone: 'slate' };
}

function getPaymentOrderMeta(row) {
  if (!row?.payment_order_id || row?.movement_kind === 'payment_order') return null;
  const status = String(row?.payment_order_status || '').toLowerCase();
  if (status.includes('anulad')) return { label: 'OP anulada', tone: 'red' };
  if (status.includes('aprob')) return { label: 'OP aprobada', tone: 'blue' };
  if (status.includes('pend')) return { label: 'OP en aprobacion', tone: 'amber' };
  if (status.includes('pag')) return { label: 'OP pagada', tone: 'emerald' };
  return { label: 'Con OP', tone: 'amber' };
}

export default function AccountsPayableVendorDrawer({
  open,
  supplierKey,
  currencyCode,
  initialReference = '',
  initialMovementKind = 'all',
  onDataChanged,
  onClose,
}) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ supplier: null, summary: null, rows: [] });
  const [filters, setFilters] = useState({
    from_date: '',
    to_date: '',
    movement_kind: initialMovementKind || 'all',
    reference_q: initialReference || '',
    only_overdue: false,
  });
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentRow, setPaymentRow] = useState(null);
  const [paymentForm, setPaymentForm] = useState({
    payment_date: '',
    amount: '',
    method: '',
    account: '',
    reference_number: '',
    notes: '',
  });
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderRow, setOrderRow] = useState(null);
  const [orderForm, setOrderForm] = useState({
    payment_method: '',
    payment_date: '',
    amount: '',
    description: '',
    observations: '',
  });

  useEffect(() => {
    setFilters((prev) => ({
      ...prev,
      movement_kind: initialMovementKind || 'all',
      reference_q: initialReference || '',
      only_overdue: false,
    }));
  }, [initialReference, initialMovementKind, supplierKey, currencyCode]);

  async function loadDetail() {
    if (!open || !supplierKey || !currencyCode) return;
    setLoading(true);
    try {
      const { data } = await api.get('/accounts-payable/vendor-detail', {
        params: {
          supplier_key: supplierKey,
          currency_code: currencyCode,
        },
      });
      setData({
        supplier: data?.supplier || null,
        summary: data?.summary || null,
        rows: Array.isArray(data?.rows) ? data.rows : [],
      });
    } catch (error) {
      console.error('accounts payable vendor detail error', error);
      setData({ supplier: null, summary: null, rows: [] });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supplierKey, currencyCode]);

  if (!open) return null;

  const supplier = data.supplier || {};
  const summary = data.summary || {};
  const allRows = data.rows || [];
  const rows = (data.rows || []).filter((row) => {
    if (filters.movement_kind !== 'all' && row.movement_kind !== filters.movement_kind) return false;
    if (filters.from_date && row.movement_date && String(row.movement_date).slice(0, 10) < filters.from_date) return false;
    if (filters.to_date && row.movement_date && String(row.movement_date).slice(0, 10) > filters.to_date) return false;
    if (filters.reference_q) {
      const haystack = `${row.operation_reference || ''} ${row.document_number || ''} ${row.description || ''}`.toLowerCase();
      if (!haystack.includes(String(filters.reference_q).toLowerCase())) return false;
    }
    if (filters.only_overdue) {
      if (row.movement_kind !== 'factura' || !row.due_date) return false;
      const dueDate = new Date(row.due_date);
      if (!(dueDate < new Date()) || String(row.movement_status || '').toLowerCase().includes('pagad')) return false;
    }
    return true;
  });

  const lastPayment = allRows
    .filter((row) => row.movement_kind === 'payment')
    .sort((a, b) => new Date(b.movement_date || 0) - new Date(a.movement_date || 0))[0];

  const lastInvoice = allRows
    .filter((row) => row.movement_kind === 'factura')
    .sort((a, b) => new Date(b.movement_date || 0) - new Date(a.movement_date || 0))[0];

  const overdueInvoices = allRows.filter((row) => {
    if (row.movement_kind !== 'factura' || !row.due_date) return false;
    const status = String(row.movement_status || '').toLowerCase();
    if (status.includes('pagad') || status.includes('cancel') || status.includes('anulad')) return false;
    return new Date(row.due_date) < new Date();
  });

  const averageOverdueDays = overdueInvoices.length
    ? Math.round(
        overdueInvoices.reduce((acc, row) => {
          const dueDate = new Date(row.due_date);
          const today = new Date();
          const diff = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
          return acc + Math.max(diff, 0);
        }, 0) / overdueInvoices.length
      )
    : 0;

  const openOperation = (row) => {
    if (!row.operation_id) return;
    const path =
      String(row.operation_type || '').toLowerCase() === 'service'
        ? `/service/cases/${row.operation_id}?tab=administracion`
        : `/operations/${row.operation_id}?tab=administracion`;
    window.open(path, '_blank', 'noopener,noreferrer');
  };

  const openPaymentOrderPdf = async (row) => {
    if (!row.payment_order_id || !row.operation_id) return;
    try {
      const { data } = await api.get(
        `/operations/${row.operation_id}/payment-orders/${row.payment_order_id}/pdf`,
        {
          params: { operation_type: row.operation_type || 'deal' },
          responseType: 'blob',
        }
      );
      const file = new Blob([data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(file);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (error) {
      console.error('accounts payable payment-order pdf error', error);
      alert('No se pudo abrir el PDF de la orden de pago.');
    }
  };

  const openPurchaseOrder = (row) => {
    if (!row.purchase_order_id) return;
    window.open(`/purchase-orders/${row.purchase_order_id}`, '_blank', 'noopener,noreferrer');
  };

  const exportVendorDetail = async () => {
    try {
      const res = await api.get('/accounts-payable/vendor-detail/export', {
        params: {
          supplier_key: supplierKey,
          currency_code: currencyCode,
        },
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'estado-cuenta-proveedor.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('accounts payable vendor export error', error);
      alert('No se pudo exportar el estado de cuenta.');
    }
  };

  const exportVendorDetailPdf = async () => {
    try {
      const res = await api.get('/accounts-payable/vendor-detail/pdf', {
        params: {
          supplier_key: supplierKey,
          currency_code: currencyCode,
        },
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (error) {
      console.error('accounts payable vendor pdf error', error);
      alert('No se pudo generar el PDF del estado de cuenta.');
    }
  };

  const openPurchaseInvoice = (row) => {
    if (!row.invoice_id || row.module_key !== 'admin-purchases') return;
    window.open(`/purchase-invoices/${row.invoice_id}`, '_blank', 'noopener,noreferrer');
  };

  const canRegisterPayment = (row) => {
    if (row?.movement_kind !== 'factura') return false;
    if (Number(row?.document_balance || 0) <= 0.009) return false;
    const status = String(row?.movement_status || '').toLowerCase();
    if (status.includes('pagad') || status.includes('anulad')) return false;
    if (row?.module_key === 'admin-purchases' || row?.module_key === 'admin-expenses') return true;
    return (
      row?.payment_order_id &&
      ['aprobada', 'pago_parcial'].includes(String(row?.payment_order_status || '').toLowerCase())
    );
  };

  const canGeneratePaymentOrder = (row) =>
    row?.movement_kind === 'factura' &&
    row?.module_key !== 'admin-purchases' &&
    row?.module_key !== 'admin-expenses' &&
    String(row?.condition_type || '').toUpperCase() === 'CREDITO' &&
    Number(row?.document_balance || 0) > 0.009 &&
    !row?.payment_order_id;

  const getPaymentGateMessage = (row) => {
    if (row?.movement_kind !== 'factura') return null;
    if (row?.module_key === 'admin-purchases' || row?.module_key === 'admin-expenses') return null;
    if (String(row?.condition_type || '').toUpperCase() !== 'CREDITO') return null;
    const poStatus = String(row?.payment_order_status || '').toLowerCase();
    if (!row?.payment_order_id) return 'Sin OP';
    if (poStatus === 'pendiente') return 'OP en aprobacion';
    if (poStatus === 'aprobada') return 'OP aprobada';
    if (poStatus === 'pago_parcial') return 'OP con pago parcial';
    if (poStatus === 'pagada') return 'OP pagada';
    if (poStatus === 'anulada') return 'OP anulada';
    return null;
  };

  const openRegisterPayment = (row) => {
    setPaymentRow(row);
    setPaymentForm({
      payment_date: new Date().toISOString().slice(0, 10),
      amount: String(Number(row?.document_balance || 0)),
      method: '',
      account: '',
      reference_number: '',
      notes: '',
    });
    setPaymentModalOpen(true);
  };

  const savePayment = async () => {
    if (!paymentRow) return;
    const amount = Number(paymentForm.amount || 0);
    if (!amount || amount <= 0) return alert('Monto invalido');
    if (!paymentForm.method) return alert('Metodo de pago es requerido');
    try {
      if (paymentRow.module_key === 'admin-purchases') {
        await api.post(`/purchase-invoices/${paymentRow.invoice_id}/payments`, {
          payment_date: paymentForm.payment_date || null,
          amount,
          payment_method: paymentForm.method || null,
          reference_number: paymentForm.reference_number || null,
          notes: paymentForm.notes || null,
        });
      } else if (paymentRow.module_key === 'admin-expenses') {
        await api.post(`/admin-expenses/${paymentRow.expense_id}/payments`, {
          payment_date: paymentForm.payment_date || null,
          method: paymentForm.method || null,
          account: paymentForm.account || null,
          reference_number: paymentForm.reference_number || null,
          amount,
          currency_code: supplier.currency_code || currencyCode || 'PYG',
          status: 'confirmado',
        });
      } else {
        await api.post(
          `/operations/${paymentRow.operation_id}/expense-invoices/${paymentRow.invoice_id}/payments`,
          {
            payment_date: paymentForm.payment_date || null,
            amount,
            method: paymentForm.method || null,
            account: paymentForm.account || null,
            reference_number: paymentForm.reference_number || null,
            notes: paymentForm.notes || null,
          },
          { params: { op_type: paymentRow.operation_type || 'deal' } }
        );
      }
      setPaymentModalOpen(false);
      setPaymentRow(null);
      await loadDetail();
      await onDataChanged?.();
    } catch (error) {
      console.error('accounts payable register payment error', error);
      alert(error?.response?.data?.error || 'No se pudo registrar el pago.');
    }
  };

  const openGenerateOrder = (row) => {
    setOrderRow(row);
    setOrderForm({
      payment_method: '',
      payment_date: row?.due_date ? String(row.due_date).slice(0, 10) : '',
      amount: String(Number(row?.document_balance || 0)),
      description: row?.description || '',
      observations: '',
    });
    setOrderModalOpen(true);
  };

  const savePaymentOrder = async () => {
    if (!orderRow?.operation_id || !orderRow?.invoice_id) return;
    const amount = Number(orderForm.amount || 0);
    if (!amount || amount <= 0) return alert('Monto invalido');
    try {
      await api.post(
        `/operations/${orderRow.operation_id}/expense-invoices/${orderRow.invoice_id}/payment-orders`,
        {
          payment_method: orderForm.payment_method || null,
          payment_date: orderForm.payment_date || null,
          observations: orderForm.observations || null,
          amount,
          description: orderForm.description || null,
        },
        { params: { operation_type: orderRow.operation_type || 'deal' } }
      );
      setOrderModalOpen(false);
      setOrderRow(null);
      await loadDetail();
      await onDataChanged?.();
    } catch (error) {
      console.error('accounts payable create payment order error', error);
      alert(error?.response?.data?.error || 'No se pudo generar la orden de pago.');
    }
  };

  return (
    <div className="fixed inset-0 z-[120]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-[1080px] bg-white shadow-xl overflow-y-auto">
        <div className="sticky top-0 z-10 border-b bg-white px-6 py-4 flex items-start justify-between gap-4">
          <div>
            <div className="text-xs text-slate-500">Estado de cuenta proveedor</div>
            <h2 className="text-xl font-semibold text-slate-800">{supplier.supplier_name || 'Proveedor'}</h2>
            <div className="text-sm text-slate-500 mt-1">
              {supplier.supplier_ruc || '-'} · {supplier.currency_code || currencyCode}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-2 text-sm border rounded-lg" onClick={exportVendorDetailPdf}>
              Exportar PDF
            </button>
            <button className="px-3 py-2 text-sm border rounded-lg" onClick={exportVendorDetail}>
              Exportar Excel
            </button>
            <button className="px-3 py-2 text-sm border rounded-lg" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
            <SummaryBox label="Facturado" value={fmtMoney(summary.total_debit, supplier.currency_code || currencyCode)} />
            <SummaryBox label="Pagado" value={fmtMoney(summary.total_credit, supplier.currency_code || currencyCode)} tone="emerald" />
            <SummaryBox label="Saldo final" value={fmtMoney(summary.final_balance, supplier.currency_code || currencyCode)} tone="blue" />
            <SummaryBox label="Facturas" value={summary.invoice_count || 0} />
            <SummaryBox label="Pagos" value={summary.payment_count || 0} tone="amber" />
            <SummaryBox
              label="Facturas vencidas"
              value={summary.overdue_documents || 0}
              tone={Number(summary.overdue_documents || 0) > 0 ? 'amber' : 'slate'}
            />
            <SummaryBox
              label="Ultimo pago"
              value={
                lastPayment
                  ? `${fmtDate(lastPayment.movement_date)} · ${fmtMoney(lastPayment.credit_amount, supplier.currency_code || currencyCode)}`
                  : '-'
              }
              tone="emerald"
            />
            <SummaryBox
              label="Ultima factura"
              value={
                lastInvoice
                  ? `${fmtDate(lastInvoice.movement_date)} · ${fmtMoney(lastInvoice.debit_amount, supplier.currency_code || currencyCode)}`
                  : '-'
              }
            />
            <SummaryBox
              label="Mora promedio"
              value={averageOverdueDays > 0 ? `${averageOverdueDays} dias` : '-'}
              tone={averageOverdueDays > 0 ? 'amber' : 'slate'}
            />
          </div>

          <div className="bg-white border rounded-2xl p-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <input
                type="date"
                className="border rounded-lg px-3 py-2"
                value={filters.from_date}
                onChange={(e) => setFilters((prev) => ({ ...prev, from_date: e.target.value }))}
              />
              <input
                type="date"
                className="border rounded-lg px-3 py-2"
                value={filters.to_date}
                onChange={(e) => setFilters((prev) => ({ ...prev, to_date: e.target.value }))}
              />
              <select
                className="border rounded-lg px-3 py-2"
                value={filters.movement_kind}
                onChange={(e) => setFilters((prev) => ({ ...prev, movement_kind: e.target.value }))}
              >
                <option value="all">Todos los movimientos</option>
                <option value="factura">Facturas</option>
                <option value="payment">Pagos</option>
                <option value="payment_order">Órdenes de pago</option>
              </select>
              <input
                className="border rounded-lg px-3 py-2"
                placeholder="Filtrar por referencia"
                value={filters.reference_q}
                onChange={(e) => setFilters((prev) => ({ ...prev, reference_q: e.target.value }))}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { key: 'all', label: 'Todo', apply: () => ({ movement_kind: 'all', only_overdue: false }) },
                { key: 'factura', label: 'Facturas', apply: () => ({ movement_kind: 'factura', only_overdue: false }) },
                { key: 'payment', label: 'Pagos', apply: () => ({ movement_kind: 'payment', only_overdue: false }) },
                { key: 'payment_order', label: 'OP', apply: () => ({ movement_kind: 'payment_order', only_overdue: false }) },
                { key: 'overdue', label: 'Solo vencidos', apply: () => ({ movement_kind: 'factura', only_overdue: true }) },
              ].map((item) => {
                const active =
                  (item.key === 'all' && filters.movement_kind === 'all' && !filters.only_overdue) ||
                  (item.key === 'factura' && filters.movement_kind === 'factura' && !filters.only_overdue) ||
                  (item.key === 'payment' && filters.movement_kind === 'payment' && !filters.only_overdue) ||
                  (item.key === 'payment_order' && filters.movement_kind === 'payment_order' && !filters.only_overdue) ||
                  (item.key === 'overdue' && filters.movement_kind === 'factura' && filters.only_overdue);
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setFilters((prev) => ({ ...prev, ...item.apply() }))}
                    className={`px-3 py-1.5 text-sm rounded-full border transition ${
                      active
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-white border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b bg-slate-50 font-medium">Movimientos</div>
            {loading ? (
              <div className="p-4 text-sm text-slate-500">Cargando movimientos...</div>
            ) : rows.length === 0 ? (
              <div className="p-4 text-sm text-slate-500">No hay movimientos para este proveedor.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-white">
                    <tr className="border-b">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Fecha</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Tipo</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Módulo</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Operación</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Documento</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Descripción</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Debe</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Haber</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Saldo</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Estado</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr
                        key={`${row.module_key || 'mod'}-${row.movement_kind}-${row.source_id || 'src'}-${row.sort_order || 'ord'}-${row.invoice_id || row.expense_id || row.payment_order_id || row.purchase_order_id || 'doc'}-${index}`}
                        className="border-b last:border-b-0"
                      >
                        <td className="px-4 py-3">{fmtDate(row.movement_date)}</td>
                        <td className="px-4 py-3">{row.movement_type}</td>
                        <td className="px-4 py-3">{row.module_name || '-'}</td>
                        <td className="px-4 py-3">{row.operation_reference || '-'}</td>
                        <td className="px-4 py-3 font-medium">{row.document_number || '-'}</td>
                        <td className="px-4 py-3">{row.description || '-'}</td>
                        <td className="px-4 py-3">{Number(row.debit_amount || 0) > 0 ? fmtMoney(row.debit_amount, supplier.currency_code || currencyCode) : '-'}</td>
                        <td className="px-4 py-3">{Number(row.credit_amount || 0) > 0 ? fmtMoney(row.credit_amount, supplier.currency_code || currencyCode) : '-'}</td>
                        <td className="px-4 py-3 font-medium">{fmtMoney(row.running_balance, supplier.currency_code || currencyCode)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <StatusChip {...getRowStatusMeta(row)} />
                            {getPaymentOrderMeta(row) ? <StatusChip {...getPaymentOrderMeta(row)} /> : null}
                            {row.movement_kind === 'factura' && row.due_date ? (
                              <StatusChip
                                label={`Vence ${fmtDate(row.due_date)}`}
                                tone={new Date(row.due_date) < new Date() ? 'red' : 'slate'}
                              />
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            {row.operation_id && (
                              <button
                                type="button"
                                className="px-2.5 py-1.5 text-xs rounded-lg border hover:bg-slate-50"
                                onClick={() => openOperation(row)}
                              >
                                Operación
                              </button>
                            )}
                            {getPaymentGateMessage(row) && !canGeneratePaymentOrder(row) && !canRegisterPayment(row) && (
                              <span className="inline-flex rounded-lg px-2.5 py-1.5 text-xs font-medium bg-slate-100 text-slate-700">
                                {getPaymentGateMessage(row)}
                              </span>
                            )}
                            {canRegisterPayment(row) && (
                              <button
                                type="button"
                                className="px-2.5 py-1.5 text-xs rounded-lg border text-emerald-700 hover:bg-emerald-50"
                                onClick={() => openRegisterPayment(row)}
                              >
                                Registrar pago
                              </button>
                            )}
                            {canGeneratePaymentOrder(row) && (
                              <button
                                type="button"
                                className="px-2.5 py-1.5 text-xs rounded-lg border text-blue-700 hover:bg-blue-50"
                                onClick={() => openGenerateOrder(row)}
                              >
                                Generar OP
                              </button>
                            )}
                            {row.payment_order_id && (
                              <button
                                type="button"
                                className="px-2.5 py-1.5 text-xs rounded-lg border hover:bg-slate-50"
                                onClick={() => openPaymentOrderPdf(row)}
                                title={row.payment_order_number || 'Orden de pago'}
                              >
                                {row.payment_order_number ? `OP ${row.payment_order_number}` : 'Ver OP'}
                              </button>
                            )}
                            {row.purchase_order_id && (
                              <button
                                type="button"
                                className="px-2.5 py-1.5 text-xs rounded-lg border hover:bg-slate-50"
                                onClick={() => openPurchaseOrder(row)}
                              >
                                Ver OC
                              </button>
                            )}
                            {row.invoice_id && row.module_key === 'admin-purchases' && (
                              <button
                                type="button"
                                className="px-2.5 py-1.5 text-xs rounded-lg border hover:bg-slate-50"
                                onClick={() => openPurchaseInvoice(row)}
                              >
                                Ver factura
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {paymentModalOpen && (
          <div className="absolute inset-0 z-[130] flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">Registrar pago</h3>
                <button className="text-sm underline" onClick={() => setPaymentModalOpen(false)}>Cerrar</button>
              </div>
              <div className="mb-3 text-xs text-slate-500">
                {paymentRow?.document_number || '-'} · Saldo {fmtMoney(paymentRow?.document_balance, supplier.currency_code || currencyCode)}
              </div>
              <div className="grid grid-cols-1 gap-3">
                <input type="date" className="border rounded px-3 py-2" value={paymentForm.payment_date} onChange={(e) => setPaymentForm((f) => ({ ...f, payment_date: e.target.value }))} />
                <input type="number" min="0" step="0.01" className="border rounded px-3 py-2" placeholder="Monto" value={paymentForm.amount} onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))} />
                <select className="border rounded px-3 py-2" value={paymentForm.method} onChange={(e) => setPaymentForm((f) => ({ ...f, method: e.target.value }))}>
                  <option value="">Metodo</option>
                  {PAYMENT_METHODS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <input className="border rounded px-3 py-2" placeholder="Cuenta" value={paymentForm.account} onChange={(e) => setPaymentForm((f) => ({ ...f, account: e.target.value }))} />
                <input className="border rounded px-3 py-2" placeholder="Referencia" value={paymentForm.reference_number} onChange={(e) => setPaymentForm((f) => ({ ...f, reference_number: e.target.value }))} />
                <textarea className="border rounded px-3 py-2 min-h-[84px]" placeholder="Notas" value={paymentForm.notes} onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button className="rounded border px-4 py-2 text-sm" onClick={() => setPaymentModalOpen(false)}>Cancelar</button>
                <button className="rounded bg-black px-4 py-2 text-sm text-white" onClick={savePayment}>Guardar pago</button>
              </div>
            </div>
          </div>
        )}

        {orderModalOpen && (
          <div className="absolute inset-0 z-[130] flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">Generar orden de pago</h3>
                <button className="text-sm underline" onClick={() => setOrderModalOpen(false)}>Cerrar</button>
              </div>
              <div className="mb-3 text-xs text-slate-500">
                {orderRow?.document_number || '-'} · Saldo {fmtMoney(orderRow?.document_balance, supplier.currency_code || currencyCode)}
              </div>
              <div className="grid grid-cols-1 gap-3">
                <select className="border rounded px-3 py-2" value={orderForm.payment_method} onChange={(e) => setOrderForm((f) => ({ ...f, payment_method: e.target.value }))}>
                  <option value="">Forma de pago</option>
                  {PAYMENT_METHODS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <input type="date" className="border rounded px-3 py-2" value={orderForm.payment_date} onChange={(e) => setOrderForm((f) => ({ ...f, payment_date: e.target.value }))} />
                <input type="number" min="0" step="0.01" className="border rounded px-3 py-2" placeholder="Monto" value={orderForm.amount} onChange={(e) => setOrderForm((f) => ({ ...f, amount: e.target.value }))} />
                <input className="border rounded px-3 py-2" placeholder="Descripcion" value={orderForm.description} onChange={(e) => setOrderForm((f) => ({ ...f, description: e.target.value }))} />
                <textarea className="border rounded px-3 py-2 min-h-[84px]" placeholder="Observaciones" value={orderForm.observations} onChange={(e) => setOrderForm((f) => ({ ...f, observations: e.target.value }))} />
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button className="rounded border px-4 py-2 text-sm" onClick={() => setOrderModalOpen(false)}>Cancelar</button>
                <button className="rounded bg-black px-4 py-2 text-sm text-white" onClick={savePaymentOrder}>Generar</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
