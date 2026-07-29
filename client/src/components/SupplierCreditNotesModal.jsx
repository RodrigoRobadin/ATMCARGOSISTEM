import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";

const RUBROS = [
  "FLETE",
  "SEGURO",
  "DESPACHO",
  "PRODUCTO",
  "ADICIONAL",
  "INSTALACION",
  "FINANCIACION",
  "COMISION",
  "SIN CLASIFICAR",
];

function today() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function money(value, currency = "PYG") {
  const code = String(currency || "PYG").toUpperCase();
  return `${code} ${Number(value || 0).toLocaleString("es-PY", {
    minimumFractionDigits: code === "PYG" ? 0 : 2,
    maximumFractionDigits: code === "PYG" ? 0 : 2,
  })}`;
}

function emptyItem(rubro = "SIN CLASIFICAR") {
  return {
    description: "",
    quantity: 1,
    unit_price: "",
    tax_rate: 10,
    expense_rubro: rubro || "SIN CLASIFICAR",
  };
}

export default function SupplierCreditNotesModal({
  open,
  document,
  onClose,
  onChanged,
}) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [source, setSource] = useState(null);
  const [summary, setSummary] = useState(null);
  const [notes, setNotes] = useState([]);
  const [detail, setDetail] = useState(null);
  const [attachment, setAttachment] = useState(null);
  const [form, setForm] = useState({
    note_date: today(),
    receipt_number: "",
    timbrado_number: "",
    reason: "",
    notes: "",
  });
  const [items, setItems] = useState([emptyItem()]);

  const sourceType = String(document?.source_type || "");
  const sourceId = Number(
    document?.source_id ||
      (sourceType === "admin-expense" ? document?.expense_id : document?.invoice_id) ||
      document?.id ||
      0
  );
  const currencyCode = String(source?.currency_code || document?.currency_code || "PYG").toUpperCase();
  const step = currencyCode === "PYG" ? "1" : "0.01";
  const remainingCredit = Math.max(0, Number(summary?.gross_amount || 0) - Number(summary?.credited_amount || 0));

  const itemTotals = useMemo(() => {
    const result = {
      total: 0,
      iva10: 0,
      iva5: 0,
      exempt: 0,
    };
    for (const item of items) {
      const subtotal = Number(item.quantity || 0) * Number(item.unit_price || 0);
      result.total += subtotal;
      if (Number(item.tax_rate) === 10) result.iva10 += subtotal / 11;
      else if (Number(item.tax_rate) === 5) result.iva5 += subtotal / 21;
      else result.exempt += subtotal;
    }
    return result;
  }, [items]);

  function resetForm(nextSource = source) {
    setForm({
      note_date: today(),
      receipt_number: "",
      timbrado_number: "",
      reason: "",
      notes: "",
    });
    setItems([emptyItem(nextSource?.expense_rubro || document?.expense_rubro)]);
    setAttachment(null);
  }

  async function load() {
    if (!sourceType || !sourceId) return;
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get(`/supplier-credit-notes/source/${sourceType}/${sourceId}`);
      setSource(data?.document || null);
      setSummary(data?.summary || null);
      setNotes(Array.isArray(data?.notes) ? data.notes : []);
      setDetail(null);
      resetForm(data?.document || null);
    } catch (requestError) {
      console.error("supplier credit notes load error", requestError);
      setError(requestError?.response?.data?.error || "No se pudieron cargar las notas de credito.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sourceType, sourceId]);

  function updateItem(index, key, value) {
    setItems((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: value } : item))
    );
  }

  async function save() {
    if (!form.note_date || !form.receipt_number.trim() || !form.reason.trim()) {
      return setError("Completa fecha, numero y motivo de la nota de credito.");
    }
    if (itemTotals.total <= 0) return setError("El total debe ser mayor a cero.");
    if (itemTotals.total > remainingCredit + 0.01) {
      return setError(`La nota supera el importe disponible de ${money(remainingCredit, currencyCode)}.`);
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        source_type: sourceType,
        source_id: sourceId,
        currency_code: currencyCode,
        ...form,
        amount_total: itemTotals.total,
        items: items.map((item) => ({
          ...item,
          quantity: Number(item.quantity || 0),
          unit_price: Number(item.unit_price || 0),
          subtotal: Number(item.quantity || 0) * Number(item.unit_price || 0),
          tax_rate: Number(item.tax_rate),
        })),
      };
      const { data } = await api.post("/supplier-credit-notes", payload);
      if (attachment && data?.id) {
        const body = new FormData();
        body.append("file", attachment);
        await api.post(`/supplier-credit-notes/${data.id}/attachments`, body, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }
      await load();
      onChanged?.();
    } catch (requestError) {
      console.error("supplier credit note create error", requestError);
      setError(requestError?.response?.data?.error || "No se pudo registrar la nota de credito.");
    } finally {
      setSaving(false);
    }
  }

  async function viewDetail(id) {
    try {
      const { data } = await api.get(`/supplier-credit-notes/${id}`);
      setDetail(data || null);
    } catch (requestError) {
      setError(requestError?.response?.data?.error || "No se pudo cargar el detalle.");
    }
  }

  async function cancelNote(note) {
    const reason = window.prompt("Motivo obligatorio de anulacion:");
    if (!reason?.trim()) return;
    try {
      await api.post(`/supplier-credit-notes/${note.id}/cancel`, { reason: reason.trim() });
      await load();
      onChanged?.();
    } catch (requestError) {
      setError(requestError?.response?.data?.error || "No se pudo anular la nota de credito.");
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/45 p-3">
      <div className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-lg bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Notas de credito del proveedor</h2>
            <p className="text-xs text-slate-500">
              Factura {source?.document_number || document?.document_number || "-"} -{" "}
              {source?.supplier_name || document?.supplier_name || "Proveedor"}
            </p>
          </div>
          <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={onClose}>
            Cerrar
          </button>
        </div>

        <div className="space-y-5 p-5">
          {error ? <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
          {loading ? (
            <div className="py-10 text-center text-sm text-slate-500">Cargando...</div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {[
                  ["Factura original", summary?.gross_amount],
                  ["Notas registradas", summary?.credited_amount],
                  ["Total neto", summary?.net_amount],
                  ["Pagado", summary?.paid_amount],
                  ["Saldo pendiente", summary?.balance],
                ].map(([label, value]) => (
                  <div key={label} className="rounded border p-3">
                    <div className="text-xs text-slate-500">{label}</div>
                    <div className="mt-1 font-semibold">{money(value, currencyCode)}</div>
                  </div>
                ))}
              </div>

              {Number(summary?.supplier_credit_balance || 0) > 0 ? (
                <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  Saldo a favor con el proveedor: <b>{money(summary.supplier_credit_balance, currencyCode)}</b>
                </div>
              ) : null}

              <section>
                <h3 className="mb-2 font-semibold">Notas vinculadas</h3>
                {!notes.length ? (
                  <div className="rounded border border-dashed p-4 text-sm text-slate-500">Todavia no hay notas registradas.</div>
                ) : (
                  <div className="overflow-x-auto rounded border">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Fecha</th>
                          <th className="px-3 py-2">Numero</th>
                          <th className="px-3 py-2">Motivo</th>
                          <th className="px-3 py-2 text-right">Monto</th>
                          <th className="px-3 py-2">Estado</th>
                          <th className="px-3 py-2">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {notes.map((note) => (
                          <tr key={note.id}>
                            <td className="px-3 py-2">{String(note.note_date || "").slice(0, 10)}</td>
                            <td className="px-3 py-2 font-medium">{note.receipt_number}</td>
                            <td className="px-3 py-2">{note.reason}</td>
                            <td className="px-3 py-2 text-right">{money(note.amount_total, note.currency_code)}</td>
                            <td className="px-3 py-2">{note.status}</td>
                            <td className="px-3 py-2">
                              <div className="flex gap-2">
                                <button type="button" className="text-blue-700 underline" onClick={() => viewDetail(note.id)}>
                                  Ver
                                </button>
                                {String(user?.role || "").toLowerCase() === "admin" && note.status !== "anulada" ? (
                                  <button type="button" className="text-red-700 underline" onClick={() => cancelNote(note)}>
                                    Anular
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {detail ? (
                <section className="rounded border bg-slate-50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-semibold">Detalle {detail.receipt_number}</h3>
                    <button type="button" className="text-sm underline" onClick={() => setDetail(null)}>Ocultar</button>
                  </div>
                  <div className="grid gap-2 text-sm md:grid-cols-3">
                    <div>Timbrado: <b>{detail.timbrado_number || "-"}</b></div>
                    <div>IVA 10%: <b>{money(detail.iva_10, detail.currency_code)}</b></div>
                    <div>IVA 5%: <b>{money(detail.iva_5, detail.currency_code)}</b></div>
                  </div>
                  {detail.items?.length ? (
                    <div className="mt-3 overflow-x-auto rounded border bg-white">
                      <table className="min-w-full text-xs">
                        <thead className="bg-slate-100 text-left text-slate-500">
                          <tr><th className="px-2 py-1.5">Concepto</th><th className="px-2 py-1.5">Rubro</th><th className="px-2 py-1.5">IVA</th><th className="px-2 py-1.5 text-right">Importe</th></tr>
                        </thead>
                        <tbody className="divide-y">
                          {detail.items.map((item) => (
                            <tr key={item.id}><td className="px-2 py-1.5">{item.description}</td><td className="px-2 py-1.5">{item.expense_rubro || "SIN CLASIFICAR"}</td><td className="px-2 py-1.5">{Number(item.tax_rate) || 0}%</td><td className="px-2 py-1.5 text-right">{money(item.subtotal, detail.currency_code)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  {detail.audit?.length ? (
                    <div className="mt-3">
                      <div className="text-xs font-semibold uppercase text-slate-500">Historial de la nota</div>
                      <div className="mt-1 space-y-1 text-xs text-slate-600">
                        {detail.audit.map((event) => (
                          <div key={event.id}>{event.created_at ? new Date(event.created_at).toLocaleString("es-PY") : "-"} - {event.user_name || "Sistema"}: {event.action}{event.reason ? ` (${event.reason})` : ""}</div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {detail.attachments?.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {detail.attachments.map((file) => (
                        <a key={file.id} href={file.file_url} target="_blank" rel="noreferrer" className="text-sm text-blue-700 underline">
                          {file.file_name || "Comprobante"}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}

              <section className="border-t pt-5">
                <h3 className="mb-3 font-semibold">Registrar nota de credito</h3>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <label className="text-sm">
                    <span className="mb-1 block text-xs text-slate-500">Fecha</span>
                    <input type="date" className="w-full rounded border px-3 py-2" value={form.note_date} onChange={(event) => setForm((current) => ({ ...current, note_date: event.target.value }))} />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-xs text-slate-500">Numero de nota</span>
                    <input className="w-full rounded border px-3 py-2" value={form.receipt_number} onChange={(event) => setForm((current) => ({ ...current, receipt_number: event.target.value }))} />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-xs text-slate-500">Timbrado</span>
                    <input className="w-full rounded border px-3 py-2" value={form.timbrado_number} onChange={(event) => setForm((current) => ({ ...current, timbrado_number: event.target.value }))} />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-xs text-slate-500">Motivo</span>
                    <input className="w-full rounded border px-3 py-2" value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} />
                  </label>
                </div>

                <div className="mt-4 overflow-x-auto rounded border">
                  <table className="min-w-[850px] w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Concepto</th>
                        <th className="px-3 py-2 w-24">Cantidad</th>
                        <th className="px-3 py-2 w-36">Importe unitario</th>
                        <th className="px-3 py-2 w-28">IVA</th>
                        <th className="px-3 py-2 w-44">Rubro</th>
                        <th className="px-3 py-2 w-32 text-right">Subtotal</th>
                        <th className="px-3 py-2 w-20" />
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {items.map((item, index) => {
                        const subtotal = Number(item.quantity || 0) * Number(item.unit_price || 0);
                        return (
                          <tr key={index}>
                            <td className="p-2"><input className="w-full rounded border px-2 py-1.5" value={item.description} onChange={(event) => updateItem(index, "description", event.target.value)} /></td>
                            <td className="p-2"><input type="number" min="0" step="0.001" className="w-full rounded border px-2 py-1.5" value={item.quantity} onChange={(event) => updateItem(index, "quantity", event.target.value)} /></td>
                            <td className="p-2"><input type="number" min="0" step={step} className="w-full rounded border px-2 py-1.5" value={item.unit_price} onChange={(event) => updateItem(index, "unit_price", event.target.value)} /></td>
                            <td className="p-2">
                              <select className="w-full rounded border px-2 py-1.5" value={item.tax_rate} onChange={(event) => updateItem(index, "tax_rate", Number(event.target.value))}>
                                <option value={10}>10%</option>
                                <option value={5}>5%</option>
                                <option value={0}>Exento</option>
                              </select>
                            </td>
                            <td className="p-2">
                              <select className="w-full rounded border px-2 py-1.5" value={item.expense_rubro} onChange={(event) => updateItem(index, "expense_rubro", event.target.value)}>
                                {RUBROS.map((rubro) => <option key={rubro} value={rubro}>{rubro}</option>)}
                              </select>
                            </td>
                            <td className="p-2 text-right font-medium">{money(subtotal, currencyCode)}</td>
                            <td className="p-2">
                              <button type="button" className="text-red-700 underline disabled:text-slate-300" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Quitar</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <button type="button" className="mt-2 rounded border px-3 py-1.5 text-sm" onClick={() => setItems((current) => [...current, emptyItem(source?.expense_rubro)])}>
                  + Agregar item
                </button>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <textarea className="min-h-[80px] rounded border px-3 py-2" placeholder="Observaciones" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
                  <div className="space-y-2 rounded border p-3 text-sm">
                    <div className="flex justify-between"><span>IVA 10%</span><b>{money(itemTotals.iva10, currencyCode)}</b></div>
                    <div className="flex justify-between"><span>IVA 5%</span><b>{money(itemTotals.iva5, currencyCode)}</b></div>
                    <div className="flex justify-between"><span>Exento</span><b>{money(itemTotals.exempt, currencyCode)}</b></div>
                    <div className="flex justify-between border-t pt-2 text-base"><span>Total nota</span><b>{money(itemTotals.total, currencyCode)}</b></div>
                  </div>
                </div>
                <label className="mt-3 block text-sm">
                  <span className="mb-1 block text-xs text-slate-500">Comprobante PDF o imagen</span>
                  <input type="file" className="w-full rounded border px-3 py-2" accept="application/pdf,image/*" onChange={(event) => setAttachment(event.target.files?.[0] || null)} />
                </label>
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" className="rounded border px-4 py-2 text-sm" onClick={() => resetForm()}>Limpiar</button>
                  <button type="button" className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50" disabled={saving || remainingCredit <= 0.009} onClick={save}>
                    {saving ? "Guardando..." : "Registrar nota de credito"}
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

