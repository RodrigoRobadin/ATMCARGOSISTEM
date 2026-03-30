// client/src/pages/Workspace.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { api } from "../api";
import NewOperationModal from "../components/NewOperationModal";
import NewIndustrialOperationModal from "../components/NewIndustrialOperationModal";
import { useAuth } from "../auth.jsx";

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

function getOrganizationUrl(id) {
  const base = import.meta.env.BASE_URL || "/";
  const normalized = base.endsWith("/") ? base : `${base}/`;
  return `${window.location.origin}${normalized}organizations/${id}`;
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

export default function Workspace() {
  const { key } = useParams(); // ej: "atm-cargo", "atm-industrial"
  const nav = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const [bu, setBu] = useState(null);
  const [pipelineId, setPipelineId] = useState(null);
  const [stages, setStages] = useState([]);
  const [deals, setDeals] = useState([]);
  const [openModal, setOpenModal] = useState(false);
  const [loading, setLoading] = useState(true);

  const [stageAliasMap, setStageAliasMap] = useState({});
  const [hiddenStageIds, setHiddenStageIds] = useState(new Set());
  const [dealCFMap, setDealCFMap] = useState({});
  const [quoteTotals, setQuoteTotals] = useState({});

  const isIndustrial =
    key === "atm-industrial" || (bu && bu.key_slug === "atm-industrial");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // 1) Traer unidades de negocio y detectar la actual
        const { data: units } = await api.get("/business-units");
        const found = (units || []).find((u) => u.key_slug === key) || null;
        setBu(found);

        // 2) Intentar leer parámetros (si tu backend /params existe; si no, el try/catch lo ignora)
        let chosenPid = null;
        try {
          const keys = [
            "kanban_stage_labels",
            "kanban_hide_stages",
            "kanban_pipeline_id",
            `kanban_stage_labels__${key}`,
            `kanban_hide_stages__${key}`,
            `kanban_pipeline_id__${key}`,
          ].join(",");
          const { data: params } = await api.get("/params", { params: { keys } });

          let alias = buildStageAliasMap(params?.kanban_stage_labels || []);
          let hidden = buildHiddenStageSet(params?.kanban_hide_stages || []);
          let pidParam = (params?.kanban_pipeline_id || [])[0]?.value;

          const buAlias = buildStageAliasMap(
            params?.[`kanban_stage_labels__${key}`] || []
          );
          const buHidden = buildHiddenStageSet(
            params?.[`kanban_hide_stages__${key}`] || []
          );
          const buPidParam =
            (params?.[`kanban_pipeline_id__${key}`] || [])[0]?.value;

          alias = { ...alias, ...buAlias };
          if (buHidden.size) hidden = buHidden;
          if (buPidParam) pidParam = buPidParam;

          setStageAliasMap(alias);
          setHiddenStageIds(hidden);
          if (pidParam) chosenPid = Number(pidParam);
        } catch {
          // si /params no existe o falla, simplemente seguimos sin chosenPid
        }

        // 3) Traer todos los pipelines
        const { data: p } = await api.get("/pipelines");

        let pid = chosenPid || null;

        // Si NO hay pid por parámetros, decidimos según el workspace
        if (!pid) {
          // Para ATM INDUSTRIAL forzamos pipeline 1
          if (key === "atm-industrial") {
            pid = 1;
          } else {
            // Resto de workspaces (ej: atm-cargo) usan el primer pipeline
            pid = p?.[0]?.id;
          }
        }

        setPipelineId(pid);

        // 4) Stages + deals de ese pipeline
        const [{ data: s }, { data: d }] = await Promise.all([
          api.get(`/pipelines/${pid}/stages`),
          api.get("/deals", {
            params: { pipeline_id: pid, business_unit_id: found?.id },
          }),
        ]);

        // IMPORTANT: usamos el set 'hidden' calculado arriba (hiddenStageIds puede no estar actualizado aún)
        const visibleStages = (s || []).filter(
          (st) => !hiddenStageIds.has(String(st.id))
        );
        setStages(visibleStages);
        setDeals(d || []);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!deals.length) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.allSettled(
        deals.map(async (deal) => {
          try {
            const { data } = await api
              .get(`/deals/${deal.id}/custom-fields`)
              .catch(() => ({ data: [] }));
            const map = {};
            for (const row of (data || [])) {
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
          if (row?.deal_id == null) continue;
          if (map[row.deal_id] !== undefined) continue;
          map[row.deal_id] = {
            profit_total_display: row.profit_total_display,
            profit_total_currency: row.profit_total_currency || "USD",
          };
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

  function stageProfitSums(stageId) {
    const list = grouped[stageId] || [];
    return list.reduce((acc, deal) => {
      const q = quoteTotals[deal.id];
      if (q && typeof q.profit_total_display === "number") {
        const curr = String(q.profit_total_currency || "USD").toUpperCase();
        const label = curr === "PYG" || curr === "GS" ? "Gs" : "USD";
        acc[label] = (acc[label] || 0) + Number(q.profit_total_display || 0);
        return acc;
      }
      if (deal?.value != null) {
        acc.USD = (acc.USD || 0) + Number(deal.value || 0);
      }
      return acc;
    }, {});
  }

  async function onDragEnd(result) {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId) return;

    const id = Number(draggableId);
    await api.patch(`/deals/${id}`, {
      stage_id: Number(destination.droppableId),
    });
    setDeals((prev) =>
      prev.map((d) =>
        d.id === id
          ? { ...d, stage_id: Number(destination.droppableId) }
          : d
      )
    );
  }

  async function refresh() {
    if (!pipelineId || !bu?.id) return;
    const { data } = await api.get("/deals", {
      params: { pipeline_id: pipelineId, business_unit_id: bu.id },
    });
    setDeals(data || []);
  }

  if (loading)
    return <div className="text-sm text-slate-600">Cargando…</div>;
  if (!bu)
    return (
      <div className="text-sm text-slate-600">Workspace no encontrado.</div>
    );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Workspace: {bu.name}</h2>
          <p className="text-xs text-slate-500">
            Pipeline: {pipelineId ?? "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              nav(
                `/pipelines/${pipelineId || ""}/edit?back=${encodeURIComponent(
                  location.pathname
                )}`
              )
            }
            className="px-3 py-2 text-sm rounded-lg border hover:bg-slate-50"
            title="Editar columnas del pipeline"
          >
            ✏️ Editar pipeline
          </button>

          <Link
            to={`/workspace/${key}/table`}
            className="px-3 py-2 text-sm rounded-lg border hover:bg-slate-50"
          >
            Ver como tabla
          </Link>
          <button
            onClick={() => setOpenModal(true)}
            className="px-3 py-2 text-sm rounded-lg bg-black text-white"
          >
            ➕ Nueva operación
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
                        <div className="flex items-center gap-2">
                          <span>{stageLabel(stage)}</span>
                          {(() => {
                            const sums = stageProfitSums(stage.id);
                            const labels = Object.keys(sums || {});
                            if (!labels.length) return null;
                            return (
                              <span className="flex items-center gap-2">
                                {labels.map((label) => {
                                  const decimals = label === "Gs" ? 0 : 2;
                                  const val = Number(sums[label] || 0);
                                  return (
                                    <span key={label} className="text-xs bg-emerald-50 text-emerald-700 rounded px-2 py-0.5">
                                      {`Profit ${label} ${val.toLocaleString("es-ES", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`}
                                    </span>
                                  );
                                })}
                              </span>
                            );
                          })()}
                        </div>
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
                      const stageText = String(stageLabel(stage) || stage.name || "").toLowerCase();
                      const isProspectStage = stageText === "prospecto";
                      const createdDays = diffDays(deal.created_at);
                      const fCotiz = dealCFMap[deal.id]?.f_cotiz || "";
                      const cotizDays = fCotiz ? diffDays(fCotiz) : null;
                      const isAged =
                        typeof createdDays === "number" && createdDays >= 3;

                      let warnText = null;
                      let warnClass =
                        "text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800";
                      if (cotizDays != null) {
                        if (cotizDays > 10 && cotizDays <= 15) {
                          const left = 15 - cotizDays;
                          warnText = `Vence en ${left} d`;
                        } else if (cotizDays > 15) {
                          const late = cotizDays - 15;
                          warnText = `Atrasado ${late} d`;
                          warnClass =
                            "text-xs px-2 py-0.5 rounded bg-red-100 text-red-700";
                        }
                      }

                      const titleText = isProspectStage
                        ? deal.org_name || deal.title || "Prospecto"
                        : deal.reference || deal.title;
                      const secondaryRight = isProspectStage
                        ? deal.created_by_name || deal.contact_name || "—"
                        : deal.contact_name || "—";
                      const detailUrl =
                        isProspectStage && deal.org_id
                          ? getOrganizationUrl(deal.org_id)
                          : getOperationUrl(deal.id);

                      const hasActivity = Number(deal.org_has_activity || 0) === 1;

                      return (
                        <Draggable
                          draggableId={String(deal.id)}
                          index={idx}
                          key={deal.id}
                        >
                          {(provided) => (
                            <a
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              href={detailUrl}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(event) => event.preventDefault()}
                              onDoubleClickCapture={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                openInNewTab(detailUrl);
                              }}
                              className={`relative block w-full border rounded-xl p-3 hover:shadow transition bg-white cursor-pointer${
                                isAged ? " deal-alert" : ""
                              }`}
                              title="Doble clic para abrir"
                            >
                              {isProspectStage && (
                                <span
                                  className={`absolute top-2 right-2 h-2.5 w-2.5 rounded-full ${
                                    hasActivity ? "bg-emerald-500" : "bg-red-500"
                                  }`}
                                  title={hasActivity ? "Con actividad" : "Sin actividad"}
                                />
                              )}
                              <div className="text-sm font-semibold truncate">
                                {titleText}
                              </div>
                              <div className="text-xs text-slate-600 truncate">
                                {isProspectStage
                                  ? `Agregado por ${secondaryRight}`
                                  : `${deal.org_name || "—"} • ${secondaryRight}`}
                              </div>

                              <div className="flex items-center gap-2 flex-wrap mt-2">
                                  {(() => {
                                    const q = quoteTotals[deal.id];
                                    if (q && typeof q.profit_total_display === "number") {
                                      const curr = String(q.profit_total_currency || "USD").toUpperCase();
                                      const label = curr === "PYG" || curr === "GS" ? "Gs" : "USD";
                                      const decimals = label === "Gs" ? 0 : 2;
                                      const val = Number(q.profit_total_display || 0);
                                      return (
                                        <span className="text-xs bg-emerald-50 text-emerald-700 rounded px-2 py-0.5">
                                          {`${label} ${val.toLocaleString("es-ES", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`}
                                        </span>
                                      );
                                    }
                                    const fallback = Number(deal.value || 0);
                                    return (
                                      <span className="text-xs bg-emerald-50 text-emerald-700 rounded px-2 py-0.5">
                                        {`USD ${fallback.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                      </span>
                                    );
                                  })()}
                                {typeof createdDays === "number" && (
                                  <span className="text-xs bg-slate-100 rounded px-2 py-0.5">
                                    hace {createdDays} d
                                  </span>
                                )}
                                {warnText && (
                                  <span className={warnClass}>{warnText}</span>
                                )}
                              </div>

                              {fCotiz && (
                                <div className="text-[11px] text-slate-500 mt-1">
                                  Cotizado: {fCotiz}
                                  {cotizDays != null
                                    ? ` • ${cotizDays} d`
                                    : ""}
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

      {openModal &&
        (isIndustrial ? (
          <NewIndustrialOperationModal
            onClose={() => setOpenModal(false)}
            pipelineId={pipelineId}
            stages={stages}
            defaultBusinessUnitId={bu.id}
            onCreated={async () => {
              await refresh();
              setOpenModal(false);
            }}
          />
        ) : (
          <NewOperationModal
            onClose={() => setOpenModal(false)}
            pipelineId={pipelineId}
            stages={stages}
            defaultBusinessUnitId={bu.id}
            onCreated={async () => {
              await refresh();
              setOpenModal(false);
            }}
          />
        ))}
    </div>
  );
}
