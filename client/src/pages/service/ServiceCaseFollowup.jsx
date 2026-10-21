import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import OperationFollowupComposer from "../../components/OperationFollowupComposer.jsx";
import FollowupPinControl from "../../components/FollowupPinControl.jsx";
import { sortFollowupEntries } from "../../utils/followupPins.js";

const LABELS = {
  note: "Nota", activity: "Actividad", reminder: "Recordatorio", task: "Tarea",
  call: "Llamada", meeting: "Reunion", email: "Correo electronico",
};

export default function ServiceCaseFollowup({ serviceCase, currentUser }) {
  const caseId = serviceCase.id;
  const [entries, setEntries] = useState([]);
  const [pinningId, setPinningId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [entryType, setEntryType] = useState("activity");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState("medium");
  const [assignedTo, setAssignedTo] = useState("");
  const [markDone, setMarkDone] = useState(false);

  const loadEntries = useCallback(async () => {
    try {
      const { data } = await api.get(`/service/cases/${caseId}/followup-feed`);
      setEntries(sortFollowupEntries(Array.isArray(data?.items) ? data.items : []));
      setError("");
    } catch (requestError) {
      setError(requestError?.response?.data?.error || "No se pudo cargar el seguimiento.");
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    setEntries([]);
    setLoading(true);
    loadEntries();
  }, [loadEntries]);

  async function save() {
    if (saving) return;
    if (entryType === "note" ? !content.trim() : !title.trim() && !content.trim()) {
      setError("Completa el titulo o el contenido.");
      return;
    }
    if (entryType !== "note" && !dueAt) {
      setError("Completa la fecha y hora de vencimiento.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.post(`/service/cases/${caseId}/followup-feed`, {
        entry_type: entryType,
        title: title.trim(),
        content: content.trim(),
        due_at: dueAt,
        priority,
        assigned_to: assignedTo || currentUser?.id,
        done: markDone,
      });
      setTitle("");
      setContent("");
      setMarkDone(false);
      await loadEntries();
    } catch (requestError) {
      setError(requestError?.response?.data?.error || "No se pudo guardar el seguimiento.");
    } finally {
      setSaving(false);
    }
  }

  async function complete(entry) {
    try {
      await api.patch(`/service/cases/${caseId}/followup-feed/${entry.id}/done`);
      await loadEntries();
    } catch (requestError) {
      setError(requestError?.response?.data?.error || "No se pudo completar la actividad.");
    }
  }

  async function togglePin(entry) {
    if (pinningId) return;
    setPinningId(entry.id);
    setError("");
    try {
      await api.patch(`/service/cases/${caseId}/followup-feed/${entry.id}/pin`, { pinned: !entry.pinned });
      setEntries((current) => sortFollowupEntries(current.map((item) =>
        item.id === entry.id ? { ...item, pinned: !entry.pinned } : item
      )));
    } catch (requestError) {
      setError(requestError?.response?.data?.error || "No se pudo actualizar el anclaje.");
    } finally {
      setPinningId(null);
    }
  }

  const composerCase = {
    reference: serviceCase.reference || `Servicio ${caseId}`,
    org_name: serviceCase.org_name,
    contact_name: serviceCase.contact_name,
    contact_phone: serviceCase.contact_phone || serviceCase.org_phone,
    contact_email: serviceCase.contact_email || serviceCase.org_email,
  };

  return (
    <section className="space-y-4 rounded-lg border bg-white p-4">
      <h2 className="text-sm font-semibold">Seguimiento de la operacion</h2>
      <OperationFollowupComposer
        deal={composerCase}
        entityLabel="Servicio"
        currentUser={currentUser}
        entries={entries}
        entryType={entryType} setEntryType={setEntryType}
        title={title} setTitle={setTitle}
        content={content} setContent={setContent}
        dueAt={dueAt} setDueAt={setDueAt}
        priority={priority} setPriority={setPriority}
        assignedTo={assignedTo} setAssignedTo={setAssignedTo}
        markDone={markDone} setMarkDone={setMarkDone}
        onSave={save} saving={saving}
      />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="space-y-2" aria-live="polite">
        {loading ? <p className="text-sm text-slate-500">Cargando seguimiento...</p> : entries.length === 0 ? (
          <p className="text-sm text-slate-500">Sin seguimiento todavia.</p>
        ) : entries.map((entry) => {
          const due = entry.due_at ? String(entry.due_at).replace("T", " ").slice(0, 16) : "";
          const isOverdue = !entry.done && entry.due_at && new Date(entry.due_at).getTime() < Date.now();
          return (
            <article key={entry.id} className={`rounded-md border p-3 ${entry.pinned ? "border-amber-400 bg-amber-50 shadow-sm" : isOverdue ? "border-red-300 bg-red-50" : "border-slate-200"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{entry.title}</p>
                  <p className="text-xs text-slate-500">{LABELS[entry.entry_type] || "Actividad"} · {entry.created_by_name || "Usuario"} · {String(entry.created_at || "").slice(0, 16).replace("T", " ")}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <FollowupPinControl pinned={entry.pinned} busy={pinningId === entry.id} onToggle={() => togglePin(entry)} />
                  {entry.entry_type !== "note" && !entry.done && (
                    <button type="button" onClick={() => complete(entry)} className="rounded border border-emerald-300 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-50">Marcar hecho</button>
                  )}
                </div>
              </div>
              {entry.content && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{entry.content}</p>}
              {entry.entry_type !== "note" && (
                <p className="mt-2 text-xs text-slate-600">
                  {entry.done ? "Completada" : isOverdue ? "Vencida" : "Pendiente"} · Vence {due} · {entry.assigned_to_name || "Sin responsable"} · Prioridad {entry.priority}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
