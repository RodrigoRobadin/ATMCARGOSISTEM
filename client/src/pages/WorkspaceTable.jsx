// client/src/pages/WorkspaceTable.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api";
import NewOperationModal from "../components/NewOperationModal";

/* ---------- UI ---------- */
function FunnelIcon({ className = "w-4 h-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M3 5h18l-7 8v6l-4 2v-8L3 5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ---------- helpers ---------- */
const lowerKeys = (obj = {}) =>
  Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [String(k || "").toLowerCase(), v])
  );

const firstOf = (o, ...keys) => {
  const l = lowerKeys(o || {});
  for (const k of keys) {
    const v = l[k];
    if (v !== undefined && v !== null && String(v) !== "") return v;
  }
  return null;
};

/* Limpia posibles tags HTML en valores de DOC (ej: <a href="...">12</a> -> "12") */
function cleanDocLabel(raw) {
  if (!raw) return "";
  return String(raw).replace(/<[^>]*>/g, "").trim();
}

/* --- Solo UI: mapeo de etiqueta visible para el tipo de embarque --- */
const TIPO_LABEL = {
  Air: "AÉREO",
  Ocean: "MARÍTIMO",
  Road: "TERRESTRE",
  Multimodal: "MULTIMODAL",
};

function normalizeFromOpAndCF({ op, cfMap, dealTT }) {
  const tt = String(dealTT || "").toUpperCase();

  // DOC HOUSE según modalidad (crudo)
  const docHouseRaw =
    (tt === "AIR" && firstOf(op?.air, "doc_house", "hawb", "house_awb")) ||
    (tt === "OCEAN" && firstOf(op?.ocean, "hbl", "house_bl")) ||
    (tt === "MULTIMODAL" && firstOf(op?.multimodal, "doc_house")) ||
    (tt === "ROAD" && firstOf(op?.road, "cmr_crt_number")) ||
    firstOf(cfMap, "doc_house", "hbl", "hawb", "house_bl", "house_awb") ||
    null;

  // Lo limpiamos de HTML y aplicamos fallback
  const docHouse = cleanDocLabel(docHouseRaw) || "—";

  // Origen/Destino según modalidad
  let origin =
    (tt === "AIR" &&
      firstOf(op?.air, "origin_airport", "origen", "origin")) ||
    (tt === "OCEAN" &&
      firstOf(op?.ocean, "pol", "port_loading", "origen")) ||
    (tt === "ROAD" && firstOf(op?.road, "origin_city", "origen")) ||
    (tt === "MULTIMODAL" &&
      (() => {
        const legs = Array.isArray(op?.multimodal?.legs)
          ? op.multimodal.legs
          : [];
        return legs.length ? firstOf(legs[0], "origin") : null;
      })()) ||
    firstOf(cfMap, "origen_pto", "origin", "origen") ||
    "—";

  let destination =
    (tt === "AIR" &&
      firstOf(
        op?.air,
        "destination_airport",
        "destino",
        "destination"
      )) ||
    (tt === "OCEAN" &&
      firstOf(op?.ocean, "pod", "port_discharge", "destino")) ||
    (tt === "ROAD" &&
      firstOf(op?.road, "destination_city", "destino")) ||
    (tt === "MULTIMODAL" &&
      (() => {
        const legs = Array.isArray(op?.multimodal?.legs)
          ? op.multimodal.legs
          : [];
        return legs.length
          ? firstOf(legs[legs.length - 1], "destination")
          : null;
      })()) ||
    firstOf(cfMap, "destino_pto", "destination", "destino") ||
    "—";

  // Peso / Volumen (con fallback a CF)
  const peso =
    firstOf(op?.air, "weight_gross_kg") ||
    firstOf(op?.ocean, "weight_kg") ||
    firstOf(op?.road, "weight_kg") ||
    firstOf(op?.multimodal, "weight_kg") ||
    firstOf(cfMap, "peso_bruto", "weight_kg", "peso") ||
    "—";

  const volumen =
    firstOf(op?.air, "volume_m3") ||
    firstOf(op?.ocean, "volume_m3") ||
    firstOf(op?.road, "volume_m3") ||
    firstOf(op?.multimodal, "volume_m3") ||
    firstOf(cfMap, "vol_m3", "volume_m3", "cbm", "m3") ||
    "—";

  // Tipo (interno, NO visible)
  const tipo =
    (tt === "AIR" && "Air") ||
    (tt === "OCEAN" && "Ocean") ||
    (tt === "ROAD" && "Road") ||
    (tt === "MULTIMODAL" && "Multimodal") ||
    "—";

  return { origin, destination, docHouse, peso, volumen, tipo };
}

async function getCFMap(dealId) {
  try {
    const { data } = await api.get(`/deals/${dealId}/custom-fields`);
    const map = {};
    (data || []).forEach((row) => {
      map[String(row.key).toLowerCase()] = row.value;
    });
    return map;
  } catch {
    return {};
  }
}

async function getOp(dealId) {
  try {
    const { data } = await api.get(`/operations/${dealId}`);
    return data || {};
  } catch {
    return {};
  }
}

const mapCF2TT = {
  AEREO: "AIR",
  MARITIMO: "OCEAN",
  TERRESTRE: "ROAD",
  MULTIMODAL: "MULTIMODAL",
};

function resolveDealTT(deal, cfMap) {
  const dealTT = String(deal?.transport_type || "").toUpperCase();
  if (["AIR", "OCEAN", "ROAD", "MULTIMODAL"].includes(dealTT)) return dealTT;
  const cfTTraw = String(
    cfMap?.modalidad_carga || cfMap?.["modalidad_carga"] || ""
  ).toUpperCase();
  return mapCF2TT[cfTTraw] || "AIR";
}

/* ======================================= */
export default function WorkspaceTable() {
  const { key } = useParams();
  const [bu, setBu] = useState(null);
  const [pipelineId, setPipelineId] = useState(null);
  const [stages, setStages] = useState([]);
  const [deals, setDeals] = useState([]);
  const [openModal, setOpenModal] = useState(false);
  const [loading, setLoading] = useState(true);

  // cache de detalles por fila
  const [detailCache, setDetailCache] = useState({}); // { [dealId]: { origin, destination, docHouse, peso, volumen, tipo } }

  // filtros por columna (icono)
  const [colFilter, setColFilter] = useState({
    referencia: "",
    estado: "",
    organizacion: "",
    tipo: "",
    origen: "",
    destino: "",
    docHouse: "",
    peso: "",
    volumen: "",
    ejecutivo: "",
  });
  const [openFilterKey, setOpenFilterKey] = useState(null);

  /* ---------- Carga base ---------- */
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data: units } = await api.get("/business-units");
        const found = (Array.isArray(units) ? units : []).find(
          (u) => u.key_slug === key
        );
        setBu(found || null);

        const { data: p } = await api.get("/pipelines");
        const pid = Array.isArray(p) && p.length ? p[0].id : null;
        setPipelineId(pid);

        if (pid) {
          const [{ data: s }, { data: d }] = await Promise.all([
            api.get(`/pipelines/${pid}/stages`),
            api.get("/deals", {
              params: { pipeline_id: pid, business_unit_id: found?.id },
            }),
          ]);
          setStages(Array.isArray(s) ? s : []);
          setDeals(Array.isArray(d) ? d : []);
        } else {
          setStages([]);
          setDeals([]);
        }
      } catch (e) {
        console.error("Error cargando workspace:", e);
        setStages([]);
        setDeals([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [key]);

  /* ---------- Cargar detalles por deal (usa /operations/:id y CF) ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const missing = (deals || []).filter((d) => !(d.id in detailCache));
      if (!missing.length) return;

      const CONC = 6;
      const q = [...missing];
      const out = {};

      async function worker() {
        while (q.length) {
          const deal = q.shift();
          // Traigo op y CF en paralelo
          const [op, cfMap] = await Promise.all([
            getOp(deal.id),
            getCFMap(deal.id),
          ]);
          const tt = resolveDealTT(deal, cfMap);
          const normalized = normalizeFromOpAndCF({ op, cfMap, dealTT: tt });
          out[deal.id] = normalized;
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(CONC, q.length) }, worker)
      );
      if (!cancelled) setDetailCache((prev) => ({ ...prev, ...out }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deals]);

  /* ---------- Derivar filas ---------- */
  const rows = useMemo(() => {
    return (deals || []).map((d) => {
      const etapa =
        stages.find((s) => s.id === d.stage_id)?.name || "—"; // Estado = etapa de pipeline

      const ejecutivo =
        d.deal_advisor_name ||    // si el backend lo manda así
        d.advisor_user_name ||    // otro nombre típico
        d.advisor_name ||         // fallback
        d.org_advisor_name ||     // último recurso
        "—";

      const det = detailCache[d.id] || {};

      const tipoRaw = det.tipo || "—";
      const tipoLabel = TIPO_LABEL[tipoRaw] || tipoRaw; // 👈 SOLO UI

      return {
        id: d.id,
        referencia: d.reference ?? d.title ?? "—",
        estado: etapa,
        organizacion: d.org_name || "—",
        tipoRaw, // interno (por si lo necesitás)
        tipoLabel, // visible / filtro
        origen: det.origin || "—",
        destino: det.destination || "—",
        docHouse: det.docHouse || "—",
        peso: det.peso || "—",
        volumen: det.volumen || "—",
        ejecutivo,
      };
    });
  }, [deals, stages, detailCache]);

  /* ---------- Aplicar filtros por columna ---------- */
  const filteredRows = useMemo(() => {
    const like = (a, b) =>
      !b ||
      String(a ?? "")
        .toLowerCase()
        .includes(String(b).toLowerCase());
    return rows.filter(
      (r) =>
        like(r.referencia, colFilter.referencia) &&
        like(r.estado, colFilter.estado) &&
        like(r.organizacion, colFilter.organizacion) &&
        like(r.tipoLabel, colFilter.tipo) && // 👈 filtra por lo que se ve
        like(r.origen, colFilter.origen) &&
        like(r.destino, colFilter.destino) &&
        like(r.docHouse, colFilter.docHouse) &&
        like(r.peso, colFilter.peso) &&
        like(r.volumen, colFilter.volumen) &&
        like(r.ejecutivo, colFilter.ejecutivo)
    );
  }, [rows, colFilter]);

  if (loading)
    return <div className="text-sm text-slate-600">Cargando…</div>;
  if (!bu)
    return (
      <div className="text-sm text-slate-600">Workspace no encontrado.</div>
    );

  const COLUMNS = [
    { key: "referencia", label: "Referencia" },
    { key: "estado", label: "Estado" }, // etapa del pipeline
    { key: "organizacion", label: "Organización" },
    { key: "tipo", label: "Tipo de embarque" },
    { key: "origen", label: "Origen" },
    { key: "destino", label: "Destino" },
    { key: "docHouse", label: "DOC HOUSE" },
    { key: "peso", label: "Peso Bruto" },
    { key: "volumen", label: "Volumen" },
    { key: "ejecutivo", label: "Ejecutivo de cuenta" },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold">
            Workspace: {bu.name} (tabla)
          </h2>
          <p className="text-xs text-slate-500">
            Pipeline: {pipelineId ?? "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/workspace/${key}`}
            className="px-3 py-2 text-sm rounded-lg border hover:bg-slate-50"
          >
            Volver a Kanban
          </Link>
          <button
            onClick={() => setOpenModal(true)}
            className="px-3 py-2 text-sm rounded-lg bg-black text-white"
          >
            ➕ Nueva operación
          </button>
        </div>
      </div>

      {/* Tabla con filtros por columna */}
      <div className="overflow-x-auto bg-white shadow rounded-xl">
        <table className="min-w-full border-collapse">
          <thead className="bg-slate-100 text-sm text-left">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-4 py-2 border-b relative">
                  <div className="flex items-center gap-2">
                    <span>{c.label}</span>
                    <button
                      className={`ml-1 p-1 rounded hover:bg-slate-200 ${
                        colFilter[c.key]
                          ? "text-blue-600"
                          : "text-slate-500"
                      }`}
                      onClick={() =>
                        setOpenFilterKey(
                          openFilterKey === c.key ? null : c.key
                        )
                      }
                      title={`Filtrar ${c.label}`}
                    >
                      <FunnelIcon />
                    </button>
                  </div>

                  {openFilterKey === c.key && (
                    <div className="absolute z-20 mt-2 right-2 top-full w-64 bg-white border rounded-lg shadow p-3">
                      <div className="text-xs text-slate-600 mb-2">
                        Filtrar {c.label}
                      </div>
                      <input
                        autoFocus
                        value={colFilter[c.key]}
                        onChange={(e) =>
                          setColFilter((p) => ({
                            ...p,
                            [c.key]: e.target.value,
                          }))
                        }
                        placeholder="Contiene…"
                        className="w-full text-sm border rounded-md px-2 py-1 mb-3"
                        onKeyDown={(e) =>
                          e.key === "Enter" && setOpenFilterKey(null)
                        }
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          className="px-2 py-1 text-sm rounded border"
                          onClick={() => {
                            setColFilter((p) => ({
                              ...p,
                              [c.key]: "",
                            }));
                            setOpenFilterKey(null);
                          }}
                        >
                          Limpiar
                        </button>
                        <button
                          className="px-2 py-1 text-sm rounded bg-black text-white"
                          onClick={() => setOpenFilterKey(null)}
                        >
                          Aplicar
                        </button>
                      </div>
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="text-sm">
            {filteredRows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 border-b">
                  <a
                    href={`/operations/${r.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {r.referencia}
                  </a>
                </td>
                <td className="px-4 py-2 border-b">{r.estado}</td>
                <td className="px-4 py-2 border-b">{r.organizacion}</td>
                <td className="px-4 py-2 border-b">{r.tipoLabel}</td>
                <td className="px-4 py-2 border-b">{r.origen}</td>
                <td className="px-4 py-2 border-b">{r.destino}</td>
                <td className="px-4 py-2 border-b">{r.docHouse}</td>
                <td className="px-4 py-2 border-b">{r.peso}</td>
                <td className="px-4 py-2 border-b">{r.volumen}</td>
                <td className="px-4 py-2 border-b">{r.ejecutivo}</td>
              </tr>
            ))}
            {!filteredRows.length && (
              <tr>
                <td
                  colSpan={COLUMNS.length}
                  className="px-4 py-6 text-center text-slate-500"
                >
                  No hay operaciones que coincidan con los filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {openModal && (
        <NewOperationModal
          onClose={() => setOpenModal(false)}
          pipelineId={pipelineId}
          stages={stages}
          defaultBusinessUnitId={bu.id}
          onCreated={async () => {
            try {
              const { data: d } = await api.get("/deals", {
                params: {
                  pipeline_id: pipelineId,
                  business_unit_id: bu.id,
                },
              });
              setDeals(Array.isArray(d) ? d : []);
            } catch {}
            setOpenModal(false);
          }}
        />
      )}
    </div>
  );
}