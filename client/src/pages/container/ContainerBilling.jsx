import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import InvoiceCreateModal from "../../components/InvoiceCreateModal.jsx";
import { useAuth } from "../../auth.jsx";

const FILTER_STATUSES = ["", "pendiente", "facturado", "cobrado", "anulado"];

function formatMoney(amount, currency) {
  const num = Number(amount || 0);
  const code = String(currency || "PYG").toUpperCase();
  const usd = code === "USD";
  return `${code} ${num.toLocaleString(usd ? "en-US" : "es-PY", {
    minimumFractionDigits: usd ? 2 : 0,
    maximumFractionDigits: usd ? 2 : 0,
  })}`;
}

function pill(status) {
  const key = String(status || "").toLowerCase();
  if (key === "cobrado") return "bg-emerald-100 text-emerald-700";
  if (key === "facturado") return "bg-blue-100 text-blue-700";
  if (key === "anulado") return "bg-red-100 text-red-700";
  return "bg-amber-100 text-amber-700";
}

function getBillingInvoiceState(row) {
  const currentInvoiceId = Number(row?.invoice_id || 0);
  const currentInvoiceStatus = String(row?.invoice_status || "").toLowerCase();
  const latestInvoiceId = Number(row?.latest_invoice_id || 0);
  const latestInvoiceStatus = String(row?.latest_invoice_status || "").toLowerCase();
  const latestCreditNoteId = Number(row?.latest_credit_note_id || 0);

  if (currentInvoiceId && currentInvoiceStatus === "pagada") {
    return {
      label: "Pagado",
      className: "bg-emerald-100 text-emerald-700",
      canInvoice: false,
      viewInvoiceId: currentInvoiceId,
      viewInvoiceLabel: row?.invoice_number || `Factura #${currentInvoiceId}`,
    };
  }
  if (currentInvoiceId) {
    return {
      label: "Facturado",
      className: "bg-blue-100 text-blue-700",
      canInvoice: false,
      viewInvoiceId: currentInvoiceId,
      viewInvoiceLabel: row?.invoice_number || `Factura #${currentInvoiceId}`,
    };
  }
  if (latestInvoiceId && latestInvoiceStatus === "anulada" && latestCreditNoteId) {
    return {
      label: "Anulado por NC",
      className: "bg-amber-100 text-amber-800",
      canInvoice: true,
      canReinvoice: true,
      viewInvoiceId: latestInvoiceId,
      viewInvoiceLabel: row?.latest_invoice_number || `Factura #${latestInvoiceId}`,
    };
  }
  if (latestInvoiceId && latestInvoiceStatus === "anulada") {
    return {
      label: "Bloqueado",
      className: "bg-red-100 text-red-700",
      canInvoice: false,
      blockedReason: "Solo refacturable con nota de credito",
      viewInvoiceId: latestInvoiceId,
      viewInvoiceLabel: row?.latest_invoice_number || `Factura #${latestInvoiceId}`,
    };
  }
  return {
    label: "Pendiente de facturar",
    className: "bg-slate-100 text-slate-700",
    canInvoice: true,
  };
}

export default function ContainerBilling() {
  const { user } = useAuth();
  const isAdmin = String(user?.role || "").toLowerCase() === "admin";
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ q: "", status: "" });
  const [selectedBilling, setSelectedBilling] = useState(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  async function loadRows() {
    setLoading(true);
    try {
      const { data } = await api.get("/container/billing", {
        params: {
          q: filters.q || undefined,
          status: filters.status || undefined,
        },
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("load container billing", err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const handle = setTimeout(() => {
      loadRows();
    }, 250);
    return () => clearTimeout(handle);
  }, [filters.q, filters.status]);

  async function openInvoicePdf(invoiceId) {
    try {
      const res = await api.get(`/invoices/${invoiceId}/pdf`, { responseType: "blob" });
      const file = new Blob([res.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(file);
      window.open(url, "_blank");
    } catch (err) {
      console.error("open container invoice pdf", err);
      alert(err?.response?.data?.error || "No se pudo abrir el PDF de la factura.");
    }
  }

  const summary = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.total += 1;
        const key = String(row.status || "").toLowerCase();
        if (key === "pendiente") acc.pendiente += 1;
        if (key === "facturado") acc.facturado += 1;
        if (key === "cobrado") acc.cobrado += 1;
        if (key === "anulado") acc.anulado += 1;
        return acc;
      },
      { total: 0, pendiente: 0, facturado: 0, cobrado: 0, anulado: 0 }
    );
  }, [rows]);

  const totals = useMemo(() => {
    return rows.reduce((acc, row) => {
      const currency = String(row.currency_code || "PYG").toUpperCase();
      acc[currency] = (acc[currency] || 0) + Number(row.amount || 0);
      return acc;
    }, {});
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-white p-5">
        <div className="font-semibold">Facturacion mensual ATM CONTAINER</div>
        <div className="text-sm text-slate-500 mt-1">
          Control mensual por contrato. La factura fiscal se genera desde el mismo modulo de Administracion.
        </div>
        {!isAdmin && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Tu rol puede controlar la mensualidad, pero solo Administracion puede emitir la factura fiscal.
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-3 mt-4">
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm"
            placeholder="Buscar por ciclo, contrato, operacion, cliente o proveedor"
            value={filters.q}
            onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))}
          />
          <select
            className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
            value={filters.status}
            onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
          >
            <option value="">Estado</option>
            {FILTER_STATUSES.filter(Boolean).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
        <div className="text-sm text-slate-600 mt-3">
          Totales:{" "}
          {Object.keys(totals).length
            ? Object.entries(totals)
                .map(([currency, amount]) => formatMoney(amount, currency))
                .join(" | ")
            : "-"}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
          <div className="rounded-xl border bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-500">Total</div>
            <div className="text-xl font-semibold">{summary.total}</div>
          </div>
          <div className="rounded-xl border bg-amber-50 px-4 py-3">
            <div className="text-xs text-amber-700">Pendiente</div>
            <div className="text-xl font-semibold text-amber-800">{summary.pendiente}</div>
          </div>
          <div className="rounded-xl border bg-blue-50 px-4 py-3">
            <div className="text-xs text-blue-700">Facturado</div>
            <div className="text-xl font-semibold text-blue-800">{summary.facturado}</div>
          </div>
          <div className="rounded-xl border bg-emerald-50 px-4 py-3">
            <div className="text-xs text-emerald-700">Cobrado</div>
            <div className="text-xl font-semibold text-emerald-800">{summary.cobrado}</div>
          </div>
          <div className="rounded-xl border bg-red-50 px-4 py-3">
            <div className="text-xs text-red-700">Anulado</div>
            <div className="text-xl font-semibold text-red-800">{summary.anulado}</div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left">Contrato</th>
                <th className="px-3 py-2 text-left">Operacion</th>
                <th className="px-3 py-2 text-left">Cliente</th>
                <th className="px-3 py-2 text-left">Proveedor</th>
                <th className="px-3 py-2 text-left">Ciclo</th>
                <th className="px-3 py-2 text-left">Periodo</th>
                <th className="px-3 py-2 text-left">Vencimiento</th>
                <th className="px-3 py-2 text-left">Monto</th>
                <th className="px-3 py-2 text-left">Factura</th>
                <th className="px-3 py-2 text-left">Estado</th>
                <th className="px-3 py-2 text-left">Estado facturacion</th>
                <th className="px-3 py-2 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-slate-500">
                    Cargando...
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((row) => {
                  const invoiceState = getBillingInvoiceState(row);
                  return (
                  <tr key={row.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{row.contract_no || "-"}</td>
                    <td className="px-3 py-2">
                      <Link className="text-blue-700 underline" to={`/operations/${row.deal_id}`}>
                        {row.reference || `OP #${row.deal_id}`}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{row.client_name || "-"}</td>
                    <td className="px-3 py-2">{row.provider_name || "-"}</td>
                    <td className="px-3 py-2">{row.cycle_label || "-"}</td>
                    <td className="px-3 py-2">{row.period_start} - {row.period_end}</td>
                    <td className="px-3 py-2">{row.due_date || "-"}</td>
                    <td className="px-3 py-2">{formatMoney(row.amount, row.currency_code)}</td>
                    <td className="px-3 py-2">
                      {invoiceState.viewInvoiceId ? (
                        <button
                          type="button"
                          className="text-blue-700 underline"
                          onClick={() => openInvoicePdf(invoiceState.viewInvoiceId)}
                        >
                          {invoiceState.viewInvoiceLabel}
                        </button>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${pill(row.status)}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <span className={`inline-flex w-fit rounded-full px-2 py-1 text-xs font-medium ${invoiceState.className}`}>
                          {invoiceState.label}
                        </span>
                        {invoiceState.blockedReason ? (
                          <span className="text-[11px] text-red-600">{invoiceState.blockedReason}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        {invoiceState.canInvoice ? (
                          isAdmin ? (
                            <button
                              type="button"
                              className="px-2 py-1 rounded border text-xs bg-white"
                              onClick={() => {
                                setSelectedBilling(row);
                                setShowInvoiceModal(true);
                              }}
                            >
                              {invoiceState.canReinvoice ? "Refacturar" : "Facturar"}
                            </button>
                          ) : (
                            <span className="px-2 py-1 rounded border text-xs bg-slate-50 text-slate-600">
                              Pendiente de administracion
                            </span>
                          )
                        ) : invoiceState.viewInvoiceId ? (
                          <button
                            type="button"
                            className="px-2 py-1 rounded border text-xs bg-white"
                            onClick={() => openInvoicePdf(invoiceState.viewInvoiceId)}
                          >
                            Ver factura
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              {!loading && !rows.length && (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-slate-500">
                    No hay mensualidades generadas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showInvoiceModal && selectedBilling && (
        <InvoiceCreateModal
          defaultDealId={selectedBilling.deal_id}
          defaultContainerBillingCycleId={selectedBilling.id}
          defaultContainerBillingCycle={selectedBilling}
          onClose={() => {
            setShowInvoiceModal(false);
            setSelectedBilling(null);
          }}
          onSuccess={async (invoiceId) => {
            setShowInvoiceModal(false);
            setSelectedBilling(null);
            await loadRows();
            if (invoiceId) await openInvoicePdf(invoiceId);
          }}
        />
      )}
    </div>
  );
}
