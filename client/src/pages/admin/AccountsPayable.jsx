import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import AccountsPayableVendorDrawer from './AccountsPayableVendorDrawer.jsx';

function fmtMoney(amount, currencyCode = 'PYG') {
  const value = Number(amount || 0);
  const currency = String(currencyCode || 'PYG').toUpperCase();
  return `${currency} ${value.toLocaleString('es-PY', {
    minimumFractionDigits: currency === 'USD' ? 2 : 0,
    maximumFractionDigits: currency === 'USD' ? 2 : 0,
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

function CurrencySummary({ label, values, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-50 text-slate-700',
    blue: 'bg-blue-50 text-blue-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
  };
  const entries = Object.entries(values || {});
  return (
    <div className="border rounded-xl p-3 bg-white">
      <div className="text-xs text-slate-500">{label}</div>
      {entries.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {entries.map(([currency, amount]) => (
            <span
              key={currency}
              className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${tones[tone] || tones.slate}`}
            >
              {fmtMoney(amount, currency)}
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-2 inline-flex rounded-lg px-3 py-1.5 text-sm font-semibold bg-slate-50 text-slate-500">
          Sin datos
        </div>
      )}
    </div>
  );
}

function StatusChip({ label, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    blue: 'bg-blue-100 text-blue-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-700',
    emerald: 'bg-emerald-100 text-emerald-700',
  };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${tones[tone] || tones.slate}`}>
      {label}
    </span>
  );
}

function ReferenceLinks({ value, targets, onOpen }) {
  const references = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const targetMap = new Map();
  String(targets || '')
    .split('||')
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const [operationType, operationId, ...referenceParts] = entry.split('::');
      const reference = referenceParts.join('::').trim();
      if (!reference || !operationId) return;
      targetMap.set(reference, {
        operationType: operationType === 'service' ? 'service' : 'deal',
        operationId,
        reference,
      });
    });

  const items = references.map((reference) => targetMap.get(reference) || { reference });

  if (!items.length) return <span>-</span>;

  return (
    <div className="max-w-[280px] truncate text-xs text-slate-600" title={items.map((item) => item.reference).join(', ')}>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <button
            key={`${item.operationType || 'ref'}-${item.operationId || 'na'}-${item.reference}`}
            type="button"
            className="text-blue-600 hover:underline"
            onClick={() => onOpen(item)}
            title={item.reference}
          >
            {item.reference}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function AccountsPayable() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({
    suppliers: 0,
    rows: 0,
    open_documents: 0,
    invoiced_by_currency: {},
    paid_by_currency: {},
    balance_by_currency: {},
    overdue_by_currency: {},
  });
  const [dashboard, setDashboard] = useState({
    document_count: 0,
    overdue_count: 0,
    due_today_count: 0,
    upcoming_7d_count: 0,
    due_this_month_count: 0,
    aging_by_currency: {},
    debt_by_module: [],
    upcoming_due: [],
  });
  const [filters, setFilters] = useState({
    supplier_q: '',
    currency_code: '',
    module_key: 'all',
    quick_filter: '',
    open_only: false,
    overdue: false,
  });
  const [selectedVendor, setSelectedVendor] = useState(null);

  function openVendorDrawer(row, movementKind = 'all') {
    setSelectedVendor({
      supplier_key: row.supplier_key,
      currency_code: row.currency_code,
      supplier_name: row.supplier_name,
      reference: '',
      movement_kind: movementKind,
    });
  }

  function openReference(item) {
    const operationId = Number(item?.operationId || 0);
    if (!operationId) return;
    const href =
      item?.operationType === 'service'
        ? `/service/cases/${operationId}?tab=administracion`
        : `/operations/${operationId}?tab=administracion`;
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  const moduleOptions = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      const modules = String(row.modules || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      for (const label of modules) {
        const key = label.toLowerCase();
        if (!map.has(key)) map.set(key, label);
      }
    }
    return [
      { value: 'all', label: 'Todos los modulos' },
      { value: 'atm-cargo', label: 'ATM CARGO' },
      { value: 'atm-industrial', label: 'ATM INDUSTRIAL' },
      { value: 'atm-container', label: 'ATM CONTAINER' },
      { value: 'services', label: 'Servicios y mantenimiento' },
      { value: 'admin-purchases', label: 'Compras administrativas' },
      { value: 'admin-expenses', label: 'Gastos administrativos' },
      ...Array.from(map.entries())
        .filter(([key]) => !['atm-cargo', 'atm-industrial', 'atm-container', 'services', 'admin-purchases', 'admin-expenses'].includes(key))
        .map(([value, label]) => ({ value, label })),
    ];
  }, [rows]);

  async function loadData() {
    setLoading(true);
    try {
      const params = {
        supplier_q: filters.supplier_q || undefined,
        currency_code: filters.currency_code || undefined,
        module_key: filters.module_key || 'all',
        quick_filter: filters.quick_filter || undefined,
        open_only: filters.open_only ? 1 : undefined,
        overdue: filters.overdue ? 1 : undefined,
      };
      const { data } = await api.get('/accounts-payable/summary', { params });
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setTotals(
        data?.totals || {
          suppliers: 0,
          rows: 0,
          open_documents: 0,
          invoiced_by_currency: {},
          paid_by_currency: {},
          balance_by_currency: {},
          overdue_by_currency: {},
        }
      );
      setDashboard(
        data?.dashboard || {
          document_count: 0,
          overdue_count: 0,
          due_today_count: 0,
          upcoming_7d_count: 0,
          due_this_month_count: 0,
          aging_by_currency: {},
          debt_by_module: [],
          upcoming_due: [],
        }
      );
    } catch (error) {
      console.error('accounts payable summary error', error);
      setRows([]);
      setTotals({
        suppliers: 0,
        rows: 0,
        open_documents: 0,
        invoiced_by_currency: {},
        paid_by_currency: {},
        balance_by_currency: {},
        overdue_by_currency: {},
      });
      setDashboard({
        document_count: 0,
        overdue_count: 0,
        due_today_count: 0,
        upcoming_7d_count: 0,
        due_this_month_count: 0,
        aging_by_currency: {},
        debt_by_module: [],
        upcoming_due: [],
      });
    } finally {
      setLoading(false);
    }
  }

  async function exportSummary() {
    try {
      const params = {
        supplier_q: filters.supplier_q || undefined,
        currency_code: filters.currency_code || undefined,
        module_key: filters.module_key || 'all',
        quick_filter: filters.quick_filter || undefined,
        open_only: filters.open_only ? 1 : undefined,
        overdue: filters.overdue ? 1 : undefined,
      };
      const res = await api.get('/accounts-payable/summary/export', {
        params,
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cuentas-a-pagar.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('accounts payable export error', error);
      alert('No se pudo exportar el resumen.');
    }
  }

  async function exportSummaryPdf() {
    try {
      const params = {
        supplier_q: filters.supplier_q || undefined,
        currency_code: filters.currency_code || undefined,
        module_key: filters.module_key || 'all',
        quick_filter: filters.quick_filter || undefined,
        open_only: filters.open_only ? 1 : undefined,
        overdue: filters.overdue ? 1 : undefined,
      };
      const res = await api.get('/accounts-payable/summary/pdf', {
        params,
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (error) {
      console.error('accounts payable pdf error', error);
      alert('No se pudo generar el PDF del resumen.');
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Cuentas a pagar</h1>
          <p className="text-sm text-slate-500 mt-1">
            Resumen empresa por proveedor y moneda usando facturas de compra ya cargadas.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportSummaryPdf}
            className="px-3 py-2 text-sm rounded-lg border hover:bg-slate-50"
          >
            Exportar PDF
          </button>
          <button
            type="button"
            onClick={exportSummary}
            className="px-3 py-2 text-sm rounded-lg border hover:bg-slate-50"
          >
            Exportar Excel
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          <input
            className="border rounded-lg px-3 py-2"
            placeholder="Proveedor o RUC"
            value={filters.supplier_q}
            onChange={(e) => setFilters((prev) => ({ ...prev, supplier_q: e.target.value }))}
          />
          <select
            className="border rounded-lg px-3 py-2"
            value={filters.module_key}
            onChange={(e) => setFilters((prev) => ({ ...prev, module_key: e.target.value }))}
          >
            {moduleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            className="border rounded-lg px-3 py-2"
            value={filters.currency_code}
            onChange={(e) => setFilters((prev) => ({ ...prev, currency_code: e.target.value }))}
          >
            <option value="">Todas las monedas</option>
            <option value="PYG">PYG</option>
            <option value="USD">USD</option>
          </select>
          <label className="inline-flex items-center gap-2 border rounded-lg px-3 py-2">
            <input
              type="checkbox"
              checked={filters.open_only}
              onChange={(e) => setFilters((prev) => ({ ...prev, open_only: e.target.checked }))}
            />
            Solo abiertos
          </label>
          <label className="inline-flex items-center gap-2 border rounded-lg px-3 py-2">
            <input
              type="checkbox"
              checked={filters.overdue}
              onChange={(e) => setFilters((prev) => ({ ...prev, overdue: e.target.checked }))}
            />
            Solo vencidos
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            { value: '', label: 'Todos' },
            { value: 'due_today', label: 'Vence hoy' },
            { value: 'due_7d', label: 'Vence en 7 dias' },
            { value: 'age_90_plus', label: '90+ dias' },
            { value: 'no_due_date', label: 'Sin vencimiento' },
          ].map((item) => {
            const active = filters.quick_filter === item.value;
            return (
              <button
                key={item.value || 'all'}
                type="button"
                onClick={() => setFilters((prev) => ({ ...prev, quick_filter: item.value }))}
                className={`px-3 py-1.5 text-sm rounded-full border transition ${
                  active
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
        <div className="border rounded-xl p-3 bg-white">
          <div className="text-xs text-slate-500">Proveedores</div>
          <div className="mt-2 inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold bg-slate-50 text-slate-700">
            {totals.suppliers}
          </div>
        </div>
        <div className="border rounded-xl p-3 bg-white">
          <div className="text-xs text-slate-500">Docs abiertos</div>
          <div className="mt-2 inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold bg-slate-50 text-slate-700">
            {totals.open_documents}
          </div>
        </div>
        <CurrencySummary label="Saldo pendiente" values={totals.balance_by_currency} tone="blue" />
        <CurrencySummary label="Saldo vencido" values={totals.overdue_by_currency} tone="amber" />
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
        <div className="border rounded-xl p-3 bg-white">
          <div className="text-xs text-slate-500">Documentos abiertos</div>
          <div className="mt-2 inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold bg-blue-50 text-blue-700">
            {dashboard.document_count}
          </div>
        </div>
        <div className="border rounded-xl p-3 bg-white">
          <div className="text-xs text-slate-500">Vencidos</div>
          <div className="mt-2 inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold bg-red-50 text-red-700">
            {dashboard.overdue_count}
          </div>
        </div>
        <div className="border rounded-xl p-3 bg-white">
          <div className="text-xs text-slate-500">Vencen hoy / 7 dias</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold bg-amber-50 text-amber-700">
              Hoy: {dashboard.due_today_count}
            </span>
            <span className="inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold bg-slate-50 text-slate-700">
              7 dias: {dashboard.upcoming_7d_count}
            </span>
          </div>
        </div>
        <div className="border rounded-xl p-3 bg-white">
          <div className="text-xs text-slate-500">Vencen este mes</div>
          <div className="mt-2 inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700">
            {dashboard.due_this_month_count}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <CurrencySummary label="Total facturado" values={totals.invoiced_by_currency} tone="slate" />
        <CurrencySummary label="Total pagado" values={totals.paid_by_currency} tone="emerald" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="bg-white border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-slate-50 font-medium">Deuda por modulo</div>
          {!dashboard.debt_by_module?.length ? (
            <div className="p-4 text-sm text-slate-500">No hay deuda abierta por modulo para los filtros actuales.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white">
                  <tr className="border-b">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Modulo</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Docs abiertos</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.debt_by_module.map((item) => (
                    <tr key={item.module_name} className="border-b last:border-b-0">
                      <td className="px-4 py-3 font-medium">{item.module_name}</td>
                      <td className="px-4 py-3">{item.open_documents}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(item.balance_by_currency || {}).map(([currency, amount]) => (
                            <span
                              key={`${item.module_name}-${currency}`}
                              className="inline-flex rounded-lg px-3 py-1.5 text-xs font-semibold bg-blue-50 text-blue-700"
                            >
                              {fmtMoney(amount, currency)}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="bg-white border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-slate-50 font-medium">Proximos vencimientos</div>
          {!dashboard.upcoming_due?.length ? (
            <div className="p-4 text-sm text-slate-500">No hay vencimientos proximos para los filtros actuales.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white">
                  <tr className="border-b">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Vence</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Proveedor</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Modulo</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Referencia</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Documento</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.upcoming_due.map((item, index) => {
                    const href =
                      item.operation_id && item.operation_type === 'service'
                        ? `/service/cases/${item.operation_id}?tab=administracion`
                        : item.operation_id
                          ? `/operations/${item.operation_id}?tab=administracion`
                          : null;
                    return (
                      <tr key={`${item.supplier_name}-${item.document_number}-${index}`} className="border-b last:border-b-0">
                        <td className="px-4 py-3">{fmtDate(item.due_date)}</td>
                        <td className="px-4 py-3">{item.supplier_name}</td>
                        <td className="px-4 py-3 text-xs text-slate-600">{item.module_name}</td>
                        <td className="px-4 py-3">
                          {href && item.operation_reference ? (
                            <button
                              type="button"
                              className="text-blue-600 hover:underline"
                              onClick={() => window.open(href, '_blank', 'noopener,noreferrer')}
                            >
                              {item.operation_reference}
                            </button>
                          ) : (
                            <span>{item.operation_reference || '-'}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">{item.document_number || '-'}</td>
                        <td className="px-4 py-3">{fmtMoney(item.balance, item.currency_code)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b bg-slate-50 font-medium">Resumen por proveedor</div>
        {loading ? (
          <div className="p-4 text-sm text-slate-500">Cargando cuentas a pagar...</div>
        ) : rows.length === 0 ? (
          <div className="p-4 text-sm text-slate-500">No hay datos para los filtros actuales.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-white">
                <tr className="border-b">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Proveedor</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">RUC</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Moneda</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Facturado</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Pagado</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Saldo</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Vencido</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Prox. venc.</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Docs abiertos</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Con OP</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Referencias</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Modulos</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Indicadores</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.supplier_key}-${row.currency_code}`} className="border-b last:border-b-0">
                    <td className="px-4 py-3 font-medium">{row.supplier_name || 'Proveedor sin nombre'}</td>
                    <td className="px-4 py-3">{row.supplier_ruc || '-'}</td>
                    <td className="px-4 py-3">{row.currency_code}</td>
                    <td className="px-4 py-3">{fmtMoney(row.total_invoiced, row.currency_code)}</td>
                    <td className="px-4 py-3">{fmtMoney(row.total_paid, row.currency_code)}</td>
                    <td className="px-4 py-3">{fmtMoney(row.total_balance, row.currency_code)}</td>
                    <td className="px-4 py-3">
                      <span className={Number(row.overdue_balance || 0) > 0 ? 'text-red-600 font-medium' : 'text-slate-500'}>
                        {fmtMoney(row.overdue_balance, row.currency_code)}
                      </span>
                    </td>
                    <td className="px-4 py-3">{fmtDate(row.next_due_date)}</td>
                    <td className="px-4 py-3">{row.open_documents}</td>
                    <td className="px-4 py-3">{row.documents_with_payment_order}</td>
                    <td className="px-4 py-3">
                      <ReferenceLinks
                        value={row.reference_list}
                        targets={row.reference_targets}
                        onOpen={openReference}
                      />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{row.modules || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {Number(row.overdue_balance || 0) > 0 && <StatusChip label="Vencido" tone="red" />}
                        {Number(row.total_paid || 0) > 0 && Number(row.total_balance || 0) > 0 && (
                          <StatusChip label="Parcial" tone="blue" />
                        )}
                        {Number(row.documents_with_payment_order || 0) > 0 && (
                          <StatusChip label="Con OP" tone="amber" />
                        )}
                        {Number(row.total_balance || 0) <= 0.009 && <StatusChip label="Pagado" tone="emerald" />}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        className="px-2.5 py-1.5 text-xs rounded-lg border hover:bg-slate-50"
                        onClick={() => openVendorDrawer(row, 'all')}
                      >
                        Ver detalle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AccountsPayableVendorDrawer
        open={Boolean(selectedVendor)}
        supplierKey={selectedVendor?.supplier_key}
        currencyCode={selectedVendor?.currency_code}
        initialReference={selectedVendor?.reference || ''}
        initialMovementKind={selectedVendor?.movement_kind || 'all'}
        onDataChanged={loadData}
        onClose={() => setSelectedVendor(null)}
      />
    </div>
  );
}
