// client/src/pages/PipelineEditorPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api";

/**
 * Editor de Pipeline (pantalla completa).
 * - Lista pipelines (selector)
 * - Lista etapas con nombre + orden
 * - Crear, renombrar, reordenar (subir/bajar), eliminar (mueve deals a etapa vecina)
 */
export default function PipelineEditorPage() {
  const nav = useNavigate();
  const { pipelineId: paramPid } = useParams();

  const [pipelines, setPipelines] = useState([]);
  const [pipelineId, setPipelineId] = useState(null);
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");

  // Carga lista de pipelines al montar
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data: p } = await api.get("/pipelines");
        setPipelines(p || []);
        const chosen = Number(paramPid) || p?.[0]?.id || null;
        setPipelineId(chosen);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Carga etapas cuando cambia pipelineId
  useEffect(() => {
    if (!pipelineId) return;
    (async () => {
      setLoading(true);
      try {
        const { data: s } = await api.get("/stages", { params: { pipeline_id: pipelineId } });
        setStages((s || []).sort((a, b) => (a.order_index || 0) - (b.order_index || 0)));
      } finally {
        setLoading(false);
      }
    })();
  }, [pipelineId]);

  const pipelineName = useMemo(() => {
    const found = pipelines.find((p) => p.id === pipelineId);
    return found?.name || `Pipeline ${pipelineId ?? ""}`;
  }, [pipelines, pipelineId]);

  // Helpers
  function resequence(list) {
    // re-asigna order_index espaciando de a 10
    return list.map((st, i) => ({ ...st, order_index: (i + 1) * 10 }));
  }

  async function persistOrder(next) {
    // Sin endpoint masivo => parcheamos cada etapa
    setSaving(true);
    try {
      for (const st of next) {
        await api.patch(`/stages/${st.id}`, { order_index: st.order_index });
      }
      setStages(next);
    } finally {
      setSaving(false);
    }
  }

  async function createStage() {
    const name = (newName || "").trim();
    if (!name || !pipelineId) return;
    setSaving(true);
    try {
      const { data } = await api.post("/stages", {
        pipeline_id: pipelineId,
        name,
      });
      setNewName("");
      setStages((prev) => resequence([...prev, data]));
      await persistOrder(resequence([...stages, data]));
    } finally {
      setSaving(false);
    }
  }

  async function renameStage(id, name) {
    setSaving(true);
    try {
      await api.patch(`/stages/${id}`, { name });
      setStages((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
    } finally {
      setSaving(false);
    }
  }

  function moveStage(id, dir) {
    // dir: -1 (arriba), +1 (abajo)
    const idx = stages.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= stages.length) return;
    const next = [...stages];
    const tmp = next[idx];
    next[idx] = next[j];
    next[j] = tmp;
    const withOrder = resequence(next);
    persistOrder(withOrder);
  }

  async function deleteStage(stage) {
    if (!window.confirm(`¿Eliminar etapa "${stage.name}"? Los deals se moverán a la etapa vecina.`))
      return;

    // Elegimos etapa vecina para mover deals (si hay)
    const idx = stages.findIndex((s) => s.id === stage.id);
    const neighbor = stages[idx - 1] || stages[idx + 1] || null;
    const target = neighbor ? neighbor.id : null;

    setSaving(true);
    try {
      const url = target
        ? `/stages/${stage.id}?target_stage_id=${target}`
        : `/stages/${stage.id}`;
      await api.delete(url);
      const next = stages.filter((s) => s.id !== stage.id);
      const withOrder = resequence(next);
      setStages(withOrder);
      await persistOrder(withOrder);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-sm text-slate-600">Cargando…</div>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow p-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Editar pipeline</h1>
          <p className="text-sm text-slate-600">
            Renombrá, reordená, agregá o eliminá columnas (etapas).
          </p>
        </div>
        <button
          className="px-3 py-2 text-sm rounded-lg border"
          onClick={() => nav(-1)}
        >
          ← Volver
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow p-4 space-y-3">
        {/* Selector de pipeline */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600">Pipeline:</span>
          <select
            className="border rounded-lg px-2 py-1 text-sm"
            value={pipelineId || ""}
            onChange={(e) => setPipelineId(Number(e.target.value) || null)}
          >
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (#{p.id})
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-500">({pipelineName})</span>
        </div>

        {/* Lista de etapas */}
        <div className="mt-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-2 w-12">#</th>
                <th className="py-2 pr-2">Nombre de la etapa</th>
                <th className="py-2 pr-2 w-44">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((st, i) => (
                <tr key={st.id} className="border-b last:border-0">
                  <td className="py-2 pr-2 text-slate-500">{i + 1}</td>
                  <td className="py-2 pr-2">
                    <input
                      className="w-full border rounded px-2 py-1"
                      value={st.name}
                      onChange={(e) =>
                        setStages((prev) =>
                          prev.map((s) => (s.id === st.id ? { ...s, name: e.target.value } : s))
                        )
                      }
                      onBlur={(e) => {
                        const val = e.target.value.trim();
                        if (val && val !== st.name) renameStage(st.id, val);
                      }}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex items-center gap-2">
                      <button
                        className="px-2 py-1 text-xs rounded border"
                        onClick={() => moveStage(st.id, -1)}
                        disabled={i === 0 || saving}
                        title="Subir"
                      >
                        ↑
                      </button>
                      <button
                        className="px-2 py-1 text-xs rounded border"
                        onClick={() => moveStage(st.id, +1)}
                        disabled={i === stages.length - 1 || saving}
                        title="Bajar"
                      >
                        ↓
                      </button>
                      <button
                        className="px-2 py-1 text-xs rounded border text-red-600"
                        onClick={() => deleteStage(st)}
                        disabled={saving}
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {/* Alta rápida */}
              <tr>
                <td className="py-2 pr-2 text-slate-500">+</td>
                <td className="py-2 pr-2">
                  <input
                    className="w-full border rounded px-2 py-1"
                    placeholder="Nueva etapa…"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && createStage()}
                  />
                </td>
                <td className="py-2 pr-2">
                  <button
                    className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white disabled:opacity-60"
                    onClick={createStage}
                    disabled={saving || !newName.trim()}
                  >
                    Agregar
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

          {saving && (
            <div className="text-xs text-slate-500 mt-2">Guardando cambios…</div>
          )}
        </div>
      </div>
    </div>
  );
}
