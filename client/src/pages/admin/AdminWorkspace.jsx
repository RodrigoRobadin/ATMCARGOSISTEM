// client/src/pages/admin/AdminWorkspace.jsx
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import PipelineView from "./sections/PipelineView.jsx";
import TableView from "./sections/TableView.jsx";
import DocsDrawer from "./sections/DocsDrawer.jsx";

const STAGE_ANCHOR_NAME = "Conf a Coord";

export default function AdminWorkspace() {
  const [view, setView] = useState("pipeline"); // pipeline | table
  const [pipelineId, setPipelineId] = useState(1);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [ops, setOps] = useState([]);
  const [stages, setStages] = useState([]);

  const [selectedOp, setSelectedOp] = useState(null);
  const [showDocs, setShowDocs] = useState(false);

  // --------- loaders ---------
  async function loadStages(pid) {
    // OJO: sin /api al inicio
    const { data } = await api.get(`/admin/stages?pipeline_id=${pid}`);
    return Array.isArray(data) ? data : [];
  }
  async function loadOps(pid) {
    const ts = Date.now(); // anti-cache
    // OJO: sin /api al inicio
    const { data } = await api.get(
      `/admin/ops?pipeline_id=${pid}&from_stage=${encodeURIComponent(
        STAGE_ANCHOR_NAME
      )}&t=${ts}`
    );
    return Array.isArray(data) ? data : [];
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const [S, O] = await Promise.all([loadStages(pipelineId), loadOps(pipelineId)]);
        setStages(S);
        setOps(O);
      } catch (e) {
        console.error("Error cargando /admin:", e);
        setErr(e?.message || "No se pudo cargar la información.");
        setStages([]);
        setOps([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [pipelineId]);

  // --------- derived: columnas/etapas desde Anchor ---------
  const { stagesFromAnchor, anchorStageId } = useMemo(() => {
    // stages ya vienen ordenadas por order_index
    const anchor =
      stages.find((s) => s.name?.toLowerCase() === STAGE_ANCHOR_NAME.toLowerCase()) ||
      stages[0];

    let sliced = stages;
    if (anchor) {
      const idx = stages.findIndex((s) => s.id === anchor.id);
      if (idx >= 0) sliced = stages.slice(idx);
    }

    return { stagesFromAnchor: sliced, anchorStageId: anchor?.id || null };
  }, [stages]);

  // --------- actions ----------
  const openDocs = (op) => {
    setSelectedOp(op);
    setShowDocs(true);
  };
  const closeDocs = () => {
    setShowDocs(false);
    setSelectedOp(null);
  };

  async function changeStage(opId, newStageId) {
    try {
      // OJO: sin /api al inicio
      const { data } = await api.patch(`/admin/ops/${opId}/stage`, {
        stage_id: Number(newStageId),
      });
      // Reflejar al instante
      setOps((prev) => prev.map((x) => (x.id === opId ? { ...x, ...data } : x)));
    } catch (e) {
      console.error("changeStage error", e);
      alert("No se pudo cambiar la etapa");
    }
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Administración (Operaciones)</h1>
          <p className="text-slate-500 text-sm">
            Gestión de operaciones confirmadas: documentos, compras y facturación.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="border rounded-lg px-2 py-1"
            value={pipelineId}
            onChange={(e) => setPipelineId(Number(e.target.value))}
          >
            <option value={1}>Pipeline 1</option>
          </select>

          <div className="inline-flex rounded-lg border overflow-hidden">
            <button
              className={`px-3 py-1.5 text-sm ${
                view === "pipeline" ? "bg-slate-900 text-white" : "bg-white"
              }`}
              onClick={() => setView("pipeline")}
            >
              Pipeline
            </button>
            <button
              className={`px-3 py-1.5 text-sm ${
                view === "table" ? "bg-slate-900 text-white" : "bg-white"
              }`}
              onClick={() => setView("table")}
            >
              Tabla
            </button>
          </div>
        </div>
      </div>

      {loading && <div className="text-slate-500">Cargando…</div>}
      {!loading && err && (
        <div className="mb-3 text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">
          {err}
        </div>
      )}

      {!loading && !err && ops.length === 0 && (
        <div className="text-slate-500 text-sm">
          No se encontraron operaciones desde <b>{STAGE_ANCHOR_NAME}</b> en adelante.
        </div>
      )}

      {!loading && !err && ops.length > 0 && view === "pipeline" && (
        <PipelineView
          stages={stagesFromAnchor}
          items={ops}
          anchorStageId={anchorStageId}
          stageOptions={stages.map((s) => ({ value: s.id, label: s.name }))}
          onChangeStage={changeStage}
          onOpenDocs={openDocs}
        />
      )}

      {!loading && !err && ops.length > 0 && view === "table" && (
        <TableView
          items={ops}
          stageOptions={stages.map((s) => ({ value: s.id, label: s.name }))}
          onChangeStage={changeStage}
          onOpenDocs={openDocs}
          showInTransit
        />
      )}

      <DocsDrawer open={showDocs} onClose={closeDocs} op={selectedOp} />
    </div>
  );
}
