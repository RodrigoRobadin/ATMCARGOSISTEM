import React, { useEffect, useMemo, useState } from 'react';
import api from '../api';

const formatMoney = (n = 0, currency = 'USD') =>
  new Intl.NumberFormat('es-PY', {
    style: 'currency',
    currency: (currency || 'USD').toUpperCase(),
    minimumFractionDigits: 2,
  }).format(Number(n) || 0);

export default function AccountStatement() {
  const [rows, setRows] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingReceipts, setLoadingReceipts] = useState(true);
  const [error, setError] = useState('');
  const [selectedClient, setSelectedClient] = useState('');
  const [filters, setFilters] = useState({
    cliente: '',
    estado: 'pendiente', // por defecto solo pendientes
    moneda: 'todas', // ✅ NUEVO: permitir PYG / USD / todas
  });

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await api.get('/invoices');
        const list = Array.isArray(data) ? data : data?.data || [];
        setRows(list);
      } catch (err) {
        console.error('Error cargando estado de cuenta', err);
        setError('No se pudo cargar la información.');
        setRows([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    const loadReceipts = async () => {
      try {
        const { data } = await api.get('/invoices/receipts');
        setReceipts(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Error cargando recibos', err);
      } finally {
        setLoadingReceipts(false);
      }
    };
    loadReceipts();
  }, []);

  // Pagos aplicados (recibos) agrupados por factura
  const receiptsByInvoice = useMemo(() => {
    const map = {};
    receipts.forEach((r) => {
      const invId = r.invoice_id ?? r.invoiceId ?? r.invoiceid ?? r.factura_id;
      if (!invId) return;
      const amt = Number(r.net_amount ?? r.amount ?? r.total ?? r.monto ?? 0);
      if (!Number.isFinite(amt)) return;
      map[invId] = (map[invId] || 0) + amt;
    });
    return map;
  }, [receipts]);

  // ✅ Helper para detectar moneda real (en tu DB tenés currency='PYG' normalmente)
  const normalizeCurrency = (row) =>
    String(row?.currency || row?.currency_code || row?.moneda || 'PYG').toUpperCase();

  const getClientLabel = (row) => {
    const name =
      row?.client_name ||
      row?.client ||
      row?.organization_name ||
      row?.organization ||
      '';
    if (String(name || '').trim()) return name;
    // fallback para no quedar todo "Sin cliente"
    const orgId = row?.organization_id ?? row?.org_id ?? row?.organizationId ?? null;
    return orgId ? `Cliente #${orgId}` : 'Sin cliente';
  };

  const filtered = useMemo(() => {
    const cliente = (filters.cliente || '').toLowerCase();
    const monedaFiltro = (filters.moneda || 'todas').toLowerCase();

    return rows
      .map((row) => {
        const currency = normalizeCurrency(row);

        const subtotal = Number(row?.subtotal ?? row?.base_amount ?? 0);
        const tax = Number(row?.tax_amount ?? 0);

        // ✅ prioridad: total_amount (backend) → total (alias) → subtotal+tax
        const totalRaw = Number(row?.total_amount ?? row?.total ?? 0);
        const total = totalRaw > 0 ? totalRaw : Math.max(0, subtotal + tax);

        // pagos
        const paidBase = Number(row?.paid || row?.payments_total || row?.paid_amount || 0);
        const paidReceipts = receiptsByInvoice[row?.id] || 0;
        const paid = paidBase + paidReceipts;

        const credited = Number(row?.credited_total || 0);
        const netTotal = Math.max(0, total - credited);

        // ✅ si backend ya tiene balance/net_balance, úsalo como guía también
        const balanceDb = Number(row?.net_balance ?? row?.balance ?? 0);

        let pending = Math.max(0, netTotal - paid);
        if (pending <= 0 && total > 0 && paid < total) {
          pending = Math.max(0, total - paid - credited);
        }

        // Si DB trae un net_balance > 0, preferirlo cuando el cálculo de UI quede 0 por discrepancias
        if (pending <= 0.0001 && balanceDb > 0.0001) {
          pending = balanceDb;
        }

        const credit = paidReceipts; // para mostrar en columna Haber

        return { ...row, currency, paid, credited, total, netTotal, pending, credit };
      })
      .filter((row) => {
        // ✅ ANTES: filtraba solo USD (te dejaba todo vacío en PYG)
        // AHORA: permite filtrar por moneda si querés, o ver todas
        if (monedaFiltro !== 'todas' && String(row.currency).toLowerCase() !== monedaFiltro) {
          return false;
        }

        const name = getClientLabel(row);
        const matchCliente = name.toLowerCase().includes(cliente);

        const status = (row?.status || '').toLowerCase();
        let pass = matchCliente;

        switch (filters.estado) {
          case 'todos':
            break;
          case 'pendiente':
            pass = pass && row.pending > 0.0001;
            break;
          case 'pagado':
            pass = pass && row.pending <= 0.0001;
            break;
          case 'parcial':
            pass = pass && row.pending > 0.0001 && row.paid > 0;
            break;
          case 'vencido':
            pass = pass && status === 'vencido';
            break;
          default:
            pass = pass && status === filters.estado.toLowerCase();
        }
        return pass;
      });
  }, [rows, filters, receiptsByInvoice]);

  const ledger = filtered.map((row) => {
    const debit = Number(row?.pending || row?.netTotal || row?.total || row?.total_amount || 0);
    const credit = Number(row?.credit || 0);
    const balance = Math.max(0, debit - credit);

    return {
      ...row,
      client_label: getClientLabel(row), // ✅ para usar consistente en UI
      debit,
      credit,
      balance,
      running: balance,
    };
  });

  const clientTotals = useMemo(() => {
    return ledger.reduce((acc, row) => {
      const key = row?.client_label || 'Sin cliente';
      acc[key] = (acc[key] || 0) + row.debit - row.credit;
      return acc;
    }, {});
  }, [ledger]);

  const summary = ledger.reduce(
    (acc, r) => {
      acc.saldo += r.balance;
      if ((r.status || '').toLowerCase() === 'vencido') {
        acc.vencido += r.balance > 0 ? r.balance : 0;
      }
      return acc;
    },
    { saldo: 0, vencido: 0 }
  );

  const clientInvoices = useMemo(() => {
    if (!selectedClient) return [];
    return ledger.filter((row) => (row?.client_label || 'Sin cliente') === selectedClient);
  }, [ledger, selectedClient]);

  // ✅ moneda de resumen: si hay solo una moneda en los filtros, usar esa. Si hay varias, mostramos USD como fallback.
  const summaryCurrency = useMemo(() => {
    const mon = (filters.moneda || 'todas').toUpperCase();
    if (mon !== 'TODAS') return mon;
    // si todo lo filtrado es una sola moneda, usarla
    const uniq = Array.from(new Set(ledger.map((r) => r.currency).filter(Boolean)));
    return uniq.length === 1 ? uniq[0] : 'USD';
  }, [filters.moneda, ledger]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Estado de cuenta de CLIENTES</h1>
          <p className="text-sm text-slate-500">
            Consulta rápida de saldos, facturas, notas de crédito y pagos aplicados.
          </p>
        </div>
        <div className="flex gap-3 text-right">
          <div>
            <div className="text-xs text-slate-500">Saldo</div>
            <div className="text-lg font-semibold">{formatMoney(summary.saldo, summaryCurrency)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Total vencido</div>
            <div className="text-lg font-semibold text-red-600">
              {formatMoney(summary.vencido, summaryCurrency)}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 bg-white p-4 rounded-lg border">
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
          <label className="text-xs text-slate-500">Estado</label>
          <select
            className="mt-1 w-full border rounded px-2 py-1 text-sm"
            value={filters.estado}
            onChange={(e) => setFilters((f) => ({ ...f, estado: e.target.value }))}
          >
            <option value="todos">Todos</option>
            <option value="pendiente">Pendiente</option>
            <option value="parcial">Parcial</option>
            <option value="pagado">Pagado</option>
            <option value="vencido">Vencido</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-slate-500">Moneda</label>
          <select
            className="mt-1 w-full border rounded px-2 py-1 text-sm"
            value={filters.moneda}
            onChange={(e) => setFilters((f) => ({ ...f, moneda: e.target.value }))}
          >
            <option value="todas">Todas</option>
            <option value="PYG">PYG</option>
            <option value="USD">USD</option>
          </select>
        </div>

        <div className="flex items-end gap-2 md:col-span-2">
          <button
            className="px-3 py-2 text-sm border rounded"
            onClick={() =>
              setFilters({
                cliente: '',
                estado: 'pendiente',
                moneda: 'todas',
              })
            }
          >
            Limpiar filtros
          </button>
          <button
            className="px-3 py-2 text-sm bg-slate-900 text-white rounded"
            onClick={() => setFilters({ ...filters })}
          >
            Aplicar
          </button>
        </div>
      </div>

      <div className="bg-white border rounded-lg p-3">
        <div className="text-sm font-semibold mb-2">Saldos por cliente</div>
        <div className="divide-y">
          {Object.keys(clientTotals).length === 0 && (
            <div className="py-2 text-slate-500 text-sm">Sin saldos pendientes.</div>
          )}
          {Object.entries(clientTotals).map(([client, val]) => {
            const isSel = selectedClient === client;
            return (
              <button
                key={client}
                className={`flex w-full justify-between py-1 text-sm text-left px-2 rounded ${
                  isSel ? 'bg-slate-100 font-semibold' : 'hover:bg-slate-50'
                }`}
                onClick={() => setSelectedClient((prev) => (prev === client ? '' : client))}
              >
                <span>{client}</span>
                <span className="font-semibold">{formatMoney(val, summaryCurrency)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {selectedClient && (
        <div className="bg-white border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">
              Pendientes de: <span className="text-slate-700">{selectedClient}</span>
            </div>
            <div className="text-xs text-slate-500">{clientInvoices.length} documento(s)</div>
          </div>

          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="text-left px-3 py-2">Documento</th>
                  <th className="text-left px-3 py-2">Referencia</th>
                  <th className="text-left px-3 py-2">Fecha</th>
                  <th className="text-right px-3 py-2">Pendiente</th>
                  <th className="text-right px-3 py-2">Total</th>
                  <th className="text-left px-3 py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {clientInvoices.map((inv) => (
                  <tr key={`${inv.id || inv.number}`} className="border-t">
                    <td className="px-3 py-2">{inv?.number || inv?.invoice_number || inv?.id || '-'}</td>
                    <td className="px-3 py-2">
                      {inv?.reference ||
                      inv?.deal_reference ||
                      inv?.operation_reference ||
                      inv?.deal_ref ||
                      inv?.operation_ref ? (
                        <a
                          className="text-blue-600 hover:underline"
                          href={
                            inv?.deal_id || inv?.operation_id
                              ? `/operations/${inv.deal_id || inv.operation_id}`
                              : '#'
                          }
                          target="_blank"
                          rel="noreferrer"
                        >
                          {inv?.reference ||
                            inv?.deal_reference ||
                            inv?.operation_reference ||
                            inv?.deal_ref ||
                            inv?.operation_ref}
                        </a>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {inv?.issue_date?.slice(0, 10) || inv?.created_at?.slice(0, 10) || '-'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(inv?.pending || 0, inv?.currency || summaryCurrency)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div>Total: {formatMoney(inv?.total || inv?.total_amount || 0, inv?.currency || summaryCurrency)}</div>
                      <div className="text-xs text-amber-700">
                        NC: {formatMoney(inv?.credited || 0, inv?.currency || summaryCurrency)}
                      </div>
                      <div className="text-xs text-slate-600">
                        Neto: {formatMoney(inv?.netTotal || 0, inv?.currency || summaryCurrency)}
                      </div>
                    </td>
                    <td className="px-3 py-2 space-x-2 whitespace-nowrap">
                      <a
                        className="text-blue-600 hover:underline"
                        href={`/invoices/${inv.id || inv.invoice_id || inv.number || ''}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Ver factura
                      </a>
                      <a
                        className="text-emerald-600 hover:underline"
                        href={`/invoices/${inv.id || inv.invoice_id || inv.number || ''}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Registrar pago
                      </a>
                      <a
                        className="text-orange-600 hover:underline"
                        href={`/invoices/${inv.id || inv.invoice_id || inv.number || ''}#credit-note`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Nota de crédito
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-white border rounded-lg overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="text-left px-3 py-2">Fecha</th>
              <th className="text-left px-3 py-2">Tipo</th>
              <th className="text-left px-3 py-2">Documento</th>
              <th className="text-left px-3 py-2">Cliente</th>
              <th className="text-right px-3 py-2">Debe</th>
              <th className="text-right px-3 py-2">Haber</th>
              <th className="text-right px-3 py-2">Saldo</th>
              <th className="text-left px-3 py-2">Estado</th>
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
            {!loading && error && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-center text-red-600">
                  {error}
                </td>
              </tr>
            )}
            {!loading && !error && ledger.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-center text-slate-500">
                  Sin movimientos para los filtros seleccionados.
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              ledger.map((row, idx) => (
                <tr key={idx} className="border-t">
                  <td className="px-3 py-2">
                    {row?.issue_date?.slice(0, 10) || row?.created_at?.slice(0, 10) || '-'}
                  </td>
                  <td className="px-3 py-2">{row?.type || row?.kind || 'Factura'}</td>
                  <td className="px-3 py-2">
                    <a
                      className="text-blue-600 hover:underline"
                      href={`/invoices/${row.id || row.invoice_id || row.number || ''}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {row?.number || row?.invoice_number || '-'}
                    </a>
                  </td>
                  <td className="px-3 py-2">{row?.client_label || '-'}</td>
                  <td
                    className="px-3 py-2 text-right"
                    title={`total: ${formatMoney(row.total, row.currency)} | pagado: ${formatMoney(row.paid, row.currency)} | notas: ${formatMoney(row.credited, row.currency)} | pendiente calc: ${formatMoney(row.pending, row.currency)}`}
                  >
                    {formatMoney(row.debit, row.currency)}
                  </td>
                  <td
                    className="px-3 py-2 text-right"
                    title={`recibos aplicados: ${formatMoney(row.credit, row.currency)} | pagado base: ${formatMoney(row.paid, row.currency)}`}
                  >
                    {formatMoney(row.credit, row.currency)}
                  </td>
                  <td
                    className="px-3 py-2 text-right"
                    title={`saldo pendiente: ${formatMoney(row.balance, row.currency)} | pendiente calc: ${formatMoney(row.pending, row.currency)} | pagos: ${formatMoney(row.paid, row.currency)} | nc: ${formatMoney(row.credited, row.currency)}`}
                  >
                    {formatMoney(row.balance, row.currency)}
                  </td>
                  <td className="px-3 py-2 capitalize">{row?.status || '-'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
