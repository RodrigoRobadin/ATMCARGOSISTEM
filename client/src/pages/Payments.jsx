import React, { useEffect, useMemo, useState } from 'react';
import api from '../api';

const fmtMoney = (v) =>
  new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'USD' }).format(
    Number(v || 0)
  );

const fmtBank = (code) => {
  if (!code) return '-';
  const val = String(code).toLowerCase();
  if (val === 'gs' || val === 'itau') return 'ITAU';
  if (val === 'usd' || val === 'continental') return 'CONTINENTAL';
  return code;
};

export default function Payments() {
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    cliente: '',
    metodo: '',
  });

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await api.get('/invoices/receipts');
        setReceipts(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error('Error cargando pagos', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtered = useMemo(() => {
    const c = filters.cliente.toLowerCase();
    const m = filters.metodo.toLowerCase();
    return receipts.filter((r) => {
      const name = (r.organization_name || '').toLowerCase();
      const meth = (r.payment_method || '').toLowerCase();
      return name.includes(c) && (m ? meth === m : true);
    });
  }, [receipts, filters]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Pagos / Recibos</h1>
          <p className="text-sm text-slate-500">
            Lista de recibos registrados, con links a factura y cliente.
          </p>
        </div>
        <div className="flex gap-4">
          <div>
            <div className="text-xs text-slate-500">Total recibos</div>
            <div className="text-lg font-semibold">
              {fmtMoney(
                filtered.reduce((s, r) => {
                  const val = r.net_amount ?? r.amount ?? 0;
                  return s + Number(val);
                }, 0)
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Cantidad</div>
            <div className="text-lg font-semibold">{filtered.length}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-white p-4 rounded-lg border">
        <div>
          <label className="text-xs text-slate-500">Cliente</label>
          <input
            className="mt-1 w-full border rounded px-2 py-1 text-sm"
            placeholder="Nombre / RUC"
            value={filters.cliente}
            onChange={(e) => setFilters((f) => ({ ...f, cliente: e.target.value }))}
          />
        </div>
        <div>
          <label className="text-xs text-slate-500">Método</label>
          <select
            className="mt-1 w-full border rounded px-2 py-1 text-sm"
            value={filters.metodo}
            onChange={(e) => setFilters((f) => ({ ...f, metodo: e.target.value }))}
          >
            <option value="">Todos</option>
            <option value="transferencia">Transferencia</option>
            <option value="efectivo">Efectivo</option>
            <option value="cheque">Cheque</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="otro">Otro</option>
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button
            className="px-3 py-2 text-sm border rounded"
            onClick={() => setFilters({ cliente: '', metodo: '' })}
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      <div className="bg-white border rounded-lg overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="text-left px-3 py-2">Fecha</th>
              <th className="text-left px-3 py-2">N° Recibo</th>
              <th className="text-left px-3 py-2">Factura</th>
              <th className="text-left px-3 py-2">Operación</th>
              <th className="text-left px-3 py-2">Cliente</th>
              <th className="text-left px-3 py-2">Moneda</th>
              <th className="text-right px-3 py-2">Monto neto</th>
              <th className="text-left px-3 py-2">Método</th>
              <th className="text-left px-3 py-2">Banco</th>
              <th className="text-left px-3 py-2">Referencia</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-center text-slate-500">
                  Cargando...
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-center text-slate-500">
                  Sin pagos registrados.
                </td>
              </tr>
            )}
            {!loading &&
              filtered.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2">
                    {r.issue_date ? new Date(r.issue_date).toLocaleDateString('es-PY') : '-'}
                  </td>
                  <td className="px-3 py-2">{r.receipt_number || '-'}</td>
                  <td className="px-3 py-2">
                    {r.invoice_number ? (
                      <a
                        className="text-blue-600 hover:underline"
                        href={`/invoices/${r.invoice_id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {r.invoice_number}
                      </a>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.deal_reference ? (
                      <a
                        className="text-blue-600 hover:underline"
                        href={`/operations/${r.deal_id || r.deal || ''}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {r.deal_reference}
                      </a>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-3 py-2">{r.organization_name || '-'}</td>
                  <td className="px-3 py-2">{r.currency_code || '-'}</td>
                  <td className="px-3 py-2 text-right">
                    {fmtMoney(r.net_amount ?? r.amount)}
                  </td>
                  <td className="px-3 py-2 capitalize">{r.payment_method || '-'}</td>
                  <td className="px-3 py-2">{fmtBank(r.bank_account)}</td>
                  <td className="px-3 py-2">{r.reference_number || '-'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
