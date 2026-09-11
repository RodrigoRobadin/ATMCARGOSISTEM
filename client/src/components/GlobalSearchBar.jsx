// client/src/components/GlobalSearchBar.jsx
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import Chatbox from "./Chatbox.jsx";
import GlobalSearchPanel from "./GlobalSearchPanel.jsx";

export default function GlobalSearchBar() {
  const [counts, setCounts] = useState({ activities: 0, tasks: 0, notes: 0 });
  const [notifCount, setNotifCount] = useState(0);
  const [notifList, setNotifList] = useState([]);
  const [showNotif, setShowNotif] = useState(false);
  const [activitiesPreview, setActivitiesPreview] = useState([]);
  const [showActivities, setShowActivities] = useState(false);
  const [tasksPreview, setTasksPreview] = useState([]);
  const [showTasks, setShowTasks] = useState(false);
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

  const markNotifRead = async (notification) => {
    const followupMatch = String(notification?.type || '').match(/^followup-(\d+)-/);
    const target = followupMatch
      ? `/followup-management?tab=agenda&task_id=${followupMatch[1]}`
      : notification?.org_id ? `/organizations/${notification.org_id}` : null;
    try {
      await api.patch(`/notifications/${notification.id}/read`);
      setNotifList((prev) => prev.filter((n) => n.id !== notification.id));
      setNotifCount((c) => Math.max(0, c - 1));
      if (target) navigate(target);
    } catch (e) {
      console.error("No se pudo marcar notificacion", e);
      if (target) navigate(target);
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

  return (
    <>
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
                    onClick={() => markNotifRead(n)}
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

      <GlobalSearchPanel />
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
