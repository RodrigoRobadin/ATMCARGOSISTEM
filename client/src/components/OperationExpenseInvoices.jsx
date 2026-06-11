// client/src/components/OperationExpenseInvoices.jsx
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import {
  companyBankAccountLabel,
  companyBankAccountValue,
  filterCompanyBankAccounts,
  parseCompanyBankAccounts,
} from "../utils/companyBankAccounts";

const DEFAULT_BUYER = {
  name: "ATM CARGO SRL",
  ruc: "80056641-6",
};

const RECEIPT_TYPES = [
  "Factura",
  "Boleta",
  "Ticket",
  "Nota de Crédito",
  "Nota de Débito",
  "Autofactura",
  "Despacho de importación",
];

const CONDITIONS = ["CONTADO", "CREDITO"];
const PAYMENT_METHODS = ["Transferencia", "Efectivo", "Cheque", "Tarjeta", "Deposito", "Otro"];
const EXPENSE_RUBROS = [
  "FLETE",
  "SEGURO",
  "DESPACHO",
  "PRODUCTO",
  "ADICIONAL",
  "INSTALACION",
  "FINANCIACION",
];

function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatProviderLabel(p) {
  if (!p) return "";
  const name = p.razon_social || p.name || "";
  return p.ruc ? `${name} (${p.ruc})` : name;
}

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

function currencyDecimals(currencyCode = "PYG") {
  const code = String(currencyCode || "PYG").toUpperCase();
  return code === "PYG" || code === "GS" ? 0 : 2;
}

function splitCurrencyInput(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { empty: true, sign: "", integer: "0", fraction: "" };
  const cleaned = raw.replace(/[^\d,.-]/g, "");
  const sign = cleaned.startsWith("-") ? "-" : "";
  const unsigned = cleaned.replace(/-/g, "");
  if (!/\d/.test(unsigned)) return { empty: true, sign: "", integer: "0", fraction: "" };
  const lastComma = unsigned.lastIndexOf(",");
  const lastDot = unsigned.lastIndexOf(".");
  let decimalSep = "";
  if (lastComma > -1 && lastDot > -1) {
    decimalSep = lastComma > lastDot ? "," : ".";
  } else if (lastComma > -1) {
    decimalSep = ",";
  } else if (lastDot > -1) {
    const dotCount = (unsigned.match(/\./g) || []).length;
    const digitsAfter = unsigned.length - lastDot - 1;
    decimalSep = dotCount === 1 && digitsAfter !== 3 ? "." : "";
  }

  let integerPart = unsigned;
  let fractionPart = "";
  if (decimalSep) {
    const idx = unsigned.lastIndexOf(decimalSep);
    integerPart = unsigned.slice(0, idx);
    fractionPart = unsigned.slice(idx + 1).replace(/\D/g, "");
  }
  const integerDigits = integerPart.replace(/\D/g, "").replace(/^0+(?=\d)/, "") || "0";
  return { empty: false, sign, integer: integerDigits, fraction: fractionPart };
}

function parseCurrencyInput(value) {
  const parts = splitCurrencyInput(value);
  if (parts.empty) return 0;
  const normalized = `${parts.sign}${parts.integer}${parts.fraction ? `.${parts.fraction}` : ""}`;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function groupThousands(value) {
  return String(value || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function formatCurrencyInput(value, currencyCode = "PYG") {
  const parts = splitCurrencyInput(value);
  if (parts.empty) return "";
  const decimals = currencyDecimals(currencyCode);
  const integer = `${parts.sign}${groupThousands(parts.integer)}`;
  if (decimals <= 0) return integer;
  const fraction = String(parts.fraction || "").slice(0, decimals).padEnd(decimals, "0");
  return `${integer},${fraction}`;
}

function formatCurrencyDisplay(value, currencyCode = "PYG") {
  const decimals = currencyDecimals(currencyCode);
  const parts = splitCurrencyInput(value);
  if (parts.empty) return decimals ? "0,00" : "0";
  const integer = `${parts.sign}${groupThousands(parts.integer)}`;
  if (decimals <= 0) return integer;
  const fraction = String(parts.fraction || "").slice(0, decimals).padEnd(decimals, "0");
  return `${integer},${fraction}`;
}

function calcItemSubtotal(it) {
  const qty = parseCurrencyInput(it.quantity || 0) || 0;
  const unit = parseCurrencyInput(it.unit_price || 0) || 0;
  return Number((qty * unit).toFixed(2));
}

export default function OperationExpenseInvoices({
  operationId,
  operationType = "deal",
  showList = false,
  openNewKey = 0,
  costSheetVersionNumber,
  quoteRevisionId,
  title = "Gastos por operacion",
  subtitle = "Facturas de compra vinculadas a esta operacion.",
  showExpenseControl = false,
  showInvoiceTable = true,
  showCreateButton = true,
}) {
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState([]);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");

  const [buyerDefaults, setBuyerDefaults] = useState(DEFAULT_BUYER);

  const [providerQuery, setProviderQuery] = useState("");
  const [providerOptions, setProviderOptions] = useState([]);
  const [providerLoading, setProviderLoading] = useState(false);

  const [editingInvoice, setEditingInvoice] = useState(null);
  const [form, setForm] = useState({});
  const [entryMode, setEntryMode] = useState("resumen"); // resumen | detalle
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [invoiceFile, setInvoiceFile] = useState(null);
  const [expenseControl, setExpenseControl] = useState(null);
  const [expenseControlLoading, setExpenseControlLoading] = useState(false);
  const [expenseControlReady, setExpenseControlReady] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [companyAccounts, setCompanyAccounts] = useState([]);
  const [paymentOrderInvoice, setPaymentOrderInvoice] = useState(null);
  const [paymentInvoice, setPaymentInvoice] = useState(null);
  const [paymentsInvoice, setPaymentsInvoice] = useState(null);
  const [actionsMenu, setActionsMenu] = useState(null);
  const exchangeRateStorageKey = operationId
    ? `operation-expense-control-tc:${operationType}:${Number(operationId)}`
    : "";
  const [manualExchangeRate, setManualExchangeRate] = useState(() => {
    try {
      if (!operationId) return "";
      return window.localStorage.getItem(`operation-expense-control-tc:${operationType}:${Number(operationId)}`) || "";
    } catch (_) {
      return "";
    }
  });

  const totalByCurrency = useMemo(() => {
    const sums = {};
    for (const inv of invoices) {
      const curr = (inv.currency_code || "PYG").toUpperCase();
      const val = Number(inv.amount_total || 0);
      sums[curr] = (sums[curr] || 0) + (isNaN(val) ? 0 : val);
    }
    return sums;
  }, [invoices]);

  const itemsTotals = useMemo(() => {
    if (entryMode !== "detalle") return { total: 0, g10: 0, g5: 0, ex: 0 };
    let total = 0;
    let g10 = 0;
    let g5 = 0;
    let ex = 0;
    for (const it of items) {
      const subtotal = calcItemSubtotal(it);
      total += subtotal;
      if (Number(it.tax_rate) === 5) g5 += subtotal;
      else if (Number(it.tax_rate) === 0) ex += subtotal;
      else g10 += subtotal;
    }
      return {
        total: Number(total.toFixed(2)),
      g10: Number(g10.toFixed(2)),
      g5: Number(g5.toFixed(2)),
      ex: Number(ex.toFixed(2)),
    };
  }, [items, entryMode]);

  const totalNum = useMemo(() => {
    if (entryMode === "detalle") return itemsTotals.total || 0;
    return parseCurrencyInput(form.amount_total || "");
  }, [form.amount_total, entryMode, itemsTotals.total]);

  const computedTax = useMemo(() => {
    const mode = entryMode === "detalle"
      ? (itemsTotals.g10 && itemsTotals.g5 ? "mixto" : itemsTotals.g10 ? "solo10" : "solo5")
      : String(form.tax_mode || "").toLowerCase();
    const g10 = entryMode === "detalle" ? itemsTotals.g10 : parseCurrencyInput(form.gravado_10 || "");
    const g5 = entryMode === "detalle" ? itemsTotals.g5 : parseCurrencyInput(form.gravado_5 || "");
    let iva10 = 0;
    let iva5 = 0;
    if (mode === "solo10") {
      iva10 = totalNum / 11;
    } else if (mode === "solo5") {
      iva5 = totalNum / 21;
    } else if (mode === "mixto") {
      iva10 = g10 ? g10 / 11 : 0;
      iva5 = g5 ? g5 / 21 : 0;
    }
    return {
      iva10: Number(iva10.toFixed(2)),
      iva5: Number(iva5.toFixed(2)),
    };
  }, [form.tax_mode, form.gravado_10, form.gravado_5, totalNum]);

  async function loadInvoices() {
    if (!operationId) return;
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get(`/operations/${operationId}/expense-invoices`, {
        params: { op_type: operationType },
      });
      const baseRows = Array.isArray(data) ? data : [];
      const enrichedRows = await Promise.all(
        baseRows.map(async (row) => {
          const [{ data: orders }, { data: payments }] = await Promise.all([
            api
              .get(`/operations/${operationId}/expense-invoices/${row.id}/payment-orders`, {
                params: { operation_type: operationType },
              })
              .catch(() => ({ data: [] })),
            api
              .get(`/operations/${operationId}/expense-invoices/${row.id}/payments`, {
                params: { op_type: operationType },
              })
              .catch(() => ({ data: [] })),
          ]);
          return {
            ...row,
            payment_orders: Array.isArray(orders) ? orders : [],
            payments: Array.isArray(payments) ? payments : [],
          };
        })
      );
      setInvoices(enrichedRows);
    } catch (e) {
      console.error("Error loading operation expenses", e);
      setError("No se pudo cargar los gastos de la operación.");
    } finally {
      setLoading(false);
    }
  }

  async function loadExpenseControl() {
    if (!operationId) return;
    setExpenseControlLoading(true);
    setExpenseControlReady(false);
    try {
      const params = {
        op_type: operationType,
        cost_sheet_version_number: costSheetVersionNumber || undefined,
        quote_revision_id: quoteRevisionId || undefined,
      };
      const { data } = await api.get(`/operations/${operationId}/expense-control`, { params });
      setExpenseControl(data || null);
      if (data?.exchange_rate != null && data.exchange_rate !== "") {
        setManualExchangeRate(String(data.exchange_rate));
      }
    } catch (e) {
      console.error("Error loading expense control", e);
      setExpenseControl(null);
    } finally {
      setExpenseControlLoading(false);
      setExpenseControlReady(true);
    }
  }

  useEffect(() => {
    if (!operationId) return;
    if (showList) loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationId, operationType, showList]);

  useEffect(() => {
    if (!showList || !showExpenseControl) return;
    loadExpenseControl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showList, showExpenseControl, operationId, operationType, costSheetVersionNumber, quoteRevisionId]);

  useEffect(() => {
    try {
      if (!exchangeRateStorageKey) return;
      setManualExchangeRate(window.localStorage.getItem(exchangeRateStorageKey) || "");
    } catch (_) {
      setManualExchangeRate("");
    }
  }, [exchangeRateStorageKey]);

  useEffect(() => {
    try {
      if (!exchangeRateStorageKey) return;
      if (manualExchangeRate) window.localStorage.setItem(exchangeRateStorageKey, manualExchangeRate);
      else window.localStorage.removeItem(exchangeRateStorageKey);
    } catch (_) {}
  }, [exchangeRateStorageKey, manualExchangeRate]);

  useEffect(() => {
    if (!operationId || !showList || !showExpenseControl || !expenseControlReady) return;
    const rate = manualExchangeRate === "" ? null : Number(manualExchangeRate || 0);
    if (rate != null && (!Number.isFinite(rate) || rate < 0)) return;
    const timer = setTimeout(() => {
      api
        .put(`/operations/${operationId}/expense-control-settings`, {
          op_type: operationType,
          exchange_rate: manualExchangeRate === "" ? null : rate,
        })
        .catch((err) => console.warn("No se pudo guardar TC de control", err?.message));
    }, 500);
    return () => clearTimeout(timer);
  }, [manualExchangeRate, operationId, operationType, showList, showExpenseControl, expenseControlReady]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await api.get("/params", {
          params: { keys: "buyer_name_default,buyer_ruc_default" },
        });
        if (!active) return;
        const name = data?.buyer_name_default?.[0]?.value;
        const ruc = data?.buyer_ruc_default?.[0]?.value;
        setBuyerDefaults({
          name: name || DEFAULT_BUYER.name,
          ruc: ruc || DEFAULT_BUYER.ruc,
        });
      } catch {
        if (active) setBuyerDefaults(DEFAULT_BUYER);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    api
      .get("/params", { params: { keys: "company_bank_account", only_active: 1 } })
      .then(({ data }) => {
        if (!active) return;
        setCompanyAccounts(parseCompanyBankAccounts(data?.company_bank_account || []));
      })
      .catch(() => {
        if (active) setCompanyAccounts([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!providerQuery.trim()) {
      setProviderOptions([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      try {
        setProviderLoading(true);
        const { data } = await api.get("/admin-expenses/providers/search", {
          params: { q: providerQuery.trim() },
        });
        if (!active) return;
        setProviderOptions(Array.isArray(data) ? data : []);
      } catch (e) {
        if (active) console.error("Error searching providers", e);
      } finally {
        if (active) setProviderLoading(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [providerQuery]);

  function resetForm() {
    setForm({
      invoice_date: today(),
      receipt_type: "Factura",
      receipt_number: "",
      timbrado_number: "",
      expense_rubro: "SIN CLASIFICAR",
      expense_concept: "",
      tax_mode: "solo10",
      gravado_10: "",
      gravado_5: "",
      condition_type: "CONTADO",
      due_date: "",
      currency_code: "PYG",
      exchange_rate: "",
      amount_total: "",
      iva_10: "",
      iva_5: "",
      iva_exempt: "",
      iva_no_taxed: "",
      supplier_id: "",
      supplier_name: "",
      supplier_ruc: "",
      buyer_name: buyerDefaults.name,
      buyer_ruc: buyerDefaults.ruc,
      notes: "",
    });
    setProviderQuery("");
    setProviderOptions([]);
    setInvoiceFile(null);
    setEditingInvoice(null);
    setFormError("");
    setEntryMode("resumen");
    setItems([]);
  }

  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (!openNewKey) return;
    resetForm();
    setModalOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNewKey]);

  useEffect(() => {
    setForm((f) => ({
      ...f,
      iva_10: computedTax.iva10,
      iva_5: computedTax.iva5,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedTax.iva10, computedTax.iva5]);

  async function openEdit(inv) {
    setEditingInvoice(inv);
    setForm({
      invoice_date: inv.invoice_date || today(),
      receipt_type: inv.receipt_type || "Factura",
      receipt_number: inv.receipt_number || "",
      timbrado_number: inv.timbrado_number || "",
      expense_rubro: inv.expense_rubro || "SIN CLASIFICAR",
      expense_concept: inv.expense_concept || "",
      tax_mode: inv.tax_mode || "solo10",
      gravado_10: formatCurrencyInput(inv.gravado_10 || "", inv.currency_code || "PYG"),
      gravado_5: formatCurrencyInput(inv.gravado_5 || "", inv.currency_code || "PYG"),
      condition_type: inv.condition_type || "CONTADO",
      due_date: inv.due_date || "",
      currency_code: inv.currency_code || "PYG",
      exchange_rate: inv.exchange_rate || "",
      amount_total: formatCurrencyInput(inv.amount_total || "", inv.currency_code || "PYG"),
      iva_10: inv.iva_10 || "",
      iva_5: inv.iva_5 || "",
      iva_exempt: formatCurrencyInput(inv.iva_exempt || "", inv.currency_code || "PYG"),
      iva_no_taxed: formatCurrencyInput(inv.iva_no_taxed || "", inv.currency_code || "PYG"),
      supplier_id: inv.supplier_id || "",
      supplier_name: inv.supplier_name || inv.supplier_org_name || "",
      supplier_ruc: inv.supplier_ruc || inv.supplier_org_ruc || "",
      buyer_name: inv.buyer_name || buyerDefaults.name,
      buyer_ruc: inv.buyer_ruc || buyerDefaults.ruc,
      notes: inv.notes || "",
    });
    const label = formatProviderLabel({
      razon_social: inv.supplier_name || inv.supplier_org_name,
      name: inv.supplier_name || inv.supplier_org_name,
      ruc: inv.supplier_ruc || inv.supplier_org_ruc,
    });
    setProviderQuery(label || inv.supplier_name || "");
    setProviderOptions([]);
    setInvoiceFile(null);
    if (Number(inv.item_count || 0) > 0) {
      try {
        const { data } = await api.get(
          `/operations/${operationId}/expense-invoices/${inv.id}/items`,
          { params: { op_type: operationType } }
        );
        setItems(
          Array.isArray(data)
            ? data.map((it) => ({
                ...it,
                expense_rubro: it.expense_rubro || "SIN CLASIFICAR",
                unit_price: formatCurrencyInput(it.unit_price || "", inv.currency_code || "PYG"),
              }))
            : []
        );
        setEntryMode("detalle");
      } catch (e) {
        console.error("Error loading items", e);
        setItems([]);
        setEntryMode("resumen");
      }
    } else {
      setItems([]);
      setEntryMode("resumen");
    }
    setModalOpen(true);
  }

  async function ensureProviderId() {
    const supplierId = form.supplier_id ? Number(form.supplier_id) : null;
    if (supplierId) return supplierId;
    const name = String(form.supplier_name || "").trim();
    if (!name) return null;
    try {
      const { data } = await api.post("/admin-expenses/providers", {
        name,
        ruc: String(form.supplier_ruc || "").trim() || null,
      });
      return data?.id || null;
    } catch (e) {
      console.error("Error creating provider", e);
      return null;
    }
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        description: "",
        expense_rubro: "SIN CLASIFICAR",
        quantity: 1,
        unit_price: "",
        tax_rate: 10,
      },
    ]);
  }

  async function handleExportExpenseControlExcel() {
    if (!operationId) return;
    setExportingExcel(true);
    try {
      const params = {
        op_type: operationType,
        cost_sheet_version_number: costSheetVersionNumber || undefined,
        quote_revision_id: quoteRevisionId || undefined,
      };
      const res = await api.get(`/operations/${operationId}/expense-control/export-xlsx`, {
        params,
        responseType: "blob",
      });
      const blob = new Blob([res.data], {
        type:
          res.headers?.["content-type"] ||
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      const disposition = res.headers?.["content-disposition"] || "";
      const match = disposition.match(/filename="?([^";]+)"?/i);
      a.href = url;
      a.download = match?.[1] || `costos-finales-op-${operationId}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Error exporting expense control", e);
      alert(e?.response?.data?.error || "No se pudo exportar el Excel de costos finales.");
    } finally {
      setExportingExcel(false);
    }
  }

  async function handleExportExpenseControlPdf() {
    if (!operationId) return;
    setExportingPdf(true);
    try {
      const params = {
        op_type: operationType,
        cost_sheet_version_number: costSheetVersionNumber || undefined,
        quote_revision_id: quoteRevisionId || undefined,
      };
      const res = await api.get(`/operations/${operationId}/expense-control/export-pdf`, {
        params,
        responseType: "blob",
      });
      const blob = new Blob([res.data], {
        type: res.headers?.["content-type"] || "application/pdf",
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      const disposition = res.headers?.["content-disposition"] || "";
      const match = disposition.match(/filename="?([^";]+)"?/i);
      a.href = url;
      a.download = match?.[1] || `costos-finales-op-${operationId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Error exporting expense control PDF", e);
      alert(e?.response?.data?.error || "No se pudo exportar el PDF de costos finales.");
    } finally {
      setExportingPdf(false);
    }
  }

  function openNewWithDefaults(defaults = {}) {
    resetForm();
    setForm((f) => ({ ...f, ...defaults }));
    setModalOpen(true);
  }

  function updateItem(idx, key, value) {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: value };
      return next;
    });
  }

  function removeItem(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (!operationId) return;
    setFormError("");
    if (!form.invoice_date) {
      setFormError("La fecha de emisión es obligatoria.");
      return;
    }
    if (!form.supplier_id && !String(form.supplier_name || "").trim()) {
      setFormError("El proveedor es obligatorio.");
      return;
    }
    const totalForValidation = totalNum;
    if (!totalForValidation || totalForValidation <= 0) {
      setFormError("El total del comprobante es obligatorio.");
      return;
    }
    if (form.currency_code && form.currency_code !== "PYG" && !form.exchange_rate) {
      setFormError("El tipo de cambio es obligatorio para moneda extranjera.");
      return;
    }
    if (
      String(form.condition_type || "").toUpperCase() === "CREDITO" &&
      !form.due_date
    ) {
      setFormError("La fecha de vencimiento es obligatoria para crédito.");
      return;
    }
    if (entryMode === "detalle" && items.length === 0) {
      setFormError("Agregá al menos un ítem.");
      return;
    }
    if (entryMode !== "detalle" && !form.tax_mode) {
      setFormError("Seleccioná el tipo de IVA.");
      return;
    }
    if (entryMode !== "detalle" && form.tax_mode === "mixto") {
      const g10 = parseCurrencyInput(form.gravado_10 || "");
      const g5 = parseCurrencyInput(form.gravado_5 || "");
      if (!g10 && !g5) {
        setFormError("En IVA mixto, cargá gravado 10% o 5%.");
        return;
      }
      const vex = parseCurrencyInput(form.iva_exempt || "");
      const vnt = parseCurrencyInput(form.iva_no_taxed || "");
      const sum = g10 + g5 + vex + vnt;
      if (sum > totalForValidation + 0.01) {
        setFormError("La suma de gravados/exentos supera el total.");
        return;
      }
    } else if (entryMode !== "detalle") {
      const vex = parseCurrencyInput(form.iva_exempt || "");
      const vnt = parseCurrencyInput(form.iva_no_taxed || "");
      if (vex > 0 || vnt > 0) {
        setFormError("Si hay exento/no gravado, usá IVA mixto.");
        return;
      }
    }
    setSaving(true);
    try {
      const supplier_id = await ensureProviderId();
      if (!supplier_id && !String(form.supplier_name || "").trim()) {
        setFormError("No se pudo resolver el proveedor.");
        setSaving(false);
        return;
      }
      const amount_total =
        entryMode === "detalle"
          ? itemsTotals.total || 0
          : form.amount_total !== "" && form.amount_total !== null
          ? parseCurrencyInput(form.amount_total)
          : totalNum || 0;

      const payload = {
        invoice_date: form.invoice_date || null,
        receipt_type: form.receipt_type || null,
        receipt_number: form.receipt_number || null,
        timbrado_number: form.timbrado_number || null,
        expense_rubro: entryMode === "detalle" ? null : form.expense_rubro || "SIN CLASIFICAR",
        expense_concept: form.expense_concept || null,
        tax_mode: entryMode === "detalle" ? null : form.tax_mode || null,
        gravado_10:
          entryMode === "detalle"
            ? null
            : form.tax_mode === "mixto"
            ? parseCurrencyInput(form.gravado_10) || null
            : null,
        gravado_5:
          entryMode === "detalle"
            ? null
            : form.tax_mode === "mixto"
            ? parseCurrencyInput(form.gravado_5) || null
            : null,
        condition_type: form.condition_type || null,
        due_date:
          String(form.condition_type || "").toUpperCase() === "CREDITO"
            ? form.due_date || null
            : null,
        currency_code: form.currency_code || "PYG",
        exchange_rate:
          form.currency_code && form.currency_code !== "PYG"
            ? form.exchange_rate || null
            : null,
        amount_total: amount_total || null,
        iva_10: computedTax.iva10 || 0,
        iva_5: computedTax.iva5 || 0,
        iva_exempt:
          entryMode === "detalle" ? itemsTotals.ex || 0 : parseCurrencyInput(form.iva_exempt) || null,
        iva_no_taxed: parseCurrencyInput(form.iva_no_taxed) || null,
        supplier_id,
        supplier_name: form.supplier_name || null,
        supplier_ruc: form.supplier_ruc || null,
        buyer_name: form.buyer_name || null,
        buyer_ruc: form.buyer_ruc || null,
        notes: form.notes || null,
        items: entryMode === "detalle" ? items : undefined,
      };

      let invoiceId = editingInvoice?.id;
      if (editingInvoice?.id) {
        await api.patch(
          `/operations/${operationId}/expense-invoices/${editingInvoice.id}`,
          payload,
          { params: { op_type: operationType } }
        );
      } else {
        const { data } = await api.post(
          `/operations/${operationId}/expense-invoices`,
          { ...payload, operation_type: operationType }
        );
        invoiceId = data?.id;
      }

      if (invoiceFile && invoiceId) {
        const fd = new FormData();
        fd.append("file", invoiceFile);
        await api.post(
          `/operations/${operationId}/expense-invoices/${invoiceId}/attachments`,
          fd,
          {
            params: { op_type: operationType },
            headers: { "Content-Type": "multipart/form-data" },
          }
        );
      }

      await loadInvoices();
      if (showExpenseControl) await loadExpenseControl();
      setModalOpen(false);
    } catch (e) {
      console.error("Error saving operation expense", e);
      alert(e?.response?.data?.error || "No se pudo guardar la factura.");
    } finally {
      setSaving(false);
    }
  }

  async function handleViewAttachment(invoiceId) {
    try {
      const { data } = await api.get(
        `/operations/${operationId}/expense-invoices/${invoiceId}/attachments`,
        { params: { op_type: operationType } }
      );
      if (!Array.isArray(data) || !data.length) {
        alert("Sin comprobante adjunto.");
        return;
      }
      const fileUrl = data[0].file_url;
      const url = resolveUploadUrl(fileUrl);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      console.error("Error loading attachment", e);
      alert("No se pudo abrir el comprobante.");
    }
  }

  async function handleDeleteInvoice(inv) {
    if (!inv?.id) return;
    const label = [
      inv.receipt_type || "Factura",
      inv.receipt_number || "",
      inv.supplier_org_name || inv.supplier_name || "",
    ]
      .filter(Boolean)
      .join(" - ");
    const ok = window.confirm(
      `Eliminar factura de compra${label ? `: ${label}` : ""}?\n\nEsta accion no se puede deshacer.`
    );
    if (!ok) return;
    try {
      await api.delete(`/operations/${operationId}/expense-invoices/${inv.id}`, {
        params: { op_type: operationType },
      });
      await loadInvoices();
      if (showExpenseControl) await loadExpenseControl();
    } catch (e) {
      console.error("Error deleting operation expense", e);
      alert(e?.response?.data?.error || "No se pudo eliminar la factura de compra.");
    }
  }

  function latestOrder(inv) {
    const orders = Array.isArray(inv?.payment_orders) ? inv.payment_orders : [];
    return orders[0] || null;
  }

  function orderStatusLabel(inv) {
    const order = latestOrder(inv);
    if (!order) return "Sin OP";
    return `OP ${order.status || "pendiente"}`;
  }

  function canRequestOrder(inv) {
    if (String(inv?.condition_type || "").toUpperCase() !== "CREDITO") return false;
    if (Number(inv?.balance ?? inv?.amount_total ?? 0) <= 0.009) return false;
    const order = latestOrder(inv);
    return !order || String(order.status || "").toLowerCase() === "anulada";
  }

  function canRegisterPayment(inv) {
    if (Number(inv?.balance ?? inv?.amount_total ?? 0) <= 0.009) return false;
    if (String(inv?.condition_type || "").toUpperCase() !== "CREDITO") return true;
    const status = String(latestOrder(inv)?.status || "").toLowerCase();
    return ["aprobada", "pago_parcial"].includes(status);
  }

  return (
    <>
      {showList && (
        <div className="bg-white rounded-2xl shadow p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-medium">{title}</h3>
              <div className="text-xs text-slate-500">
                {subtitle}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {showExpenseControl && (
                <>
                  <button
                    type="button"
                    className="px-3 py-2 text-sm rounded-lg bg-black text-white disabled:opacity-60"
                    onClick={handleExportExpenseControlPdf}
                    disabled={exportingPdf}
                  >
                    {exportingPdf ? "Exportando..." : "Exportar PDF"}
                  </button>
                  <button
                    type="button"
                    className="px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-60"
                    onClick={handleExportExpenseControlExcel}
                    disabled={exportingExcel}
                  >
                    {exportingExcel ? "Exportando..." : "Exportar Excel"}
                  </button>
                </>
              )}
              {showCreateButton && (
                <button
                  type="button"
                  className="px-3 py-2 text-sm rounded-lg bg-black text-white"
                  onClick={() => openNewWithDefaults()}
                >
                  + Factura de compra
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="text-sm text-slate-500">Cargando...</div>
          ) : error ? (
            <div className="text-sm text-red-600">{error}</div>
          ) : (
            <>
              {showExpenseControl && (
              <ExpenseControlPanel
                data={expenseControl}
                loading={expenseControlLoading}
                manualExchangeRate={manualExchangeRate}
                onManualExchangeRateChange={setManualExchangeRate}
                onCreateInvoice={openNewWithDefaults}
              />
              )}
              {showInvoiceTable && (
                <>
              <div className="text-xs text-slate-500 mb-2">
                Totales:{" "}
                {Object.keys(totalByCurrency).length
                  ? Object.entries(totalByCurrency)
                      .map(([k, v]) => `${k} ${formatCurrencyDisplay(v, k)}`)
                      .join(" · ")
                  : "—"}
              </div>
              <div className="overflow-auto border rounded-lg">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-100 text-slate-600">
                    <tr>
                      <th className="text-left px-3 py-2">Fecha</th>
                      <th className="text-left px-3 py-2">Proveedor</th>
                      <th className="text-left px-3 py-2">Comprobante</th>
                      <th className="text-left px-3 py-2">Item compra</th>
                      <th className="text-left px-3 py-2">Concepto</th>
                      <th className="text-left px-3 py-2">Total</th>
                      <th className="text-left px-3 py-2">Pago</th>
                      <th className="text-left px-3 py-2">IVA</th>
                      <th className="text-left px-3 py-2">Adjuntos</th>
                      <th className="text-left px-3 py-2">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => (
                      <tr key={inv.id} className="border-t">
                        <td className="px-3 py-2">{inv.invoice_date || "—"}</td>
                        <td className="px-3 py-2">
                          <div>{inv.supplier_org_name || inv.supplier_name || "—"}</div>
                        </td>
                        <td className="px-3 py-2">
                          {(inv.receipt_type || "—") +
                            (inv.receipt_number ? ` · ${inv.receipt_number}` : "")}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {inv.expense_rubros || "SIN CLASIFICAR"}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {inv.expense_concept || "—"}
                        </td>
                        <td className="px-3 py-2">
                          {inv.currency_code || "PYG"} {formatCurrencyDisplay(inv.amount_total || 0, inv.currency_code || "PYG")}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <div className="font-medium">{orderStatusLabel(inv)}</div>
                          <div className="text-slate-500">
                            Saldo {inv.currency_code || "PYG"} {formatCurrencyDisplay(inv.balance ?? inv.amount_total ?? 0, inv.currency_code || "PYG")}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          10%: {inv.iva_10 || 0} · 5%: {inv.iva_5 || 0} · Ex:{" "}
                          {inv.iva_exempt || 0}
                        </td>
                        <td className="px-3 py-2">
                          {Number(inv.attachment_count || 0) > 0 ? (
                            <button
                              className="text-blue-600 underline"
                              onClick={() => handleViewAttachment(inv.id)}
                            >
                              Ver adjunto
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="inline-block text-left">
                            <button
                              type="button"
                              className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
                              onClick={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                const menuWidth = 176;
                                const menuHeight = 160;
                                const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
                                const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
                                const fitsBelow = rect.bottom + 6 + menuHeight <= viewportHeight - 8;
                                const top = fitsBelow
                                  ? rect.bottom + 6
                                  : Math.max(8, rect.top - menuHeight - 6);
                                const preferredLeft = rect.right + 6 + menuWidth <= viewportWidth - 8
                                  ? rect.right + 6
                                  : rect.right - menuWidth;
                                const left = Math.max(8, Math.min(preferredLeft, viewportWidth - menuWidth - 8));
                                setActionsMenu((cur) =>
                                  cur?.id === inv.id
                                    ? null
                                    : {
                                        id: inv.id,
                                        invoice: inv,
                                        top,
                                        left,
                                      }
                                );
                              }}
                            >
                              Acciones
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {invoices.length === 0 && (
                      <tr>
                        <td colSpan={10} className="px-3 py-4 text-center text-slate-500">
                          Sin facturas cargadas.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-auto p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">
                {editingInvoice ? "Editar factura de compra" : "Nueva factura de compra"}
              </h3>
              <button
                className="text-sm underline"
                onClick={() => setModalOpen(false)}
              >
                Cerrar
              </button>
            </div>
            <div className="mb-3 inline-flex rounded-lg border overflow-hidden">
              <button
                className={`px-3 py-1.5 text-sm ${entryMode === "resumen" ? "bg-slate-900 text-white" : "bg-white"}`}
                onClick={() => {
                  setEntryMode("resumen");
                  setItems([]);
                }}
              >
                Resumen
              </button>
              <button
                className={`px-3 py-1.5 text-sm ${entryMode === "detalle" ? "bg-slate-900 text-white" : "bg-white"}`}
                onClick={() => setEntryMode("detalle")}
              >
                Detalle por ítems
              </button>
            </div>
            {formError && (
              <div className="mb-3 text-sm text-red-600">{formError}</div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500">Tipo comprobante</label>
                <select
                  className="border rounded px-2 py-1 w-full"
                  value={form.receipt_type || ""}
                  onChange={(e) => setForm((f) => ({ ...f, receipt_type: e.target.value }))}
                >
                  {RECEIPT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500">Fecha emisión</label>
                <input
                  type="date"
                  className="border rounded px-2 py-1 w-full"
                  value={form.invoice_date || ""}
                  onChange={(e) => setForm((f) => ({ ...f, invoice_date: e.target.value }))}
                />
              </div>
              <input
                className="border rounded px-2 py-1"
                placeholder="Timbrado"
                value={form.timbrado_number || ""}
                onChange={(e) => setForm((f) => ({ ...f, timbrado_number: e.target.value }))}
              />
              <input
                className="border rounded px-2 py-1"
                placeholder="N° comprobante"
                value={form.receipt_number || ""}
                onChange={(e) => setForm((f) => ({ ...f, receipt_number: e.target.value }))}
              />
              <div>
                <label className="text-xs text-slate-500">Condición</label>
                <select
                  className="border rounded px-2 py-1 w-full"
                  value={form.condition_type || "CONTADO"}
                  onChange={(e) => setForm((f) => ({ ...f, condition_type: e.target.value }))}
                >
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              {String(form.condition_type || "").toUpperCase() === "CREDITO" && (
                <div>
                  <label className="text-xs text-slate-500">Vencimiento</label>
                  <input
                    type="date"
                    className="border rounded px-2 py-1 w-full"
                    value={form.due_date || ""}
                    onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                  />
                </div>
              )}
              <div>
                <label className="text-xs text-slate-500">Moneda</label>
                <select
                  className="border rounded px-2 py-1 w-full"
                  value={form.currency_code || "PYG"}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      currency_code: e.target.value,
                      amount_total: formatCurrencyInput(f.amount_total, e.target.value),
                      gravado_10: formatCurrencyInput(f.gravado_10, e.target.value),
                      gravado_5: formatCurrencyInput(f.gravado_5, e.target.value),
                      iva_exempt: formatCurrencyInput(f.iva_exempt, e.target.value),
                      iva_no_taxed: formatCurrencyInput(f.iva_no_taxed, e.target.value),
                    }))
                  }
                >
                  <option value="PYG">PYG</option>
                  <option value="USD">USD</option>
                  <option value="BRL">BRL/BRS</option>
                  <option value="ARS">ARS</option>
                </select>
              </div>
              {form.currency_code && form.currency_code !== "PYG" && (
                <input
                  className="border rounded px-2 py-1"
                  placeholder="Tipo de cambio"
                  value={form.exchange_rate || ""}
                  onChange={(e) => setForm((f) => ({ ...f, exchange_rate: e.target.value }))}
                />
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Proveedor (buscar)</label>
                <input
                  className="border rounded px-2 py-1 w-full"
                  placeholder="Nombre o RUC del proveedor"
                  value={providerQuery}
                  onChange={(e) => {
                    const val = e.target.value;
                    setProviderQuery(val);
                    setForm((f) => ({
                      ...f,
                      supplier_id: "",
                      supplier_name: val,
                    }));
                  }}
                />
                {providerLoading && (
                  <div className="text-xs text-slate-400">Buscando...</div>
                )}
                {providerOptions.length > 0 && (
                  <div className="border rounded bg-white max-h-40 overflow-auto">
                    {providerOptions.map((p) => (
                      <button
                        type="button"
                        key={p.id}
                        className="block w-full text-left px-2 py-1 text-sm hover:bg-slate-100"
                        onClick={() => {
                          setProviderQuery(formatProviderLabel(p));
                          setForm((f) => ({
                            ...f,
                            supplier_id: p.id,
                            supplier_name: p.razon_social || p.name || "",
                            supplier_ruc: p.ruc || "",
                          }));
                          setProviderOptions([]);
                        }}
                      >
                        {formatProviderLabel(p)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <input
                className="border rounded px-2 py-1"
                placeholder="RUC proveedor"
                value={form.supplier_ruc || ""}
                onChange={(e) => setForm((f) => ({ ...f, supplier_ruc: e.target.value }))}
              />
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                className="border rounded px-2 py-1"
                placeholder="Comprador (razón social)"
                value={form.buyer_name || ""}
                onChange={(e) => setForm((f) => ({ ...f, buyer_name: e.target.value }))}
              />
              <input
                className="border rounded px-2 py-1"
                placeholder="RUC comprador"
                value={form.buyer_ruc || ""}
                onChange={(e) => setForm((f) => ({ ...f, buyer_ruc: e.target.value }))}
              />
            </div>

            <div className="mt-4">
              <label className="text-xs text-slate-500">Concepto / detalle del gasto</label>
              <input
                className="border rounded px-2 py-1 w-full"
                placeholder="Ej: flete internacional, ferreteria, hospedaje, mano de obra, viatico"
                value={form.expense_concept || ""}
                onChange={(e) => setForm((f) => ({ ...f, expense_concept: e.target.value }))}
              />
            </div>

            {entryMode === "resumen" ? (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500">Item de compra</label>
                  <select
                    className="border rounded px-2 py-1 w-full"
                    value={form.expense_rubro || "SIN CLASIFICAR"}
                    onChange={(e) => setForm((f) => ({ ...f, expense_rubro: e.target.value }))}
                  >
                    <option value="SIN CLASIFICAR">Sin clasificar</option>
                    {EXPENSE_RUBROS.map((rubro) => (
                      <option key={rubro} value={rubro}>{rubro}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500">Tipo de IVA</label>
                  <select
                    className="border rounded px-2 py-1 w-full"
                    value={form.tax_mode || "solo10"}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        tax_mode: e.target.value,
                        gravado_10: "",
                        gravado_5: "",
                        iva_exempt: "",
                        iva_no_taxed: "",
                      }))
                    }
                  >
                    <option value="solo10">Solo 10%</option>
                    <option value="solo5">Solo 5%</option>
                    <option value="mixto">Mixto (10% + 5%)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500">Total comprobante</label>
                  <input
                    className="border rounded px-2 py-1 w-full"
                    inputMode="decimal"
                    placeholder="Total comprobante"
                    value={form.amount_total || ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, amount_total: e.target.value }))
                    }
                    onBlur={() =>
                      setForm((f) => ({
                        ...f,
                        amount_total: formatCurrencyInput(f.amount_total, f.currency_code),
                      }))
                    }
                  />
                </div>
                {form.tax_mode === "mixto" && (
                  <>
                    <input
                      className="border rounded px-2 py-1"
                      placeholder="Gravado 10% (con IVA)"
                      value={form.gravado_10 || ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, gravado_10: e.target.value }))
                      }
                      onBlur={() =>
                        setForm((f) => ({
                          ...f,
                          gravado_10: formatCurrencyInput(f.gravado_10, f.currency_code),
                        }))
                      }
                    />
                    <input
                      className="border rounded px-2 py-1"
                      placeholder="Gravado 5% (con IVA)"
                      value={form.gravado_5 || ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, gravado_5: e.target.value }))
                      }
                      onBlur={() =>
                        setForm((f) => ({
                          ...f,
                          gravado_5: formatCurrencyInput(f.gravado_5, f.currency_code),
                        }))
                      }
                    />
                    <input
                      className="border rounded px-2 py-1"
                      placeholder="Exento"
                      value={form.iva_exempt || ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, iva_exempt: e.target.value }))
                      }
                      onBlur={() =>
                        setForm((f) => ({
                          ...f,
                          iva_exempt: formatCurrencyInput(f.iva_exempt, f.currency_code),
                        }))
                      }
                    />
                    <input
                      className="border rounded px-2 py-1"
                      placeholder="No gravado"
                      value={form.iva_no_taxed || ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, iva_no_taxed: e.target.value }))
                      }
                      onBlur={() =>
                        setForm((f) => ({
                          ...f,
                          iva_no_taxed: formatCurrencyInput(f.iva_no_taxed, f.currency_code),
                        }))
                      }
                    />
                  </>
                )}
                <div className="md:col-span-2 text-xs text-slate-600">
                  IVA 10%: {formatCurrencyDisplay(computedTax.iva10, form.currency_code)} · IVA 5%:{" "}
                  {formatCurrencyDisplay(computedTax.iva5, form.currency_code)}
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Total comprobante</label>
                    <input
                      className="border rounded px-2 py-1 w-full bg-slate-50"
                      value={formatCurrencyDisplay(itemsTotals.total, form.currency_code)}
                      readOnly
                    />
                  </div>
                  <div className="text-xs text-slate-600 flex items-end">
                    IVA 10%: {formatCurrencyDisplay(computedTax.iva10, form.currency_code)} · IVA 5%:{" "}
                    {formatCurrencyDisplay(computedTax.iva5, form.currency_code)}
                  </div>
                </div>

                <div className="overflow-auto border rounded-lg">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-100 text-slate-600">
                      <tr>
                        <th className="text-left px-3 py-2">Descripción</th>
                        <th className="text-left px-3 py-2">Item de compra</th>
                        <th className="text-left px-3 py-2">Cant.</th>
                        <th className="text-left px-3 py-2">Precio unit.</th>
                        <th className="text-left px-3 py-2">IVA</th>
                        <th className="text-left px-3 py-2">Subtotal</th>
                        <th className="text-left px-3 py-2">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="px-3 py-2">
                            <input
                              className="border rounded px-2 py-1 w-full"
                              value={it.description || ""}
                              onChange={(e) => updateItem(idx, "description", e.target.value)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              className="border rounded px-2 py-1 w-full"
                              value={it.expense_rubro || "SIN CLASIFICAR"}
                              onChange={(e) => updateItem(idx, "expense_rubro", e.target.value)}
                            >
                              <option value="SIN CLASIFICAR">Sin clasificar</option>
                              {EXPENSE_RUBROS.map((rubro) => (
                                <option key={rubro} value={rubro}>{rubro}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              className="border rounded px-2 py-1 w-full"
                              type="number"
                              value={it.quantity || ""}
                              onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              className="border rounded px-2 py-1 w-full"
                              inputMode="decimal"
                              value={it.unit_price || ""}
                              onChange={(e) => updateItem(idx, "unit_price", e.target.value)}
                              onBlur={() =>
                                updateItem(idx, "unit_price", formatCurrencyInput(it.unit_price, form.currency_code))
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              className="border rounded px-2 py-1 w-full"
                              value={it.tax_rate || 10}
                              onChange={(e) => updateItem(idx, "tax_rate", e.target.value)}
                            >
                              <option value={10}>10%</option>
                              <option value={5}>5%</option>
                              <option value={0}>Exento</option>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            {formatCurrencyDisplay(calcItemSubtotal(it), form.currency_code)}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              className="text-red-600 underline"
                              onClick={() => removeItem(idx)}
                            >
                              Eliminar
                            </button>
                          </td>
                        </tr>
                      ))}
                      {items.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-3 py-4 text-center text-slate-500">
                            Sin ítems cargados.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <button
                  className="px-3 py-2 text-sm rounded-lg border"
                  onClick={addItem}
                >
                  + Agregar ítem
                </button>
              </div>
            )}

            <div className="mt-4">
              <label className="text-xs text-slate-500">Adjunto (opcional)</label>
              <input
                type="file"
                className="border rounded px-2 py-1 w-full"
                onChange={(e) => setInvoiceFile(e.target.files?.[0] || null)}
              />
            </div>

            <div className="mt-4">
              <label className="text-xs text-slate-500">Observaciones</label>
              <textarea
                className="border rounded px-2 py-1 w-full min-h-[80px]"
                value={form.notes || ""}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-4 py-2 text-sm rounded border"
                onClick={() => setModalOpen(false)}
              >
                Cancelar
              </button>
              <button
                className="px-4 py-2 text-sm rounded bg-black text-white"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
      {actionsMenu && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[55] cursor-default bg-transparent"
            aria-label="Cerrar acciones"
            onClick={() => setActionsMenu(null)}
          />
          <div
            className="fixed z-[56] w-44 overflow-hidden rounded-lg border bg-white shadow-xl"
            style={{ top: actionsMenu.top, left: actionsMenu.left }}
          >
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-xs hover:bg-slate-50"
              onClick={() => {
                setActionsMenu(null);
                openEdit(actionsMenu.invoice);
              }}
            >
              Editar
            </button>
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-xs hover:bg-slate-50 disabled:text-slate-400 disabled:hover:bg-white"
              onClick={() => {
                setActionsMenu(null);
                setPaymentOrderInvoice(actionsMenu.invoice);
              }}
              disabled={!canRequestOrder(actionsMenu.invoice)}
            >
              Solicitar orden
            </button>
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-xs hover:bg-slate-50 disabled:text-slate-400 disabled:hover:bg-white"
              onClick={() => {
                setActionsMenu(null);
                setPaymentInvoice(actionsMenu.invoice);
              }}
              disabled={!canRegisterPayment(actionsMenu.invoice)}
              title={!canRegisterPayment(actionsMenu.invoice) ? "Para credito, la orden debe estar aprobada." : ""}
            >
              Registrar pago
            </button>
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-xs hover:bg-slate-50"
              onClick={() => {
                setActionsMenu(null);
                setPaymentsInvoice(actionsMenu.invoice);
              }}
            >
              Ver pagos
            </button>
            <button
              type="button"
              className="block w-full border-t px-3 py-2 text-left text-xs text-red-700 hover:bg-red-50"
              onClick={() => {
                const invoice = actionsMenu.invoice;
                setActionsMenu(null);
                handleDeleteInvoice(invoice);
              }}
            >
              Eliminar
            </button>
          </div>
        </>
      )}
      {paymentOrderInvoice && (
        <PaymentOrderRequestModal
          invoice={paymentOrderInvoice}
          operationId={operationId}
          operationType={operationType}
          onClose={() => setPaymentOrderInvoice(null)}
          onSuccess={async () => {
            setPaymentOrderInvoice(null);
            await loadInvoices();
          }}
        />
      )}
      {paymentInvoice && (
        <OperationExpensePaymentModal
          invoice={paymentInvoice}
          operationId={operationId}
          operationType={operationType}
          companyAccounts={companyAccounts}
          onClose={() => setPaymentInvoice(null)}
          onSuccess={async () => {
            setPaymentInvoice(null);
            await loadInvoices();
            await loadExpenseControl();
          }}
        />
      )}
      {paymentsInvoice && (
        <PaymentsListModal
          invoice={paymentsInvoice}
          operationId={operationId}
          operationType={operationType}
          onClose={() => setPaymentsInvoice(null)}
        />
      )}
    </>
  );
}

function money(amount, currencyCode = "PYG") {
  const currency = String(currencyCode || "PYG").toUpperCase();
  return `${currency} ${formatCurrencyDisplay(amount || 0, currency)}`;
}

function costDifferenceMoney(amount, currencyCode = "PYG") {
  const value = Number(amount || 0);
  if (value < -0.009) return `+ ${money(Math.abs(value), currencyCode)}`;
  return money(value, currencyCode);
}

function hasSupplierBankAccount(row) {
  return Boolean(
    row?.supplier_bank_name ||
      row?.supplier_bank_account ||
      row?.supplier_bank_holder ||
      row?.supplier_bank_cci_iban
  );
}

function supplierBankAccountLabel(row) {
  const main = [
    row?.supplier_bank_name,
    row?.supplier_bank_account,
    row?.supplier_bank_currency,
  ].filter(Boolean);
  const holder = [row?.supplier_bank_holder, row?.supplier_bank_holder_ruc]
    .filter(Boolean)
    .join(" - ");
  return [main.join(" - "), holder].filter(Boolean).join(" | ");
}

function PaymentOrderRequestModal({ invoice, operationId, operationType, onClose, onSuccess }) {
  const balance = Number(invoice?.balance ?? invoice?.amount_total ?? 0) || 0;
  const [form, setForm] = useState({
    payment_method: "Transferencia",
    payment_date: invoice?.due_date ? String(invoice.due_date).slice(0, 10) : today(),
    amount: String(balance || ""),
    observations: "",
  });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const amount = Number(form.amount || 0);
    if (!amount || amount <= 0) return alert("Monto invalido.");
    if (amount > balance + 0.01) return alert("El monto no puede superar el saldo.");
    setSaving(true);
    try {
      await api.post(
        `/operations/${operationId}/expense-invoices/${invoice.id}/payment-orders`,
        {
          payment_method: form.payment_method || null,
          payment_date: form.payment_date || null,
          amount,
          observations: form.observations || null,
        },
        { params: { operation_type: operationType } }
      );
      alert("Orden de pago solicitada correctamente.");
      onSuccess?.();
    } catch (e) {
      console.error("Error requesting payment order", e);
      alert(e?.response?.data?.error || "No se pudo solicitar la orden de pago.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Solicitar orden de pago</h3>
          <button className="text-sm underline" onClick={onClose} type="button">Cerrar</button>
        </div>
        <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm">
          <div className="font-medium">{invoice?.supplier_org_name || invoice?.supplier_name || "Proveedor"}</div>
          <div className="text-slate-600">{invoice?.receipt_type || "Factura"} {invoice?.receipt_number || ""}</div>
          <div className="mt-1">Saldo: <b>{money(balance, invoice?.currency_code)}</b></div>
        </div>
        <form className="space-y-3" onSubmit={handleSubmit}>
          <select className="w-full border rounded px-3 py-2" value={form.payment_method} onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}>
            {PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
          </select>
          <input type="date" className="w-full border rounded px-3 py-2" value={form.payment_date} onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))} />
          <input type="number" min="0" step="0.01" className="w-full border rounded px-3 py-2" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="Monto" />
          <textarea className="w-full border rounded px-3 py-2 min-h-[84px]" value={form.observations} onChange={(e) => setForm((f) => ({ ...f, observations: e.target.value }))} placeholder="Observaciones" />
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded border px-4 py-2 text-sm" onClick={onClose} disabled={saving}>Cancelar</button>
            <button type="submit" className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-60" disabled={saving}>{saving ? "Guardando..." : "Solicitar"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function OperationExpensePaymentModal({ invoice, operationId, operationType, companyAccounts, onClose, onSuccess }) {
  const balance = Number(invoice?.balance ?? invoice?.amount_total ?? 0) || 0;
  const [form, setForm] = useState({
    payment_date: today(),
    amount: String(balance || ""),
    method: "Transferencia",
    account: "",
    reference_number: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const accountOptions = filterCompanyBankAccounts(companyAccounts, invoice?.currency_code || "PYG");

  async function handleSubmit(e) {
    e.preventDefault();
    const amount = Number(form.amount || 0);
    if (!amount || amount <= 0) return alert("Monto invalido.");
    if (amount > balance + 0.01) return alert("El monto no puede superar el saldo.");
    setSaving(true);
    try {
      await api.post(
        `/operations/${operationId}/expense-invoices/${invoice.id}/payments`,
        {
          payment_date: form.payment_date || null,
          amount,
          method: form.method || null,
          account: form.account || null,
          reference_number: form.reference_number || null,
          notes: form.notes || null,
        },
        { params: { op_type: operationType } }
      );
      alert("Pago registrado correctamente.");
      onSuccess?.();
    } catch (e) {
      console.error("Error registering operation expense payment", e);
      alert(e?.response?.data?.error || "No se pudo registrar el pago.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Registrar pago</h3>
          <button className="text-sm underline" onClick={onClose} type="button">Cerrar</button>
        </div>
        <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm">
          <div className="font-medium">{invoice?.supplier_org_name || invoice?.supplier_name || "Proveedor"}</div>
          <div>Saldo: <b>{money(balance, invoice?.currency_code)}</b></div>
        </div>
        <form className="space-y-3" onSubmit={handleSubmit}>
          <input type="date" className="w-full border rounded px-3 py-2" value={form.payment_date} onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))} />
          <input type="number" min="0" step="0.01" className="w-full border rounded px-3 py-2" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="Monto" />
          <select className="w-full border rounded px-3 py-2" value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}>
            {PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
          </select>
          <select className="w-full border rounded px-3 py-2" value={form.account} onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))}>
            <option value="">Cuenta origen de empresa</option>
            {accountOptions.map((account) => (
              <option key={account.id || companyBankAccountValue(account)} value={companyBankAccountValue(account)}>
                {companyBankAccountLabel(account)}
              </option>
            ))}
          </select>
          <div className="rounded-lg border bg-slate-50 p-3 text-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Cuenta destino del proveedor
            </div>
            {hasSupplierBankAccount(invoice) ? (
              <div className="mt-2 space-y-1">
                <select className="w-full border rounded px-3 py-2 bg-white" value="supplier-bank" disabled>
                  <option value="supplier-bank">{supplierBankAccountLabel(invoice)}</option>
                </select>
                {(invoice?.supplier_bank_account_type || invoice?.supplier_bank_cci_iban || invoice?.supplier_bank_swift) && (
                  <div className="text-xs text-slate-600">
                    {[invoice?.supplier_bank_account_type, invoice?.supplier_bank_cci_iban, invoice?.supplier_bank_swift]
                      .filter(Boolean)
                      .join(" | ")}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-2 text-slate-500">
                Este proveedor no tiene cuenta bancaria cargada en su organización.
              </div>
            )}
          </div>
          <input className="w-full border rounded px-3 py-2" value={form.reference_number} onChange={(e) => setForm((f) => ({ ...f, reference_number: e.target.value }))} placeholder="Referencia" />
          <textarea className="w-full border rounded px-3 py-2 min-h-[84px]" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Notas" />
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded border px-4 py-2 text-sm" onClick={onClose} disabled={saving}>Cancelar</button>
            <button type="submit" className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-60" disabled={saving}>{saving ? "Guardando..." : "Guardar pago"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PaymentsListModal({ invoice, operationId, operationType, onClose }) {
  const [rows, setRows] = useState(Array.isArray(invoice?.payments) ? invoice.payments : []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    api.get(`/operations/${operationId}/expense-invoices/${invoice.id}/payments`, { params: { op_type: operationType } })
      .then(({ data }) => {
        if (live) setRows(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (live) setRows([]);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [invoice?.id, operationId, operationType]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Pagos de factura de compra</h3>
          <button className="text-sm underline" onClick={onClose} type="button">Cerrar</button>
        </div>
        {loading ? (
          <div className="text-sm text-slate-500">Cargando...</div>
        ) : (
          <div className="overflow-auto border rounded-lg">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="text-left px-3 py-2">Fecha</th>
                  <th className="text-left px-3 py-2">Monto</th>
                  <th className="text-left px-3 py-2">Metodo</th>
                  <th className="text-left px-3 py-2">Cuenta</th>
                  <th className="text-left px-3 py-2">Referencia</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="px-3 py-2">{row.payment_date || "-"}</td>
                    <td className="px-3 py-2">{money(row.amount, invoice?.currency_code)}</td>
                    <td className="px-3 py-2">{row.method || "-"}</td>
                    <td className="px-3 py-2">{row.account || "-"}</td>
                    <td className="px-3 py-2">{row.reference_number || "-"}</td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-slate-500">Sin pagos registrados.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function normalizeCurrencyCode(value) {
  const code = String(value || "PYG").toUpperCase();
  return code === "GS" ? "PYG" : code;
}

function convertToBudgetCurrency(amount, fromCurrency, budgetCurrency, exchangeRate) {
  const source = normalizeCurrencyCode(fromCurrency);
  const target = normalizeCurrencyCode(budgetCurrency);
  const value = Number(amount || 0);
  const rate = Number(exchangeRate || 0);
  if (!Number.isFinite(value)) return null;
  if (source === target) return value;
  if (!Number.isFinite(rate) || rate <= 1) return null;
  if (target === "USD" && source === "PYG") return value / rate;
  if (target === "PYG" && source === "USD") return value * rate;
  return null;
}

function ExpenseControlPanel({ data, loading, manualExchangeRate, onManualExchangeRateChange, onCreateInvoice }) {
  const [installationOpen, setInstallationOpen] = useState(false);
  if (loading) {
    return <div className="mb-4 rounded-xl border bg-slate-50 p-4 text-sm text-slate-500">Cargando control de costos...</div>;
  }
  const comparisons = Array.isArray(data?.comparisons) ? data.comparisons : [];
  const rubros = Array.isArray(data?.rubros) ? data.rubros : [];
  const realProfit = data?.real_profit_summary || null;
  const budget = data?.budget || null;
  const installationLines = Array.isArray(budget?.installation_lines) ? budget.installation_lines : [];
  const budgetCurrency = normalizeCurrencyCode(budget?.currency_code || "");
  const budgetedPurchase = Number(budget?.budgeted_purchase || 0);
  const expenseInvoices = Array.isArray(data?.invoices) ? data.invoices : [];
  const conversionRows = expenseInvoices.map((invoice) => {
    const originalCurrency = normalizeCurrencyCode(invoice.currency_code || "PYG");
    const originalAmount = Number(invoice.amount_total || 0) || 0;
    const convertedAmount = convertToBudgetCurrency(
      originalAmount,
      originalCurrency,
      budgetCurrency,
      manualExchangeRate
    );
    return {
      id: invoice.id,
      originalCurrency,
      originalAmount,
      convertedAmount,
    };
  });
  const convertedComparableRows = conversionRows.filter((row) => row.convertedAmount != null);
  const convertedTotal = convertedComparableRows.reduce((sum, row) => sum + Number(row.convertedAmount || 0), 0);
  const hasConvertedComparison = Boolean(budgetCurrency && budgetedPurchase > 0 && convertedComparableRows.length);
  const convertedDifference = hasConvertedComparison
    ? Number((convertedTotal - budgetedPurchase).toFixed(2))
    : null;
  const hasOverBudget = hasConvertedComparison
    ? convertedDifference > 0.009
    : comparisons.some((row) => row.status === "over_budget");
  const displayCurrencies = Array.from(
    new Set([
      "USD",
      "PYG",
      budgetCurrency,
      ...comparisons.map((row) => normalizeCurrencyCode(row.currency_code)),
    ].filter(Boolean))
  );
  const displayComparisons = displayCurrencies.map((currency) => {
    const budgetInCurrency = budgetCurrency && budgetedPurchase
      ? convertToBudgetCurrency(budgetedPurchase, budgetCurrency, currency, manualExchangeRate)
      : null;
    let hasMissingActualConversion = false;
    const actualInCurrency = expenseInvoices.reduce((sum, invoice) => {
      const originalCurrency = normalizeCurrencyCode(invoice.currency_code || "PYG");
      const converted = convertToBudgetCurrency(
        Number(invoice.amount_total || 0) || 0,
        originalCurrency,
        currency,
        manualExchangeRate
      );
      if (converted == null) {
        hasMissingActualConversion = true;
        return sum;
      }
      return sum + converted;
    }, 0);
    const comparable = budgetInCurrency != null && !hasMissingActualConversion;
    const difference = comparable ? Number((actualInCurrency - budgetInCurrency).toFixed(2)) : null;
    return {
      currency_code: currency,
      actual_purchase: Number(actualInCurrency.toFixed(2)),
      budgeted_purchase: budgetInCurrency == null ? null : Number(budgetInCurrency.toFixed(2)),
      difference,
      status: comparable ? (difference > 0.009 ? "over_budget" : "within_budget") : "not_comparable",
      converted_from_budget_currency: budgetCurrency && currency !== budgetCurrency ? budgetCurrency : null,
      full_conversion: comparable,
    };
  });
  const unconvertedCurrencies = Array.from(
    new Set(
      conversionRows
        .filter((row) => row.convertedAmount == null)
        .map((row) => row.originalCurrency)
    )
  );
  const installationInvoices = expenseInvoices.filter(
    (invoice) => String(invoice.expense_rubro || invoice.expense_rubros || "").toUpperCase().includes("INSTALACION")
  );
  const installationConcepts = new Set(
    installationLines
      .map((line) => String(line.description || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const unassignedInstallationInvoices = installationInvoices.filter((invoice) => {
    const concept = String(invoice.expense_concept || "").trim().toLowerCase();
    return !concept || !installationConcepts.has(concept);
  });

  return (
    <div className={`mb-4 rounded-xl border p-4 ${hasOverBudget ? "border-red-200 bg-red-50" : "bg-slate-50"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-semibold">Control de costos reales</div>
          <div className="text-xs text-slate-500 mt-1">
            Presupuesto: {budget?.revision_label || "Sin presupuesto detectado"}
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${hasOverBudget ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
          {hasOverBudget ? "Sobrecosto" : "En margen"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] gap-3 rounded-lg border bg-white p-3">
        <div>
          <label className="block text-xs font-medium text-slate-500">TC para control</label>
          <input
            type="number"
            min="0"
            step="0.01"
            className="mt-1 w-full border rounded px-3 py-2 text-sm"
            placeholder="Gs por USD"
            value={manualExchangeRate || ""}
            onChange={(e) => onManualExchangeRateChange?.(e.target.value)}
          />
        </div>
        <div className="text-sm text-slate-700">
          <div className="font-medium">Comparacion convertida a {budgetCurrency || "moneda del presupuesto"}</div>
          {hasConvertedComparison ? (
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              <span>Compra presupuestada: <b>{money(budgetedPurchase, budgetCurrency)}</b></span>
              <span>Compra real convertida: <b>{money(convertedTotal, budgetCurrency)}</b></span>
              <span>
                Diferencia:{" "}
                <b className={convertedDifference > 0 ? "text-red-700" : "text-emerald-700"}>
                  {costDifferenceMoney(convertedDifference, budgetCurrency)}
                </b>
              </span>
            </div>
          ) : (
            <div className="mt-1 text-slate-500">
              Carga el TC para comparar facturas USD/PYG contra el presupuesto.
            </div>
          )}
          {unconvertedCurrencies.length > 0 && (
            <div className="mt-1 text-xs text-amber-700">
              Sin conversion para: {unconvertedCurrencies.join(", ")}.
            </div>
          )}
        </div>
      </div>

      {realProfit && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {[
            ["Venta", realProfit.budgeted_sell],
            ["Compra presup.", realProfit.budgeted_buy],
            ["Gasto real", realProfit.actual_buy],
            ["Diferencia costo", Number(realProfit.actual_buy || 0) - Number(realProfit.budgeted_buy || 0)],
            ["Profit presup.", realProfit.budgeted_profit],
            ["Profit real", realProfit.real_profit],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border bg-white p-3">
              <div className="text-xs text-slate-500">{label}</div>
              <div className={`mt-1 text-base font-semibold ${
                label === "Diferencia costo"
                  ? Number(value || 0) > 0
                    ? "text-red-700"
                    : "text-emerald-700"
                  : label === "Profit real" && Number(realProfit.profit_difference || 0) < 0
                  ? "text-red-700"
                  : ""
              }`}>
                {label === "Diferencia costo"
                  ? costDifferenceMoney(value, realProfit.currency_code)
                  : money(value, realProfit.currency_code)}
              </div>
            </div>
          ))}
        </div>
      )}

      {rubros.length > 0 && (
        <div className="mt-3 overflow-auto rounded-lg border bg-white">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">Item de compra</th>
                <th className="px-3 py-2 text-right">Compra presup.</th>
                <th className="px-3 py-2 text-right">Gasto real</th>
                <th className="px-3 py-2 text-right">Diferencia</th>
                <th className="px-3 py-2 text-left">Estado</th>
              </tr>
            </thead>
            <tbody>
              {rubros.map((row) => (
                <tr key={row.rubro} className="border-t">
                  <td className="px-3 py-2 font-medium">
                    <div className="flex items-center gap-2">
                      <span>{row.rubro}</span>
                      {row.rubro === "INSTALACION" && (
                        <button
                          type="button"
                          className="rounded border px-2 py-0.5 text-[11px] font-normal hover:bg-slate-50"
                          onClick={() => setInstallationOpen(true)}
                        >
                          Ver detalle
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">{money(row.budgeted_purchase, row.currency_code)}</td>
                  <td className="px-3 py-2 text-right">
                    {row.actual_purchase == null ? "Sin TC" : money(row.actual_purchase, row.currency_code)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className={row.status === "over_budget" ? "font-semibold text-red-700" : row.status === "within_budget" ? "font-semibold text-emerald-700" : "text-amber-700"}>
                      {row.difference == null ? "Sin comparacion" : costDifferenceMoney(row.difference, row.currency_code)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 ${
                      row.status === "over_budget"
                        ? "bg-red-100 text-red-700"
                        : row.status === "within_budget"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-700"
                    }`}>
                      {row.status === "over_budget" ? "Sobrecosto" : row.status === "within_budget" ? "En margen" : "Sin comparacion"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
        {displayComparisons.length ? displayComparisons.map((row) => (
          <div key={row.currency_code} className="rounded-lg border bg-white p-3">
            <div className="text-xs text-slate-500">{row.currency_code}</div>
            <div className="mt-2 text-sm space-y-1">
              <div className="flex justify-between gap-3">
                <span>Compra presupuestada</span>
                <b>{row.budgeted_purchase == null ? "No comparable" : money(row.budgeted_purchase, row.currency_code)}</b>
              </div>
              <div className="flex justify-between gap-3">
                <span>Compra real</span>
                <b>{money(row.actual_purchase, row.currency_code)}</b>
              </div>
              <div className="flex justify-between gap-3">
                <span>Diferencia</span>
                <b className={row.status === "over_budget" ? "text-red-700" : "text-emerald-700"}>
                  {row.difference == null ? "Sin comparacion" : costDifferenceMoney(row.difference, row.currency_code)}
                </b>
              </div>
              {row.converted_from_budget_currency && (
                <div className="text-xs text-slate-500">
                  Presupuesto convertido desde {row.converted_from_budget_currency} con TC {Number(manualExchangeRate || 0).toLocaleString("es-PY")}.
                </div>
              )}
              {row.full_conversion && (
                <div className="text-xs text-slate-500">
                  Incluye facturas de compra convertidas a {row.currency_code} con el TC cargado.
                </div>
              )}
            </div>
          </div>
        )) : (
          <div className="rounded-lg border bg-white p-3 text-sm text-slate-500">Sin facturas de compra cargadas todavia.</div>
        )}
      </div>

      {hasOverBudget && (
        <div className="mt-3 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-red-700">
          El gasto real supera lo presupuestado en la misma moneda. La alerta no bloquea la carga, solo deja visible el desvio.
        </div>
      )}
      {installationOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-5xl max-h-[90vh] overflow-auto rounded-2xl bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">Detalle de instalacion</h3>
                <div className="text-xs text-slate-500">
                  Lineas presupuestadas y facturas reales marcadas como instalacion.
                </div>
              </div>
              <button className="text-sm underline" type="button" onClick={() => setInstallationOpen(false)}>
                Cerrar
              </button>
            </div>

            <div className="overflow-auto rounded-lg border">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left">Item presupuesto</th>
                    <th className="px-3 py-2 text-right">Compra presup.</th>
                    <th className="px-3 py-2 text-left">Facturas asociadas</th>
                    <th className="px-3 py-2 text-right">Gasto real</th>
                    <th className="px-3 py-2 text-left">Accion</th>
                  </tr>
                </thead>
                <tbody>
                  {installationLines.map((line, idx) => {
                    const concept = String(line.description || "").trim();
                    const related = installationInvoices.filter((invoice) =>
                      concept
                        ? String(invoice.expense_concept || "").trim().toLowerCase() === concept.toLowerCase()
                        : false
                    );
                    const real = related.reduce((sum, invoice) => {
                      const converted = convertToBudgetCurrency(
                        Number(invoice.amount_total || 0) || 0,
                        invoice.currency_code || "PYG",
                        budgetCurrency,
                        manualExchangeRate
                      );
                      return sum + Number(converted || 0);
                    }, 0);
                    return (
                      <tr key={`${line.line_no || idx}-${concept}`} className="border-t">
                        <td className="px-3 py-2">
                          <div className="font-medium">{concept || `Instalacion ${idx + 1}`}</div>
                          <div className="text-xs text-slate-500">Cant. {Number(line.qty || 0).toLocaleString("es-PY")}</div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {money(line.total_cost_usd || 0, "USD")}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {related.length ? (
                            related.map((invoice) => (
                              <div key={invoice.id}>
                                {invoice.supplier_name || "Proveedor"} · {invoice.receipt_number || "Sin comprobante"} · {money(invoice.amount_total, invoice.currency_code)}
                              </div>
                            ))
                          ) : (
                            <span className="text-slate-400">Sin factura asociada</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">{money(real, budgetCurrency || "USD")}</td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className="rounded-lg border px-3 py-1.5 text-xs hover:bg-slate-50"
                            onClick={() => {
                              setInstallationOpen(false);
                              onCreateInvoice?.({
                                expense_rubro: "INSTALACION",
                                expense_concept: concept || `Instalacion ${idx + 1}`,
                              });
                            }}
                          >
                            Cargar factura
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!installationLines.length && (
                    <tr>
                      <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                        Sin lineas presupuestadas de instalacion.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {unassignedInstallationInvoices.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Hay {unassignedInstallationInvoices.length} factura(s) de instalacion sin asociar a una linea exacta. Editalas y completa el concepto con el nombre del item de instalacion.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
