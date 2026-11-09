import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { History, RefreshCw, RotateCcw, Search } from "lucide-react";
import { api } from "../api";
import { LOSS_REASONS } from "../components/DealCommercialOutcomeControls.jsx";
import ReopenServiceCaseModal from "./service/ReopenServiceCaseModal.jsx";

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
      <form className="atm-lost-modal w-full max-w-lg p-5" onSubmit={submit}>
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
          <button type="button" className="atm-secondary rounded-md px-3 py-2 text-sm" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="atm-primary rounded-md px-3 py-2 text-sm disabled:opacity-60" disabled={loading || saving}>
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
      .get(deal.source_type === "service" ? `/service/cases/${deal.id}/commercial-outcome-history` : `/deals/${deal.id}/commercial-outcome-history`)
      .then(({ data }) => setRows(Array.isArray(data) ? data : []))
      .catch((requestError) => setError(requestError?.response?.data?.error || "No se pudo cargar el historial."));
  }, [deal]);

  if (!deal) return null;
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-4">
      <div className="atm-lost-modal w-full max-w-2xl p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Historial comercial</h2>
            <p className="text-sm text-slate-500">{deal.reference || deal.title || `Operación #${deal.id}`}</p>
          </div>
          <button type="button" className="atm-secondary rounded-md px-3 py-2 text-sm" onClick={onClose}>Cerrar</button>
        </div>
        {error ? <div className="mt-4 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div> : null}
        <div className="mt-4 max-h-[55vh] space-y-3 overflow-auto">
          {rows.map((row) => (
            <div key={row.id} className="atm-lost-history-entry border-l-2 py-2 pl-3 text-sm">
              <div className="font-medium">{row.event_type === "reopened" ? "Operación rehabilitada" : "Marcada como no cerrada"}</div>
              <div className="mt-1 text-xs text-slate-500">{formatDate(row.created_at)} · {row.actor_name || "Usuario"}</div>
              {row.reason_category ? <div className="mt-2">Motivo: {reasonLabel(row.reason_category)}</div> : null}
              {row.reason_detail ? <div className="mt-1 whitespace-pre-wrap text-slate-600 dark:text-slate-300">{row.reason_detail}</div> : null}
              {row.event_type === "reopened" ? <div className="mt-2 text-xs text-slate-500">Etapa: {row.stage_name || row.to_stage_name || "-"}</div> : null}
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
      const [dealsResult, servicesResult] = await Promise.allSettled([
        api.get("/deals", { params: { commercial_outcome: "lost", limit: 500 } }),
        api.get("/service/cases", { params: { commercial_outcome: "lost" } }),
      ]);
      if (dealsResult.status === "rejected" && servicesResult.status === "rejected") throw dealsResult.reason;
      const deals = dealsResult.status === "fulfilled" && Array.isArray(dealsResult.value.data)
        ? dealsResult.value.data.map((row) => ({ ...row, source_type: "deal" })) : [];
      const services = servicesResult.status === "fulfilled" && Array.isArray(servicesResult.value.data)
        ? servicesResult.value.data.map((row) => ({ ...row, source_type: "service", business_unit_name: "Servicio y mantenimiento" })) : [];
      setRows([...deals, ...services].sort((a, b) => new Date(b.lost_at || 0) - new Date(a.lost_at || 0)));
      const sourceErrors = [];
      if (dealsResult.status === "rejected") sourceErrors.push("No se pudieron cargar las operaciones comerciales.");
      if (servicesResult.status === "rejected" && servicesResult.reason?.response?.status !== 403) {
        sourceErrors.push("No se pudieron cargar los servicios no cerrados.");
      }
      setError(sourceErrors.join(" "));
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
    return rows.filter((row) => [row.reference, row.title, row.org_name, row.deal_advisor_name, row.assigned_to_name, row.lost_reason_detail]
      .some((value) => String(value || "").toLowerCase().includes(needle)));
  }, [rows, query]);

  return (
    <div className="atm-lost min-w-0 space-y-5">
      <header className="atm-page-heading flex-wrap">
        <div>
          <h1>Operaciones no cerradas</h1>
          <p className="atm-page-subtitle">Oportunidades preservadas para análisis, seguimiento o rehabilitación</p>
        </div>
        <button type="button" className="atm-secondary inline-flex min-h-10 items-center gap-2 rounded-md px-4 text-sm font-medium" onClick={load}><RefreshCw size={16} /> Actualizar</button>
      </header>

      <div className="atm-lost-toolbar flex flex-wrap items-center justify-between gap-3">
        <label className="atm-lost-search flex min-w-0 items-center gap-2">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar operación, cliente, comercial o motivo"
            aria-label="Buscar operaciones no cerradas"
          />
        </label>
        <span className="atm-lost-count">{filteredRows.length} {filteredRows.length === 1 ? "operación" : "operaciones"}</span>
      </div>

      {error ? <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {loading ? <div className="text-sm text-slate-500">Cargando...</div> : null}

      {!loading ? (
        <div className="atm-lost-table overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="text-left">
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
                <tr key={`${row.source_type}-${row.id}`} className="border-t align-top">
                  <td className="px-3 py-3">
                    <Link to={row.source_type === "service" ? `/service/cases/${row.id}` : `/operations/${row.id}`} className="atm-lost-reference font-semibold hover:underline">
                      {row.reference || row.title || `#${row.id}`}
                    </Link>
                    <div className="text-xs text-slate-500">{row.business_unit_name || "-"}</div>
                  </td>
                  <td className="px-3 py-3">{row.org_name || "-"}</td>
                  <td className="px-3 py-3">{row.deal_advisor_name || row.assigned_to_name || "-"}</td>
                  <td className="px-3 py-3">{row.stage_name || "-"}</td>
                  <td className="max-w-sm px-3 py-3">
                    <div className="font-medium">{reasonLabel(row.lost_reason_category)}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-slate-500">{row.lost_reason_detail || "-"}</div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">{formatDate(row.lost_at)}</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <div className="flex justify-end gap-2">
                      <button type="button" className="atm-secondary inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs" onClick={() => setDealHistory(row)}><History size={14} /> Historial</button>
                      <button type="button" className="atm-primary inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs" onClick={() => setDealToReopen(row)}><RotateCcw size={14} /> Rehabilitar</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!filteredRows.length ? <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No hay operaciones no cerradas.</td></tr> : null}
            </tbody>
          </table>
        </div>
      ) : null}

      <ReopenDealModal deal={dealToReopen?.source_type === "deal" ? dealToReopen : null} onClose={() => setDealToReopen(null)} onSaved={load} />
      <ReopenServiceCaseModal serviceCase={dealToReopen?.source_type === "service" ? dealToReopen : null} onClose={() => setDealToReopen(null)} onSaved={load} />
      <OutcomeHistoryModal deal={dealHistory} onClose={() => setDealHistory(null)} />
    </div>
  );
}
