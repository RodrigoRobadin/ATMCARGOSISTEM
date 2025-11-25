// client/src/pages/FollowUp.jsx
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth.jsx";
import VisitsList from "../components/visits/VisitsList";
import VisitForm from "../components/visits/VisitForm";
import VisitsCalendar from "../components/visits/VisitsCalendar"; // ← NUEVO

/* ---------- helpers ---------- */
const fmtDate = (s) => (s ? new Date(s) : null);
const isSameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const todayMidnight = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const now = () => new Date();

/* ========== Component ========== */
export default function FollowUp() {
  const { user } = useAuth();

  // datos
  const [calls, setCalls] = useState([]);
  const [notes, setNotes] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [users, setUsers] = useState([]);
  const [visits, setVisits] = useState([]);                  // ← NUEVO
  const [activeTab, setActiveTab] = useState("dashboard");   // ← NUEVO

  // filtros
  const [adminUserId, setAdminUserId] = useState(""); // solo admin
  const [q, setQ] = useState("");

  // toggle para la planilla de resumen de llamadas
  const [showCallsReport, setShowCallsReport] = useState(false);

  // formulario llamada
  const [callForm, setCallForm] = useState({
    org_id: "",
    contact_id: "",
    deal_id: "",
    subject: "Llamada",
    notes: "",
    happened_at: new Date().toISOString().slice(0, 16).replace("T", " "),
    duration_min: 0,
    outcome: "no_contesta", // nuevo campo
  });

  // formulario tarea
  const [taskForm, setTaskForm] = useState({
    org_id: "",
    contact_id: "",
    title: "",
    priority: "medium",
    due_at: new Date(Date.now() + 60 * 60 * 1000) // +1h
      .toISOString()
      .slice(0, 16)
      .replace("T", " "),
  });

  const isAdmin = (user?.role || "").toLowerCase() === "admin";

  /* ---- carga ---- */
  async function loadData() {
    const params = isAdmin && adminUserId ? { user_id: adminUserId } : {};

    const [cCalls, cNotes, cTasks, cVisits, cOrgs, cContacts, cUsers] =
      await Promise.all([
        api
          .get("/followups/calls", { params })
          .then((r) => r.data)
          .catch(() => []),
        api
          .get("/followups/notes", { params })
          .then((r) => r.data)
          .catch(() => []),
        api
          .get("/followups/tasks", {
            params,
            paramsSerializer: (p) =>
              new URLSearchParams({ ...p, status: "pending" }).toString(),
          })
          .then((r) => r.data)
          .catch(() => []),
        api
          .get("/visits", { params })       // ← NUEVO
          .then((r) => r.data)
          .catch(() => []),
        api
          .get("/organizations")
          .then((r) => r.data)
          .catch(() => []),
        api
          .get("/contacts")
          .then((r) => r.data)
          .catch(() => []),
        isAdmin
          ? api
            .get("/users")
            .then((r) => r.data)
            .catch(() => [])
          : Promise.resolve([]),
      ]);

    setCalls(Array.isArray(cCalls) ? cCalls : []);
    setNotes(Array.isArray(cNotes) ? cNotes : []);
    setTasks(Array.isArray(cTasks) ? cTasks : []);
    setVisits(Array.isArray(cVisits) ? cVisits : []); // ← NUEVO
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
  const today0 = todayMidnight();

  const currentUserId =
    isAdmin && adminUserId ? Number(adminUserId) : Number(user?.id || 0);

  const orgsMine = useMemo(
    () =>
      orgs.filter((o) =>
        // si existe o.advisor_user_id lo usamos; si no, mostramos todas
        o.advisor_user_id ? Number(o.advisor_user_id) === currentUserId : true
      ),
    [orgs, currentUserId]
  );

  const callsToday = useMemo(
    () =>
      calls.filter(
        (c) => c.happened_at && isSameDay(new Date(c.happened_at), today)
      ),
    [calls, today]
  );

  const orgIdsWithCalls = useMemo(
    () => new Set(calls.map((c) => c.org_id).filter(Boolean)),
    [calls]
  );

  const notContactedOrgs = useMemo(
    () => orgsMine.filter((o) => !orgIdsWithCalls.has(o.id)),
    [orgsMine, orgIdsWithCalls]
  );

  // Tareas
  const tasksPending = useMemo(
    () => tasks.filter((t) => t.status === "pending"),
    [tasks]
  );

  const tasksOverdue = useMemo(
    () =>
      tasksPending.filter((t) => {
        const d = fmtDate(t.due_at);
        return d && d < today0;
      }),
    [tasksPending, today0]
  );

  const tasksToday = useMemo(
    () =>
      tasksPending.filter((t) => {
        const d = fmtDate(t.due_at);
        return d && isSameDay(d, today);
      }),
    [tasksPending, today]
  );

  const tasksNext = useMemo(
    () =>
      [...tasksPending]
        .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
        .slice(0, 10),
    [tasksPending]
  );

  // serie últimas 30 fechas (para el gráfico de llamadas)
  const last30 = useMemo(() => {
    const arr = [];
    const map = new Map(); // yyyy-mm-dd -> count
    calls.forEach((c) => {
      if (!c.happened_at) return;
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

  // tabla de llamadas filtrada por búsqueda (detalle)
  const callsFiltered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return calls;
    return calls.filter((c) => {
      const s = `${c.subject || ""} ${c.notes || ""} ${c.org_name || ""} ${c.contact_name || ""
        } ${c.outcome || ""}`.toLowerCase();
      return s.includes(term);
    });
  }, [q, calls]);

  // === última nota por organización (para "Qué se habló") ===
  const notesByOrgLast = useMemo(() => {
    const map = new Map(); // org_id -> { content, created_at: Date }
    notes.forEach((n) => {
      const orgId = n.org_id || 0;
      const d = n.created_at ? new Date(n.created_at) : null;
      const existing = map.get(orgId);
      if (!existing) {
        map.set(orgId, {
          content: n.content || "",
          created_at: d,
        });
      } else if (d && (!existing.created_at || d > existing.created_at)) {
        map.set(orgId, {
          content: n.content || "",
          created_at: d,
        });
      }
    });
    return map;
  }, [notes]);

  // === planilla de resumen de llamadas (agrupado por org + contacto) ===
  const callsReport = useMemo(() => {
    const map = new Map();

    calls.forEach((c) => {
      const key = `${c.org_id || "0"}-${c.contact_id || "0"}`;
      const existing = map.get(key);

      const currentDate = c.happened_at ? new Date(c.happened_at) : null;

      if (!existing) {
        map.set(key, {
          org_id: c.org_id,
          org_name: c.org_name || "—",
          contact_id: c.contact_id,
          contact_name: c.contact_name || "—",
          total_calls: 1,
          last_call_date: currentDate,
          last_subject: c.subject || "",
          last_notes: c.notes || "",
          last_outcome: c.outcome || "",
        });
      } else {
        existing.total_calls += 1;

        // actualizamos "última llamada" si esta es más reciente
        if (
          currentDate &&
          (!existing.last_call_date || currentDate > existing.last_call_date)
        ) {
          existing.last_call_date = currentDate;
          existing.last_subject = c.subject || "";
          existing.last_notes = c.notes || "";
          existing.last_outcome = c.outcome || "";
        }
      }
    });

    // enriquecemos cada fila con la última nota de la organización
    const rows = Array.from(map.values()).map((row) => {
      const orgId = row.org_id || 0;
      const lastNote = notesByOrgLast.get(orgId);
      return {
        ...row,
        last_note_content: lastNote?.content || "",
        last_note_date: lastNote?.created_at || null,
      };
    });

    return rows.sort((a, b) => {
      // primero por org, después por contacto
      if (a.org_name < b.org_name) return -1;
      if (a.org_name > b.org_name) return 1;
      if (a.contact_name < b.contact_name) return -1;
      if (a.contact_name > b.contact_name) return 1;
      return 0;
    });
  }, [calls, notesByOrgLast]);

  const callsReportFiltered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return callsReport;
    return callsReport.filter((r) => {
      const s = `${r.org_name || ""} ${r.contact_name || ""} ${r.last_subject || ""
        } ${r.last_notes || ""} ${r.last_outcome || ""} ${r.last_note_content || ""
        }`.toLowerCase();
      return s.includes(term);
    });
  }, [q, callsReport]);

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
      setCallForm((f) => ({
        ...f,
        notes: "",
        duration_min: 0,
        outcome: "no_contesta",
      }));
      await loadData();
      alert("Llamada registrada.");
    } catch (err) {
      console.error(err);
      alert("No se pudo registrar la llamada.");
    }
  }

  async function submitTask(e) {
    e.preventDefault();
    const body = { ...taskForm };
    if (body.due_at?.includes("T")) {
      body.due_at = body.due_at.replace("T", " ") + ":00";
    }
    try {
      await api.post("/followups/tasks", body);
      setTaskForm((f) => ({
        ...f,
        title: "",
        priority: "medium",
      }));
      await loadData();
      alert("Tarea creada.");
    } catch (err) {
      console.error(err);
      alert("No se pudo crear la tarea.");
    }
  }

  async function markTaskDone(id) {
    try {
      await api.patch(`/followups/tasks/${id}`, { status: "done" });
      await loadData();
    } catch (err) {
      console.error(err);
      alert("No se pudo marcar la tarea como hecha.");
    }
  }

  /* ---------- UI ---------- */
  const currentUserName =
    isAdmin && adminUserId
      ? users.find((u) => u.id === Number(adminUserId))?.name || "(todos)"
      : user?.name;

  return (
    <div className="p-4 space-y-4">
      {/* Header superior con título + selector de usuario (admin) */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Seguimiento</h1>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <label className="text-sm">Ver datos de:</label>
            <select
              className="border rounded-lg px-3 py-1.5 text-sm"
              value={adminUserId}
              onChange={(e) => setAdminUserId(e.target.value)}
            >
              <option value="">Mi usuario</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.email}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Tabs Dashboard / Visitas */}
      <div className="bg-white rounded-2xl shadow p-2">
        <div className="flex gap-2">
          <button
            className={`px-4 py-2 rounded-lg transition-colors ${activeTab === "dashboard"
              ? "bg-black text-white"
              : "hover:bg-slate-100"
              }`}
            onClick={() => setActiveTab("dashboard")}
          >
            📊 Dashboard
          </button>
          <button
            className={`px-4 py-2 rounded-lg transition-colors ${activeTab === "visits"
              ? "bg-black text-white"
              : "hover:bg-slate-100"
              }`}
            onClick={() => setActiveTab("visits")}
          >
            🚗 Visitas
          </button>
        </div>
      </div>

      {/* TAB: Dashboard de seguimiento */}
      {activeTab === "dashboard" && (
        <div className="space-y-4">
          {/* Header card original (sin selector de usuario, solo búsqueda) */}
          <div className="bg-white rounded-2xl shadow p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-slate-500">Seguimiento</div>
                <div className="text-2xl font-bold">
                  Dashboard de seguimiento
                </div>
                <div className="text-xs text-slate-500">
                  Usuario: {currentUserName || "—"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  placeholder="Buscar en llamadas…"
                  className="border rounded-lg px-3 py-1.5 text-sm"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPI title="Organizaciones asignadas" value={orgsMine.length} />
            <KPI title="Llamadas hoy" value={callsToday.length} />
            <KPI
              title="Tareas hoy"
              value={tasksToday.length}
              sub={`${tasksOverdue.length} atrasadas`}
            />
            <KPI
              title="Org. sin contacto"
              value={notContactedOrgs.length}
              sub="Nunca se registró llamada"
            />
          </div>

          {/* Activity + Contactados vs No + Qué tengo que hacer */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Gráfico de llamadas últimos 30 días */}
            <div className="bg-white rounded-2xl shadow p-4 lg:col-span-2">
              <div className="font-medium mb-2">
                Actividad (llamadas últimos 30 días)
              </div>
              <LineMiniChart data={last30} />
            </div>

            {/* Contactados vs no contactados */}
            <div className="bg-white rounded-2xl shadow p-4 space-y-4">
              <div>
                <div className="font-medium mb-2">
                  Contactados vs No contactados
                </div>
                <Bars
                  items={[
                    {
                      label: "Contactados",
                      value: orgsMine.length - notContactedOrgs.length,
                    },
                    {
                      label: "No contactados",
                      value: notContactedOrgs.length,
                    },
                  ]}
                />
              </div>
            </div>
          </div>

          {/* Qué tengo que hacer: tareas */}
          <div className="bg-white rounded-2xl shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-medium">Qué tengo que hacer</div>
                <div className="text-xs text-slate-500">
                  Tareas pendientes: {tasksPending.length} · Hoy:{" "}
                  {tasksToday.length} · Atrasadas: {tasksOverdue.length}
                </div>
              </div>
            </div>

            {/* Form tarea */}
            <form
              onSubmit={submitTask}
              className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end mb-4"
            >
              <label className="text-sm">
                <div className="text-xs text-slate-600 mb-1">Organización</div>
                <select
                  className="border rounded-lg px-2 py-1.5 w-full"
                  value={taskForm.org_id}
                  onChange={(e) =>
                    setTaskForm((f) => ({
                      ...f,
                      org_id: e.target.value,
                      // si cambio de org, reseteo contacto
                      contact_id: "",
                    }))
                  }
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
                  value={taskForm.contact_id}
                  onChange={(e) =>
                    setTaskForm((f) => ({ ...f, contact_id: e.target.value }))
                  }
                >
                  <option value="">—</option>
                  {contacts
                    .filter((c) =>
                      taskForm.org_id
                        ? String(c.org_id) === String(taskForm.org_id)
                        : true
                    )
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.email ? `(${c.email})` : ""}
                      </option>
                    ))}
                </select>
              </label>

              <label className="text-sm">
                <div className="text-xs text-slate-600 mb-1">Vencimiento</div>
                <input
                  type="datetime-local"
                  className="border rounded-lg px-2 py-1.5 w-full"
                  value={taskForm.due_at.replace(" ", "T").slice(0, 16)}
                  onChange={(e) =>
                    setTaskForm((f) => ({
                      ...f,
                      due_at: e.target.value.replace("T", " "),
                    }))
                  }
                />
              </label>

              <label className="text-sm">
                <div className="text-xs text-slate-600 mb-1">Prioridad</div>
                <select
                  className="border rounded-lg px-2 py-1.5 w-full"
                  value={taskForm.priority}
                  onChange={(e) =>
                    setTaskForm((f) => ({ ...f, priority: e.target.value }))
                  }
                >
                  <option value="low">Baja</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                </select>
              </label>

              <label className="text-sm md:col-span-2">
                <div className="text-xs text-slate-600 mb-1">
                  Título / Próximo paso
                </div>
                <input
                  className="border rounded-lg px-3 py-1.5 w-full"
                  placeholder="Ej: Llamar para confirmar cotización..."
                  value={taskForm.title}
                  onChange={(e) =>
                    setTaskForm((f) => ({ ...f, title: e.target.value }))
                  }
                />
              </label>

              <div className="md:col-span-3">
                <button className="px-3 py-2 rounded-lg bg-black text-white">
                  Guardar tarea
                </button>
              </div>
            </form>

            {/* Lista de próximas tareas */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left p-2 border">Tarea</th>
                    <th className="text-left p-2 border">Prioridad</th>
                    <th className="text-left p-2 border">Organización</th>
                    <th className="text-left p-2 border">Contacto</th>
                    <th className="text-right p-2 border">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {tasksNext.length ? (
                    tasksNext.map((t) => {
                      const d = fmtDate(t.due_at);
                      const isOver = d && d < now();
                      return (
                        <tr key={t.id} className="hover:bg-slate-50">
                          {/* Tarea */}
                          <td className="p-2 border">{t.title}</td>

                          {/* Prioridad */}
                          <td className="p-2 border">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-[11px] ${t.priority === "high"
                                ? "bg-rose-100 text-rose-700"
                                : t.priority === "medium"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-emerald-100 text-emerald-700"
                                }`}
                            >
                              {t.priority === "high"
                                ? "Alta"
                                : t.priority === "medium"
                                  ? "Media"
                                  : "Baja"}
                            </span>
                            {isOver && (
                              <span className="ml-2 text-[11px] text-rose-600">
                                Atrasada
                              </span>
                            )}
                          </td>

                          {/* Organización */}
                          <td className="p-2 border">{t.org_name || "—"}</td>

                          {/* Contacto */}
                          <td className="p-2 border">{t.contact_name || "—"}</td>

                          {/* Acción */}
                          <td className="p-2 border text-right">
                            <button
                              className="px-2 py-1 text-xs rounded-lg border hover:bg-slate-100"
                              onClick={() => markTaskDone(t.id)}
                            >
                              Hecho
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td
                        colSpan={5}
                        className="p-4 text-center text-slate-500"
                      >
                        No tenés tareas pendientes.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Formulario de llamada */}
          <div className="bg-white rounded-2xl shadow p-4">
            <div className="font-medium mb-3">Registrar llamada</div>
            <form
              onSubmit={submitCall}
              className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end"
            >
              <label className="text-sm">
                <div className="text-xs text-slate-600 mb-1">Organización</div>
                <select
                  className="border rounded-lg px-2 py-1.5 w-full"
                  value={callForm.org_id}
                  onChange={(e) =>
                    setCallForm((f) => ({ ...f, org_id: e.target.value }))
                  }
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
                  onChange={(e) =>
                    setCallForm((f) => ({
                      ...f,
                      contact_id: e.target.value,
                    }))
                  }
                >
                  <option value="">—</option>
                  {contacts
                    .filter((c) =>
                      callForm.org_id
                        ? String(c.org_id) === String(callForm.org_id)
                        : true
                    )
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
                    setCallForm((f) => ({
                      ...f,
                      happened_at: e.target.value.replace("T", " "),
                    }))
                  }
                />
              </label>

              <label className="text-sm">
                <div className="text-xs text-slate-600 mb-1">
                  Duración (min)
                </div>
                <input
                  type="number"
                  min="0"
                  className="border rounded-lg px-2 py-1.5 w-full"
                  value={callForm.duration_min}
                  onChange={(e) =>
                    setCallForm((f) => ({
                      ...f,
                      duration_min: Number(e.target.value || 0),
                    }))
                  }
                />
              </label>

              {/* Resultado de la llamada */}
              <label className="text-sm">
                <div className="text-xs text-slate-600 mb-1">Resultado</div>
                <select
                  className="border rounded-lg px-2 py-1.5 w-full"
                  value={callForm.outcome}
                  onChange={(e) =>
                    setCallForm((f) => ({ ...f, outcome: e.target.value }))
                  }
                >
                  <option value="no_contesta">No contesta</option>
                  <option value="interesado">Interesado</option>
                  <option value="no_interesado">No interesado</option>
                  <option value="volver_a_llamar">Volver a llamar</option>
                  <option value="en_negociacion">En negociación</option>
                </select>
              </label>

              <label className="md:col-span-5 text-sm">
                <div className="text-xs text-slate-600 mb-1">Asunto</div>
                <input
                  className="border rounded-lg px-3 py-1.5 w-full"
                  value={callForm.subject}
                  onChange={(e) =>
                    setCallForm((f) => ({ ...f, subject: e.target.value }))
                  }
                />
              </label>

              <label className="md:col-span-5 text-sm">
                <div className="text-xs text-slate-600 mb-1">Notas</div>
                <textarea
                  rows={3}
                  className="border rounded-lg px-3 py-1.5 w-full"
                  value={callForm.notes}
                  onChange={(e) =>
                    setCallForm((f) => ({ ...f, notes: e.target.value }))
                  }
                />
              </label>

              <div className="md:col-span-5">
                <button className="px-3 py-2 rounded-lg bg-black text-white">
                  Guardar llamada
                </button>
              </div>
            </form>
          </div>

          {/* Tabla de actividad (llamadas) */}
          <div className="bg-white rounded-2xl shadow p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium">
                {showCallsReport
                  ? "Planilla de resumen de llamadas"
                  : "Historial de llamadas"}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                {!showCallsReport && (
                  <span>
                    Total: <b>{callsFiltered.length}</b>
                  </span>
                )}
                {showCallsReport && (
                  <span>
                    Total filas: <b>{callsReportFiltered.length}</b>
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setShowCallsReport((v) => !v)}
                  className="px-2 py-1 rounded border text-xs hover:bg-slate-50"
                >
                  {showCallsReport
                    ? "Ver detalle de llamadas"
                    : "Ver planilla de resumen"}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              {!showCallsReport ? (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left p-2 border">Fecha</th>
                      <th className="text-left p-2 border">Organización</th>
                      <th className="text-left p-2 border">Contacto</th>
                      <th className="text-left p-2 border">Resultado</th>
                      <th className="text-left p-2 border">Asunto</th>
                      <th className="text-left p-2 border">Notas</th>
                      <th className="text-right p-2 border">Duración</th>
                    </tr>
                  </thead>
                  <tbody>
                    {callsFiltered.length ? (
                      callsFiltered.map((c) => (
                        <tr key={c.id} className="hover:bg-slate-50">
                          <td className="p-2 border">
                            {fmtDate(c.happened_at)?.toLocaleString() || "—"}
                          </td>
                          <td className="p-2 border">{c.org_name || "—"}</td>
                          <td className="p-2 border">{c.contact_name || "—"}</td>
                          <td className="p-2 border">
                            <OutcomePill outcome={c.outcome} />
                          </td>
                          <td className="p-2 border">{c.subject || "—"}</td>
                          <td className="p-2 border">
                            <span className="line-clamp-2">
                              {c.notes || "—"}
                            </span>
                          </td>
                          <td className="p-2 border text-right">
                            {c.duration_min ? `${c.duration_min} min` : "—"}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={7}
                          className="p-4 text-center text-slate-500"
                        >
                          Sin llamadas registradas.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left p-2 border">Organización</th>
                      <th className="text-left p-2 border">Contacto</th>
                      <th className="text-right p-2 border">Cant. llamadas</th>
                      <th className="text-left p-2 border">Última fecha</th>
                      <th className="text-left p-2 border">
                        Resultado última
                      </th>
                      <th className="text-left p-2 border">¿Respondió?</th>
                      <th className="text-left p-2 border">Qué se habló</th>
                    </tr>
                  </thead>
                  <tbody>
                    {callsReportFiltered.length ? (
                      callsReportFiltered.map((r, idx) => {
                        const responded =
                          r.last_outcome &&
                          r.last_outcome !== "no_contesta";
                        return (
                          <tr
                            key={`${r.org_id}-${r.contact_id}-${idx}`}
                            className="hover:bg-slate-50"
                          >
                            <td className="p-2 border">
                              {r.org_name || "—"}
                            </td>
                            <td className="p-2 border">
                              {r.contact_name || "—"}
                            </td>
                            <td className="p-2 border text-right">
                              {r.total_calls}
                            </td>
                            <td className="p-2 border text-xs">
                              {r.last_call_date
                                ? r.last_call_date.toLocaleString()
                                : "—"}
                            </td>
                            <td className="p-2 border">
                              <OutcomePill outcome={r.last_outcome} />
                            </td>
                            <td className="p-2 border text-xs">
                              {responded ? "Sí" : "No"}
                            </td>
                            <td className="p-2 border">
                              <span className="line-clamp-2">
                                {r.last_note_content
                                  ? r.last_note_content
                                  : r.last_subject
                                    ? r.last_subject
                                    : r.last_notes || "—"}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td
                          colSpan={7}
                          className="p-4 text-center text-slate-500"
                        >
                          No hay llamadas para resumir.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB: Visitas */}
      {activeTab === "visits" && (
        <div className="space-y-4">
          {/* Calendario */}
          <VisitsCalendar
            visits={visits}
            tasks={tasksPending}
            onVisitClick={(visit) => {
              console.log("Click en visita:", visit);
            }}
            onTaskClick={(task) => {
              console.log("Click en tarea:", task);
            }}
          />

          {/* Formulario de nueva visita */}
          <VisitForm
            orgs={orgsMine}
            contacts={contacts}
            onSuccess={loadData}
          />

          {/* Lista de visitas */}
          <VisitsList
            visits={visits}
            onRefresh={loadData}
            orgs={orgs}
            contacts={contacts}
          />
        </div>
      )}
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
      <line
        x1={pad}
        y1={height - pad}
        x2={width - pad}
        y2={height - pad}
        stroke="#e5e7eb"
      />
      <polyline
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        points={points.join(" ")}
      />
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

function OutcomePill({ outcome }) {
  if (!outcome) return <span className="text-xs text-slate-400">—</span>;

  let label = "";
  let cls = "";

  switch (outcome) {
    case "no_contesta":
      label = "No contesta";
      cls = "bg-slate-100 text-slate-700";
      break;
    case "interesado":
      label = "Interesado";
      cls = "bg-emerald-100 text-emerald-700";
      break;
    case "no_interesado":
      label = "No interesado";
      cls = "bg-slate-100 text-slate-700";
      break;
    case "volver_a_llamar":
      label = "Volver a llamar";
      cls = "bg-amber-100 text-amber-700";
      break;
    case "en_negociacion":
      label = "En negociación";
      cls = "bg-indigo-100 text-indigo-700";
      break;
    default:
      label = outcome;
      cls = "bg-slate-100 text-slate-700";
  }

  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] ${cls}`}>
      {label}
    </span>
  );
}