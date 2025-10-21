// client/src/pages/FollowUp.jsx
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth.jsx";

/* ---------- helpers ---------- */
const fmtDate = (s) => (s ? new Date(s) : null);
const isSameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();
const money = (n) =>
  isNaN(n) ? "0,00" : Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ========== Component ========== */
export default function FollowUp() {
  const { user } = useAuth();

  // datos
  const [calls, setCalls] = useState([]);
  const [notes, setNotes] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [users, setUsers] = useState([]);

  // filtros
  const [adminUserId, setAdminUserId] = useState(""); // solo admin
  const [q, setQ] = useState("");

  // formulario llamada
  const [callForm, setCallForm] = useState({
    org_id: "",
    contact_id: "",
    deal_id: "",
    subject: "Llamada",
    notes: "",
    happened_at: new Date().toISOString().slice(0, 16).replace("T", " "),
    duration_min: 0,
  });

  const isAdmin = user?.role === "admin";

  /* ---- carga ---- */
  async function loadData() {
    const params = isAdmin && adminUserId ? { user_id: adminUserId } : {};
    const [cCalls, cNotes, cOrgs, cContacts, cUsers] = await Promise.all([
      api.get("/followups/calls", { params }).then((r) => r.data).catch(() => []),
      api.get("/followups/notes", { params }).then((r) => r.data).catch(() => []),
      api.get("/organizations").then((r) => r.data).catch(() => []),
      api.get("/contacts").then((r) => r.data).catch(() => []),
      isAdmin ? api.get("/users").then((r) => r.data).catch(() => []) : Promise.resolve([]),
    ]);

    setCalls(Array.isArray(cCalls) ? cCalls : []);
    setNotes(Array.isArray(cNotes) ? cNotes : []);
    setOrgs(Array.isArray(cOrgs) ? cOrgs : []);
    setContacts(Array.isArray(cContacts) ? cContacts : []);
    if (isAdmin) setUsers(Array.isArray(cUsers) ? cUsers : []);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminUserId]);

  /* ---- calculadas / stats ---- */
  const today = new Date();
  const orgsMine = useMemo(
    () =>
      orgs.filter((o) =>
        // si existe o.advisor_user_id lo usamos; si no, mostramos todas
        o.advisor_user_id ? Number(o.advisor_user_id) === Number(isAdmin && adminUserId ? adminUserId : user?.id) : true
      ),
    [orgs, user, isAdmin, adminUserId]
  );

  const callsToday = useMemo(
    () => calls.filter((c) => c.happened_at && isSameDay(new Date(c.happened_at), today)),
    [calls]
  );

  const orgIdsWithCalls = useMemo(() => new Set(calls.map((c) => c.org_id).filter(Boolean)), [calls]);
  const notContactedOrgs = useMemo(
    () => orgsMine.filter((o) => !orgIdsWithCalls.has(o.id)),
    [orgsMine, orgIdsWithCalls]
  );

  // serie últimas 30 fechas (para el gráfico)
  const last30 = useMemo(() => {
    const arr = [];
    const map = new Map(); // yyyy-mm-dd -> count
    calls.forEach((c) => {
      const d = new Date(c.happened_at);
      const key = d.toISOString().slice(0, 10);
      map.set(key, (map.get(key) || 0) + 1);
    });
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      arr.push({ day: key, value: map.get(key) || 0, date: new Date(key) });
    }
    return arr;
  }, [calls]);

  // tabla filtrada por búsqueda
  const callsFiltered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return calls;
    return calls.filter((c) => {
      const s =
        `${c.subject || ""} ${c.notes || ""} ${c.org_name || ""} ${c.contact_name || ""}`.toLowerCase();
      return s.includes(term);
    });
  }, [q, calls]);

  /* ---- acciones ---- */
  async function submitCall(e) {
    e.preventDefault();
    const body = { ...callForm };
    // normalizamos happened_at si viene de datetime-local
    if (body.happened_at?.includes("T")) {
      body.happened_at = body.happened_at.replace("T", " ") + ":00";
    }
    try {
      await api.post("/followups/calls", body);
      setCallForm((f) => ({ ...f, notes: "", duration_min: 0 }));
      await loadData();
      alert("Llamada registrada.");
    } catch {
      alert("No se pudo registrar la llamada.");
    }
  }

  /* ---------- UI ---------- */
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-slate-500">Seguimiento</div>
            <div className="text-2xl font-bold">Dashboard de seguimiento</div>
            <div className="text-xs text-slate-500">
              Usuario: {isAdmin && adminUserId
                ? users.find((u) => u.id === Number(adminUserId))?.name || "(todos)"
                : user?.name}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <select
                className="border rounded-lg px-2 py-1 text-sm"
                value={adminUserId}
                onChange={(e) => setAdminUserId(e.target.value)}
                title="Filtrar por usuario (solo admin)"
              >
                <option value="">— Todos —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            )}
            <input
              placeholder="Buscar en llamadas / notas…"
              className="border rounded-lg px-3 py-1.5 text-sm"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI title="Total Organizaciones" value={orgsMine.length} />
        <KPI title="Llamadas hoy" value={callsToday.length} />
        <KPI title="Organizaciones sin contacto" value={notContactedOrgs.length} />
        <KPI title="Notas totales" value={notes.length} />
      </div>

      {/* Activity + Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow p-4 lg:col-span-2">
          <div className="font-medium mb-2">Actividad (últimos 30 días)</div>
          <LineMiniChart data={last30} />
        </div>
        <div className="bg-white rounded-2xl shadow p-4">
          <div className="font-medium mb-2">Contactados vs No contactados</div>
          <Bars
            items={[
              { label: "Contactados", value: orgsMine.length - notContactedOrgs.length },
              { label: "No contactados", value: notContactedOrgs.length },
            ]}
          />
        </div>
      </div>

      {/* Formulario de llamada */}
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="font-medium mb-3">Registrar llamada</div>
        <form onSubmit={submitCall} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <label className="text-sm">
            <div className="text-xs text-slate-600 mb-1">Organización</div>
            <select
              className="border rounded-lg px-2 py-1.5 w-full"
              value={callForm.org_id}
              onChange={(e) => setCallForm((f) => ({ ...f, org_id: e.target.value }))}
            >
              <option value="">—</option>
              {orgsMine.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <div className="text-xs text-slate-600 mb-1">Contacto</div>
            <select
              className="border rounded-lg px-2 py-1.5 w-full"
              value={callForm.contact_id}
              onChange={(e) => setCallForm((f) => ({ ...f, contact_id: e.target.value }))}
            >
              <option value="">—</option>
              {contacts
                .filter((c) => (callForm.org_id ? String(c.org_id) === String(callForm.org_id) : true))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.email ? `(${c.email})` : ""}
                  </option>
                ))}
            </select>
          </label>

          <label className="text-sm">
            <div className="text-xs text-slate-600 mb-1">Fecha y hora</div>
            <input
              type="datetime-local"
              className="border rounded-lg px-2 py-1.5 w-full"
              value={callForm.happened_at.replace(" ", "T").slice(0, 16)}
              onChange={(e) =>
                setCallForm((f) => ({ ...f, happened_at: e.target.value.replace("T", " ") }))
              }
            />
          </label>

          <label className="text-sm">
            <div className="text-xs text-slate-600 mb-1">Duración (min)</div>
            <input
              type="number"
              min="0"
              className="border rounded-lg px-2 py-1.5 w-full"
              value={callForm.duration_min}
              onChange={(e) => setCallForm((f) => ({ ...f, duration_min: Number(e.target.value || 0) }))}
            />
          </label>

          <label className="md:col-span-4 text-sm">
            <div className="text-xs text-slate-600 mb-1">Asunto</div>
            <input
              className="border rounded-lg px-3 py-1.5 w-full"
              value={callForm.subject}
              onChange={(e) => setCallForm((f) => ({ ...f, subject: e.target.value }))}
            />
          </label>

          <label className="md:col-span-4 text-sm">
            <div className="text-xs text-slate-600 mb-1">Notas</div>
            <textarea
              rows={3}
              className="border rounded-lg px-3 py-1.5 w-full"
              value={callForm.notes}
              onChange={(e) => setCallForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </label>

          <div className="md:col-span-4">
            <button className="px-3 py-2 rounded-lg bg-black text-white">Guardar llamada</button>
          </div>
        </form>
      </div>

      {/* Tabla de actividad */}
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="font-medium">Historial de llamadas</div>
          <div className="text-xs text-slate-500">
            Total: <b>{callsFiltered.length}</b>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left p-2 border">Fecha</th>
                <th className="text-left p-2 border">Organización</th>
                <th className="text-left p-2 border">Contacto</th>
                <th className="text-left p-2 border">Asunto</th>
                <th className="text-left p-2 border">Notas</th>
                <th className="text-right p-2 border">Duración</th>
              </tr>
            </thead>
            <tbody>
              {callsFiltered.length ? (
                callsFiltered.map((c) => (
                  <tr key={c.id}>
                    <td className="p-2 border">{fmtDate(c.happened_at)?.toLocaleString() || "—"}</td>
                    <td className="p-2 border">{c.org_name || "—"}</td>
                    <td className="p-2 border">{c.contact_name || "—"}</td>
                    <td className="p-2 border">{c.subject || "—"}</td>
                    <td className="p-2 border">
                      <span className="line-clamp-2">{c.notes || "—"}</span>
                    </td>
                    <td className="p-2 border text-right">{c.duration_min ? `${c.duration_min} min` : "—"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-slate-500">
                    Sin llamadas registradas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ====== tiny components ====== */
function KPI({ title, value, sub }) {
  return (
    <div className="bg-white rounded-2xl shadow p-4">
      <div className="text-xs text-slate-500">{title}</div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function LineMiniChart({ data }) {
  // simple sparkline SVG
  const width = 600;
  const height = 140;
  const pad = 24;
  const max = Math.max(1, ...data.map((d) => d.value));
  const stepX = (width - pad * 2) / Math.max(1, data.length - 1);

  const points = data.map((d, i) => {
    const x = pad + i * stepX;
    const y = pad + (height - pad * 2) * (1 - d.value / max);
    return `${x},${y}`;
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-40">
      {/* grid y 0..max */}
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#e5e7eb" />
      <polyline fill="none" stroke="#2563eb" strokeWidth="2" points={points.join(" ")} />
    </svg>
  );
}

function Bars({ items }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="flex items-end gap-4 h-40">
      {items.map((i) => (
        <div key={i.label} className="flex flex-col items-center gap-1">
          <div
            className="w-10 rounded bg-blue-600"
            style={{ height: `${(i.value / max) * 100 || 2}%` }}
            title={`${i.label}: ${i.value}`}
          />
          <div className="text-xs text-slate-600">{i.label}</div>
          <div className="text-xs font-semibold">{i.value}</div>
        </div>
      ))}
    </div>
  );
}
