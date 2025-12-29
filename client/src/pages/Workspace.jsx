// client/src/pages/Workspace.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { api } from "../api";
import NewOperationModal from "../components/NewOperationModal";
import NewIndustrialOperationModal from "../components/NewIndustrialOperationModal";

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

export default function Workspace() {
  const { key } = useParams(); // ej: "atm-cargo", "atm-industrial"
  const nav = useNavigate();
  const location = useLocation();

  const [bu, setBu] = useState(null);
  const [pipelineId, setPipelineId] = useState(null);
  const [stages, setStages] = useState([]);
  const [deals, setDeals] = useState([]);
  const [openModal, setOpenModal] = useState(false);
  const [loading, setLoading] = useState(true);

  const [stageAliasMap, setStageAliasMap] = useState({});
  const [hiddenStageIds, setHiddenStageIds] = useState(new Set());
  const [dealCFMap, setDealCFMap] = useState({});

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
      setDealCFMap(next);
    })();
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

                      return (
                        <Draggable
                          draggableId={String(deal.id)}
                          index={idx}
                          key={deal.id}
                        >
                          {(provided) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              onDoubleClick={() =>
                                nav(`/operations/${deal.id}`)
                              }
                              className="border rounded-xl p-3 hover:shadow transition bg-white cursor-pointer"
                              title="Doble clic para abrir"
                            >
                              <div className="text-sm font-semibold truncate">
                                {deal.reference || deal.title}
                              </div>
                              <div className="text-xs text-slate-600 truncate">
                                {deal.org_name || "—"} •{" "}
                                {deal.contact_name || "—"}
                              </div>

                              <div className="flex items-center gap-2 flex-wrap mt-2">
                                <span className="text-xs bg-slate-100 rounded px-2 py-0.5">
                                  $ {Number(deal.value || 0).toLocaleString()}
                                </span>
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
                            </div>
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
