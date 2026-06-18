import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import InvoiceCreateModal from "../InvoiceCreateModal.jsx";
import CustomerReceiptModal from "../CustomerReceiptModal.jsx";

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

export default function AdminOpsPanel({ dealId, serviceCaseId, deal, costSheetVersionNumber, quoteRevisionId, onDocsRefresh }) {
  const [docs, setDocs] = useState([]);
  const [receiptDocs, setReceiptDocs] = useState([]);
  const [billableItems, setBillableItems] = useState([]);
  const [selectedItems, setSelectedItems] = useState([]);
  const [lockStatus, setLockStatus] = useState({ locked: false, count: 0 });
  const [loading, setLoading] = useState(true);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [issuingDocId, setIssuingDocId] = useState(null);
  const [loadingActionDocId, setLoadingActionDocId] = useState(null);
  const [paymentInvoice, setPaymentInvoice] = useState(null);
  const [creditInvoice, setCreditInvoice] = useState(null);

  async function loadAdminData() {
    if (!dealId && !serviceCaseId) return;
    setLoading(true);
    try {
      const params = dealId
        ? {
            deal_id: dealId,
            cost_sheet_version_number: costSheetVersionNumber || undefined,
            quote_revision_id: quoteRevisionId || undefined,
          }
        : { service_case_id: serviceCaseId };
      const [docsRes, lockRes, itemsRes] = await Promise.all([
        api.get("/invoices/operation-docs", { params }),
        api.get("/invoices/lock-status", { params }),
        api.get("/invoices/billable-items", { params }),
      ]);
      const nextDocs = Array.isArray(docsRes?.data) ? docsRes.data : [];
      const enrichedDocs = await Promise.all(
        nextDocs.map(async (doc) => {
          if (doc.kind !== "invoice") return doc;
          try {
            const { data } = await api.get(`/invoices/${doc.id}`);
            return {
              ...doc,
              paid_amount: data?.paid_amount,
              credited_total: data?.credited_total,
              net_total_amount: data?.net_total_amount,
              net_balance: data?.net_balance,
              receipts: Array.isArray(data?.receipts) ? data.receipts : [],
              organization_name: data?.organization_name || doc.organization_name,
            };
          } catch (_) {
            return doc;
          }
        })
      );
      const nextReceipts = enrichedDocs.flatMap((doc) =>
        doc.kind === "invoice" && Array.isArray(doc.receipts)
          ? doc.receipts.map((receipt) => ({
              ...receipt,
              invoice_id: doc.id,
              invoice_number: doc.number,
              invoice_currency_code: doc.currency_code,
            }))
          : []
      );
      const nextItems = Array.isArray(itemsRes?.data) ? itemsRes.data : [];
      setDocs(enrichedDocs);
      setReceiptDocs(nextReceipts);
      setLockStatus(lockRes?.data || { locked: false, count: 0 });
      setBillableItems(nextItems);
      setSelectedItems((prev) =>
        prev.filter((key) => nextItems.some((item) => item.pending && item.source_item_key === key))
      );
    } catch (error) {
      console.error("Error loading admin operation data", error);
      setDocs([]);
      setReceiptDocs([]);
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
  }, [dealId, serviceCaseId, costSheetVersionNumber, quoteRevisionId]);

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
  const selectedPendingTotalAmount = useMemo(
    () => selectedPendingItems.reduce((acc, item) => acc + Number(item.total || 0), 0),
    [selectedPendingItems]
  );

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

  function openInvoiceModal() {
    if (!selectedPendingItems.length) {
      alert("Selecciona al menos un item pendiente para facturar.");
      return;
    }
    if (selectedPendingTotalAmount <= 0) {
      alert("No hay monto para facturar. Revisa que los items seleccionados tengan precio de venta mayor a cero.");
      return;
    }
    setShowInvoiceModal(true);
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

  async function openReceiptPdf(receipt) {
    try {
      const { data } = await api.get(`/invoices/receipts/${receipt.id}/pdf`, { responseType: "blob" });
      const file = new Blob([data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(file);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (error) {
      console.error("Error opening receipt pdf", error);
      alert("No se pudo abrir el PDF del recibo.");
    }
  }

  async function issueInvoice(doc) {
    if (!doc || doc.kind !== "invoice" || String(doc.status || "").toLowerCase() !== "borrador") return;
    const label = doc.number || `#${doc.id}`;
    if (!confirm(`Emitir la factura ${label}? Esta accion confirma fiscalmente el documento.`)) return;
    setIssuingDocId(doc.id);
    try {
      await api.post(`/invoices/${doc.id}/issue`);
      await loadAdminData();
      if (typeof onDocsRefresh === "function") onDocsRefresh();
      alert("Factura emitida correctamente.");
    } catch (error) {
      console.error("Error issuing invoice", error);
      alert(error?.response?.data?.error || "No se pudo emitir la factura.");
    } finally {
      setIssuingDocId(null);
    }
  }

  async function issueCreditNote(doc) {
    if (!doc || doc.kind !== "credit_note" || String(doc.status || "").toLowerCase() !== "borrador") return;
    const label = doc.number || `#${doc.id}`;
    if (!confirm(`Emitir la nota de credito ${label}? Esta accion confirma fiscalmente el documento.`)) return;
    setIssuingDocId(`credit-${doc.id}`);
    try {
      await api.post(`/invoices/credit-notes/${doc.id}/issue`);
      await loadAdminData();
      if (typeof onDocsRefresh === "function") onDocsRefresh();
      alert("Nota de credito emitida correctamente.");
    } catch (error) {
      console.error("Error issuing credit note", error);
      alert(error?.response?.data?.error || "No se pudo emitir la nota de credito.");
    } finally {
      setIssuingDocId(null);
    }
  }

  async function loadInvoiceForAction(doc, action) {
    if (!doc || doc.kind !== "invoice") return;
    setLoadingActionDocId(`${action}-${doc.id}`);
    try {
      const { data } = await api.get(`/invoices/${doc.id}`);
      if (action === "payment") setPaymentInvoice(data);
      if (action === "credit") setCreditInvoice(data);
    } catch (error) {
      console.error("Error loading invoice action data", error);
      alert(error?.response?.data?.error || "No se pudo cargar la factura.");
    } finally {
      setLoadingActionDocId(null);
    }
  }

  function isInvoiceCreditEligible(doc) {
    const status = String(doc?.status || "").toLowerCase();
    return doc?.kind === "invoice" && !["borrador", "anulada"].includes(status);
  }

  function isInvoicePaymentEligible(doc) {
    const status = String(doc?.status || "").toLowerCase();
    return doc?.kind === "invoice" && !["borrador", "anulada", "pagada"].includes(status);
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
            {dealId && costSheetVersionNumber ? (
              <p className="text-xs text-blue-700 mt-1">
                Facturando sobre DET COS {costSheetVersionNumber}.
              </p>
            ) : null}
            {dealId && quoteRevisionId ? (
              <p className="text-xs text-blue-700 mt-1">
                Facturando sobre revision industrial #{quoteRevisionId}.
              </p>
            ) : null}
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
              onClick={openInvoiceModal}
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
                          {item.pending
                            ? `Pendiente ${Number(item.remaining_percentage ?? 100).toFixed(0)}%`
                            : "Facturado"}
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
              {selectedPendingTotalAmount <= 0 && (
                <span className="ml-2 text-xs font-medium text-red-600">
                  No se puede facturar una selecci?n con total cero.
                </span>
              )}
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
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Saldo</th>
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
                        {doc.kind === "invoice"
                          ? fmtMoney(doc.net_balance ?? doc.balance ?? doc.total_amount, doc.currency_code)
                          : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          {doc.kind === "invoice" && String(doc.status || "").toLowerCase() === "borrador" && (
                            <button
                              className="px-2.5 py-1.5 text-xs rounded-lg bg-blue-600 text-white disabled:bg-slate-300"
                              onClick={() => issueInvoice(doc)}
                              type="button"
                              disabled={issuingDocId === doc.id}
                            >
                              {issuingDocId === doc.id ? "Emitiendo..." : "Emitir"}
                            </button>
                          )}
                          {doc.kind === "credit_note" && String(doc.status || "").toLowerCase() === "borrador" && (
                            <button
                              className="px-2.5 py-1.5 text-xs rounded-lg bg-amber-600 text-white disabled:bg-slate-300"
                              onClick={() => issueCreditNote(doc)}
                              type="button"
                              disabled={issuingDocId === `credit-${doc.id}`}
                            >
                              {issuingDocId === `credit-${doc.id}` ? "Emitiendo..." : "Emitir"}
                            </button>
                          )}
                          {isInvoicePaymentEligible(doc) && (
                            <button
                              className="px-2.5 py-1.5 text-xs rounded-lg bg-emerald-600 text-white disabled:bg-slate-300"
                              onClick={() => loadInvoiceForAction(doc, "payment")}
                              type="button"
                              disabled={loadingActionDocId === `payment-${doc.id}`}
                            >
                              {loadingActionDocId === `payment-${doc.id}` ? "Cargando..." : "Registrar pago"}
                            </button>
                          )}
                          {isInvoiceCreditEligible(doc) && (
                            <button
                              className="px-2.5 py-1.5 text-xs rounded-lg bg-orange-600 text-white disabled:bg-slate-300"
                              onClick={() => loadInvoiceForAction(doc, "credit")}
                              type="button"
                              disabled={loadingActionDocId === `credit-${doc.id}`}
                            >
                              {loadingActionDocId === `credit-${doc.id}` ? "Cargando..." : "Nota de credito"}
                            </button>
                          )}
                          <button className="px-2.5 py-1.5 text-xs rounded-lg border" onClick={() => openDocPdf(doc)} type="button">
                            Ver PDF
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="border rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b font-medium">Pagos / recibos</div>
          {loading ? (
            <div className="p-4 text-sm text-slate-500">Cargando pagos...</div>
          ) : receiptDocs.length === 0 ? (
            <div className="p-4 text-sm text-slate-500">Todavia no hay pagos registrados para estas facturas.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white">
                  <tr className="border-b">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Recibo</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Factura</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Fecha</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Metodo</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Referencia</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Neto</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {receiptDocs.map((receipt) => (
                    <tr key={receipt.id} className="border-b last:border-b-0">
                      <td className="px-4 py-3 font-medium">{receipt.receipt_number || `#${receipt.id}`}</td>
                      <td className="px-4 py-3">{receipt.invoice_number || `#${receipt.invoice_id}`}</td>
                      <td className="px-4 py-3">{fmtDate(receipt.issue_date)}</td>
                      <td className="px-4 py-3 capitalize">{receipt.payment_method || "-"}</td>
                      <td className="px-4 py-3">{receipt.reference_number || "-"}</td>
                      <td className="px-4 py-3">{fmtMoney(receipt.net_amount ?? receipt.amount, receipt.currency_code || receipt.invoice_currency_code)}</td>
                      <td className="px-4 py-3">
                        <button className="px-2.5 py-1.5 text-xs rounded-lg border" onClick={() => openReceiptPdf(receipt)} type="button">
                          Ver recibo
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
          defaultCostSheetVersionNumber={dealId ? costSheetVersionNumber : undefined}
          defaultQuoteRevisionId={dealId ? quoteRevisionId : undefined}
          defaultSelectedQuoteItems={selectedPendingItems.map((item) => item.source_item_key)}
          onClose={() => setShowInvoiceModal(false)}
          onSuccess={() => {
            setShowInvoiceModal(false);
            loadAdminData();
            if (typeof onDocsRefresh === "function") onDocsRefresh();
          }}
        />
      )}
      {paymentInvoice && (
        <CustomerReceiptModal
          invoice={paymentInvoice}
          onClose={() => setPaymentInvoice(null)}
          onSuccess={() => {
            setPaymentInvoice(null);
            loadAdminData();
            if (typeof onDocsRefresh === "function") onDocsRefresh();
          }}
        />
      )}
      {creditInvoice && (
        <CreditNoteModal
          invoice={creditInvoice}
          onClose={() => setCreditInvoice(null)}
          onSuccess={() => {
            setCreditInvoice(null);
            loadAdminData();
            if (typeof onDocsRefresh === "function") onDocsRefresh();
          }}
        />
      )}
    </>
  );
}

function PaymentModal({ invoice, onClose, onSuccess }) {
  const money = (value) => fmtMoney(value, invoice?.currency_code || "USD");
  const total = Number(invoice?.net_total_amount ?? invoice?.total_amount ?? 0) || 0;
  const paid = Number(invoice?.paid_amount ?? 0) || 0;
  const balanceRaw = invoice?.net_balance ?? invoice?.balance;
  const effectiveBalance = Math.max(0, Number(balanceRaw ?? total - paid) || 0);
  const [form, setForm] = useState({
    payment_date: new Date().toISOString().slice(0, 10),
    amount: effectiveBalance.toFixed(2),
    currency: invoice?.currency_code || "USD",
    payment_method: "transferencia",
    bank_account: "gs",
    reference_number: "",
    retention_pct: "0",
  });
  const [saving, setSaving] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);
  const [companyAccounts, setCompanyAccounts] = useState([]);
  const grossAmount = Number(form.amount || 0) || 0;
  const retentionPct = Number(form.retention_pct || 0) || 0;
  const retentionAmount = Math.max(0, grossAmount * retentionPct / 100);
  const netAmount = Math.max(0, grossAmount - retentionAmount);
  const accountOptions = useMemo(
    () => filterCompanyBankAccounts(companyAccounts, form.currency),
    [companyAccounts, form.currency]
  );
  const hasCurrentAccount = accountOptions.some((account) => companyBankAccountValue(account) === form.bank_account);

  useEffect(() => {
    let live = true;
    api.get("/params", { params: { keys: "company_bank_account", only_active: 1 } })
      .then(({ data }) => {
        if (!live) return;
        setCompanyAccounts(parseCompanyBankAccounts(data?.company_bank_account || []));
      })
      .catch(() => {
        if (live) setCompanyAccounts([]);
      });
    return () => {
      live = false;
    };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (grossAmount <= 0 || netAmount <= 0) {
      alert("Ingresa un monto valido.");
      return;
    }
    if (netAmount > effectiveBalance + 0.01) {
      alert("El monto neto no puede superar el saldo pendiente.");
      return;
    }
    if (!confirmStep) {
      setConfirmStep(true);
      return;
    }
    setSaving(true);
    try {
      await api.post(`/invoices/${invoice.id}/receipts`, {
        amount: grossAmount,
        payment_date: form.payment_date,
        currency: form.currency,
        payment_method: form.payment_method,
        bank_account: form.bank_account,
        reference_number: form.reference_number,
        retention_pct: retentionPct,
        net_amount: Number(netAmount.toFixed(2)),
      });
      alert("Pago registrado correctamente.");
      onSuccess?.();
    } catch (error) {
      console.error("Error registering payment", error);
      alert(error?.response?.data?.error || "No se pudo registrar el pago.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 md:p-6 z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Registrar pago</h3>
          <button onClick={onClose} className="text-2xl leading-none" type="button">×</button>
        </div>
        <div className="mb-4 p-3 bg-slate-50 rounded text-sm">
          <div className="font-medium">{invoice.invoice_number}</div>
          <div className="text-slate-600">{invoice.organization_name}</div>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-slate-700">
            <span>Total neto:</span>
            <span className="text-right font-medium">{money(total)}</span>
            <span>Pagado:</span>
            <span className="text-right font-medium">{money(paid)}</span>
            <span>Saldo pendiente:</span>
            <span className="text-right font-bold text-orange-600">{money(effectiveBalance)}</span>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Fecha de pago</label>
            <input type="date" className="w-full border rounded-lg px-3 py-2" value={form.payment_date} onChange={(e) => { setConfirmStep(false); setForm({ ...form, payment_date: e.target.value }); }} required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Monto</label>
            <input type="number" step="0.01" className="w-full border rounded-lg px-3 py-2" value={form.amount} onChange={(e) => { setConfirmStep(false); setForm({ ...form, amount: e.target.value }); }} required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Metodo de pago</label>
            <select className="w-full border rounded-lg px-3 py-2" value={form.payment_method} onChange={(e) => { setConfirmStep(false); setForm({ ...form, payment_method: e.target.value }); }}>
              <option value="transferencia">Transferencia</option>
              <option value="efectivo">Efectivo</option>
              <option value="cheque">Cheque</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="otro">Otro</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Banco / cuenta destino</label>
            <select className="w-full border rounded-lg px-3 py-2" value={form.bank_account} onChange={(e) => { setConfirmStep(false); setForm({ ...form, bank_account: e.target.value }); }}>
              {!hasCurrentAccount && form.bank_account ? <option value={form.bank_account}>{form.bank_account}</option> : null}
              {accountOptions.length ? (
                accountOptions.map((account) => (
                  <option key={account.id || companyBankAccountValue(account)} value={companyBankAccountValue(account)}>
                    {companyBankAccountLabel(account)}
                  </option>
                ))
              ) : (
                <>
                  <option value="gs">ITAU</option>
                  <option value="usd">CONTINENTAL</option>
                </>
              )}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Referencia</label>
            <input type="text" className="w-full border rounded-lg px-3 py-2" value={form.reference_number} onChange={(e) => { setConfirmStep(false); setForm({ ...form, reference_number: e.target.value }); }} placeholder="Ej: transferencia #12345" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Retencion IVA</label>
            <select className="w-full border rounded-lg px-3 py-2" value={form.retention_pct} onChange={(e) => { setConfirmStep(false); setForm({ ...form, retention_pct: e.target.value }); }}>
              <option value="0">Sin retencion</option>
              <option value="30">30%</option>
              <option value="70">70%</option>
              <option value="100">100%</option>
            </select>
            <div className="text-xs text-slate-600 mt-1">
              Retencion: {money(retentionAmount)} · Neto aplicado: {money(netAmount)}
            </div>
          </div>
          {confirmStep && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <div className="font-semibold mb-1">Confirmar registro de pago</div>
              <div>Factura: {invoice.invoice_number}</div>
              <div>Monto bruto: {money(grossAmount)}</div>
              <div>Retencion: {money(retentionAmount)}</div>
              <div>Neto aplicado: {money(netAmount)}</div>
              <div>Saldo despues del pago: {money(Math.max(0, effectiveBalance - netAmount))}</div>
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={confirmStep ? () => setConfirmStep(false) : onClose} className="flex-1 px-4 py-2 border rounded-lg" disabled={saving}>
              {confirmStep ? "Volver" : "Cancelar"}
            </button>
            <button type="submit" className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg disabled:bg-slate-300" disabled={saving}>
              {saving ? "Guardando..." : confirmStep ? "Confirmar pago" : "Revisar pago"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreditNoteModal({ invoice, onClose, onSuccess }) {
  const money = (value) => fmtMoney(value, invoice?.currency_code || "USD");
  const [form, setForm] = useState({
    reason: "",
    mode: "percentage",
    percentage: "100",
    amount: "",
  });
  const [saving, setSaving] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);
  const items = Array.isArray(invoice?.items) ? invoice.items : [];
  const existingReceipts = Array.isArray(invoice?.receipts) ? invoice.receipts : [];
  const hasReceipts = existingReceipts.length > 0;
  const grossTotal = items.reduce((sum, item) => {
    const fallbackSubtotal = Number(item.quantity || 1) * Number(item.unit_price || 0);
    return sum + Number((item.subtotal ?? fallbackSubtotal) || 0);
  }, 0);
  const desiredAmount = Number(form.amount || 0) || 0;
  const factor = form.mode === "amount"
    ? grossTotal > 0 ? Math.max(0, Math.min(1, desiredAmount / grossTotal)) : 0
    : Math.max(0, Math.min(100, Number(form.percentage || 0) || 0)) / 100;
  const creditItems = items.map((item, index) => {
    const quantity = Number(item.quantity || 1) || 1;
    const unitPrice = Number(item.unit_price || 0) * factor;
    const subtotal = quantity * unitPrice;
    return {
      description: item.description || "Item",
      quantity,
      unit_price: Number(unitPrice.toFixed(2)),
      subtotal: Number(subtotal.toFixed(2)),
      tax_rate: item.tax_rate ?? 10,
      item_order: item.item_order ?? index,
    };
  });
  const estimatedTotal = creditItems.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
  const credited = Number(invoice?.credited_total || 0) || 0;
  const availableCredit = Math.max(0, Number(invoice?.total_amount || grossTotal || 0) - credited);

  async function handleSubmit(e) {
    e.preventDefault();
    if (hasReceipts) {
      alert("No se puede crear nota de credito desde una factura que ya tiene pagos registrados.");
      return;
    }
    if (!String(form.reason || "").trim()) {
      alert("Carga el motivo de la nota de credito.");
      return;
    }
    if (estimatedTotal <= 0) {
      alert("La nota de credito debe tener un monto mayor a cero.");
      return;
    }
    if (estimatedTotal > availableCredit + 0.01) {
      alert("El monto supera lo disponible para acreditar.");
      return;
    }
    if (!confirmStep) {
      setConfirmStep(true);
      return;
    }
    setSaving(true);
    try {
      await api.post("/invoices/credit-notes", {
        invoice_id: invoice.id,
        reason: form.reason,
        items: creditItems,
      });
      alert("Nota de credito creada en borrador.");
      onSuccess?.();
    } catch (error) {
      console.error("Error creating credit note", error);
      alert(error?.response?.data?.error || "No se pudo crear la nota de credito.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 md:p-6 z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Nueva nota de credito</h3>
          <button onClick={onClose} className="text-2xl leading-none" type="button">×</button>
        </div>
        <div className="mb-4 p-3 bg-slate-50 rounded text-sm">
          <div className="font-medium">{invoice.invoice_number}</div>
          <div className="text-slate-600">{invoice.organization_name}</div>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-slate-700">
            <span>Total factura:</span>
            <span className="text-right font-medium">{money(invoice?.total_amount || grossTotal)}</span>
            <span>Ya acreditado:</span>
            <span className="text-right font-medium">{money(credited)}</span>
            <span>Disponible:</span>
            <span className="text-right font-bold text-amber-700">{money(availableCredit)}</span>
          </div>
          {hasReceipts && (
            <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700">
              Esta factura ya tiene pagos registrados. El backend no permite crear nota de credito en este caso.
            </div>
          )}
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Motivo</label>
            <input type="text" className="w-full border rounded-lg px-3 py-2" value={form.reason} onChange={(e) => { setConfirmStep(false); setForm({ ...form, reason: e.target.value }); }} placeholder="Ej: ajuste comercial" required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Tipo de calculo</label>
            <select className="w-full border rounded-lg px-3 py-2" value={form.mode} onChange={(e) => { setConfirmStep(false); setForm({ ...form, mode: e.target.value }); }}>
              <option value="percentage">Porcentaje</option>
              <option value="amount">Monto</option>
            </select>
          </div>
          {form.mode === "percentage" ? (
            <div>
              <label className="block text-sm font-medium mb-1">Porcentaje a acreditar</label>
              <input type="number" min="1" max="100" className="w-full border rounded-lg px-3 py-2" value={form.percentage} onChange={(e) => { setConfirmStep(false); setForm({ ...form, percentage: e.target.value }); }} />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium mb-1">Monto a acreditar</label>
              <input type="number" min="0" step="0.01" className="w-full border rounded-lg px-3 py-2" value={form.amount} onChange={(e) => { setConfirmStep(false); setForm({ ...form, amount: e.target.value }); }} />
            </div>
          )}
          <div className="rounded-lg border bg-slate-50 p-3 text-sm text-slate-700">
            <div className="flex justify-between">
              <span>Items afectados</span>
              <span className="font-medium">{creditItems.filter((item) => Number(item.subtotal || 0) > 0).length}</span>
            </div>
            <div className="flex justify-between">
              <span>Monto estimado</span>
              <span className="font-semibold">{money(estimatedTotal)}</span>
            </div>
          </div>
          {confirmStep && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
              <div className="font-semibold mb-1">Confirmar nota de credito</div>
              <div>Factura afectada: {invoice.invoice_number}</div>
              <div>Motivo: {form.reason}</div>
              <div>Monto a acreditar: {money(estimatedTotal)}</div>
              <div>Disponible despues de crearla: {money(Math.max(0, availableCredit - estimatedTotal))}</div>
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={confirmStep ? () => setConfirmStep(false) : onClose} className="flex-1 px-4 py-2 border rounded-lg" disabled={saving}>
              {confirmStep ? "Volver" : "Cancelar"}
            </button>
            <button type="submit" className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-lg disabled:bg-slate-300" disabled={saving || hasReceipts}>
              {saving ? "Guardando..." : confirmStep ? "Confirmar nota" : "Revisar nota"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
