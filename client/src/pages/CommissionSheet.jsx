import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth.jsx';
import CommissionPanel from '../components/CommissionPanel.jsx';

const money = (value, code = 'PYG') => `${code} ${Number(value || 0).toLocaleString('es-PY', { minimumFractionDigits: code === 'PYG' ? 0 : 2, maximumFractionDigits: code === 'PYG' ? 0 : 2 })}`;
const statusLabel = (status) => ({ borrador: 'Borrador', enviada_aprobacion: 'Pendiente aprobacion', aprobada_facturar: 'Aprobada para facturar', facturada: 'Facturada', pago_parcial: 'Pago parcial', pagada: 'Pagada', anulada: 'Anulada' }[status] || status || '-');

export default function CommissionSheet() {
  const { user } = useAuth();
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [filters, setFilters] = useState({ user_id: '', status: '', business_unit: '' });
  const [selected, setSelected] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [error, setError] = useState('');
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [availableOperations, setAvailableOperations] = useState([]);
  const [newOperationId, setNewOperationId] = useState('');
  const [invoice, setInvoice] = useState({ supplier_org_id: '', receipt_number: '', timbrado_number: '', invoice_date: '', due_date: '', condition_type: 'CREDITO', iva_rate: 10, allocations: {} });

  const load = async () => {
    try {
      const { data } = await api.get('/commissions', { params: filters });
      setRows(data || []);
    } catch (e) {
      setError(e?.response?.data?.error || 'No se pudo cargar la planilla.');
    }
  };

  useEffect(() => { load(); }, [filters.user_id, filters.status, filters.business_unit]);
  useEffect(() => {
    if (isAdmin) api.get('/users/select', { params: { active: 1 } }).then(({ data }) => setUsers(data || [])).catch(() => {});
    api.get('/organizations', { params: { tipo_org: 'Proveedor', limit: 1000 } }).then(({ data }) => setSuppliers(Array.isArray(data) ? data : data?.rows || [])).catch(() => {});
  }, [isAdmin]);

  const totals = useMemo(() => rows.filter((row) => row.status !== 'anulada').reduce((acc, row) => {
    const code = row.currency_code || 'PYG';
    acc[code] = acc[code] || { profit: 0, commissionGross: 0, iva: 0, commissionNet: 0, atm: 0 };
    acc[code].profit += Number(row.budgeted_profit || 0);
    acc[code].commissionGross += Number(row.commission_gross || 0);
    acc[code].iva += Number(row.commission_iva || 0);
    acc[code].commissionNet += Number(row.commission_net || 0);
    acc[code].atm += Number(row.profit_atm || 0);
    return acc;
  }, {}), [rows]);

  const selectedRows = rows.filter((row) => selectedIds.has(Number(row.id)) && row.status === 'aprobada_facturar');
  const invoiceTotal = selectedRows.reduce((sum, row) => sum + Number(invoice.allocations[row.id] ?? row.commission_gross ?? 0), 0);
  const toggle = (id) => setSelectedIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const openInvoice = () => {
    const allocations = {};
    selectedRows.forEach((row) => { allocations[row.id] = Number(row.commission_gross || 0); });
    setInvoice({ supplier_org_id: '', receipt_number: '', timbrado_number: '', invoice_date: '', due_date: '', condition_type: 'CREDITO', iva_rate: 10, allocations });
    setInvoiceOpen(true);
  };

  const saveInvoice = async () => {
    try {
      const currencies = new Set(selectedRows.map((row) => row.currency_code || 'PYG'));
      if (currencies.size !== 1) throw new Error('Una factura solo puede asignarse a operaciones de la misma moneda.');
      const allocations = selectedRows.map((row) => ({ liquidation_id: row.id, amount: Number(invoice.allocations[row.id] || 0) })).filter((row) => row.amount > 0);
      await api.post('/commissions/invoices', { ...invoice, supplier_org_id: Number(invoice.supplier_org_id), amount_gross: invoiceTotal, currency_code: selectedRows[0].currency_code, allocations });
      setInvoiceOpen(false);
      setSelectedIds(new Set());
      await load();
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'No se pudo registrar la factura.');
    }
  };

  const openCreate = async () => {
    try {
      const { data } = await api.get('/commissions/available-operations', { params: { business_unit: filters.business_unit || undefined } });
      setAvailableOperations(data || []);
      setNewOperationId('');
      setCreateOpen(true);
    } catch (e) {
      setError(e?.response?.data?.error || 'No se pudieron cargar operaciones.');
    }
  };

  const createLiquidation = async () => {
    try {
      await api.post(`/commissions/operation/${newOperationId}`, {});
      setCreateOpen(false);
      await load();
    } catch (e) {
      setError(e?.response?.data?.error || 'No se pudo crear la liquidacion.');
    }
  };

  const cancelLiquidation = async (row) => {
    const reason = window.prompt('Motivo de eliminacion/anulacion de la liquidacion');
    if (!reason?.trim()) return;
    if (!window.confirm('La liquidacion quedara anulada y visible en historial. Deseas continuar?')) return;
    try {
      await api.post(`/commissions/${row.id}/cancel`, { reason: reason.trim() });
      await load();
    } catch (e) {
      setError(e?.response?.data?.error || 'No se pudo eliminar la liquidacion.');
    }
  };

  const exportPdf = async () => {
    const popup = window.open('', '_blank');
    try {
      const { data } = await api.get('/commissions/export/pdf', {
        params: isAdmin && filters.user_id ? { user_id: filters.user_id } : {},
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      if (popup) popup.location.href = url;
      else window.open(url, '_blank');
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      popup?.close();
      setError(e?.response?.data?.error || 'No se pudo generar el PDF.');
    }
  };

  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-semibold">Planilla de comisiones</h1><p className="text-sm text-slate-500">Liquidaciones comerciales, facturas y trazabilidad por operacion.</p></div>
      <div className="flex gap-2">
        <button type="button" className="rounded bg-black px-3 py-2 text-sm text-white" onClick={openCreate}>Nueva liquidacion</button>
        <button type="button" className="rounded border px-3 py-2 text-sm" onClick={exportPdf}>Exportar PDF</button>
        {selectedRows.length ? <button type="button" className="rounded bg-black px-3 py-2 text-sm text-white" onClick={openInvoice}>Registrar factura ({selectedRows.length})</button> : null}
      </div>
    </div>

    {error ? <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

    <div className="flex flex-wrap gap-2 rounded-lg border bg-white p-3">
      {isAdmin ? <select className="rounded border px-3 py-2 text-sm" value={filters.user_id} onChange={(e) => setFilters({ ...filters, user_id: e.target.value })}><option value="">Todos los ejecutivos</option>{users.map((item) => <option key={item.id} value={item.id}>{item.name || item.email}</option>)}</select> : null}
      <select className="rounded border px-3 py-2 text-sm" value={filters.business_unit} onChange={(e) => setFilters({ ...filters, business_unit: e.target.value })}><option value="">Cargo + Industrial</option><option value="atm-cargo">ATM Cargo</option><option value="atm-industrial">ATM Industrial</option></select>
      <select className="rounded border px-3 py-2 text-sm" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">Todos los estados</option><option value="borrador">Borrador</option><option value="enviada_aprobacion">Pendiente aprobacion</option><option value="aprobada_facturar">Aprobada para facturar</option><option value="facturada">Facturada</option><option value="pagada">Pagada</option><option value="anulada">Anulada</option></select>
    </div>

    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {Object.entries(totals).map(([code, total]) => <div key={code} className="rounded-lg border bg-white p-3 text-sm"><b>{code}</b><div>Profit ventas: {money(total.profit, code)}</div><div>Comision bruta: {money(total.commissionGross, code)}</div><div>IVA descontado: {money(total.iva, code)}</div><div>Comision vendedor: {money(total.commissionNet, code)}</div><div>Profit ATM: {money(total.atm, code)}</div></div>)}
    </div>

    <div className="overflow-auto rounded-lg border bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-100 text-slate-600"><tr><th className="px-3 py-2" />{['REF.', 'Cliente', 'Ejecutivo', 'Compra', 'Venta', 'Profit', '%', 'Comision bruta', 'IVA descontado', 'Comision vendedor', 'Profit ATM', 'Estado', 'Acciones'].map((heading) => <th key={heading} className="px-3 py-2 text-left">{heading}</th>)}</tr></thead>
        <tbody>
          {rows.map((row) => {
            const isCancelled = row.status === 'anulada';
            return <tr key={row.id} onDoubleClick={() => setSelected(row)} className={`cursor-pointer border-t hover:bg-slate-50 ${isCancelled ? 'bg-red-50 text-red-800 line-through decoration-red-500' : ''}`}>
              <td className="px-3 py-2"><input type="checkbox" disabled={row.status !== 'aprobada_facturar'} checked={selectedIds.has(Number(row.id))} onClick={(event) => event.stopPropagation()} onChange={() => toggle(Number(row.id))} /></td>
              <td className="px-3 py-2 font-medium">{row.reference}</td>
              <td className="px-3 py-2">{row.client_name || row.title}</td>
              <td className="px-3 py-2">{row.advisor_name}</td>
              <td className="px-3 py-2">{money(row.budgeted_purchase, row.currency_code)}</td>
              <td className="px-3 py-2">{money(row.budgeted_sale, row.currency_code)}</td>
              <td className="px-3 py-2">{money(row.budgeted_profit, row.currency_code)}</td>
              <td className="px-3 py-2">{(Number(row.commission_rate || 0) * 100).toFixed(2)}%</td>
              <td className="px-3 py-2">{money(row.commission_gross, row.currency_code)}</td>
              <td className="px-3 py-2"><div>{Number(row.iva_rate)}%</div><div className="font-medium text-red-700">-{money(row.commission_iva, row.currency_code)}</div></td>
              <td className="px-3 py-2 font-medium">{money(row.commission_net, row.currency_code)}</td>
              <td className="px-3 py-2">{money(row.profit_atm, row.currency_code)}</td>
              <td className="px-3 py-2"><div>{statusLabel(row.status)}</div>{isCancelled ? <div className="text-xs no-underline">Por {row.cancelled_by_name || 'usuario'}: {row.cancel_reason || 'Sin motivo'}</div> : null}</td>
              <td className="px-3 py-2">{!isCancelled && ['borrador', 'enviada_aprobacion', 'aprobada_facturar'].includes(row.status) ? <button type="button" onClick={(event) => { event.stopPropagation(); cancelLiquidation(row); }} className="rounded border border-red-200 px-2 py-1 text-xs text-red-700">Eliminar</button> : null}</td>
            </tr>;
          })}
          {!rows.length ? <tr><td colSpan="14" className="px-3 py-5 text-center text-slate-500">Sin liquidaciones todavia.</td></tr> : null}
        </tbody>
      </table>
    </div>

    {selected ? <div className="fixed inset-0 z-50 flex justify-end bg-black/30"><div className="h-full w-full max-w-3xl overflow-auto bg-slate-50 p-5"><div className="mb-4 flex justify-between"><h2 className="font-semibold">Comision - {selected.reference}</h2><button onClick={() => setSelected(null)}>Cerrar</button></div><CommissionPanel operationId={selected.operation_id} onChanged={load} /></div></div> : null}

    {invoiceOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-3xl rounded-lg bg-white p-5"><div className="flex justify-between"><h2 className="font-semibold">Factura de comision para varias operaciones</h2><button onClick={() => setInvoiceOpen(false)}>Cerrar</button></div><div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2"><label className="text-sm md:col-span-2">Proveedor<select className="mt-1 w-full rounded border px-3 py-2" value={invoice.supplier_org_id} onChange={(e) => setInvoice({ ...invoice, supplier_org_id: e.target.value })}><option value="">Seleccionar proveedor</option>{suppliers.map((item) => <option key={item.id} value={item.id}>{item.razon_social || item.name} {item.ruc ? `- ${item.ruc}` : ''}</option>)}</select></label><label className="text-sm">Comprobante<input className="mt-1 w-full rounded border px-3 py-2" value={invoice.receipt_number} onChange={(e) => setInvoice({ ...invoice, receipt_number: e.target.value })}/></label><label className="text-sm">Timbrado<input className="mt-1 w-full rounded border px-3 py-2" value={invoice.timbrado_number} onChange={(e) => setInvoice({ ...invoice, timbrado_number: e.target.value })}/></label><label className="text-sm">Fecha<input type="date" className="mt-1 w-full rounded border px-3 py-2" value={invoice.invoice_date} onChange={(e) => setInvoice({ ...invoice, invoice_date: e.target.value })}/></label><label className="text-sm">Condicion<select className="mt-1 w-full rounded border px-3 py-2" value={invoice.condition_type} onChange={(e) => setInvoice({ ...invoice, condition_type: e.target.value })}><option value="CREDITO">Credito</option><option value="CONTADO">Contado</option></select></label></div><div className="mt-4 overflow-auto rounded border"><table className="min-w-full text-sm"><thead className="bg-slate-100"><tr><th className="px-3 py-2 text-left">Operacion</th><th className="px-3 py-2 text-right">Pendiente aprobado</th><th className="px-3 py-2 text-right">Asignar</th></tr></thead><tbody>{selectedRows.map((row) => <tr key={row.id} className="border-t"><td className="px-3 py-2">{row.reference} - {row.client_name}</td><td className="px-3 py-2 text-right">{money(row.commission_gross, row.currency_code)}</td><td className="px-3 py-2 text-right"><input type="number" className="w-40 rounded border px-2 py-1 text-right" value={invoice.allocations[row.id] ?? ''} onChange={(e) => setInvoice({ ...invoice, allocations: { ...invoice.allocations, [row.id]: e.target.value } })}/></td></tr>)}</tbody></table></div><div className="mt-3 text-sm">Total asignado: <b>{money(invoiceTotal, selectedRows[0]?.currency_code)}</b></div><button type="button" disabled={!invoice.supplier_org_id || invoiceTotal <= 0} className="mt-4 rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50" onClick={saveInvoice}>Registrar factura y enviar a Gastos Administrativos</button></div></div> : null}

    {createOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-lg rounded-lg bg-white p-5"><div className="flex justify-between"><h2 className="font-semibold">Nueva liquidacion</h2><button onClick={() => setCreateOpen(false)}>Cerrar</button></div><label className="mt-4 block text-sm">Operacion<select className="mt-1 w-full rounded border px-3 py-2" value={newOperationId} onChange={(e) => setNewOperationId(e.target.value)}><option value="">Seleccionar operacion</option>{availableOperations.map((item) => <option key={item.id} value={item.id}>{item.reference} - {item.client_name || item.title} - {item.advisor_name || 'Sin ejecutivo'}</option>)}</select></label><button type="button" disabled={!newOperationId} className="mt-4 rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50" onClick={createLiquidation}>Crear desde la revision oficial</button></div></div> : null}
  </div>;
}
