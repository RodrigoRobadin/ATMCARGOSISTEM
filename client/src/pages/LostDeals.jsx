import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { LOSS_REASONS } from "../components/DealCommercialOutcomeControls.jsx";

const reasonLabel = (value) =>
  LOSS_REASONS.find((reason) => reason.value === value)?.label || value || "-";

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("es-PY");
};

function ReopenDealModal({ deal, onClose, onSaved }) {
  const [stages, setStages] = useState([]);
  const [stageId, setStageId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!deal?.pipeline_id) return;
    setLoading(true);
    api
      .get(`/pipelines/${deal.pipeline_id}/stages`)
      .then(({ data }) => {
        const rows = Array.isArray(data) ? data : [];
        setStages(rows);
        setStageId("");
      })
      .catch(() => {
        setStages([]);
        setError("No se pudieron cargar las etapas disponibles.");
      })
      .finally(() => setLoading(false));
  }, [deal]);

  if (!deal) return null;

  async function submit(event) {
    event.preventDefault();
    if (!stageId) {
      setError("Selecciona la etapa a la que volverá la operación.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.post(`/deals/${deal.id}/reopen-commercial`, { stage_id: Number(stageId) });
      await onSaved?.();
      onClose();
    } catch (requestError) {
      setError(requestError?.response?.data?.error || "No se pudo rehabilitar la operación.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-4">
      <form className="w-full max-w-lg rounded-lg bg-white p-5 shadow-2xl dark:bg-slate-950" onSubmit={submit}>
        <h2 className="text-lg font-semibold">Rehabilitar operación</h2>
        <p className="mt-1 text-sm text-slate-500">
          {deal.reference || deal.title || `Operación #${deal.id}`} volverá al Kanban activo en la etapa elegida.
        </p>
        {deal.stage_name ? <p className="mt-2 text-xs text-slate-500">Última etapa antes del cierre: {deal.stage_name}</p> : null}
        <label className="mt-4 block text-sm font-medium">
          Etapa de reapertura
          <select
            className="mt-1 w-full rounded border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            value={stageId}
            onChange={(event) => setStageId(event.target.value)}
            disabled={loading || saving}
          >
            <option value="">Seleccionar etapa</option>
            {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
          </select>
        </label>
        {error ? <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-2 text-sm" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="rounded bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-60" disabled={loading || saving}>
            {saving ? "Rehabilitando..." : "Rehabilitar"}
          </button>
        </div>
      </form>
    </div>
  );
}

function OutcomeHistoryModal({ deal, onClose }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!deal?.id) return;
    api
      .get(`/deals/${deal.id}/commercial-outcome-history`)
      .then(({ data }) => setRows(Array.isArray(data) ? data : []))
      .catch((requestError) => setError(requestError?.response?.data?.error || "No se pudo cargar el historial."));
  }, [deal]);

  if (!deal) return null;
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-2xl dark:bg-slate-950">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Historial comercial</h2>
            <p className="text-sm text-slate-500">{deal.reference || deal.title || `Operación #${deal.id}`}</p>
          </div>
          <button type="button" className="rounded border px-3 py-2 text-sm" onClick={onClose}>Cerrar</button>
        </div>
        {error ? <div className="mt-4 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div> : null}
        <div className="mt-4 max-h-[55vh] space-y-3 overflow-auto">
          {rows.map((row) => (
            <div key={row.id} className="rounded border p-3 text-sm dark:border-slate-800">
              <div className="font-medium">{row.event_type === "reopened" ? "Operación rehabilitada" : "Marcada como no cerrada"}</div>
              <div className="mt-1 text-xs text-slate-500">{formatDate(row.created_at)} · {row.actor_name || "Usuario"}</div>
              {row.reason_category ? <div className="mt-2">Motivo: {reasonLabel(row.reason_category)}</div> : null}
              {row.reason_detail ? <div className="mt-1 whitespace-pre-wrap text-slate-600 dark:text-slate-300">{row.reason_detail}</div> : null}
              {row.event_type === "reopened" ? <div className="mt-2 text-xs text-slate-500">Etapa: {row.from_stage_name || "-"} → {row.to_stage_name || "-"}</div> : null}
            </div>
          ))}
          {!rows.length && !error ? <div className="text-sm text-slate-500">Sin movimientos registrados.</div> : null}
        </div>
      </div>
    </div>
  );
}

export default function LostDeals() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [dealToReopen, setDealToReopen] = useState(null);
  const [dealHistory, setDealHistory] = useState(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/deals", { params: { commercial_outcome: "lost", limit: 500 } });
      setRows(Array.isArray(data) ? data : []);
    } catch (requestError) {
      setError(requestError?.response?.data?.error || "No se pudieron cargar las operaciones no cerradas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => [row.reference, row.title, row.org_name, row.deal_advisor_name, row.lost_reason_detail]
      .some((value) => String(value || "").toLowerCase().includes(needle)));
  }, [rows, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Operaciones no cerradas</h1>
          <p className="text-sm text-slate-500">Oportunidades preservadas para análisis, seguimiento o rehabilitación.</p>
        </div>
        <button type="button" className="rounded border px-3 py-2 text-sm" onClick={load}>Actualizar</button>
      </div>

      <input
        className="w-full max-w-md rounded border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Buscar por operación, cliente, comercial o motivo"
      />

      {error ? <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {loading ? <div className="text-sm text-slate-500">Cargando...</div> : null}

      {!loading ? (
        <div className="overflow-auto rounded-lg border bg-white dark:border-slate-800 dark:bg-slate-950">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600 dark:bg-slate-900 dark:text-slate-300">
              <tr>
                <th className="px-3 py-2">Operación</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Comercial</th>
                <th className="px-3 py-2">Última etapa</th>
                <th className="px-3 py-2">Motivo</th>
                <th className="px-3 py-2">Marcada el</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id} className="border-t align-top dark:border-slate-800">
                  <td className="px-3 py-3">
                    <Link to={`/operations/${row.id}`} className="font-medium text-blue-700 hover:underline dark:text-blue-300">
                      {row.reference || row.title || `#${row.id}`}
                    </Link>
                    <div className="text-xs text-slate-500">{row.business_unit_name || "-"}</div>
                  </td>
                  <td className="px-3 py-3">{row.org_name || "-"}</td>
                  <td className="px-3 py-3">{row.deal_advisor_name || "-"}</td>
                  <td className="px-3 py-3">{row.stage_name || "-"}</td>
                  <td className="max-w-sm px-3 py-3">
                    <div className="font-medium">{reasonLabel(row.lost_reason_category)}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-slate-500">{row.lost_reason_detail || "-"}</div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">{formatDate(row.lost_at)}</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <button type="button" className="mr-2 rounded border px-2 py-1 text-xs" onClick={() => setDealHistory(row)}>Historial</button>
                    <button type="button" className="rounded bg-emerald-700 px-2 py-1 text-xs text-white" onClick={() => setDealToReopen(row)}>Rehabilitar</button>
                  </td>
                </tr>
              ))}
              {!filteredRows.length ? <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No hay operaciones no cerradas.</td></tr> : null}
            </tbody>
          </table>
        </div>
      ) : null}

      <ReopenDealModal deal={dealToReopen} onClose={() => setDealToReopen(null)} onSaved={load} />
      <OutcomeHistoryModal deal={dealHistory} onClose={() => setDealHistory(null)} />
    </div>
  );
}
