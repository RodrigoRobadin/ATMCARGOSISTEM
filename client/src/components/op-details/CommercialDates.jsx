import { useEffect, useRef, useState } from "react";
import api from "../../api.js";

const methods = {
  email: "Correo",
  purchase_order: "Orden de compra",
  other: "Otro",
};

function dateOnly(value) {
  return value ? String(value).slice(0, 10) : "";
}

function remainingValidity(quotedOn, validity) {
  const match = String(validity || "").trim().match(/^(\d+)\s*d[ií]as?$/i);
  const days = match ? Number(match[1]) : null;
  if (!quotedOn || !Number.isInteger(days) || days <= 0) return null;
  const expiry = new Date(`${dateOnly(quotedOn)}T12:00:00Z`);
  expiry.setUTCDate(expiry.getUTCDate() + days);
  const nowParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type) => nowParts.find((entry) => entry.type === type)?.value;
  const today = Date.parse(`${part("year")}-${part("month")}-${part("day")}T12:00:00Z`);
  return Math.round((expiry.getTime() - today) / 86400000);
}

export default function CommercialDates({ deal, validity }) {
  const [dates, setDates] = useState(null);
  const [date, setDate] = useState("");
  const [method, setMethod] = useState("");
  const [file, setFile] = useState(null);
  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const { data } = await api.get(`/deals/${deal.id}/commercial-dates`);
    setDates(data);
    setDate(dateOnly(data.confirmed_on));
    setMethod(data.confirmation_method || "");
  }

  useEffect(() => {
    if (!deal?.id) return;
    let active = true;
    api.get(`/deals/${deal.id}/commercial-dates`)
      .then(({ data }) => {
        if (!active) return;
        setDates(data);
        setDate(dateOnly(data.confirmed_on));
        setMethod(data.confirmation_method || "");
      })
      .catch(() => { if (active) setError("No se pudieron cargar las fechas comerciales."); });
    return () => { active = false; };
  }, [deal?.id]);

  async function save(event) {
    event.preventDefault();
    if (!date || !method || (!file && !dates?.confirmation_file)) {
      setError("Completa fecha, medio y comprobante de confirmacion.");
      return;
    }
    setBusy(true);
    setError("");
    const body = new FormData();
    body.append("date", date);
    body.append("method", method);
    if (file) body.append("file", file);
    try {
      await api.post(`/deals/${deal.id}/confirmation`, body);
      await load();
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (saveError) {
      setError(saveError?.response?.data?.error || "No se pudo guardar la confirmacion.");
    } finally {
      setBusy(false);
    }
  }

  const remaining = remainingValidity(dates?.quoted_on, validity);

  return (
    <div className="grid grid-cols-1 gap-4 md:col-span-2 md:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Fecha de inicio</label>
        <input type="date" readOnly value={dateOnly(dates?.started_on || deal?.created_at)} className="w-full rounded border bg-slate-50 px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Fecha de cotizacion</label>
        <input type="date" readOnly value={dateOnly(dates?.quoted_on)} className="w-full rounded border bg-slate-50 px-3 py-2 text-sm" />
        {remaining !== null && (
          <p className={`mt-1 text-xs ${remaining < 0 ? "text-red-700" : "text-slate-600"}`}>
            {remaining < 0 ? `Oferta vencida hace ${Math.abs(remaining)} dias` : `${remaining} dias de validez restantes`}
          </p>
        )}
      </div>
      <form onSubmit={save} className="space-y-3 md:col-span-2">
        {dates?.confirmed_on && (
          <p className={`text-xs font-medium ${dates.confirmation_file ? "text-emerald-700" : "text-amber-700"}`}>
            {dates.confirmation_file ? "Venta confirmada" : "Comprobante pendiente para validar la confirmacion"}
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label htmlFor={`confirm-date-${deal?.id}`} className="mb-1 block text-xs font-medium text-slate-600">Fecha de confirmacion</label>
            <input id={`confirm-date-${deal?.id}`} type="date" required value={date} onChange={(event) => setDate(event.target.value)} className="w-full rounded border px-3 py-2 text-sm" />
          </div>
          <div>
            <label htmlFor={`confirm-method-${deal?.id}`} className="mb-1 block text-xs font-medium text-slate-600">Confirmado por</label>
            <select id={`confirm-method-${deal?.id}`} required value={method} onChange={(event) => setMethod(event.target.value)} className="w-full rounded border px-3 py-2 text-sm">
              <option value="">Seleccionar</option>
              {Object.entries(methods).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor={`confirm-file-${deal?.id}`} className="mb-1 block text-xs font-medium text-slate-600">Comprobante de aceptacion</label>
            <input ref={fileInputRef} id={`confirm-file-${deal?.id}`} type="file" accept=".pdf,.png,.jpg,.jpeg,.eml,.msg,.doc,.docx" onChange={(event) => setFile(event.target.files?.[0] || null)} className="block w-full text-sm" />
          </div>
          <button type="submit" disabled={busy || !date || !method || (!file && !dates?.confirmation_file)} className="rounded bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            {busy ? "Guardando..." : "Guardar confirmacion"}
          </button>
        </div>
        {dates?.confirmation_file && (
          <a className="text-sm text-blue-700 underline" href={`/api/deals/${deal.id}/files/${dates.confirmation_file.id}/download`} target="_blank" rel="noreferrer">
            Ver comprobante actual ({methods[dates.confirmation_method] || "Otro"})
          </a>
        )}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </form>
    </div>
  );
}
