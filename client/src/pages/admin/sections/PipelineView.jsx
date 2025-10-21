// client/src/pages/admin/sections/PipelineView.jsx
import React, { useMemo } from "react";
import { Link } from "react-router-dom";

const fmtDateTime = (v) => {
  if (!v) return "—";
  try {
    const d = new Date(v);
    return d.toLocaleString();
  } catch {
    return v;
  }
};

export default function PipelineView({
  stages,
  items,
  anchorStageId,
  stageOptions,
  onChangeStage,
  onOpenDocs,
}) {
  // agrupar por stage_id
  const itemsByStage = useMemo(() => {
    const map = new Map(stages.map((s) => [s.id, []]));
    for (const it of items) {
      if (map.has(it.stage_id)) map.get(it.stage_id).push(it);
    }
    // orden por actualizado desc
    for (const [k, arr] of map) {
      arr.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    }
    return map;
  }, [stages, items]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {stages.map((stage) => (
        <div key={stage.id} className="bg-white border rounded-lg overflow-hidden">
          <div
            className={`px-3 py-2 border-b font-semibold ${
              stage.id === anchorStageId ? "bg-slate-900 text-white" : "bg-slate-50"
            }`}
          >
            {stage.name}
          </div>
          <div className="p-3 space-y-3">
            {(itemsByStage.get(stage.id) || []).map((op) => (
              <div key={op.id} className="border rounded p-3 space-y-2">
                <div className="flex justify-between">
                  <Link to={`/operations/${op.id}`} className="font-medium hover:underline">
                    {op.reference}
                  </Link>
                  <span className="text-xs text-slate-500">{op.transport_type}</span>
                </div>

                <div className="text-sm">
                  <div className="text-slate-600">{op.org_name || "—"}</div>
                  <div className="text-slate-500">Act: {fmtDateTime(op.updated_at)}</div>
                </div>

                {/* Chip En tránsito (solo indicador, no cambia look) */}
                <div className="flex items-center gap-2">
                  <span className="text-xs">En tránsito:</span>
                  <span
                    className={`px-2 py-0.5 text-xs rounded ${
                      op.in_transit ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {op.in_transit ? "Sí" : "No"}
                  </span>
                </div>

                {/* Cambio de etapa (selector compacto para no romper el estilo) */}
                <div>
                  <label className="text-xs text-slate-500">Mover a etapa:</label>
                  <select
                    className="border rounded px-2 py-1 w-full"
                    value={op.stage_id}
                    onChange={(e) => onChangeStage(op.id, e.target.value)}
                  >
                    {stageOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-2 pt-1">
                  <Link className="btn" to={`/api/reports/status/view/${op.id}`} target="_blank">
                    Informe
                  </Link>
                  <button className="btn" onClick={() => onOpenDocs(op)}>
                    Documentos
                  </button>
                  <button className="btn" onClick={() => alert("Emitir factura (pendiente)")}>
                    Facturar
                  </button>
                </div>
              </div>
            ))}
            {(itemsByStage.get(stage.id) || []).length === 0 && (
              <div className="text-sm text-slate-400 text-center py-4">Sin operaciones</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
