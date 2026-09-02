import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth.jsx';

const MILESTONE_LABELS = {
  supplier_start_payment: 'Pago al proveedor para iniciar fabricación',
  manufacturing_start: 'Inicio de fabricación',
  factory_departure: 'Salida de fábrica',
  paraguay_arrival: 'Llegada a Paraguay',
  installation: 'Instalación',
};

function money(value, currency) {
  return new Intl.NumberFormat('es-PY', {
    minimumFractionDigits: currency === 'PYG' ? 0 : 2,
    maximumFractionDigits: currency === 'PYG' ? 0 : 2,
  }).format(Number(value || 0));
}

function makeTemplate(total, currency) {
  const round = (value) => currency === 'PYG' ? Math.round(value) : Math.round(value * 100) / 100;
  const first = round(total * 0.6);
  const second = round(total * 0.3);
  return [
    { concept: 'Anticipo', percentage: 60, planned_amount: first, expected_date: '', notes: '' },
    { concept: 'Entrega', percentage: 30, planned_amount: second, expected_date: '', notes: '' },
    { concept: 'Instalación', percentage: 10, planned_amount: round(total - first - second), expected_date: '', notes: '' },
  ];
}

function editableRows(invoice) {
  if (!invoice.plan) return makeTemplate(Number(invoice.net_total || 0), invoice.currency_code);
  return invoice.plan.installments.map((item) => ({
    id: item.id,
    concept: item.concept,
    percentage: item.percentage == null ? '' : Math.round(Number(item.percentage || 0)),
    planned_amount: Number(item.planned_amount || 0),
    expected_date: item.expected_date || '',
    notes: item.notes || '',
  }));
}

function statusStyle(status) {
  if (status === 'cancelada') return 'bg-emerald-100 text-emerald-800';
  if (status === 'parcial') return 'bg-sky-100 text-sky-800';
  if (status === 'atrasada') return 'bg-red-100 text-red-800';
  if (status === 'programada') return 'bg-amber-100 text-amber-800';
  return 'bg-slate-100 text-slate-700';
}

function revisionKey(invoice) {
  const revisionId = Number(invoice?.quote_revision_id || 0);
  return revisionId > 0 ? 'revision-' + revisionId : 'current';
}

export default function IndustrialLogisticsCollections({ dealId, selectedRevisionId = null }) {
  const { user } = useAuth();
  const canCorrectAllocations = ['admin', 'finanzas'].includes(String(user?.role || '').toLowerCase());
  const [data, setData] = useState(null);
  const [revisionFilter, setRevisionFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({});
  const [milestones, setMilestones] = useState([]);
  const [dirtySources, setDirtySources] = useState(() => new Set());
  const dirty = dirtySources.size > 0;
  const markDirty = (sourceKey) => setDirtySources((current) => new Set(current).add(sourceKey));
  const clearDirty = (sourceKey) => setDirtySources((current) => { const next = new Set(current); next.delete(sourceKey); return next; });
  const [allocationEditor, setAllocationEditor] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data: payload } = await api.get(`/industrial-planning/deals/${dealId}`);
      setData(payload);
      setDrafts(Object.fromEntries((payload.invoices || []).map((invoice) => [invoice.id, editableRows(invoice)])));
      const byKey = new Map((payload.milestones || []).map((item) => [item.milestone_key, item]));
      setMilestones(Object.keys(MILESTONE_LABELS).map((key) => ({
        milestone_key: key,
        expected_date: byKey.get(key)?.expected_date?.slice(0, 10) || '',
        actual_date: byKey.get(key)?.actual_date?.slice(0, 10) || '',
        notes: byKey.get(key)?.notes || '',
      })));
      setDirtySources(new Set());
    } catch (err) {
      setError(err?.response?.data?.error || 'No se pudo cargar la planificación.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [dealId]);
  useEffect(() => {
    const revisionId = Number(selectedRevisionId || 0);
    if (!data?.invoices?.length || revisionId <= 0) return;
    const key = 'revision-' + revisionId;
    if (data.invoices.some((invoice) => revisionKey(invoice) === key)) {
      setRevisionFilter(key);
    }
  }, [data?.invoices, selectedRevisionId]);

  useEffect(() => {
    const warn = (event) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const updateRow = (invoice, index, key, value) => {
    setDrafts((current) => {
      const rows = [...(current[invoice.id] || [])];
      const normalizedValue = key === 'percentage' && value !== ''
        ? Math.max(0, Math.min(100, Math.round(Number(value || 0))))
        : value;
      const row = { ...rows[index], [key]: normalizedValue };
      if (key === 'percentage') row.planned_amount = Number(((Number(invoice.net_total || 0) * Number(normalizedValue || 0)) / 100).toFixed(invoice.currency_code === 'PYG' ? 0 : 2));
      if (key === 'planned_amount') row.percentage = Number(invoice.net_total || 0) > 0 ? Math.round((Number(value || 0) / Number(invoice.net_total)) * 100) : 0;
      rows[index] = row;
      return { ...current, [invoice.id]: rows };
    });
    markDirty(`invoice-${invoice.id}`);
  };

  const savePlan = async (invoice) => {
    setSaving(`invoice-${invoice.id}`);
    setError('');
    try {
      const { data: payload } = await api.put(`/industrial-planning/deals/${dealId}/invoices/${invoice.id}/plan`, {
        version: invoice.plan?.version ?? null,
        installments: drafts[invoice.id] || [],
      });
      setData(payload);
      const savedInvoice = (payload.invoices || []).find((item) => Number(item.id) === Number(invoice.id));
      if (savedInvoice) setDrafts((current) => ({ ...current, [invoice.id]: editableRows(savedInvoice) }));
      clearDirty(`invoice-${invoice.id}`);
    } catch (err) {
      setError(err?.response?.data?.error || 'No se pudo guardar el plan de cobros.');
    } finally {
      setSaving('');
    }
  };

  const saveMilestones = async () => {
    setSaving('milestones');
    setError('');
    try {
      const { data: payload } = await api.put(`/industrial-planning/deals/${dealId}/milestones`, { milestones });
      setData(payload);
      clearDirty('milestones');
    } catch (err) {
      setError(err?.response?.data?.error || 'No se pudieron guardar los hitos.');
    } finally {
      setSaving('');
    }
  };

  const openAllocation = (invoice, receiptId) => {
    if (dirty) { alert('Guarda los cambios pendientes antes de redistribuir un recibo.'); return; }
    const values = {};
    let receiptNumber = '';
    let total = 0;
    for (const installment of invoice.plan?.installments || []) {
      const parts = (installment.receipts || []).filter((receipt) => Number(receipt.id) === Number(receiptId));
      values[installment.id] = parts.reduce((sum, receipt) => sum + Number(receipt.debt_applied || 0), 0);
      for (const receipt of parts) {
        receiptNumber = receipt.receipt_number || receiptNumber;
        total += Number(receipt.debt_applied || 0);
      }
    }
    setAllocationEditor({ invoiceId: invoice.id, receiptId, receiptNumber, total, currency: invoice.currency_code, values, installments: invoice.plan?.installments || [] });
  };

  const saveAllocation = async () => {
    if (!allocationEditor) return;
    setSaving('allocation');
    setError('');
    try {
      await api.put(`/industrial-planning/invoices/${allocationEditor.invoiceId}/receipt-allocation`, {
        receipt_id: allocationEditor.receiptId,
        allocations: allocationEditor.installments.map((item) => ({ installment_id: item.id, amount: Number(allocationEditor.values[item.id] || 0) })),
      });
      setAllocationEditor(null);
      await load();
    } catch (err) {
      setError(err?.response?.data?.error || 'No se pudo redistribuir el recibo.');
    } finally {
      setSaving('');
    }
  };

  const revisionOptions = useMemo(() => {
    const options = new Map();
    for (const invoice of data?.invoices || []) {
      const key = revisionKey(invoice);
      if (!options.has(key)) {
        const fallback = key === 'current' ? 'Revisión actual' : 'Revisión #' + invoice.quote_revision_id;
        options.set(key, invoice.revision_name || fallback);
      }
    }
    return Array.from(options, ([value, label]) => ({ value, label }));
  }, [data?.invoices]);
  const visibleInvoices = useMemo(() => {
    const invoices = data?.invoices || [];
    return revisionFilter === 'all'
      ? invoices
      : invoices.filter((invoice) => revisionKey(invoice) === revisionFilter);
  }, [data?.invoices, revisionFilter]);
  const summaryEntries = useMemo(() => {
    if (revisionFilter === 'all') return Object.entries(data?.summary || {});
    const summary = {};
    for (const invoice of visibleInvoices) {
      const currency = String(invoice.currency_code || 'PYG').toUpperCase();
      if (!summary[currency]) {
        summary[currency] = { invoiced: 0, credited: 0, debt_paid: 0, cash_received: 0, retention: 0, pending: 0 };
      }
      summary[currency].invoiced += Number(invoice.total_amount || 0);
      summary[currency].credited += Number(invoice.credited_total || 0);
      summary[currency].debt_paid += Number(invoice.debt_paid || 0);
      summary[currency].cash_received += Number(invoice.cash_received || 0);
      summary[currency].retention += Number(invoice.retention_total || 0);
      summary[currency].pending += Math.max(0, Number(invoice.net_total || 0) - Number(invoice.debt_paid || 0));
    }
    return Object.entries(summary);
  }, [data?.summary, revisionFilter, visibleInvoices]);

  if (loading) return <div className="rounded-lg border bg-white p-5 text-sm text-slate-600">Cargando logística y cobros...</div>;
  if (error && !data) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>;
  if (!data?.enabled) return <div className="rounded-lg border bg-white p-5"><h2 className="font-semibold">Logística y cobros</h2><p className="mt-2 text-sm text-slate-600">Disponible cuando la operación tenga al menos una factura emitida.</p></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Logística y cobros</h2>
          <p className="text-sm text-slate-600">Las fechas planifican caja. Solo los recibos confirman cobros.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {revisionOptions.length > 0 && <label className="flex items-center gap-2 text-sm text-slate-600">
            Revisión facturada
            <select
              value={revisionFilter}
              onChange={(event) => setRevisionFilter(event.target.value)}
              className="rounded border bg-white px-3 py-2 text-slate-800"
            >
              <option value="all">Todas las revisiones</option>
              {revisionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>}
        </div>
        {dirty && <span className="rounded border border-amber-300 bg-amber-50 px-3 py-1 text-sm text-amber-800">Cambios sin guardar</span>}
      </div>
      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {summaryEntries.map(([currency, values]) => (
        <div key={currency} className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          {[
            ['Facturado', values.invoiced], ['Notas de crédito', values.credited], ['Cancelado', values.debt_paid],
            ['Efectivo recibido', values.cash_received], ['Retención', values.retention], ['Saldo', values.pending],
          ].map(([label, value]) => <div key={label} className="rounded border bg-white p-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 font-semibold">{currency} {money(value, currency)}</div></div>)}
        </div>
      ))}

      <section className="rounded-lg border bg-white p-4">
        <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Seguimiento logístico</h3><button type="button" onClick={saveMilestones} disabled={saving === 'milestones'} className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50">{saving === 'milestones' ? 'Guardando...' : 'Guardar hitos'}</button></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-sm">
            <thead><tr className="border-b bg-slate-50 text-left"><th className="p-2">Hito</th><th className="p-2">Fecha prevista</th><th className="p-2">Fecha real</th><th className="p-2">Observaciones</th></tr></thead>
            <tbody>{milestones.map((item, index) => <tr key={item.milestone_key} className="border-b last:border-0"><td className="p-2 font-medium">{MILESTONE_LABELS[item.milestone_key]}</td><td className="p-2"><input type="date" value={item.expected_date} onChange={(e) => { const next=[...milestones]; next[index]={...item,expected_date:e.target.value}; setMilestones(next); markDirty('milestones'); }} className="w-full rounded border px-2 py-1.5" /></td><td className="p-2"><input type="date" value={item.actual_date} onChange={(e) => { const next=[...milestones]; next[index]={...item,actual_date:e.target.value}; setMilestones(next); markDirty('milestones'); }} className="w-full rounded border px-2 py-1.5" /></td><td className="p-2"><input value={item.notes} onChange={(e) => { const next=[...milestones]; next[index]={...item,notes:e.target.value}; setMilestones(next); markDirty('milestones'); }} className="w-full rounded border px-2 py-1.5" placeholder="Detalle opcional" /></td></tr>)}</tbody>
          </table>
        </div>
      </section>

      {allocationEditor && <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"><div className="flex items-center justify-between"><h3 className="font-semibold">Distribuir {allocationEditor.receiptNumber}</h3><button type="button" onClick={() => setAllocationEditor(null)} className="h-8 w-8 rounded border">×</button></div><p className="mt-1 text-sm text-slate-600">Total aplicado: {allocationEditor.currency} {money(allocationEditor.total, allocationEditor.currency)}</p><div className="mt-4 space-y-3">{allocationEditor.installments.map((item) => <label key={item.id} className="grid grid-cols-[1fr_150px] items-center gap-3 text-sm"><span>{item.concept}</span><input type="number" min="0" step={allocationEditor.currency === 'PYG' ? '1' : '0.01'} value={allocationEditor.values[item.id] || 0} onChange={(event) => setAllocationEditor((current) => ({ ...current, values: { ...current.values, [item.id]: event.target.value } }))} className="rounded border px-2 py-1.5 text-right" /></label>)}</div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setAllocationEditor(null)} className="rounded border px-3 py-2">Cancelar</button><button type="button" onClick={saveAllocation} disabled={saving === 'allocation'} className="rounded bg-emerald-700 px-3 py-2 text-white disabled:opacity-50">{saving === 'allocation' ? 'Guardando...' : 'Guardar distribución'}</button></div></div></div>}

      {visibleInvoices.map((invoice) => {
        const rows = drafts[invoice.id] || [];
        const planned = rows.reduce((sum, row) => sum + Number(row.planned_amount || 0), 0);
        return <section key={invoice.id} className="rounded-lg border bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
            <div><a href={`/invoices/${invoice.id}`} className="font-semibold text-sky-700 hover:underline">Factura {invoice.invoice_number}</a><div className="text-xs text-slate-500">{invoice.issue_date?.slice(0,10)} · {invoice.revision_name || (invoice.quote_revision_id ? `Revisión #${invoice.quote_revision_id}` : 'Revisión actual')}</div></div>
            <div className="text-right text-sm"><div>Neto: <strong>{invoice.currency_code} {money(invoice.net_total, invoice.currency_code)}</strong></div><div className="text-slate-500">Planificado: {invoice.currency_code} {money(planned, invoice.currency_code)}</div></div>
          </div>
          {invoice.plan?.needs_review && <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">El total de la factura cambió por una nota de crédito o corrección. Revisa y guarda nuevamente las cuotas.</div>}
          <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[1050px] text-sm"><thead><tr className="border-b bg-slate-50 text-left"><th className="p-2">Concepto</th><th className="p-2 w-24">%</th><th className="p-2 w-36">Monto</th><th className="p-2 w-40">Fecha prevista</th><th className="p-2">Observación</th><th className="p-2">Cobrado/Saldo</th><th className="p-2 w-24">Estado</th><th className="p-2 w-12"></th></tr></thead>
          <tbody>{rows.map((row,index) => { const persisted=invoice.plan?.installments?.[index]; return <tr key={row.id || index} className="border-b"><td className="p-2"><input value={row.concept} onChange={(e)=>updateRow(invoice,index,'concept',e.target.value)} className="w-full rounded border px-2 py-1.5" /></td><td className="p-2"><input type="number" min="0" max="100" step="1" value={row.percentage} onChange={(e)=>updateRow(invoice,index,'percentage',e.target.value)} className="w-full rounded border px-2 py-1.5" /></td><td className="p-2"><input type="number" min="0" step={invoice.currency_code==='PYG'?'1':'0.01'} value={row.planned_amount} onChange={(e)=>updateRow(invoice,index,'planned_amount',e.target.value)} className="w-full rounded border px-2 py-1.5" /></td><td className="p-2"><input type="date" value={row.expected_date} onChange={(e)=>updateRow(invoice,index,'expected_date',e.target.value)} className="w-full rounded border px-2 py-1.5" /></td><td className="p-2"><input value={row.notes} onChange={(e)=>updateRow(invoice,index,'notes',e.target.value)} className="w-full rounded border px-2 py-1.5" /></td><td className="p-2 text-xs">{persisted ? <><div>Cancelado: {money(persisted.debt_paid,invoice.currency_code)}</div><div>Efectivo: {money(persisted.cash_received,invoice.currency_code)}</div><div>Saldo: {money(persisted.balance,invoice.currency_code)}</div></> : 'Sin guardar'}</td><td className="p-2">{persisted ? <span className={`rounded px-2 py-1 text-xs ${statusStyle(persisted.status)}`}>{persisted.status.replace('_',' ')}</span> : '-'}</td><td className="p-2"><button type="button" title="Quitar cuota" onClick={()=>{ setDrafts((current)=>({...current,[invoice.id]:rows.filter((_,i)=>i!==index)})); markDirty(`invoice-${invoice.id}`); }} className="h-8 w-8 rounded border text-red-700">×</button></td></tr>; })}</tbody></table></div>
          {canCorrectAllocations && invoice.plan && (() => {
            const receipts = new Map();
            for (const installment of invoice.plan.installments || []) {
              for (const receipt of installment.receipts || []) receipts.set(Number(receipt.id), receipt);
            }
            return receipts.size ? <div className="mt-3 flex flex-wrap items-center gap-2 rounded border bg-slate-50 p-3 text-sm"><span className="font-medium">Distribución de recibos:</span>{Array.from(receipts.values()).map((receipt) => <button key={receipt.id} type="button" onClick={() => openAllocation(invoice, receipt.id)} className="rounded border bg-white px-2 py-1 text-sky-700">{receipt.receipt_number || `Recibo #${receipt.id}`}</button>)}</div> : null;
          })()}
          <div className="mt-3 flex flex-wrap justify-between gap-2"><div className="flex gap-2"><button type="button" onClick={()=>{ setDrafts((current)=>({...current,[invoice.id]:[...(current[invoice.id]||[]),{concept:`Cuota ${(current[invoice.id]||[]).length+1}`,percentage:0,planned_amount:0,expected_date:'',notes:''}]})); markDirty(`invoice-${invoice.id}`); }} className="rounded border px-3 py-2 text-sm">+ Cuota</button><button type="button" onClick={()=>{ const next=[...rows]; if(next[1]?.expected_date && next[2]) next[2]={...next[2],expected_date:next[1].expected_date}; setDrafts((current)=>({...current,[invoice.id]:next})); markDirty(`invoice-${invoice.id}`); }} className="rounded border px-3 py-2 text-sm">Copiar fecha 30% al 10%</button></div><button type="button" onClick={()=>savePlan(invoice)} disabled={Boolean(saving)} className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving===`invoice-${invoice.id}`?'Guardando...':'Guardar plan'}</button></div>
        </section>;
      })}
      {!visibleInvoices.length && <div className="rounded-lg border border-dashed bg-white p-6 text-center text-sm text-slate-600">No hay facturas emitidas vinculadas a esta revisión.</div>}
    </div>
  );
}
