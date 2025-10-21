// client/src/pages/PipelineEditorPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { api } from "../api";

export default function PipelineEditorPage() {
  const nav = useNavigate();
  const location = useLocation();
  const { pipelineId: paramPid } = useParams();

  // ruta de retorno
  const back = useMemo(() => {
    const q = new URLSearchParams(location.search);
    return q.get("back") || "/";
  }, [location.search]);

  const [pipelines, setPipelines] = useState([]);
  const [pipelineId, setPipelineId] = useState(null);

  const [stages, setStages] = useState([]);       // estado editable
  const [origStages, setOrigStages] = useState([]); // foto original para detectar cambios
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [newName, setNewName] = useState("");

  /* ====== cargar pipelines ====== */
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
  }, []); // eslint-disable-line

  /* ====== cargar stages del pipeline seleccionado ====== */
  useEffect(() => {
    if (!pipelineId) return;
    (async () => {
      setLoading(true);
      try {
        const { data: s } = await api.get("/stages", { params: { pipeline_id: pipelineId } });
        const ordered = (s || []).sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
        setStages(ordered);
        setOrigStages(ordered);
        setDirty(false);
      } finally {
        setLoading(false);
      }
    })();
  }, [pipelineId]);

  const pipelineName = useMemo(() => {
    const found = pipelines.find((p) => p.id === pipelineId);
    return found?.name || `Pipeline ${pipelineId ?? ""}`;
  }, [pipelines, pipelineId]);

  /* ====== helpers ====== */
  function resequence(list) {
    return list.map((st, i) => ({ ...st, order_index: (i + 1) * 10 }));
  }
  function markDirty() {
    setDirty(true);
  }

  /* ====== acciones locales (no guardan hasta "Guardar cambios") ====== */
  function moveStage(id, dir) {
    const idx = stages.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= stages.length) return;
    const next = [...stages];
    [next[idx], next[j]] = [next[j], next[idx]];
    setStages(resequence(next));
    markDirty();
  }

  function changeName(id, name) {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
    markDirty();
  }

  /* ====== crear / eliminar (aplican de inmediato) ====== */
  async function createStage() {
    const name = (newName || "").trim();
    if (!name || !pipelineId) return;
    setSaving(true);
    try {
      // creamos para obtener id y luego dejamos el orden a guardar con el botón
      const { data } = await api.post("/stages", { pipeline_id: pipelineId, name });
      setNewName("");
      const withNew = resequence([...stages, data]);
      setStages(withNew);
      markDirty();
    } finally {
      setSaving(false);
    }
  }

  async function deleteStage(stage) {
    if (!window.confirm(`¿Eliminar etapa "${stage.name}"? Los deals se moverán a la etapa vecina.`)) return;

    const idx = stages.findIndex((s) => s.id === stage.id);
    const neighbor = stages[idx - 1] || stages[idx + 1] || null;
    const target = neighbor ? neighbor.id : null;

    setSaving(true);
    try {
      const url = target ? `/stages/${stage.id}?target_stage_id=${target}` : `/stages/${stage.id}`;
      await api.delete(url);

      const next = resequence(stages.filter((s) => s.id !== stage.id));
      setStages(next);
      // ajustamos la foto original también para que el diff no intente re-guardar algo que ya no existe
      setOrigStages(next);
      setDirty(true);
    } finally {
      setSaving(false);
    }
  }

  /* ====== GUARDAR CAMBIOS ====== */
  async function saveAll() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      // detectar cambios nombre/orden
      const origMap = new Map(origStages.map((s) => [s.id, s]));
      const toUpdate = [];

      for (const st of stages) {
        const prev = origMap.get(st.id);
        const changedName = !prev || String(prev.name) !== String(st.name);
        const changedOrder = !prev || Number(prev.order_index) !== Number(st.order_index);
        if (changedName || changedOrder) {
          toUpdate.push({
            id: st.id,
            name: st.name,
            order_index: st.order_index,
          });
        }
      }

      // PATCH en serie (puedes paralelizar si querés)
      for (const st of toUpdate) {
        await api.patch(`/stages/${st.id}`, {
          name: st.name,
          order_index: st.order_index,
        });
      }

      // foto nueva como base
      setOrigStages(stages);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-sm text-slate-600 p-4">Cargando…</div>;

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      {/* Header */}
      <div className="bg-white rounded-2xl shadow p-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Editar pipeline</h1>
          <p className="text-sm text-slate-600">
            Renombrá y reordená etapas. Podés agregar o eliminar columnas.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-2 text-sm rounded-lg border"
            onClick={() => nav(back)}
            title="Volver al kanban"
          >
            ← Volver
          </button>
          <button
            className="px-3 py-2 text-sm rounded-lg bg-black text-white disabled:opacity-50"
            onClick={saveAll}
            disabled={!dirty || saving}
            title="Guardar cambios de nombres y orden"
          >
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>

      {/* Contenido */}
      <div className="bg-white rounded-2xl shadow p-4 space-y-3 mt-4">
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
          {dirty && <span className="text-xs ml-2 px-2 py-0.5 rounded bg-amber-100 text-amber-800">Cambios sin guardar</span>}
        </div>

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
                      onChange={(e) => changeName(st.id, e.target.value)}
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

          {saving && !dirty && (
            <div className="text-xs text-slate-500 mt-2">Procesando…</div>
          )}
        </div>
      </div>
    </div>
  );
}
