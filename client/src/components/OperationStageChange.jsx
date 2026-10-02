import React, { useEffect, useState } from 'react';
import api from '../api.js';
import { useAuth } from '../auth.jsx';

export default function OperationStageChange({ deal, onChanged }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [stages, setStages] = useState([]);
  const [currentStageId, setCurrentStageId] = useState('');
  const [selectedStageId, setSelectedStageId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isOperation = /^OP-\d+$/i.test(String(deal?.reference || ''));
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const isAdvisor = Number(deal?.deal_advisor_user_id) > 0 &&
    Number(deal.deal_advisor_user_id) === Number(user?.id);
  const canChange = isOperation && Boolean(deal?.pipeline_id) && (isAdmin || isAdvisor);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setLoading(true);
    setError('');
    setStages([]);

    Promise.all([
      api.get(`/pipelines/${deal.pipeline_id}/stages`),
      api.get(`/deals/${deal.id}`),
    ]).then(([stageResponse, dealResponse]) => {
      if (!active) return;
      const list = Array.isArray(stageResponse.data) ? stageResponse.data : [];
      const latestStageId = String(dealResponse.data?.deal?.stage_id || deal.stage_id || '');
      setStages(list);
      setCurrentStageId(latestStageId);
      setSelectedStageId(latestStageId);
    }).catch((requestError) => {
      if (active) setError(requestError?.response?.data?.error || 'No se pudieron cargar las etapas.');
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, [open, deal?.id, deal?.pipeline_id]);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === 'Escape' && !saving) setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, saving]);

  async function save() {
    const stage = stages.find((item) => String(item.id) === selectedStageId);
    if (!stage || selectedStageId === currentStageId || saving) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await api.patch(`/deals/${deal.id}`, { stage_id: Number(stage.id) });
      onChanged({
        stage_id: Number(stage.id),
        stage_name: stage.name,
        reference: data?.reference || deal.reference,
      });
      setOpen(false);
    } catch (requestError) {
      setError(requestError?.response?.data?.error || 'No se pudo cambiar el estado.');
    } finally {
      setSaving(false);
    }
  }

  const unavailableReason = !isOperation
    ? 'Los prospectos se convierten desde el pipeline.'
    : !deal?.pipeline_id
      ? 'La operación no tiene un pipeline asignado.'
      : 'Solo el administrador o el ejecutivo asignado puede cambiar el estado.';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!canChange}
        title={canChange ? 'Elegir etapa del pipeline' : unavailableReason}
        className="rounded-lg border px-3 py-1.5 text-xs whitespace-nowrap hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Cambiar de estado
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
          onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setOpen(false); }}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="change-stage-title" className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h2 id="change-stage-title" className="text-base font-semibold text-slate-900">Cambiar de estado</h2>
            <p className="mt-1 text-sm text-slate-600">{deal.reference} · {deal.pipeline_name || 'Pipeline'}</p>

            <label className="mt-5 block text-sm font-medium text-slate-700" htmlFor="operation-stage-select">Estado del pipeline</label>
            <select
              id="operation-stage-select"
              value={selectedStageId}
              onChange={(event) => { setSelectedStageId(event.target.value); setError(''); }}
              disabled={loading || saving || !stages.length}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">{loading ? 'Cargando etapas...' : 'Seleccionar estado'}</option>
              {stages.map((stage) => <option key={stage.id} value={String(stage.id)}>{stage.name}</option>)}
            </select>
            {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={saving} className="rounded-md border px-3 py-2 text-sm disabled:opacity-50">Cancelar</button>
              <button
                type="button"
                onClick={save}
                disabled={loading || saving || !selectedStageId || selectedStageId === currentStageId}
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? 'Guardando...' : 'Guardar estado'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
