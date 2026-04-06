// client/src/pages/service/ServiceModule.jsx
import React, { useEffect, useMemo, useState } from "react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { Link } from "react-router-dom";
import { api } from "../../api";
import ServiceSheet from "./ServiceSheet.jsx";

const emptyDoor = {
  org_id: "",
  org_branch_id: "",
  placa_id: "",
  ref_int: "",
  nro_serie: "",
  nombre: "",
  sector: "",
  marca: "Rayflex",
  modelo: "",
  dimensiones: "",
  ancho: "",
  alto: "",
  fecha_instalacion: "",
  fecha_ultimo_mantenimiento: "",
  notas: "",
  component_ids: [],
  actuator_ids: [],
};

const DOOR_MODELS = [
  'RP (Autorreparable)',
  'RP AL 01',
  'RP SL 01 (Sala Limpia)',
  'RP de Emergencia (2 en 1)',
  'Ventana de Seguridad',
  'Vectorflex',
  'Vector M2',
  'Frigoiso / Frigo+',
  'Frigomax',
  'Puerta Seccional Isotérmica',
  'Dockdoor / Dockiso',
  'Nivelador de Muelle Electrohidráulico',
  'Abrigo de Muelle',
];

const COMMON_RAPID_COMPONENTS = [
  'Motor alto rendimiento',
  'Encoder',
  'Panel CLP',
  'Fotocélulas integradas',
  'Lona PVC flexible',
  'Guías laterales',
  'Bolsa inferior de sellado',
  'Sistema de accionadores',
];

const MODEL_COMPONENTS = {
  'RP (Autorreparable)': [
    'Motor alto rendimiento',
    'Encoder',
    'Panel CLP',
    'Fotocélulas integradas',
    'Sensor superior',
    'Lona PVC flexible',
    'Sistema autorreparable',
    'Guías laterales autolubricantes',
    'Bolsa inferior de sellado',
    'Sellado perimetral',
    'Sistema de accionadores',
  ],
  'RP AL 01': [
    'Motor alto rendimiento',
    'Encoder',
    'Panel CLP',
    'Fotocélulas integradas',
    'Sensor superior',
    'Lona PVC flexible',
    'Sistema autorreparable',
    'Guías lisas continuas sin dientes',
    'Bolsa inferior',
    'Sellado lateral reforzado',
    'Sistema para presión hasta 300 Pa',
    'Sistema de accionadores',
  ],
  'RP SL 01 (Sala Limpia)': [
    'Motor incorporado diseño higiénico',
    'Motor alto rendimiento',
    'Encoder',
    'Panel CLP con variador',
    'Fotocélulas integradas',
    'Sensor superior',
    'Lona PVC flexible',
    'Sistema autorreparable',
    'Guías lisas patentadas',
    'Bolsa inferior',
    'Sellado total perimetral',
    'Columnas de aluminio anodizado',
    'Perfil compacto higiénico',
    'Sistema presión positiva/negativa hasta 300 Pa',
    'Sistema de accionadores',
  ],
  'RP de Emergencia (2 en 1)': [
    'Motor alto rendimiento',
    'Encoder absoluto',
    'Panel CLP',
    'Apertura y cierre automáticos temporizados',
    'Fotocélulas',
    'Sensor superior',
    'Lona PVC flexible',
    'Sistema autorreparable',
    'Guías Rayflex sin cremallera',
    'Bolsa inferior',
    'Sistema de salida de emergencia (corte en T)',
    'Cremallera de recomposición',
    'Sistema de accionadores',
  ],
  'Vectorflex': [
    'Motor alto rendimiento',
    'Encoder',
    'Panel CLP',
    'Fotocélulas integradas',
    'Lona PVC flexible',
    'Refuerzos horizontales',
    'Bolsa inferior',
    'Sellado perimetral',
    'Sistema resistencia viento 60 km/h',
    'Sistema de accionadores',
  ],
  'Vector M2': [
    'Motor alto rendimiento',
    'Encoder',
    'Panel CLP',
    'Fotocélulas integradas',
    'Sensor superior',
    'Lona flexible sin barras metálicas',
    'Sistema tirar/empujar',
    'Amortiguadores tipo resorte en guías',
    'Engranajes acoplados al motor',
    'Guías laterales ajustadas',
    'Bolsa inferior',
    'Sellado reforzado',
    'Resistencia viento hasta 115 km/h',
    'Sistema autorreparable',
    'Sistema de accionadores',
  ],
  'Frigoiso / Frigo+': [
    'Motor alto rendimiento',
    'Encoder',
    'Panel CLP',
    'Variador de frecuencia',
    'Sistema de deshielo',
    'Lona isotérmica doble capa',
    'Núcleo aislante térmico',
    'Solapa superior de sellado',
    'Bolsa inferior',
    'Guías Rayflex sin cremallera',
    'Fotocélulas integradas',
    'Sensor superior',
    'Sistema autorreparable',
    'Sistema de accionadores',
  ],
  'Frigomax': [
    'Motor alto rendimiento',
    'Encoder',
    'Panel CLP',
    'Variador de frecuencia',
    'Sistema de deshielo',
    'Lona isotérmica doble capa',
    'Núcleo aislante térmico',
    'Solapa superior',
    'Bolsa inferior',
    'Guías Rayflex',
    'Fotocélulas integradas',
    'Sensor superior',
    'Sistema autorreparable',
    'Sistema de accionadores',
  ],
  'Ventana de Seguridad': [
    'Motor',
    'Encoder',
    'Panel CLP',
    'Pantalla UV',
    'Llaves de seguridad Clase 4',
    'Sistema antiintrusión',
    'Zapatos de ajuste',
    'Sistema integrado con robots',
    'Estructura compacta',
  ],
  'Puerta Seccional Isotérmica': [
    'Paneles isotérmicos 40mm',
    'Gomas de sellado perimetral',
    'Ventanas de policarbonato',
    'Sistema antiaplastamiento de dedos',
    'Dispositivo antirotura de muelles',
    'Sistema anticaída',
    'Refuerzo interior de paneles',
    'Sistema manual / motorizado / automático',
    'Opciones vertical / high lift / standard lift',
  ],
  'Dockdoor / Dockiso': [
    'Lona PVC flexible',
    'Tubos horizontales internos',
    'Bolsa inferior',
    'Sistema resistencia viento 60 km/h',
    'Aislante térmico opcional',
    'Sistema manual (cadena)',
    'Botonera abrir/parar/cerrar',
    'Polipasto manual de emergencia',
  ],
};

export default function ServiceModule() {
  const [view, setView] = useState("pipeline"); // pipeline | doors | sheet
  const [stages, setStages] = useState([]);
  const [cases, setCases] = useState([]);
  const [doors, setDoors] = useState([]);
  const [doorSearch, setDoorSearch] = useState("");
  const [componentTypes, setComponentTypes] = useState([]);
  const [actuatorTypes, setActuatorTypes] = useState([]);
  const [orgOptions, setOrgOptions] = useState([]);
  const [orgSearch, setOrgSearch] = useState("");
  const [doorBranches, setDoorBranches] = useState([]);
  const [doorBranchLoading, setDoorBranchLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showDoorModal, setShowDoorModal] = useState(false);
  const [doorForm, setDoorForm] = useState(emptyDoor);
  const [editingDoorId, setEditingDoorId] = useState(null);
  const [doorModalVariant, setDoorModalVariant] = useState("center"); // center | side
  const [activeModal, setActiveModal] = useState(null); // "case" | "door" | null
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientDoorsOpen, setClientDoorsOpen] = useState(false);
  const [pendingStageMove, setPendingStageMove] = useState(null);
  const [stageMoveSaving, setStageMoveSaving] = useState(false);

  const [showCaseModal, setShowCaseModal] = useState(false);
  const [caseForm, setCaseForm] = useState({
    org_label: "",
    org_id: "",
    door_ids: [],
    scheduled_date: "",
    stage_id: "",
  });

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const [st, cs, dr, comps, acts] = await Promise.all([
          api.get("/service/stages"),
          api.get("/service/cases"),
          api.get("/service/doors"),
          api.get("/service/component-types"),
          api.get("/service/actuator-types"),
        ]);
        setStages(st.data || []);
        setCases(cs.data || []);
        setDoors(dr.data || []);
        setComponentTypes(comps.data || []);
        setActuatorTypes(acts.data || []);
        const { data: orgs } = await api.get("/organizations");
        setOrgOptions(Array.isArray(orgs) ? orgs : []);
      } catch (e) {
        console.error(e);
        setError("No se pudo cargar Service.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const orgId = Number(doorForm.org_id || 0);
    if (!orgId) {
      setDoorBranches([]);
      return;
    }
    let live = true;
    (async () => {
      setDoorBranchLoading(true);
      try {
        const { data } = await api.get(`/organizations/${orgId}/branches`);
        if (live) setDoorBranches(Array.isArray(data) ? data : []);
      } catch (_) {
        if (live) setDoorBranches([]);
      } finally {
        if (live) setDoorBranchLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [doorForm.org_id]);

  const grouped = useMemo(() => {
    const g = Object.fromEntries(stages.map((s) => [s.id, []]));
    for (const c of cases) {
      if (!g[c.stage_id]) g[c.stage_id] = [];
      g[c.stage_id].push(c);
    }
    return g;
  }, [stages, cases]);

  const filteredOrgs = useMemo(() => {
    const q = String(orgSearch || "").toLowerCase();
    if (!q) return orgOptions;
    return orgOptions.filter((o) => {
      const name = String(o.name || "").toLowerCase();
      const ruc = String(o.ruc || "").toLowerCase();
      return name.includes(q) || ruc.includes(q);
    });
  }, [orgOptions, orgSearch]);

  const orgOptionsWithDoors = useMemo(() => {
    const ids = new Set((doors || []).map((d) => String(d.org_id || "")));
    return (orgOptions || []).filter((o) => ids.has(String(o.id)));
  }, [orgOptions, doors]);

  const filteredDoors = useMemo(() => {
    const q = String(doorSearch || "").toLowerCase().trim();
    if (!q) return doors;
    return doors.filter((d) => {
      const placa = String(d.placa_id || "").toLowerCase();
      const refInt = String(d.ref_int || "").toLowerCase();
      const nroSerie = String(d.nro_serie || "").toLowerCase();
      const sector = String(d.sector || "").toLowerCase();
      const nombre = String(d.nombre || "").toLowerCase();
      const orgName = String(d.org_name || "").toLowerCase();
      const orgBranch = String(d.org_branch_name || "").toLowerCase();
      const orgId = String(d.org_id || "").toLowerCase();
      const modelo = String(d.modelo || "").toLowerCase();
      const marca = String(d.marca || "").toLowerCase();
      return (
        placa.includes(q) ||
        refInt.includes(q) ||
        nroSerie.includes(q) ||
        sector.includes(q) ||
        nombre.includes(q) ||
        orgName.includes(q) ||
        orgBranch.includes(q) ||
        orgId.includes(q) ||
        modelo.includes(q) ||
        marca.includes(q)
      );
    });
  }, [doors, doorSearch]);

  const groupedDoorsByOrg = useMemo(() => {
    const map = new Map();
    for (const d of filteredDoors) {
      const key = String(d.org_id || "");
      if (!map.has(key)) {
        map.set(key, {
          org_id: d.org_id,
          org_name: d.org_name || `Org ${d.org_id || "-"}`,
          org_ruc: d.org_ruc || "",
          doors: [],
        });
      }
      map.get(key).doors.push(d);
    }
    return Array.from(map.values()).sort((a, b) =>
      String(a.org_name || "").localeCompare(String(b.org_name || ""), "es")
    );
  }, [filteredDoors]);

  function openClientDoors(client) {
    setSelectedClient(client);
    setClientDoorsOpen(true);
  }

  const caseDoors = useMemo(() => {
    if (!caseForm.org_id) return doors;
    return doors.filter((d) => String(d.org_id) === String(caseForm.org_id));
  }, [doors, caseForm.org_id]);

  const selectedDoors = useMemo(() => {
    const ids = new Set((caseForm.door_ids || []).map((x) => String(x)));
    return caseDoors.filter((d) => ids.has(String(d.id)));
  }, [caseForm.door_ids, caseDoors]);

  function mapComponentNamesToIds(names = []) {
    const map = new Map(componentTypes.map((c) => [c.name, c.id]));
    const ids = [];
    for (const name of names) {
      const id = map.get(name);
      if (id) ids.push(id);
    }
    return Array.from(new Set(ids));
  }

  function applyModelComponents(model) {
    const modelList = MODEL_COMPONENTS[model] || [];
    const useCommon =
      model &&
      model !== 'Puerta Seccional Isotérmica' &&
      model !== 'Dockdoor / Dockiso';
    const names = useCommon
      ? Array.from(new Set([...COMMON_RAPID_COMPONENTS, ...modelList]))
      : modelList;
    const ids = mapComponentNamesToIds(names);
    setDoorForm((prev) => ({ ...prev, component_ids: ids }));
  }

  async function onDragEnd(result) {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId) return;
    const id = Number(draggableId);
    const stage_id = Number(destination.droppableId);
    setPendingStageMove({ id, stage_id });
  }

  async function confirmStageMove() {
    if (!pendingStageMove) return;
    try {
      setStageMoveSaving(true);
      await api.patch(`/service/cases/${pendingStageMove.id}/stage`, {
        stage_id: pendingStageMove.stage_id,
      });
      setCases((prev) =>
        prev.map((c) =>
          c.id === pendingStageMove.id ? { ...c, stage_id: pendingStageMove.stage_id } : c
        )
      );
      setPendingStageMove(null);
    } finally {
      setStageMoveSaving(false);
    }
  }

  function cancelStageMove() {
    if (stageMoveSaving) return;
    setPendingStageMove(null);
  }

  function toggleId(list, id) {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  async function saveDoor() {
    try {
      const dims =
        doorForm.ancho && doorForm.alto
          ? `${doorForm.ancho} x ${doorForm.alto}`
          : doorForm.dimensiones || "";
      const payload = { ...doorForm, dimensiones: dims };
      if (!payload.org_id || !payload.placa_id) {
        alert("Org y placa son requeridos");
        return;
      }
      let createdId = null;
      if (editingDoorId) {
        await api.put(`/service/doors/${editingDoorId}`, payload);
      } else {
        const res = await api.post("/service/doors", payload);
        createdId = res?.data?.id || null;
      }
      const { data } = await api.get("/service/doors");
      setDoors(data || []);
      setShowDoorModal(false);
      setDoorForm(emptyDoor);
      setEditingDoorId(null);
      if (showCaseModal && createdId && String(payload.org_id) === String(caseForm.org_id)) {
        setCaseForm((prev) => ({
          ...prev,
          door_ids: Array.from(new Set([...(prev.door_ids || []), createdId])),
        }));
      }
    } catch (e) {
      alert("No se pudo crear equipo");
    }
  }

  async function openEditDoor(doorId) {
    try {
      const { data } = await api.get(`/service/doors/${doorId}`);
      const door = data?.door || {};
      const comps = Array.isArray(data?.components) ? data.components.map((c) => c.id) : [];
      const acts = Array.isArray(data?.actuators) ? data.actuators.map((a) => a.id) : [];
      const dims = String(door.dimensiones || "");
      let ancho = "";
      let alto = "";
      if (dims.includes("x")) {
        const parts = dims.split("x").map((p) => p.trim());
        ancho = parts[0] || "";
        alto = parts[1] || "";
      }
      setDoorForm({
        org_id: door.org_id || "",
        org_branch_id: door.org_branch_id || "",
        placa_id: door.placa_id || "",
        ref_int: door.ref_int || "",
        nro_serie: door.nro_serie || "",
        nombre: door.nombre || "",
        sector: door.sector || "",
        marca: door.marca || "Rayflex",
        modelo: door.modelo || "",
        dimensiones: door.dimensiones || "",
        ancho,
        alto,
        fecha_instalacion: door.fecha_instalacion?.slice(0, 10) || "",
        fecha_ultimo_mantenimiento: door.fecha_ultimo_mantenimiento?.slice(0, 10) || "",
        notas: door.notas || "",
        component_ids: comps,
        actuator_ids: acts,
      });
      const orgMatch = orgOptions.find((o) => String(o.id) === String(door.org_id));
      if (orgMatch) {
        setOrgSearch(`${orgMatch.name}${orgMatch.ruc ? ` - ${orgMatch.ruc}` : ""}`);
      } else {
        setOrgSearch("");
      }
      setEditingDoorId(doorId);
      setDoorModalVariant("center");
      setActiveModal("door");
      setShowDoorModal(true);
    } catch (e) {
      alert("No se pudo cargar el equipo");
    }
  }

  async function createCase() {
    try {
      if (!caseForm.door_ids?.length) return alert("Seleccioná al menos un equipo");
      await api.post("/service/cases", {
        door_ids: caseForm.door_ids,
        scheduled_date: caseForm.scheduled_date,
        stage_id: caseForm.stage_id,
      });
      const { data } = await api.get("/service/cases");
      setCases(data || []);
      setShowCaseModal(false);
      setCaseForm({ org_label: "", org_id: "", door_ids: [], scheduled_date: "", stage_id: "" });
    } catch (e) {
      alert("No se pudo crear caso");
    }
  }

  if (loading) return <div className="text-sm text-slate-500">Cargando...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Reparación y mantenimiento</h1>
          <p className="text-xs text-slate-500">Pipeline, equipos y planilla por cliente.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border overflow-hidden">
            <button
              className={`px-3 py-1.5 text-sm ${view === "pipeline" ? "bg-slate-900 text-white" : "bg-white"}`}
              onClick={() => setView("pipeline")}
            >
              Pipeline
            </button>
            <button
              className={`px-3 py-1.5 text-sm ${view === "doors" ? "bg-slate-900 text-white" : "bg-white"}`}
              onClick={() => setView("doors")}
            >
              Equipos
            </button>
            <button
              className={`px-3 py-1.5 text-sm ${view === "sheet" ? "bg-slate-900 text-white" : "bg-white"}`}
              onClick={() => setView("sheet")}
            >
              Planilla
            </button>
          </div>
          <button
            className="btn"
            onClick={() => {
              setEditingDoorId(null);
              setDoorForm(emptyDoor);
              setDoorModalVariant("center");
              setActiveModal("door");
              setShowDoorModal(true);
            }}
          >
            + Nuevo equipo
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              setActiveModal("case");
              setShowCaseModal(true);
            }}
          >
            + Nuevo servicio
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {view === "pipeline" && (
        <>
          {pendingStageMove && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
                <div className="text-lg font-semibold text-slate-800">
                  Estas seguro que quiere mover de etapa?
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  Confirma para mover el servicio a la nueva etapa.
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    className="px-4 py-2 text-sm rounded border border-slate-200 hover:bg-slate-50"
                    onClick={cancelStageMove}
                    disabled={stageMoveSaving}
                  >
                    No
                  </button>
                  <button
                    className="px-4 py-2 text-sm rounded bg-slate-900 text-white hover:bg-slate-800"
                    onClick={confirmStageMove}
                    disabled={stageMoveSaving}
                  >
                    {stageMoveSaving ? "Moviendo..." : "Si"}
                  </button>
                </div>
              </div>
            </div>
          )}
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
                        <span>{stage.name}</span>
                        <span className="text-xs bg-slate-100 rounded px-2 py-0.5">
                          {grouped[stage.id]?.length || 0}
                        </span>
                      </div>
                      {(() => {
                        const items = grouped[stage.id] || [];
                        const sums = items.reduce(
                          (acc, c) => {
                            if (typeof c.profit_total_display !== "number") return acc;
                            const curr = String(c.profit_total_currency || "USD").toUpperCase();
                            const label = curr === "PYG" || curr === "GS" ? "Gs" : "USD";
                            acc[label] = (acc[label] || 0) + Number(c.profit_total_display || 0);
                            return acc;
                          },
                          {}
                        );
                        const labels = Object.keys(sums);
                        if (labels.length === 0) return null;
                        return (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {labels.map((label) => {
                              const decimals = label === "Gs" ? 0 : 2;
                              const val = Number(sums[label] || 0);
                              return (
                                <span key={label} className="text-xs bg-emerald-100 text-emerald-700 rounded px-2 py-0.5">
                                  {`Profit ${label} ${val.toLocaleString("es-ES", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`}
                                </span>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>

                    <div className="space-y-2">
                      {(grouped[stage.id] || []).map((c, idx) => {
                      const createdDays = c.created_at
                        ? Math.floor((Date.now() - new Date(c.created_at).getTime()) / 86400000)
                        : null;

                      return (
                        <Draggable draggableId={String(c.id)} index={idx} key={c.id}>
                          {(provided) => (
                            <Link
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              to={`/service/cases/${c.id}`}
                              className="block border rounded-xl p-3 bg-white hover:shadow transition cursor-pointer"
                            >
                              <div className="text-sm font-semibold truncate">
                                {c.reference || `#${c.id}`}
                              </div>
                              <div className="text-xs text-slate-600 truncate">
                                {(c.org_name || "-") + " - " + (c.door_count > 1 ? `${c.door_count} equipos` : (c.placa_id || "Equipo"))}
                              </div>
                              <div className="flex items-center gap-2 flex-wrap mt-2">
                                {typeof c.profit_total_display === "number" && (
                                  <span className="text-xs bg-emerald-100 text-emerald-700 rounded px-2 py-0.5">
                                    {(() => {
                                      const curr = String(c.profit_total_currency || "USD").toUpperCase();
                                      const label = curr === "PYG" || curr === "GS" ? "Gs" : "USD";
                                      const decimals = label === "Gs" ? 0 : 2;
                                      const val = Number(c.profit_total_display || 0);
                                      return `Profit ${label} ${val.toLocaleString("es-ES", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
                                    })()}
                                  </span>
                                )}

                                {c.door_count > 1 && (
                                  <span className="text-xs bg-slate-100 rounded px-2 py-0.5">
                                    {c.door_count} equipos
                                  </span>
                                )}
                                <span className="text-xs bg-slate-100 rounded px-2 py-0.5">
                                  {c.modelo || "Sin modelo"}
                                </span>
                                {typeof createdDays === "number" && (
                                  <span className="text-xs bg-slate-100 rounded px-2 py-0.5">
                                    hace {createdDays} d
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500 mt-1">
                                Ult. mant: {c.fecha_ultimo_mantenimiento?.slice(0, 10) || "-"}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                Programado: {c.scheduled_date?.slice(0, 10) || "-"}
                              </div>
                            </Link>
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
        </>
      )}

      {view === "doors" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              className="border rounded px-3 py-2 w-full max-w-md"
              placeholder="Buscar por placa, nombre, serie, sector, organizacion o modelo"
              value={doorSearch}
              onChange={(e) => setDoorSearch(e.target.value)}
            />
            <span className="text-xs text-slate-500">{groupedDoorsByOrg.length} clientes</span>
          </div>
          <div className="bg-white border rounded-lg overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="text-left px-3 py-2">Cliente</th>
                  <th className="text-left px-3 py-2">RUC</th>
                  <th className="text-left px-3 py-2">Equipos</th>
                  <th className="text-left px-3 py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {groupedDoorsByOrg.map((g) => (
                  <tr key={g.org_id || g.org_name} className="border-t">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-blue-600 underline"
                        onClick={() => openClientDoors(g)}
                      >
                        {g.org_name || g.org_id || "Sin cliente"}
                      </button>
                    </td>
                    <td className="px-3 py-2">{g.org_ruc || "---"}</td>
                    <td className="px-3 py-2">{g.doors.length}</td>
                    <td className="px-3 py-2 space-x-2">
                      <button
                        type="button"
                        className="text-emerald-700 underline"
                        onClick={() => openClientDoors(g)}
                      >
                        Ver equipos
                      </button>
                    </td>
                  </tr>
                ))}
                {groupedDoorsByOrg.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                      Sin equipos registrados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "sheet" && (
        <ServiceSheet />
      )}

      {clientDoorsOpen && selectedClient && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-4xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-lg font-semibold">{selectedClient.org_name || "Cliente"}</div>
                <div className="text-xs text-slate-500">
                  {selectedClient.org_ruc ? `RUC ${selectedClient.org_ruc} · ` : ""}{selectedClient.doors.length} equipos
                </div>
              </div>
              <button
                type="button"
                className="text-sm px-3 py-1.5 rounded border"
                onClick={() => setClientDoorsOpen(false)}
              >
                Cerrar
              </button>
            </div>
            <div className="bg-white border rounded-lg overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th className="text-left px-3 py-2">Nombre</th>
                    <th className="text-left px-3 py-2">Placa</th>
                    <th className="text-left px-3 py-2">Reff Int</th>
                    <th className="text-left px-3 py-2">Nro. Serie</th>
                    <th className="text-left px-3 py-2">Sector</th>
                    <th className="text-left px-3 py-2">Sucursal</th>
                    <th className="text-left px-3 py-2">Marca</th>
                    <th className="text-left px-3 py-2">Modelo</th>
                    <th className="text-left px-3 py-2">Ult. mantenimiento</th>
                    <th className="text-left px-3 py-2">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedClient.doors.map((d) => (
                    <tr key={d.id} className="border-t">
                      <td className="px-3 py-2">{d.nombre || "---"}</td>
                      <td className="px-3 py-2">{d.placa_id}</td>
                      <td className="px-3 py-2">{d.ref_int || "---"}</td>
                      <td className="px-3 py-2">{d.nro_serie || "---"}</td>
                      <td className="px-3 py-2">{d.sector || "---"}</td>
                      <td className="px-3 py-2">{d.org_branch_name || "Sin sucursal"}</td>
                      <td className="px-3 py-2">{d.marca || "Rayflex"}</td>
                      <td className="px-3 py-2">{d.modelo || "---"}</td>
                      <td className="px-3 py-2">{d.fecha_ultimo_mantenimiento?.slice(0, 10) || "---"}</td>
                      <td className="px-3 py-2 space-x-2">
                        <Link className="text-blue-600 underline" to={`/service/doors/${d.id}`}>
                          Ver mantenimiento
                        </Link>
                        <button className="text-emerald-700 underline" onClick={() => openEditDoor(d.id)}>
                          Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                  {selectedClient.doors.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-3 py-4 text-center text-slate-500">
                        Sin equipos para este cliente.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {showDoorModal && (
        <div
          className={`fixed inset-0 ${doorModalVariant === "side" ? "pointer-events-none" : "bg-black/30 flex items-center justify-center"} ${activeModal === "door" ? "z-[70]" : "z-[60]"}`}
        >
          <div
            className={`${doorModalVariant === "side" ? "absolute right-0 top-0 h-full w-full max-w-md shadow-xl border-l border-slate-200" : "rounded-xl w-full max-w-2xl"} bg-white p-4 overflow-auto pointer-events-auto`}
            onMouseDown={() => setActiveModal("door")}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-lg font-semibold">
                {editingDoorId ? "Editar equipo" : "Nuevo equipo"}
              </div>
              <button
                type="button"
                className="text-sm text-slate-600 hover:underline"
                onClick={() => setShowDoorModal(false)}
              >
                Cerrar
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Organización</label>
                <input
                  className="border rounded px-2 py-1 w-full"
                  placeholder="Buscar organización (nombre o RUC)"
                  list="service-orgs"
                  value={orgSearch}
                  onChange={(e) => {
                    const val = e.target.value;
                    setOrgSearch(val);
                    const match = orgOptions.find((o) => {
                      const label = `${o.name}${o.ruc ? ` - ${o.ruc}` : ""}`;
                      return label === val;
                    });
                    setDoorForm({
                      ...doorForm,
                      org_id: match ? String(match.id) : "",
                      org_branch_id: "",
                    });
                  }}
                />
                <datalist id="service-orgs">
                  {filteredOrgs.map((o) => (
                    <option key={o.id} value={`${o.name}${o.ruc ? ` - ${o.ruc}` : ""}`} />
                  ))}
                </datalist>
              </div>
              <input
                className="border rounded px-2 py-1"
                placeholder="Placa ID"
                value={doorForm.placa_id}
                onChange={(e) => setDoorForm({ ...doorForm, placa_id: e.target.value })}
              />
              <input
                className="border rounded px-2 py-1"
                placeholder="Reff Int"
                value={doorForm.ref_int}
                onChange={(e) => setDoorForm({ ...doorForm, ref_int: e.target.value })}
              />
              <input
                className="border rounded px-2 py-1"
                placeholder="Nro. Serie"
                value={doorForm.nro_serie}
                onChange={(e) => setDoorForm({ ...doorForm, nro_serie: e.target.value })}
              />
              <input
                className="border rounded px-2 py-1"
                placeholder="Nombre"
                value={doorForm.nombre}
                onChange={(e) => setDoorForm({ ...doorForm, nombre: e.target.value })}
              />
              <input
                className="border rounded px-2 py-1"
                placeholder="Sector"
                value={doorForm.sector}
                onChange={(e) => setDoorForm({ ...doorForm, sector: e.target.value })}
              />
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Sucursal</label>
                <select
                  className="border rounded px-2 py-1 w-full"
                  value={doorForm.org_branch_id || ""}
                  onChange={(e) => setDoorForm({ ...doorForm, org_branch_id: e.target.value })}
                >
                  <option value="">
                    {doorBranchLoading ? "Cargando sucursales..." : "Sin sucursales"}
                  </option>
                  {(doorBranches || []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name || b.address || `Sucursal ${b.id}`}
                    </option>
                  ))}
                </select>
              </div>
              <select
                className="border rounded px-2 py-1"
                value={doorForm.marca}
                onChange={(e) => setDoorForm({ ...doorForm, marca: e.target.value })}
              >
                <option value="Rayflex">Rayflex</option>
                <option value="Ferredoor">Ferredoor</option>
              </select>
              <select
                className="border rounded px-2 py-1"
                value={doorForm.modelo}
                onChange={(e) => {
                  const model = e.target.value;
                  setDoorForm({ ...doorForm, modelo: model });
                  applyModelComponents(model);
                }}
              >
                <option value="">Modelo</option>
                {DOOR_MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="border rounded px-2 py-1"
                  placeholder="Ancho"
                  value={doorForm.ancho}
                  onChange={(e) => setDoorForm({ ...doorForm, ancho: e.target.value })}
                />
                <input
                  className="border rounded px-2 py-1"
                  placeholder="Alto"
                  value={doorForm.alto}
                  onChange={(e) => setDoorForm({ ...doorForm, alto: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Fecha de instalación</label>
                <input
                  type="date"
                  className="border rounded px-2 py-1 w-full"
                  value={doorForm.fecha_instalacion}
                  onChange={(e) => setDoorForm({ ...doorForm, fecha_instalacion: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Fecha último mantenimiento</label>
                <input
                  type="date"
                  className="border rounded px-2 py-1 w-full"
                  value={doorForm.fecha_ultimo_mantenimiento}
                  onChange={(e) =>
                    setDoorForm({ ...doorForm, fecha_ultimo_mantenimiento: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="mt-3">
              <div className="text-sm font-semibold mb-1">Componentes</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-40 overflow-auto border rounded p-2">
                {componentTypes.map((c) => (
                  <label key={c.id} className="text-xs flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={doorForm.component_ids.includes(c.id)}
                      onChange={() =>
                        setDoorForm((prev) => ({
                          ...prev,
                          component_ids: toggleId(prev.component_ids, c.id),
                        }))
                      }
                    />
                    <span>{c.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-3">
              <div className="text-sm font-semibold mb-1">Accionadores</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-32 overflow-auto border rounded p-2">
                {actuatorTypes.map((a) => (
                  <label key={a.id} className="text-xs flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={doorForm.actuator_ids.includes(a.id)}
                      onChange={() =>
                        setDoorForm((prev) => ({
                          ...prev,
                          actuator_ids: toggleId(prev.actuator_ids, a.id),
                        }))
                      }
                    />
                    <span>{a.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button className="btn" onClick={() => setShowDoorModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveDoor}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {showCaseModal && (
        <div className={`fixed inset-0 bg-black/30 flex items-center justify-center ${activeModal === "case" ? "z-[70]" : "z-[60]"}`}>
          <div
            className="bg-white rounded-xl w-full max-w-xl p-4"
            onMouseDown={() => setActiveModal("case")}
          >
            <div className="text-lg font-semibold mb-2">Nuevo servicio</div>
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Organizacion</label>
                <input
                  className="border rounded px-2 py-1 w-full"
                  placeholder="Buscar organizacion (nombre o RUC)"
                  list="service-case-orgs"
                  value={caseForm.org_label || ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    const match = orgOptionsWithDoors.find((o) => {
                      const label = `${o.name}${o.ruc ? ` - ${o.ruc}` : ""}`;
                      return label === val;
                    });
                    setCaseForm({
                      ...caseForm,
                      org_label: val,
                      org_id: match ? String(match.id) : "",
                      door_ids: [],
                    });
                  }}
                />
                <datalist id="service-case-orgs">
                  {orgOptionsWithDoors.map((o) => (
                    <option key={o.id} value={`${o.name}${o.ruc ? ` - ${o.ruc}` : ""}`} />
                  ))}
                </datalist>
              </div>
              <div className="border rounded p-2">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-slate-500">Equipos del cliente</div>
                  <button
                    type="button"
                    className="text-xs text-blue-600 hover:underline"
                    onClick={() => {
                      setEditingDoorId(null);
                      setDoorForm({
                        ...emptyDoor,
                        org_id: caseForm.org_id || "",
                      });
                      setOrgSearch(caseForm.org_label || "");
                      setDoorModalVariant("side");
                      setActiveModal("door");
                      setShowDoorModal(true);
                    }}
                  >
                    + Agregar equipo
                  </button>
                </div>
                <div className="max-h-40 overflow-auto space-y-1">
                  {caseDoors.length === 0 && (
                    <div className="text-xs text-slate-400">No hay equipos para esta organizaciÃ³n</div>
                  )}
                  {caseDoors.map((d) => {
                    const checked = (caseForm.door_ids || []).includes(d.id);
                    return (
                      <label key={d.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = checked
                              ? (caseForm.door_ids || []).filter((id) => id !== d.id)
                              : [...(caseForm.door_ids || []), d.id];
                            setCaseForm({ ...caseForm, door_ids: next });
                          }}
                        />
                        <span className="truncate">
                          {(d.nombre || d.placa_id || `Equipo ${d.id}`)}
                          {d.sector ? ` · ${d.sector}` : ""}
                          {d.modelo ? ` (${d.modelo})` : ""}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {selectedDoors.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs text-slate-500 mb-2">Seleccionadas</div>
                    <div className="flex flex-wrap gap-2">
                      {selectedDoors.map((d) => (
                        <Link
                          key={d.id}
                          to={`/service/doors/${d.id}`}
                          className="px-2 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200"
                        >
                          {(d.nombre || d.placa_id || `Equipo ${d.id}`)}
                          {d.sector ? ` · ${d.sector}` : ""}
                          {d.modelo ? ` (${d.modelo})` : ""}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <select
                className="border rounded px-2 py-1"
                value={caseForm.stage_id}
                onChange={(e) => setCaseForm({ ...caseForm, stage_id: e.target.value })}
              >
                <option value="">Etapa inicial</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <input
                type="date"
                className="border rounded px-2 py-1"
                value={caseForm.scheduled_date}
                onChange={(e) => setCaseForm({ ...caseForm, scheduled_date: e.target.value })}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn" onClick={() => setShowCaseModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={createCase}>Crear</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



