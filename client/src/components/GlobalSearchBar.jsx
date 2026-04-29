// client/src/components/GlobalSearchBar.jsx
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import Chatbox from "./Chatbox.jsx";
import AssistantBubble from "./AssistantBubble.jsx";

export default function GlobalSearchBar() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState({ deals: [], organizations: [], contacts: [], notes: [], services: [] });
  const [counts, setCounts] = useState({ activities: 0, tasks: 0, notes: 0 });
  const [notifCount, setNotifCount] = useState(0);
  const [notifList, setNotifList] = useState([]);
  const [showNotif, setShowNotif] = useState(false);
  const [activitiesPreview, setActivitiesPreview] = useState([]);
  const [showActivities, setShowActivities] = useState(false);
  const [tasksPreview, setTasksPreview] = useState([]);
  const [showTasks, setShowTasks] = useState(false);
  const timer = useRef();
  const activitiesTimer = useRef();
  const tasksTimer = useRef();
  const notifTimer = useRef();
  const navigate = useNavigate();
  const icons = {
    activities: String.fromCodePoint(0x1F4C5),
    tasks: String.fromCodePoint(0x1F514),
    notes: String.fromCodePoint(0x1F4AC),
  };

  useEffect(() => {
    clearTimeout(timer.current);

    if (!q) {
      setRes({ deals: [], organizations: [], contacts: [], notes: [], services: [] });
      setOpen(false);
      return;
    }

    timer.current = setTimeout(async () => {
      try {
        const { data } = await api.get("/search", { params: { q } });
        // data = { deals, organizations, contacts }
        setRes(data || { deals: [], organizations: [], contacts: [], notes: [], services: [] });
        setOpen(true);
      } catch (e) {
        console.error("search failed", e);
        setRes({ deals: [], organizations: [], contacts: [], notes: [], services: [] });
        setOpen(true);
      }
    }, 300);

    return () => clearTimeout(timer.current);
  }, [q]);

  useEffect(() => {
    let active = true;

    const loadCounts = async () => {
      try {
        const [
          activitiesRes,
          tasksCountRes,
          notesRes,
          tasksListRes,
          activitiesListRes,
          notifCountRes,
          notifListRes,
        ] = await Promise.all([
          api.get("/activities/count"),
          api.get("/followups/tasks/count", { params: { status: "pending" } }),
          api.get("/followups/notes/count"),
          api.get("/followups/tasks", { params: { status: "pending", limit: 5 } }),
          api.get("/activities/mine", { params: { done: 0, limit: 5 } }),
          api.get("/notifications/count", { params: { status: "unread" } }),
          api.get("/notifications", { params: { status: "unread", limit: 5 } }),
        ]);

        if (!active) return;

        setCounts({
          activities: Number(activitiesRes?.data?.total || 0),
          tasks: Number(tasksCountRes?.data?.total || 0),
          notes: Number(notesRes?.data?.total || 0),
        });
        setTasksPreview(Array.isArray(tasksListRes?.data) ? tasksListRes.data : []);
        setActivitiesPreview(
          Array.isArray(activitiesListRes?.data) ? activitiesListRes.data : []
        );
        setNotifCount(Number(notifCountRes?.data?.total || 0));
        setNotifList(Array.isArray(notifListRes?.data) ? notifListRes.data : []);
      } catch (e) {
        if (!active) return;
        setCounts({ activities: 0, tasks: 0, notes: 0 });
        setTasksPreview([]);
        setActivitiesPreview([]);
        setNotifCount(0);
        setNotifList([]);
      }
    };

    loadCounts();
    const intervalId = setInterval(loadCounts, 30000);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, []);

  const go = (type, id, extra) => {
    setOpen(false);
    if (type === "deal") navigate(`/operations/${id}`);
    if (type === "org") navigate(`/organizations/${id}`);
    if (type === "contact") navigate(`/contacts/${id}`);
    if (type === "service") navigate(`/service/cases/${id}`);
    if (type === "note") {
      if (extra?.deal_id) return navigate(`/operations/${extra.deal_id}`);
      if (extra?.org_id) return navigate(`/organizations/${extra.org_id}`);
      if (extra?.contact_id) return navigate(`/contacts/${extra.contact_id}`);
    }
  };

  const formatDueDate = (value) => {
    if (!value) return "";
    const raw = String(value);
    const d = new Date(raw.replace(" ", "T"));
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleDateString();
  };

  const openActivities = () => {
    clearTimeout(activitiesTimer.current);
    setShowActivities(true);
  };

  const closeActivities = () => {
    clearTimeout(activitiesTimer.current);
    activitiesTimer.current = setTimeout(() => setShowActivities(false), 120);
  };

  const openTasks = () => {
    clearTimeout(tasksTimer.current);
    setShowTasks(true);
  };

  const closeTasks = () => {
    clearTimeout(tasksTimer.current);
    tasksTimer.current = setTimeout(() => setShowTasks(false), 120);
  };

  const openNotif = () => {
    clearTimeout(notifTimer.current);
    setShowNotif(true);
  };

  const closeNotif = () => {
    clearTimeout(notifTimer.current);
    notifTimer.current = setTimeout(() => setShowNotif(false), 120);
  };

  const markNotifRead = async (id, orgId) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setNotifList((prev) => prev.filter((n) => n.id !== id));
      setNotifCount((c) => Math.max(0, c - 1));
      if (orgId) navigate(`/organizations/${orgId}`);
    } catch (e) {
      console.error("No se pudo marcar notificacion", e);
      if (orgId) navigate(`/organizations/${orgId}`);
    }
  };

  const markAllRead = async () => {
    try {
      await api.patch("/notifications/read-all");
      setNotifList([]);
      setNotifCount(0);
    } catch (e) {
      console.error("No se pudo marcar todas", e);
    }
  };

  const hasResults =
    (res.deals?.length || 0) +
      (res.organizations?.length || 0) +
      (res.contacts?.length || 0) +
      (res.notes?.length || 0) +
      (res.services?.length || 0) >
    0;
  return (
    <>
      <AssistantBubble />
      <div className="flex items-center gap-3">
        <Chatbox />
      <div
        className="relative"
        onMouseEnter={openNotif}
        onMouseLeave={closeNotif}
      >
        <button
          type="button"
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border bg-white text-sm font-semibold hover:bg-slate-50"
          title="Recordatorios"
        >
          R
          {notifCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-600 text-white text-[10px] leading-[18px] text-center">
              {notifCount}
            </span>
          )}
        </button>

        {showNotif && (
          <div
            className="absolute left-0 top-full mt-2 w-80 rounded-lg border bg-white shadow-lg p-3 text-xs z-50"
            onMouseEnter={openNotif}
            onMouseLeave={closeNotif}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold text-slate-700">Recordatorios</div>
              {notifList.length > 0 && (
                <button
                  type="button"
                  className="text-[11px] text-blue-600 hover:underline"
                  onClick={markAllRead}
                >
                  Marcar todas
                </button>
              )}
            </div>
            {notifList.length ? (
              <div className="space-y-2">
                {notifList.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className="block w-full text-left rounded-md border px-2 py-2 hover:bg-slate-50"
                    onClick={() => markNotifRead(n.id, n.org_id)}
                  >
                    <div className="text-[12px] font-semibold text-slate-800">
                      {n.title}
                    </div>
                    {n.body && (
                      <div className="text-[11px] text-slate-500 mt-1">
                        {n.body}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-slate-500">No hay recordatorios.</div>
            )}
          </div>
        )}
      </div>

      <div className="relative flex-1 max-w-[720px]">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por referencia, cliente, contacto, mercadería, modalidad, tipo de carga, origen, destino…"
          className="w-full border rounded-lg px-3 py-2"
          onFocus={() => q && setOpen(true)}
        />

        {open && (
          <div className="absolute mt-1 bg-white border rounded-lg shadow w-full max-h-72 overflow-auto z-50">
{/* Operaciones */}
          {res.deals?.length > 0 && (
            <div>
              <div className="px-3 py-1 text-xs text-slate-500">Operaciones</div>
              {res.deals.map((d) => (
                <button
                  key={`d-${d.id}`}
                  onClick={() => go("deal", d.id)}
                  className="block w-full text-left px-3 py-2 hover:bg-slate-50"
                >
                  <div className="text-sm font-medium">
                    {d.reference} {d.title ? `— ${d.title}` : ""}
                  </div>
                  <div className="text-xs text-slate-500">
                    {d.org_name || "Sin cliente"}
                    {d.contact_name ? ` • Cont.: ${d.contact_name}` : ""}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {d.mercaderia ? `Mercadería: ${d.mercaderia} • ` : ""}
                    {d.modalidad_carga || d.transport_type
                      ? `Mod.: ${d.modalidad_carga || d.transport_type}`
                      : ""}
                    {d.tipo_carga ? ` • Tipo: ${d.tipo_carga}` : ""}
                    {(d.origen_pto || d.destino_pto) && (
                      <>
                        {" "}
                        • {d.origen_pto || "?"} → {d.destino_pto || "?"}
                      </>
                    )}
                    {d.incoterm ? ` • Incoterm: ${d.incoterm}` : ""}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Organizaciones */}
          {res.organizations?.length > 0 && (
            <div>
              <div className="px-3 py-1 text-xs text-slate-500">Organizaciones</div>
              {res.organizations.map((o) => (
                <button
                  key={`o-${o.id}`}
                  onClick={() => go("org", o.id)}
                  className="block w-full text-left px-3 py-2 hover:bg-slate-50"
                >
                  <div className="text-sm font-medium">{o.name}</div>
                </button>
              ))}
            </div>
          )}

          {/* Contactos */}
          {res.contacts?.length > 0 && (
            <div>
              <div className="px-3 py-1 text-xs text-slate-500">Contactos</div>
              {res.contacts.map((c) => (
                <button
                  key={`c-${c.id}`}
                  onClick={() => go("contact", c.id)}
                  className="block w-full text-left px-3 py-2 hover:bg-slate-50"
                >
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-slate-500">
                    {c.email || c.phone || "Sin datos de contacto"}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Servicios */}
          {res.services?.length > 0 && (
            <div>
              <div className="px-3 py-1 text-xs text-slate-500">Servicios / Mantenimiento</div>
              {res.services.map((s) => (
                <button
                  key={`s-${s.id}`}
                  onClick={() => go("service", s.id)}
                  className="block w-full text-left px-3 py-2 hover:bg-slate-50"
                >
                  <div className="text-sm font-medium flex items-center gap-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-700 border border-emerald-200">
                      Service
                    </span>
                    <span>
                      {s.reference} {s.placa_id ? `— ${s.placa_id}` : ""}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {s.org_name || "Sin cliente"}
                    {s.modelo ? ` • ${s.modelo}` : ""}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Notas */}
          {res.notes?.length > 0 && (
            <div>
              <div className="px-3 py-1 text-xs text-slate-500">Notas</div>
              {res.notes.map((n) => (
                <button
                  key={`n-${n.id}`}
                  onClick={() =>
                    go("note", n.id, {
                      deal_id: n.deal_id,
                      org_id: n.org_id,
                      contact_id: n.contact_id,
                    })
                  }
                  className="block w-full text-left px-3 py-2 hover:bg-slate-50"
                >
                  <div className="text-sm font-medium line-clamp-2">{n.content}</div>
                  <div className="text-[11px] text-slate-500">
                    {n.deal_reference ? `Op: ${n.deal_reference} · ` : ""}
                    {n.org_name || ""}
                    {n.contact_name ? ` · ${n.contact_name}` : ""}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Sin resultados */}
          {!hasResults && (
            <div className="px-3 py-2 text-sm text-slate-500">Sin resultados</div>
          )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div
          className="relative"
          onMouseEnter={openActivities}
          onMouseLeave={closeActivities}
        >
          <button
            type="button"
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border bg-white text-lg hover:bg-slate-50"
            onClick={() => navigate("/followup")}
            title="Actividades"
          >
            <span aria-hidden>{icons.activities}</span>
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-blue-600 text-white text-[10px] leading-[18px] text-center">
              {counts.activities}
            </span>
          </button>

          {showActivities && (
            <div
              className="absolute right-0 top-full mt-2 w-72 rounded-lg border bg-white shadow-lg p-3 text-xs z-50"
              onMouseEnter={openActivities}
              onMouseLeave={closeActivities}
            >
              <div className="font-semibold text-slate-700 mb-2">Actividades</div>
              {activitiesPreview.length ? (
                <div className="space-y-2">
                  {activitiesPreview.map((a) => (
                    <div key={a.id} className="space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-slate-700 line-clamp-2">
                          {a.subject || "Sin asunto"}
                        </div>
                        <div className="text-[11px] text-slate-500 whitespace-nowrap">
                          {formatDueDate(a.due_date || a.created_at)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500">
                        {a.type && (
                          <span className="uppercase tracking-wide">{a.type}</span>
                        )}
                        {a.org_id ? (
                          <button
                            type="button"
                            className="text-blue-600 hover:underline"
                            onClick={() => navigate(`/organizations/${a.org_id}`)}
                          >
                            {a.org_name || "Organización"}
                          </button>
                        ) : (
                          <span>Sin organización</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-slate-500">No hay actividades pendientes.</div>
              )}
            </div>
          )}
        </div>
        <div
          className="relative"
          onMouseEnter={openTasks}
          onMouseLeave={closeTasks}
        >
          <button
            type="button"
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border bg-white text-lg hover:bg-slate-50"
            onClick={() => navigate("/followup")}
            title="Tareas"
          >
            <span aria-hidden>{icons.tasks}</span>
            {counts.tasks > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] leading-[18px] text-center">
                {counts.tasks}
              </span>
            )}
          </button>

          {showTasks && (
            <div
              className="absolute right-0 top-full mt-2 w-72 rounded-lg border bg-white shadow-lg p-3 text-xs z-50"
              onMouseEnter={openTasks}
              onMouseLeave={closeTasks}
            >
              <div className="font-semibold text-slate-700 mb-2">Tareas pendientes</div>
              {tasksPreview.length ? (
                <div className="space-y-2">
                  {tasksPreview.map((t) => (
                    <div key={t.id} className="space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-slate-700 line-clamp-2">
                          {t.title || "Sin titulo"}
                        </div>
                        <div className="text-[11px] text-slate-500 whitespace-nowrap">
                          {formatDueDate(t.due_at)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500">
                        {t.org_id ? (
                          <button
                            type="button"
                            className="text-blue-600 hover:underline"
                            onClick={() => navigate(`/organizations/${t.org_id}`)}
                          >
                            {t.org_name || "Organización"}
                          </button>
                        ) : (
                          <span>Sin organización</span>
                        )}
                        {t.priority && (
                          <span className="uppercase tracking-wide">{t.priority}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-slate-500">No hay tareas pendientes.</div>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border bg-white text-lg hover:bg-slate-50"
          onClick={() => navigate("/followup")}
          title="Mensajes"
        >
          <span aria-hidden>{icons.notes}</span>
          {counts.notes > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-600 text-white text-[10px] leading-[18px] text-center">
              {counts.notes}
            </span>
          )}
        </button>
      </div>
      </div>
    </>
  );
}
