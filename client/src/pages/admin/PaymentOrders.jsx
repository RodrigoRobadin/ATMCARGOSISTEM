import React, { useEffect, useState } from "react";
import { api } from "../../api";
import {
  companyBankAccountLabel,
  companyBankAccountValue,
  filterCompanyBankAccounts,
  parseCompanyBankAccounts,
} from "../../utils/companyBankAccounts";

const STATUSES = ["pendiente", "aprobada", "pago_parcial", "pagada", "anulada"];
const PAYMENT_METHODS = ["Transferencia", "Efectivo", "Cheque", "Tarjeta", "Otro"];
const STATUS_TABS = [
  { value: "todas", label: "Todas" },
  { value: "pendiente", label: "Pendientes" },
  { value: "aprobada", label: "Aprobadas para pagar" },
  { value: "pago_parcial", label: "Pago parcial" },
  { value: "pagada", label: "Pagadas" },
  { value: "anulada", label: "Anuladas" },
  { value: "vencida", label: "Vencidas" },
];
const STATUS_LABELS = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  pago_parcial: "Pago parcial",
  pagada: "Pagada",
  anulada: "Anulada",
};

function StatusBadge({ status }) {
  const key = String(status || "pendiente").toLowerCase();
  const label = STATUS_LABELS[key] || "Pendiente";
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
  if (curr === "PYG") return Number(raw.replace(/[^\d]/g, "") || 0);
  const cleaned = raw.replace(/[^\d.,]/g, "");
  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  const sepIndex = Math.max(lastDot, lastComma);
  if (sepIndex === -1) return Number(cleaned.replace(/[.,]/g, "") || 0);
  const intPart = cleaned.slice(0, sepIndex).replace(/[.,]/g, "");
  const decPart = cleaned.slice(sepIndex + 1).replace(/[.,]/g, "");
  return Number(`${intPart}.${decPart}` || 0);
}

function parseOrderInvoices(row) {
  const raw = String(row?.invoices_list || "");
  if (!raw) {
    return row?.primary_invoice_id
      ? [{ id: row.primary_invoice_id, receipt_number: row.receipt_number || "", amount: row.amount, currency_code: row.currency_code, due_date: row.due_date }]
      : [];
  }
  return raw
    .split("||")
    .filter(Boolean)
    .map((part) => {
      const [id, receipt_number, amount, currency_code, due_date] = part.split("::");
      return { id, receipt_number, amount: Number(amount || 0), currency_code, due_date };
    });
}

function isOverdue(row) {
  if (!row?.due_date || Number(row?.balance || 0) <= 0.009) return false;
  const due = new Date(row.due_date);
  if (Number.isNaN(due.getTime())) return false;
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

function supplierBankLabel(row) {
  return [row?.supplier_bank_name, row?.supplier_bank_account, row?.supplier_bank_currency]
    .filter(Boolean)
    .join(" - ");
}

function hasSupplierBankData(row) {
  return Boolean(row?.supplier_bank_name || row?.supplier_bank_account || row?.supplier_bank_holder || row?.supplier_bank_cci_iban);
}

export default function PaymentOrders() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [companyAccounts, setCompanyAccounts] = useState([]);
  const [actionsMenu, setActionsMenu] = useState(null);
  const [detailRow, setDetailRow] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [approveRow, setApproveRow] = useState(null);
  const [approveNote, setApproveNote] = useState("");
  const [cancelRow, setCancelRow] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [scheduleRow, setScheduleRow] = useState(null);
  const [scheduleForm, setScheduleForm] = useState({
    scheduled_payment_date: "",
    planned_company_account: "",
    priority: "normal",
    note: "",
  });
  const [paymentRow, setPaymentRow] = useState(null);
  const [paymentAllocations, setPaymentAllocations] = useState([]);
  const [paymentFile, setPaymentFile] = useState(null);
  const [paymentForm, setPaymentForm] = useState({
    payment_date: "",
    amount: "",
    method: "",
    account: "",
    reference_number: "",
    notes: "",
  });
  const [filters, setFilters] = useState({
    status_tab: "pendiente",
    from_date: "",
    to_date: "",
    payment_from: "",
    payment_to: "",
    due_from: "",
    due_to: "",
    status: "",
    search_q: "",
    supplier_q: "",
    operation_q: "",
    currency_code: "",
  });
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFilters, setExportFilters] = useState(filters);
  const actionMenuRef = React.useRef(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/admin/ops/payment-orders", { params: filters });
      setRows(Array.isArray(data) ? data : []);
      setSelectedIds(new Set());
    } catch (e) {
      console.error("Error loading payment orders", e);
      setError("No se pudieron cargar las ordenes de pago.");
    } finally {
      setLoading(false);
    }
  }

  async function loadCompanyAccounts() {
    try {
      const { data } = await api.get("/params", {
        params: { keys: "company_bank_account", only_active: 1 },
      });
      setCompanyAccounts(parseCompanyBankAccounts(data?.company_bank_account || []));
    } catch (e) {
      console.error("Error loading company accounts", e);
      setCompanyAccounts([]);
    }
  }

  async function openDetail(row) {
    setDetailRow(row);
    setDetailData(null);
    setDetailLoading(true);
    try {
      const { data } = await api.get(`/admin/ops/payment-orders/${row.id}/detail`);
      setDetailData(data || null);
    } catch (e) {
      console.error("Error loading payment order detail", e);
      setDetailData(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function refreshDetail(row = detailRow) {
    if (!row?.id) return;
    try {
      const { data } = await api.get(`/admin/ops/payment-orders/${row.id}/detail`);
      setDetailData(data || null);
    } catch (e) {
      console.error("Error refreshing payment order detail", e);
    }
  }

  useEffect(() => {
    load();
    loadCompanyAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onClick = (event) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(event.target)) {
        setActionsMenu(null);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const searchSuggestions = React.useMemo(() => {
    const set = new Set();
    rows.forEach((r) => {
      if (r.supplier_display) set.add(String(r.supplier_display));
      if (r.supplier_ruc) set.add(String(r.supplier_ruc));
      if (r.receipt_number) set.add(String(r.receipt_number));
      if (r.operation_reference) set.add(String(r.operation_reference));
      if (r.order_number) set.add(String(r.order_number));
    });
    return Array.from(set).slice(0, 40);
  }, [rows]);

  function matchesTab(row, tab = filters.status_tab) {
    const status = String(row?.status || "pendiente").toLowerCase();
    if (tab === "todas") return true;
    if (tab === "vencida") return isOverdue(row);
    return status === tab;
  }

  const visibleRows = React.useMemo(
    () => rows.filter((row) => matchesTab(row)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, filters.status_tab]
  );

  const dashboard = React.useMemo(() => {
    const counts = {};
    for (const tab of STATUS_TABS) counts[tab.value] = 0;
    const byCurrency = {};
    for (const row of rows) {
      for (const tab of STATUS_TABS) {
        if (matchesTab(row, tab.value)) counts[tab.value] += 1;
      }
      const curr = String(row.currency_code || "PYG").toUpperCase();
      if (!byCurrency[curr]) {
        byCurrency[curr] = { amount: 0, paid: 0, balance: 0, overdue: 0 };
      }
      byCurrency[curr].amount += Number(row.amount || 0);
      byCurrency[curr].paid += Number(row.paid_amount || 0);
      byCurrency[curr].balance += Number(row.balance || 0);
      if (isOverdue(row)) byCurrency[curr].overdue += Number(row.balance || 0);
    }
    return { counts, byCurrency };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  async function exportXlsx() {
    try {
      const res = await api.get("/admin/ops/payment-orders/export", {
        params: exportFilters,
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = "ordenes-de-pago.xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      setExportOpen(false);
    } catch (e) {
      console.error("Error exporting payment orders", e);
      alert("No se pudo exportar.");
    }
  }

  function allSelected() {
    if (!visibleRows.length) return false;
    return visibleRows.every((r) => selectedIds.has(r.id));
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const shouldSelect = !allSelected();
      visibleRows.forEach((r) => {
        if (shouldSelect) next.add(r.id);
        else next.delete(r.id);
      });
      return next;
    });
  }

  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function downloadZip() {
    try {
      const ids = Array.from(selectedIds);
      if (!ids.length) return;
      const res = await api.post(
        "/admin/ops/payment-orders/export-zip",
        { ids },
        { responseType: "blob" }
      );
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = "ordenes-de-pago.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      alert(e?.response?.data?.error || "No se pudo descargar el ZIP.");
    }
  }

  async function openPdf(row) {
    try {
      const res = await api.get(
        `/operations/${row.operation_id}/payment-orders/${row.id}/pdf`,
        {
          params: { operation_type: row.operation_type || "deal" },
          responseType: "blob",
        }
      );
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      window.open(url, "_blank", "noopener");
      setTimeout(() => window.URL.revokeObjectURL(url), 10000);
    } catch (e) {
      alert(e?.response?.data?.error || "No se pudo abrir el PDF.");
    }
  }

  async function downloadPdf(row) {
    try {
      const res = await api.get(
        `/operations/${row.operation_id}/payment-orders/${row.id}/pdf`,
        {
          params: { operation_type: row.operation_type || "deal" },
          responseType: "blob",
        }
      );
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `orden-pago-${row.order_number || row.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      alert(e?.response?.data?.error || "No se pudo descargar el PDF.");
    }
  }

  function openOperation(row) {
    if (!row?.operation_id) return;
    const href =
      row.operation_type === "service"
        ? `/service/cases/${row.operation_id}`
        : `/operations/${row.operation_id}`;
    window.open(href, "_blank", "noopener,noreferrer");
  }

  async function approveOrder(row, note = "") {
    try {
      await api.patch(`/admin/ops/payment-orders/${row.id}/approve`, { note });
      setApproveRow(null);
      setApproveNote("");
      await load();
      await refreshDetail(row);
    } catch (e) {
      alert(e?.response?.data?.error || "No se pudo aprobar.");
    }
  }

  function canRegisterPayment(row) {
    const status = String(row?.status || "").toLowerCase();
    if (!["aprobada", "pago_parcial"].includes(status)) return false;
    if (Number(row?.balance || 0) <= 0.009) return false;
    return parseOrderInvoices(row).length > 0;
  }

  async function openPayment(row) {
    let items = parseOrderInvoices(row);
    try {
      const { data } = await api.get(`/admin/ops/payment-orders/${row.id}/detail`);
      if (Array.isArray(data?.items) && data.items.length) {
        items = data.items.map((item) => ({
          id: item.invoice_id,
          receipt_number: item.receipt_number,
          amount: Number(item.order_amount || item.amount_total || 0),
          balance: Number(item.balance ?? item.order_amount ?? 0),
          currency_code: item.currency_code || row.currency_code,
        }));
      }
    } catch (e) {
      console.error("Error loading payment order invoices", e);
    }
    if (!items.length) return alert("Esta orden no tiene facturas para registrar pago.");
    setPaymentRow(row);
    setPaymentAllocations(
      items.map((invoice) => ({
        invoice_id: invoice.id,
        receipt_number: invoice.receipt_number,
        balance: Number(invoice.balance ?? invoice.amount ?? 0),
        amount: formatMoney(Number(invoice.balance ?? invoice.amount ?? 0), invoice.currency_code || row.currency_code),
        currency_code: invoice.currency_code || row.currency_code,
      }))
    );
    setPaymentForm({
      payment_date: new Date().toISOString().slice(0, 10),
      amount: formatMoney(row?.balance || 0, row?.currency_code),
      method: row?.payment_method || "",
      account: "",
      reference_number: "",
      notes: "",
    });
    setPaymentFile(null);
  }

  async function savePayment() {
    if (!paymentRow?.id) return;
    const payments = paymentAllocations
      .map((item) => ({
        invoice_id: item.invoice_id,
        amount: parseMoneyValue(item.amount, item.currency_code || paymentRow.currency_code),
      }))
      .filter((item) => item.invoice_id && item.amount > 0);
    const amount = payments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    if (!amount || amount <= 0) return alert("Monto invalido");
    if (!paymentForm.method) return alert("Metodo de pago es requerido");
    try {
      const { data } = await api.post(
        `/admin/ops/payment-orders/${paymentRow.id}/payments`,
        {
          payment_date: paymentForm.payment_date || null,
          method: paymentForm.method || null,
          account: paymentForm.account || null,
          reference_number: paymentForm.reference_number || null,
          notes: paymentForm.notes || null,
          payments,
        }
      );
      const firstPayment = Array.isArray(data?.payments) ? data.payments[0] : null;
      if (paymentFile && firstPayment?.id && firstPayment?.invoice_id) {
        const fd = new FormData();
        fd.append("file", paymentFile);
        await api.post(
          `/operations/${paymentRow.operation_id}/expense-invoices/${firstPayment.invoice_id}/payments/${firstPayment.id}/attachments`,
          fd,
          { params: { op_type: paymentRow.operation_type || "deal" }, headers: { "Content-Type": "multipart/form-data" } }
        );
      }
      setPaymentRow(null);
      setPaymentAllocations([]);
      setPaymentFile(null);
      await load();
      await refreshDetail(paymentRow);
    } catch (e) {
      console.error("Error saving payment from payment order", e);
      alert(e?.response?.data?.error || "No se pudo registrar el pago.");
    }
  }

  async function cancelOrder() {
    if (!cancelRow?.id) return;
    const reason = String(cancelReason || "").trim();
    if (!reason) return alert("Motivo de anulacion requerido.");
    try {
      await api.patch(`/admin/ops/payment-orders/${cancelRow.id}/cancel`, { reason });
      setCancelRow(null);
      setCancelReason("");
      await load();
      await refreshDetail(cancelRow);
    } catch (e) {
      alert(e?.response?.data?.error || "No se pudo anular la orden.");
    }
  }

  function openSchedule(row) {
    setScheduleRow(row);
    setScheduleForm({
      scheduled_payment_date: row?.scheduled_payment_date || row?.payment_date || "",
      planned_company_account: row?.planned_company_account || "",
      priority: row?.priority || "normal",
      note: "",
    });
  }

  async function saveSchedule() {
    if (!scheduleRow?.id) return;
    try {
      await api.patch(`/admin/ops/payment-orders/${scheduleRow.id}/schedule`, scheduleForm);
      setScheduleRow(null);
      await load();
      await refreshDetail(scheduleRow);
    } catch (e) {
      alert(e?.response?.data?.error || "No se pudo programar la orden.");
    }
  }

  function actionItems(row) {
    const items = [
      { label: "Ver detalle", onClick: () => openDetail(row) },
      { label: "Ver PDF", onClick: () => openPdf(row) },
      { label: "Descargar PDF", onClick: () => downloadPdf(row) },
      { label: "Ver operacion", onClick: () => openOperation(row) },
    ];
    if (String(row.status || "").toLowerCase() === "pendiente") {
      items.push({ label: "Aprobar", onClick: () => { setApproveRow(row); setApproveNote(""); } });
    }
    if (!["pagada", "anulada"].includes(String(row.status || "").toLowerCase())) {
      items.push({ label: "Programar pago", onClick: () => openSchedule(row) });
    }
    items.push({
      label: canRegisterPayment(row)
        ? "Registrar pago"
        : "Registrar pago",
      disabled: !canRegisterPayment(row),
      onClick: () => openPayment(row),
    });
    if (["pendiente", "aprobada"].includes(String(row.status || "").toLowerCase())) {
      items.push({ label: "Anular", onClick: () => { setCancelRow(row); setCancelReason(""); } });
    }
    return items;
  }

  const activeDetail = detailData?.order || detailRow;
  const activeDetailItems = Array.isArray(detailData?.items) && detailData.items.length ? detailData.items : parseOrderInvoices(activeDetail || {});
  const activeDetailPayments = Array.isArray(detailData?.payments) ? detailData.payments : [];
  const activeDetailEvents = Array.isArray(detailData?.events) ? detailData.events : [];

  const sameCurrencyPaymentAccounts = filterCompanyBankAccounts(companyAccounts, paymentRow?.currency_code || "PYG");
  const fallbackPaymentAccounts = (companyAccounts || []).filter((account) => {
    if (!account?.active) return false;
    return !sameCurrencyPaymentAccounts.some((item) => companyBankAccountValue(item) === companyBankAccountValue(account));
  });
  const paymentAccountOptions = sameCurrencyPaymentAccounts.length ? sameCurrencyPaymentAccounts : fallbackPaymentAccounts;
  const hasCurrentPaymentAccount =
    paymentForm.account &&
    !paymentAccountOptions.some((account) => companyBankAccountValue(account) === paymentForm.account);
  const sameCurrencyScheduleAccounts = filterCompanyBankAccounts(companyAccounts, scheduleRow?.currency_code || "PYG");
  const fallbackScheduleAccounts = (companyAccounts || []).filter((account) => {
    if (!account?.active) return false;
    return !sameCurrencyScheduleAccounts.some((item) => companyBankAccountValue(item) === companyBankAccountValue(account));
  });
  const scheduleAccountOptions = sameCurrencyScheduleAccounts.length ? sameCurrencyScheduleAccounts : fallbackScheduleAccounts;
  const hasCurrentScheduleAccount =
    scheduleForm.planned_company_account &&
    !scheduleAccountOptions.some((account) => companyBankAccountValue(account) === scheduleForm.planned_company_account);

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Ordenes de pago</h1>
          <p className="text-slate-500 text-sm">Autorizacion, seguimiento y descarga de ordenes de pago operativas.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="px-3 py-2 text-sm rounded border bg-white"
            onClick={() => {
              setExportFilters(filters);
              setExportOpen(true);
            }}
          >
            Exportar
          </button>
          {selectedIds.size > 0 && (
            <button className="px-3 py-2 text-sm rounded border bg-white" onClick={downloadZip}>
              Descargar ZIP ({selectedIds.size})
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          ["Monto OP", "amount", "bg-blue-50 text-blue-700"],
          ["Pagado", "paid", "bg-emerald-50 text-emerald-700"],
          ["Saldo pendiente", "balance", "bg-amber-50 text-amber-700"],
          ["Vencido", "overdue", "bg-red-50 text-red-700"],
        ].map(([label, key, cls]) => (
          <div key={key} className="rounded-xl border bg-white p-3 shadow-sm">
            <div className="text-xs text-slate-500">{label}</div>
            <div className={`mt-2 rounded-lg px-2 py-1 text-xs font-semibold ${cls}`}>
              {Object.entries(dashboard.byCurrency)
                .filter(([, values]) => Number(values[key] || 0) > 0)
                .map(([currency, values]) => `${currency} ${formatMoney(values[key], currency)}`)
                .join(" · ") || "--"}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow p-4">
        <div className="mb-4 flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              className={`rounded-full border px-3 py-1.5 text-xs ${
                filters.status_tab === tab.value ? "bg-black text-white" : "bg-white text-slate-700 hover:bg-slate-50"
              }`}
              onClick={() => setFilters((f) => ({ ...f, status_tab: tab.value }))}
            >
              {tab.label}
              <span className={`ml-2 rounded-full px-1.5 py-0.5 ${filters.status_tab === tab.value ? "bg-white/20" : "bg-slate-100"}`}>
                {dashboard.counts[tab.value] || 0}
              </span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            className="border rounded px-2 py-1"
            list="payment-orders-search-suggestions"
            placeholder="Buscar (cliente, factura, referencia, orden)"
            value={filters.search_q}
            onChange={(e) => setFilters((f) => ({ ...f, search_q: e.target.value }))}
          />
          <datalist id="payment-orders-search-suggestions">
            {searchSuggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <input
            className="border rounded px-2 py-1"
            placeholder="Proveedor (nombre o RUC)"
            value={filters.supplier_q}
            onChange={(e) => setFilters((f) => ({ ...f, supplier_q: e.target.value }))}
          />
          <input
            className="border rounded px-2 py-1"
            placeholder="Operacion (referencia)"
            value={filters.operation_q}
            onChange={(e) => setFilters((f) => ({ ...f, operation_q: e.target.value }))}
          />
          <select
            className="border rounded px-2 py-1"
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
          >
            <option value="">Estado</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className="border rounded px-2 py-1"
            value={filters.currency_code}
            onChange={(e) => setFilters((f) => ({ ...f, currency_code: e.target.value }))}
          >
            <option value="">Moneda</option>
            <option value="PYG">PYG</option>
            <option value="USD">USD</option>
          </select>
          <div>
            <div className="text-xs text-slate-500 mb-1">Creacion desde</div>
            <input
              className="border rounded px-2 py-1 w-full"
              type="date"
              value={filters.from_date}
              onChange={(e) => setFilters((f) => ({ ...f, from_date: e.target.value }))}
            />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Creacion hasta</div>
            <input
              className="border rounded px-2 py-1 w-full"
              type="date"
              value={filters.to_date}
              onChange={(e) => setFilters((f) => ({ ...f, to_date: e.target.value }))}
            />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Pago desde</div>
            <input
              className="border rounded px-2 py-1 w-full"
              type="date"
              value={filters.payment_from}
              onChange={(e) => setFilters((f) => ({ ...f, payment_from: e.target.value }))}
            />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Pago hasta</div>
            <input
              className="border rounded px-2 py-1 w-full"
              type="date"
              value={filters.payment_to}
              onChange={(e) => setFilters((f) => ({ ...f, payment_to: e.target.value }))}
            />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Vencimiento desde</div>
            <input
              className="border rounded px-2 py-1 w-full"
              type="date"
              value={filters.due_from}
              onChange={(e) => setFilters((f) => ({ ...f, due_from: e.target.value }))}
            />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Vencimiento hasta</div>
            <input
              className="border rounded px-2 py-1 w-full"
              type="date"
              value={filters.due_to}
              onChange={(e) => setFilters((f) => ({ ...f, due_to: e.target.value }))}
            />
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button className="px-3 py-2 text-sm rounded bg-black text-white" onClick={load}>
            Buscar
          </button>
          <button
            className="px-3 py-2 text-sm rounded border"
            onClick={() => {
              setFilters({
                from_date: "",
                to_date: "",
                payment_from: "",
                payment_to: "",
                due_from: "",
                due_to: "",
                status_tab: "pendiente",
                status: "",
                search_q: "",
                supplier_q: "",
                operation_q: "",
                currency_code: "",
              });
            }}
          >
            Limpiar
          </button>
          {selectedIds.size > 0 && (
            <>
              <div className="text-sm text-slate-600 flex items-center">
                Seleccionadas: <span className="ml-1 font-semibold">{selectedIds.size}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {error && <div className="text-sm text-red-600 mb-3">{error}</div>}

      <div className="bg-white rounded-2xl shadow overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="text-left px-3 py-2">
                <input type="checkbox" checked={allSelected()} onChange={toggleSelectAll} />
              </th>
              <th className="text-left px-3 py-2">Orden</th>
              <th className="text-left px-3 py-2">Proveedor</th>
              <th className="text-left px-3 py-2">Cuenta proveedor</th>
              <th className="text-left px-3 py-2">Factura</th>
              <th className="text-left px-3 py-2">Cant</th>
              <th className="text-left px-3 py-2">Operacion</th>
              <th className="text-left px-3 py-2">Metodo</th>
              <th className="text-left px-3 py-2">Fecha pago</th>
              <th className="text-left px-3 py-2">Vencimiento</th>
              <th className="text-left px-3 py-2">Monto</th>
              <th className="text-left px-3 py-2">Pagado</th>
              <th className="text-left px-3 py-2">Saldo</th>
              <th className="text-left px-3 py-2">Estado</th>
              <th className="text-left px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={16} className="px-3 py-4 text-center text-slate-500">
                  Cargando...
                </td>
              </tr>
            )}
            {!loading && visibleRows.length === 0 && (
              <tr>
                <td colSpan={16} className="px-3 py-4 text-center text-slate-500">
                  Sin resultados.
                </td>
              </tr>
            )}
            {!loading &&
              visibleRows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(r.id)}
                      onChange={() => toggleSelected(r.id)}
                    />
                  </td>
                  <td className="px-3 py-2">{r.order_number || "-"}</td>
                  <td className="px-3 py-2">
                    <div>{r.supplier_display || "-"}</div>
                    <div className="text-xs text-slate-500">{r.supplier_ruc_display || r.supplier_ruc || ""}</div>
                  </td>
                  <td className="px-3 py-2">
                    {supplierBankLabel(r) || (
                      <span className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-700">Proveedor sin cuenta</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.invoices_list ? (
                      <div className="flex flex-col gap-1">
                        {parseOrderInvoices(r).map((invoice, idx) => (
                          <div key={`${r.id}-inv-${idx}`} className="text-xs text-slate-700">
                            {invoice.receipt_number || "-"} · {(invoice.currency_code || r.currency_code || "PYG")} {formatMoney(invoice.amount, invoice.currency_code || r.currency_code)}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span>{r.receipt_number || "-"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{r.invoice_count || 0}</td>
                  <td className="px-3 py-2">{r.operation_reference || "-"}</td>
                  <td className="px-3 py-2">{r.payment_method || "-"}</td>
                  <td className="px-3 py-2">{r.payment_date || "-"}</td>
                  <td className="px-3 py-2">{r.due_date || "-"}</td>
                  <td className="px-3 py-2">
                    {r.currency_code || "PYG"} {formatMoney(r.amount, r.currency_code)}
                  </td>
                  <td className="px-3 py-2">
                    {r.currency_code || "PYG"} {formatMoney(r.paid_amount, r.currency_code)}
                  </td>
                  <td className="px-3 py-2">
                    {r.currency_code || "PYG"} {formatMoney(r.balance, r.currency_code)}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                    {isOverdue(r) && <span className="ml-2 text-xs px-2 py-1 rounded bg-red-100 text-red-700">Vencida</span>}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      className="px-2 py-1 rounded border text-xs hover:bg-slate-50"
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        setActionsMenu({
                          id: r.id,
                          row: r,
                          top: Math.min(rect.bottom + 6, window.innerHeight - 260),
                          left: Math.min(rect.left, window.innerWidth - 220),
                        });
                      }}
                    >
                      Acciones
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {actionsMenu && (
        <div
          ref={actionMenuRef}
          className="fixed z-[120] w-52 rounded-xl border bg-white p-1 shadow-xl"
          style={{ top: actionsMenu.top, left: actionsMenu.left }}
        >
          {actionItems(actionsMenu.row).map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={item.disabled}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => {
                if (item.disabled) return;
                setActionsMenu(null);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {detailRow && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setDetailRow(null); setDetailData(null); }} />
          <div className="absolute right-0 top-0 h-full w-full max-w-3xl overflow-y-auto bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b bg-white px-6 py-4">
              <div>
                <div className="text-xs text-slate-500">Detalle de orden de pago</div>
                <h3 className="text-xl font-semibold text-slate-800">{activeDetail?.order_number || `OP ${activeDetail?.id}`}</h3>
                <div className="mt-1 text-sm text-slate-500">{activeDetail?.supplier_display || "Proveedor"} · {activeDetail?.operation_reference || "-"}</div>
              </div>
              <button className="rounded border px-3 py-2 text-sm" onClick={() => { setDetailRow(null); setDetailData(null); }}>Cerrar</button>
            </div>
            <div className="space-y-4 p-6">
              {detailLoading && <div className="rounded-lg border p-3 text-sm text-slate-500">Cargando detalle...</div>}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-xl border p-4">
                  <div className="text-xs text-slate-500">Monto</div>
                  <div className="mt-2 font-semibold">{activeDetail?.currency_code || "PYG"} {formatMoney(activeDetail?.amount, activeDetail?.currency_code)}</div>
                </div>
                <div className="rounded-xl border p-4">
                  <div className="text-xs text-slate-500">Pagado</div>
                  <div className="mt-2 font-semibold">{activeDetail?.currency_code || "PYG"} {formatMoney(activeDetail?.paid_amount, activeDetail?.currency_code)}</div>
                </div>
                <div className="rounded-xl border p-4">
                  <div className="text-xs text-slate-500">Saldo</div>
                  <div className="mt-2 font-semibold">{activeDetail?.currency_code || "PYG"} {formatMoney(activeDetail?.balance, activeDetail?.currency_code)}</div>
                </div>
              </div>
              <div className="rounded-2xl border p-4">
                <div className="mb-3 text-sm font-medium text-slate-800">Datos de autorizacion</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div><span className="text-slate-500">Estado:</span> <StatusBadge status={activeDetail?.status} /></div>
                  <div><span className="text-slate-500">Fecha pago:</span> <span className="font-medium">{activeDetail?.payment_date || "--"}</span></div>
                  <div><span className="text-slate-500">Programado:</span> <span className="font-medium">{activeDetail?.scheduled_payment_date || "--"}</span></div>
                  <div><span className="text-slate-500">Prioridad:</span> <span className="font-medium">{activeDetail?.priority || "normal"}</span></div>
                  <div><span className="text-slate-500">Vencimiento:</span> <span className="font-medium">{activeDetail?.due_date || "--"}</span></div>
                  <div><span className="text-slate-500">Metodo:</span> <span className="font-medium">{activeDetail?.payment_method || "--"}</span></div>
                  <div><span className="text-slate-500">Cuenta origen:</span> <span className="font-medium">{activeDetail?.planned_company_account || "--"}</span></div>
                  <div><span className="text-slate-500">Proveedor:</span> <span className="font-medium">{activeDetail?.supplier_display || "--"}</span></div>
                  <div><span className="text-slate-500">RUC:</span> <span className="font-medium">{activeDetail?.supplier_ruc_display || activeDetail?.supplier_ruc || "--"}</span></div>
                  <div><span className="text-slate-500">Cuenta proveedor:</span> <span className="font-medium">{supplierBankLabel(activeDetail) || "Sin cuenta bancaria"}</span></div>
                  <div><span className="text-slate-500">Cliente:</span> <span className="font-medium">{activeDetail?.client_name || "--"}</span></div>
                  {activeDetail?.cancel_reason && <div><span className="text-slate-500">Motivo anulacion:</span> <span className="font-medium text-red-700">{activeDetail.cancel_reason}</span></div>}
                </div>
              </div>
              <div className="rounded-2xl border p-4">
                <div className="mb-3 text-sm font-medium text-slate-800">Facturas incluidas</div>
                <div className="overflow-auto rounded-lg border">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-100 text-slate-600">
                      <tr>
                        <th className="text-left px-3 py-2">Factura</th>
                        <th className="text-left px-3 py-2">Monto</th>
                        <th className="text-left px-3 py-2">Vencimiento</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeDetailItems.map((invoice, idx) => (
                        <tr key={`${activeDetail?.id}-detail-inv-${idx}`} className="border-t">
                          <td className="px-3 py-2">{invoice.receipt_number || "-"}</td>
                          <td className="px-3 py-2">{invoice.currency_code || activeDetail?.currency_code || "PYG"} {formatMoney(invoice.order_amount ?? invoice.amount, invoice.currency_code || activeDetail?.currency_code)}</td>
                          <td className="px-3 py-2">{invoice.due_date || "--"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="rounded-2xl border p-4">
                <div className="mb-3 text-sm font-medium text-slate-800">Pagos registrados</div>
                {activeDetailPayments.length ? (
                  <div className="overflow-auto rounded-lg border">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-100 text-slate-600">
                        <tr>
                          <th className="text-left px-3 py-2">Fecha</th>
                          <th className="text-left px-3 py-2">Factura</th>
                          <th className="text-left px-3 py-2">Monto</th>
                          <th className="text-left px-3 py-2">Metodo</th>
                          <th className="text-left px-3 py-2">Cuenta</th>
                          <th className="text-left px-3 py-2">Referencia</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeDetailPayments.map((payment) => (
                          <tr key={payment.id} className="border-t">
                            <td className="px-3 py-2">{payment.payment_date || "--"}</td>
                            <td className="px-3 py-2">{payment.receipt_number || "--"}</td>
                            <td className="px-3 py-2">{payment.currency_code || activeDetail?.currency_code || "PYG"} {formatMoney(payment.amount, payment.currency_code || activeDetail?.currency_code)}</td>
                            <td className="px-3 py-2">{payment.method || "--"}</td>
                            <td className="px-3 py-2">{payment.account || "--"}</td>
                            <td className="px-3 py-2">{payment.reference_number || "--"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-sm text-slate-500">Sin pagos registrados.</div>
                )}
              </div>
              <div className="rounded-2xl border p-4">
                <div className="mb-3 text-sm font-medium text-slate-800">Historial</div>
                {activeDetailEvents.length ? (
                  <div className="space-y-2">
                    {activeDetailEvents.map((event) => (
                      <div key={event.id} className="rounded-lg border bg-slate-50 px-3 py-2 text-sm">
                        <div className="font-medium">{event.event_type} · {event.created_at}</div>
                        <div className="text-slate-600">{event.event_note || "--"}</div>
                        <div className="text-xs text-slate-500">{event.user_name || event.user_email || "Usuario no disponible"}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-slate-500">Sin eventos registrados.</div>
                )}
              </div>
              <div className="rounded-2xl border p-4">
                <div className="mb-3 text-sm font-medium text-slate-800">Acciones</div>
                <div className="flex flex-wrap gap-2">
                  <button className="rounded border px-3 py-2 text-sm hover:bg-slate-50" onClick={() => openPdf(activeDetail)}>Ver PDF</button>
                  <button className="rounded border px-3 py-2 text-sm hover:bg-slate-50" onClick={() => downloadPdf(activeDetail)}>Descargar PDF</button>
                  <button className="rounded border px-3 py-2 text-sm hover:bg-slate-50" onClick={() => openOperation(activeDetail)}>Ver operacion</button>
                  {String(activeDetail?.status || "").toLowerCase() === "pendiente" && (
                    <button className="rounded border px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50" onClick={() => { setApproveRow(activeDetail); setApproveNote(""); }}>Aprobar</button>
                  )}
                  <button className="rounded border px-3 py-2 text-sm text-blue-700 hover:bg-blue-50" onClick={() => openSchedule(activeDetail)}>Programar</button>
                  <button className="rounded border px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-60" disabled={!canRegisterPayment(activeDetail)} onClick={() => openPayment(activeDetail)}>
                    Registrar pago
                  </button>
                  {["pendiente", "aprobada"].includes(String(activeDetail?.status || "").toLowerCase()) && (
                    <button className="rounded border px-3 py-2 text-sm text-red-700 hover:bg-red-50" onClick={() => { setCancelRow(activeDetail); setCancelReason(""); }}>Anular</button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {approveRow && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Confirmar aprobacion</h3>
              <button className="text-sm underline" onClick={() => setApproveRow(null)}>Cerrar</button>
            </div>
            <div className="rounded-lg border bg-slate-50 p-3 text-sm">
              <div><span className="text-slate-500">OP:</span> <span className="font-medium">{approveRow.order_number || approveRow.id}</span></div>
              <div><span className="text-slate-500">Proveedor:</span> <span className="font-medium">{approveRow.supplier_display || "--"}</span></div>
              <div><span className="text-slate-500">Monto:</span> <span className="font-medium">{approveRow.currency_code || "PYG"} {formatMoney(approveRow.amount, approveRow.currency_code)}</span></div>
              <div><span className="text-slate-500">Facturas:</span> <span className="font-medium">{approveRow.invoice_count || parseOrderInvoices(approveRow).length}</span></div>
            </div>
            <textarea
              className="mt-3 w-full border rounded px-3 py-2 min-h-[84px]"
              placeholder="Nota de aprobacion opcional"
              value={approveNote}
              onChange={(e) => setApproveNote(e.target.value)}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button className="px-4 py-2 text-sm rounded border" onClick={() => setApproveRow(null)}>Cancelar</button>
              <button className="px-4 py-2 text-sm rounded bg-emerald-600 text-white" onClick={() => approveOrder(approveRow, approveNote)}>Aprobar OP</button>
            </div>
          </div>
        </div>
      )}

      {cancelRow && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Anular orden de pago</h3>
              <button className="text-sm underline" onClick={() => setCancelRow(null)}>Cerrar</button>
            </div>
            <div className="text-sm text-slate-600">
              {cancelRow.order_number || `OP ${cancelRow.id}`} · {cancelRow.supplier_display || "Proveedor"} · {cancelRow.currency_code || "PYG"} {formatMoney(cancelRow.amount, cancelRow.currency_code)}
            </div>
            <textarea
              className="mt-3 w-full border rounded px-3 py-2 min-h-[96px]"
              placeholder="Motivo de anulacion"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button className="px-4 py-2 text-sm rounded border" onClick={() => setCancelRow(null)}>Cancelar</button>
              <button className="px-4 py-2 text-sm rounded bg-red-600 text-white" onClick={cancelOrder}>Anular OP</button>
            </div>
          </div>
        </div>
      )}

      {scheduleRow && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Programar pago</h3>
              <button className="text-sm underline" onClick={() => setScheduleRow(null)}>Cerrar</button>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <input
                type="date"
                className="border rounded px-3 py-2"
                value={scheduleForm.scheduled_payment_date}
                onChange={(e) => setScheduleForm((f) => ({ ...f, scheduled_payment_date: e.target.value }))}
              />
              <select
                className="border rounded px-3 py-2"
                value={scheduleForm.priority}
                onChange={(e) => setScheduleForm((f) => ({ ...f, priority: e.target.value }))}
              >
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
                <option value="baja">Baja</option>
              </select>
              <select
                className="border rounded px-3 py-2"
                value={scheduleForm.planned_company_account}
                onChange={(e) => setScheduleForm((f) => ({ ...f, planned_company_account: e.target.value }))}
              >
                <option value="">Cuenta origen de empresa</option>
                {hasCurrentScheduleAccount && <option value={scheduleForm.planned_company_account}>{scheduleForm.planned_company_account}</option>}
                {scheduleAccountOptions.map((account) => (
                  <option key={account.id || companyBankAccountValue(account)} value={companyBankAccountValue(account)}>
                    {companyBankAccountLabel(account)}
                  </option>
                ))}
              </select>
              {!sameCurrencyScheduleAccounts.length && fallbackScheduleAccounts.length > 0 && (
                <div className="text-xs text-amber-700">No hay cuentas activas en {scheduleRow?.currency_code || "PYG"}. Se muestran cuentas de otras monedas.</div>
              )}
              <textarea
                className="border rounded px-3 py-2 min-h-[84px]"
                placeholder="Nota de programacion"
                value={scheduleForm.note}
                onChange={(e) => setScheduleForm((f) => ({ ...f, note: e.target.value }))}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="px-4 py-2 text-sm rounded border" onClick={() => setScheduleRow(null)}>Cancelar</button>
              <button className="px-4 py-2 text-sm rounded bg-black text-white" onClick={saveSchedule}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {paymentRow && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold">Registrar pago de OP</h3>
                <div className="text-xs text-slate-500">
                  {paymentRow.order_number || `OP ${paymentRow.id}`} · {paymentRow.supplier_display || "Proveedor"}
                </div>
              </div>
              <button className="text-sm underline" onClick={() => setPaymentRow(null)}>Cerrar</button>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <input type="date" className="border rounded px-2 py-1" value={paymentForm.payment_date}
                onChange={(e) => setPaymentForm((f) => ({ ...f, payment_date: e.target.value }))} />
              <div className="rounded-lg border">
                <div className="border-b bg-slate-50 px-3 py-2 text-sm font-medium">Distribucion por factura</div>
                <div className="divide-y">
                  {paymentAllocations.map((item, idx) => (
                    <div key={`${item.invoice_id}-${idx}`} className="grid grid-cols-1 gap-2 p-3 text-sm md:grid-cols-[1fr_140px]">
                      <div>
                        <div className="font-medium">{item.receipt_number || `Factura ${item.invoice_id}`}</div>
                        <div className="text-xs text-slate-500">
                          Saldo: {item.currency_code || paymentRow?.currency_code || "PYG"} {formatMoney(item.balance, item.currency_code || paymentRow?.currency_code)}
                        </div>
                      </div>
                      <input
                        className="border rounded px-2 py-1"
                        value={item.amount}
                        onChange={(e) =>
                          setPaymentAllocations((prev) =>
                            prev.map((row, rowIdx) => (rowIdx === idx ? { ...row, amount: e.target.value } : row))
                          )
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
              <select className="border rounded px-2 py-1" value={paymentForm.method}
                onChange={(e) => setPaymentForm((f) => ({ ...f, method: e.target.value }))}>
                <option value="">Metodo</option>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <div>
                <select className="border rounded px-2 py-1 w-full" value={paymentForm.account}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, account: e.target.value }))}>
                  <option value="">Cuenta origen de empresa</option>
                  {hasCurrentPaymentAccount && <option value={paymentForm.account}>{paymentForm.account}</option>}
                  {paymentAccountOptions.map((account) => (
                    <option key={account.id || companyBankAccountValue(account)} value={companyBankAccountValue(account)}>
                      {companyBankAccountLabel(account)}
                    </option>
                  ))}
                </select>
                {!sameCurrencyPaymentAccounts.length && fallbackPaymentAccounts.length > 0 && (
                  <div className="mt-1 text-xs text-amber-700">
                    No hay cuentas activas en {paymentRow?.currency_code || "PYG"}. Se muestran cuentas de otras monedas.
                  </div>
                )}
                {!paymentAccountOptions.length && (
                  <div className="mt-1 text-xs text-red-700">
                    No hay cuentas de empresa activas cargadas en Parametros del sistema.
                  </div>
                )}
              </div>
              <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Cuenta destino del proveedor</div>
                <div className="mt-1 text-slate-700">{supplierBankLabel(paymentRow) || "Proveedor sin cuenta bancaria cargada."}</div>
              </div>
              <input className="border rounded px-2 py-1" placeholder="Referencia" value={paymentForm.reference_number}
                onChange={(e) => setPaymentForm((f) => ({ ...f, reference_number: e.target.value }))} />
              <textarea className="border rounded px-2 py-1 min-h-[80px]" placeholder="Notas" value={paymentForm.notes}
                onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))} />
              <input type="file" className="border rounded px-2 py-1" onChange={(e) => setPaymentFile(e.target.files?.[0] || null)} />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="px-4 py-2 text-sm rounded border" onClick={() => setPaymentRow(null)}>Cancelar</button>
              <button className="px-4 py-2 text-sm rounded bg-black text-white" onClick={savePayment}>Guardar pago</button>
            </div>
          </div>
        </div>
      )}

      {exportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Exportar ordenes de pago</h3>
              <button className="text-sm underline" onClick={() => setExportOpen(false)}>
                Cerrar
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <input
                className="border rounded px-2 py-1"
                placeholder="Proveedor"
                value={exportFilters.supplier_q}
                onChange={(e) => setExportFilters((f) => ({ ...f, supplier_q: e.target.value }))}
              />
              <input
                className="border rounded px-2 py-1"
                placeholder="Operacion"
                value={exportFilters.operation_q}
                onChange={(e) => setExportFilters((f) => ({ ...f, operation_q: e.target.value }))}
              />
              <select
                className="border rounded px-2 py-1"
                value={exportFilters.status}
                onChange={(e) => setExportFilters((f) => ({ ...f, status: e.target.value }))}
              >
                <option value="">Estado</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="border rounded px-2 py-1"
                  type="date"
                  value={exportFilters.payment_from}
                  onChange={(e) => setExportFilters((f) => ({ ...f, payment_from: e.target.value }))}
                />
                <input
                  className="border rounded px-2 py-1"
                  type="date"
                  value={exportFilters.payment_to}
                  onChange={(e) => setExportFilters((f) => ({ ...f, payment_to: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="border rounded px-2 py-1"
                  type="date"
                  value={exportFilters.due_from}
                  onChange={(e) => setExportFilters((f) => ({ ...f, due_from: e.target.value }))}
                />
                <input
                  className="border rounded px-2 py-1"
                  type="date"
                  value={exportFilters.due_to}
                  onChange={(e) => setExportFilters((f) => ({ ...f, due_to: e.target.value }))}
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="px-4 py-2 text-sm rounded border" onClick={() => setExportOpen(false)}>
                Cancelar
              </button>
              <button className="px-4 py-2 text-sm rounded bg-black text-white" onClick={exportXlsx}>
                Descargar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
