import React, { useEffect, useMemo, useState } from "react";
import api from "../api";
import { useAuth } from "../auth.jsx";

const PAYMENT_METHODS = [
  { value: "transferencia", label: "Transferencia" },
  { value: "efectivo", label: "Efectivo" },
  { value: "cheque", label: "Cheque" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "otro", label: "Otro" },
];

const TABS = [
  { key: "todos", label: "Todos" },
  { key: "hoy", label: "Hoy" },
  { key: "mes", label: "Este mes" },
  { key: "transferencia", label: "Transferencia" },
  { key: "efectivo", label: "Efectivo" },
  { key: "cheque", label: "Cheque" },
  { key: "tarjeta", label: "Tarjeta" },
  { key: "anulados", label: "Anulados" },
];

const EMPTY_FILTERS = {
  search: "",
  method: "",
  currency: "",
  account: "",
  from: "",
  to: "",
};

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function currencyOf(row) {
  return String(row?.currency_code || row?.currency || "USD").toUpperCase();
}

function amountOf(row, field = "net_amount") {
  const value = Number(row?.[field] ?? row?.amount ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function fmtMoney(value, currency = "USD") {
  const curr = String(currency || "USD").toUpperCase();
  return new Intl.NumberFormat("es-PY", {
    style: "currency",
    currency: curr,
    minimumFractionDigits: curr === "PYG" ? 0 : 2,
    maximumFractionDigits: curr === "PYG" ? 0 : 2,
  }).format(Number(value || 0));
}

function fmtDate(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleDateString("es-PY");
  } catch {
    return value;
  }
}

function fmtBank(code) {
  if (!code) return "-";
  const val = String(code).toLowerCase();
  if (val === "gs" || val === "itau") return "ITAU";
  if (val === "usd" || val === "continental") return "CONTINENTAL";
  return code;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthBoundsIso() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
  };
}

async function openReceiptPdf(id) {
  try {
    const res = await api.get(`/invoices/receipts/${id}/pdf`, { responseType: "blob" });
    const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    console.error("Error loading receipt PDF", error);
    alert(error?.response?.data?.error || "No se pudo abrir el PDF del recibo");
  }
}

function SummaryCard({ label, children }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-2 text-lg font-semibold text-slate-900">{children}</div>
    </div>
  );
}

function DetailLine({ label, value, tone = "" }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b last:border-b-0">
      <span className="text-slate-500">{label}</span>
      <span className={`text-right font-medium ${tone}`}>{value || "-"}</span>
    </div>
  );
}

export default function Payments() {
  const { user } = useAuth();
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("todos");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [selectedReceipt, setSelectedReceipt] = useState(null);

  const requestParams = useMemo(() => {
    const params = {};
    const methodFromTab = ["transferencia", "efectivo", "cheque", "tarjeta"].includes(activeTab)
      ? activeTab
      : "";
    const month = activeTab === "mes" ? monthBoundsIso() : null;

    params.status = activeTab === "anulados" ? "anulado" : "emitido";
    params.method = methodFromTab || filters.method || undefined;
    params.currency = filters.currency || undefined;
    params.account = filters.account || undefined;
    params.search = filters.search.trim() || undefined;
    params.from = activeTab === "hoy" ? todayIso() : month?.from || filters.from || undefined;
    params.to = activeTab === "hoy" ? todayIso() : month?.to || filters.to || undefined;

    return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== ""));
  }, [activeTab, filters]);

  async function loadReceipts(params = requestParams) {
    setLoading(true);
    try {
      const { data } = await api.get("/invoices/receipts", { params });
      setReceipts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error cargando recibos", error);
      alert(error?.response?.data?.error || "No se pudieron cargar los recibos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      loadReceipts(requestParams);
    }, 250);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestParams]);

  const filterOptions = useMemo(() => {
    const currencies = new Set();
    const accounts = new Set();
    receipts.forEach((row) => {
      if (currencyOf(row)) currencies.add(currencyOf(row));
      if (row.bank_account) accounts.add(row.bank_account);
    });
    return {
      currencies: Array.from(currencies).sort(),
      accounts: Array.from(accounts).sort((a, b) => fmtBank(a).localeCompare(fmtBank(b))),
    };
  }, [receipts]);

  const filtered = receipts;

  const summary = useMemo(() => {
    const byCurrency = {};
    let gross = 0;
    let retention = 0;
    let net = 0;
    filtered.forEach((row) => {
      const curr = currencyOf(row);
      const rowGross = amountOf(row, "amount");
      const rowRetention = amountOf(row, "retention_amount");
      const rowNet = amountOf(row, "net_amount");
      byCurrency[curr] = byCurrency[curr] || { gross: 0, retention: 0, net: 0, count: 0 };
      byCurrency[curr].gross += rowGross;
      byCurrency[curr].retention += rowRetention;
      byCurrency[curr].net += rowNet;
      byCurrency[curr].count += 1;
      gross += rowGross;
      retention += rowRetention;
      net += rowNet;
    });
    return { byCurrency, gross, retention, net, count: filtered.length };
  }, [filtered]);

  const selectedCurrency = selectedReceipt ? currencyOf(selectedReceipt) : "USD";
  const selectedStatus = normalize(selectedReceipt?.status || "emitido");
  const isAdmin = String(user?.role || "").toLowerCase() === "admin";

  async function cancelReceipt(row) {
    if (!row?.id) return;
    if (normalize(row.status || "emitido") === "anulado") {
      alert("Este recibo ya esta anulado.");
      return;
    }
    const reason = window.prompt(`Motivo de anulacion del recibo ${row.receipt_number || `#${row.id}`}:`);
    if (!reason || !reason.trim()) return;
    if (!window.confirm("Anular este recibo recalculara el saldo de la factura. Deseas continuar?")) return;

    try {
      const { data } = await api.post(`/invoices/receipts/${row.id}/cancel`, { reason: reason.trim() });
      setReceipts((prev) => prev.map((receipt) => (Number(receipt.id) === Number(row.id) ? { ...receipt, ...data } : receipt)));
      setSelectedReceipt((prev) => (prev && Number(prev.id) === Number(row.id) ? { ...prev, ...data } : prev));
      await loadReceipts();
      alert("Recibo anulado correctamente.");
    } catch (error) {
      console.error("Error canceling receipt", error);
      alert(error?.response?.data?.error || "No se pudo anular el recibo");
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Recibos</h1>
          <p className="text-sm text-slate-500">
            Bandeja de cobros registrados, recibos emitidos y trazabilidad por factura, cliente y operacion.
          </p>
        </div>
        <button
          type="button"
          className="px-3 py-2 text-sm rounded-lg border bg-white hover:bg-slate-50"
          onClick={() => loadReceipts()}
          disabled={loading}
        >
          {loading ? "Actualizando..." : "Actualizar"}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <SummaryCard label="Recibos">{summary.count}</SummaryCard>
        <SummaryCard label="Neto cobrado">
          <div className="space-y-1">
            {Object.keys(summary.byCurrency).length === 0 ? (
              <div>{fmtMoney(0, "USD")}</div>
            ) : (
              Object.entries(summary.byCurrency).map(([currency, row]) => (
                <div key={currency}>{fmtMoney(row.net, currency)}</div>
              ))
            )}
          </div>
        </SummaryCard>
        <SummaryCard label="Retenciones">
          <div className="space-y-1">
            {Object.keys(summary.byCurrency).length === 0 ? (
              <div>{fmtMoney(0, "USD")}</div>
            ) : (
              Object.entries(summary.byCurrency).map(([currency, row]) => (
                <div key={currency}>{fmtMoney(row.retention, currency)}</div>
              ))
            )}
          </div>
        </SummaryCard>
        <SummaryCard label="Bruto recibido">
          <div className="space-y-1">
            {Object.keys(summary.byCurrency).length === 0 ? (
              <div>{fmtMoney(0, "USD")}</div>
            ) : (
              Object.entries(summary.byCurrency).map(([currency, row]) => (
                <div key={currency}>{fmtMoney(row.gross, currency)}</div>
              ))
            )}
          </div>
        </SummaryCard>
      </div>

      <div className="bg-white border rounded-lg p-2 overflow-x-auto">
        <div className="flex gap-2 min-w-max">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`px-3 py-2 rounded-md text-sm ${
                activeTab === tab.key ? "bg-black text-white" : "hover:bg-slate-100 text-slate-700"
              }`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 bg-white p-4 rounded-lg border">
        <div className="md:col-span-2">
          <label className="text-xs text-slate-500">Buscar</label>
          <input
            className="mt-1 w-full border rounded px-3 py-2 text-sm"
            placeholder="Cliente, RUC, recibo, factura, ref..."
            value={filters.search}
            onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
          />
        </div>
        <div>
          <label className="text-xs text-slate-500">Metodo</label>
          <select
            className="mt-1 w-full border rounded px-3 py-2 text-sm"
            value={filters.method}
            onChange={(event) => setFilters((prev) => ({ ...prev, method: event.target.value }))}
          >
            <option value="">Todos</option>
            {PAYMENT_METHODS.map((method) => (
              <option key={method.value} value={method.value}>
                {method.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500">Moneda</label>
          <select
            className="mt-1 w-full border rounded px-3 py-2 text-sm"
            value={filters.currency}
            onChange={(event) => setFilters((prev) => ({ ...prev, currency: event.target.value }))}
          >
            <option value="">Todas</option>
            {filterOptions.currencies.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500">Desde</label>
          <input
            type="date"
            className="mt-1 w-full border rounded px-3 py-2 text-sm"
            value={filters.from}
            onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))}
          />
        </div>
        <div>
          <label className="text-xs text-slate-500">Hasta</label>
          <input
            type="date"
            className="mt-1 w-full border rounded px-3 py-2 text-sm"
            value={filters.to}
            onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))}
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs text-slate-500">Cuenta destino</label>
          <select
            className="mt-1 w-full border rounded px-3 py-2 text-sm"
            value={filters.account}
            onChange={(event) => setFilters((prev) => ({ ...prev, account: event.target.value }))}
          >
            <option value="">Todas</option>
            {filterOptions.accounts.map((account) => (
              <option key={account} value={account}>
                {fmtBank(account)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button
            className="px-3 py-2 text-sm border rounded w-full hover:bg-slate-50"
            type="button"
            onClick={() => setFilters(EMPTY_FILTERS)}
          >
            Limpiar
          </button>
        </div>
      </div>

      <div className="bg-white border rounded-lg overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="text-left px-3 py-2">Fecha</th>
              <th className="text-left px-3 py-2">Recibo</th>
              <th className="text-left px-3 py-2">Cliente</th>
              <th className="text-left px-3 py-2">Factura</th>
              <th className="text-left px-3 py-2">Operacion</th>
              <th className="text-left px-3 py-2">Metodo</th>
              <th className="text-left px-3 py-2">Cuenta</th>
              <th className="text-right px-3 py-2">Bruto</th>
              <th className="text-right px-3 py-2">Retencion</th>
              <th className="text-right px-3 py-2">Neto</th>
              <th className="text-left px-3 py-2">Estado</th>
              <th className="text-left px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center text-slate-500">
                  Cargando recibos...
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center text-slate-500">
                  No hay recibos para los filtros seleccionados.
                </td>
              </tr>
            )}
            {!loading &&
              filtered.map((row) => {
                const currency = currencyOf(row);
                const status = normalize(row.status || "emitido");
                return (
                  <tr
                    key={row.id}
                    className="border-t hover:bg-slate-50 cursor-default"
                    onDoubleClick={() => setSelectedReceipt(row)}
                  >
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(row.issue_date || row.created_at)}</td>
                    <td className="px-3 py-2 font-medium">
                      <button type="button" className="text-blue-600 hover:underline" onClick={() => openReceiptPdf(row.id)}>
                        {row.receipt_number || `#${row.id}`}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.organization_name || "-"}</div>
                      <div className="text-xs text-slate-500">{row.organization_ruc || row.customer_doc || ""}</div>
                    </td>
                    <td className="px-3 py-2">
                      {row.invoice_number ? (
                        <a className="text-blue-600 hover:underline" href={`/invoices/${row.invoice_id}`}>
                          {row.invoice_number}
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.deal_reference ? (
                        <a className="text-blue-600 hover:underline" href={`/operations/${row.deal_id || row.deal || ""}`}>
                          {row.deal_reference}
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-3 py-2 capitalize">{row.payment_method || "-"}</td>
                    <td className="px-3 py-2">{fmtBank(row.bank_account)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(amountOf(row, "amount"), currency)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(amountOf(row, "retention_amount"), currency)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{fmtMoney(amountOf(row, "net_amount"), currency)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs ${
                          status === "anulado" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {status === "anulado" ? "Anulado" : "Emitido"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="px-2.5 py-1.5 text-xs rounded border hover:bg-slate-50"
                        onClick={() => setSelectedReceipt(row)}
                      >
                        Ver detalle
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {selectedReceipt && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={() => setSelectedReceipt(null)}>
          <aside
            className="h-full w-full max-w-xl bg-white shadow-xl overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b p-4 flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Detalle de recibo</div>
                <h2 className="text-xl font-semibold">{selectedReceipt.receipt_number || `#${selectedReceipt.id}`}</h2>
                <div className="mt-1 text-sm text-slate-500">{fmtDate(selectedReceipt.issue_date || selectedReceipt.created_at)}</div>
              </div>
              <button type="button" className="text-2xl leading-none" onClick={() => setSelectedReceipt(null)}>
                x
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-slate-500">Bruto</div>
                  <div className="mt-1 font-semibold">{fmtMoney(amountOf(selectedReceipt, "amount"), selectedCurrency)}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-slate-500">Retencion</div>
                  <div className="mt-1 font-semibold">{fmtMoney(amountOf(selectedReceipt, "retention_amount"), selectedCurrency)}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-slate-500">Neto aplicado</div>
                  <div className="mt-1 font-semibold">{fmtMoney(amountOf(selectedReceipt, "net_amount"), selectedCurrency)}</div>
                </div>
              </div>

              <div className="rounded-lg border p-4 text-sm">
                <div className="font-semibold mb-2">Cliente y documento</div>
                <DetailLine label="Cliente" value={selectedReceipt.organization_name} />
                <DetailLine label="RUC / Doc." value={selectedReceipt.organization_ruc || selectedReceipt.customer_doc} />
                <DetailLine label="Factura" value={selectedReceipt.invoice_number} />
                <DetailLine label="Operacion" value={selectedReceipt.deal_reference} />
                <DetailLine label="Estado" value={selectedStatus === "anulado" ? "Anulado" : "Emitido"} tone={selectedStatus === "anulado" ? "text-red-700" : "text-emerald-700"} />
              </div>

              <div className="rounded-lg border p-4 text-sm">
                <div className="font-semibold mb-2">Cobro</div>
                <DetailLine label="Metodo" value={selectedReceipt.payment_method} />
                <DetailLine label="Cuenta destino" value={fmtBank(selectedReceipt.bank_account)} />
                <DetailLine label="Referencia" value={selectedReceipt.reference_number} />
                <DetailLine label="Moneda" value={selectedCurrency} />
                <DetailLine label="Retencion %" value={`${Number(selectedReceipt.retention_pct || 0).toLocaleString("es-PY")}%`} />
                <DetailLine label="Registrado por" value={selectedReceipt.issued_by_name || selectedReceipt.created_by_name} />
              </div>

              <div className="rounded-lg border p-4">
                <div className="font-semibold mb-3">Acciones</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="px-3 py-2 text-sm rounded border hover:bg-slate-50"
                    onClick={() => openReceiptPdf(selectedReceipt.id)}
                  >
                    Ver PDF recibo
                  </button>
                  {selectedReceipt.invoice_id ? (
                    <a className="px-3 py-2 text-sm rounded border hover:bg-slate-50 text-center" href={`/invoices/${selectedReceipt.invoice_id}`}>
                      Ver factura
                    </a>
                  ) : null}
                  {selectedReceipt.deal_id ? (
                    <a className="px-3 py-2 text-sm rounded border hover:bg-slate-50 text-center" href={`/operations/${selectedReceipt.deal_id}`}>
                      Ver operacion
                    </a>
                  ) : null}
                  {selectedReceipt.organization_id ? (
                    <a className="px-3 py-2 text-sm rounded border hover:bg-slate-50 text-center" href={`/organizations/${selectedReceipt.organization_id}`}>
                      Ver cliente
                    </a>
                  ) : null}
                  {isAdmin && selectedStatus !== "anulado" ? (
                    <button
                      type="button"
                      className="px-3 py-2 text-sm rounded border border-red-200 text-red-700 hover:bg-red-50"
                      onClick={() => cancelReceipt(selectedReceipt)}
                    >
                      Anular recibo
                    </button>
                  ) : null}
                </div>
              </div>
              {selectedStatus === "anulado" ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  <div className="font-semibold">Recibo anulado</div>
                  <div className="mt-1">Motivo: {selectedReceipt.cancel_reason || "-"}</div>
                  <div>Anulado por: {selectedReceipt.cancelled_by_name || "-"}</div>
                  <div>Fecha: {fmtDate(selectedReceipt.cancelled_at)}</div>
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
