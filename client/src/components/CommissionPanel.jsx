import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth.jsx';

const money = (value, code = 'PYG') => `${code} ${Number(value || 0).toLocaleString('es-PY', { minimumFractionDigits: code === 'PYG' ? 0 : 2, maximumFractionDigits: code === 'PYG' ? 0 : 2 })}`;
const statusLabel = (status) => ({ borrador: 'Borrador', enviada_aprobacion: 'Pendiente aprobacion', aprobada_facturar: 'Aprobada para facturar', facturada: 'Facturada', pago_parcial: 'Pago parcial', pagada: 'Pagada', anulada: 'Anulada' }[status] || status || 'Borrador');

export default function CommissionPanel({ operationId, source = {}, compact = false, onChanged }) {
  const { user } = useAuth();
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const [rows, setRows] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [suppliers, setSuppliers] = useState([]);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoice, setInvoice] = useState({ receipt_number: '', timbrado_number: '', invoice_date: '', due_date: '', condition_type: 'CREDITO', iva_rate: 10 });

  const load = async () => {
    if (!operationId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/commissions/operation/${operationId}`);
      setRows(data?.rows || []);
      setEvents(data?.events || []);
    } catch (e) {
      setError(e?.response?.data?.error || 'No se pudo cargar Comisiones.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [operationId]);
  useEffect(() => {
    api.get('/organizations', { params: { tipo_org: 'Proveedor', limit: 1000 } })
      .then(({ data }) => setSuppliers(Array.isArray(data) ? data : data?.rows || []))
      .catch(() => setSuppliers([]));
  }, []);

  const row = rows.find((item) => item.status !== 'anulada');
  const cancelledRows = rows.filter((item) => item.status === 'anulada');
  const canCreate = !row;
  const amounts = useMemo(() => row ? { gross: Number(row.commission_gross || 0), net: Number(row.commission_net || 0), iva: Number(row.commission_iva || 0) } : null, [row]);

  const create = async () => {
    setCreating(true);
    setError('');
    try {
      await api.post(`/commissions/operation/${operationId}`, source);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e?.response?.data?.error || 'No se pudo crear la liquidacion.');
    } finally {
      setCreating(false);
    }
  };

  const patch = async (values) => {
    try {
      await api.patch(`/commissions/${row.id}`, values);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e?.response?.data?.error || 'No se pudo actualizar.');
    }
  };

  const action = async (name) => {
    try {
      await api.post(`/commissions/${row.id}/${name}`);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e?.response?.data?.error || 'No se pudo completar la accion.');
    }
  };

  const cancelLiquidation = async () => {
    const reason = window.prompt('Motivo de eliminacion/anulacion de la liquidacion');
    if (!reason?.trim()) return;
    if (!window.confirm('La liquidacion quedara anulada y visible en historial. Deseas continuar?')) return;
    try {
      await api.post(`/commissions/${row.id}/cancel`, { reason: reason.trim() });
      await load();
      onChanged?.();
    } catch (e) {
      setError(e?.response?.data?.error || 'No se pudo eliminar la liquidacion.');
    }
  };

  const registerInvoice = async () => {
    try {
      await api.post('/commissions/invoices', {
        ...invoice,
        supplier_org_id: Number(supplierId),
        amount_gross: amounts.gross,
        currency_code: row.currency_code,
        allocations: [{ liquidation_id: row.id, amount: amounts.gross }],
      });
      setInvoiceOpen(false);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e?.response?.data?.error || 'No se pudo registrar la factura.');
    }
  };

  if (loading) return <div className="p-4 text-sm text-slate-500">Cargando comisiones...</div>;

  return <div className="space-y-3">
    {error ? <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

    {canCreate ? <div className="rounded-lg border bg-white p-4">
      <p className="text-sm text-slate-600">Todavia no hay liquidacion. Se tomara una foto de compra, venta y profit de la revision seleccionada.</p>
      <button type="button" onClick={create} disabled={creating} className="mt-3 rounded-lg bg-black px-3 py-2 text-sm text-white disabled:opacity-50">{creating ? 'Creando...' : 'Crear liquidacion de comision'}</button>
    </div> : <>
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-white p-4">
        <div>
          <div className="text-xs text-slate-500">Estado</div>
          <div className="mt-1 font-semibold">{statusLabel(row.status)}</div>
          <div className="mt-1 text-xs text-slate-500">Fuente: {row.source_type === 'industrial_quote' ? `REV industrial ${row.quote_revision_id || 'actual'}` : `DET COS REV ${row.cost_sheet_version_number}`}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {row.status === 'borrador' ? <button type="button" onClick={() => action('submit')} className="rounded border px-3 py-2 text-sm">Enviar a aprobacion</button> : null}
          {isAdmin && row.status === 'enviada_aprobacion' ? <button type="button" onClick={() => action('approve')} className="rounded bg-emerald-600 px-3 py-2 text-sm text-white">Aprobar para facturar</button> : null}
          {row.status === 'aprobada_facturar' ? <button type="button" onClick={() => { setInvoice((current) => ({ ...current, iva_rate: Number(row.iva_rate || 10) })); setInvoiceOpen(true); }} className="rounded bg-black px-3 py-2 text-sm text-white">Registrar factura</button> : null}
          {['borrador', 'enviada_aprobacion', 'aprobada_facturar'].includes(row.status) ? <button type="button" onClick={cancelLiquidation} className="rounded border border-red-200 px-3 py-2 text-sm text-red-700">Eliminar</button> : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {[
          ['Compra', row.budgeted_purchase],
          ['Venta', row.budgeted_sale],
          ['Profit ventas', row.budgeted_profit],
          ['% comision', `${(Number(row.commission_rate || 0) * 100).toFixed(2)}%`],
          ['Comision bruta', row.commission_gross],
          [`IVA descontado ${Number(row.iva_rate || 0)}%`, row.commission_iva],
          ['Comision vendedor', row.commission_net],
          ['Profit ATM', row.profit_atm],
        ].map(([label, value]) => <div key={label} className="rounded-lg border bg-white p-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 font-semibold">{typeof value === 'string' ? value : money(value, row.currency_code)}</div></div>)}
      </div>

      {row.status === 'borrador' ? <div className="grid grid-cols-1 gap-3 rounded-lg border bg-white p-4 md:grid-cols-2">
        <label className="text-sm">% comision
          <select className="mt-1 w-full rounded border px-3 py-2" value={Number(row.commission_rate || 0) * 100} onChange={(e) => patch({ commission_rate: Number(e.target.value || 0) / 100 })}>
            {Array.from({ length: 11 }, (_, index) => index * 5).map((rate) => <option key={rate} value={rate}>{rate}%</option>)}
          </select>
        </label>
        <label className="text-sm">IVA a descontar
          <select className="mt-1 w-full rounded border px-3 py-2" value={Number(row.iva_rate || 0)} onChange={(e) => patch({ iva_rate: Number(e.target.value) })}>
            <option value="5">5%</option>
            <option value="10">10%</option>
            <option value="20">20%</option>
          </select>
        </label>
      </div> : null}

      {!compact ? <div className="rounded-lg border bg-white p-4">
        <div className="mb-2 font-medium">Historial</div>
        <div className="space-y-2 text-sm">
          {events.filter((event) => Number(event.liquidation_id) === Number(row.id)).slice(0, 8).map((event) => <div key={event.id} className="border-b pb-2"><b>{event.actor_name || 'Sistema'}</b> - {event.detail || event.event_type}<span className="ml-2 text-xs text-slate-500">{event.created_at ? new Date(event.created_at).toLocaleString('es-PY') : ''}</span></div>)}
          {!events.filter((event) => Number(event.liquidation_id) === Number(row.id)).length ? <div className="text-slate-500">Sin eventos registrados.</div> : null}
        </div>
      </div> : null}
    </>}

    {cancelledRows.length ? <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <div className="font-medium">Liquidaciones eliminadas/anuladas</div>
      <div className="mt-2 space-y-2">
        {cancelledRows.map((item) => <div key={item.id} className="line-through decoration-red-500"><b>{money(item.commission_gross, item.currency_code)}</b> - {item.cancel_reason || 'Sin motivo'} - {item.cancelled_by_name || 'Usuario'} - {item.cancelled_at ? new Date(item.cancelled_at).toLocaleString('es-PY') : ''}</div>)}
      </div>
    </div> : null}

    {invoiceOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded-lg bg-white p-5">
        <div className="flex justify-between"><h3 className="font-semibold">Factura de comision</h3><button onClick={() => setInvoiceOpen(false)}>Cerrar</button></div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-sm md:col-span-2">Proveedor
            <select className="mt-1 w-full rounded border px-3 py-2" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Seleccionar proveedor</option>
              {suppliers.map((item) => <option key={item.id} value={item.id}>{item.razon_social || item.name} {item.ruc ? `- ${item.ruc}` : ''}</option>)}
            </select>
          </label>
          <label className="text-sm">Nro. comprobante<input className="mt-1 w-full rounded border px-3 py-2" value={invoice.receipt_number} onChange={(e) => setInvoice({ ...invoice, receipt_number: e.target.value })}/></label>
          <label className="text-sm">Timbrado<input className="mt-1 w-full rounded border px-3 py-2" value={invoice.timbrado_number} onChange={(e) => setInvoice({ ...invoice, timbrado_number: e.target.value })}/></label>
          <label className="text-sm">Fecha<input className="mt-1 w-full rounded border px-3 py-2" type="date" value={invoice.invoice_date} onChange={(e) => setInvoice({ ...invoice, invoice_date: e.target.value })}/></label>
          <label className="text-sm">Condicion<select className="mt-1 w-full rounded border px-3 py-2" value={invoice.condition_type} onChange={(e) => setInvoice({ ...invoice, condition_type: e.target.value })}><option value="CREDITO">Credito</option><option value="CONTADO">Contado</option></select></label>
          <label className="text-sm">IVA incluido<select className="mt-1 w-full rounded border px-3 py-2" value={invoice.iva_rate} onChange={(e) => setInvoice({ ...invoice, iva_rate: Number(e.target.value) })}><option value="5">5%</option><option value="10">10%</option><option value="20">20%</option></select></label>
        </div>
        <div className="mt-4 rounded bg-slate-50 p-3 text-sm">Total IVA incluido: <b>{money(amounts.gross, row.currency_code)}</b> - Base: {money(amounts.net, row.currency_code)} - IVA {Number(row.iva_rate || 0)}%: {money(amounts.iva, row.currency_code)}</div>
        <button type="button" disabled={!supplierId} onClick={registerInvoice} className="mt-4 rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50">Registrar y enviar a Gastos Administrativos</button>
      </div>
    </div> : null}
  </div>;
}
