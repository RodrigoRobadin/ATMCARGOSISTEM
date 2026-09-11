import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";

const TYPES = [
  { value: "call", label: "Llamada" }, { value: "meeting", label: "Reunion" },
  { value: "task", label: "Tarea" }, { value: "reminder", label: "Fecha limite" },
  { value: "email", label: "Correo" }, { value: "activity", label: "General" },
];
const datePart = (value) => String(value || "").slice(0, 10);
const timePart = (value) => String(value || "").slice(11, 16);
const todayInParaguay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const setDateTime = (value, nextDate, nextTime) => {
  const date = nextDate || datePart(value);
  const time = nextTime || timePart(value) || "09:00";
  return date ? `${date}T${time}` : "";
};
const entryLabel = (entry) => TYPES.find((item) => item.value === String(entry?.entry_type || entry?.type || "activity").toLowerCase())?.label || "Actividad";

export default function OperationFollowupComposer({ deal, currentUser, entries = [], entryType, setEntryType, title, setTitle, content, setContent, dueAt, setDueAt, priority, setPriority, assignedTo, setAssignedTo, markDone, setMarkDone, onSave, saving = false }) {
  const [users, setUsers] = useState([]);
  const isNote = entryType === "note";
  const selectedDate = datePart(dueAt) || todayInParaguay();

  useEffect(() => {
    let active = true;
    api.get("/users/select", { params: { active: 1 } }).then(({ data }) => active && setUsers(Array.isArray(data) ? data : [])).catch(() => active && setUsers([]));
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!assignedTo && currentUser?.id) setAssignedTo(String(currentUser.id));
  }, [assignedTo, currentUser?.id, setAssignedTo]);
  useEffect(() => {
    if (!isNote && !dueAt) setDueAt(`${todayInParaguay()}T09:00`);
  }, [isNote, dueAt, setDueAt]);

  const dayEntries = useMemo(() => entries.filter((entry) => entry?.due_at && datePart(entry.due_at) === selectedDate).sort((a, b) => String(a.due_at).localeCompare(String(b.due_at))), [entries, selectedDate]);
  function chooseType(nextType) {
    setEntryType(nextType);
    if (nextType !== "note" && !dueAt) setDueAt(`${todayInParaguay()}T09:00`);
  }
  function openWhatsApp() {
    const phone = String(deal?.contact_phone || "").replace(/\D/g, "");
    if (phone) window.open(`https://wa.me/${phone}`, "_blank", "noopener,noreferrer");
  }
  function openEmail() { if (deal?.contact_email) window.location.href = `mailto:${deal.contact_email}`; }

  return <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
    <div className="flex flex-wrap items-center border-b border-slate-200 text-sm">
      <button type="button" onClick={() => chooseType("activity")} className={`px-4 py-3 ${!isNote ? "border-b-2 border-emerald-600 text-emerald-700" : "text-slate-600"}`}>Actividad</button>
      <button type="button" onClick={() => chooseType("note")} className={`px-4 py-3 ${isNote ? "border-b-2 border-emerald-600 text-emerald-700" : "text-slate-600"}`}>Notas</button>
      <button type="button" onClick={() => chooseType("call")} className="px-4 py-3 text-slate-600 hover:bg-slate-50">Llamada</button>
      <button type="button" onClick={openWhatsApp} disabled={!deal?.contact_phone} className="px-4 py-3 text-slate-600 hover:bg-slate-50 disabled:opacity-40">WhatsApp</button>
      <button type="button" onClick={openEmail} disabled={!deal?.contact_email} className="px-4 py-3 text-slate-600 hover:bg-slate-50 disabled:opacity-40">Correo electronico</button>
    </div>
    <div className={`grid ${isNote ? "grid-cols-1" : "lg:grid-cols-[minmax(0,1fr)_280px]"}`}>
      <div className="space-y-3 p-4">
        <input className="w-full border-b border-slate-300 px-2 py-2 text-xl outline-none focus:border-emerald-600" placeholder={isNote ? "Titulo opcional" : entryLabel({ entry_type: entryType })} value={title} onChange={(e) => setTitle(e.target.value)} />
        {!isNote && <>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-6">{TYPES.map((item) => <button key={item.value} type="button" onClick={() => chooseType(item.value)} className={`min-h-9 border px-2 py-1 text-xs font-medium ${entryType === item.value ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>{item.label}</button>)}</div>
          <div className="grid gap-2 sm:grid-cols-[1fr_150px_170px]">
            <input type="date" className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={datePart(dueAt)} onChange={(e) => setDueAt(setDateTime(dueAt, e.target.value, null))} />
            <input type="time" className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={timePart(dueAt)} onChange={(e) => setDueAt(setDateTime(dueAt, null, e.target.value))} />
            <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="low">Prioridad baja</option><option value="medium">Prioridad media</option><option value="high">Prioridad alta</option></select>
          </div>
        </>}
        <textarea className={`w-full rounded-md border px-3 py-2 text-sm ${isNote ? "min-h-32 border-amber-200 bg-amber-50" : "min-h-24 border-slate-300"}`} placeholder={isNote ? "Escribe la nota..." : "Descripcion u observaciones de la actividad..."} value={content} onChange={(e) => setContent(e.target.value)} />
        {!isNote && <div className="space-y-2 text-sm">
          <select className="w-full rounded-md border border-slate-300 px-3 py-2" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}><option value="">Seleccionar responsable</option>{users.map((item) => <option key={item.id} value={item.id}>{item.name || item.email}</option>)}</select>
          <div className="grid gap-2 sm:grid-cols-3"><div className="rounded-md border border-slate-200 px-3 py-2"><span className="block text-[11px] text-slate-500">Operacion</span>{deal?.reference || deal?.title || "-"}</div><div className="rounded-md border border-slate-200 px-3 py-2"><span className="block text-[11px] text-slate-500">Contacto</span>{deal?.contact_name || "Sin contacto"}</div><div className="rounded-md border border-slate-200 px-3 py-2"><span className="block text-[11px] text-slate-500">Organizacion</span>{deal?.org_name || "Sin organizacion"}</div></div>
        </div>}
        <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-3">
          {!isNote && <label className="mr-auto flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={markDone} onChange={(e) => setMarkDone(e.target.checked)} />Marcar como completa</label>}
          <button type="button" onClick={onSave} disabled={saving} className="rounded-md bg-emerald-700 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">{saving ? "Guardando..." : "Guardar"}</button>
        </div>
      </div>
      {!isNote && <aside className="border-t border-slate-200 bg-slate-50 lg:border-l lg:border-t-0"><div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">Agenda del {selectedDate.split("-").reverse().join("/")}</div><div className="max-h-[410px] overflow-y-auto p-3">{dayEntries.length ? dayEntries.map((entry) => <div key={entry.id} className="mb-2 border-l-4 border-emerald-600 bg-white px-3 py-2 shadow-sm"><div className="text-xs font-semibold text-slate-800">{entry.title || entryLabel(entry)}</div><div className="mt-1 text-[11px] text-slate-500">{timePart(entry.due_at) || "Sin hora"} · {entryLabel(entry)}</div></div>) : <div className="py-8 text-center text-xs text-slate-500">No hay actividades para este dia.</div>}</div></aside>}
    </div>
  </div>;
}
