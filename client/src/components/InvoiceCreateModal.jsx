// client/src/components/InvoiceCreateModal.jsx
import React, { useEffect, useState } from 'react';
import { api, fetchUsersByRole } from '../api';

export default function InvoiceCreateModal({ defaultDealId, onClose, onSuccess }) {
  const [form, setForm] = useState({
    deal_id: defaultDealId ? String(defaultDealId) : '',
    due_date: '',
    payment_terms: '30 dias',
    notes: '',
    payment_condition: 'credito',
    timbrado_number: '',
    timbrado_start_date: '',
    timbrado_expires_at: '',
    point_of_issue: '',
    establishment: '',
    customer_doc_type: 'RUC',
    customer_doc: '',
    customer_email: '',
    customer_address: '',
    currency_code: 'USD',
    exchange_rate: 1,
    sales_rep: '',
    purchase_order_ref: '',
    mode: 'percentage',
    percentage: '60',
  });
  const [saving, setSaving] = useState(false);
  const [executives, setExecutives] = useState([]);
  const [ocDocs, setOcDocs] = useState([]);
  const [dealOrg, setDealOrg] = useState(null);

  useEffect(() => {
    loadExecutives();
    if (defaultDealId) {
      preloadDealData(defaultDealId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultDealId]);

  async function loadExecutives() {
    try {
      const users = await fetchUsersByRole('ejecutivo');
      setExecutives(users);
    } catch (e) {
      console.error('No se pudo cargar ejecutivos', e);
    }
  }

  async function preloadDealData(dealId) {
    try {
      const { data } = await api.get(`/deals/${dealId}`);
      if (data && data.organization) {
        setDealOrg(data.organization);
        setForm((prev) => ({
          ...prev,
          customer_doc: prev.customer_doc || data.organization.ruc || '',
          customer_doc_type: prev.customer_doc_type || 'RUC',
          customer_email: prev.customer_email || data.organization.email || '',
          customer_address: prev.customer_address || data.organization.address || '',
        }));
      }
      // cargar documentos OC de la operación
      try {
        const { data: docs } = await api.get(`/deals/${dealId}/documents`, { params: { type: 'OC' } });
        setOcDocs(docs || []);
        if (docs && docs.length > 0) {
          setForm((prev) => ({ ...prev, purchase_order_ref: prev.purchase_order_ref || docs[0].name || '' }));
        }
      } catch (err) {
        console.warn('No se pudieron cargar documentos OC', err?.message);
      }
    } catch (err) {
      console.error('No se pudo precargar datos del deal', err);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.deal_id) {
      alert('Ingresa el ID de la operacion (deal)');
      return;
    }

    const pct = form.mode === 'percentage' ? Number(form.percentage) : 100;
    if (Number.isNaN(pct) || pct <= 0 || pct > 100) {
      alert('Ingresa un porcentaje valido entre 1 y 100');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        deal_id: Number(form.deal_id),
        percentage: pct,
        exchange_rate: Number(form.exchange_rate) || 1,
      };
      const { data } = await api.post('/invoices', payload);
      alert('Factura creada correctamente');
      onSuccess?.(data.id);
    } catch (e) {
      console.error('Error creating invoice:', e);
      alert(e.response?.data?.error || 'Error al crear factura');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 md:p-6 z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-5xl shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Nueva factura</h3>
          <button onClick={onClose} className="text-2xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-1">
              <label className="block text-sm font-medium mb-1">ID de operacion (deal)</label>
              <input
                type="number"
                className="w-full border rounded-lg px-3 py-2 disabled:bg-slate-100"
                value={form.deal_id}
                onChange={(e) => setForm({ ...form, deal_id: e.target.value })}
                placeholder="Ej: 123"
                required
                disabled={Boolean(defaultDealId)}
              />
              <p className="text-xs text-slate-500 mt-1">Usa el presupuesto del deal.</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Vencimiento</label>
              <input
                type="date"
                className="w-full border rounded-lg px-3 py-2"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Terminos de pago</label>
              <input
                type="text"
                className="w-full border rounded-lg px-3 py-2"
                value={form.payment_terms}
                onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
                placeholder="Ej: 30 dias"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Condicion de pago</label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={form.payment_condition}
                onChange={(e) => setForm({ ...form, payment_condition: e.target.value })}
              >
                <option value="credito">Credito</option>
                <option value="contado">Contado</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tipo de monto</label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={form.mode}
                onChange={(e) => setForm({ ...form, mode: e.target.value })}
              >
                <option value="total">100% del presupuesto</option>
                <option value="percentage">Porcentaje</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Porcentaje a facturar</label>
              <input
                type="number"
                className="w-full border rounded-lg px-3 py-2"
                value={form.percentage}
                onChange={(e) => setForm({ ...form, percentage: e.target.value })}
                placeholder="Ej: 60"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Timbrado</label>
              <input
                type="text"
                className="w-full border rounded-lg px-3 py-2"
                value={form.timbrado_number}
                onChange={(e) => setForm({ ...form, timbrado_number: e.target.value })}
                placeholder="Numero de timbrado"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Vigencia desde</label>
              <input
                type="date"
                className="w-full border rounded-lg px-3 py-2"
                value={form.timbrado_start_date}
                onChange={(e) => setForm({ ...form, timbrado_start_date: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Vigencia hasta</label>
              <input
                type="date"
                className="w-full border rounded-lg px-3 py-2"
                value={form.timbrado_expires_at}
                onChange={(e) => setForm({ ...form, timbrado_expires_at: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Punto de expedicion</label>
              <input
                type="text"
                className="w-full border rounded-lg px-3 py-2"
                value={form.point_of_issue}
                onChange={(e) => setForm({ ...form, point_of_issue: e.target.value })}
                placeholder="Ej: 001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Establecimiento</label>
              <input
                type="text"
                className="w-full border rounded-lg px-3 py-2"
                value={form.establishment}
                onChange={(e) => setForm({ ...form, establishment: e.target.value })}
                placeholder="Ej: 001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Moneda</label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={form.currency_code}
                onChange={(e) => setForm({ ...form, currency_code: e.target.value })}
              >
                <option value="USD">USD</option>
                <option value="PYG">PYG</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tipo de cambio</label>
              <input
                type="number"
                step="0.0001"
                className="w-full border rounded-lg px-3 py-2"
                value={form.exchange_rate}
                onChange={(e) => setForm({ ...form, exchange_rate: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Doc. cliente</label>
              <div className="flex gap-2">
                <select
                  className="border rounded-lg px-2 py-2"
                  value={form.customer_doc_type}
                  onChange={(e) => setForm({ ...form, customer_doc_type: e.target.value })}
                >
                  <option value="RUC">RUC</option>
                  <option value="CI">CI</option>
                  <option value="PAS">PAS</option>
                </select>
                <input
                  type="text"
                  className="flex-1 border rounded-lg px-3 py-2"
                  value={form.customer_doc}
                  onChange={(e) => setForm({ ...form, customer_doc: e.target.value })}
                  placeholder="Ej: 80012345-6"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Email cliente</label>
              <input
                type="email"
                className="w-full border rounded-lg px-3 py-2"
                value={form.customer_email}
                onChange={(e) => setForm({ ...form, customer_email: e.target.value })}
                placeholder="cliente@correo.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Direccion cliente</label>
              <input
                type="text"
                className="w-full border rounded-lg px-3 py-2"
                value={form.customer_address}
                onChange={(e) => setForm({ ...form, customer_address: e.target.value })}
                placeholder="Calle, ciudad"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Vendedor / Ejecutivo</label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={form.sales_rep_id || ''}
                onChange={(e) => {
                  const selected = executives.find((u) => String(u.id) === e.target.value);
                  setForm({ ...form, sales_rep_id: e.target.value, sales_rep: selected?.name || '' });
                }}
              >
                <option value="">Seleccionar</option>
                {executives.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">OC / Referencia</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  className="flex-1 border rounded-lg px-3 py-2"
                  value={form.purchase_order_ref}
                  onChange={(e) => setForm({ ...form, purchase_order_ref: e.target.value })}
                  placeholder="Orden de compra"
                />
                {ocDocs.length > 0 && (
                  <a
                    href={ocDocs[0].url || '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs px-3 py-2 bg-slate-600 text-white rounded hover:bg-slate-700"
                  >
                    Ver OC
                  </a>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notas</label>
            <textarea
              className="w-full border rounded-lg px-3 py-2"
              rows="3"
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
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              disabled={saving}
            >
              {saving ? 'Creando...' : 'Crear factura'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
