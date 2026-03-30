import React, { useEffect, useMemo, useState } from 'react';
import api from '../api';
import { useRef } from 'react';

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
  const [htmlPreview, setHtmlPreview] = useState('');
  const [htmlTitle, setHtmlTitle] = useState('');
  const htmlRef = useRef(null);
  const [filters, setFilters] = useState({
    cliente: '',
    estado: 'pendiente', // por defecto solo pendientes
    moneda: 'todas', // ✅ NUEVO: permitir PYG / USD / todas
    search: '',
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
  const normalizeCurrency = (row) => {
    const raw = String(
      row?.currency_code ||
        row?.currency_resolved ||
        row?.moneda ||
        row?.currency ||
        ''
    ).toUpperCase();
    if (raw) return raw;
    const ex = Number(
      row?.exchange_rate ||
        row?.exchange_rate_resolved ||
        row?.exchangeRate ||
        0
    );
    if (Number.isFinite(ex) && ex > 1.5) return 'PYG';
    return 'USD';
  };

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
    const q = (filters.search || '').toLowerCase();

    return rows
      .map((row) => {
        const currency = normalizeCurrency(row);

        const subtotal = Number(row?.subtotal ?? row?.base_amount ?? 0);
        const tax = Number(row?.tax_amount ?? 0);

        // ✅ prioridad: total_amount (backend) → total (alias) → subtotal+tax
        const totalRaw = Number(row?.total_amount ?? row?.total ?? 0);
        const total = totalRaw > 0 ? totalRaw : Math.max(0, subtotal + tax);

        const statusRaw = (row?.status || "").toLowerCase();
        const isCanceled = statusRaw === "anulada";

        // pagos
        const paidBase = Number(row?.paid || row?.payments_total || row?.paid_amount || 0);
        const paidReceipts = receiptsByInvoice[row?.id] || 0;
        const paid = paidBase + paidReceipts;

        const credited = Number(row?.credited_total || 0);
        const netTotalDb = Number(row?.net_total_amount ?? 0);
        const netTotal = netTotalDb > 0 ? netTotalDb : Math.max(0, total - credited);

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
        const displayStatus = isCanceled
          ? "anulada por nc"
          : statusRaw || row?.status || "";

        if (isCanceled) {
          return {
            ...row,
            currency,
            paid,
            credited,
            total,
            netTotal,
            pending: 0,
            credit: 0,
            display_status: displayStatus,
            is_canceled: true,
          };
        }

        return { ...row, currency, paid, credited, total, netTotal, pending, credit, display_status: displayStatus, is_canceled: false };
      })
      .filter((row) => {
        // ✅ ANTES: filtraba solo USD (te dejaba todo vacío en PYG)
        // AHORA: permite filtrar por moneda si querés, o ver todas
        if (monedaFiltro !== 'todas' && String(row.currency).toLowerCase() !== monedaFiltro) {
          return false;
        }

        const name = getClientLabel(row);
        const matchCliente = name.toLowerCase().includes(cliente);
        const haystack = [
          name,
          row?.reference,
          row?.deal_reference,
          row?.operation_reference,
          row?.deal_ref,
          row?.operation_ref,
          row?.number,
          row?.invoice_number,
          row?.status,
          row?.type,
          row?.kind,
        ]
          .filter(Boolean)
          .map((v) => String(v).toLowerCase())
          .join(' ');
        const matchSearch = q ? haystack.includes(q) : true;

        const status = (row?.status || '').toLowerCase();
        let pass = matchCliente && matchSearch;

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
    const debit = row?.is_canceled
      ? 0
      : Number(row?.pending || row?.netTotal || row?.total || row?.total_amount || 0);
    const credit = row?.is_canceled ? 0 : Number(row?.credit || 0);
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
      const curr = (row.currency || 'USD').toUpperCase();
      if (!acc[key]) acc[key] = {};
      if (!row.is_canceled) {
        acc[key][curr] = (acc[key][curr] || 0) + row.debit - row.credit;
      }
      return acc;
    }, {});
  }, [ledger]);

  const summary = ledger.reduce(
    (acc, r) => {
      const curr = (r.currency || 'USD').toUpperCase();
      if (!acc.saldo[curr]) acc.saldo[curr] = 0;
      if (!acc.vencido[curr]) acc.vencido[curr] = 0;
      if (!r.is_canceled) {
        acc.saldo[curr] += r.balance;
      }
      if ((r.status || '').toLowerCase() === 'vencido' && !r.is_canceled) {
        acc.vencido[curr] += r.balance > 0 ? r.balance : 0;
      }
      return acc;
    },
    { saldo: {}, vencido: {} }
  );

  const clientInvoices = useMemo(() => {
    if (!selectedClient) return [];
    return ledger.filter((row) => (row?.client_label || 'Sin cliente') === selectedClient);
  }, [ledger, selectedClient]);

  const getInvoiceReference = (row) =>
    row?.reference ||
    row?.deal_reference ||
    row?.operation_reference ||
    row?.deal_ref ||
    row?.operation_ref ||
    '';

  const getInvoiceDescription = (row) =>
    row?.first_item_desc ||
    row?.description ||
    '';

  const getInvoiceDate = (row) => row?.issue_date?.slice(0, 10) || row?.created_at?.slice(0, 10) || '';

  const getDaysElapsed = (dateStr) => {
    if (!dateStr) return '';
    const base = new Date(dateStr);
    if (Number.isNaN(base.getTime())) return '';
    const diff = Date.now() - base.getTime();
    return Math.max(0, Math.floor(diff / 86400000));
  };

  const formatExportAmount = (amount, currency) => {
    const curr = String(currency || '').toUpperCase();
    const isPyg = curr === 'PYG' || curr === 'GS';
    return new Intl.NumberFormat('es-PY', {
      minimumFractionDigits: isPyg ? 0 : 2,
      maximumFractionDigits: isPyg ? 0 : 2,
    }).format(Number(amount || 0));
  };

  const buildExportRows = (list) =>
    list
      .filter((r) => !r.is_canceled && Number(r.pending || 0) > 0.0001)
      .map((r) => {
        const dateStr = getInvoiceDate(r);
        const moneda = (r?.currency || '').toUpperCase() || normalizeCurrency(r);
        const monto = Number(r?.pending || r?.netTotal || r?.total || r?.total_amount || 0);
        return {
          factura: r?.number || r?.invoice_number || r?.id || '',
          fecha: dateStr,
          referencia: getInvoiceReference(r),
          descripcion: getInvoiceDescription(r),
          monto,
          monto_fmt: formatExportAmount(monto, moneda),
          moneda,
          dias: getDaysElapsed(dateStr),
        };
      });

  const exportCsv = (rowsToExport, filename) => {
    const headers = ['Factura', 'Fecha', 'Referencia', 'Descripcion', 'Monto', 'Moneda', 'Dias transcurridos'];
    const sep = ';';
    const lines = [headers.join(sep)];
    rowsToExport.forEach((r) => {
      const line = [
        String(r.factura || '').replace(/"/g, '""'),
        String(r.fecha || '').replace(/"/g, '""'),
        String(r.referencia || '').replace(/"/g, '""'),
        String(r.descripcion || '').replace(/"/g, '""'),
        String(r.monto_fmt ?? r.monto ?? '').replace(/"/g, '""'),
        String(r.moneda ?? '').replace(/"/g, '""'),
        String(r.dias ?? '').replace(/"/g, '""'),
      ]
        .map((v) => `"${v}"`)
        .join(sep);
      lines.push(line);
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const buildHtmlTable = (rowsToExport, title) => {
    const header = `
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:12px;">
        <thead style="background:#f1f5f9;">
          <tr>
            <th align="left">Factura</th>
            <th align="left">Fecha</th>
            <th align="left">Referencia</th>
            <th align="left">Descripcion</th>
            <th align="right">Monto</th>
            <th align="left">Moneda</th>
            <th align="right">Dias transcurridos</th>
          </tr>
        </thead>
        <tbody>
    `;
    const body = rowsToExport
      .map(
        (r) => `
          <tr>
            <td>${r.factura || ''}</td>
            <td>${r.fecha || ''}</td>
            <td>${r.referencia || ''}</td>
            <td>${r.descripcion || ''}</td>
            <td align="right">${r.monto_fmt ?? r.monto ?? ''}</td>
            <td>${r.moneda ?? ''}</td>
            <td align="right">${r.dias ?? ''}</td>
          </tr>
        `
      )
      .join('');
    const footer = `
        </tbody>
      </table>
    `;
    const titleHtml = title ? `<div style="font-family:Arial,sans-serif;font-size:14px;font-weight:bold;margin-bottom:6px;">${title}</div>` : '';
    return `${titleHtml}${header}${body}${footer}`;
  };

  const openHtmlPreview = (rowsToExport, title) => {
    const html = buildHtmlTable(rowsToExport, title);
    setHtmlTitle(title || 'Tabla de estado de cuenta');
    setHtmlPreview(html);
  };

  const copyHtml = async () => {
    if (!htmlPreview) return;
    try {
      const plain = htmlRef.current?.innerText || '';
      if (window.ClipboardItem) {
        const htmlBlob = new Blob([htmlPreview], { type: 'text/html' });
        const textBlob = new Blob([plain], { type: 'text/plain' });
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': htmlBlob,
            'text/plain': textBlob,
          }),
        ]);
        alert('Tabla copiada.');
        return;
      }
      await navigator.clipboard.writeText(plain || htmlPreview);
      alert('Tabla copiada.');
    } catch (_) {
      alert('No se pudo copiar. Selecciona y copia manualmente.');
    }
  };

  // ✅ moneda de resumen: si hay solo una moneda en los filtros, usar esa. Si hay varias, mostramos USD como fallback.
  const summaryCurrencies = useMemo(() => {
    const mon = (filters.moneda || 'todas').toUpperCase();
    if (mon !== 'TODAS') return [mon];
    const uniq = Array.from(new Set(ledger.map((r) => r.currency).filter(Boolean)));
    return uniq.length ? uniq : ['USD'];
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
        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="px-3 py-2 text-sm border rounded"
            onClick={() => exportCsv(buildExportRows(ledger), 'estado-cuenta-general.csv')}
            disabled={ledger.length === 0}
          >
            Exportar Excel (General)
          </button>
          <button
            className="px-3 py-2 text-sm border rounded"
            onClick={() => openHtmlPreview(buildExportRows(ledger), 'Estado de cuenta (General)')}
            disabled={ledger.length === 0}
          >
            Generar tabla HTML (General)
          </button>
        </div>
        <div className="flex gap-3 text-right">
          <div>
            <div className="text-xs text-slate-500">Saldo</div>
            <div className="text-lg font-semibold space-y-0.5">
              {summaryCurrencies.map((c) => (
                <div key={c}>{formatMoney(summary.saldo[c] || 0, c)}</div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Total vencido</div>
            <div className="text-lg font-semibold text-red-600 space-y-0.5">
              {summaryCurrencies.map((c) => (
                <div key={c}>{formatMoney(summary.vencido[c] || 0, c)}</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 bg-white p-4 rounded-lg border">
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
          <label className="text-xs text-slate-500">Buscar</label>
          <input
            className="mt-1 w-full border rounded px-2 py-1 text-sm"
            placeholder="Operación, factura, referencia, estado..."
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
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
                search: '',
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
            const currencies = Object.keys(val || {});
            return (
              <button
                key={client}
                className={`flex w-full justify-between py-1 text-sm text-left px-2 rounded ${
                  isSel ? 'bg-slate-100 font-semibold' : 'hover:bg-slate-50'
                }`}
                onClick={() => setSelectedClient((prev) => (prev === client ? '' : client))}
              >
                <span>{client}</span>
                <span className="font-semibold text-right">
                  {currencies.length === 0 && formatMoney(0, 'USD')}
                  {currencies.map((c) => (
                    <div key={c}>{formatMoney(val[c] || 0, c)}</div>
                  ))}
                </span>
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
          <div className="flex items-center gap-2 flex-wrap">
            <button
              className="px-3 py-2 text-sm border rounded"
              onClick={() =>
                exportCsv(buildExportRows(clientInvoices), `estado-cuenta-${selectedClient}.csv`)
              }
            >
              Exportar Excel (Cliente)
            </button>
            <button
              className="px-3 py-2 text-sm border rounded"
              onClick={() =>
                openHtmlPreview(
                  buildExportRows(clientInvoices),
                  `Estado de cuenta - ${selectedClient}`
                )
              }
            >
              Generar tabla HTML (Cliente)
            </button>
          </div>

          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="text-left px-3 py-2">Documento</th>
                  <th className="text-left px-3 py-2">Referencia</th>
                  <th className="text-left px-3 py-2">Descripcion</th>
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
                      {inv?.first_item_desc || inv?.description || '-'}
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
              <th className="text-left px-3 py-2">Referencia</th>
              <th className="text-left px-3 py-2">Descripcion</th>
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
                <td colSpan={9} className="px-3 py-4 text-center text-slate-500">
                  Cargando...
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-center text-red-600">
                  {error}
                </td>
              </tr>
            )}
            {!loading && !error && ledger.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-center text-slate-500">
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
                  <td className="px-3 py-2">
                    {row?.reference ||
                    row?.deal_reference ||
                    row?.operation_reference ||
                    row?.deal_ref ||
                    row?.operation_ref ? (
                      <a
                        className="text-blue-600 hover:underline"
                        href={`/operations/${row.deal_id || row.operation_id || ''}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {row?.reference ||
                          row?.deal_reference ||
                          row?.operation_reference ||
                          row?.deal_ref ||
                          row?.operation_ref}
                      </a>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-3 py-2">{row?.first_item_desc || row?.description || '-'}</td>
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
                    <td className="px-3 py-2 capitalize">
                      {row?.display_status || row?.status || '-'}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {htmlPreview && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-4xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">{htmlTitle || 'Tabla HTML'}</div>
              <button className="text-sm px-3 py-1.5 border rounded" onClick={() => setHtmlPreview('')}>
                Cerrar
              </button>
            </div>
            <div className="text-xs text-slate-500">
              Vista previa para copiar y pegar en el correo.
            </div>
            <div
              ref={htmlRef}
              className="border rounded p-3 bg-white overflow-auto max-h-[60vh]"
              dangerouslySetInnerHTML={{ __html: htmlPreview }}
            />
            <div className="flex justify-end">
              <button className="px-3 py-2 text-sm bg-slate-900 text-white rounded" onClick={copyHtml}>
                Copiar HTML
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
