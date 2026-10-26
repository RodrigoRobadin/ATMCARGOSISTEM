// client/src/pages/Pipeline.jsx
import React, { useEffect, useMemo, useState } from "react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { api } from "../api";
import NewOperationModal from "../components/NewOperationModal";
import { useAuth } from "../auth.jsx";
import { getOperationAttention } from "../utils/operationAttention.js";
import PipelineListViews, { PipelineViewSwitch } from "../components/PipelineListViews.jsx";
import { loadPipelineDeals } from "../utils/loadPipelineDeals.js";
import { WorkCompletionDialog } from "../components/OperationWorkCompletion.jsx";
import {
  DealOutcomeContextMenu,
  MarkDealNotClosedModal,
} from "../components/DealCommercialOutcomeControls.jsx";

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

function getSelectedIndustrialRevisionId(dealId) {
  try {
    const key = `industrial-quote-revision:deal:${Number(dealId)}`;
    const raw = window.localStorage.getItem(key) || window.sessionStorage.getItem(key);
    const parsed = Number(raw || 0);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch (_) {
    return null;
  }
}

function getSelectedCargoCostSheetVersion(dealId) {
  try {
    const raw = window.sessionStorage.getItem(`cargo-cost-sheet-version:deal:${Number(dealId)}`);
    const parsed = Number(raw || 0);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch (_) {
    return null;
  }
}

function pickQuoteProfitSummary(row) {
  const selectedRevisionId = getSelectedIndustrialRevisionId(row?.deal_id);
  const selectedCostSheetVersion = getSelectedCargoCostSheetVersion(row?.deal_id);
  const revisions = Array.isArray(row?.revisions) ? row.revisions : [];
  const costSheetVersions = Array.isArray(row?.cost_sheet_versions) ? row.cost_sheet_versions : [];
  const selectedCostSheet = selectedCostSheetVersion
    ? costSheetVersions.find((version) => Number(version.version_number) === Number(selectedCostSheetVersion))
    : null;
  const selectedRevision = selectedRevisionId
    ? revisions.find((revision) => Number(revision.id) === Number(selectedRevisionId))
    : null;
  const latestRevision = revisions[0] || null;
  const latestCostSheet = costSheetVersions[0] || null;
  const source = selectedCostSheet || selectedRevision || latestRevision || latestCostSheet || row || {};
  return {
    total_sales_usd: source.total_sales_usd,
    profit_total_usd: source.profit_total_usd,
    profit_total_display: source.profit_total_display,
    profit_total_currency: source.profit_total_currency || row?.profit_total_currency || "USD",
  };
}

export default function Pipeline() {
  const nav = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = ['table', 'forecast'].includes(searchParams.get('view')) ? searchParams.get('view') : 'funnel';
  const completedOnly = searchParams.get('work') === 'completed';
  const { user } = useAuth();
  const isAdmin = String(user?.role || "").toLowerCase() === "admin";
  const [attentionNow, setAttentionNow] = useState(Date.now());
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedStageId, setSelectedStageId] = useState('');
  const advisorFilterKey = `pipeline-advisor:${user?.id || 'anonymous'}`;

  const [pipelineId, setPipelineId] = useState(null);
  const [stages, setStages] = useState([]);
  const [deals, setDeals] = useState([]);
  const [advisorUsers, setAdvisorUsers] = useState([]);
  const [selectedAdvisorUserId, setSelectedAdvisorUserId] = useState(() => {
    try {
      return window.localStorage.getItem(`pipeline-advisor:${user?.id || 'anonymous'}`) || "";
    } catch {
      return "";
    }
  });
  const [dealCFMap, setDealCFMap] = useState({});
  const [quoteTotals, setQuoteTotals] = useState({});
  const [openModal, setOpenModal] = useState(false);
  const [outcomeMenu, setOutcomeMenu] = useState(null);
  const [dealToMarkNotClosed, setDealToMarkNotClosed] = useState(null);
  const [dealToChangeWork, setDealToChangeWork] = useState(null);

  const [stageAliasMap, setStageAliasMap] = useState({});
  const [hiddenStageIds, setHiddenStageIds] = useState(new Set());

  useEffect(() => {
    if (!isAdmin || !user?.id) return;
    try {
      setSelectedAdvisorUserId(window.localStorage.getItem(advisorFilterKey) || "");
    } catch {
      setSelectedAdvisorUserId("");
    }
  }, [advisorFilterKey, isAdmin, user?.id]);

  function selectAdvisor(value) {
    setSelectedAdvisorUserId(value);
    try {
      window.localStorage.setItem(advisorFilterKey, value);
    } catch {}
  }

  useEffect(() => {
    (async () => {
      if (isAdmin) {
        try {
          const { data } = await api.get("/users/select", { params: { active: 1 } });
          setAdvisorUsers(Array.isArray(data) ? data : []);
        } catch {
          setAdvisorUsers([]);
        }
      }
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

      const [{ data: s }, d] = await Promise.all([
        api.get(`/pipelines/${pid}/stages`),
        loadPipelineDeals(api, {
            pipeline_id: pid,
            commercial_outcome: "active",
            work_state: completedOnly ? "completed" : "active",
            ...(isAdmin && selectedAdvisorUserId ? { deal_advisor_user_id: selectedAdvisorUserId } : {}),
        }),
      ]);

      const visibleStages = (s || []).filter((st) => !hiddenStageIds.has(String(st.id)));
      setStages(visibleStages);
      setDeals(d || []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pipelineId) return;
    refreshDeals(pipelineId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAdvisorUserId, completedOnly]);

  useEffect(() => {
    const timer = window.setInterval(() => setAttentionNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!pipelineId) return;
    const onFocus = () => { refreshDeals(pipelineId).catch(() => {}); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineId, selectedAdvisorUserId]);

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
          if (row?.deal_id == null) continue;
          if (map[row.deal_id] !== undefined) continue;
          map[row.deal_id] = pickQuoteProfitSummary(row);
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
    const prospectStageIds = new Set(stages.filter((stage) => String(stage.name || '').trim().toLowerCase() === 'prospecto').map((stage) => stage.id));
    const term = search.trim().toLocaleLowerCase();
    for (const d of deals) {
      if (attentionOnly && !completedOnly && !getOperationAttention(d, attentionNow, prospectStageIds.has(d.stage_id))) continue;
      if (selectedStageId && String(d.stage_id) !== selectedStageId) continue;
      if (term && ![d.reference, d.title, d.org_name, d.contact_name, d.deal_advisor_name]
        .filter(Boolean).join(' ').toLocaleLowerCase().includes(term)) continue;
      if (!g[d.stage_id]) g[d.stage_id] = [];
      g[d.stage_id].push(d);
    }
    return g;
  }, [stages, deals, attentionOnly, completedOnly, attentionNow, search, selectedStageId]);

  const displayedStages = useMemo(() => stages.filter((stage) => !selectedStageId || String(stage.id) === selectedStageId), [stages, selectedStageId]);
  const visibleDeals = useMemo(() => displayedStages.flatMap((stage) => grouped[stage.id] || []), [displayedStages, grouped]);

  function changeView(nextView) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextView === 'funnel') next.delete('view');
      else next.set('view', nextView);
      return next;
    });
  }

  function stageLabel(stage) {
    return stageAliasMap[String(stage.id)] || stage.name;
  }

  function stageProfit(stageId) {
    const list = grouped[stageId] || [];
    return list.reduce((sum, deal) => {
      const v = Number(quoteTotals[deal.id]?.profit_total_display ?? 0);
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0);
  }

  async function onDragEnd(result) {
    if (completedOnly) return;
    const { destination, source, draggableId } = result;
    if (!destination) return;
    const from = source.droppableId;
    const to = destination.droppableId;
    if (from === to) return;

    const id = Number(draggableId);
    const { data } = await api.patch(`/deals/${id}`, { stage_id: Number(to) });
    setDeals((prev) =>
      prev.map((d) =>
        d.id === id
          ? { ...d, stage_id: Number(to), ...(data?.reference ? { reference: data.reference } : {}) }
          : d
      )
    );
  }

  async function refreshDeals(pid) {
    const data = await loadPipelineDeals(api, {
        pipeline_id: pid ?? pipelineId,
        commercial_outcome: "active",
        work_state: completedOnly ? "completed" : "active",
        ...(isAdmin && selectedAdvisorUserId ? { deal_advisor_user_id: selectedAdvisorUserId } : {}),
    });
    setDeals(data || []);
  }

  function openOutcomeMenu(event, deal) {
    event.preventDefault();
    event.stopPropagation();
    setOutcomeMenu({ deal, position: { x: event.clientX, y: event.clientY } });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-lg font-semibold">Pipeline</h2>
        <div className="flex flex-wrap items-center gap-2">
          <PipelineViewSwitch value={view} onChange={changeView} />
          <select aria-label="Estado del trabajo" value={completedOnly ? 'completed' : 'active'}
            onChange={(event) => setSearchParams((previous) => {
              const next = new URLSearchParams(previous);
              if (event.target.value === 'completed') next.set('work', 'completed');
              else next.delete('work');
              return next;
            })}
            className="rounded border bg-white px-3 py-2 text-sm">
            <option value="active">Trabajos activos</option>
            <option value="completed">Finalizados</option>
          </select>
          <input type="search" aria-label="Buscar operaciones" placeholder="Buscar operación o cliente" value={search}
            onChange={(event) => setSearch(event.target.value)} className="min-w-48 rounded border bg-white px-3 py-2 text-sm" />
          <select aria-label="Filtrar por etapa" value={selectedStageId} onChange={(event) => setSelectedStageId(event.target.value)}
            className="rounded border bg-white px-3 py-2 text-sm">
            <option value="">Todas las etapas</option>
            {stages.map((stage) => <option key={stage.id} value={stage.id}>{stageLabel(stage)}</option>)}
          </select>
          {!completedOnly && <label className="flex items-center gap-2 px-2 text-sm whitespace-nowrap cursor-pointer">
            <input type="checkbox" checked={attentionOnly} onChange={(event) => setAttentionOnly(event.target.checked)} />
            Requieren atención
          </label>}
          {isAdmin && (
            <select
              className="px-3 py-2 text-sm rounded-lg border bg-white dark:bg-slate-950 dark:border-slate-700"
              value={selectedAdvisorUserId}
              onChange={(e) => selectAdvisor(e.target.value)}
              title="Filtrar por comercial"
            >
              <option value="">Todos los comerciales</option>
              {advisorUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.email || `Usuario ${u.id}`}
                </option>
              ))}
            </select>
          )}
          {/* ✏️ Editor en pantalla completa */}
          <button
            onClick={() =>
              nav(`/pipelines/${pipelineId || ""}/edit?back=${encodeURIComponent(location.pathname)}`)
            }
            className="px-3 py-2 text-sm rounded-lg border hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            title="Editar columnas del pipeline"
          >
            ✏️ Editar pipeline
          </button>
          <button
            onClick={() => setOpenModal(true)}
            className="px-3 py-2 text-sm rounded-lg bg-black text-white dark:bg-white dark:text-black"
          >
            Nueva operación
          </button>
        </div>
      </div>

      {view === 'funnel' ? <DragDropContext onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
          {displayedStages.map((stage) => (
            <Droppable droppableId={String(stage.id)} key={stage.id}>
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="bg-white dark:bg-slate-950 dark:border dark:border-slate-800 rounded-2xl shadow p-3 min-h-[200px]"
                >
                  <div className="sticky top-[73px] z-20 -mx-3 -mt-3 mb-2 rounded-t-2xl border-b border-slate-100 bg-white px-3 pb-2 pt-3 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                    <div className="font-medium flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span>{stageLabel(stage)}</span>
                        <span className="text-xs bg-emerald-50 text-emerald-700 rounded px-2 py-0.5">
                          Profit $ {stageProfit(stage.id).toLocaleString()}
                        </span>
                      </div>
                      <span className="text-xs bg-slate-100 dark:bg-slate-800 rounded px-2 py-0.5">
                        {grouped[stage.id]?.length || 0}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {(grouped[stage.id]?.length || 0)} {completedOnly ? 'finalizados' : 'abiertos'}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {(grouped[stage.id] || []).map((deal, idx) => {
                      const createdDays = diffDays(deal.created_at);
                      const fCotiz = dealCFMap[deal.id]?.f_cotiz || "";
                      const cotizDays = fCotiz ? diffDays(fCotiz) : null;

                      let warnText = null;
                      let warnClass = "text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200";
                      if (!completedOnly && cotizDays != null) {
                        if (cotizDays > 10 && cotizDays <= 15) {
                          const left = 15 - cotizDays;
                          warnText = `Vence en ${left} d`;
                        } else if (cotizDays > 15) {
                          const late = cotizDays - 15;
                          warnText = `Atrasado ${late} d`;
                          warnClass = "text-xs px-2 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200";
                        }
                      }
                      const hasOverBudget = String(deal.expense_control_status || "") === "over_budget";
                      const attention = completedOnly ? null : getOperationAttention(deal, attentionNow, String(stage.name || '').toLowerCase() === 'prospecto');

                      return (
                        <Draggable draggableId={String(deal.id)} index={idx} key={deal.id} isDragDisabled={completedOnly}>
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
                              onContextMenu={(event) => openOutcomeMenu(event, deal)}
                              className={`block w-full border rounded-xl p-3 hover:shadow transition cursor-pointer ${
                                hasOverBudget || attention
                                  ? "border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800"
                                  : "bg-white dark:bg-slate-900 dark:border-slate-800"
                              }`}
                              title={[hasOverBudget ? "Sobrecosto" : null, attention?.label].filter(Boolean).join(" · ") || "Doble clic para abrir"}
                            >
                              <div className="text-sm font-semibold truncate">
                                {deal.reference || deal.title}
                              </div>
                              {completedOnly && <span className="text-xs font-medium text-emerald-700">Finalizada · Aprobada</span>}
                              <div className="text-xs text-slate-600 dark:text-slate-400 truncate">
                                {deal.org_name || "—"} • {deal.contact_name || "—"}
                              </div>

                              <div className="flex items-center gap-2 flex-wrap mt-2">
                                <span className="text-xs bg-slate-100 dark:bg-slate-800 rounded px-2 py-0.5">
                                  $ {Number(quoteTotals[deal.id]?.profit_total_display ?? (deal.value || 0)).toLocaleString()}
                                </span>
                                {typeof createdDays === "number" && (
                                  <span className="text-xs bg-slate-100 dark:bg-slate-800 rounded px-2 py-0.5">
                                    hace {createdDays} d
                                  </span>
                                )}
                                {warnText && <span className={warnClass}>{warnText}</span>}
                                {attention && <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/50 dark:text-red-200">{attention.label}</span>}
                              </div>

                              {fCotiz && (
                                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
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
      </DragDropContext> : <PipelineListViews view={view} deals={visibleDeals} stages={stages} stageLabel={stageLabel} completedOnly={completedOnly}
        quoteTotals={quoteTotals} onExpectedCloseSaved={(dealId, date) => setDeals((current) => current.map((deal) =>
          Number(deal.id) === Number(dealId) ? { ...deal, expected_close_date: date } : deal
        ))} />}

      <DealOutcomeContextMenu
        deal={outcomeMenu?.deal}
        position={outcomeMenu?.position}
        onClose={() => setOutcomeMenu(null)}
        onMarkNotClosed={setDealToMarkNotClosed}
        onChangeWorkCompletion={setDealToChangeWork}
        canChangeWorkCompletion={Boolean(outcomeMenu?.deal && /^OP-\d+$/i.test(String(outcomeMenu.deal.reference || '')) &&
          (isAdmin || Number(outcomeMenu.deal.deal_advisor_user_id || 0) === Number(user?.id || 0)))}
      />

      {dealToChangeWork && <WorkCompletionDialog
        deal={dealToChangeWork}
        onClose={() => setDealToChangeWork(null)}
        onChanged={() => refreshDeals()}
      />}

      <MarkDealNotClosedModal
        deal={dealToMarkNotClosed}
        onClose={() => setDealToMarkNotClosed(null)}
        onSaved={() => refreshDeals()}
      />

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
