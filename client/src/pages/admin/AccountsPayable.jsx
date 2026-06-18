import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import {
  companyBankAccountLabel,
  companyBankAccountValue,
  filterCompanyBankAccounts,
  parseCompanyBankAccounts,
} from '../../utils/companyBankAccounts';
import AccountsPayableVendorDrawer from './AccountsPayableVendorDrawer.jsx';

const PAYMENT_METHODS = ['Transferencia', 'Efectivo', 'Cheque', 'Tarjeta', 'Otro'];

const STATUS_TABS = [
  { value: 'por_pagar', label: 'Por pagar' },
  { value: 'vencido', label: 'Vencidos' },
  { value: 'vence_hoy', label: 'Vence hoy' },
  { value: 'due_7d', label: 'Proximos 7 dias', quick: 'due_7d' },
  { value: 'sin_op', label: 'Sin OP' },
  { value: 'op_pendiente', label: 'OP pendiente' },
  { value: 'listo_pago', label: 'Listo para pagar' },
  { value: 'programado', label: 'Programados' },
  { value: 'pagado', label: 'Pagado' },
];

const STATUS_META = {
  vencido: { label: 'Vencido', tone: 'red' },
  vence_hoy: { label: 'Vence hoy', tone: 'amber' },
  sin_op: { label: 'Sin OP', tone: 'amber' },
  op_pendiente: { label: 'OP pendiente', tone: 'amber' },
  listo_pago: { label: 'Listo para pagar', tone: 'emerald' },
  programado: { label: 'Programado', tone: 'blue' },
  pago_parcial: { label: 'Pago parcial', tone: 'blue' },
  pagado: { label: 'Pagado', tone: 'emerald' },
  bloqueado: { label: 'Bloqueado', tone: 'red' },
};

const PRIORITY_OPTIONS = [
  { value: 'baja', label: 'Baja' },
  { value: 'normal', label: 'Normal' },
  { value: 'alta', label: 'Alta' },
  { value: 'urgente', label: 'Urgente' },
];

const TREASURY_STATUS_OPTIONS = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'programado', label: 'Programado' },
  { value: 'retenido', label: 'Retenido' },
];

const DOCUMENT_VALIDATION_META = {
  pendiente: { label: 'Pendiente', tone: 'amber' },
  validada: { label: 'Validada', tone: 'emerald' },
  observada: { label: 'Observada', tone: 'red' },
};
const ENABLE_DOCUMENT_VALIDATION = false;

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

function CurrencySummary({ label, values, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-50 text-slate-700',
    blue: 'bg-blue-50 text-blue-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
  };
  const entries = Object.entries(values || {});
  return (
    <div className="border rounded-xl p-3 bg-white">
      <div className="text-xs text-slate-500">{label}</div>
      {entries.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {entries.map(([currency, amount]) => (
            <span
              key={currency}
              className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${tones[tone] || tones.slate}`}
            >
              {fmtMoney(amount, currency)}
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-2 inline-flex rounded-lg px-3 py-1.5 text-sm font-semibold bg-slate-50 text-slate-500">
          Sin datos
        </div>
      )}
    </div>
  );
}

function MetricBox({ label, value, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-50 text-slate-700',
    blue: 'bg-blue-50 text-blue-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
  };
  return (
    <div className="border rounded-xl p-3 bg-white">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-2 inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${tones[tone] || tones.slate}`}>
        {value}
      </div>
    </div>
  );
}

function StatusChip({ label, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    blue: 'bg-blue-100 text-blue-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-700',
    emerald: 'bg-emerald-100 text-emerald-700',
  };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${tones[tone] || tones.slate}`}>
      {label}
    </span>
  );
}

function ReferenceLinks({ value, targets, onOpen }) {
  const references = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const targetMap = new Map();
  String(targets || '')
    .split('||')
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const [operationType, operationId, ...referenceParts] = entry.split('::');
      const reference = referenceParts.join('::').trim();
      if (!reference || !operationId) return;
      targetMap.set(reference, {
        operationType: operationType === 'service' ? 'service' : 'deal',
        operationId,
        reference,
      });
    });

  const items = references.map((reference) => targetMap.get(reference) || { reference });
  if (!items.length) return <span>-</span>;

  return (
    <div className="max-w-[280px] truncate text-xs text-slate-600" title={items.map((item) => item.reference).join(', ')}>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <button
            key={`${item.operationType || 'ref'}-${item.operationId || 'na'}-${item.reference}`}
            type="button"
            className="text-blue-600 hover:underline"
            onClick={() => onOpen(item)}
            title={item.reference}
          >
            {item.reference}
          </button>
        ))}
      </div>
    </div>
  );
}

function supplierBankLabel(row) {
  return [row?.supplier_bank_name, row?.supplier_bank_account, row?.supplier_bank_currency]
    .filter(Boolean)
    .join(' - ');
}

function sourceTypeLabel(sourceType) {
  const labels = {
    'operation-expense': 'Compra operativa',
    'purchase-invoice': 'Compra administrativa',
    'admin-expense': 'Gasto administrativo',
  };
  return labels[String(sourceType || '').toLowerCase()] || '-';
}

function canGeneratePaymentOrder(row) {
  return (
    row?.source_type === 'operation-expense' &&
    String(row?.condition_type || '').toUpperCase() === 'CREDITO' &&
    Number(row?.balance || 0) > 0.009 &&
    !row?.payment_order_id
  );
}

function canRegisterPayment(row) {
  if (Number(row?.balance || 0) <= 0.009) return false;
  if (row?.payable_status === 'bloqueado') return false;
  if (row?.source_type === 'operation-expense') {
    const condition = String(row?.condition_type || '').toUpperCase();
    if (condition === 'CREDITO') {
      return ['aprobada', 'pago_parcial'].includes(String(row?.payment_order_status || '').toLowerCase());
    }
    return true;
  }
  return row?.source_type === 'purchase-invoice' || row?.source_type === 'admin-expense';
}

function documentSourceId(row) {
  return row?.invoice_id || row?.expense_id || null;
}

export default function AccountsPayable() {
  const [loading, setLoading] = useState(true);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [totals, setTotals] = useState({
    suppliers: 0,
    rows: 0,
    open_documents: 0,
    invoiced_by_currency: {},
    paid_by_currency: {},
    balance_by_currency: {},
    overdue_by_currency: {},
  });
  const [dashboard, setDashboard] = useState({
    document_count: 0,
    overdue_count: 0,
    due_today_count: 0,
    upcoming_7d_count: 0,
    due_this_month_count: 0,
    aging_by_currency: {},
    debt_by_module: [],
    upcoming_due: [],
  });
  const [documentsDashboard, setDocumentsDashboard] = useState({
    total_documents: 0,
    open_documents: 0,
    ready_to_pay: 0,
    blocked_documents: 0,
    scheduled_documents: 0,
    missing_supplier_bank: 0,
    by_status: {},
    balance_by_currency: {},
    overdue_by_currency: {},
    aging_by_currency: {},
  });
  const [filters, setFilters] = useState({
    supplier_q: '',
    currency_code: '',
    module_key: 'all',
    source_type: 'all',
    status_tab: 'por_pagar',
    quick_filter: '',
    open_only: false,
    overdue: false,
  });
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [actionsMenu, setActionsMenu] = useState(null);
  const [paymentRow, setPaymentRow] = useState(null);
  const [paymentForm, setPaymentForm] = useState({
    payment_date: '',
    amount: '',
    method: '',
    account: '',
    reference_number: '',
    receipt_file: null,
    mark_reconciled: false,
    reconciled_at: '',
    reconciliation_notes: '',
    notes: '',
  });
  const [orderRow, setOrderRow] = useState(null);
  const [orderForm, setOrderForm] = useState({
    payment_method: '',
    payment_date: '',
    amount: '',
    description: '',
    observations: '',
  });
  const [scheduleRow, setScheduleRow] = useState(null);
  const [scheduleForm, setScheduleForm] = useState({
    scheduled_payment_date: '',
    priority: 'normal',
    treasury_status: 'programado',
    planned_company_account: '',
    treasury_notes: '',
  });
  const [paymentsRow, setPaymentsRow] = useState(null);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [payments, setPayments] = useState([]);
  const [paymentReceiptFiles, setPaymentReceiptFiles] = useState({});
  const [reconciliationDrafts, setReconciliationDrafts] = useState({});
  const [documentRow, setDocumentRow] = useState(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentAttachments, setDocumentAttachments] = useState([]);
  const [documentFile, setDocumentFile] = useState(null);
  const [documentValidationForm, setDocumentValidationForm] = useState({
    validation_status: 'pendiente',
    validation_notes: '',
  });
  const [companyAccounts, setCompanyAccounts] = useState([]);
  const actionMenuRef = useRef(null);

  const activeTab = STATUS_TABS.find((tab) => tab.value === filters.status_tab) || STATUS_TABS[0];

  const requestParams = useMemo(() => ({
    supplier_q: filters.supplier_q || undefined,
    currency_code: filters.currency_code || undefined,
    module_key: filters.module_key || 'all',
    source_type: filters.source_type || 'all',
    status: activeTab.quick ? undefined : filters.status_tab,
    quick_filter: activeTab.quick || filters.quick_filter || undefined,
    open_only: filters.open_only ? 1 : undefined,
    overdue: filters.overdue ? 1 : undefined,
  }), [activeTab.quick, filters]);

  function openVendorDrawer(row, movementKind = 'all') {
    setSelectedVendor({
      supplier_key: row.supplier_key,
      currency_code: row.currency_code,
      supplier_name: row.supplier_name,
      reference: row.operation_reference || '',
      movement_kind: movementKind,
    });
  }

  function openReference(item) {
    const operationId = Number(item?.operationId || 0);
    if (!operationId) return;
    const href =
      item?.operationType === 'service'
        ? `/service/cases/${operationId}?tab=administracion`
        : `/operations/${operationId}?tab=administracion`;
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  function openOperation(row) {
    const operationId = Number(row?.operation_id || 0);
    if (!operationId) return;
    const href =
      row?.operation_type === 'service'
        ? `/service/cases/${operationId}?tab=administracion`
        : `/operations/${operationId}?tab=administracion`;
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  function openInvoice(row) {
    if (row?.source_type === 'purchase-invoice' && row.invoice_id) {
      window.open(`/purchase-invoices/${row.invoice_id}`, '_blank', 'noopener,noreferrer');
    } else if (row?.operation_id) {
      openOperation(row);
    }
  }

  function openProvider(row) {
    if (!row?.supplier_id) return;
    window.open(`/organizations/${row.supplier_id}`, '_blank', 'noopener,noreferrer');
  }

  async function openPaymentOrderPdf(row) {
    if (!row?.payment_order_id || !row?.operation_id) return;
    try {
      const { data } = await api.get(
        `/operations/${row.operation_id}/payment-orders/${row.payment_order_id}/pdf`,
        {
          params: { operation_type: row.operation_type || 'deal' },
          responseType: 'blob',
        }
      );
      const file = new Blob([data], { type: 'application/pdf' });
      const url = URL.createObjectURL(file);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      console.error('accounts payable payment-order pdf error', error);
      alert('No se pudo abrir la orden de pago.');
    }
  }

  const moduleOptions = useMemo(() => [
    { value: 'all', label: 'Todos los modulos' },
    { value: 'atm-cargo', label: 'ATM CARGO' },
    { value: 'atm-industrial', label: 'ATM INDUSTRIAL' },
    { value: 'atm-container', label: 'ATM CONTAINER' },
    { value: 'services', label: 'Servicios y mantenimiento' },
    { value: 'admin-purchases', label: 'Compras administrativas' },
    { value: 'admin-expenses', label: 'Gastos administrativos' },
  ], []);

  const sourceOptions = useMemo(() => [
    { value: 'all', label: 'Todas las fuentes' },
    { value: 'operation-expense', label: 'Compras operativas' },
    { value: 'purchase-invoice', label: 'Compras administrativas' },
    { value: 'admin-expense', label: 'Gastos administrativos' },
  ], []);

  async function loadSummary() {
    setLoading(true);
    try {
      const { data } = await api.get('/accounts-payable/summary', { params: requestParams });
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setTotals(data?.totals || {});
      setDashboard(data?.dashboard || {});
    } catch (error) {
      console.error('accounts payable summary error', error);
      setRows([]);
      setTotals({});
      setDashboard({});
    } finally {
      setLoading(false);
    }
  }

  async function loadDocuments() {
    setDocumentsLoading(true);
    try {
      const { data } = await api.get('/accounts-payable/documents', { params: requestParams });
      setDocuments(Array.isArray(data?.rows) ? data.rows : []);
      setDocumentsDashboard(data?.dashboard || {});
    } catch (error) {
      console.error('accounts payable documents error', error);
      setDocuments([]);
      setDocumentsDashboard({});
    } finally {
      setDocumentsLoading(false);
    }
  }

  async function loadCompanyAccounts() {
    try {
      const { data } = await api.get('/params', { params: { keys: 'company_bank_account', only_active: 1 } });
      setCompanyAccounts(parseCompanyBankAccounts(data?.company_bank_account || []));
    } catch {
      setCompanyAccounts([]);
    }
  }

  async function reloadAll() {
    await Promise.all([loadSummary(), loadDocuments()]);
  }

  async function exportSummary() {
    try {
      const res = await api.get('/accounts-payable/summary/export', {
        params: requestParams,
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cuentas-a-pagar.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('accounts payable export error', error);
      alert('No se pudo exportar el resumen.');
    }
  }

  async function exportPaymentPlan() {
    try {
      const res = await api.get('/accounts-payable/documents/export', {
        params: requestParams,
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'planilla-de-pagos.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('accounts payable payment plan export error', error);
      alert('No se pudo exportar la planilla de pagos.');
    }
  }

  async function exportSummaryPdf() {
    try {
      const res = await api.get('/accounts-payable/summary/pdf', {
        params: requestParams,
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (error) {
      console.error('accounts payable pdf error', error);
      alert('No se pudo generar el PDF del resumen.');
    }
  }

  function openRegisterPayment(row) {
    setActionsMenu(null);
    setPaymentRow(row);
    setPaymentForm({
      payment_date: new Date().toISOString().slice(0, 10),
      amount: String(Number(row?.balance || 0)),
      method: '',
      account: '',
      reference_number: '',
      receipt_file: null,
      mark_reconciled: false,
      reconciled_at: new Date().toISOString().slice(0, 10),
      reconciliation_notes: '',
      notes: '',
    });
  }

  function openGenerateOrder(row) {
    setActionsMenu(null);
    setOrderRow(row);
    setOrderForm({
      payment_method: '',
      payment_date: row?.due_date ? String(row.due_date).slice(0, 10) : '',
      amount: String(Number(row?.balance || 0)),
      description: row?.document_number ? `Factura ${row.document_number}` : '',
      observations: '',
    });
  }

  function openSchedulePayment(row) {
    setActionsMenu(null);
    setScheduleRow(row);
    setScheduleForm({
      scheduled_payment_date: row?.scheduled_payment_date ? String(row.scheduled_payment_date).slice(0, 10) : '',
      priority: row?.priority || 'normal',
      treasury_status: row?.treasury_status || 'programado',
      planned_company_account: row?.planned_company_account || '',
      treasury_notes: row?.treasury_notes || '',
    });
  }

  async function savePayment() {
    if (!paymentRow) return;
    const amount = Number(paymentForm.amount || 0);
    if (!amount || amount <= 0) return alert('Monto invalido');
    if (amount > Number(paymentRow.balance || 0) + 0.01) return alert('El pago supera el saldo pendiente');
    if (!paymentForm.method) return alert('Metodo de pago es requerido');
    if (!paymentForm.account) return alert('La cuenta origen de empresa es requerida');
    if (String(paymentForm.method || '').toLowerCase() === 'transferencia' && !paymentForm.reference_number) {
      return alert('La referencia bancaria es requerida para transferencias');
    }
    try {
      let paymentId = null;
      if (paymentRow.source_type === 'purchase-invoice') {
        const { data } = await api.post(`/purchase-invoices/${paymentRow.invoice_id}/payments`, {
          payment_date: paymentForm.payment_date || null,
          amount,
          payment_method: paymentForm.method || null,
          account: paymentForm.account || null,
          reference_number: paymentForm.reference_number || null,
          notes: paymentForm.notes || null,
        });
        paymentId = data?.payment_id || data?.id || null;
      } else if (paymentRow.source_type === 'admin-expense') {
        const { data } = await api.post(`/admin-expenses/${paymentRow.expense_id}/payments`, {
          payment_date: paymentForm.payment_date || null,
          method: paymentForm.method || null,
          account: paymentForm.account || null,
          reference_number: paymentForm.reference_number || null,
          amount,
          currency_code: paymentRow.currency_code || 'PYG',
          status: 'confirmado',
        });
        paymentId = data?.id || null;
      } else {
        const { data } = await api.post(
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
        paymentId = data?.id || null;
      }
      if (paymentId && paymentForm.receipt_file) {
        const formData = new FormData();
        formData.append('file', paymentForm.receipt_file);
        await api.post(`/accounts-payable/payments/${paymentRow.source_type}/${paymentId}/receipt`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      if (paymentId && paymentForm.mark_reconciled) {
        await api.patch(`/accounts-payable/payments/${paymentRow.source_type}/${paymentId}/reconciliation`, {
          reconciled: true,
          reconciled_at: paymentForm.reconciled_at || null,
          reconciliation_notes: paymentForm.reconciliation_notes || null,
        });
      }
      setPaymentRow(null);
      await reloadAll();
    } catch (error) {
      console.error('accounts payable register payment error', error);
      alert(error?.response?.data?.error || 'No se pudo registrar el pago.');
    }
  }

  async function openDocumentValidation(row) {
    setActionsMenu(null);
    setDocumentRow(row);
    setDocumentAttachments([]);
    setDocumentFile(null);
    setDocumentValidationForm({
      validation_status: row?.validation_status || 'pendiente',
      validation_notes: row?.validation_notes || '',
    });
    setDocumentLoading(true);
    try {
      const { data } = await api.get(`/accounts-payable/documents/${row.source_type}/${documentSourceId(row)}/attachments`);
      setDocumentAttachments(Array.isArray(data?.rows) ? data.rows : []);
    } catch (error) {
      console.error('accounts payable document attachments error', error);
      setDocumentAttachments([]);
    } finally {
      setDocumentLoading(false);
    }
  }

  async function uploadDocumentAttachment() {
    if (!documentRow || !documentFile) return alert('Selecciona un archivo.');
    try {
      const formData = new FormData();
      formData.append('file', documentFile);
      await api.post(`/accounts-payable/documents/${documentRow.source_type}/${documentSourceId(documentRow)}/attachments`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setDocumentFile(null);
      await openDocumentValidation(documentRow);
      await reloadAll();
    } catch (error) {
      console.error('accounts payable document upload error', error);
      alert(error?.response?.data?.error || 'No se pudo cargar el adjunto.');
    }
  }

  async function saveDocumentValidation(statusOverride) {
    if (!documentRow) return;
    const nextStatus = statusOverride || documentValidationForm.validation_status || 'pendiente';
    if (nextStatus === 'observada' && !documentValidationForm.validation_notes.trim()) {
      return alert('La observacion es requerida para observar un documento.');
    }
    try {
      await api.patch('/accounts-payable/documents/validation', {
        source_type: documentRow.source_type,
        source_id: documentSourceId(documentRow),
        validation_status: nextStatus,
        validation_notes: documentValidationForm.validation_notes || null,
      });
      setDocumentRow(null);
      await reloadAll();
    } catch (error) {
      console.error('accounts payable document validation error', error);
      alert(error?.response?.data?.error || 'No se pudo actualizar la validacion documental.');
    }
  }

  async function savePaymentOrder() {
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
      setOrderRow(null);
      await reloadAll();
    } catch (error) {
      console.error('accounts payable create payment order error', error);
      alert(error?.response?.data?.error || 'No se pudo generar la orden de pago.');
    }
  }

  async function saveSchedulePayment() {
    if (!scheduleRow) return;
    const sourceId = scheduleRow.invoice_id || scheduleRow.expense_id;
    if (!sourceId) return alert('No se pudo identificar el documento');
    if (scheduleForm.treasury_status === 'programado' && !scheduleForm.scheduled_payment_date) {
      return alert('La fecha programada es requerida');
    }
    try {
      await api.patch('/accounts-payable/documents/meta', {
        source_type: scheduleRow.source_type,
        source_id: sourceId,
        scheduled_payment_date: scheduleForm.scheduled_payment_date || null,
        priority: scheduleForm.priority || 'normal',
        treasury_status: scheduleForm.treasury_status || 'pendiente',
        planned_company_account: scheduleForm.planned_company_account || null,
        treasury_notes: scheduleForm.treasury_notes || null,
      });
      setScheduleRow(null);
      await reloadAll();
    } catch (error) {
      console.error('accounts payable schedule payment error', error);
      alert(error?.response?.data?.error || 'No se pudo guardar la programacion.');
    }
  }

  async function openPayments(row) {
    setActionsMenu(null);
    setPaymentsRow(row);
    setPayments([]);
    setPaymentReceiptFiles({});
    setReconciliationDrafts({});
    setPaymentsLoading(true);
    try {
      const { data } = await api.get('/accounts-payable/documents/payments', {
        params: {
          source_type: row.source_type,
          source_id: documentSourceId(row),
        },
      });
      const nextRows = Array.isArray(data?.rows) ? data.rows : [];
      setPayments(nextRows);
      setReconciliationDrafts(Object.fromEntries(nextRows.map((payment) => [
        payment.payment_id,
        {
          reconciled_at: payment.reconciled_at ? String(payment.reconciled_at).slice(0, 10) : new Date().toISOString().slice(0, 10),
          reconciliation_notes: payment.reconciliation_notes || '',
        },
      ])));
    } catch (error) {
      console.error('accounts payable payments load error', error);
      alert(error?.response?.data?.error || 'No se pudieron cargar los pagos.');
    } finally {
      setPaymentsLoading(false);
    }
  }

  async function uploadPaymentReceipt(payment) {
    const file = paymentReceiptFiles[payment.payment_id];
    if (!file) return alert('Selecciona un comprobante.');
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api.post(`/accounts-payable/payments/${payment.source_type}/${payment.payment_id}/receipt`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await openPayments(paymentsRow);
    } catch (error) {
      console.error('accounts payable receipt upload error', error);
      alert(error?.response?.data?.error || 'No se pudo cargar el comprobante.');
    }
  }

  async function toggleReconciliation(payment, reconciled) {
    const draft = reconciliationDrafts[payment.payment_id] || {};
    try {
      await api.patch(`/accounts-payable/payments/${payment.source_type}/${payment.payment_id}/reconciliation`, {
        reconciled,
        reconciled_at: draft.reconciled_at || null,
        reconciliation_notes: draft.reconciliation_notes || null,
      });
      await openPayments(paymentsRow);
    } catch (error) {
      console.error('accounts payable reconciliation error', error);
      alert(error?.response?.data?.error || 'No se pudo actualizar la conciliacion.');
    }
  }

  useEffect(() => {
    reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestParams]);

  useEffect(() => {
    loadCompanyAccounts();
  }, []);

  useEffect(() => {
    const onClick = (event) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(event.target)) {
        setActionsMenu(null);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const sameCurrencyPaymentAccounts = filterCompanyBankAccounts(companyAccounts, paymentRow?.currency_code || 'PYG');
  const fallbackPaymentAccounts = (companyAccounts || []).filter((account) => {
    if (!account?.active) return false;
    return !sameCurrencyPaymentAccounts.some((item) => companyBankAccountValue(item) === companyBankAccountValue(account));
  });
  const paymentAccountOptions = sameCurrencyPaymentAccounts.length ? sameCurrencyPaymentAccounts : fallbackPaymentAccounts;
  const hasCurrentAccount = paymentForm.account && !paymentAccountOptions.some((account) => companyBankAccountValue(account) === paymentForm.account);
  const sameCurrencyScheduleAccounts = filterCompanyBankAccounts(companyAccounts, scheduleRow?.currency_code || 'PYG');
  const fallbackScheduleAccounts = (companyAccounts || []).filter((account) => {
    if (!account?.active) return false;
    return !sameCurrencyScheduleAccounts.some((item) => companyBankAccountValue(item) === companyBankAccountValue(account));
  });
  const scheduleAccountOptions = sameCurrencyScheduleAccounts.length ? sameCurrencyScheduleAccounts : fallbackScheduleAccounts;
  const hasCurrentScheduleAccount =
    scheduleForm.planned_company_account &&
    !scheduleAccountOptions.some((account) => companyBankAccountValue(account) === scheduleForm.planned_company_account);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Cuentas a pagar</h1>
          <p className="text-sm text-slate-500 mt-1">
            Bandeja de pagos por proveedor, vencimiento, OP y estado de cobranza interna.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={exportSummaryPdf} className="px-3 py-2 text-sm rounded-lg border hover:bg-slate-50">
            Exportar PDF
          </button>
          <button type="button" onClick={exportSummary} className="px-3 py-2 text-sm rounded-lg border hover:bg-slate-50">
            Exportar Excel
          </button>
          <button type="button" onClick={exportPaymentPlan} className="px-3 py-2 text-sm rounded-lg bg-black text-white hover:bg-slate-800">
            Planilla de pagos
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => {
            const active = filters.status_tab === tab.value;
            const countKey = tab.quick ? null : tab.value;
            const count =
              tab.value === 'vencido'
                ? dashboard?.overdue_count
                : tab.value === 'vence_hoy'
                  ? dashboard?.due_today_count
                  : countKey
                    ? documentsDashboard?.by_status?.[countKey]
                    : dashboard?.upcoming_7d_count;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setFilters((prev) => ({ ...prev, status_tab: tab.value, quick_filter: '' }))}
                className={`px-3 py-1.5 text-sm rounded-full border transition ${
                  active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {tab.label}
                {Number(count || 0) > 0 ? <span className="ml-1 opacity-75">({count})</span> : null}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
          <input
            className="border rounded-lg px-3 py-2"
            placeholder="Proveedor, RUC, documento u operacion"
            value={filters.supplier_q}
            onChange={(e) => setFilters((prev) => ({ ...prev, supplier_q: e.target.value }))}
          />
          <select
            className="border rounded-lg px-3 py-2"
            value={filters.module_key}
            onChange={(e) => setFilters((prev) => ({ ...prev, module_key: e.target.value }))}
          >
            {moduleOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            className="border rounded-lg px-3 py-2"
            value={filters.source_type}
            onChange={(e) => setFilters((prev) => ({ ...prev, source_type: e.target.value }))}
          >
            {sourceOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            className="border rounded-lg px-3 py-2"
            value={filters.currency_code}
            onChange={(e) => setFilters((prev) => ({ ...prev, currency_code: e.target.value }))}
          >
            <option value="">Todas las monedas</option>
            <option value="PYG">PYG</option>
            <option value="USD">USD</option>
            <option value="BRL">BRL</option>
          </select>
          <label className="inline-flex items-center gap-2 border rounded-lg px-3 py-2">
            <input
              type="checkbox"
              checked={filters.open_only}
              onChange={(e) => setFilters((prev) => ({ ...prev, open_only: e.target.checked }))}
            />
            Solo abiertos
          </label>
          <label className="inline-flex items-center gap-2 border rounded-lg px-3 py-2">
            <input
              type="checkbox"
              checked={filters.overdue}
              onChange={(e) => setFilters((prev) => ({ ...prev, overdue: e.target.checked }))}
            />
            Solo vencidos
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-7 gap-2">
        <MetricBox label="Docs abiertos" value={documentsDashboard.open_documents || 0} tone="blue" />
        <MetricBox label="Listos para pagar" value={documentsDashboard.ready_to_pay || 0} tone="emerald" />
        <MetricBox label="Programados" value={documentsDashboard.scheduled_documents || 0} tone="blue" />
        <MetricBox label="Sin cuenta proveedor" value={documentsDashboard.missing_supplier_bank || 0} tone="amber" />
        <MetricBox label="Vencidos" value={dashboard.overdue_count || 0} tone="red" />
        <CurrencySummary label="Saldo pendiente" values={documentsDashboard.balance_by_currency} tone="blue" />
        <CurrencySummary label="Saldo vencido" values={documentsDashboard.overdue_by_currency} tone="red" />
      </div>

      <div className="bg-white border rounded-2xl overflow-visible">
        <div className="px-4 py-3 border-b bg-slate-50 flex items-center justify-between gap-3">
          <div className="font-medium">Bandeja de documentos</div>
          <div className="text-xs text-slate-500">{documents.length} documentos</div>
        </div>
        {documentsLoading ? (
          <div className="p-4 text-sm text-slate-500">Cargando documentos...</div>
        ) : documents.length === 0 ? (
          <div className="p-4 text-sm text-slate-500">No hay documentos para los filtros actuales.</div>
        ) : (
          <div className="overflow-x-auto overflow-y-visible">
            <table className="min-w-full text-sm">
              <thead className="bg-white">
                <tr className="border-b">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Proveedor</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Documento</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Modulo</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Fuente</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Operacion</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Vence</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Programado</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Saldo</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">OP</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Estado</th>
                  {ENABLE_DOCUMENT_VALIDATION && (
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Doc.</th>
                  )}
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Alertas</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((row) => {
                  const meta = STATUS_META[row.payable_status] || { label: row.payable_status || '-', tone: 'slate' };
                  const docMeta = DOCUMENT_VALIDATION_META[String(row.validation_status || 'pendiente').toLowerCase()] || DOCUMENT_VALIDATION_META.pendiente;
                  const open = actionsMenu?.row === row;
                  return (
                    <tr key={`${row.source_type}-${row.invoice_id || row.expense_id}`} className="border-b last:border-b-0">
                      <td className="px-4 py-3">
                        <div className="font-medium">{row.supplier_name || 'Proveedor sin nombre'}</div>
                        <div className="text-xs text-slate-500">{row.supplier_ruc || '-'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{row.document_number || '-'}</div>
                        <div className="text-xs text-slate-500">{fmtDate(row.invoice_date)}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{row.module_name || '-'}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">{sourceTypeLabel(row.source_type)}</td>
                      <td className="px-4 py-3">
                        {row.operation_reference ? (
                          <button type="button" className="text-blue-600 hover:underline" onClick={() => openOperation(row)}>
                            {row.operation_reference}
                          </button>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3">{fmtDate(row.due_date)}</td>
                      <td className="px-4 py-3">
                        <div>{fmtDate(row.scheduled_payment_date)}</div>
                        <div className="text-xs text-slate-500">
                          {row.priority && row.priority !== 'normal' ? row.priority : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium">{fmtMoney(row.balance, row.currency_code)}</td>
                      <td className="px-4 py-3">
                        {row.payment_order_number ? (
                          <button type="button" className="text-blue-600 hover:underline" onClick={() => openPaymentOrderPdf(row)}>
                            {row.payment_order_number}
                          </button>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3"><StatusChip {...meta} /></td>
                      {ENABLE_DOCUMENT_VALIDATION && (
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            className="space-y-1 text-left"
                            onClick={() => openDocumentValidation(row)}
                          >
                            <StatusChip {...docMeta} />
                            <div className="text-xs text-slate-500">
                              {Number(row.attachment_count || 0)} adj.
                            </div>
                          </button>
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {!row.supplier_has_bank_account && <StatusChip label="Proveedor sin cuenta" tone="amber" />}
                          {row.supplier_has_bank_account && (
                            <span className="text-xs text-slate-500" title={supplierBankLabel(row)}>
                              Cuenta cargada
                            </span>
                          )}
                          {Array.isArray(row.alerts) && row.alerts.filter((alert) => alert !== 'Proveedor sin cuenta bancaria').map((alert) => (
                            <StatusChip
                              key={alert}
                              label={alert}
                              tone={
                                alert.includes('retenido') ||
                                alert.includes('Sin numero') ||
                                alert.includes('vencimiento') ||
                                alert.includes('observado')
                                  ? 'red'
                                  : 'amber'
                              }
                            />
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 relative">
                        <button
                          type="button"
                          className="px-2.5 py-1.5 text-xs rounded-lg border hover:bg-slate-50"
                          onClick={(event) => {
                            if (open) {
                              setActionsMenu(null);
                              return;
                            }
                            const rect = event.currentTarget.getBoundingClientRect();
                            const width = 208;
                            const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
                            const top = Math.min(window.innerHeight - 360, rect.bottom + 6);
                            setActionsMenu({ row, left, top: Math.max(8, top) });
                          }}
                        >
                          Acciones
                        </button>
                        {open && (
                          <div
                            ref={actionMenuRef}
                            className="fixed z-[80] w-52 rounded-xl border bg-white shadow-xl p-1"
                            style={{ left: actionsMenu.left, top: actionsMenu.top }}
                          >
                            {row.operation_id && (
                              <button className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-slate-50" onClick={() => { setActionsMenu(null); openOperation(row); }}>
                                Ver operacion
                              </button>
                            )}
                            <button className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-slate-50" onClick={() => { setActionsMenu(null); openInvoice(row); }}>
                              Ver factura
                            </button>
                            {ENABLE_DOCUMENT_VALIDATION && (
                              <button className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-slate-50" onClick={() => openDocumentValidation(row)}>
                                Validar documento
                              </button>
                            )}
                            {canGeneratePaymentOrder(row) && (
                              <button className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-blue-50 text-blue-700" onClick={() => openGenerateOrder(row)}>
                                Generar OP
                              </button>
                            )}
                            {row.payment_order_id && (
                              <button className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-slate-50" onClick={() => { setActionsMenu(null); openPaymentOrderPdf(row); }}>
                                Ver OP
                              </button>
                            )}
                            <button className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-slate-50" onClick={() => openPayments(row)}>
                              Ver pagos
                            </button>
                            <button className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-blue-50 text-blue-700" onClick={() => openSchedulePayment(row)}>
                              Programar pago
                            </button>
                            {canRegisterPayment(row) ? (
                              <button className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-emerald-50 text-emerald-700" onClick={() => openRegisterPayment(row)}>
                                Registrar pago
                              </button>
                            ) : (
                              <div className="px-3 py-2 text-xs text-slate-500">
                                {row.payable_status === 'sin_op' ? 'Primero generar OP.' : row.payable_status === 'op_pendiente' ? 'OP pendiente de aprobacion.' : 'No disponible.'}
                              </div>
                            )}
                            <button className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-slate-50" onClick={() => { setActionsMenu(null); openVendorDrawer(row, 'factura'); }}>
                              Estado proveedor
                            </button>
                            {row.supplier_id && (
                              <button className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-slate-50" onClick={() => { setActionsMenu(null); openProvider(row); }}>
                                Ver proveedor
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="bg-white border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-slate-50 font-medium">Deuda por modulo</div>
          {!dashboard.debt_by_module?.length ? (
            <div className="p-4 text-sm text-slate-500">No hay deuda abierta por modulo para los filtros actuales.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white">
                  <tr className="border-b">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Modulo</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Docs abiertos</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.debt_by_module.map((item) => (
                    <tr key={item.module_name} className="border-b last:border-b-0">
                      <td className="px-4 py-3 font-medium">{item.module_name}</td>
                      <td className="px-4 py-3">{item.open_documents}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(item.balance_by_currency || {}).map(([currency, amount]) => (
                            <span key={`${item.module_name}-${currency}`} className="inline-flex rounded-lg px-3 py-1.5 text-xs font-semibold bg-blue-50 text-blue-700">
                              {fmtMoney(amount, currency)}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-slate-50 font-medium">Proximos vencimientos</div>
          {!dashboard.upcoming_due?.length ? (
            <div className="p-4 text-sm text-slate-500">No hay vencimientos proximos para los filtros actuales.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white">
                  <tr className="border-b">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Vence</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Proveedor</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Documento</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.upcoming_due.map((item, index) => (
                    <tr key={`${item.supplier_name}-${item.document_number}-${index}`} className="border-b last:border-b-0">
                      <td className="px-4 py-3">{fmtDate(item.due_date)}</td>
                      <td className="px-4 py-3">{item.supplier_name}</td>
                      <td className="px-4 py-3">{item.document_number || '-'}</td>
                      <td className="px-4 py-3">{fmtMoney(item.balance, item.currency_code)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b bg-slate-50 font-medium">Resumen por proveedor</div>
        {loading ? (
          <div className="p-4 text-sm text-slate-500">Cargando cuentas a pagar...</div>
        ) : rows.length === 0 ? (
          <div className="p-4 text-sm text-slate-500">No hay datos para los filtros actuales.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-white">
                <tr className="border-b">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Proveedor</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">RUC</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Moneda</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Facturado</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Pagado</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Saldo</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Vencido</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Prox. venc.</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Docs abiertos</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Con OP</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Referencias</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Modulos</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Indicadores</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.supplier_key}-${row.currency_code}`} className="border-b last:border-b-0">
                    <td className="px-4 py-3 font-medium">{row.supplier_name || 'Proveedor sin nombre'}</td>
                    <td className="px-4 py-3">{row.supplier_ruc || '-'}</td>
                    <td className="px-4 py-3">{row.currency_code}</td>
                    <td className="px-4 py-3">{fmtMoney(row.total_invoiced, row.currency_code)}</td>
                    <td className="px-4 py-3">{fmtMoney(row.total_paid, row.currency_code)}</td>
                    <td className="px-4 py-3">{fmtMoney(row.total_balance, row.currency_code)}</td>
                    <td className="px-4 py-3">
                      <span className={Number(row.overdue_balance || 0) > 0 ? 'text-red-600 font-medium' : 'text-slate-500'}>
                        {fmtMoney(row.overdue_balance, row.currency_code)}
                      </span>
                    </td>
                    <td className="px-4 py-3">{fmtDate(row.next_due_date)}</td>
                    <td className="px-4 py-3">{row.open_documents}</td>
                    <td className="px-4 py-3">{row.documents_with_payment_order}</td>
                    <td className="px-4 py-3"><ReferenceLinks value={row.reference_list} targets={row.reference_targets} onOpen={openReference} /></td>
                    <td className="px-4 py-3 text-xs text-slate-600">{row.modules || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {Number(row.overdue_balance || 0) > 0 && <StatusChip label="Vencido" tone="red" />}
                        {Number(row.total_paid || 0) > 0 && Number(row.total_balance || 0) > 0 && <StatusChip label="Parcial" tone="blue" />}
                        {Number(row.documents_with_payment_order || 0) > 0 && <StatusChip label="Con OP" tone="amber" />}
                        {Number(row.total_balance || 0) <= 0.009 && <StatusChip label="Pagado" tone="emerald" />}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        className="px-2.5 py-1.5 text-xs rounded-lg border hover:bg-slate-50"
                        onClick={() => openVendorDrawer(row, 'all')}
                      >
                        Ver detalle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {paymentRow && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">Registrar pago</h3>
              <button className="text-sm underline" onClick={() => setPaymentRow(null)}>Cerrar</button>
            </div>
            <div className="mb-3 text-xs text-slate-500">
              {paymentRow.document_number || '-'} - Saldo {fmtMoney(paymentRow.balance, paymentRow.currency_code)}
            </div>
            <div className="grid grid-cols-1 gap-3">
              <input type="date" className="border rounded px-3 py-2" value={paymentForm.payment_date} onChange={(e) => setPaymentForm((f) => ({ ...f, payment_date: e.target.value }))} />
              <input type="number" min="0" step="0.01" className="border rounded px-3 py-2" placeholder="Monto" value={paymentForm.amount} onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))} />
              <select className="border rounded px-3 py-2" value={paymentForm.method} onChange={(e) => setPaymentForm((f) => ({ ...f, method: e.target.value }))}>
                <option value="">Metodo</option>
                {PAYMENT_METHODS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select className="border rounded px-3 py-2" value={paymentForm.account} onChange={(e) => setPaymentForm((f) => ({ ...f, account: e.target.value }))}>
                <option value="">Cuenta origen de empresa</option>
                {hasCurrentAccount ? <option value={paymentForm.account}>{paymentForm.account}</option> : null}
                {paymentAccountOptions.map((account) => (
                  <option key={account.id || companyBankAccountValue(account)} value={companyBankAccountValue(account)}>
                    {companyBankAccountLabel(account)}
                  </option>
                ))}
              </select>
              {!sameCurrencyPaymentAccounts.length && fallbackPaymentAccounts.length > 0 && (
                <div className="text-xs text-amber-700">
                  No hay cuentas activas en {paymentRow?.currency_code || 'PYG'}. Se muestran cuentas de otras monedas.
                </div>
              )}
              {!paymentAccountOptions.length && (
                <div className="text-xs text-red-700">
                  No hay cuentas de empresa activas cargadas en Parametros del sistema.
                </div>
              )}
              <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Cuenta destino del proveedor</div>
                {paymentRow.supplier_has_bank_account ? (
                  <div className="mt-2 text-slate-700">{supplierBankLabel(paymentRow)}</div>
                ) : (
                  <div className="mt-2 text-amber-700">Este proveedor no tiene cuenta bancaria cargada.</div>
                )}
              </div>
              <input className="border rounded px-3 py-2" placeholder="Referencia" value={paymentForm.reference_number} onChange={(e) => setPaymentForm((f) => ({ ...f, reference_number: e.target.value }))} />
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-slate-500">Comprobante de pago</span>
                <input
                  type="file"
                  className="border rounded px-3 py-2"
                  onChange={(e) => setPaymentForm((f) => ({ ...f, receipt_file: e.target.files?.[0] || null }))}
                />
              </label>
              <label className="inline-flex items-center gap-2 rounded-lg border bg-slate-50 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={paymentForm.mark_reconciled}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, mark_reconciled: e.target.checked }))}
                />
                Marcar como conciliado
              </label>
              {paymentForm.mark_reconciled && (
                <>
                  <input
                    type="date"
                    className="border rounded px-3 py-2"
                    value={paymentForm.reconciled_at}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, reconciled_at: e.target.value }))}
                  />
                  <textarea
                    className="border rounded px-3 py-2 min-h-[72px]"
                    placeholder="Notas de conciliacion"
                    value={paymentForm.reconciliation_notes}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, reconciliation_notes: e.target.value }))}
                  />
                </>
              )}
              <textarea className="border rounded px-3 py-2 min-h-[84px]" placeholder="Notas" value={paymentForm.notes} onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded border px-4 py-2 text-sm" onClick={() => setPaymentRow(null)}>Cancelar</button>
              <button className="rounded bg-black px-4 py-2 text-sm text-white" onClick={savePayment}>Guardar pago</button>
            </div>
          </div>
        </div>
      )}

      {scheduleRow && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">Programar pago</h3>
              <button className="text-sm underline" onClick={() => setScheduleRow(null)}>Cerrar</button>
            </div>
            <div className="mb-3 text-xs text-slate-500">
              {scheduleRow.document_number || '-'} - Saldo {fmtMoney(scheduleRow.balance, scheduleRow.currency_code)}
            </div>
            <div className="grid grid-cols-1 gap-3">
              <input
                type="date"
                className="border rounded px-3 py-2"
                value={scheduleForm.scheduled_payment_date}
                onChange={(e) => setScheduleForm((f) => ({ ...f, scheduled_payment_date: e.target.value }))}
              />
              <select
                className="border rounded px-3 py-2"
                value={scheduleForm.priority}
                onChange={(e) => setScheduleForm((f) => ({ ...f, priority: e.target.value }))}
              >
                {PRIORITY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <select
                className="border rounded px-3 py-2"
                value={scheduleForm.treasury_status}
                onChange={(e) => setScheduleForm((f) => ({ ...f, treasury_status: e.target.value }))}
              >
                {TREASURY_STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <select
                className="border rounded px-3 py-2"
                value={scheduleForm.planned_company_account}
                onChange={(e) => setScheduleForm((f) => ({ ...f, planned_company_account: e.target.value }))}
              >
                <option value="">Cuenta origen planeada</option>
                {hasCurrentScheduleAccount ? (
                  <option value={scheduleForm.planned_company_account}>{scheduleForm.planned_company_account}</option>
                ) : null}
                {scheduleAccountOptions.map((account) => (
                  <option key={account.id || companyBankAccountValue(account)} value={companyBankAccountValue(account)}>
                    {companyBankAccountLabel(account)}
                  </option>
                ))}
              </select>
              {!sameCurrencyScheduleAccounts.length && fallbackScheduleAccounts.length > 0 && (
                <div className="text-xs text-amber-700">
                  No hay cuentas activas en {scheduleRow?.currency_code || 'PYG'}. Se muestran cuentas de otras monedas.
                </div>
              )}
              {!scheduleAccountOptions.length && (
                <div className="text-xs text-red-700">
                  No hay cuentas de empresa activas cargadas en Parametros del sistema.
                </div>
              )}
              <textarea
                className="border rounded px-3 py-2 min-h-[84px]"
                placeholder="Notas de tesoreria"
                value={scheduleForm.treasury_notes}
                onChange={(e) => setScheduleForm((f) => ({ ...f, treasury_notes: e.target.value }))}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded border px-4 py-2 text-sm" onClick={() => setScheduleRow(null)}>Cancelar</button>
              <button className="rounded bg-black px-4 py-2 text-sm text-white" onClick={saveSchedulePayment}>Guardar programacion</button>
            </div>
          </div>
        </div>
      )}

      {paymentsRow && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-5xl rounded-2xl bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">Pagos y conciliacion</h3>
                <div className="text-xs text-slate-500">
                  {paymentsRow.document_number || '-'} - {paymentsRow.supplier_name || 'Proveedor'}
                </div>
              </div>
              <button className="text-sm underline" onClick={() => setPaymentsRow(null)}>Cerrar</button>
            </div>
            {paymentsLoading ? (
              <div className="rounded-lg border p-4 text-sm text-slate-500">Cargando pagos...</div>
            ) : payments.length === 0 ? (
              <div className="rounded-lg border p-4 text-sm text-slate-500">Este documento todavia no tiene pagos registrados.</div>
            ) : (
              <div className="max-h-[70vh] overflow-auto rounded-xl border">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr className="border-b">
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Fecha</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Monto</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Metodo</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Cuenta</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Referencia</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Comprobante</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Conciliacion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((payment) => {
                      const draft = reconciliationDrafts[payment.payment_id] || {};
                      return (
                        <tr key={`${payment.source_type}-${payment.payment_id}`} className="border-b last:border-b-0 align-top">
                          <td className="px-3 py-2">{fmtDate(payment.payment_date)}</td>
                          <td className="px-3 py-2 font-medium">{fmtMoney(payment.amount, payment.currency_code)}</td>
                          <td className="px-3 py-2">{payment.payment_method || '-'}</td>
                          <td className="px-3 py-2">{payment.account || '-'}</td>
                          <td className="px-3 py-2">{payment.reference_number || '-'}</td>
                          <td className="px-3 py-2">
                            <div className="space-y-2">
                              {payment.receipt_file_url ? (
                                <a className="text-blue-600 hover:underline" href={payment.receipt_file_url} target="_blank" rel="noreferrer">
                                  {payment.receipt_file_name || 'Ver comprobante'}
                                </a>
                              ) : (
                                <StatusChip label="Sin comprobante" tone="amber" />
                              )}
                              <input
                                type="file"
                                className="block w-full text-xs"
                                onChange={(e) => setPaymentReceiptFiles((prev) => ({
                                  ...prev,
                                  [payment.payment_id]: e.target.files?.[0] || null,
                                }))}
                              />
                              <button
                                type="button"
                                className="rounded border px-2.5 py-1 text-xs hover:bg-slate-50"
                                onClick={() => uploadPaymentReceipt(payment)}
                              >
                                Subir
                              </button>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="space-y-2">
                              {Number(payment.reconciled || 0) ? (
                                <StatusChip label={`Conciliado ${fmtDate(payment.reconciled_at)}`} tone="emerald" />
                              ) : (
                                <StatusChip label="Pendiente" tone="amber" />
                              )}
                              <input
                                type="date"
                                className="w-full rounded border px-2 py-1 text-xs"
                                value={draft.reconciled_at || ''}
                                onChange={(e) => setReconciliationDrafts((prev) => ({
                                  ...prev,
                                  [payment.payment_id]: { ...(prev[payment.payment_id] || {}), reconciled_at: e.target.value },
                                }))}
                              />
                              <textarea
                                className="w-full rounded border px-2 py-1 text-xs"
                                placeholder="Notas"
                                value={draft.reconciliation_notes || ''}
                                onChange={(e) => setReconciliationDrafts((prev) => ({
                                  ...prev,
                                  [payment.payment_id]: { ...(prev[payment.payment_id] || {}), reconciliation_notes: e.target.value },
                                }))}
                              />
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="rounded bg-emerald-600 px-2.5 py-1 text-xs text-white hover:bg-emerald-700"
                                  onClick={() => toggleReconciliation(payment, true)}
                                >
                                  Conciliar
                                </button>
                                {Number(payment.reconciled || 0) ? (
                                  <button
                                    type="button"
                                    className="rounded border px-2.5 py-1 text-xs hover:bg-slate-50"
                                    onClick={() => toggleReconciliation(payment, false)}
                                  >
                                    Desmarcar
                                  </button>
                                ) : null}
                              </div>
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
        </div>
      )}

      {ENABLE_DOCUMENT_VALIDATION && documentRow && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">Validacion documental</h3>
                <div className="text-xs text-slate-500">
                  {documentRow.document_number || '-'} - {documentRow.supplier_name || 'Proveedor'}
                </div>
              </div>
              <button className="text-sm underline" onClick={() => setDocumentRow(null)}>Cerrar</button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border p-3">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Estado actual</div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip {...(DOCUMENT_VALIDATION_META[String(documentValidationForm.validation_status || 'pendiente').toLowerCase()] || DOCUMENT_VALIDATION_META.pendiente)} />
                  <span className="text-xs text-slate-500">
                    {Number(documentRow.attachment_count || 0)} adjuntos detectados
                  </span>
                </div>
                {documentRow.validated_at ? (
                  <div className="mt-2 text-xs text-slate-500">
                    {fmtDate(documentRow.validated_at)} {documentRow.validated_by_name ? `- ${documentRow.validated_by_name}` : ''}
                  </div>
                ) : null}
              </div>

              <div className="rounded-xl border p-3">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Subir respaldo</div>
                <input
                  type="file"
                  className="w-full rounded border px-3 py-2 text-sm"
                  onChange={(e) => setDocumentFile(e.target.files?.[0] || null)}
                />
                <button
                  type="button"
                  className="mt-2 rounded border px-3 py-1.5 text-sm hover:bg-slate-50"
                  onClick={uploadDocumentAttachment}
                >
                  Subir adjunto
                </button>
              </div>
            </div>

            <div className="mt-3 rounded-xl border p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Adjuntos desde Cuentas a pagar</div>
              {documentLoading ? (
                <div className="text-sm text-slate-500">Cargando adjuntos...</div>
              ) : documentAttachments.length ? (
                <div className="flex flex-wrap gap-2">
                  {documentAttachments.map((item) => (
                    <a
                      key={item.id}
                      href={item.file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg bg-blue-50 px-3 py-1.5 text-sm text-blue-700 hover:underline"
                    >
                      {item.file_name || 'Adjunto'}
                    </a>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-500">No hay adjuntos cargados desde esta bandeja.</div>
              )}
            </div>

            <div className="mt-3 grid gap-3">
              <select
                className="rounded border px-3 py-2"
                value={documentValidationForm.validation_status}
                onChange={(e) => setDocumentValidationForm((prev) => ({ ...prev, validation_status: e.target.value }))}
              >
                <option value="pendiente">Pendiente</option>
                <option value="validada">Validada</option>
                <option value="observada">Observada</option>
              </select>
              <textarea
                className="min-h-[90px] rounded border px-3 py-2"
                placeholder="Observacion documental"
                value={documentValidationForm.validation_notes}
                onChange={(e) => setDocumentValidationForm((prev) => ({ ...prev, validation_notes: e.target.value }))}
              />
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button className="rounded border px-4 py-2 text-sm" onClick={() => setDocumentRow(null)}>Cancelar</button>
              <button className="rounded border px-4 py-2 text-sm" onClick={() => saveDocumentValidation('pendiente')}>Dejar pendiente</button>
              <button className="rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700" onClick={() => saveDocumentValidation('observada')}>Observar</button>
              <button className="rounded bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700" onClick={() => saveDocumentValidation('validada')}>Validar</button>
            </div>
          </div>
        </div>
      )}

      {orderRow && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">Generar orden de pago</h3>
              <button className="text-sm underline" onClick={() => setOrderRow(null)}>Cerrar</button>
            </div>
            <div className="mb-3 text-xs text-slate-500">
              {orderRow.document_number || '-'} - Saldo {fmtMoney(orderRow.balance, orderRow.currency_code)}
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
              <button className="rounded border px-4 py-2 text-sm" onClick={() => setOrderRow(null)}>Cancelar</button>
              <button className="rounded bg-black px-4 py-2 text-sm text-white" onClick={savePaymentOrder}>Generar</button>
            </div>
          </div>
        </div>
      )}

      <AccountsPayableVendorDrawer
        open={Boolean(selectedVendor)}
        supplierKey={selectedVendor?.supplier_key}
        currencyCode={selectedVendor?.currency_code}
        initialReference={selectedVendor?.reference || ''}
        initialMovementKind={selectedVendor?.movement_kind || 'all'}
        onDataChanged={reloadAll}
        onClose={() => setSelectedVendor(null)}
      />
    </div>
  );
}
