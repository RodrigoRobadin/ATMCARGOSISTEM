// client/src/components/OperationExpenseInvoices.jsx
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";

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

function calcItemSubtotal(it) {
  const qty = Number(it.quantity || 0) || 0;
  const unit = Number(it.unit_price || 0) || 0;
  return Number((qty * unit).toFixed(2));
}

export default function OperationExpenseInvoices({
  operationId,
  operationType = "deal",
  showList = false,
  openNewKey = 0,
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
    const n = Number(String(form.amount_total || "").replace(/,/g, "."));
    return Number.isFinite(n) ? n : 0;
  }, [form.amount_total, entryMode, itemsTotals.total]);

  const computedTax = useMemo(() => {
    const mode = entryMode === "detalle"
      ? (itemsTotals.g10 && itemsTotals.g5 ? "mixto" : itemsTotals.g10 ? "solo10" : "solo5")
      : String(form.tax_mode || "").toLowerCase();
    const g10 = entryMode === "detalle" ? itemsTotals.g10 : Number(form.gravado_10 || 0) || 0;
    const g5 = entryMode === "detalle" ? itemsTotals.g5 : Number(form.gravado_5 || 0) || 0;
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
      setInvoices(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Error loading operation expenses", e);
      setError("No se pudo cargar los gastos de la operación.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationId]);

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
      tax_mode: inv.tax_mode || "solo10",
      gravado_10: inv.gravado_10 || "",
      gravado_5: inv.gravado_5 || "",
      condition_type: inv.condition_type || "CONTADO",
      due_date: inv.due_date || "",
      currency_code: inv.currency_code || "PYG",
      exchange_rate: inv.exchange_rate || "",
      amount_total: inv.amount_total || "",
      iva_10: inv.iva_10 || "",
      iva_5: inv.iva_5 || "",
      iva_exempt: inv.iva_exempt || "",
      iva_no_taxed: inv.iva_no_taxed || "",
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
        setItems(Array.isArray(data) ? data : []);
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
      { description: "", quantity: 1, unit_price: "", tax_rate: 10 },
    ]);
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
      const g10 = Number(form.gravado_10 || 0) || 0;
      const g5 = Number(form.gravado_5 || 0) || 0;
      if (!g10 && !g5) {
        setFormError("En IVA mixto, cargá gravado 10% o 5%.");
        return;
      }
      const vex = Number(form.iva_exempt || 0) || 0;
      const vnt = Number(form.iva_no_taxed || 0) || 0;
      const sum = g10 + g5 + vex + vnt;
      if (sum > totalForValidation + 0.01) {
        setFormError("La suma de gravados/exentos supera el total.");
        return;
      }
    } else if (entryMode !== "detalle") {
      const vex = Number(form.iva_exempt || 0) || 0;
      const vnt = Number(form.iva_no_taxed || 0) || 0;
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
          ? form.amount_total
          : totalNum || 0;

      const payload = {
        invoice_date: form.invoice_date || null,
        receipt_type: form.receipt_type || null,
        receipt_number: form.receipt_number || null,
        timbrado_number: form.timbrado_number || null,
        tax_mode: entryMode === "detalle" ? null : form.tax_mode || null,
        gravado_10:
          entryMode === "detalle"
            ? null
            : form.tax_mode === "mixto"
            ? form.gravado_10 || null
            : null,
        gravado_5:
          entryMode === "detalle"
            ? null
            : form.tax_mode === "mixto"
            ? form.gravado_5 || null
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
          entryMode === "detalle" ? itemsTotals.ex || 0 : form.iva_exempt || null,
        iva_no_taxed: form.iva_no_taxed || null,
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

  return (
    <>
      {showList && (
        <div className="bg-white rounded-2xl shadow p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-medium">Gastos por operación</h3>
              <div className="text-xs text-slate-500">
                Facturas de compra vinculadas a esta operación.
              </div>
            </div>
            <button
              type="button"
              className="px-3 py-2 text-sm rounded-lg bg-black text-white"
              onClick={() => {
                resetForm();
                setModalOpen(true);
              }}
            >
              + Factura de compra
            </button>
          </div>

          {loading ? (
            <div className="text-sm text-slate-500">Cargando...</div>
          ) : error ? (
            <div className="text-sm text-red-600">{error}</div>
          ) : (
            <>
              <div className="text-xs text-slate-500 mb-2">
                Totales:{" "}
                {Object.keys(totalByCurrency).length
                  ? Object.entries(totalByCurrency)
                      .map(([k, v]) => `${k} ${Number(v).toLocaleString("es-ES")}`)
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
                      <th className="text-left px-3 py-2">Total</th>
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
                          {inv.supplier_org_name || inv.supplier_name || "—"}
                        </td>
                        <td className="px-3 py-2">
                          {(inv.receipt_type || "—") +
                            (inv.receipt_number ? ` · ${inv.receipt_number}` : "")}
                        </td>
                        <td className="px-3 py-2">
                          {inv.currency_code || "PYG"}{" "}
                          {Number(inv.amount_total || 0).toLocaleString("es-ES")}
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
                          <button
                            className="text-emerald-700 underline"
                            onClick={() => openEdit(inv)}
                          >
                            Editar
                          </button>
                        </td>
                      </tr>
                    ))}
                    {invoices.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-3 py-4 text-center text-slate-500">
                          Sin facturas cargadas.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
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
                  onChange={(e) => setForm((f) => ({ ...f, currency_code: e.target.value }))}
                >
                  <option value="PYG">PYG</option>
                  <option value="USD">USD</option>
                  <option value="BRL">BRL</option>
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

            {entryMode === "resumen" ? (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
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
                    placeholder="Total comprobante"
                    value={form.amount_total || ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, amount_total: e.target.value }))
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
                    />
                    <input
                      className="border rounded px-2 py-1"
                      placeholder="Gravado 5% (con IVA)"
                      value={form.gravado_5 || ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, gravado_5: e.target.value }))
                      }
                    />
                    <input
                      className="border rounded px-2 py-1"
                      placeholder="Exento"
                      value={form.iva_exempt || ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, iva_exempt: e.target.value }))
                      }
                    />
                    <input
                      className="border rounded px-2 py-1"
                      placeholder="No gravado"
                      value={form.iva_no_taxed || ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, iva_no_taxed: e.target.value }))
                      }
                    />
                  </>
                )}
                <div className="md:col-span-2 text-xs text-slate-600">
                  IVA 10%: {computedTax.iva10.toLocaleString("es-ES")} · IVA 5%:{" "}
                  {computedTax.iva5.toLocaleString("es-ES")}
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Total comprobante</label>
                    <input
                      className="border rounded px-2 py-1 w-full bg-slate-50"
                      value={itemsTotals.total.toLocaleString("es-ES")}
                      readOnly
                    />
                  </div>
                  <div className="text-xs text-slate-600 flex items-end">
                    IVA 10%: {computedTax.iva10.toLocaleString("es-ES")} · IVA 5%:{" "}
                    {computedTax.iva5.toLocaleString("es-ES")}
                  </div>
                </div>

                <div className="overflow-auto border rounded-lg">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-100 text-slate-600">
                      <tr>
                        <th className="text-left px-3 py-2">Descripción</th>
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
                              type="number"
                              value={it.unit_price || ""}
                              onChange={(e) => updateItem(idx, "unit_price", e.target.value)}
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
                            {calcItemSubtotal(it).toLocaleString("es-ES")}
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
                          <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
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
    </>
  );
}
