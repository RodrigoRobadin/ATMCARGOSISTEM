import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import InvoiceCreateModal from "../InvoiceCreateModal.jsx";

function fmtDate(value) {
  if (!value) return "?";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
}

function fmtMoney(amount, currencyCode) {
  const value = Number(amount || 0);
  const currency = String(currencyCode || "PYG").toUpperCase();
  if (!Number.isFinite(value)) return `${currency} 0`;
  return `${currency} ${value.toLocaleString("es-PY", {
    minimumFractionDigits: currency === "USD" ? 2 : 0,
    maximumFractionDigits: currency === "USD" ? 2 : 0,
  })}`;
}

function SummaryCard({ label, value, tone = "slate" }) {
  const toneMap = {
    slate: "bg-slate-50 text-slate-700",
    blue: "bg-blue-50 text-blue-700",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
  };
  return (
    <div className="border rounded-xl p-4 bg-white">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-2 inline-flex rounded-lg px-3 py-1.5 text-sm font-semibold ${toneMap[tone] || toneMap.slate}`}>
        {value}
      </div>
    </div>
  );
}

export default function AdminOpsPanel({ dealId, serviceCaseId, deal, onDocsRefresh }) {
  const [docs, setDocs] = useState([]);
  const [billableItems, setBillableItems] = useState([]);
  const [selectedItems, setSelectedItems] = useState([]);
  const [lockStatus, setLockStatus] = useState({ locked: false, count: 0 });
  const [loading, setLoading] = useState(true);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  async function loadAdminData() {
    if (!dealId && !serviceCaseId) return;
    setLoading(true);
    try {
      const params = dealId ? { deal_id: dealId } : { service_case_id: serviceCaseId };
      const [docsRes, lockRes, itemsRes] = await Promise.all([
        api.get("/invoices/operation-docs", { params }),
        api.get("/invoices/lock-status", { params }),
        api.get("/invoices/billable-items", { params }),
      ]);
      const nextDocs = Array.isArray(docsRes?.data) ? docsRes.data : [];
      const nextItems = Array.isArray(itemsRes?.data) ? itemsRes.data : [];
      setDocs(nextDocs);
      setLockStatus(lockRes?.data || { locked: false, count: 0 });
      setBillableItems(nextItems);
      setSelectedItems((prev) =>
        prev.filter((key) => nextItems.some((item) => item.pending && item.source_item_key === key))
      );
    } catch (error) {
      console.error("Error loading admin operation data", error);
      setDocs([]);
      setBillableItems([]);
      setSelectedItems([]);
      setLockStatus({ locked: false, count: 0 });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAdminData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, serviceCaseId]);

  const invoiceDocs = useMemo(() => docs.filter((doc) => doc.kind === "invoice"), [docs]);
  const creditNoteDocs = useMemo(() => docs.filter((doc) => doc.kind === "credit_note"), [docs]);
  const totals = useMemo(() => {
    return invoiceDocs.reduce((acc, doc) => {
      const curr = String(doc.currency_code || "PYG").toUpperCase();
      const amount = Number(doc.total_amount || 0);
      acc[curr] = (acc[curr] || 0) + (Number.isFinite(amount) ? amount : 0);
      return acc;
    }, {});
  }, [invoiceDocs]);
  const pendingItems = useMemo(() => billableItems.filter((item) => item.pending), [billableItems]);
  const selectedPendingItems = useMemo(
    () => pendingItems.filter((item) => selectedItems.includes(item.source_item_key)),
    [pendingItems, selectedItems]
  );
  const selectedPendingTotal = useMemo(() => {
    return selectedPendingItems.reduce((acc, item) => {
      const currency = String(item.currency_code || deal?.operation_currency || "USD").toUpperCase();
      acc[currency] = (acc[currency] || 0) + Number(item.total || 0);
      return acc;
    }, {});
  }, [deal?.operation_currency, selectedPendingItems]);

  function toggleItem(sourceItemKey) {
    setSelectedItems((prev) =>
      prev.includes(sourceItemKey)
        ? prev.filter((key) => key !== sourceItemKey)
        : [...prev, sourceItemKey]
    );
  }

  function toggleAllPending() {
    if (!pendingItems.length) return;
    if (selectedPendingItems.length === pendingItems.length) {
      setSelectedItems([]);
      return;
    }
    setSelectedItems(pendingItems.map((item) => item.source_item_key));
  }

  async function openDocPdf(doc) {
    try {
      const path = doc.kind === "credit_note" ? `/invoices/credit-notes/${doc.id}/pdf` : `/invoices/${doc.id}/pdf`;
      const { data } = await api.get(path, { responseType: "blob" });
      const file = new Blob([data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(file);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (error) {
      console.error("Error opening fiscal pdf", error);
      alert("No se pudo abrir el PDF del documento.");
    }
  }

  return (
    <>
      <div className="bg-white rounded-2xl shadow p-4 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold">Administraci?n</h3>
            <p className="text-sm text-slate-500 mt-1">
              Gesti?n fiscal y seguimiento administrativo de la operaci?n.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              className="px-3 py-2 text-sm rounded-lg border disabled:opacity-50"
              onClick={toggleAllPending}
              disabled={!pendingItems.length}
              type="button"
            >
              {selectedPendingItems.length === pendingItems.length && pendingItems.length
                ? "Quitar selecci?n"
                : "Seleccionar pendientes"}
            </button>
            <button
              className="px-3 py-2 text-sm rounded-lg bg-black text-white disabled:bg-slate-300"
              onClick={() => setShowInvoiceModal(true)}
              disabled={!selectedPendingItems.length}
              type="button"
            >
              Facturar selecci?n
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <SummaryCard label="Facturas activas" value={lockStatus.count || 0} tone={lockStatus.count ? "emerald" : "slate"} />
          <SummaryCard label="Facturas emitidas" value={invoiceDocs.length} tone="blue" />
          <SummaryCard label="Notas de cr?dito" value={creditNoteDocs.length} tone={creditNoteDocs.length ? "amber" : "slate"} />
          <SummaryCard
            label="Total facturado"
            value={Object.keys(totals).length ? Object.entries(totals).map(([currency, amount]) => fmtMoney(amount, currency)).join(" ? ") : "Sin documentos"}
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          <div className="border rounded-xl p-4">
            <div className="text-xs text-slate-500">Referencia</div>
            <div className="mt-1 font-medium">{deal?.reference || "?"}</div>
          </div>
          <div className="border rounded-xl p-4">
            <div className="text-xs text-slate-500">Cliente</div>
            <div className="mt-1 font-medium">{deal?.org_name || "?"}</div>
          </div>
          <div className="border rounded-xl p-4">
            <div className="text-xs text-slate-500">Etapa actual</div>
            <div className="mt-1 font-medium">{deal?.stage_name || deal?.stage?.name || deal?.status_ops || "?"}</div>
          </div>
        </div>

        <div className="border rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b font-medium flex items-center justify-between gap-3">
            <span>?tems pendientes de facturar</span>
            <span className="text-xs text-slate-500">
              {selectedPendingItems.length ? `${selectedPendingItems.length} seleccionado(s)` : `${pendingItems.length} pendiente(s)`}
            </span>
          </div>
          {loading ? (
            <div className="p-4 text-sm text-slate-500">Cargando ?tems?</div>
          ) : billableItems.length === 0 ? (
            <div className="p-4 text-sm text-slate-500">Esta operaci?n no tiene ?tems facturables detectados en el presupuesto.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white">
                  <tr className="border-b">
                    <th className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={pendingItems.length > 0 && selectedPendingItems.length === pendingItems.length}
                        onChange={toggleAllPending}
                      />
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">?tem</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Cant.</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Monto</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Estado</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Factura</th>
                  </tr>
                </thead>
                <tbody>
                  {billableItems.map((item) => (
                    <tr key={item.source_item_key} className="border-b last:border-b-0">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedItems.includes(item.source_item_key)}
                          disabled={!item.pending}
                          onChange={() => toggleItem(item.source_item_key)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{item.description}</div>
                        <div className="text-xs text-slate-500">?tem #{Number(item.item_order || 0) + 1}</div>
                      </td>
                      <td className="px-4 py-3">{item.quantity}</td>
                      <td className="px-4 py-3">{fmtMoney(item.total, deal?.operation_currency || item.currency_code || "USD")}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs ${item.pending ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                          {item.pending ? "Pendiente" : "Facturado"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{item.invoice_number || "?"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {selectedPendingItems.length > 0 && (
            <div className="px-4 py-3 bg-slate-50 border-t text-sm text-slate-700">
              Total selecci?n: {Object.keys(selectedPendingTotal).length ? Object.entries(selectedPendingTotal).map(([currency, amount]) => fmtMoney(amount, currency)).join(" ? ") : "?"}
            </div>
          )}
        </div>

        <div className="border rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b font-medium">Documentos fiscales</div>
          {loading ? (
            <div className="p-4 text-sm text-slate-500">Cargando documentos?</div>
          ) : docs.length === 0 ? (
            <div className="p-4 text-sm text-slate-500">Esta operaci?n todav?a no tiene facturas ni notas de cr?dito.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white">
                  <tr className="border-b">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Tipo</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">N?mero</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Fecha</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Estado</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Monto</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((doc) => (
                    <tr key={`${doc.kind}-${doc.id}`} className="border-b last:border-b-0">
                      <td className="px-4 py-3">{doc.kind === "credit_note" ? "Nota de cr?dito" : "Factura"}</td>
                      <td className="px-4 py-3 font-medium">{doc.number || `#${doc.id}`}</td>
                      <td className="px-4 py-3">{fmtDate(doc.issue_date || doc.created_at)}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">{doc.status || "?"}</span>
                      </td>
                      <td className="px-4 py-3">{doc.kind === "invoice" ? fmtMoney(doc.total_amount, doc.currency_code) : Number(doc.total_amount || 0).toLocaleString("es-PY")}</td>
                      <td className="px-4 py-3">
                        <button className="px-2.5 py-1.5 text-xs rounded-lg border" onClick={() => openDocPdf(doc)} type="button">
                          Ver PDF
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showInvoiceModal && (
        <InvoiceCreateModal
          defaultDealId={dealId ? Number(dealId) : undefined}
          defaultServiceCaseId={serviceCaseId ? Number(serviceCaseId) : undefined}
          defaultSelectedQuoteItems={selectedPendingItems.map((item) => item.source_item_key)}
          onClose={() => setShowInvoiceModal(false)}
          onSuccess={() => {
            setShowInvoiceModal(false);
            loadAdminData();
            if (typeof onDocsRefresh === "function") onDocsRefresh();
          }}
        />
      )}
    </>
  );
}
