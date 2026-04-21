import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';

function fmtMoney(value) {
  return `PYG ${Number(value || 0).toLocaleString('es-PY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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

export default function PurchaseInvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadInvoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function loadInvoice() {
    setLoading(true);
    try {
      const { data } = await api.get(`/purchase-invoices/${id}`);
      setInvoice(data);
    } catch (error) {
      console.error('purchase invoice detail error', error);
      alert(error?.response?.data?.error || 'No se pudo cargar la factura de compra.');
      navigate('/admin-ops/accounts-payable');
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="p-6">Cargando factura de compra...</div>;
  if (!invoice) return <div className="p-6">No se encontro la factura de compra.</div>;

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="text-sm text-slate-500">
          <Link to="/admin-ops/accounts-payable" className="hover:underline">
            ← Volver a cuentas a pagar
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-slate-800 mt-2">
          {invoice.invoice_number || `Factura #${invoice.id}`}
        </h1>
        <div className="text-sm text-slate-500 mt-1">
          Proveedor: {invoice.supplier_razon_social || invoice.supplier_name || '-'}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border rounded-lg p-4 space-y-1">
          <h3 className="font-semibold">Datos</h3>
          <div className="text-sm">Factura proveedor: {invoice.supplier_invoice_number || '-'}</div>
          <div className="text-sm">Fecha: {fmtDate(invoice.invoice_date)}</div>
          <div className="text-sm">Vencimiento: {fmtDate(invoice.due_date)}</div>
          <div className="text-sm">Estado: {invoice.status || '-'}</div>
        </div>
        <div className="bg-white border rounded-lg p-4 space-y-1">
          <h3 className="font-semibold">Proveedor</h3>
          <div className="text-sm">{invoice.supplier_razon_social || invoice.supplier_name || '-'}</div>
          <div className="text-sm text-slate-500">RUC: {invoice.supplier_ruc || '-'}</div>
          <div className="text-sm text-slate-500">{invoice.supplier_address || '-'}</div>
        </div>
        <div className="bg-white border rounded-lg p-4 space-y-1">
          <h3 className="font-semibold">Totales</h3>
          <div className="flex justify-between text-sm"><span>Subtotal</span><span>{fmtMoney(invoice.subtotal)}</span></div>
          <div className="flex justify-between text-sm"><span>Impuesto</span><span>{fmtMoney(invoice.tax_amount)}</span></div>
          <div className="flex justify-between text-sm"><span>Pagado</span><span>{fmtMoney(invoice.paid_amount)}</span></div>
          <div className="flex justify-between text-sm font-semibold"><span>Saldo</span><span>{fmtMoney(invoice.balance)}</span></div>
        </div>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold">Items</div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left px-4 py-2">Descripcion</th>
              <th className="text-left px-4 py-2">Cant.</th>
              <th className="text-left px-4 py-2">Precio</th>
              <th className="text-left px-4 py-2">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {(invoice.items || []).map((item) => (
              <tr key={item.id} className="border-t">
                <td className="px-4 py-2">{item.description || '-'}</td>
                <td className="px-4 py-2">{item.quantity}</td>
                <td className="px-4 py-2">{fmtMoney(item.unit_price)}</td>
                <td className="px-4 py-2">{fmtMoney(item.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold">Pagos</div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left px-4 py-2">Fecha</th>
              <th className="text-left px-4 py-2">Metodo</th>
              <th className="text-left px-4 py-2">Referencia</th>
              <th className="text-left px-4 py-2">Monto</th>
            </tr>
          </thead>
          <tbody>
            {(invoice.payments || []).map((payment) => (
              <tr key={payment.id} className="border-t">
                <td className="px-4 py-2">{fmtDate(payment.payment_date)}</td>
                <td className="px-4 py-2">{payment.payment_method || '-'}</td>
                <td className="px-4 py-2">{payment.reference_number || '-'}</td>
                <td className="px-4 py-2">{fmtMoney(payment.amount)}</td>
              </tr>
            ))}
            {(!invoice.payments || invoice.payments.length === 0) && (
              <tr>
                <td className="px-4 py-3 text-slate-500" colSpan={4}>
                  Sin pagos registrados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
