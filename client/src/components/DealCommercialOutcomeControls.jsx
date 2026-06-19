import React, { useEffect, useRef, useState } from "react";
import { api } from "../api";

export const LOSS_REASONS = [
  { value: "precio", label: "Precio" },
  { value: "competencia", label: "Competencia" },
  { value: "plazo", label: "Plazo" },
  { value: "sin_presupuesto", label: "Cliente sin presupuesto" },
  { value: "sin_respuesta", label: "Sin respuesta" },
  { value: "requisito_tecnico", label: "Requisito técnico" },
  { value: "postergado", label: "Postergado" },
  { value: "otro", label: "Otro" },
];

export function DealOutcomeContextMenu({ deal, position, onClose, onMarkNotClosed }) {
  const ref = useRef(null);

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (!ref.current?.contains(event.target)) onClose();
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  if (!deal || !position) return null;
  const left = Math.min(position.x, Math.max(12, window.innerWidth - 240));
  const top = Math.min(position.y, Math.max(12, window.innerHeight - 90));

  return (
    <div
      ref={ref}
      className="fixed z-[100] min-w-56 rounded-lg border bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-950"
      style={{ left, top }}
      role="menu"
    >
      <button
        type="button"
        className="w-full rounded px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
        onClick={() => {
          onMarkNotClosed(deal);
          onClose();
        }}
      >
        Marcar como no cerrada
      </button>
    </div>
  );
}

export function MarkDealNotClosedModal({ deal, onClose, onSaved }) {
  const [reasonCategory, setReasonCategory] = useState(LOSS_REASONS[0].value);
  const [reasonDetail, setReasonDetail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!deal) return null;

  async function submit(event) {
    event.preventDefault();
    const detail = reasonDetail.trim();
    if (!detail) {
      setError("Explica por qué no se cerró la venta.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.post(`/deals/${deal.id}/mark-not-closed`, {
        reason_category: reasonCategory,
        reason_detail: detail,
      });
      await onSaved?.();
      onClose();
    } catch (requestError) {
      setError(requestError?.response?.data?.error || "No se pudo actualizar la operación.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-4">
      <form className="w-full max-w-lg rounded-lg bg-white p-5 shadow-2xl dark:bg-slate-950" onSubmit={submit}>
        <h2 className="text-lg font-semibold">Marcar como no cerrada</h2>
        <p className="mt-1 text-sm text-slate-500">
          {deal.reference || deal.title || `Operación #${deal.id}`} se conservará con sus documentos e historial.
        </p>

        <label className="mt-4 block text-sm font-medium">
          Motivo
          <select
            className="mt-1 w-full rounded border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            value={reasonCategory}
            onChange={(event) => setReasonCategory(event.target.value)}
            disabled={saving}
          >
            {LOSS_REASONS.map((reason) => (
              <option key={reason.value} value={reason.value}>{reason.label}</option>
            ))}
          </select>
        </label>

        <label className="mt-4 block text-sm font-medium">
          ¿Por qué no se cerró la venta?
          <textarea
            className="mt-1 min-h-28 w-full rounded border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            value={reasonDetail}
            onChange={(event) => setReasonDetail(event.target.value)}
            placeholder="Detalle obligatorio"
            disabled={saving}
            autoFocus
          />
        </label>

        {error ? <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-2 text-sm" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="rounded bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-60" disabled={saving}>
            {saving ? "Guardando..." : "Confirmar no cerrada"}
          </button>
        </div>
      </form>
    </div>
  );
}
