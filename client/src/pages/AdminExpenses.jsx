// client/src/pages/AdminExpenses.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const fmtMoney = (v) =>
  new Intl.NumberFormat('es-PY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Number(v || 0)
  );

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
  const [error, setError] = useState('');
  const [receiptFile, setReceiptFile] = useState(null);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [invoiceExpense, setInvoiceExpense] = useState(null);
  const [invoiceForm, setInvoiceForm] = useState({
    receipt_type: 'Factura',
    receipt_number: '',
    timbrado_number: '',
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
  const [newCategory, setNewCategory] = useState('');
  const [newSubcategory, setNewSubcategory] = useState('');
  const [newSubcategoryCategoryId, setNewSubcategoryCategoryId] = useState('');
  const [newCostCenter, setNewCostCenter] = useState('');
  const [newProvider, setNewProvider] = useState('');
  const [newProviderRuc, setNewProviderRuc] = useState('');

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


  const filteredSubcats = useMemo(() => {
    if (!form.category_id) return meta.subcategories;
    return meta.subcategories.filter((s) => String(s.category_id) === String(form.category_id));
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


  async function handleCreateCategory() {
    const name = newCategory.trim();
    if (!name) return;
    try {
      await api.post('/admin-expenses/categories', { name });
      setNewCategory('');
      await loadMeta();
    } catch (e) {
      console.error('Error creating category', e);
      setError('No se pudo crear la categoria.');
    }
  }

  async function handleCreateSubcategory() {
    const name = newSubcategory.trim();
    const categoryId = newSubcategoryCategoryId;
    if (!name || !categoryId) return;
    try {
      await api.post('/admin-expenses/subcategories', {
        name,
        category_id: categoryId,
      });
      setNewSubcategory('');
      await loadMeta();
    } catch (e) {
      console.error('Error creating subcategory', e);
      setError('No se pudo crear la subcategoria.');
    }
  }

  async function handleCreateCostCenter() {
    const name = newCostCenter.trim();
    if (!name) return;
    try {
      await api.post('/admin-expenses/cost-centers', { name });
      setNewCostCenter('');
      await loadMeta();
    } catch (e) {
      console.error('Error creating cost center', e);
      setError('No se pudo crear el centro de costo.');
    }
  }

  async function handleCreateProvider() {
    const name = newProvider.trim();
    if (!name) return;
    try {
      await api.post('/admin-expenses/providers', {
        name,
        ruc: newProviderRuc.trim() || null,
      });
      setNewProvider('');
      setNewProviderRuc('');
      await loadMeta();
    } catch (e) {
      console.error('Error creating provider', e);
      setError('No se pudo crear el proveedor.');
    }
  }

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

  function openInvoiceModal(expense) {
    setInvoiceExpense(expense);
    setInvoiceForm({
      receipt_type: expense?.receipt_type || 'Factura',
      receipt_number: expense?.receipt_number || '',
      timbrado_number: expense?.timbrado_number || '',
    });
    setInvoiceFile(null);
    setInvoiceModalOpen(true);
  }

  async function handleSaveInvoice() {
    if (!invoiceExpense?.id) return;
    try {
      await api.patch(`/admin-expenses/${invoiceExpense.id}`, {
        receipt_type: invoiceForm.receipt_type || null,
        receipt_number: invoiceForm.receipt_number || null,
        timbrado_number: invoiceForm.timbrado_number || null,
      });
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

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await loadMeta();
        await loadExpenses();
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
        amount: Number(form.amount || 0),
        currency_code: form.currency_code,
        tax_rate: form.tax_rate || null,
        receipt_type: form.receipt_type || null,
        receipt_number: form.receipt_number || null,
        timbrado_number: form.timbrado_number || null,
        status: form.status || 'pendiente',
      };

      if (form.recurring) {
        if (receiptFile) {
          setError('Adjuntar comprobante no esta disponible para recurrentes.');
        }
        await api.post('/admin-expenses/recurrences', {
          ...payload,
          start_date: form.expense_date,
          end_date: form.end_date || null,
          frequency: 'monthly',
        });
      } else {
        const { data } = await api.post('/admin-expenses', payload);
        if (data?.id && receiptFile) {
          await uploadExpenseAttachment(data.id, receiptFile);
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
      setReceiptFile(null);
      await loadExpenses();
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
        </div>
      </div>

      <div className="bg-white border rounded-lg p-4 space-y-3">
        <div className="text-sm font-semibold">Maestros</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-slate-500">Nueva categoria</label>
            <div className="mt-1 flex gap-2">
              <input
                className="w-full border rounded px-2 py-1 text-sm"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
              />
              <button className="text-sm border rounded px-2" onClick={handleCreateCategory}>
                Agregar
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500">Nueva subcategoria</label>
            <div className="mt-1 flex flex-col gap-2">
              <select
                className="w-full border rounded px-2 py-1 text-sm"
                value={newSubcategoryCategoryId}
                onChange={(e) => setNewSubcategoryCategoryId(e.target.value)}
              >
                <option value="">Categoria</option>
                {meta.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <input
                  className="w-full border rounded px-2 py-1 text-sm"
                  value={newSubcategory}
                  onChange={(e) => setNewSubcategory(e.target.value)}
                />
                <button className="text-sm border rounded px-2" onClick={handleCreateSubcategory}>
                  Agregar
                </button>
              </div>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500">Nuevo centro de costo</label>
            <div className="mt-1 flex gap-2">
              <input
                className="w-full border rounded px-2 py-1 text-sm"
                value={newCostCenter}
                onChange={(e) => setNewCostCenter(e.target.value)}
              />
              <button className="text-sm border rounded px-2" onClick={handleCreateCostCenter}>
                Agregar
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500">Nuevo proveedor</label>
            <div className="mt-1 flex flex-col gap-2">
              <input
                className="w-full border rounded px-2 py-1 text-sm"
                placeholder="Nombre"
                value={newProvider}
                onChange={(e) => setNewProvider(e.target.value)}
              />
              <div className="flex gap-2">
                <input
                  className="w-full border rounded px-2 py-1 text-sm"
                  placeholder="RUC"
                  value={newProviderRuc}
                  onChange={(e) => setNewProviderRuc(e.target.value)}
                />
                <button className="text-sm border rounded px-2" onClick={handleCreateProvider}>
                  Agregar
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <form onSubmit={handleCreateExpense} className="bg-white border rounded-lg p-4 space-y-3">
        <div className="text-sm font-semibold">Nuevo gasto</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
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
              {meta.categories.map((c) => (
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
            <label className="text-xs text-slate-500">Monto</label>
            <input
              type="number"
              step="0.01"
              className="mt-1 w-full border rounded px-2 py-1 text-sm"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Moneda</label>
            <select
              className="mt-1 w-full border rounded px-2 py-1 text-sm"
              value={form.currency_code}
              onChange={(e) => setForm((f) => ({ ...f, currency_code: e.target.value }))}
            >
              <option value="PYG">PYG</option>
              <option value="USD">USD</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Estado</label>
            <select
              className="mt-1 w-full border rounded px-2 py-1 text-sm"
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            >
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-slate-500">Comprobante</label>
            <input
              className="mt-1 w-full border rounded px-2 py-1 text-sm"
              value={form.receipt_type}
              onChange={(e) => setForm((f) => ({ ...f, receipt_type: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Numero</label>
            <input
              className="mt-1 w-full border rounded px-2 py-1 text-sm"
              value={form.receipt_number}
              onChange={(e) => setForm((f) => ({ ...f, receipt_number: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Timbrado</label>
            <input
              className="mt-1 w-full border rounded px-2 py-1 text-sm"
              value={form.timbrado_number}
              onChange={(e) => setForm((f) => ({ ...f, timbrado_number: e.target.value }))}
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-500">Adjuntar comprobante (PDF/imagen)</label>
          <input
            type="file"
            className="mt-1 w-full border rounded px-2 py-1 text-sm"
            accept="application/pdf,image/*"
            disabled={form.recurring}
            onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
          />
          {form.recurring && (
            <div className="text-xs text-slate-500 mt-1">
              Los comprobantes no se adjuntan a gastos recurrentes.
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
                  <td colSpan={10} className="px-3 py-4 text-center text-slate-500">
                    Sin gastos registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

      {invoiceModalOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-full max-w-lg p-4 space-y-3">
            <div className="text-sm font-semibold">Factura (gasto)</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-slate-500">Tipo</label>
                <input
                  className="mt-1 w-full border rounded px-2 py-1 text-sm"
                  value={invoiceForm.receipt_type}
                  onChange={(e) =>
                    setInvoiceForm((f) => ({ ...f, receipt_type: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Numero</label>
                <input
                  className="mt-1 w-full border rounded px-2 py-1 text-sm"
                  value={invoiceForm.receipt_number}
                  onChange={(e) =>
                    setInvoiceForm((f) => ({ ...f, receipt_number: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Timbrado</label>
                <input
                  className="mt-1 w-full border rounded px-2 py-1 text-sm"
                  value={invoiceForm.timbrado_number}
                  onChange={(e) =>
                    setInvoiceForm((f) => ({ ...f, timbrado_number: e.target.value }))
                  }
                />
              </div>
            </div>
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
                <input
                  className="mt-1 w-full border rounded px-2 py-1 text-sm"
                  value={paymentForm.method}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, method: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Cuenta</label>
                <input
                  className="mt-1 w-full border rounded px-2 py-1 text-sm"
                  value={paymentForm.account}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, account: e.target.value }))}
                />
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
      </div>
    </div>
  );
}
