// client/src/pages/Pipeline.jsx
import React, { useEffect, useMemo, useState } from "react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { useNavigate, useLocation } from "react-router-dom";
import { api } from "../api";
import NewOperationModal from "../components/NewOperationModal";

/* helpers */
const msPerDay = 24 * 60 * 60 * 1e3;
const toDate = (v) => (v ? new Date(v) : null);
const diffDays = (from, to = new Date()) => {
  const d = toDate(from);
  if (!d) return null;
  return Math.floor((to - d) / msPerDay);
};

function buildStageAliasMap(rows = []) {
  const map = {};
  for (const r of rows) {
    const val = String(r.value ?? "").trim();
    if (!val) continue;
    try {
      if (val.startsWith("{")) {
        const obj = JSON.parse(val);
        Object.keys(obj).forEach((k) => (map[String(k)] = String(obj[k])));
        continue;
      }
    } catch {}
    const [id, label] = val.split("|");
    if (id && label) map[String(id.trim())] = String(label.trim());
  }
  return map;
}
function buildHiddenStageSet(rows = []) {
  const set = new Set();
  for (const r of rows) {
    const id = String(r.value ?? "").trim();
    if (id) set.add(id);
  }
  return set;
}

function getOperationUrl(id) {
  const base = import.meta.env.BASE_URL || "/";
  const normalized = base.endsWith("/") ? base : `${base}/`;
  return `${window.location.origin}${normalized}operations/${id}`;
}

function openInNewTab(url) {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.style.display = "none";
  document.body.appendChild(link);
  link.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
  );
  document.body.removeChild(link);
}

export default function Pipeline() {
  const nav = useNavigate();
  const location = useLocation();

  const [pipelineId, setPipelineId] = useState(null);
  const [stages, setStages] = useState([]);
  const [deals, setDeals] = useState([]);
  const [dealCFMap, setDealCFMap] = useState({});
  const [quoteTotals, setQuoteTotals] = useState({});
  const [openModal, setOpenModal] = useState(false);

  const [stageAliasMap, setStageAliasMap] = useState({});
  const [hiddenStageIds, setHiddenStageIds] = useState(new Set());

  useEffect(() => {
    (async () => {
      let chosenPid = null;
      try {
        const { data: params } = await api.get("/params", {
          params: { keys: "kanban_stage_labels,kanban_hide_stages,kanban_pipeline_id" },
        });
        setStageAliasMap(buildStageAliasMap(params?.kanban_stage_labels || []));
        setHiddenStageIds(buildHiddenStageSet(params?.kanban_hide_stages || []));
        const pidParam = (params?.kanban_pipeline_id || [])[0]?.value;
        if (pidParam) chosenPid = Number(pidParam);
      } catch {}

      const { data: p } = await api.get("/pipelines");
      const pid = chosenPid || p?.[0]?.id;
      setPipelineId(pid);

      const [{ data: s }, { data: d }] = await Promise.all([
        api.get(`/pipelines/${pid}/stages`),
        api.get("/deals", { params: { pipeline_id: pid } }),
      ]);

      const visibleStages = (s || []).filter((st) => !hiddenStageIds.has(String(st.id)));
      setStages(visibleStages);
      setDeals(d || []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!deals.length) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.allSettled(
        deals.map(async (deal) => {
          try {
            const { data } = await api.get(`/deals/${deal.id}/custom-fields`).catch(() => ({ data: [] }));
            const map = {};
            for (const row of data || []) {
              if (row?.key === "f_cotiz") map.f_cotiz = row.value || "";
            }
            return [deal.id, map];
          } catch {
            return [deal.id, {}];
          }
        })
      );
      const next = {};
      for (const it of entries) {
        if (it.status === "fulfilled") {
          const [id, cf] = it.value;
          next[id] = cf;
        }
      }
      if (!cancelled) setDealCFMap(next);

      try {
        const { data } = await api.get("/quotes");
        const map = {};
        for (const row of data || []) {
          if (row?.deal_id == null || row?.total_sales_usd == null) continue;
          if (map[row.deal_id] !== undefined) continue;
          map[row.deal_id] = row.total_sales_usd;
        }
        if (!cancelled) setQuoteTotals(map);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [deals]);

  const grouped = useMemo(() => {
    const g = Object.fromEntries(stages.map((s) => [s.id, []]));
    for (const d of deals) {
      if (!g[d.stage_id]) g[d.stage_id] = [];
      g[d.stage_id].push(d);
    }
    return g;
  }, [stages, deals]);

  function stageLabel(stage) {
    return stageAliasMap[String(stage.id)] || stage.name;
  }

  async function onDragEnd(result) {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    const from = source.droppableId;
    const to = destination.droppableId;
    if (from === to) return;

    const id = Number(draggableId);
    await api.patch(`/deals/${id}`, { stage_id: Number(to) });
    setDeals((prev) => prev.map((d) => (d.id === id ? { ...d, stage_id: Number(to) } : d)));
  }

  async function refreshDeals(pid) {
    const { data } = await api.get("/deals", { params: { pipeline_id: pid ?? pipelineId } });
    setDeals(data || []);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Pipeline</h2>
        <div className="flex gap-2">
          {/* ✏️ Editor en pantalla completa */}
          <button
            onClick={() =>
              nav(`/pipelines/${pipelineId || ""}/edit?back=${encodeURIComponent(location.pathname)}`)
            }
            className="px-3 py-2 text-sm rounded-lg border hover:bg-slate-50"
            title="Editar columnas del pipeline"
          >
            ✏️ Editar pipeline
          </button>
          <button
            onClick={() => setOpenModal(true)}
            className="px-3 py-2 text-sm rounded-lg bg-black text-white"
          >
            Nueva operación
          </button>
        </div>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
          {stages.map((stage) => (
            <Droppable droppableId={String(stage.id)} key={stage.id}>
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="bg-white rounded-2xl shadow p-3 min-h-[200px]"
                >
                  <div className="mb-2">
                    <div className="font-medium flex items-center justify-between">
                      <span>{stageLabel(stage)}</span>
                      <span className="text-xs bg-slate-100 rounded px-2 py-0.5">
                        {grouped[stage.id]?.length || 0}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {(grouped[stage.id]?.length || 0)} abiertos
                    </div>
                  </div>

                  <div className="space-y-2">
                    {(grouped[stage.id] || []).map((deal, idx) => {
                      const createdDays = diffDays(deal.created_at);
                      const fCotiz = dealCFMap[deal.id]?.f_cotiz || "";
                      const cotizDays = fCotiz ? diffDays(fCotiz) : null;

                      let warnText = null;
                      let warnClass = "text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800";
                      if (cotizDays != null) {
                        if (cotizDays > 10 && cotizDays <= 15) {
                          const left = 15 - cotizDays;
                          warnText = `Vence en ${left} d`;
                        } else if (cotizDays > 15) {
                          const late = cotizDays - 15;
                          warnText = `Atrasado ${late} d`;
                          warnClass = "text-xs px-2 py-0.5 rounded bg-red-100 text-red-700";
                        }
                      }

                      return (
                        <Draggable draggableId={String(deal.id)} index={idx} key={deal.id}>
                          {(provided) => (
                            <a
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              href={getOperationUrl(deal.id)}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(event) => event.preventDefault()}
                              onDoubleClickCapture={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                openInNewTab(getOperationUrl(deal.id));
                              }}
                              className="block w-full border rounded-xl p-3 hover:shadow transition bg-white cursor-pointer"
                              title="Doble clic para abrir"
                            >
                              <div className="text-sm font-semibold truncate">
                                {deal.reference || deal.title}
                              </div>
                              <div className="text-xs text-slate-600 truncate">
                                {deal.org_name || "—"} • {deal.contact_name || "—"}
                              </div>

                              <div className="flex items-center gap-2 flex-wrap mt-2">
                                <span className="text-xs bg-slate-100 rounded px-2 py-0.5">
                                  $ {Number(quoteTotals[deal.id] ?? (deal.value || 0)).toLocaleString()}
                                </span>
                                {typeof createdDays === "number" && (
                                  <span className="text-xs bg-slate-100 rounded px-2 py-0.5">
                                    hace {createdDays} d
                                  </span>
                                )}
                                {warnText && <span className={warnClass}>{warnText}</span>}
                              </div>

                              {fCotiz && (
                                <div className="text-[11px] text-slate-500 mt-1">
                                  Cotizado: {fCotiz}
                                  {cotizDays != null ? ` • ${cotizDays} d` : ""}
                                </div>
                              )}
                            </a>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                  </div>
                </div>
              )}
            </Droppable>
          ))}
        </div>
      </DragDropContext>

      {openModal && (
        <NewOperationModal
          onClose={() => setOpenModal(false)}
          pipelineId={pipelineId}
          stages={stages}
          onCreated={async () => {
            await refreshDeals();
            setOpenModal(false);
          }}
        />
      )}
    </div>
  );
}
