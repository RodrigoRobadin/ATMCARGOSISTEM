// client/src/pages/PurchaseOrders.jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const statusStyles = {
  borrador: 'bg-gray-100 text-gray-700',
  enviada: 'bg-blue-100 text-blue-700',
  confirmada: 'bg-purple-100 text-purple-700',
  recibida: 'bg-green-100 text-green-700',
  cancelada: 'bg-red-100 text-red-700',
};

const statusLabels = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  confirmada: 'Confirmada',
  recibida: 'Recibida',
  cancelada: 'Cancelada',
};

const fmtMoney = (v) =>
  new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'USD' }).format(v || 0);
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('es-PY') : '—');

export default function PurchaseOrders() {
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [filters, setFilters] = useState({
    status: '',
    supplier_id: '',
    search: '',
    from_date: '',
    to_date: '',
  });

  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    loadOrders();
    loadSuppliers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  async function loadOrders() {
    setLoading(true);
    try {
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.supplier_id) params.supplier_id = filters.supplier_id;
      if (filters.search) params.search = filters.search;
      if (filters.from_date) params.from_date = filters.from_date;
      if (filters.to_date) params.to_date = filters.to_date;

      const { data } = await api.get('/purchase-orders', { params });
      setOrders(data || []);
    } catch (e) {
      console.error('Error loading purchase orders:', e);
      alert('Error al cargar órdenes de compra');
    } finally {
      setLoading(false);
    }
  }

  async function loadSuppliers() {
    try {
      const { data } = await api.get('/suppliers');
      setSuppliers(data || []);
    } catch (e) {
      console.error('Error loading suppliers:', e);
    }
  }

  function getStatusBadge(status) {
    return (
      <span
        className={`px-2 py-1 rounded text-xs font-medium ${
          statusStyles[status] || statusStyles.borrador
        }`}
      >
        {statusLabels[status] || status}
      </span>
    );
  }

  async function handleSend(order) {
    if (!confirm(`¿Enviar la orden ${order.po_number}?`)) return;

    try {
      await api.post(`/purchase-orders/${order.id}/send`);
      alert('Orden enviada correctamente');
      loadOrders();
    } catch (e) {
      console.error('Error sending order:', e);
      alert(e.response?.data?.error || 'Error al enviar orden');
    }
  }

  async function handleConfirm(order) {
    if (!confirm(`¿Confirmar la orden ${order.po_number}?`)) return;

    try {
      await api.post(`/purchase-orders/${order.id}/confirm`);
      alert('Orden confirmada correctamente');
      loadOrders();
    } catch (e) {
      console.error('Error confirming order:', e);
      alert(e.response?.data?.error || 'Error al confirmar orden');
    }
  }

  async function handleReceive(order) {
    if (!confirm(`¿Marcar como recibida la orden ${order.po_number}?`)) return;

    try {
      await api.post(`/purchase-orders/${order.id}/receive`);
      alert('Orden marcada como recibida');
      loadOrders();
    } catch (e) {
      console.error('Error receiving order:', e);
      alert(e.response?.data?.error || 'Error al marcar orden como recibida');
    }
  }

  async function handleDelete(order) {
    if (!confirm(`¿Eliminar la orden ${order.po_number}?`)) return;

    try {
      await api.delete(`/purchase-orders/${order.id}`);
      alert('Orden eliminada correctamente');
      loadOrders();
    } catch (e) {
      console.error('Error deleting order:', e);
      alert(e.response?.data?.error || 'Error al eliminar orden');
    }
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Órdenes de Compra</h1>
          <p className="text-slate-500 text-sm">Gestión de órdenes de compra a proveedores</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
        >
          + Nueva Orden
        </button>
      </div>

      {/* Filters */}
      <div className="mb-6 bg-white border rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Estado</label>
            <select
              className="w-full border rounded-lg px-3 py-2"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">Todos</option>
              <option value="borrador">Borrador</option>
              <option value="enviada">Enviada</option>
              <option value="confirmada">Confirmada</option>
              <option value="recibida">Recibida</option>
              <option value="cancelada">Cancelada</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Proveedor</label>
            <select
              className="w-full border rounded-lg px-3 py-2"
              value={filters.supplier_id}
              onChange={(e) => setFilters({ ...filters, supplier_id: e.target.value })}
            >
              <option value="">Todos</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name || s.razon_social}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Buscar</label>
            <input
              type="text"
              className="w-full border rounded-lg px-3 py-2"
              placeholder="Número u organizacion..."
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Desde</label>
            <input
              type="date"
              className="w-full border rounded-lg px-3 py-2"
              value={filters.from_date}
              onChange={(e) => setFilters({ ...filters, from_date: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Hasta</label>
            <input
              type="date"
              className="w-full border rounded-lg px-3 py-2"
              value={filters.to_date}
              onChange={(e) => setFilters({ ...filters, to_date: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-8 text-slate-500">Cargando...</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-8 text-slate-500">No se encontraron órdenes de compra</div>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-700 uppercase">
                  Número
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-700 uppercase">
                  Proveedor
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-700 uppercase">
                  Fecha Orden
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-700 uppercase">
                  Entrega Esperada
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-700 uppercase">
                  Total
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-700 uppercase">
                  Estado
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-700 uppercase">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      to={`/purchase-orders/${order.id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {order.po_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm">{order.supplier_name || '—'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{fmtDate(order.order_date)}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {fmtDate(order.expected_delivery_date)}
                  </td>
                  <td className="px-4 py-3 text-sm text-right font-medium">
                    {fmtMoney(order.total_amount)}
                  </td>
                  <td className="px-4 py-3 text-center">{getStatusBadge(order.status)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-2">
                      {order.status === 'borrador' && (
                        <>
                          <button
                            onClick={() => handleSend(order)}
                            className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                          >
                            Enviar
                          </button>
                          <button
                            onClick={() => handleDelete(order)}
                            className="text-xs px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700"
                          >
                            Eliminar
                          </button>
                        </>
                      )}
                      {order.status === 'enviada' && (
                        <button
                          onClick={() => handleConfirm(order)}
                          className="text-xs px-2 py-1 bg-purple-600 text-white rounded hover:bg-purple-700"
                        >
                          Confirmar
                        </button>
                      )}
                      {order.status === 'confirmada' && (
                        <button
                          onClick={() => handleReceive(order)}
                          className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                        >
                          Recibir
                        </button>
                      )}
                      <Link
                        to={`/purchase-orders/${order.id}`}
                        className="text-xs px-2 py-1 bg-slate-600 text-white rounded hover:bg-slate-700"
                      >
                        Ver
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreatePurchaseOrderModal
          suppliers={suppliers}
          onClose={() => setShowCreateModal(false)}
          onSuccess={(id) => {
            setShowCreateModal(false);
            loadOrders();
            if (id) window.open(`/purchase-orders/${id}`, '_blank');
          }}
        />
      )}
    </div>
  );
}

function CreatePurchaseOrderModal({ suppliers, onClose, onSuccess }) {
  const [form, setForm] = useState({
    supplier_id: '',
    order_date: new Date().toISOString().split('T')[0],
    expected_delivery_date: '',
    delivery_address: '',
    notes: '',
  });
  const [items, setItems] = useState([
    { description: '', quantity: 1, unit_price: 0 },
  ]);
  const [saving, setSaving] = useState(false);

  function updateItem(idx, key, value) {
    setItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [key]: value } : item)),
    );
  }

  function addItem() {
    setItems((prev) => [...prev, { description: '', quantity: 1, unit_price: 0 }]);
  }

  function removeItem(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  const totals = items.reduce(
    (acc, it) => {
      const subtotal = (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0);
      return { subtotal: acc.subtotal + subtotal };
    },
    { subtotal: 0 },
  );

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.supplier_id) {
      alert('Selecciona un proveedor');
      return;
    }
    if (!items.length || items.some((i) => !i.description)) {
      alert('Agrega al menos un ítem con descripción');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        supplier_id: Number(form.supplier_id),
        items: items.map((it) => ({
          description: it.description,
          quantity: Number(it.quantity) || 1,
          unit_price: Number(it.unit_price) || 0,
        })),
      };
      const { data } = await api.post('/purchase-orders', payload);
      alert(`Orden ${data.po_number} creada`);
      onSuccess(data.id);
    } catch (e) {
      console.error('Error creating purchase order:', e);
      alert(e.response?.data?.error || 'Error al crear orden');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-3xl shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Nueva Orden de Compra</h3>
          <button onClick={onClose} className="text-2xl leading-none">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Proveedor</label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={form.supplier_id}
                onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}
                required
              >
                <option value="">Selecciona proveedor</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || s.razon_social}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Fecha orden</label>
                <input
                  type="date"
                  className="w-full border rounded-lg px-3 py-2"
                  value={form.order_date}
                  onChange={(e) => setForm({ ...form, order_date: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Entrega esperada</label>
                <input
                  type="date"
                  className="w-full border rounded-lg px-3 py-2"
                  value={form.expected_delivery_date}
                  onChange={(e) =>
                    setForm({ ...form, expected_delivery_date: e.target.value })
                  }
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Dirección de entrega</label>
            <input
              type="text"
              className="w-full border rounded-lg px-3 py-2"
              value={form.delivery_address}
              onChange={(e) => setForm({ ...form, delivery_address: e.target.value })}
              placeholder="Dirección o indicaciones"
            />
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

          <div className="bg-slate-50 border rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold">Ítems</h4>
              <button
                type="button"
                onClick={addItem}
                className="text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                + Agregar ítem
              </button>
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-12 gap-2 items-center bg-white border rounded px-2 py-2"
                >
                  <input
                    className="col-span-5 border rounded px-2 py-1"
                    placeholder="Descripción"
                    value={item.description}
                    onChange={(e) => updateItem(idx, 'description', e.target.value)}
                    required
                  />
                  <input
                    className="col-span-2 border rounded px-2 py-1"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Cant."
                    value={item.quantity}
                    onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                    required
                  />
                  <input
                    className="col-span-3 border rounded px-2 py-1"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Precio"
                    value={item.unit_price}
                    onChange={(e) => updateItem(idx, 'unit_price', e.target.value)}
                    required
                  />
                  <div className="col-span-1 text-right text-sm font-medium">
                    {fmtMoney((parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0))}
                  </div>
                  <button
                    type="button"
                    className="col-span-1 text-red-600 text-sm"
                    onClick={() => removeItem(idx)}
                    disabled={items.length === 1}
                    title="Eliminar ítem"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="flex justify-end text-sm mt-3">
              <span className="font-semibold">Subtotal: {fmtMoney(totals.subtotal)}</span>
            </div>
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
              {saving ? 'Creando...' : 'Crear orden'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
