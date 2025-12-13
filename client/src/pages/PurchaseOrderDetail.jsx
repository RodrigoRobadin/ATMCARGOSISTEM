// client/src/pages/PurchaseOrderDetail.jsx
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';

const statusStyles = {
  borrador: { label: 'Borrador', cls: 'bg-gray-100 text-gray-700' },
  enviada: { label: 'Enviada', cls: 'bg-blue-100 text-blue-700' },
  confirmada: { label: 'Confirmada', cls: 'bg-purple-100 text-purple-700' },
  recibida: { label: 'Recibida', cls: 'bg-green-100 text-green-700' },
  cancelada: { label: 'Cancelada', cls: 'bg-red-100 text-red-700' },
};

const fmtMoney = (v) =>
  new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'USD' }).format(
    Number(v || 0),
  );
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('es-PY') : '—');

export default function PurchaseOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadOrder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function loadOrder() {
    setLoading(true);
    try {
      const { data } = await api.get(`/purchase-orders/${id}`);
      setOrder(data);
    } catch (e) {
      console.error('Error loading purchase order', e);
      alert(e.response?.data?.error || 'No se pudo cargar la orden');
      navigate('/purchase-orders');
    } finally {
      setLoading(false);
    }
  }

  async function postAction(action, label) {
    if (!order) return;
    if (!confirm(`¿${label} la orden ${order.po_number}?`)) return;
    try {
      await api.post(`/purchase-orders/${order.id}/${action}`);
      await loadOrder();
      alert(`Orden ${label.toLowerCase()}`);
    } catch (e) {
      console.error(`Error on ${action}`, e);
      alert(e.response?.data?.error || `No se pudo ${label.toLowerCase()}`);
    }
  }

  async function handleCancel() {
    if (!order) return;
    const reason = prompt('Motivo de cancelación:');
    if (!reason) return;
    try {
      await api.post(`/purchase-orders/${order.id}/cancel`, { reason });
      await loadOrder();
      alert('Orden cancelada');
    } catch (e) {
      console.error('Error canceling PO', e);
      alert(e.response?.data?.error || 'No se pudo cancelar');
    }
  }

  async function handleDelete() {
    if (!order) return;
    if (!confirm(`¿Eliminar la orden ${order.po_number}?`)) return;
    try {
      await api.delete(`/purchase-orders/${order.id}`);
      alert('Orden eliminada');
      navigate('/purchase-orders');
    } catch (e) {
      console.error('Error deleting PO', e);
      alert(e.response?.data?.error || 'No se pudo eliminar');
    }
  }

  const status = statusStyles[order?.status] || statusStyles.borrador;

  if (loading) return <div className="p-6">Cargando orden...</div>;
  if (!order) return <div className="p-6">No se encontró la orden</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-slate-500">
            <Link to="/purchase-orders" className="hover:underline">
              ← Volver a órdenes
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-slate-800">{order.po_number}</h1>
          <div className="flex items-center gap-3 mt-2">
            <span className={`px-2 py-1 rounded text-xs font-medium ${status.cls}`}>
              {status.label}
            </span>
            <span className="text-sm text-slate-500">
              Fecha: {fmtDate(order.order_date)} · Entrega: {fmtDate(order.expected_delivery_date)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {order.status === 'borrador' && (
            <>
              <button
                onClick={() => postAction('send', 'Enviar')}
                className="btn bg-blue-600 text-white hover:bg-blue-700"
              >
                Enviar
              </button>
              <button
                onClick={handleDelete}
                className="btn bg-red-600 text-white hover:bg-red-700"
              >
                Eliminar
              </button>
            </>
          )}
          {order.status === 'enviada' && (
            <button
              onClick={() => postAction('confirm', 'Confirmar')}
              className="btn bg-purple-600 text-white hover:bg-purple-700"
            >
              Confirmar
            </button>
          )}
          {order.status === 'confirmada' && (
            <button
              onClick={() => postAction('receive', 'Recibir')}
              className="btn bg-green-600 text-white hover:bg-green-700"
            >
              Marcar como recibida
            </button>
          )}
          {order.status !== 'recibida' && order.status !== 'cancelada' && (
            <button onClick={handleCancel} className="btn border border-slate-300">
              Cancelar
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border rounded-lg p-4 space-y-1">
          <h3 className="font-semibold">Proveedor</h3>
          <div className="text-sm text-slate-700">
            {order.supplier_name || order.supplier_razon_social || '—'}
          </div>
          <div className="text-sm text-slate-500">
            RUC: {order.supplier_ruc || '—'} · {order.supplier_city || '—'}
          </div>
          <div className="text-sm text-slate-500">{order.supplier_address || '—'}</div>
          <div className="text-sm text-slate-500">
            Tel: {order.supplier_phone || '—'} · {order.supplier_email || '—'}
          </div>
        </div>
        <div className="bg-white border rounded-lg p-4 space-y-1">
          <h3 className="font-semibold">Totales</h3>
          <div className="flex justify-between text-sm">
            <span>Subtotal</span>
            <span className="font-medium">{fmtMoney(order.subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Impuesto</span>
            <span className="font-medium">{fmtMoney(order.tax_amount)}</span>
          </div>
          <div className="flex justify-between text-base font-semibold text-slate-800">
            <span>Total</span>
            <span>{fmtMoney(order.total_amount)}</span>
          </div>
        </div>
      </div>

      <div className="bg-white border rounded-lg p-4 space-y-2">
        <h3 className="font-semibold">Entrega</h3>
        <div className="text-sm text-slate-700">{order.delivery_address || '—'}</div>
        {order.notes && <div className="text-sm text-slate-500 whitespace-pre-line">{order.notes}</div>}
        <div className="text-xs text-slate-500">
          Creada por: {order.created_by_name || '—'} · Aprobada por: {order.approved_by_name || '—'} ·
          Recibida por: {order.received_by_name || '—'}
        </div>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold">Ítems</div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-4 py-2">Descripción</th>
              <th className="px-4 py-2 w-20">Cant.</th>
              <th className="px-4 py-2 w-32">Precio</th>
              <th className="px-4 py-2 w-32">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {(order.items || []).map((it) => (
              <tr key={it.id} className="border-t">
                <td className="px-4 py-2">{it.description || '—'}</td>
                <td className="px-4 py-2">{it.quantity}</td>
                <td className="px-4 py-2">{fmtMoney(it.unit_price)}</td>
                <td className="px-4 py-2 font-medium">{fmtMoney(it.subtotal)}</td>
              </tr>
            ))}
            {(!order.items || order.items.length === 0) && (
              <tr>
                <td className="px-4 py-3 text-center text-slate-500" colSpan={4}>
                  Sin ítems
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
