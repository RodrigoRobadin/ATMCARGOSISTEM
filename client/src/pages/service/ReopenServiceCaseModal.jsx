import React, { useEffect, useState } from "react";
import { api } from "../../api";

export default function ReopenServiceCaseModal({ serviceCase, onClose, onSaved }) {
  const [stages, setStages] = useState([]);
  const [stageId, setStageId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!serviceCase) return;
    let live = true;
    setLoading(true);
    api.get("/service/stages", { params: { pipeline_id: serviceCase.pipeline_id || 1 } })
      .then(({ data }) => { if (live) setStages(Array.isArray(data) ? data : []); })
      .catch(() => { if (live) setError("No se pudieron cargar las etapas."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [serviceCase?.id, serviceCase?.pipeline_id]);

  if (!serviceCase) return null;

  async function submit(event) {
    event.preventDefault();
    if (!stageId) return setError("Selecciona una etapa.");
    setSaving(true);
    setError("");
    try {
      await api.post(`/service/cases/${serviceCase.id}/reopen-commercial`, { stage_id: Number(stageId) });
      await onSaved?.(Number(stageId), stages.find((stage) => Number(stage.id) === Number(stageId))?.name || "");
      onClose();
    } catch (requestError) {
      setError(requestError?.response?.data?.error || "No se pudo rehabilitar el servicio.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-4">
      <form className="w-full max-w-lg rounded-lg bg-white p-5 shadow-2xl" onSubmit={submit}>
        <h2 className="text-lg font-semibold">Rehabilitar servicio</h2>
        <p className="mt-1 text-sm text-slate-500">{serviceCase.reference || `Servicio #${serviceCase.id}`} volvera al pipeline activo.</p>
        <label className="mt-4 block text-sm font-medium">Etapa de reapertura
          <select className="mt-1 w-full rounded border px-3 py-2" value={stageId} onChange={(event) => setStageId(event.target.value)} disabled={loading || saving}>
            <option value="">Seleccionar etapa</option>
            {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
          </select>
        </label>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-2 text-sm" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="rounded bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-50" disabled={loading || saving || !stageId}>{saving ? "Guardando..." : "Rehabilitar"}</button>
        </div>
      </form>
    </div>
  );
}
