// client/src/components/op-details/IndustrialQuotePanel.jsx
import React, { useEffect, useState, useRef, forwardRef, useImperativeHandle } from "react";
import { api } from "../../api";

const IndustrialQuotePanel = forwardRef(function IndustrialQuotePanel(
  { dealId, dealReference, onOpenCostSheet, readOnly, onFreightChange },
  ref
) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quote, setQuote] = useState(null);
  const [form, setForm] = useState({
    provider_dimensions: "",
    provider_weight: "",
    provider_value: "",
    freight_value: "",
    notes: "",
  });
  const providerFileRef = useRef(null);
  const freightFileRef = useRef(null);

  useEffect(() => {
    loadQuote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  async function loadQuote() {
    if (!dealId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/deals/${dealId}/industrial-quote`);
      setQuote(data);
      if (data) {
        setForm({
          provider_dimensions: data.provider_dimensions || "",
          provider_weight: data.provider_weight || "",
          provider_value: data.provider_value || "",
          freight_value: data.freight_value || "",
          notes: data.notes || "",
        });
      } else {
        setForm({
          provider_dimensions: "",
          provider_weight: "",
          provider_value: "",
          freight_value: "",
          notes: "",
        });
      }
    } catch (e) {
      console.error("No se pudo cargar cotización industrial:", e);
      setQuote(null);
    } finally {
      setLoading(false);
    }
  }

  function updateField(k, v) {
    setForm((prev) => ({ ...prev, [k]: v }));
    if (k === "freight_value" && typeof onFreightChange === "function") {
      onFreightChange(v);
    }
  }

  async function handleSubmit() {
    if (!dealId) return;
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v ?? ""));
    if (providerFileRef.current?.files?.[0]) {
      fd.append("provider_file", providerFileRef.current.files[0]);
    }
    if (freightFileRef.current?.files?.[0]) {
      fd.append("freight_file", freightFileRef.current.files[0]);
    }
    setSaving(true);
    try {
      await api.post(`/deals/${dealId}/industrial-quote`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await loadQuote();
      alert("Cotización guardada");
      if (providerFileRef.current) providerFileRef.current.value = "";
      if (freightFileRef.current) freightFileRef.current.value = "";
    } catch (e) {
      console.error("Error guardando cotización:", e);
      alert(e?.response?.data?.error || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  useImperativeHandle(ref, () => ({
    getData: () => form,
    setData: (d = {}) => setForm((prev) => ({ ...prev, ...d })),
    save: handleSubmit,
  }));

  return (
    <div className="bg-white rounded-2xl shadow p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-medium">Cotización industrial (proveedor + flete)</h3>
          <p className="text-xs text-slate-500">
            Referencia: {dealReference || dealId}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="px-3 py-1.5 text-xs rounded-lg border hover:bg-slate-50"
            onClick={() => onOpenCostSheet && onOpenCostSheet()}
          >
            Ver planilla de costos
          </button>
          <button
            className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:opacity-90 disabled:opacity-60"
            onClick={handleSubmit}
            disabled={saving || readOnly}
          >
            {saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-600">Cargando cotización...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="space-y-2">
            <div>
              <label className="text-xs text-slate-600">Dimensiones (proveedor)</label>
              <input
                className="border rounded px-2 py-1 w-full"
                value={form.provider_dimensions}
                onChange={(e) => updateField("provider_dimensions", e.target.value)}
                placeholder="Ej: 6000 x 5000 mm"
                disabled={readOnly}
              />
            </div>
            <div>
              <label className="text-xs text-slate-600">Peso (proveedor)</label>
              <input
                className="border rounded px-2 py-1 w-full"
                value={form.provider_weight}
                onChange={(e) => updateField("provider_weight", e.target.value)}
                placeholder="Ej: 450 kg"
                disabled={readOnly}
              />
            </div>
            <div>
              <label className="text-xs text-slate-600">Valor proveedor</label>
              <input
                className="border rounded px-2 py-1 w-full"
                value={form.provider_value}
                onChange={(e) => updateField("provider_value", e.target.value)}
                placeholder="Ej: USD 10,000"
                disabled={readOnly}
              />
            </div>
            <div>
              <label className="text-xs text-slate-600">Archivo proveedor</label>
              <input type="file" ref={providerFileRef} className="text-xs" disabled={readOnly} />
              {quote?.provider_url && (
                <div className="text-xs mt-1">
                  <a
                    className="text-blue-600 underline"
                    href={quote.provider_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ver archivo proveedor
                  </a>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <label className="text-xs text-slate-600">Precio flete</label>
              <input
                className="border rounded px-2 py-1 w-full"
                value={form.freight_value}
                onChange={(e) => updateField("freight_value", e.target.value)}
                placeholder="Ej: USD 2,000"
                disabled={readOnly}
              />
            </div>
            <div>
              <label className="text-xs text-slate-600">Archivo flete</label>
              <input type="file" ref={freightFileRef} className="text-xs" disabled={readOnly} />
              {quote?.freight_url && (
                <div className="text-xs mt-1">
                  <a
                    className="text-blue-600 underline"
                    href={quote.freight_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ver archivo flete
                  </a>
                </div>
              )}
            </div>
            <div>
              <label className="text-xs text-slate-600">Notas</label>
              <textarea
                className={`border rounded px-2 py-1 w-full ${readOnly ? "bg-slate-50" : ""}`}
                rows={4}
                value={form.notes}
                onChange={(e) => updateField("notes", e.target.value)}
                placeholder="Notas o condiciones"
                disabled={readOnly}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default IndustrialQuotePanel;
