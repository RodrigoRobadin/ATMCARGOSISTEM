import React, { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth.jsx';

export default function OperationWorkCompletion({ deal, onChanged }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const completed = Boolean(deal?.work_completed_at);
  const canChange = /^OP-\d+$/i.test(String(deal?.reference || '')) &&
    (String(user?.role || '').toLowerCase() === 'admin' ||
      Number(deal?.deal_advisor_user_id || 0) === Number(user?.id || 0));
  const event = deal?.work_completion;

  return <>
    {completed && <div className="w-full text-sm text-emerald-800" role="status">
      <strong>Trabajo finalizado · Aprobado</strong>
      {event?.created_at && ` · ${new Date(event.created_at).toLocaleDateString('es-PY')}`}
      {event?.actor_name && ` · ${event.actor_name}`}
      {event?.note && <span className="block text-xs text-emerald-700">{event.note}</span>}
    </div>}
    {canChange && <button type="button" onClick={() => setOpen(true)}
      className={`rounded-lg border px-3 py-1.5 text-xs whitespace-nowrap ${completed ? 'border-slate-300' : 'border-emerald-600 text-emerald-800'}`}>
      {completed ? 'Reabrir trabajo' : 'Finalizar trabajo'}
    </button>}
    {open && <WorkCompletionDialog deal={deal} onClose={() => setOpen(false)} onChanged={onChanged} />}
  </>;
}

export function WorkCompletionDialog({ deal, onClose, onChanged }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const completed = Boolean(deal?.work_completed_at);

  async function submit() {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await api.post(`/deals/${deal.id}/work-completion`, {
        action: completed ? 'reopen' : 'complete',
        note: note.trim(),
      });
      const { data } = await api.get(`/deals/${deal.id}`);
      await onChanged(data.deal);
      onClose();
    } catch (requestError) {
      setError(requestError?.response?.data?.error || 'No se pudo actualizar el trabajo.');
    } finally {
      setSaving(false);
    }
  }

  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(eventTarget) => { if (eventTarget.target === eventTarget.currentTarget && !saving) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="work-completion-title"
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 id="work-completion-title" className="text-base font-semibold text-slate-900">
          {completed ? 'Reabrir trabajo' : 'Finalizar trabajo como aprobado'}
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          {completed
            ? 'La operación volverá al pipeline activo. Las tareas canceladas al finalizar permanecerán en el historial.'
            : 'La operación saldrá del pipeline activo y se detendrán sus recordatorios pendientes. Esto no cambia la confirmación del cliente ni la facturación.'}
        </p>
        <label htmlFor="work-completion-note" className="mt-4 block text-sm font-medium text-slate-700">Nota (opcional)</label>
        <textarea id="work-completion-note" value={note} onChange={(eventTarget) => setNote(eventTarget.target.value)}
          maxLength={2000} rows={3} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-md border px-3 py-2 text-sm">Cancelar</button>
          <button type="button" onClick={submit} disabled={saving}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            {saving ? 'Guardando...' : completed ? 'Reabrir' : 'Finalizar'}
          </button>
        </div>
      </div>
    </div>;
}
