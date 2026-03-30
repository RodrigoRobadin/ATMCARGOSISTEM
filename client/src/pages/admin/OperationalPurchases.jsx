import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import OperationExpenseInvoices from "../../components/OperationExpenseInvoices.jsx";

const PAYMENT_METHODS = ["Transferencia", "Efectivo", "Cheque", "Tarjeta", "Otro"];
const PAYMENT_ORDER_LABELS = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  pago_parcial: "Pago parcial",
  pagada: "Pagada",
  anulada: "Anulada",
};

function PaymentOrderBadge({ status }) {
  const key = String(status || "pendiente").toLowerCase();
  const label = PAYMENT_ORDER_LABELS[key] || "Pendiente";
  const cls =
    key === "aprobada"
      ? "bg-emerald-100 text-emerald-700"
      : key === "pendiente"
      ? "bg-amber-100 text-amber-700"
      : key === "pago_parcial"
      ? "bg-blue-100 text-blue-700"
      : key === "pagada"
      ? "bg-slate-100 text-slate-700"
      : "bg-red-100 text-red-700";
  return <span className={`text-xs px-2 py-1 rounded ${cls}`}>{label}</span>;
}

function formatMoney(amount, currency) {
  const curr = String(currency || "PYG").toUpperCase();
  const value = Number(amount || 0);
  if (curr === "PYG") {
    return value.toLocaleString("es-PY", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  if (curr === "USD") {
    return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return value.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseMoneyValue(input, currency) {
  const curr = String(currency || "PYG").toUpperCase();
  const raw = String(input || "").trim();
  if (!raw) return 0;
  if (curr === "PYG") {
    const digits = raw.replace(/[^\d]/g, "");
    return Number(digits || 0);
  }
  const cleaned = raw.replace(/[^\d.,]/g, "");
  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  const sepIndex = Math.max(lastDot, lastComma);
  if (sepIndex === -1) {
    return Number(cleaned.replace(/[.,]/g, "") || 0);
  }
  const intPart = cleaned.slice(0, sepIndex).replace(/[.,]/g, "");
  const decPart = cleaned.slice(sepIndex + 1).replace(/[.,]/g, "");
  return Number(`${intPart}.${decPart}` || 0);
}

function formatInputMoney(input, currency) {
  const value = parseMoneyValue(input, currency);
  return formatMoney(value, currency);
}

export default function OperationalPurchases() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [filters, setFilters] = useState({
    from_date: "",
    to_date: "",
    search_q: "",
    client_q: "",
    operation_q: "",
    supplier_q: "",
    currency_code: "",
    overdue: false,
    payment_status: "",
    due_from: "",
    due_to: "",
  });

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState(null);
  const [paymentFile, setPaymentFile] = useState(null);
  const [paymentForm, setPaymentForm] = useState({
    payment_date: "",
    amount: "",
    method: "",
    account: "",
    reference_number: "",
    notes: "",
  });

  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyInvoice, setHistoryInvoice] = useState(null);
  const [paymentHistory, setPaymentHistory] = useState([]);

  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderInvoice, setOrderInvoice] = useState(null);
  const [orderForm, setOrderForm] = useState({
    payment_method: "",
    payment_date: "",
    observations: "",
    amount: "",
    description: "",
  });
  const [orderPdfOpen, setOrderPdfOpen] = useState(false);
  const [orderPdfUrl, setOrderPdfUrl] = useState("");
  const [batchOrderOpen, setBatchOrderOpen] = useState(false);
  const [batchOrderForm, setBatchOrderForm] = useState({
    payment_method: "",
    payment_date: "",
    observations: "",
  });

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createSearch, setCreateSearch] = useState("");
  const [createResults, setCreateResults] = useState([]);
  const [createLoading, setCreateLoading] = useState(false);
  const [selectedOperation, setSelectedOperation] = useState(null);
  const [openNewKey, setOpenNewKey] = useState(0);
  const [createType, setCreateType] = useState("deal");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const params = { ...filters, overdue: filters.overdue ? "1" : "" };
      const { data } = await api.get("/admin/ops/operation-expenses", { params });
      setRows(Array.isArray(data) ? data : []);
      setSelectedIds(new Set());
    } catch (e) {
      console.error("Error loading operational purchases", e);
      setError("No se pudo cargar compras operativas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    const sum = {};
    for (const r of rows) {
      const curr = (r.currency_code || "PYG").toUpperCase();
      const val = Number(r.amount_total || 0);
      sum[curr] = (sum[curr] || 0) + (isNaN(val) ? 0 : val);
    }
    return sum;
  }, [rows]);

  const searchSuggestions = useMemo(() => {
    const set = new Set();
    rows.forEach((r) => {
      if (r.client_name) set.add(String(r.client_name));
      if (r.client_ruc) set.add(String(r.client_ruc));
      if (r.supplier_display) set.add(String(r.supplier_display));
      if (r.supplier_ruc_display) set.add(String(r.supplier_ruc_display));
      if (r.receipt_number) set.add(String(r.receipt_number));
      if (r.receipt_type) set.add(String(r.receipt_type));
      if (r.operation_reference) set.add(String(r.operation_reference));
      if (r.payment_order_number) set.add(String(r.payment_order_number));
    });
    return Array.from(set).slice(0, 40);
  }, [rows]);

  function resolveUploadUrl(urlPath = "") {
    if (/^https?:\/\//i.test(urlPath)) return urlPath;
    const base = api?.defaults?.baseURL || "";
    try {
      const u = new URL(base);
      return `${u.protocol}//${u.host}${urlPath}`;
    } catch {
      return urlPath;
    }
  }

  function daysOverdue(dueDate) {
    if (!dueDate) return null;
    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) return null;
    const now = new Date();
    const diff = Math.floor((now - due) / (24 * 60 * 60 * 1000));
    return diff > 0 ? diff : null;
  }
  function openPayment(inv) {
    setPaymentInvoice(inv);
    setPaymentForm({
      payment_date: new Date().toISOString().slice(0, 10),
      amount: formatMoney(inv?.balance || 0, inv?.currency_code),
      method: "",
      account: "",
      reference_number: "",
      notes: "",
    });
    setPaymentFile(null);
    setPaymentModalOpen(true);
  }

  async function savePayment() {
    if (!paymentInvoice?.operation_id || !paymentInvoice?.id) return;
    const amount = parseMoneyValue(paymentForm.amount, paymentInvoice?.currency_code);
    if (!amount || amount <= 0) return alert("Monto invalido");
    if (!paymentForm.method) return alert("Metodo de pago es requerido");
    try {
      const { data } = await api.post(
        `/operations/${paymentInvoice.operation_id}/expense-invoices/${paymentInvoice.id}/payments`,
        {
          payment_date: paymentForm.payment_date || null,
          amount,
          method: paymentForm.method || null,
          account: paymentForm.account || null,
          reference_number: paymentForm.reference_number || null,
          notes: paymentForm.notes || null,
        },
        { params: { op_type: paymentInvoice.operation_type || "deal" } }
      );
      if (paymentFile && data?.id) {
        const fd = new FormData();
        fd.append("file", paymentFile);
        await api.post(
          `/operations/${paymentInvoice.operation_id}/expense-invoices/${paymentInvoice.id}/payments/${data.id}/attachments`,
          fd,
          { params: { op_type: paymentInvoice.operation_type || "deal" }, headers: { "Content-Type": "multipart/form-data" } }
        );
      }
      setPaymentModalOpen(false);
      setPaymentInvoice(null);
      setPaymentFile(null);
      await load();
    } catch (e) {
      console.error("Error saving payment", e);
      alert(e?.response?.data?.error || "No se pudo registrar el pago.");
    }
  }

  async function openHistory(inv) {
    try {
      const { data } = await api.get(
        `/operations/${inv.operation_id}/expense-invoices/${inv.id}/payments`,
        { params: { op_type: inv.operation_type || "deal" } }
      );
      setPaymentHistory(Array.isArray(data) ? data : []);
      setHistoryInvoice(inv);
      setHistoryModalOpen(true);
    } catch (e) {
      console.error("Error loading payments", e);
      alert("No se pudo cargar historial de pagos.");
    }
  }

  async function openOrderPdf(inv, download = false) {
    if (!inv?.payment_order_id) return;
    try {
      const res = await api.get(
        `/operations/${inv.operation_id}/payment-orders/${inv.payment_order_id}/pdf`,
        { params: { operation_type: inv.operation_type || "deal" }, responseType: "blob" }
      );
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      if (download) {
        const a = document.createElement("a");
        a.href = url;
        a.download = `orden-pago-${inv.payment_order_id}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      } else {
        if (orderPdfUrl) window.URL.revokeObjectURL(orderPdfUrl);
        setOrderPdfUrl(url);
        setOrderPdfOpen(true);
      }
    } catch (e) {
      alert(e?.response?.data?.error || "No se pudo abrir la orden de pago.");
    }
  }

  function openOrder(inv) {
    setOrderInvoice(inv);
    const curr = inv?.currency_code || "PYG";
    const rawAmount = inv?.balance || inv?.amount_total || "";
    setOrderForm({
      payment_method: "",
      payment_date: inv?.due_date || "",
      observations: "",
      amount: formatMoney(rawAmount, curr),
      description: inv?.operation_title || "",
    });
    setOrderModalOpen(true);
  }

  function isRowSelectable(row) {
    const isCredito = String(row.condition_type || "").toUpperCase() === "CREDITO";
    const poStatus = String(row.payment_order_status || "").toLowerCase();
    return isCredito && poStatus !== "pagada";
  }

  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function allSelected() {
    const list = rows.filter((r) => isRowSelectable(r));
    if (!list.length) return false;
    return list.every((r) => selectedIds.has(r.id));
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const list = rows.filter((r) => isRowSelectable(r));
      const shouldSelect = !allSelected();
      list.forEach((r) => {
        if (shouldSelect) next.add(r.id);
        else next.delete(r.id);
      });
      return next;
    });
  }

  function createOrdersForSelected() {
    const list = rows.filter((r) => selectedIds.has(r.id) && isRowSelectable(r));
    if (!list.length) return alert("No hay facturas seleccionadas.");
    setBatchOrderForm({
      payment_method: "",
      payment_date: list[0]?.due_date || "",
      observations: "",
    });
    setBatchOrderOpen(true);
  }

  async function confirmBatchOrders() {
    const list = rows.filter((r) => selectedIds.has(r.id) && isRowSelectable(r));
    if (!list.length) return alert("No hay facturas seleccionadas.");
    const opId = list[0].operation_id;
    const opType = list[0].operation_type || "deal";
    const sameOp = list.every(
      (r) => r.operation_id === opId && (r.operation_type || "deal") === opType
    );
    if (!sameOp) return alert("Las facturas deben ser de la misma operacion.");
    try {
      const invoice_ids = list.map((r) => r.id);
      await api.post(
        `/operations/${opId}/expense-invoices/payment-orders`,
        {
          invoice_ids,
          payment_method: batchOrderForm.payment_method || null,
          payment_date: batchOrderForm.payment_date || null,
          observations: batchOrderForm.observations || null,
        },
        { params: { operation_type: opType } }
      );
      setBatchOrderOpen(false);
      await load();
    } catch (e) {
      console.error("Error creating batch orders", e);
      alert(e?.response?.data?.error || "No se pudieron crear algunas ordenes.");
    }
  }

  async function saveOrder() {
    if (!orderInvoice?.operation_id || !orderInvoice?.id) return;
    try {
      await api.post(
        `/operations/${orderInvoice.operation_id}/expense-invoices/${orderInvoice.id}/payment-orders`,
        {
          payment_method: orderForm.payment_method || null,
          payment_date: orderForm.payment_date || null,
          observations: orderForm.observations || null,
          amount: parseMoneyValue(orderForm.amount, orderInvoice?.currency_code),
          description: orderForm.description || null,
        },
        { params: { operation_type: orderInvoice.operation_type || "deal" } }
      );
      setOrderModalOpen(false);
      setOrderInvoice(null);
      await load();
    } catch (e) {
      console.error("Error creating payment order", e);
      alert(e?.response?.data?.error || "No se pudo crear la orden de pago.");
    }
  }

  async function searchOperations() {
    const q = String(createSearch || "").trim();
    if (!q) return setCreateResults([]);
    setCreateLoading(true);
    try {
      if (createType === "service") {
        const { data } = await api.get("/service/cases/search", { params: { q } });
        setCreateResults(Array.isArray(data) ? data : []);
      } else {
        const { data } = await api.get("/search", { params: { q } });
        setCreateResults(Array.isArray(data?.deals) ? data.deals : []);
      }
    } catch (e) {
      console.error("Error searching operations", e);
      setCreateResults([]);
    } finally {
      setCreateLoading(false);
    }
  }

  async function viewPaymentAttachment(payment) {
    try {
      const { data } = await api.get(
        `/operations/${historyInvoice.operation_id}/expense-invoices/${historyInvoice.id}/payments/${payment.id}/attachments`,
        { params: { op_type: historyInvoice.operation_type || "deal" } }
      );
      if (!Array.isArray(data) || !data.length) return alert("Sin adjunto.");
      const fileUrl = data[0].file_url;
      const base = api?.defaults?.baseURL || "";
      const url = fileUrl.startsWith("http")
        ? fileUrl
        : base.endsWith("/api")
        ? base.slice(0, -4) + fileUrl
        : base + fileUrl;
      window.open(url, "_blank", "noopener");
    } catch (e) {
      console.error("Error loading payment attachment", e);
      alert("No se pudo abrir el adjunto.");
    }
  }
  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-800">Compras operativas</h1>
        <p className="text-slate-500 text-sm">Facturas de compra vinculadas a operaciones.</p>
      </div>

      <div className="bg-white rounded-2xl shadow p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            className="border rounded px-2 py-1"
            list="op-expense-search-suggestions"
            placeholder="Buscar (cliente, factura, referencia, orden)"
            value={filters.search_q}
            onChange={(e) => setFilters((f) => ({ ...f, search_q: e.target.value }))} />
          <datalist id="op-expense-search-suggestions">
            {searchSuggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <input className="border rounded px-2 py-1" placeholder="Cliente" value={filters.client_q}
            onChange={(e) => setFilters((f) => ({ ...f, client_q: e.target.value }))} />
          <input className="border rounded px-2 py-1" placeholder="Operacion" value={filters.operation_q}
            onChange={(e) => setFilters((f) => ({ ...f, operation_q: e.target.value }))} />
          <input className="border rounded px-2 py-1" placeholder="Proveedor" value={filters.supplier_q}
            onChange={(e) => setFilters((f) => ({ ...f, supplier_q: e.target.value }))} />
          <div>
            <div className="text-xs text-slate-500 mb-1">Emision desde</div>
            <input className="border rounded px-2 py-1 w-full" type="date" value={filters.from_date}
              onChange={(e) => setFilters((f) => ({ ...f, from_date: e.target.value }))} />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Emision hasta</div>
            <input className="border rounded px-2 py-1 w-full" type="date" value={filters.to_date}
              onChange={(e) => setFilters((f) => ({ ...f, to_date: e.target.value }))} />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Vencimiento desde</div>
            <input className="border rounded px-2 py-1 w-full" type="date" value={filters.due_from}
              onChange={(e) => setFilters((f) => ({ ...f, due_from: e.target.value }))} />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Vencimiento hasta</div>
            <input className="border rounded px-2 py-1 w-full" type="date" value={filters.due_to}
              onChange={(e) => setFilters((f) => ({ ...f, due_to: e.target.value }))} />
          </div>
          <select className="border rounded px-2 py-1" value={filters.currency_code}
            onChange={(e) => setFilters((f) => ({ ...f, currency_code: e.target.value }))}>
            <option value="">Moneda</option>
            <option value="PYG">PYG</option>
            <option value="USD">USD</option>
            <option value="BRL">BRL</option>
            <option value="ARS">ARS</option>
          </select>
          <select className="border rounded px-2 py-1" value={filters.payment_status}
            onChange={(e) => setFilters((f) => ({ ...f, payment_status: e.target.value }))}>
            <option value="">Estado pago</option>
            <option value="pendiente">pendiente</option>
            <option value="parcial">parcial</option>
            <option value="pagado">pagado</option>
            <option value="n/a">n/a</option>
          </select>
          <label className="text-sm flex items-center gap-2">
            <input type="checkbox" checked={filters.overdue}
              onChange={(e) => setFilters((f) => ({ ...f, overdue: e.target.checked }))} />
            Vencidas
          </label>
          <button className="px-3 py-2 text-sm rounded bg-black text-white" onClick={load}>Buscar</button>
          <button className="px-3 py-2 text-sm rounded bg-emerald-600 text-white" onClick={() => {
            setCreateSearch(""); setCreateResults([]); setSelectedOperation(null); setCreateModalOpen(true);
          }}>Nueva factura</button>
          {selectedIds.size > 0 && (
            <>
              <button className="px-3 py-2 text-sm rounded border" onClick={createOrdersForSelected}>
                Generar ordenes de pago (seleccionadas)
              </button>
              <div className="text-sm text-slate-600 flex items-center">
                Seleccionadas: <span className="ml-1 font-semibold">{selectedIds.size}</span>
              </div>
            </>
          )}
          <button
            className="px-3 py-2 text-sm rounded border"
            onClick={async () => {
              try {
                const params = Object.entries(filters).reduce((acc, [k, v]) => {
                  if (v === "" || v === false) return acc;
                  acc[k] = v === true ? "1" : v;
                  return acc;
                }, {});
                const res = await api.get("/admin/ops/operation-expenses/export", {
                  params,
                  responseType: "blob",
                });
                const url = window.URL.createObjectURL(new Blob([res.data]));
                const a = document.createElement("a");
                a.href = url;
                a.download = "compras-operativas.xlsx";
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
              } catch (e) {
                alert(e?.response?.data?.error || "No se pudo exportar.");
              }
            }}
          >
            Exportar Excel
          </button>
        </div>
      </div>

      {loading && <div className="text-slate-500">Cargando...</div>}
      {!loading && error && (
        <div className="mb-3 text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">{error}</div>
      )}

      {!loading && !error && (
        <div className="bg-white rounded-2xl shadow p-4">
          <div className="text-xs text-slate-500 mb-2">
            Totales: {Object.keys(totals).length ? Object.entries(totals).map(([k, v]) => `${k} ${formatMoney(v, k)}`).join(" · ") : "--"}
          </div>
          <div className="overflow-auto border rounded-lg">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="text-left px-3 py-2">
                    <input type="checkbox" checked={allSelected()} onChange={toggleSelectAll} />
                  </th>
                  <th className="text-left px-3 py-2">Fecha</th>
                  <th className="text-left px-3 py-2">Operacion</th>
                  <th className="text-left px-3 py-2">Cliente</th>
                  <th className="text-left px-3 py-2">Proveedor</th>
                  <th className="text-left px-3 py-2">Comprobante</th>
                  <th className="text-left px-3 py-2">Condicion</th>
                  <th className="text-left px-3 py-2">Vencimiento</th>
                  <th className="text-left px-3 py-2">Total</th>
                  <th className="text-left px-3 py-2">IVA</th>
                  <th className="text-left px-3 py-2">Items</th>
                  <th className="text-left px-3 py-2">Adjuntos</th>
                  <th className="text-left px-3 py-2">Pago</th>
                  <th className="text-left px-3 py-2">Saldo</th>
                  <th className="text-left px-3 py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2">
                      <input type="checkbox" disabled={!isRowSelectable(r)} checked={selectedIds.has(r.id)}
                        onChange={() => toggleSelected(r.id)} />
                    </td>
                    <td className="px-3 py-2">{r.invoice_date || "--"}</td>
                    <td className="px-3 py-2">
                      <Link className="text-blue-600 underline" to={r.operation_type === "service" ? `/service/cases/${r.operation_id}` : `/operations/${r.operation_id}`}>
                        {r.operation_reference || r.operation_id}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{r.client_name || "--"}{r.client_ruc ? ` (${r.client_ruc})` : ""}</td>
                    <td className="px-3 py-2">{r.supplier_display || "--"}{r.supplier_ruc_display ? ` (${r.supplier_ruc_display})` : ""}</td>
                    <td className="px-3 py-2">
                      {r.receipt_type || "--"}{r.receipt_number ? ` · ${r.receipt_number}` : ""}
                      {r.attachment_url ? (
                        <div>
                          <a className="text-blue-600 underline text-xs" href={resolveUploadUrl(r.attachment_url)} target="_blank" rel="noreferrer">
                            Ver comprobante
                          </a>
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{r.condition_type || "--"}</td>
                    <td className="px-3 py-2">{r.due_date || "--"}</td>
                    <td className="px-3 py-2">{r.currency_code || "PYG"} {formatMoney(r.amount_total, r.currency_code)}</td>
                    <td className="px-3 py-2 text-xs">
                      {[Number(r.iva_10 || 0) ? `10%: ${r.iva_10}` : null, Number(r.iva_5 || 0) ? `5%: ${r.iva_5}` : null, Number(r.iva_exempt || 0) ? `Ex: ${r.iva_exempt}` : null].filter(Boolean).join(" · ") || "--"}
                    </td>
                    <td className="px-3 py-2">{r.item_count || 0}</td>
                    <td className="px-3 py-2">
                      {r.attachment_count || 0}
                      {Number(r.attachment_count || 0) > 0 && (
                        <span className="ml-2 text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-700">Con comprobante</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-1 rounded ${r.payment_status === "pagado" ? "bg-emerald-100 text-emerald-700" : r.payment_status === "parcial" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                        {r.payment_status || "pendiente"}
                      </span>
                      {r.condition_type && String(r.condition_type).toUpperCase() === "CREDITO" && r.due_date && Number(r.balance || 0) > 0 && new Date(r.due_date) < new Date() && (
                        <span className="ml-2 text-xs px-2 py-1 rounded bg-red-100 text-red-700">Vencida {daysOverdue(r.due_date)}d</span>
                      )}
                      {Number(r.balance || 0) === 0 && r.payment_status !== "pagado" && (
                        <span className="ml-2 text-xs px-2 py-1 rounded bg-amber-100 text-amber-700">Revisar estado</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{r.currency_code || "PYG"} {formatMoney(r.balance, r.currency_code)}</td>
                    <td className="px-3 py-2">
                      {String(r.condition_type || "").toUpperCase() === "CREDITO" && (
                        <div className="flex flex-col gap-1">
                          {!r.payment_order_id ? (
                            <button
                              className="px-2 py-1 rounded border text-xs text-blue-700 hover:bg-blue-50 text-left"
                              onClick={() => openOrder(r)}
                            >
                              Generar orden de pago
                            </button>
                          ) : (
                            <>
                              <div className="text-left">
                                <PaymentOrderBadge status={r.payment_order_status} />
                              </div>
                              <button
                                className="px-2 py-1 rounded border text-xs text-blue-700 hover:bg-blue-50 text-left disabled:opacity-60"
                                onClick={() => openPayment(r)}
                                disabled={["pendiente", "anulada"].includes(String(r.payment_order_status || "").toLowerCase())}>
                                {["pendiente"].includes(String(r.payment_order_status || "").toLowerCase())
                                  ? "Pendiente aprobacion"
                                  : ["anulada"].includes(String(r.payment_order_status || "").toLowerCase())
                                  ? "Orden anulada"
                                  : "Registrar pago"}
                              </button>
                              <button
                                className="px-2 py-1 rounded border text-xs text-slate-700 hover:bg-slate-50 text-left"
                                onClick={() => openOrderPdf(r, false)}
                              >
                                Ver orden de pago
                              </button>
                              <button
                                className="px-2 py-1 rounded border text-xs text-slate-700 hover:bg-slate-50 text-left"
                                onClick={() => openOrderPdf(r, true)}
                              >
                                Descargar orden de pago
                              </button>
                            </>
                          )}
                          <button
                            className="px-2 py-1 rounded border text-xs text-emerald-700 hover:bg-emerald-50 text-left"
                            onClick={() => openHistory(r)}
                          >
                            Ver pagos
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={15} className="px-3 py-4 text-center text-slate-500">Sin resultados.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {paymentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Registrar pago a proveedor</h3>
              <button className="text-sm underline" onClick={() => setPaymentModalOpen(false)}>Cerrar</button>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <input type="date" className="border rounded px-2 py-1" value={paymentForm.payment_date}
                onChange={(e) => setPaymentForm((f) => ({ ...f, payment_date: e.target.value }))} />
              <input
                className="border rounded px-2 py-1"
                placeholder="Monto"
                value={paymentForm.amount}
                onChange={(e) =>
                  setPaymentForm((f) => ({
                    ...f,
                    amount: formatInputMoney(e.target.value, paymentInvoice?.currency_code),
                  }))
                }
              />
              <select className="border rounded px-2 py-1" value={paymentForm.method}
                onChange={(e) => setPaymentForm((f) => ({ ...f, method: e.target.value }))}>
                <option value="">Metodo</option>
                {PAYMENT_METHODS.map((m) => (<option key={m} value={m}>{m}</option>))}
              </select>
              <input className="border rounded px-2 py-1" placeholder="Cuenta" value={paymentForm.account}
                onChange={(e) => setPaymentForm((f) => ({ ...f, account: e.target.value }))} />
              <input className="border rounded px-2 py-1" placeholder="Referencia" value={paymentForm.reference_number}
                onChange={(e) => setPaymentForm((f) => ({ ...f, reference_number: e.target.value }))} />
              <textarea className="border rounded px-2 py-1 min-h-[80px]" placeholder="Notas" value={paymentForm.notes}
                onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))} />
              <input type="file" className="border rounded px-2 py-1" onChange={(e) => setPaymentFile(e.target.files?.[0] || null)} />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="px-4 py-2 text-sm rounded border" onClick={() => setPaymentModalOpen(false)}>Cancelar</button>
              <button className="px-4 py-2 text-sm rounded bg-black text-white" onClick={savePayment}>Guardar pago</button>
            </div>
          </div>
        </div>
      )}

      {historyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Historial de pagos</h3>
              <button className="text-sm underline" onClick={() => setHistoryModalOpen(false)}>Cerrar</button>
            </div>
            <div className="text-xs text-slate-500 mb-2">
              {historyInvoice?.supplier_display || "Proveedor"} · {historyInvoice?.receipt_number || "Comprobante"}
            </div>
            <div className="overflow-auto border rounded-lg">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th className="text-left px-3 py-2">Fecha</th>
                    <th className="text-left px-3 py-2">Monto</th>
                    <th className="text-left px-3 py-2">Metodo</th>
                    <th className="text-left px-3 py-2">Cuenta</th>
                    <th className="text-left px-3 py-2">Referencia</th>
                    <th className="text-left px-3 py-2">Estado</th>
                    <th className="text-left px-3 py-2">Adjunto</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentHistory.map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="px-3 py-2">{p.payment_date || "--"}</td>
                      <td className="px-3 py-2">{historyInvoice?.currency_code || "PYG"} {formatMoney(p.amount, historyInvoice?.currency_code)}</td>
                      <td className="px-3 py-2">{p.method || "--"}</td>
                      <td className="px-3 py-2">{p.account || "--"}</td>
                      <td className="px-3 py-2">{p.reference_number || "--"}</td>
                      <td className="px-3 py-2">{p.status || "confirmado"}</td>
                      <td className="px-3 py-2">
                        <button className="text-blue-600 underline" onClick={() => viewPaymentAttachment(p)}>Ver adjunto</button>
                      </td>
                    </tr>
                  ))}
                  {paymentHistory.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-4 text-center text-slate-500">Sin pagos registrados.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {orderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Generar orden de pago</h3>
              <button className="text-sm underline" onClick={() => setOrderModalOpen(false)}>Cerrar</button>
            </div>
            <div className="text-xs text-slate-500 mb-3">
              {orderInvoice?.supplier_display || "Proveedor"} · {orderInvoice?.receipt_number || "Comprobante"}
            </div>
            <div className="grid grid-cols-1 gap-3">
              <select className="border rounded px-2 py-1" value={orderForm.payment_method}
                onChange={(e) => setOrderForm((f) => ({ ...f, payment_method: e.target.value }))}>
                <option value="">Forma de pago</option>
                {PAYMENT_METHODS.map((m) => (<option key={m} value={m}>{m}</option>))}
              </select>
              <div>
                <div className="text-xs text-slate-500 mb-1">Fecha de pago</div>
                <input type="date" className="border rounded px-2 py-1 w-full" value={orderForm.payment_date}
                  onChange={(e) => setOrderForm((f) => ({ ...f, payment_date: e.target.value }))} />
              </div>
              <input
                className="border rounded px-2 py-1 w-full"
                placeholder="Monto"
                value={orderForm.amount}
                onChange={(e) =>
                  setOrderForm((f) => ({
                    ...f,
                    amount: formatInputMoney(e.target.value, orderInvoice?.currency_code),
                  }))
                }
              />
              <input
                className="border rounded px-2 py-1"
                placeholder="Servicio contratado"
                value={orderForm.description}
                onChange={(e) => setOrderForm((f) => ({ ...f, description: e.target.value }))}
              />
              <textarea className="border rounded px-2 py-1 min-h-[80px]" placeholder="Observaciones" value={orderForm.observations}
                onChange={(e) => setOrderForm((f) => ({ ...f, observations: e.target.value }))} />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="px-4 py-2 text-sm rounded border" onClick={() => setOrderModalOpen(false)}>Cancelar</button>
              <button className="px-4 py-2 text-sm rounded bg-black text-white" onClick={saveOrder}>Generar</button>
            </div>
          </div>
        </div>
      )}

      {batchOrderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Generar ordenes de pago</h3>
              <button className="text-sm underline" onClick={() => setBatchOrderOpen(false)}>
                Cerrar
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <select
                className="border rounded px-2 py-1"
                value={batchOrderForm.payment_method}
                onChange={(e) =>
                  setBatchOrderForm((f) => ({ ...f, payment_method: e.target.value }))
                }
              >
                <option value="">Metodo</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                type="date"
                className="border rounded px-2 py-1"
                value={batchOrderForm.payment_date}
                onChange={(e) =>
                  setBatchOrderForm((f) => ({ ...f, payment_date: e.target.value }))
                }
              />
              <textarea
                className="border rounded px-2 py-1 min-h-[80px]"
                placeholder="Observaciones"
                value={batchOrderForm.observations}
                onChange={(e) =>
                  setBatchOrderForm((f) => ({ ...f, observations: e.target.value }))
                }
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-4 py-2 text-sm rounded border"
                onClick={() => setBatchOrderOpen(false)}
              >
                Cancelar
              </button>
              <button
                className="px-4 py-2 text-sm rounded bg-black text-white"
                onClick={confirmBatchOrders}
              >
                Generar
              </button>
            </div>
          </div>
        </div>
      )}

      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Seleccionar operacion</h3>
              <button className="text-sm underline" onClick={() => setCreateModalOpen(false)}>Cerrar</button>
            </div>
            <div className="flex gap-2 mb-3">
              <select className="border rounded px-2 py-1" value={createType}
                onChange={(e) => { setCreateType(e.target.value); setCreateResults([]); setSelectedOperation(null); }}>
                <option value="deal">Operacion</option>
                <option value="service">Servicio</option>
              </select>
              <input className="border rounded px-2 py-1 w-full" placeholder="Buscar por referencia o cliente" value={createSearch}
                onChange={(e) => setCreateSearch(e.target.value)} />
              <button className="px-3 py-2 text-sm rounded bg-black text-white" onClick={searchOperations}>Buscar</button>
            </div>
            {createLoading && <div className="text-sm text-slate-500">Buscando...</div>}
            {!createLoading && (
              <div className="border rounded-lg max-h-64 overflow-auto">
                {createResults.map((d) => (
                  <button key={d.id} type="button" className={`block w-full text-left px-3 py-2 text-sm hover:bg-slate-100 ${selectedOperation?.id === d.id ? "bg-slate-100" : ""}`}
                    onClick={() => setSelectedOperation({ ...d, operation_type: createType })}>
                    {d.reference || `Op ${d.id}`} · {d.org_name || "--"}
                  </button>
                ))}
                {createResults.length === 0 && (
                  <div className="px-3 py-4 text-sm text-slate-500">Sin resultados.</div>
                )}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button className="px-4 py-2 text-sm rounded border" onClick={() => setCreateModalOpen(false)}>Cancelar</button>
              <button className="px-4 py-2 text-sm rounded bg-emerald-600 text-white" disabled={!selectedOperation}
                onClick={() => { setCreateModalOpen(false); setOpenNewKey((k) => k + 1); }}>
                Cargar factura
              </button>
            </div>
          </div>
        </div>
      )}

      {orderPdfOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl h-[80vh] p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Orden de pago</h3>
              <button
                className="text-sm underline"
                onClick={() => {
                  if (orderPdfUrl) window.URL.revokeObjectURL(orderPdfUrl);
                  setOrderPdfUrl("");
                  setOrderPdfOpen(false);
                }}
              >
                Cerrar
              </button>
            </div>
            <div className="flex-1 border rounded-lg overflow-hidden">
              {orderPdfUrl ? (
                <iframe title="Orden de pago" src={orderPdfUrl} className="w-full h-full" />
              ) : (
                <div className="text-sm text-slate-500 p-4">Sin PDF.</div>
              )}
            </div>
          </div>
        </div>
      )}

      <OperationExpenseInvoices
        operationId={selectedOperation?.id}
        operationType={selectedOperation?.operation_type || "deal"}
        showList={false}
        openNewKey={openNewKey}
      />
    </div>
  );
}
