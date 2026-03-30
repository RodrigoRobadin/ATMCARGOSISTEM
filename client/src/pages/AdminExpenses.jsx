// client/src/pages/AdminExpenses.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import AdminExpensesMastersModal from '../components/AdminExpensesMastersModal';

const fmtMoney = (v) =>
  new Intl.NumberFormat('es-PY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Number(v || 0)
  );

const DEFAULT_BUYER = {
  name: 'ATM CARGO SRL',
  ruc: '80056641-6',
};

const PAYMENT_METHODS = ['Transferencia', 'Efectivo', 'Cheque', 'Tarjeta', 'Débito', 'Depósito'];
const PAYMENT_ACCOUNTS = ['Caja', 'Banco Itaú', 'Banco Continental', 'Banco Visión', 'Banco Regional'];

const today = () => new Date().toISOString().slice(0, 10);

export default function AdminExpenses() {
  const [meta, setMeta] = useState({
    categories: [],
    subcategories: [],
    costCenters: [],
    providers: [],
    exchange_rate: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [expenses, setExpenses] = useState([]);
  const [report, setReport] = useState({ byCostCenter: [] });
  const [upcomingRecurrences, setUpcomingRecurrences] = useState([]);
  const [error, setError] = useState('');
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [newInvoiceOpen, setNewInvoiceOpen] = useState(false);
  const [newInvoiceMode, setNewInvoiceMode] = useState('resumen'); // resumen | detalle
  const [newInvoiceItems, setNewInvoiceItems] = useState([]);
  const [newInvoiceForm, setNewInvoiceForm] = useState({
    amount_total: '',
    currency_code: 'PYG',
    exchange_rate: '',
    receipt_type: 'Factura',
    receipt_number: '',
    timbrado_number: '',
    invoice_date: today(),
    condition_type: 'CONTADO',
    due_date: '',
    supplier_ruc: '',
    supplier_name: '',
    buyer_name: DEFAULT_BUYER.name,
    buyer_ruc: DEFAULT_BUYER.ruc,
    tax_mode: 'solo10',
    gravado_10: '',
    gravado_5: '',
    iva_10: '',
    iva_5: '',
    iva_exempt: '',
    iva_no_taxed: '',
  });
  const [newInvoiceFile, setNewInvoiceFile] = useState(null);
  const [invoiceExpense, setInvoiceExpense] = useState(null);
  const [invoiceMode, setInvoiceMode] = useState('resumen'); // resumen | detalle
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [invoiceForm, setInvoiceForm] = useState({
    receipt_type: 'Factura',
    receipt_number: '',
    timbrado_number: '',
    invoice_date: today(),
    condition_type: 'CONTADO',
    due_date: '',
    supplier_ruc: '',
    supplier_name: '',
    buyer_name: DEFAULT_BUYER.name,
    buyer_ruc: DEFAULT_BUYER.ruc,
    tax_mode: 'solo10',
    gravado_10: '',
    gravado_5: '',
    iva_10: '',
    iva_5: '',
    iva_exempt: '',
    iva_no_taxed: '',
    amount_total: '',
    currency_code: 'PYG',
    exchange_rate: '',
  });
  const [invoiceFile, setInvoiceFile] = useState(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentExpense, setPaymentExpense] = useState(null);
  const [paymentForm, setPaymentForm] = useState({
    payment_date: today(),
    method: '',
    account: '',
    reference_number: '',
    amount: '',
    currency_code: 'PYG',
    receipt_type: 'Recibo',
    receipt_number: '',
    timbrado_number: '',
  });
  const [paymentFile, setPaymentFile] = useState(null);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [providerQuery, setProviderQuery] = useState('');
  const [providerOptions, setProviderOptions] = useState([]);
  const [providerOpen, setProviderOpen] = useState(false);
  const [providerLoading, setProviderLoading] = useState(false);
  const [mastersOpen, setMastersOpen] = useState(false);

  const [filters, setFilters] = useState({
    from_date: '',
    to_date: '',
    status: '',
    category_id: '',
    cost_center_id: '',
    provider_id: '',
    currency_code: '',
  });

  const [form, setForm] = useState({
    expense_date: today(),
    provider_id: '',
    category_id: '',
    subcategory_id: '',
    cost_center_id: '',
    description: '',
    amount: '',
    currency_code: 'PYG',
    tax_rate: '',
    receipt_type: 'Factura',
    receipt_number: '',
    timbrado_number: '',
    status: 'pendiente',
    recurring: false,
    end_date: '',
  });

  const backendBase = useMemo(() => {
    const base = api?.defaults?.baseURL || '';
    return base.endsWith('/api') ? base.slice(0, -4) : base;
  }, []);
  const formatProviderLabel = (p) => {
    if (!p) return '';
    const name = p.razon_social || p.name || '';
    return p.ruc ? `${name} (${p.ruc})` : name;
  };

  const getProviderById = (id) => {
    if (!id) return null;
    return meta.providers.find((p) => String(p.id) === String(id)) || null;
  };

  const computeIva = (total, mode, g10, g5) => {
    const t = Number(total || 0) || 0;
    const grav10 = Number(g10 || 0) || 0;
    const grav5 = Number(g5 || 0) || 0;
    let base10 = 0;
    let base5 = 0;
    if (mode === 'mixto') {
      base10 = grav10;
      base5 = grav5;
    } else if (mode === 'solo5') {
      base5 = t;
    } else {
      base10 = t;
    }
    const iva10 = base10 ? base10 / 11 : 0;
    const iva5 = base5 ? base5 / 21 : 0;
    return { iva10, iva5 };
  };

  const calcItemSubtotal = (it) => {
    const qty = Number(it.quantity || 0) || 0;
    const unit = Number(it.unit_price || 0) || 0;
    return Number((qty * unit).toFixed(2));
  };

  const computeItemsTotals = (items) => {
    let total = 0;
    let g10 = 0;
    let g5 = 0;
    let ex = 0;
    items.forEach((it) => {
      const subtotal = calcItemSubtotal(it);
      total += subtotal;
      const rate = Number(it.tax_rate);
      if (rate === 5) g5 += subtotal;
      else if (rate === 0) ex += subtotal;
      else g10 += subtotal;
    });
    return {
      total: Number(total.toFixed(2)),
      g10: Number(g10.toFixed(2)),
      g5: Number(g5.toFixed(2)),
      ex: Number(ex.toFixed(2)),
    };
  };


  const filteredSubcats = useMemo(() => {
    const activeSubs = meta.subcategories.filter((s) => s.active);
    if (!form.category_id) return activeSubs;
    return activeSubs.filter((s) => String(s.category_id) === String(form.category_id));
  }, [meta.subcategories, form.category_id]);

  async function loadMeta() {
    const { data } = await api.get('/admin-expenses/meta');
    setMeta({
      categories: data.categories || [],
      subcategories: data.subcategories || [],
      costCenters: data.costCenters || [],
      providers: data.providers || [],
      exchange_rate: data.exchange_rate || '',
    });
  }

  async function loadExpenses() {
    const { data } = await api.get('/admin-expenses', { params: filters });
    setExpenses(Array.isArray(data) ? data : []);
  }

  async function loadUpcomingRecurrences() {
    const { data } = await api.get('/admin-expenses/recurrences/upcoming', {
      params: { count: 6 },
    });
    setUpcomingRecurrences(Array.isArray(data) ? data : []);
  }

  async function loadReport() {
    const { data } = await api.get('/admin-expenses/report', { params: filters });
    setReport({
      byCostCenter: Array.isArray(data?.byCostCenter) ? data.byCostCenter : [],
    });
  }

  useEffect(() => {
    let active = true;
    if (!providerQuery.trim()) {
      setProviderOptions([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      try {
        setProviderLoading(true);
        const { data } = await api.get('/admin-expenses/providers/search', {
          params: { q: providerQuery.trim() },
        });
        if (!active) return;
        setProviderOptions(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!active) return;
        console.error('Error searching providers', e);
      } finally {
        if (active) setProviderLoading(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [providerQuery]);


  async function uploadExpenseAttachment(expenseId, file) {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    setUploading(true);
    try {
      await api.post(`/admin-expenses/${expenseId}/attachments`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    } finally {
      setUploading(false);
    }
  }

  
  async function handleViewReceipt(expenseId) {
    try {
      const { data } = await api.get(`/admin-expenses/${expenseId}/attachments`);
      if (!Array.isArray(data) || !data.length) {
        alert('Sin comprobante adjunto.');
        return;
      }
      const fileUrl = data[0].file_url;
      const url = fileUrl.startsWith('http') ? fileUrl : `${backendBase}${fileUrl}`;
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      console.error('Error loading attachment', e);
      alert('No se pudo abrir el comprobante.');
    }
  }

  async function loadInvoiceItems(expenseId) {
    try {
      const { data } = await api.get(`/admin-expenses/${expenseId}/items`);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.error('Error loading expense items', e);
      return [];
    }
  }

  async function openInvoiceModal(expense) {
    setInvoiceExpense(expense);
    const loadedItems = expense?.id ? await loadInvoiceItems(expense.id) : [];
    const useDetail = loadedItems.length > 0;
    const provider = getProviderById(expense?.provider_id);
    const supplierName = expense?.supplier_name || provider?.razon_social || provider?.name || '';
    const supplierRuc = expense?.supplier_ruc || provider?.ruc || '';
    setInvoiceMode(useDetail ? 'detalle' : 'resumen');
    setInvoiceItems(
      loadedItems.map((it) => ({
        description: it.description || '',
        quantity: it.quantity || 1,
        unit_price: it.unit_price || 0,
        tax_rate: it.tax_rate ?? 10,
      }))
    );
    setInvoiceForm({
      receipt_type: expense?.receipt_type || 'Factura',
      receipt_number: expense?.receipt_number || '',
      timbrado_number: expense?.timbrado_number || '',
      invoice_date: expense?.invoice_date || today(),
      condition_type: expense?.condition_type || 'CONTADO',
      due_date: expense?.due_date || '',
      supplier_ruc: supplierRuc,
      supplier_name: supplierName,
      buyer_name: expense?.buyer_name || DEFAULT_BUYER.name,
      buyer_ruc: expense?.buyer_ruc || DEFAULT_BUYER.ruc,
      tax_mode: expense?.tax_mode || (useDetail ? 'solo10' : 'solo10'),
      gravado_10: expense?.gravado_10 || '',
      gravado_5: expense?.gravado_5 || '',
      iva_10: expense?.iva_10 || '',
      iva_5: expense?.iva_5 || '',
      iva_exempt: expense?.iva_exempt || '',
      iva_no_taxed: expense?.iva_no_taxed || '',
      amount_total: expense?.amount || '',
      currency_code: expense?.currency_code || 'PYG',
      exchange_rate: expense?.exchange_rate || '',
    });
    setInvoiceFile(null);
    setInvoiceModalOpen(true);
  }

  function openNewInvoiceModal() {
    const provider = getProviderById(form.provider_id);
    if (provider) {
      setNewInvoiceForm((f) => ({
        ...f,
        supplier_name: provider.razon_social || provider.name || f.supplier_name,
        supplier_ruc: provider.ruc || f.supplier_ruc,
      }));
    }
    setNewInvoiceOpen(true);
  }

  async function handleSaveInvoice() {
    if (!invoiceExpense?.id) return;
    try {
      let payload = {
        receipt_type: invoiceForm.receipt_type || null,
        receipt_number: invoiceForm.receipt_number || null,
        timbrado_number: invoiceForm.timbrado_number || null,
        invoice_date: invoiceForm.invoice_date || null,
        condition_type: invoiceForm.condition_type || null,
        due_date: invoiceForm.due_date || null,
        currency_code: invoiceForm.currency_code || null,
        exchange_rate: invoiceForm.exchange_rate || null,
        supplier_ruc: invoiceForm.supplier_ruc || null,
        supplier_name: invoiceForm.supplier_name || null,
        buyer_name: invoiceForm.buyer_name || null,
        buyer_ruc: invoiceForm.buyer_ruc || null,
      };

      let itemsPayload = null;
      if (invoiceMode === 'detalle') {
        const totals = computeItemsTotals(invoiceItems);
        const taxMode =
          totals.g10 && totals.g5 ? 'mixto' : totals.g5 ? 'solo5' : 'solo10';
        payload = {
          ...payload,
          tax_mode: taxMode,
          gravado_10: totals.g10 || null,
          gravado_5: totals.g5 || null,
          iva_exempt: totals.ex || null,
          iva_no_taxed: 0,
          amount: totals.total || 0,
          iva_10: totals.g10 ? totals.g10 / 11 : 0,
          iva_5: totals.g5 ? totals.g5 / 21 : 0,
        };
        itemsPayload = invoiceItems.map((it) => ({
          description: it.description || '',
          quantity: Number(it.quantity || 0) || 0,
          unit_price: Number(it.unit_price || 0) || 0,
          tax_rate: Number(it.tax_rate ?? 10),
          subtotal: calcItemSubtotal(it),
        }));
      } else {
        payload = {
          ...payload,
          tax_mode: invoiceForm.tax_mode || null,
          gravado_10: invoiceForm.gravado_10 || null,
          gravado_5: invoiceForm.gravado_5 || null,
          iva_10: invoiceForm.iva_10 || null,
          iva_5: invoiceForm.iva_5 || null,
          iva_exempt: invoiceForm.iva_exempt || null,
          iva_no_taxed: invoiceForm.iva_no_taxed || null,
          amount: Number(invoiceForm.amount_total || invoiceExpense.amount || 0) || null,
        };
      }

      await api.patch(`/admin-expenses/${invoiceExpense.id}`, payload);
      if (itemsPayload) {
        await api.put(`/admin-expenses/${invoiceExpense.id}/items`, { items: itemsPayload });
      }
      if (invoiceFile) {
        await uploadExpenseAttachment(invoiceExpense.id, invoiceFile);
      }
      setInvoiceModalOpen(false);
      setInvoiceExpense(null);
      await loadExpenses();
    } catch (e) {
      console.error('Error saving invoice data', e);
      alert('No se pudo guardar la factura.');
    }
  }

  function openPaymentModal(expense) {
    setPaymentExpense(expense);
    setPaymentForm({
      payment_date: today(),
      method: '',
      account: '',
      reference_number: '',
      amount: expense?.amount || '',
      currency_code: expense?.currency_code || 'PYG',
      receipt_type: 'Recibo',
      receipt_number: '',
      timbrado_number: '',
    });
    setPaymentFile(null);
    setPaymentModalOpen(true);
  }

  async function handleSavePayment() {
    if (!paymentExpense?.id) return;
    setPaymentSaving(true);
    try {
      const { data } = await api.post(`/admin-expenses/${paymentExpense.id}/payments`, {
        payment_date: paymentForm.payment_date || null,
        method: paymentForm.method || null,
        account: paymentForm.account || null,
        reference_number: paymentForm.reference_number || null,
        amount: Number(paymentForm.amount || 0),
        currency_code: paymentForm.currency_code || 'PYG',
        receipt_type: paymentForm.receipt_type || null,
        receipt_number: paymentForm.receipt_number || null,
        timbrado_number: paymentForm.timbrado_number || null,
        status: 'confirmado',
      });
      if (data?.id && paymentFile) {
        const fd = new FormData();
        fd.append('file', paymentFile);
        await api.post(`/admin-expenses/payments/${data.id}/attachments`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      setPaymentModalOpen(false);
      setPaymentExpense(null);
    } catch (e) {
      console.error('Error saving payment', e);
      alert('No se pudo registrar el pago.');
    } finally {
      setPaymentSaving(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await api.post('/admin-expenses/recurrences/run').catch(() => null);
        await loadMeta();
        await loadExpenses();
        await loadReport();
        await loadUpcomingRecurrences();
      } catch (e) {
        console.error('Error loading admin expenses', e);
        setError('No se pudo cargar gastos administrativos.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleApplyFilters() {
    await loadExpenses();
    await loadReport();
  }

  async function handleExport() {
    try {
      const params = Object.entries(filters).reduce((acc, [k, v]) => {
        if (!v) return acc;
        acc[k] = v;
        return acc;
      }, {});
      const res = await api.get('/admin-expenses/export', {
        params,
        responseType: 'blob',
      });
      const blob = new Blob([res.data], {
        type:
          res.headers?.['content-type'] ||
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      const disposition = res.headers?.['content-disposition'] || '';
      const match = disposition.match(/filename=\"?([^\";]+)\"?/i);
      a.href = url;
      a.download = match?.[1] || 'libro-compras-administrativo.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Error exporting admin expenses', e);
      alert('No se pudo exportar el libro de compras.');
    }
  }

  async function handleSaveExchangeRate() {
    try {
      await api.put('/admin-expenses/exchange-rate', { value: meta.exchange_rate });
    } catch (e) {
      console.error('Error updating exchange rate', e);
      alert('No se pudo guardar el tipo de cambio.');
    }
  }

  async function handleCreateExpense(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        expense_date: form.expense_date,
        provider_id: form.provider_id || null,
        category_id: form.category_id || null,
        subcategory_id: form.subcategory_id || null,
        cost_center_id: form.cost_center_id || null,
        description: form.description,
        amount: Number(newInvoiceForm.amount_total || 0),
        currency_code: newInvoiceForm.currency_code || 'PYG',
        exchange_rate: newInvoiceForm.exchange_rate || null,
        tax_rate: form.tax_rate || null,
        receipt_type: newInvoiceForm.receipt_type || null,
        receipt_number: newInvoiceForm.receipt_number || null,
        timbrado_number: newInvoiceForm.timbrado_number || null,
        invoice_date: newInvoiceForm.invoice_date || null,
        condition_type: newInvoiceForm.condition_type || null,
        due_date: newInvoiceForm.due_date || null,
        supplier_ruc: newInvoiceForm.supplier_ruc || null,
        supplier_name: newInvoiceForm.supplier_name || null,
        buyer_name: newInvoiceForm.buyer_name || null,
        buyer_ruc: newInvoiceForm.buyer_ruc || null,
        tax_mode: newInvoiceForm.tax_mode || null,
        gravado_10: newInvoiceForm.gravado_10 || null,
        gravado_5: newInvoiceForm.gravado_5 || null,
        iva_10: newInvoiceForm.iva_10 || null,
        iva_5: newInvoiceForm.iva_5 || null,
        iva_exempt: newInvoiceForm.iva_exempt || null,
        iva_no_taxed: newInvoiceForm.iva_no_taxed || null,
        status: form.status || 'pendiente',
      };
      if (form.provider_id && (!payload.supplier_name || !payload.supplier_ruc)) {
        const provider = getProviderById(form.provider_id);
        if (provider) {
          if (!payload.supplier_name) {
            payload.supplier_name = provider.razon_social || provider.name || payload.supplier_name;
          }
          if (!payload.supplier_ruc) {
            payload.supplier_ruc = provider.ruc || payload.supplier_ruc;
          }
        }
      }

      if (newInvoiceMode === 'detalle') {
        const totals = computeItemsTotals(newInvoiceItems);
        const taxMode =
          totals.g10 && totals.g5 ? 'mixto' : totals.g5 ? 'solo5' : 'solo10';
        payload.amount = totals.total || 0;
        payload.tax_mode = taxMode;
        payload.gravado_10 = totals.g10 || null;
        payload.gravado_5 = totals.g5 || null;
        payload.iva_exempt = totals.ex || null;
        payload.iva_no_taxed = 0;
        payload.iva_10 = totals.g10 ? totals.g10 / 11 : 0;
        payload.iva_5 = totals.g5 ? totals.g5 / 21 : 0;
        payload.items = newInvoiceItems.map((it) => ({
          description: it.description || '',
          quantity: Number(it.quantity || 0) || 0,
          unit_price: Number(it.unit_price || 0) || 0,
          tax_rate: Number(it.tax_rate ?? 10),
          subtotal: calcItemSubtotal(it),
        }));
      }

      if (form.recurring) {
        const { data: rec } = await api.post('/admin-expenses/recurrences', {
          ...payload,
          start_date: form.expense_date,
          end_date: form.end_date || null,
          frequency: 'monthly',
        });
        if (newInvoiceFile) {
          const recId = rec?.id;
          if (recId) {
            const { data: list } = await api.get('/admin-expenses', {
              params: { recurrence_id: recId, from_date: form.expense_date, to_date: form.expense_date },
            });
            const match = Array.isArray(list) ? list[0] : null;
            if (match?.id) await uploadExpenseAttachment(match.id, newInvoiceFile);
          }
        }
      } else {
        const { data } = await api.post('/admin-expenses', payload);
        if (data?.id && newInvoiceFile) {
          await uploadExpenseAttachment(data.id, newInvoiceFile);
        }
      }

      setForm((prev) => ({
        ...prev,
        provider_id: '',
        description: '',
        amount: '',
        receipt_number: '',
        timbrado_number: '',
        recurring: false,
        end_date: '',
      }));
      setProviderQuery('');
      setNewInvoiceForm({
        amount_total: '',
        currency_code: 'PYG',
        exchange_rate: '',
        receipt_type: 'Factura',
        receipt_number: '',
        timbrado_number: '',
        invoice_date: today(),
        condition_type: 'CONTADO',
        due_date: '',
        supplier_ruc: '',
        supplier_name: '',
        buyer_name: DEFAULT_BUYER.name,
        buyer_ruc: DEFAULT_BUYER.ruc,
        tax_mode: 'solo10',
        gravado_10: '',
        gravado_5: '',
        iva_10: '',
        iva_5: '',
        iva_exempt: '',
        iva_no_taxed: '',
      });
      setNewInvoiceFile(null);
      setNewInvoiceMode('resumen');
      setNewInvoiceItems([]);
      setNewInvoiceOpen(false);
      await loadExpenses();
      await loadUpcomingRecurrences();
    } catch (e) {
      console.error('Error creating expense', e);
      setError(e?.response?.data?.error || 'No se pudo crear el gasto.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-sm text-slate-600">Cargando...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Gastos administrativos</h1>
          <p className="text-sm text-slate-500">Registro y control de gastos internos.</p>
        </div>
        <div className="flex items-center gap-3">
          <div>
            <div className="text-xs text-slate-500">TC Gs/USD</div>
            <div className="flex gap-2">
              <input
                className="w-28 border rounded px-2 py-1 text-sm"
                value={meta.exchange_rate || ''}
                onChange={(e) => setMeta((m) => ({ ...m, exchange_rate: e.target.value }))}
              />
              <button
                className="px-2 py-1 text-sm border rounded"
                onClick={handleSaveExchangeRate}
              >
                Guardar
              </button>
            </div>
          </div>
          <button
            className="px-3 py-2 text-sm rounded border"
            onClick={handleExport}
          >
            Exportar libro compras
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Registro de gastos</h2>
          <p className="text-sm text-slate-500">Carga de gastos administrativos.</p>
        </div>
        <button
          className="px-3 py-2 text-sm border rounded"
          type="button"
          onClick={() => setMastersOpen(true)}
        >
          Gestionar maestros
        </button>
      </div>

      <form onSubmit={handleCreateExpense} className="bg-white border rounded-lg p-4 space-y-3">
        <div className="text-sm font-semibold">Nuevo gasto</div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="text-xs text-slate-500">Fecha</label>
            <input
              type="date"
              className="mt-1 w-full border rounded px-2 py-1 text-sm"
              value={form.expense_date}
              onChange={(e) => setForm((f) => ({ ...f, expense_date: e.target.value }))}
            />
          </div>
          <div className="relative">
            <label className="text-xs text-slate-500">Proveedor</label>
            <input
              className="mt-1 w-full border rounded px-2 py-1 text-sm"
              placeholder="Buscar proveedor"
              value={providerQuery}
              onChange={(e) => {
                setProviderQuery(e.target.value);
                setForm((f) => ({ ...f, provider_id: '' }));
                setProviderOpen(true);
              }}
              onFocus={() => setProviderOpen(true)}
              onBlur={() => setTimeout(() => setProviderOpen(false), 150)}
            />
            {providerOpen && (
              <div className="absolute z-10 mt-1 w-full bg-white border rounded shadow-sm max-h-52 overflow-auto">
                <button
                  type="button"
                  className="w-full text-left px-2 py-1 text-sm hover:bg-slate-100"
                  onClick={() => {
                    setProviderQuery('');
                    setForm((f) => ({ ...f, provider_id: '' }));
                    setProviderOpen(false);
                  }}
                >
                  Sin proveedor
                </button>
                {providerLoading && (
                  <div className="px-2 py-1 text-xs text-slate-500">Buscando...</div>
                )}
                {!providerLoading &&
                  providerOptions.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      className="w-full text-left px-2 py-1 text-sm hover:bg-slate-100"
                      onClick={() => {
                        setForm((f) => ({ ...f, provider_id: p.id }));
                        setProviderQuery(formatProviderLabel(p));
                        setProviderOpen(false);
                      }}
                    >
                      {formatProviderLabel(p)}
                    </button>
                  ))}
                {!providerLoading && providerQuery.trim() && !providerOptions.length && (
                  <div className="px-2 py-1 text-xs text-slate-500">Sin resultados</div>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="text-xs text-slate-500">Categoria</label>
            <select
              className="mt-1 w-full border rounded px-2 py-1 text-sm"
              value={form.category_id}
              onChange={(e) =>
                setForm((f) => ({ ...f, category_id: e.target.value, subcategory_id: '' }))
              }
            >
              <option value="">Seleccionar</option>
              {meta.categories
                .filter((c) => c.active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Subcategoria</label>
            <select
              className="mt-1 w-full border rounded px-2 py-1 text-sm"
              value={form.subcategory_id}
              onChange={(e) => setForm((f) => ({ ...f, subcategory_id: e.target.value }))}
            >
              <option value="">Seleccionar</option>
              {filteredSubcats.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Centro de costo</label>
            <select
              className="mt-1 w-full border rounded px-2 py-1 text-sm"
              value={form.cost_center_id}
              onChange={(e) => setForm((f) => ({ ...f, cost_center_id: e.target.value }))}
            >
              <option value="">Seleccionar</option>
              {meta.costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Estado</label>
            <select
              className="mt-1 w-full border rounded px-2 py-1 text-sm"
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            >
              <option value="borrador">Borrador</option>
              <option value="validado">Validado</option>
              <option value="observado">Observado</option>
              <option value="pendiente">Pendiente</option>
              <option value="pagado">Pagado</option>
              <option value="anulado">Anulado</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-500">Descripcion</label>
          <input
            className="mt-1 w-full border rounded px-2 py-1 text-sm"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="px-3 py-2 text-sm border rounded"
            onClick={openNewInvoiceModal}
          >
            Cargar factura
          </button>
          {newInvoiceForm.amount_total && (
            <div className="text-xs text-slate-500">
              Monto: {fmtMoney(newInvoiceForm.amount_total)} {newInvoiceForm.currency_code}
            </div>
          )}
        </div>
        <div className="flex items-center gap-4">
          <label className="text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.recurring}
              onChange={(e) => setForm((f) => ({ ...f, recurring: e.target.checked }))}
            />
            Recurrente (mensual)
          </label>
          {form.recurring && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">Fin</label>
              <input
                type="date"
                className="border rounded px-2 py-1 text-sm"
                value={form.end_date}
                onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
              />
            </div>
          )}
        </div>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="flex justify-end gap-2">
          <button
            type="submit"
            className="px-3 py-2 text-sm bg-black text-white rounded"
            disabled={saving || uploading}
          >
            {saving || uploading ? 'Guardando...' : 'Guardar gasto'}
          </button>
        </div>
      </form>

      <div className="bg-white border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Listado</div>
          <button className="text-sm border rounded px-3 py-1" onClick={handleApplyFilters}>
            Refrescar
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-slate-500">Desde</label>
            <input
              type="date"
              className="mt-1 w-full border rounded px-2 py-1 text-sm"
              value={filters.from_date}
              onChange={(e) => setFilters((f) => ({ ...f, from_date: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Hasta</label>
            <input
              type="date"
              className="mt-1 w-full border rounded px-2 py-1 text-sm"
              value={filters.to_date}
              onChange={(e) => setFilters((f) => ({ ...f, to_date: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Estado</label>
            <select
              className="mt-1 w-full border rounded px-2 py-1 text-sm"
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            >
              <option value="">Todos</option>
              <option value="borrador">Borrador</option>
              <option value="validado">Validado</option>
              <option value="observado">Observado</option>
              <option value="pendiente">Pendiente</option>
              <option value="pagado">Pagado</option>
              <option value="anulado">Anulado</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Moneda</label>
            <select
              className="mt-1 w-full border rounded px-2 py-1 text-sm"
              value={filters.currency_code}
              onChange={(e) => setFilters((f) => ({ ...f, currency_code: e.target.value }))}
            >
              <option value="">Todas</option>
              <option value="PYG">PYG</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="text-left px-3 py-2">Fecha</th>
                <th className="text-left px-3 py-2">Proveedor</th>
                <th className="text-left px-3 py-2">Categoria</th>
                <th className="text-left px-3 py-2">Centro</th>
                <th className="text-left px-3 py-2">Condición</th>
                <th className="text-left px-3 py-2">Vencimiento</th>
                <th className="text-left px-3 py-2">Descripcion</th>
                <th className="text-right px-3 py-2">Monto</th>
                <th className="text-left px-3 py-2">Moneda</th>
                <th className="text-left px-3 py-2">Estado</th>
                <th className="text-left px-3 py-2">Factura</th>
                <th className="text-left px-3 py-2">Pago</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="px-3 py-2">{e.expense_date}</td>
                  <td className="px-3 py-2">{e.provider_name || '-'}</td>
                  <td className="px-3 py-2">{e.category_name || '-'}</td>
                  <td className="px-3 py-2">{e.cost_center_name || '-'}</td>
                  <td className="px-3 py-2">{e.condition_type || '-'}</td>
                  <td className="px-3 py-2">{e.due_date || '-'}</td>
                  <td className="px-3 py-2">{e.description || '-'}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(e.amount)}</td>
                  <td className="px-3 py-2">{e.currency_code || '-'}</td>
                  <td className="px-3 py-2 capitalize">{e.status || '-'}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button
                        className="text-xs text-blue-600 hover:underline"
                        type="button"
                        onClick={() => openInvoiceModal(e)}
                      >
                        Cargar
                      </button>
                      <button
                        className="text-xs text-blue-600 hover:underline"
                        type="button"
                        onClick={() => handleViewReceipt(e.id)}
                      >
                        Ver
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      className="text-xs text-blue-600 hover:underline"
                      type="button"
                      onClick={() => openPaymentModal(e)}
                    >
                      Registrar
                    </button>
                  </td>
                </tr>
              ))}
              {!expenses.length && (
                <tr>
                  <td colSpan={12} className="px-3 py-4 text-center text-slate-500">
                    Sin gastos registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border rounded-lg p-4 space-y-3">
        <div className="text-sm font-semibold">Próximas recurrencias</div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="text-left px-3 py-2">Descripción</th>
                <th className="text-left px-3 py-2">Proveedor</th>
                <th className="text-left px-3 py-2">Centro</th>
                <th className="text-left px-3 py-2">Monto</th>
                <th className="text-left px-3 py-2">Próximas fechas</th>
              </tr>
            </thead>
            <tbody>
              {upcomingRecurrences.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2">{r.description || '-'}</td>
                  <td className="px-3 py-2">{r.provider_name || '-'}</td>
                  <td className="px-3 py-2">{r.cost_center_name || '-'}</td>
                  <td className="px-3 py-2">
                    {fmtMoney(r.amount)} {r.currency_code || 'PYG'}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {(r.next_dates || []).join(', ') || '-'}
                  </td>
                </tr>
              ))}
              {!upcomingRecurrences.length && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                    Sin recurrencias activas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border rounded-lg p-4 space-y-4">
        <div className="text-sm font-semibold">Reporte por centro de costo</div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="text-left px-3 py-2">Centro</th>
                <th className="text-left px-3 py-2">Moneda</th>
                <th className="text-right px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {report.byCostCenter.map((row, idx) => (
                <tr key={`${row.cost_center_name || 'sin'}-${row.currency_code}-${idx}`} className="border-t">
                  <td className="px-3 py-2">{row.cost_center_name || 'Sin centro'}</td>
                  <td className="px-3 py-2">{row.currency_code || '-'}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(row.total)}</td>
                </tr>
              ))}
              {!report.byCostCenter.length && (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-center text-slate-500">
                    Sin datos para el reporte.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

      </div>

      {newInvoiceOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-auto p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Nueva factura de compra</div>
              <button className="text-sm underline" onClick={() => setNewInvoiceOpen(false)}>
                Cerrar
              </button>
            </div>
            <div className="mb-2 inline-flex rounded-lg border overflow-hidden">
              <button
                className={`px-3 py-1.5 text-sm ${
                  newInvoiceMode === 'resumen' ? 'bg-slate-900 text-white' : 'bg-white'
                }`}
                onClick={() => {
                  setNewInvoiceMode('resumen');
                  setNewInvoiceItems([]);
                }}
              >
                Resumen
              </button>
              <button
                className={`px-3 py-1.5 text-sm ${
                  newInvoiceMode === 'detalle' ? 'bg-slate-900 text-white' : 'bg-white'
                }`}
                onClick={() => setNewInvoiceMode('detalle')}
              >
                Detalle por ítems
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500">Tipo comprobante</label>
                <select
                  className="border rounded px-2 py-1 w-full"
                  value={newInvoiceForm.receipt_type || ''}
                  onChange={(e) =>
                    setNewInvoiceForm((f) => ({ ...f, receipt_type: e.target.value }))
                  }
                >
                  {['Factura', 'Boleta', 'Ticket', 'Nota de Crédito', 'Nota de Débito', 'Autofactura', 'Despacho de importación'].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500">Fecha emisión</label>
                <input
                  type="date"
                  className="border rounded px-2 py-1 w-full"
                  value={newInvoiceForm.invoice_date}
                  onChange={(e) =>
                    setNewInvoiceForm((f) => ({ ...f, invoice_date: e.target.value }))
                  }
                />
              </div>
              <input
                className="border rounded px-2 py-1"
                placeholder="Timbrado"
                value={newInvoiceForm.timbrado_number}
                onChange={(e) =>
                  setNewInvoiceForm((f) => ({ ...f, timbrado_number: e.target.value }))
                }
              />
              <input
                className="border rounded px-2 py-1"
                placeholder="N° comprobante"
                value={newInvoiceForm.receipt_number}
                onChange={(e) =>
                  setNewInvoiceForm((f) => ({ ...f, receipt_number: e.target.value }))
                }
              />
              <div>
                <label className="text-xs text-slate-500">Condición</label>
                <select
                  className="border rounded px-2 py-1 w-full"
                  value={newInvoiceForm.condition_type || 'CONTADO'}
                  onChange={(e) =>
                    setNewInvoiceForm((f) => ({ ...f, condition_type: e.target.value }))
                  }
                >
                  <option value="CONTADO">CONTADO</option>
                  <option value="CREDITO">CREDITO</option>
                </select>
              </div>
              {String(newInvoiceForm.condition_type || '').toUpperCase() === 'CREDITO' && (
                <div>
                  <label className="text-xs text-slate-500">Vencimiento</label>
                  <input
                    type="date"
                    className="border rounded px-2 py-1 w-full"
                    value={newInvoiceForm.due_date || ''}
                    onChange={(e) =>
                      setNewInvoiceForm((f) => ({ ...f, due_date: e.target.value }))
                    }
                  />
                </div>
              )}
              <div>
                <label className="text-xs text-slate-500">Moneda</label>
                <select
                  className="border rounded px-2 py-1 w-full"
                  value={newInvoiceForm.currency_code}
                  onChange={(e) =>
                    setNewInvoiceForm((f) => ({ ...f, currency_code: e.target.value }))
                  }
                >
                  <option value="PYG">PYG</option>
                  <option value="USD">USD</option>
                  <option value="BRL">BRL</option>
                  <option value="ARS">ARS</option>
                </select>
              </div>
              {newInvoiceForm.currency_code && newInvoiceForm.currency_code !== 'PYG' && (
                <input
                  className="border rounded px-2 py-1"
                  placeholder="Tipo de cambio"
                  value={newInvoiceForm.exchange_rate || ''}
                  onChange={(e) =>
                    setNewInvoiceForm((f) => ({ ...f, exchange_rate: e.target.value }))
                  }
                />
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                className="border rounded px-2 py-1"
                placeholder="Proveedor (razón social)"
                value={newInvoiceForm.supplier_name}
                onChange={(e) =>
                  setNewInvoiceForm((f) => ({ ...f, supplier_name: e.target.value }))
                }
              />
              <input
                className="border rounded px-2 py-1"
                placeholder="RUC proveedor"
                value={newInvoiceForm.supplier_ruc}
                onChange={(e) =>
                  setNewInvoiceForm((f) => ({ ...f, supplier_ruc: e.target.value }))
                }
              />
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                className="border rounded px-2 py-1"
                placeholder="Comprador (razón social)"
                value={newInvoiceForm.buyer_name}
                onChange={(e) =>
                  setNewInvoiceForm((f) => ({ ...f, buyer_name: e.target.value }))
                }
              />
              <input
                className="border rounded px-2 py-1"
                placeholder="RUC comprador"
                value={newInvoiceForm.buyer_ruc}
                onChange={(e) =>
                  setNewInvoiceForm((f) => ({ ...f, buyer_ruc: e.target.value }))
                }
              />
            </div>

            {newInvoiceMode === 'resumen' ? (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500">Tipo de IVA</label>
                  <select
                  className="border rounded px-2 py-1 w-full"
                  value={newInvoiceForm.tax_mode || 'solo10'}
                  onChange={(e) =>
                    setNewInvoiceForm((f) => ({
                      ...f,
                      tax_mode: e.target.value,
                      gravado_10: '',
                      gravado_5: '',
                      iva_exempt: '',
                      iva_no_taxed: '',
                    }))
                  }
                >
                  <option value="solo10">Solo 10%</option>
                  <option value="solo5">Solo 5%</option>
                  <option value="mixto">Mixto (10% + 5%)</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500">Total comprobante</label>
                <input
                  className="border rounded px-2 py-1 w-full"
                  placeholder="Total comprobante"
                  value={newInvoiceForm.amount_total || ''}
                  onChange={(e) =>
                    setNewInvoiceForm((f) => ({ ...f, amount_total: e.target.value }))
                  }
                />
              </div>
              {newInvoiceForm.tax_mode === 'mixto' && (
                <>
                  <input
                    className="border rounded px-2 py-1"
                    placeholder="Gravado 10% (con IVA)"
                    value={newInvoiceForm.gravado_10 || ''}
                    onChange={(e) =>
                      setNewInvoiceForm((f) => ({ ...f, gravado_10: e.target.value }))
                    }
                  />
                  <input
                    className="border rounded px-2 py-1"
                    placeholder="Gravado 5% (con IVA)"
                    value={newInvoiceForm.gravado_5 || ''}
                    onChange={(e) =>
                      setNewInvoiceForm((f) => ({ ...f, gravado_5: e.target.value }))
                    }
                  />
                  <input
                    className="border rounded px-2 py-1"
                    placeholder="Exento"
                    value={newInvoiceForm.iva_exempt || ''}
                    onChange={(e) =>
                      setNewInvoiceForm((f) => ({ ...f, iva_exempt: e.target.value }))
                    }
                  />
                  <input
                    className="border rounded px-2 py-1"
                    placeholder="No gravado"
                    value={newInvoiceForm.iva_no_taxed || ''}
                    onChange={(e) =>
                      setNewInvoiceForm((f) => ({ ...f, iva_no_taxed: e.target.value }))
                    }
                  />
                </>
              )}
              <div className="md:col-span-2 text-xs text-slate-600">
                IVA 10%:{' '}
                {computeIva(
                  newInvoiceForm.amount_total,
                  newInvoiceForm.tax_mode,
                  newInvoiceForm.gravado_10,
                  newInvoiceForm.gravado_5
                ).iva10.toLocaleString('es-ES')}{' '}
                · IVA 5%:{' '}
                {computeIva(
                  newInvoiceForm.amount_total,
                  newInvoiceForm.tax_mode,
                  newInvoiceForm.gravado_10,
                  newInvoiceForm.gravado_5
                ).iva5.toLocaleString('es-ES')}
              </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Total comprobante</label>
                    <input
                      className="border rounded px-2 py-1 w-full bg-slate-50"
                      value={computeItemsTotals(newInvoiceItems).total.toLocaleString('es-ES')}
                      readOnly
                    />
                  </div>
                  <div className="text-xs text-slate-600 flex items-end">
                    IVA 10%:{' '}
                    {(
                      computeItemsTotals(newInvoiceItems).g10 / 11 || 0
                    ).toLocaleString('es-ES')}{' '}
                    · IVA 5%:{' '}
                    {(
                      computeItemsTotals(newInvoiceItems).g5 / 21 || 0
                    ).toLocaleString('es-ES')}
                  </div>
                </div>

                <div className="overflow-auto border rounded-lg">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-100 text-slate-600">
                      <tr>
                        <th className="text-left px-3 py-2">Descripción</th>
                        <th className="text-left px-3 py-2">Cant.</th>
                        <th className="text-left px-3 py-2">Precio unit.</th>
                        <th className="text-left px-3 py-2">IVA</th>
                        <th className="text-left px-3 py-2">Subtotal</th>
                        <th className="text-left px-3 py-2">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {newInvoiceItems.map((it, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="px-3 py-2">
                            <input
                              className="border rounded px-2 py-1 w-full"
                              value={it.description || ''}
                              onChange={(e) =>
                                setNewInvoiceItems((items) =>
                                  items.map((row, rIdx) =>
                                    rIdx === idx ? { ...row, description: e.target.value } : row
                                  )
                                )
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              className="border rounded px-2 py-1 w-20"
                              value={it.quantity || ''}
                              onChange={(e) =>
                                setNewInvoiceItems((items) =>
                                  items.map((row, rIdx) =>
                                    rIdx === idx ? { ...row, quantity: e.target.value } : row
                                  )
                                )
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              className="border rounded px-2 py-1 w-28"
                              value={it.unit_price || ''}
                              onChange={(e) =>
                                setNewInvoiceItems((items) =>
                                  items.map((row, rIdx) =>
                                    rIdx === idx ? { ...row, unit_price: e.target.value } : row
                                  )
                                )
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              className="border rounded px-2 py-1"
                              value={it.tax_rate ?? 10}
                              onChange={(e) =>
                                setNewInvoiceItems((items) =>
                                  items.map((row, rIdx) =>
                                    rIdx === idx
                                      ? { ...row, tax_rate: Number(e.target.value) }
                                      : row
                                  )
                                )
                              }
                            >
                              <option value={10}>10%</option>
                              <option value={5}>5%</option>
                              <option value={0}>Exento</option>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            {calcItemSubtotal(it).toLocaleString('es-ES')}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              className="text-xs text-red-600 hover:underline"
                              type="button"
                              onClick={() =>
                                setNewInvoiceItems((items) =>
                                  items.filter((_row, rIdx) => rIdx !== idx)
                                )
                              }
                            >
                              Quitar
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!newInvoiceItems.length && (
                        <tr>
                          <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                            Sin ítems cargados.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <button
                  className="px-3 py-2 text-sm border rounded"
                  type="button"
                  onClick={() =>
                    setNewInvoiceItems((items) => [
                      ...items,
                      { description: '', quantity: 1, unit_price: 0, tax_rate: 10 },
                    ])
                  }
                >
                  + Agregar ítem
                </button>
              </div>
            )}

            <div>
              <label className="text-xs text-slate-500">Adjuntar factura (PDF/imagen)</label>
              <input
                type="file"
                className="mt-1 w-full border rounded px-2 py-1 text-sm"
                accept="application/pdf,image/*"
                onChange={(e) => setNewInvoiceFile(e.target.files?.[0] || null)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-2 text-sm border rounded"
                onClick={() => setNewInvoiceOpen(false)}
              >
                Cancelar
              </button>
              <button
                className="px-3 py-2 text-sm bg-black text-white rounded"
                onClick={() => setNewInvoiceOpen(false)}
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {invoiceModalOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-auto p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Editar factura de compra</div>
              <button className="text-sm underline" onClick={() => setInvoiceModalOpen(false)}>
                Cerrar
              </button>
            </div>
            <div className="mb-2 inline-flex rounded-lg border overflow-hidden">
              <button
                className={`px-3 py-1.5 text-sm ${
                  invoiceMode === 'resumen' ? 'bg-slate-900 text-white' : 'bg-white'
                }`}
                onClick={() => {
                  setInvoiceMode('resumen');
                  setInvoiceItems([]);
                }}
              >
                Resumen
              </button>
              <button
                className={`px-3 py-1.5 text-sm ${
                  invoiceMode === 'detalle' ? 'bg-slate-900 text-white' : 'bg-white'
                }`}
                onClick={() => setInvoiceMode('detalle')}
              >
                Detalle por ítems
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500">Tipo comprobante</label>
                <select
                  className="border rounded px-2 py-1 w-full"
                  value={invoiceForm.receipt_type || ''}
                  onChange={(e) =>
                    setInvoiceForm((f) => ({ ...f, receipt_type: e.target.value }))
                  }
                >
                  {['Factura', 'Boleta', 'Ticket', 'Nota de Crédito', 'Nota de Débito', 'Autofactura', 'Despacho de importación'].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500">Fecha emisión</label>
                <input
                  type="date"
                  className="border rounded px-2 py-1 w-full"
                  value={invoiceForm.invoice_date}
                  onChange={(e) =>
                    setInvoiceForm((f) => ({ ...f, invoice_date: e.target.value }))
                  }
                />
              </div>
              <input
                className="border rounded px-2 py-1"
                placeholder="Timbrado"
                value={invoiceForm.timbrado_number}
                onChange={(e) =>
                  setInvoiceForm((f) => ({ ...f, timbrado_number: e.target.value }))
                }
              />
              <input
                className="border rounded px-2 py-1"
                placeholder="N° comprobante"
                value={invoiceForm.receipt_number}
                onChange={(e) =>
                  setInvoiceForm((f) => ({ ...f, receipt_number: e.target.value }))
                }
              />
              <div>
                <label className="text-xs text-slate-500">Condición</label>
                <select
                  className="border rounded px-2 py-1 w-full"
                  value={invoiceForm.condition_type || 'CONTADO'}
                  onChange={(e) =>
                    setInvoiceForm((f) => ({ ...f, condition_type: e.target.value }))
                  }
                >
                  <option value="CONTADO">CONTADO</option>
                  <option value="CREDITO">CREDITO</option>
                </select>
              </div>
              {String(invoiceForm.condition_type || '').toUpperCase() === 'CREDITO' && (
                <div>
                  <label className="text-xs text-slate-500">Vencimiento</label>
                  <input
                    type="date"
                    className="border rounded px-2 py-1 w-full"
                    value={invoiceForm.due_date || ''}
                    onChange={(e) =>
                      setInvoiceForm((f) => ({ ...f, due_date: e.target.value }))
                    }
                  />
                </div>
              )}
              <div>
                <label className="text-xs text-slate-500">Moneda</label>
                <select
                  className="border rounded px-2 py-1 w-full"
                  value={invoiceForm.currency_code}
                  onChange={(e) =>
                    setInvoiceForm((f) => ({ ...f, currency_code: e.target.value }))
                  }
                >
                  <option value="PYG">PYG</option>
                  <option value="USD">USD</option>
                  <option value="BRL">BRL</option>
                  <option value="ARS">ARS</option>
                </select>
              </div>
              {invoiceForm.currency_code && invoiceForm.currency_code !== 'PYG' && (
                <input
                  className="border rounded px-2 py-1"
                  placeholder="Tipo de cambio"
                  value={invoiceForm.exchange_rate || ''}
                  onChange={(e) =>
                    setInvoiceForm((f) => ({ ...f, exchange_rate: e.target.value }))
                  }
                />
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                className="border rounded px-2 py-1"
                placeholder="Proveedor (razón social)"
                value={invoiceForm.supplier_name}
                onChange={(e) =>
                  setInvoiceForm((f) => ({ ...f, supplier_name: e.target.value }))
                }
              />
              <input
                className="border rounded px-2 py-1"
                placeholder="RUC proveedor"
                value={invoiceForm.supplier_ruc}
                onChange={(e) =>
                  setInvoiceForm((f) => ({ ...f, supplier_ruc: e.target.value }))
                }
              />
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                className="border rounded px-2 py-1"
                placeholder="Comprador (razón social)"
                value={invoiceForm.buyer_name}
                onChange={(e) =>
                  setInvoiceForm((f) => ({ ...f, buyer_name: e.target.value }))
                }
              />
              <input
                className="border rounded px-2 py-1"
                placeholder="RUC comprador"
                value={invoiceForm.buyer_ruc}
                onChange={(e) =>
                  setInvoiceForm((f) => ({ ...f, buyer_ruc: e.target.value }))
                }
              />
            </div>

            {invoiceMode === 'resumen' ? (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500">Tipo de IVA</label>
                  <select
                  className="border rounded px-2 py-1 w-full"
                  value={invoiceForm.tax_mode || 'solo10'}
                  onChange={(e) =>
                    setInvoiceForm((f) => ({
                      ...f,
                      tax_mode: e.target.value,
                      gravado_10: '',
                      gravado_5: '',
                      iva_exempt: '',
                      iva_no_taxed: '',
                    }))
                  }
                >
                  <option value="solo10">Solo 10%</option>
                  <option value="solo5">Solo 5%</option>
                  <option value="mixto">Mixto (10% + 5%)</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500">Total comprobante</label>
                <input
                  className="border rounded px-2 py-1 w-full"
                  placeholder="Total comprobante"
                  value={invoiceForm.amount_total || ''}
                  onChange={(e) =>
                    setInvoiceForm((f) => ({ ...f, amount_total: e.target.value }))
                  }
                />
              </div>
              {invoiceForm.tax_mode === 'mixto' && (
                <>
                  <input
                    className="border rounded px-2 py-1"
                    placeholder="Gravado 10% (con IVA)"
                    value={invoiceForm.gravado_10 || ''}
                    onChange={(e) =>
                      setInvoiceForm((f) => ({ ...f, gravado_10: e.target.value }))
                    }
                  />
                  <input
                    className="border rounded px-2 py-1"
                    placeholder="Gravado 5% (con IVA)"
                    value={invoiceForm.gravado_5 || ''}
                    onChange={(e) =>
                      setInvoiceForm((f) => ({ ...f, gravado_5: e.target.value }))
                    }
                  />
                  <input
                    className="border rounded px-2 py-1"
                    placeholder="Exento"
                    value={invoiceForm.iva_exempt || ''}
                    onChange={(e) =>
                      setInvoiceForm((f) => ({ ...f, iva_exempt: e.target.value }))
                    }
                  />
                  <input
                    className="border rounded px-2 py-1"
                    placeholder="No gravado"
                    value={invoiceForm.iva_no_taxed || ''}
                    onChange={(e) =>
                      setInvoiceForm((f) => ({ ...f, iva_no_taxed: e.target.value }))
                    }
                  />
                </>
              )}
              <div className="md:col-span-2 text-xs text-slate-600">
                IVA 10%:{' '}
                {computeIva(
                  invoiceForm.amount_total,
                  invoiceForm.tax_mode,
                  invoiceForm.gravado_10,
                  invoiceForm.gravado_5
                ).iva10.toLocaleString('es-ES')}{' '}
                · IVA 5%:{' '}
                {computeIva(
                  invoiceForm.amount_total,
                  invoiceForm.tax_mode,
                  invoiceForm.gravado_10,
                  invoiceForm.gravado_5
                ).iva5.toLocaleString('es-ES')}
              </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Total comprobante</label>
                    <input
                      className="border rounded px-2 py-1 w-full bg-slate-50"
                      value={computeItemsTotals(invoiceItems).total.toLocaleString('es-ES')}
                      readOnly
                    />
                  </div>
                  <div className="text-xs text-slate-600 flex items-end">
                    IVA 10%:{' '}
                    {(computeItemsTotals(invoiceItems).g10 / 11 || 0).toLocaleString('es-ES')}{' '}
                    · IVA 5%:{' '}
                    {(computeItemsTotals(invoiceItems).g5 / 21 || 0).toLocaleString('es-ES')}
                  </div>
                </div>

                <div className="overflow-auto border rounded-lg">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-100 text-slate-600">
                      <tr>
                        <th className="text-left px-3 py-2">Descripción</th>
                        <th className="text-left px-3 py-2">Cant.</th>
                        <th className="text-left px-3 py-2">Precio unit.</th>
                        <th className="text-left px-3 py-2">IVA</th>
                        <th className="text-left px-3 py-2">Subtotal</th>
                        <th className="text-left px-3 py-2">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoiceItems.map((it, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="px-3 py-2">
                            <input
                              className="border rounded px-2 py-1 w-full"
                              value={it.description || ''}
                              onChange={(e) =>
                                setInvoiceItems((items) =>
                                  items.map((row, rIdx) =>
                                    rIdx === idx ? { ...row, description: e.target.value } : row
                                  )
                                )
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              className="border rounded px-2 py-1 w-20"
                              value={it.quantity || ''}
                              onChange={(e) =>
                                setInvoiceItems((items) =>
                                  items.map((row, rIdx) =>
                                    rIdx === idx ? { ...row, quantity: e.target.value } : row
                                  )
                                )
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              className="border rounded px-2 py-1 w-28"
                              value={it.unit_price || ''}
                              onChange={(e) =>
                                setInvoiceItems((items) =>
                                  items.map((row, rIdx) =>
                                    rIdx === idx ? { ...row, unit_price: e.target.value } : row
                                  )
                                )
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              className="border rounded px-2 py-1"
                              value={it.tax_rate ?? 10}
                              onChange={(e) =>
                                setInvoiceItems((items) =>
                                  items.map((row, rIdx) =>
                                    rIdx === idx
                                      ? { ...row, tax_rate: Number(e.target.value) }
                                      : row
                                  )
                                )
                              }
                            >
                              <option value={10}>10%</option>
                              <option value={5}>5%</option>
                              <option value={0}>Exento</option>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            {calcItemSubtotal(it).toLocaleString('es-ES')}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              className="text-xs text-red-600 hover:underline"
                              type="button"
                              onClick={() =>
                                setInvoiceItems((items) =>
                                  items.filter((_row, rIdx) => rIdx !== idx)
                                )
                              }
                            >
                              Quitar
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!invoiceItems.length && (
                        <tr>
                          <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                            Sin ítems cargados.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <button
                  className="px-3 py-2 text-sm border rounded"
                  type="button"
                  onClick={() =>
                    setInvoiceItems((items) => [
                      ...items,
                      { description: '', quantity: 1, unit_price: 0, tax_rate: 10 },
                    ])
                  }
                >
                  + Agregar ítem
                </button>
              </div>
            )}

            <div>
              <label className="text-xs text-slate-500">Adjuntar factura (PDF/imagen)</label>
              <input
                type="file"
                className="mt-1 w-full border rounded px-2 py-1 text-sm"
                accept="application/pdf,image/*"
                onChange={(e) => setInvoiceFile(e.target.files?.[0] || null)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-2 text-sm border rounded"
                onClick={() => setInvoiceModalOpen(false)}
              >
                Cancelar
              </button>
              <button
                className="px-3 py-2 text-sm bg-black text-white rounded"
                onClick={handleSaveInvoice}
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {paymentModalOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-full max-w-xl p-4 space-y-3">
            <div className="text-sm font-semibold">Registrar pago</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-slate-500">Fecha</label>
                <input
                  type="date"
                  className="mt-1 w-full border rounded px-2 py-1 text-sm"
                  value={paymentForm.payment_date}
                  onChange={(e) =>
                    setPaymentForm((f) => ({ ...f, payment_date: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Metodo</label>
                <select
                  className="mt-1 w-full border rounded px-2 py-1 text-sm"
                  value={paymentForm.method}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, method: e.target.value }))}
                >
                  <option value="">Seleccionar</option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500">Cuenta</label>
                <select
                  className="mt-1 w-full border rounded px-2 py-1 text-sm"
                  value={paymentForm.account}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, account: e.target.value }))}
                >
                  <option value="">Seleccionar</option>
                  {PAYMENT_ACCOUNTS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500">Referencia</label>
                <input
                  className="mt-1 w-full border rounded px-2 py-1 text-sm"
                  value={paymentForm.reference_number}
                  onChange={(e) =>
                    setPaymentForm((f) => ({ ...f, reference_number: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Monto</label>
                <input
                  type="number"
                  step="0.01"
                  className="mt-1 w-full border rounded px-2 py-1 text-sm"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Moneda</label>
                <select
                  className="mt-1 w-full border rounded px-2 py-1 text-sm"
                  value={paymentForm.currency_code}
                  onChange={(e) =>
                    setPaymentForm((f) => ({ ...f, currency_code: e.target.value }))
                  }
                >
                  <option value="PYG">PYG</option>
                  <option value="USD">USD</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-slate-500">Tipo comprobante</label>
                <input
                  className="mt-1 w-full border rounded px-2 py-1 text-sm"
                  value={paymentForm.receipt_type}
                  onChange={(e) =>
                    setPaymentForm((f) => ({ ...f, receipt_type: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Numero</label>
                <input
                  className="mt-1 w-full border rounded px-2 py-1 text-sm"
                  value={paymentForm.receipt_number}
                  onChange={(e) =>
                    setPaymentForm((f) => ({ ...f, receipt_number: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Timbrado</label>
                <input
                  className="mt-1 w-full border rounded px-2 py-1 text-sm"
                  value={paymentForm.timbrado_number}
                  onChange={(e) =>
                    setPaymentForm((f) => ({ ...f, timbrado_number: e.target.value }))
                  }
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500">Adjuntar recibo (PDF/imagen)</label>
              <input
                type="file"
                className="mt-1 w-full border rounded px-2 py-1 text-sm"
                accept="application/pdf,image/*"
                onChange={(e) => setPaymentFile(e.target.files?.[0] || null)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-2 text-sm border rounded"
                onClick={() => setPaymentModalOpen(false)}
              >
                Cancelar
              </button>
              <button
                className="px-3 py-2 text-sm bg-black text-white rounded"
                onClick={handleSavePayment}
                disabled={paymentSaving}
              >
                {paymentSaving ? 'Guardando...' : 'Guardar pago'}
              </button>
            </div>
          </div>
        </div>
      )}

      <AdminExpensesMastersModal
        open={mastersOpen}
        onClose={() => setMastersOpen(false)}
        meta={meta}
        onRefresh={loadMeta}
      />
    </div>
  );
}

