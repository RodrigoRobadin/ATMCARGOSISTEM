import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth.jsx';
import { companyBankAccountLabel, companyBankAccountValue, filterCompanyBankAccounts } from '../../utils/companyBankAccounts';

const base = '/accounts-payable/unified-payment-orders';
const paymentMethods = ['Transferencia', 'Efectivo', 'Cheque', 'Tarjeta', 'Deposito', 'Otro'];
const labels = { 'operation-expense': 'Compra operativa', 'purchase-invoice': 'Factura de compra', 'admin-expense': 'Gasto administrativo' };
const money = (value, currency) => `${currency} ${Number(value || 0).toLocaleString('es-PY', { minimumFractionDigits: currency === 'PYG' ? 0 : 2, maximumFractionDigits: 2 })}`;
const newKey = () => crypto.randomUUID();

export default function UnifiedPaymentOrders({ onClose, onChanged, companyAccounts = [], initialOrderId = null, initialSupplierId = null, initialDocumentKeys = [] }) {
  const { user } = useAuth();
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const [view, setView] = useState('list');
  const [orders, setOrders] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState(initialSupplierId ? String(initialSupplierId) : '');
  const [eligible, setEligible] = useState([]);
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [amounts, setAmounts] = useState({});
  const [plannedDate, setPlannedDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [detail, setDetail] = useState(null);
  const [payment, setPayment] = useState({ date: new Date().toISOString().slice(0, 10), method: 'Transferencia', account: '', reference: '', file: null, notes: '' });
  const [allocations, setAllocations] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState(newKey);
  const [paymentRequestId, setPaymentRequestId] = useState(newKey);

  async function loadOrders() {
    const { data } = await api.get(base);
    setOrders(data.rows || []);
  }
  async function loadSuppliers() {
    const { data } = await api.get('/accounts-payable/documents', { params: { status: 'por_pagar' } });
    const unique = new Map();
    (data.rows || []).forEach((row) => {
      if (row.supplier_id) unique.set(Number(row.supplier_id), { id: Number(row.supplier_id), name: row.supplier_name });
    });
    setSuppliers(Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name)));
  }
  async function openOrder(id) {
    const { data } = await api.get(`${base}/${id}`);
    setDetail(data);
    setAllocations({});
    setPayment((old) => ({ ...old, method: data.order.payment_method || 'Transferencia' }));
    setPaymentRequestId(newKey());
    setView('detail');
  }
  useEffect(() => {
    Promise.all([loadOrders(), loadSuppliers()]).catch((e) => setError(e?.response?.data?.error || 'No se pudieron cargar las órdenes.'));
    if (initialOrderId) openOrder(initialOrderId).catch((e) => setError(e?.response?.data?.error || 'No se pudo cargar la orden.'));
  }, []);
  useEffect(() => {
    let active = true;
    setEligible([]);
    setSelectedKeys([]);
    setAmounts({});
    if (!supplierId) return;
    api.get(`${base}/eligible`, { params: { supplier_id: supplierId } })
      .then(({ data }) => {
        if (!active) return;
        const rows = data.rows || [];
        setEligible(rows);
        const preselected = rows.filter((row) => initialDocumentKeys.includes(`${row.source_type}:${row.source_id}`) && Number(row.available_amount) > 0);
        const currency = preselected[0]?.currency_code;
        const matching = preselected.filter((row) => row.currency_code === currency);
        setSelectedKeys(matching.map((row) => `${row.source_type}:${row.source_id}`));
        setAmounts(Object.fromEntries(matching.map((row) => [`${row.source_type}:${row.source_id}`, String(row.available_amount)])));
      })
      .catch((e) => { if (active) setError(e?.response?.data?.error || 'No se pudieron cargar los documentos.'); });
    return () => { active = false; };
  }, [supplierId]);

  const selected = useMemo(() => eligible.filter((row) => selectedKeys.includes(`${row.source_type}:${row.source_id}`)), [eligible, selectedKeys]);
  const currency = selected[0]?.currency_code || '';
  const total = selected.reduce((sum, row) => sum + Number(amounts[`${row.source_type}:${row.source_id}`] || 0), 0);
  const selectedCurrencies = new Set(selected.map((row) => row.currency_code));
  const availableAccounts = filterCompanyBankAccounts(companyAccounts, detail?.order?.currency_code || currency || 'PYG');
  const paymentTotal = Object.values(allocations).reduce((sum, value) => sum + Number(value || 0), 0);

  function toggleDocument(row) {
    const key = `${row.source_type}:${row.source_id}`;
    if (selectedKeys.includes(key)) {
      setSelectedKeys((old) => old.filter((item) => item !== key));
      setAmounts((old) => { const next = { ...old }; delete next[key]; return next; });
    } else {
      setSelectedKeys((old) => [...old, key]);
      setAmounts((old) => ({ ...old, [key]: String(row.available_amount) }));
    }
  }

  async function createOrder() {
    if (!selected.length || selectedCurrencies.size !== 1) return setError('Seleccione documentos de una sola moneda.');
    if (!paymentMethod) return setError('Seleccione un método de pago.');
    if (selected.some((row) => !Number.isFinite(Number(amounts[`${row.source_type}:${row.source_id}`])) || Number(amounts[`${row.source_type}:${row.source_id}`]) <= 0)) return setError('Ingrese un importe mayor a cero para cada documento seleccionado.');
    if (selected.some((row) => Number(amounts[`${row.source_type}:${row.source_id}`]) > Number(row.available_amount) + 0.001)) return setError('Un importe supera el disponible.');
    setBusy(true); setError('');
    try {
      const { data } = await api.post(base, {
        request_id: requestId, supplier_id: Number(supplierId), planned_payment_date: plannedDate || null,
        payment_method: paymentMethod,
        notes: notes || null,
        items: selected.map((row) => ({ source_type: row.source_type, source_id: row.source_id, amount: Number(amounts[`${row.source_type}:${row.source_id}`]) })),
      });
      setRequestId(newKey());
      await loadOrders();
      await openOrder(data.order.id);
      onChanged?.();
    } catch (e) { setError(e?.response?.data?.error || 'No se pudo crear la orden.'); }
    finally { setBusy(false); }
  }

  async function changeStatus(action, payload = {}) {
    setBusy(true); setError('');
    try {
      await api.post(`${base}/${detail.order.id}/${action}`, payload);
      await openOrder(detail.order.id);
      await loadOrders();
      onChanged?.();
    } catch (e) { setError(e?.response?.data?.error || 'No se pudo actualizar la orden.'); }
    finally { setBusy(false); }
  }

  async function registerPayment() {
    if (!payment.file || !payment.account || !payment.date || paymentTotal <= 0) return setError('Complete importes, cuenta, fecha y comprobante.');
    if (payment.method === 'Transferencia' && !payment.reference.trim()) return setError('La transferencia requiere referencia.');
    setBusy(true); setError('');
    try {
      const form = new FormData();
      form.append('request_id', paymentRequestId);
      form.append('payment_date', payment.date);
      form.append('method', payment.method);
      form.append('company_account', payment.account);
      form.append('reference_number', payment.reference);
      form.append('notes', payment.notes);
      form.append('receipt', payment.file);
      form.append('allocations', JSON.stringify(detail.items.filter((item) => Number(allocations[item.id] || 0) > 0).map((item) => ({ item_id: item.id, amount: Number(allocations[item.id]) }))));
      await api.post(`${base}/${detail.order.id}/payments`, form);
      setPaymentRequestId(newKey());
      setPayment((old) => ({ ...old, file: null, reference: '', notes: '' }));
      await openOrder(detail.order.id);
      await loadOrders();
      onChanged?.();
    } catch (e) { setError(e?.response?.data?.error || 'No se pudo registrar el pago.'); }
    finally { setBusy(false); }
  }

  async function downloadReceipt(id, name) {
    try {
      const { data } = await api.get(`${base}/payments/${id}/receipt`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const link = document.createElement('a'); link.href = url; link.download = name || 'comprobante'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e?.response?.data?.error || 'No se pudo descargar el comprobante.'); }
  }

  async function downloadOrderPdf(id, name) {
    try {
      const { data } = await api.get(`${base}/${id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const link = document.createElement('a'); link.href = url; link.download = `${name}.pdf`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('No se pudo descargar la orden.'); }
  }

  async function toggleReconciliation(row) {
    const reconciled = Number(row.allocation_count) !== Number(row.reconciled_count);
    const notes = window.prompt(reconciled ? 'Referencia o nota de conciliación (opcional)' : 'Motivo para quitar la conciliación');
    if (notes === null) return;
    setBusy(true); setError('');
    try {
      await api.patch(`${base}/payments/${row.id}/reconciliation`, { reconciled, notes });
      await openOrder(detail.order.id);
    } catch (e) { setError(e?.response?.data?.error || 'No se pudo actualizar la conciliación.'); }
    finally { setBusy(false); }
  }

  function openDocument(item) {
    let url = '/admin-expenses';
    if (item.source_type === 'purchase-invoice') url = `/purchase-invoices/${item.source_id}`;
    if (item.source_type === 'operation-expense' && item.operation_id) {
      url = item.operation_type === 'service'
        ? `/service/cases/${item.operation_id}?tab=administracion`
        : `/operations/${item.operation_id}?tab=administracion`;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="fixed inset-0 z-[110] bg-black/40 p-2 md:p-6" role="dialog" aria-modal="true" aria-label="Órdenes de pago">
      <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <header className="flex items-center justify-between border-b px-5 py-3">
          <div className="flex items-center gap-4"><h2 className="text-lg font-semibold">Órdenes de pago</h2><nav className="flex gap-1 text-sm"><button className={`px-3 py-1.5 ${view === 'list' ? 'border-b-2 border-blue-600 font-semibold' : ''}`} onClick={() => setView('list')}>Todas</button><button className={`px-3 py-1.5 ${view === 'new' ? 'border-b-2 border-blue-600 font-semibold' : ''}`} onClick={() => setView('new')}>Nueva orden</button></nav></div>
          <button type="button" className="px-2 py-1 text-xl" onClick={onClose} aria-label="Cerrar">×</button>
        </header>
        {error && <div className="mx-5 mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}
        <div className="flex-1 overflow-auto p-5">
          {view === 'list' && <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2">Orden</th><th>Proveedor</th><th>Método previsto</th><th>Moneda</th><th>Total</th><th>Pagado</th><th>Estado</th><th></th></tr></thead><tbody>{orders.map((order) => <tr key={order.id} className="border-b"><td className="py-3 font-medium">{order.order_number}</td><td>{order.supplier_name}</td><td>{order.payment_method || '-'}</td><td>{order.currency_code}</td><td>{money(order.amount, order.currency_code)}</td><td>{money(order.paid_amount, order.currency_code)}</td><td>{order.status}</td><td><button className="text-blue-700 hover:underline" onClick={() => openOrder(order.id)}>Abrir</button></td></tr>)}</tbody></table>{!orders.length && <div className="py-8 text-center text-slate-500">Todavía no hay órdenes unificadas.</div>}</div>}
          {view === 'new' && <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4"><label className="text-sm">Proveedor<select className="mt-1 w-full rounded border px-3 py-2" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Seleccionar</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className="text-sm">Método de pago previsto<select className="mt-1 w-full rounded border px-3 py-2" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}><option value="">Seleccionar</option>{paymentMethods.map((method) => <option key={method} value={method}>{method}</option>)}</select></label><label className="text-sm">Fecha prevista<input type="date" className="mt-1 w-full rounded border px-3 py-2" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} /></label><label className="text-sm">Observaciones<input className="mt-1 w-full rounded border px-3 py-2" value={notes} onChange={(e) => setNotes(e.target.value)} /></label></div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead><tr className="border-b text-left"><th className="w-12 py-2">Elegir</th><th>Documento</th><th>Origen</th><th>Operación</th><th>Vence</th><th>Saldo</th><th>Disponible</th><th className="w-10" aria-label="Cargar total disponible" /><th className="w-36">A pagar</th></tr></thead>
                <tbody>{eligible.map((row) => {
                  const key = `${row.source_type}:${row.source_id}`;
                  const mismatch = currency && row.currency_code !== currency;
                  const checked = selectedKeys.includes(key);
                  return <tr key={key} className={`border-b ${checked ? 'bg-blue-50' : ''}`}>
                    <td><input type="checkbox" className="h-4 w-4 accent-blue-600" aria-label={`Incluir ${row.document_number || `documento ${row.source_id}`} en la orden`} checked={checked} disabled={!Number(row.available_amount) || mismatch} onChange={() => toggleDocument(row)} /></td>
                    <td className="py-2 font-medium">{row.document_number || `#${row.source_id}`}</td>
                    <td>{labels[row.source_type]}</td>
                    <td>{row.operation_reference || '-'}</td>
                    <td>{row.due_date ? String(row.due_date).slice(0, 10) : '-'}</td>
                    <td>{money(row.balance, row.currency_code)}</td>
                    <td>{row.unavailable_reason || money(row.available_amount, row.currency_code)}</td>
                    <td>
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center rounded border text-slate-600 hover:border-blue-500 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                        title="Cargar total disponible"
                        aria-label={`Cargar total disponible de ${row.document_number || `documento ${row.source_id}`}`}
                        disabled={!checked}
                        onClick={() => setAmounts((old) => ({ ...old, [key]: String(row.available_amount) }))}
                      >→</button>
                    </td>
                    <td><input type="number" min="0" max={row.available_amount} step="0.01" className="w-32 rounded border px-2 py-1" disabled={!checked} value={amounts[key] || ''} onChange={(e) => setAmounts((old) => ({ ...old, [key]: e.target.value }))} placeholder="0" /></td>
                  </tr>;
                })}</tbody>
              </table>
              {supplierId && !eligible.length && <div className="py-8 text-center text-slate-500">Sin documentos pendientes para este proveedor.</div>}
            </div>
            <div className="flex items-center justify-end gap-4 border-t pt-4"><span className="text-sm text-slate-600">{selected.length} seleccionado(s)</span><span className="font-semibold">Total: {money(total, currency || 'PYG')}</span><button disabled={busy || !selected.length || total <= 0} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50" onClick={createOrder}>Crear orden</button></div>
          </div>}
          {view === 'detail' && detail && <div className="space-y-5 text-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-semibold">{detail.order.order_number} · {detail.order.supplier_name}</h3><div className="text-slate-500">{detail.order.currency_code} · {detail.order.status} · Método previsto: {detail.order.payment_method || '-'} · Beneficiario: {detail.order.beneficiary_account || 'sin cuenta registrada'}</div></div><div className="flex gap-2"><button onClick={() => downloadOrderPdf(detail.order.id, detail.order.order_number)} className="rounded border px-3 py-2">Descargar PDF</button>{detail.order.status === 'pendiente' && isAdmin && <button disabled={busy} onClick={() => changeStatus('approve')} className="rounded bg-blue-600 px-3 py-2 text-white">Aprobar</button>}{isAdmin && Number(detail.order.paid_amount) === 0 && detail.order.status !== 'anulada' && <button disabled={busy} onClick={() => { const reason = window.prompt('Motivo de anulación'); if (reason?.trim()) changeStatus('cancel', { reason }); }} className="rounded border px-3 py-2">Anular</button>}</div></div>
            <div className="overflow-x-auto"><table className="min-w-full"><thead><tr className="border-b text-left"><th className="py-2">Documento</th><th>Origen</th><th>Incluido</th><th>Pagado</th><th>Restante</th>{['aprobada', 'pago_parcial'].includes(detail.order.status) && <th>A aplicar</th>}</tr></thead><tbody>{detail.items.map((item) => <tr key={item.id} className="border-b"><td className="py-2"><button className="text-blue-700 hover:underline" onClick={() => openDocument(item)}>{item.document_number || `#${item.source_id}`}</button></td><td>{labels[item.source_type]}</td><td>{money(item.amount, detail.order.currency_code)}</td><td>{money(item.paid_amount, detail.order.currency_code)}</td><td>{money(Number(item.amount) - Number(item.paid_amount), detail.order.currency_code)}</td>{['aprobada', 'pago_parcial'].includes(detail.order.status) && <td><input type="number" min="0" max={Number(item.amount) - Number(item.paid_amount)} step="0.01" className="w-32 rounded border px-2 py-1" value={allocations[item.id] || ''} onChange={(e) => setAllocations((old) => ({ ...old, [item.id]: e.target.value }))} placeholder="0" /></td>}</tr>)}</tbody></table></div>
            <div className="flex justify-end gap-8 border-b pb-3 font-medium"><span>Total {money(detail.order.amount, detail.order.currency_code)}</span><span>Pagado {money(detail.order.paid_amount, detail.order.currency_code)}</span><span>Saldo {money(Number(detail.order.amount) - Number(detail.order.paid_amount), detail.order.currency_code)}</span></div>
            {['aprobada', 'pago_parcial'].includes(detail.order.status) && <div className="space-y-3"><h4 className="font-semibold">Registrar pago</h4><div className="grid gap-3 md:grid-cols-3"><label>Fecha<input type="date" className="mt-1 w-full rounded border px-3 py-2" value={payment.date} onChange={(e) => setPayment((old) => ({ ...old, date: e.target.value }))} /></label><label>Método<select className="mt-1 w-full rounded border px-3 py-2" value={payment.method} onChange={(e) => setPayment((old) => ({ ...old, method: e.target.value }))}>{paymentMethods.map((method) => <option key={method}>{method}</option>)}</select></label><label>Cuenta de origen{availableAccounts.length ? <select className="mt-1 w-full rounded border px-3 py-2" value={payment.account} onChange={(e) => setPayment((old) => ({ ...old, account: e.target.value }))}><option value="">Seleccionar</option>{availableAccounts.map((account) => <option key={companyBankAccountValue(account)} value={companyBankAccountValue(account)}>{companyBankAccountLabel(account)}</option>)}</select> : <input className="mt-1 w-full rounded border px-3 py-2" placeholder="Cuenta o caja" value={payment.account} onChange={(e) => setPayment((old) => ({ ...old, account: e.target.value }))} />}</label><label>Referencia bancaria<input className="mt-1 w-full rounded border px-3 py-2" value={payment.reference} onChange={(e) => setPayment((old) => ({ ...old, reference: e.target.value }))} /></label><label>Comprobante<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="mt-1 block w-full text-xs" onChange={(e) => setPayment((old) => ({ ...old, file: e.target.files?.[0] || null }))} /></label><label>Notas<input className="mt-1 w-full rounded border px-3 py-2" value={payment.notes} onChange={(e) => setPayment((old) => ({ ...old, notes: e.target.value }))} /></label></div><div className="flex items-center justify-end gap-3"><span className="font-semibold">A registrar: {money(paymentTotal, detail.order.currency_code)}</span><button disabled={busy || paymentTotal <= 0} onClick={registerPayment} className="rounded bg-emerald-600 px-4 py-2 text-white disabled:opacity-50">Registrar pago</button></div></div>}
            {!!detail.payments.length && <div><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">Pagos registrados</h4><a href="/admin-ops/bank-reconciliation" target="_blank" rel="noopener noreferrer" className="text-sm text-blue-700 underline">Conciliación bancaria</a></div>{detail.payments.map((row) => <div key={row.id} className="flex flex-wrap justify-between gap-2 border-b py-2"><span>{String(row.payment_date).slice(0, 10)} · {row.method} · {row.reference_number || '-'}</span><span>{money(row.amount, detail.order.currency_code)}</span><button className="text-blue-700 hover:underline" onClick={() => downloadReceipt(row.id, row.receipt_name)}>Comprobante</button><button disabled={busy || !!row.bank_movement_id} className="text-blue-700 hover:underline disabled:opacity-50" onClick={() => toggleReconciliation(row)}>{row.bank_movement_id ? 'Conciliado con banco' : Number(row.allocation_count) === Number(row.reconciled_count) ? 'Conciliado manualmente' : 'Conciliar manualmente'}</button></div>)}</div>}
            {!!detail.events?.length && <div><h4 className="mb-2 font-semibold">Historial</h4>{detail.events.map((event, index) => <div key={index} className="border-b py-2 text-slate-600">{new Date(event.created_at).toLocaleString('es-PY')} · {({ created: 'Creada', approved: 'Aprobada', cancelled: 'Anulada', payment_registered: 'Pago registrado', reconciled: 'Conciliado', reconciliation_removed: 'Conciliación retirada' })[event.event_type] || event.event_type} · Usuario #{event.actor_user_id || '-'}</div>)}</div>}
          </div>}
        </div>
      </div>
    </div>
  );
}
