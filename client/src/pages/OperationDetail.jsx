// client/src/pages/OperationDetail.jsx
import React, { useEffect, useMemo, useState, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import DetCosSheet from "./DetCosSheet";
import ReportPreview from "../components/op-details/ReportPreview";

// 👇 Ajustá la ruta real según tu backend
const PROVIDERS_ENDPOINT = "/organizations";


/* ---------- helpers ---------- */
// nombre visible actual de un file (fallback si no hay rótulo)
function visibleNameOf(f) {
  return f.display_name || f.custom_name || f.filename || "archivo";
}

/* === cálculo m³ desde dimensiones (SOLO en metros) === */
function parseDimensionsToM3(raw) {
  if (!raw) return null;
  const txt = String(raw).toLowerCase().replace(/[×*]/g, "x");
  const parts = txt
    .split(/[\n;,+]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  let totalM3 = 0;
  const toNum = (s) => Number(String(s).replace(",", "."));
  for (const seg of parts) {
    const m = seg.match(
      /(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)(?:\s*x\s*(\d+(?:[.,]\d+)?))?/i
    );
    if (!m) continue;
    let L = toNum(m[1]),
      W = toNum(m[2]),
      H = toNum(m[3]),
      qty = m[4] ? toNum(m[4]) : 1;
    if (!L || !W || !H || !qty) continue;
    const vol = L * W * H * qty;
    if (!isNaN(vol)) totalM3 += vol;
  }
  return totalM3 > 0 ? totalM3 : null;
}
const AIR_CHARGE_FACTOR = 167;

/* === Profit desde cost-sheet (robusto a nombres de campos) === */
function computeProfitFromCostSheet(cs) {
  if (!cs) return null;
  const d = cs?.data || cs;
  const h = d?.header || {};
  const toNum = (v) => {
    if (v === "" || v === null || v === undefined) return 0;
    const s = String(v).replace(/\./g, "").replace(",", ".");
    const n = Number(s);
    return isNaN(n) ? 0 : n;
  };
  for (const k of [
    "profitUsd",
    "profit_usd",
    "profit",
    "margen_usd",
    "margen",
    "margin_usd",
  ]) {
    if (h[k] !== undefined && h[k] !== null && String(h[k]).trim() !== "") {
      const v = toNum(h[k]);
      if (isFinite(v)) return Number(v.toFixed(2));
    }
  }
  const pesoKg = toNum(h.pesoKg || h.weightKg || h.peso_kg || h.peso);
  const gsRate = toNum(h.gsRate || h.tc_gs || h.tcGsUsd || h.tipo_cambio_gs);
  const sumVentaRows = (rows = []) =>
    rows.reduce((acc, r) => {
      const total = toNum(r.total || r.totalUsd);
      const perKg = toNum(r.usdXKg || r.usd_per_kg);
      const byKg = perKg && pesoKg ? perKg * pesoKg : 0;
      const val = total && !r?.lockPerKg ? total : byKg;
      return acc + val;
    }, 0);
  const sumGsRows = (rows = []) =>
    rows.reduce((acc, r) => {
      const gs = toNum(r.gs || r.totalGs);
      return acc + (gsRate ? gs / gsRate : 0);
    }, 0);
  const sumUsdRows = (rows = []) =>
    rows.reduce((acc, r) => acc + toNum(r.usd || r.total), 0);

  const ventaUSD = sumVentaRows(d?.ventaRows || []);
  const locCliUSD = sumGsRows(d?.locCliRows || []);
  const segVentaUS = sumUsdRows(d?.segVentaRows || []);
  const compraUSD = sumVentaRows(d?.compraRows || d?.costoRows || []);
  const locProvUSD = sumGsRows(d?.locProvRows || d?.locProvRowsGs || []);
  const segCostoUSD = sumUsdRows(d?.segCostoRows || []);

  const totalVenta = ventaUSD + locCliUSD + segVentaUS;
  const totalCosto = compraUSD + locProvUSD + segCostoUSD;
  const profit = totalVenta - totalCosto;
  return isFinite(profit) ? Number(profit.toFixed(2)) : null;
}

/* --- resuelve URLs de /uploads al origen del backend (sin /api) */
function resolveUploadUrl(urlPath = "") {
  if (/^https?:\/\//i.test(urlPath)) return urlPath;
  const base = api?.defaults?.baseURL || "";
  try {
    const u = new URL(base);
    return `${u.protocol}//${u.host}${urlPath}`;
  } catch {
    return urlPath;
  }
}

/* Helpers de rótulos (nombres visibles elegidos por el usuario) */
function labelOfFile(f, labels) {
  return (labels && labels[f.id]) || visibleNameOf(f);
}
function joinLabelsForDetail(list, fileLabels) {
  if (!Array.isArray(list)) return "";

  const parts = list.map((f) => {
    const label = fileLabels[f.id] || f.filename || "";
    const fileUrl = `/uploads/${f.filename}`; // ✅ Enlace directo al archivo

    // Retornamos HTML con link
    return `<a href="${fileUrl}" target="_blank" style="color:#2563eb;text-decoration:none;">${label}</a>`;
  });

  return parts.filter(Boolean).join(", ");
}

/* ---------- UI helpers ---------- */
function Field({ label, right, children }) {
  return (
    <label className="grid grid-cols-[160px_1fr_auto] gap-2 items-center">
      <span className="text-xs text-slate-600">{label}</span>
      <div>{children}</div>
      {right ? <div className="text-xs">{right}</div> : <div />}
    </label>
  );
}
const Input = ({ readOnly, ...props }) => (
  <input
    className={`border rounded-lg px-2 py-1 text-sm w-full focus:outline-none ${
      readOnly
        ? "bg-slate-50 cursor-not-allowed"
        : "focus:ring-2 focus:ring-black/10"
    }`}
    readOnly={readOnly}
    {...props}
  />
);
const Select = ({ readOnly, children, ...props }) => (
  <select
    disabled={!!readOnly}
    className={`border rounded-lg px-2 py-1 text-sm w-full bg-white focus:outline-none ${
      readOnly
        ? "bg-slate-50 cursor-not-allowed"
        : "focus:ring-2 focus:ring-black/10"
    }`}
    {...props}
  >
    {children}
  </select>
);

/* ---------- documentos requeridos ---------- */
const FILE_TYPES = [
  { key: "doc_house", label: "DOC HOUSE" },
  { key: "doc_master", label: "DOC MASTER" },
  { key: "factura", label: "FACTURA" },
  { key: "packing_list", label: "PACKING LIST" },
  { key: "certificado_origen", label: "CERTIFICADO DE ORIGEN - C.O" },
  { key: "certificado_seguro", label: "CERTIFICADO DE SEGURO/POLIZA" },
  { key: "note_attachment", label: "ADJUNTO (NOTAS / OTROS)" },
];
const toLocal = (v) => (v ? String(v).replace("Z", "").slice(0, 16) : "");

/* ---- util ---- */
function getExt(name = "") {
  const m = String(name).toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/);
  return m ? m[1] : "";
}
function isImg(ext) {
  return ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext);
}
function isPdf(ext) {
  return ext === "pdf";
}
function truncate(s = "", n = 26) {
  return String(s).length > n ? String(s).slice(0, n - 1) + "…" : s;
}
function flattenFiles(filesByType) {
  const arr = [];
  Object.values(filesByType || {}).forEach((list) =>
    (list || []).forEach((f) => arr.push(f))
  );
  arr.sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );
  return arr;
}
// Label de documento según tipo y modalidad
const docLabelFor = (type, mode) => {
  const base =
    FILE_TYPES.find((t) => t.key === type)?.label || "Documento";

  // DOC MASTER
  if (type === "doc_master") {
    if (mode === "AIR") return "DOC MASTER";       // Aéreo
    if (mode === "OCEAN") return "MBL";            // Marítimo
    if (mode === "ROAD") return "MIC/DTA";         // Terrestre
    if (mode === "MULTIMODAL") return "DOC MASTER";
  }

  // DOC HOUSE
  if (type === "doc_house") {
    if (mode === "AIR") return "DOC HOUSE";        // Aéreo
    if (mode === "OCEAN") return "HBL";            // Marítimo
    if (mode === "ROAD") return "CRT";             // Terrestre
    if (mode === "MULTIMODAL") return "DOC HOUSE";
  }

  return base;
};

/* ======== Visor de archivos (pestañas) ======== */
function FileTabViewer({ context }) {
  if (!context) return null;
  if (context.uploading) {
    return (
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="text-sm mb-2">
          <b>{context.docLabel}</b> — {context.name}
        </div>
        <div className="w-full bg-slate-200 h-2 rounded">
          <div
            className="h-2 rounded bg-black transition-all"
            style={{ width: `${context.progress}%` }}
          />
        </div>
        <div className="text-xs mt-1 text-slate-600">
          {context.progress}%
        </div>
      </div>
    );
  }
  const f = context.file;
  const ext = getExt(f.filename);
  const src = resolveUploadUrl(f.url);
  return (
    <div className="bg-white rounded-2xl shadow p-4">
      <div className="text-sm mb-3">
        <b>{context.docLabel}</b> — {f.filename}
      </div>
      {isPdf(ext) ? (
        <div className="h-[70vh]">
          <iframe
            src={src}
            title={f.filename}
            className="w-full h-full border rounded"
          />
        </div>
      ) : isImg(ext) ? (
        <div className="flex flex-col items-start">
          <img
            src={src}
            alt={f.filename}
            className="max-h-[70vh] rounded border"
          />
        </div>
      ) : (
        <div className="text-sm">
          No se puede previsualizar este tipo de archivo aquí.{" "}
          <a
            className="underline"
            href={src}
            target="_blank"
            rel="noreferrer"
          >
            Abrir / Descargar
          </a>
        </div>
      )}
      <div className="mt-2 text-sm">
        <a
          className="underline"
          href={src}
          target="_blank"
          rel="noreferrer"
        >
          Abrir en pestaña nueva
        </a>
      </div>
    </div>
  );
}

/* ---- helpers para links superpuestos en campos de detalle ---- */
function getFileNiceName(f) {
  return visibleNameOf(f);
}
function DocLinksOverlay({ files = [], className = "", labels = {} }) {
  if (!files.length) return null;
  return (
    <div
      className={
        "absolute inset-0 flex items-center px-2 text-sm overflow-hidden whitespace-nowrap text-ellipsis " +
        "text-blue-600/90 hover:text-blue-700 " +
        className
      }
      style={{ pointerEvents: "auto" }}
      title={files.map((f) => labelOfFile(f, labels)).join(", ")}
    >
      {files.map((f, i) => {
        const href = resolveUploadUrl(f.url);
        const name = labelOfFile(f, labels);
        return (
          <React.Fragment key={f.id || i}>
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="underline"
              onClick={(e) => {
                e.stopPropagation();
              }}
              title={getFileNiceName(f)}
            >
              {name}
            </a>
            {i < files.length - 1 ? <span>,&nbsp;</span> : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* Map de claves de documento (tipo) -> clave de campo en detalle (CF / form) */
/* Map de claves de documento (tipo) -> clave de campo en detalle (CF / form) */

// AÉREO
const DOC_FIELD_MAP_AIR = {
  doc_master: "doc_master",
  doc_house: "doc_house",
  factura: "factura",
  packing_list: "packing_list",
  certificado_origen: "certificado_origen",
};

// MARÍTIMO
// doc_master -> MBL
// doc_house  -> HBL
const DOC_FIELD_MAP_OCEAN = {
  doc_master: "mbl",
  doc_house: "hbl",
};

// TERRESTRE
// doc_master -> MIC/DTA
// doc_house  -> CRT
const DOC_FIELD_MAP_ROAD = {
  doc_master: "micdta_number",   // MIC/DTA
  doc_house: "cmr_crt_number",   // CRT
};

// MULTIMODAL
// doc_master -> DOC MASTER
// doc_house  -> DOC HOUSE
const DOC_FIELD_MAP_MULTI = {
  doc_master: "doc_master",
  doc_house: "doc_house",
};

// Limpia HTML viejo de los rótulos (ej: <a href="...">MBL 123</a> => "MBL 123")
function cleanDocLabel(raw) {
  if (!raw) return "";
  return String(raw).replace(/<[^>]*>/g, "").trim();
}

/* ---------- DocTextLink (detalle Aéreo) con rótulos y links ---------- */
function DocTextLink({
  label,
  cfKey,
  editMode,
  getCF,
  setCFLocal,
  markDirty,
  filesByType,
  openFileTabByType,
  fileLabels,
}) {
  const list = filesByType?.[cfKey] || [];

  // Valor crudo del CF (puede venir con <a href="...">...</a>)
  const rawValue = getCF(cfKey) || "";
  // Lo limpiamos para mostrar solo el texto
  const value = cleanDocLabel(rawValue);   // 👈 AQUÍ EL CAMBIO

  return (
    <Field label={label}>
      {editMode ? (
        <Input
          value={value}
          onChange={(e) => {
            setCFLocal(cfKey, {
              label,
              type: "text",
              value: e.target.value,   // guardamos solo el texto limpio
            });
            markDirty(cfKey);
          }}
          placeholder={`Ingresá el nombre mostrado para ${label}`}
        />
      ) : (
        <div className="relative">
          <Input readOnly value={value || ""} />
          {list.length > 0 && (
            <DocLinksOverlay files={list} labels={fileLabels} />
          )}
        </div>
      )}
    </Field>
  );
}

/* =================== PÁGINA =================== */
export default function OperationDetail() {
  const { id } = useParams();

  const [loading, setLoading] = useState(true);
  const [deal, setDeal] = useState(null);

  const [notesList, setNotesList] = useState([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [desc, setDesc] = useState("");

  const [cf, setCf] = useState({});
  const [cfSupported, setCfSupported] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [dirtyCF, setDirtyCF] = useState(new Set());
  const [note, setNote] = useState("");

  const [profitUSD, setProfitUSD] = useState(null);

  const [filesByType, setFilesByType] = useState({});
  const fileInputsRef = useRef({});
  const noteAttachInputRef = useRef(null); // 👈 input para adjuntos de la nota

  const [activeTab, setActiveTab] = useState("detalle");
  const [filesRefreshKey, setFilesRefreshKey] = useState(0);
  const [uploadingFiles, setUploadingFiles] = useState([]);

  // NUEVO: adjuntos por nota (ya guardados) y adjuntos de la nota en edición
  const [noteAttachmentsMap, setNoteAttachmentsMap] = useState({}); // { [activityId]: [fileId, ...] }
  const [notePendingFiles, setNotePendingFiles] = useState([]); // archivos subidos para la nota que todavía no se guardó

  // NUEVO: mapa de rótulos por fileId
  const [fileLabels, setFileLabels] = useState({}); // { [fileId]: "Rótulo" }

  const [paramMap, setParamMap] = useState({
    tipo_operacion: [],
    modalidad_carga: [],
    tipo_carga: [],
    incoterm: [],
  });

  const [air, setAir] = useState({});
  const [ocean, setOcean] = useState({});
  const [road, setRoad] = useState({});
  const [multi, setMulti] = useState({});
  const setAirF = (k, v) => setAir((s) => ({ ...s, [k]: v }));
  const setOceanF = (k, v) => setOcean((s) => ({ ...s, [k]: v }));
  const setRoadF = (k, v) => setRoad((s) => ({ ...s, [k]: v }));
  const setMultiF = (k, v) => setMulti((s) => ({ ...s, [k]: v }));

  const [generatingReport, setGeneratingReport] = useState(false);

  // ====== CORREO / VISTA PREVIA ======
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailMode, setEmailMode] = useState("general"); // "general" | "flete"
  const [emailTo, setEmailTo] = useState("");
  const [emailCc, setEmailCc] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [providers, setProviders] = useState([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [selectedProviderIds, setSelectedProviderIds] = useState([]);
    // ====== VISTA PREVIA DE INFORME ======
  const [showReportPreview, setShowReportPreview] = useState(false);





  async function loadFiles() {
    try {
      const { data } = await api
        .get(`/deals/${id}/files`)
        .catch(() => ({ data: [] }));
      const map = {};
      (data || []).forEach((f) => {
        if (!map[f.type]) map[f.type] = [];
        map[f.type].push(f);
      });
      Object.keys(map).forEach((k) =>
        map[k].sort(
          (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
        )
      );
      setFilesByType(map);
      setFilesRefreshKey((k) => k + 1);

      // Completar rótulos faltantes con fallback visibleNameOf
      setFileLabels((prev) => {
        const next = { ...prev };
        Object.values(map).forEach((list) =>
          (list || []).forEach((f) => {
            if (!next[f.id]) next[f.id] = visibleNameOf(f);
          })
        );
        return next;
      });
    } catch {
      setFilesByType({});
    }
  }

  // Sincroniza campos del Aéreo con los rótulos actuales
  // Sincroniza campos de TODAS las modalidades con los rótulos actuales
useEffect(() => {
  // --- AIR ---
  const nextAir = { ...air };
  let changedAir = false;
  Object.entries(DOC_FIELD_MAP_AIR).forEach(([typeKey, fieldKey]) => {
    const list = filesByType?.[typeKey] || [];
    const joined = joinLabelsForDetail(list, fileLabels);
    if (joined && nextAir[fieldKey] !== joined) {
      nextAir[fieldKey] = joined;
      changedAir = true;
    }
  });
  if (changedAir) setAir(nextAir);

  // --- OCEAN ---
  const nextOcean = { ...ocean };
  let changedOcean = false;
  Object.entries(DOC_FIELD_MAP_OCEAN).forEach(([typeKey, fieldKey]) => {
    const list = filesByType?.[typeKey] || [];
    const joined = joinLabelsForDetail(list, fileLabels);
    if (joined && nextOcean[fieldKey] !== joined) {
      nextOcean[fieldKey] = joined;
      changedOcean = true;
    }
  });
  if (changedOcean) setOcean(nextOcean);

  // --- ROAD ---
  const nextRoad = { ...road };
  let changedRoad = false;
  Object.entries(DOC_FIELD_MAP_ROAD).forEach(([typeKey, fieldKey]) => {
    const list = filesByType?.[typeKey] || [];
    const joined = joinLabelsForDetail(list, fileLabels);
    if (joined && nextRoad[fieldKey] !== joined) {
      nextRoad[fieldKey] = joined;
      changedRoad = true;
    }
  });
  if (changedRoad) setRoad(nextRoad);

  // --- MULTIMODAL ---
  const nextMulti = { ...multi };
  let changedMulti = false;
  Object.entries(DOC_FIELD_MAP_MULTI).forEach(([typeKey, fieldKey]) => {
    const list = filesByType?.[typeKey] || [];
    const joined = joinLabelsForDetail(list, fileLabels);
    if (joined && nextMulti[fieldKey] !== joined) {
      nextMulti[fieldKey] = joined;
      changedMulti = true;
    }
  });
  if (changedMulti) setMulti(nextMulti);

  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [filesByType, fileLabels]);
  async function loadParams() {
    try {
      const { data } = await api.get("/params", {
        params: { keys: "tipo_operacion,modalidad_carga,tipo_carga,incoterm" },
      });
      const norm = (arr) =>
        (Array.isArray(arr) ? arr : [])
          .filter((r) => r.active !== 0)
          .sort((a, b) => (a.ord || 0) - (b.ord || 0));
      setParamMap({
        tipo_operacion: norm(data?.tipo_operacion),
        modalidad_carga: norm(data?.modalidad_carga),
        tipo_carga: norm(data?.tipo_carga),
        incoterm: norm(data?.incoterm),
      });
    } catch {
      setParamMap({
        tipo_operacion: [],
        modalidad_carga: [],
        tipo_carga: [],
        incoterm: [],
      });
    }
  }

  async function loadNotes() {
    setNotesLoading(true);
    try {
      const { data } = await api.get("/activities", {
        params: {
          deal_id: Number(id),
          type: "note",
          sort: "created_at",
          order: "desc",
        },
      });
      setNotesList(Array.isArray(data) ? data : []);
    } catch {
      setNotesList([]);
    } finally {
      setNotesLoading(false);
    }
  }

  async function reload() {
    setLoading(true);
    try {
      const [{ data: detail }, cfRes, opRes] = await Promise.all([
        api.get(`/deals/${id}`),
        api.get(`/deals/${id}/custom-fields`).catch(() => ({ data: null })),
        api.get(`/operations/${id}`).catch(() => ({ data: null })),
      ]);

      const op = opRes?.data || {};

      setDeal(detail.deal);
      setDesc(detail.deal?.title || "");

      let cfMapLocal = {};
      if (Array.isArray(cfRes?.data)) {
        cfRes.data.forEach((row) => {
          cfMapLocal[row.key] = {
            id: row.id,
            label: row.label,
            type: row.type,
            value: row.value ?? "",
          };
        });
        setCf(cfMapLocal);
        setCfSupported(true);
      } else {
        setCf({});
        setCfSupported(false);
      }

      const cfVal = (k) =>
        Object.prototype.hasOwnProperty.call(cfMapLocal, k)
          ? cfMapLocal[k].value
          : "";

      // Cargar rótulos desde CF JSON
      try {
        const parsed = JSON.parse(cfVal("file_labels_json") || "{}");
        if (parsed && typeof parsed === "object") setFileLabels(parsed);
      } catch {
        setFileLabels({});
      }

            // NUEVO: mapa de adjuntos por nota (activity_id -> [fileId,...])
      try {
        const parsedNA = JSON.parse(cfVal("note_attachments_json") || "{}");
        if (parsedNA && typeof parsedNA === "object") {
          setNoteAttachmentsMap(parsedNA);
        } else {
          setNoteAttachmentsMap({});
        }
      } catch {
        setNoteAttachmentsMap({});
      }


      const opRoad = op.road || {};
      let roadSnap = {};
      try {
        const rawRoad = cfVal("op_road_json");
        if (rawRoad) roadSnap = JSON.parse(rawRoad);
      } catch {
        roadSnap = {};
      }

      const getRoadField = (key, cfKey) =>
        opRoad[key] ??
        roadSnap[key] ??
        (cfKey ? cfVal(cfKey) : "");
      
      

      setAir({
        doc_master: op.air?.doc_master ?? cfVal("doc_master") ?? "",
        doc_house: op.air?.doc_house ?? cfVal("doc_house") ?? "",
        airline: op.air?.airline ?? cfVal("linea_aerea") ?? "",
        // nuevos (sincronizados con CF)
        factura: op.air?.factura ?? cfVal("factura") ?? "",
        packing_list: op.air?.packing_list ?? cfVal("packing_list") ?? "",
        certificado_origen:
          op.air?.certificado_origen ?? cfVal("certificado_origen") ?? "",
        shpr_cnee: op.air?.shpr_cnee ?? cfVal("shpr_cnee") ?? "",
        agent: op.air?.agent ?? cfVal("agente") ?? "",
        customs_broker:
          op.air?.customs_broker ?? cfVal("ag_aduanera") ?? "",
        provider: op.air?.provider ?? cfVal("proveedor") ?? "",
        origin_airport: op.air?.origin_airport ?? cfVal("origen_pto") ?? "",
        transshipment_airport:
          op.air?.transshipment_airport ?? cfVal("transb_pto") ?? "",
        destination_airport:
          op.air?.destination_airport ?? cfVal("destino_pto") ?? "",
        commodity: op.air?.commodity ?? cfVal("mercaderia") ?? "",
        packages: op.air?.packages ?? cfVal("cant_bultos") ?? "",
        weight_gross_kg:
          op.air?.weight_gross_kg ?? cfVal("peso_bruto") ?? "",
        volume_m3: op.air?.volume_m3 ?? cfVal("vol_m3") ?? "",
        weight_chargeable_kg:
          op.air?.weight_chargeable_kg ?? cfVal("p_vol") ?? "",
        dimensions_text:
          op.air?.dimensions_text ?? cfVal("dimensiones") ?? "",
        etd: op.air?.etd ?? cfVal("f_est_salida") ?? "",
        trans_arrival:
          op.air?.trans_arrival ?? cfVal("llegada_transb") ?? "",
        trans_depart: op.air?.trans_depart ?? cfVal("salida_transb") ?? "",
        eta: op.air?.eta ?? cfVal("llegada_destino") ?? "",
        transit_days: op.air?.transit_days ?? cfVal("dias_transito") ?? "",
        observations: op.air?.observations ?? cfVal("observaciones") ?? "",
        doc_master_term:
          op.air?.doc_master_term ?? cfVal("doc_master_term") ?? "PREPAID",
        doc_house_term:
          op.air?.doc_house_term ?? cfVal("doc_house_term") ?? "COLLECT",
        flete_pago: op.air?.flete_pago ?? cfVal("flete_pago") ?? "CONTADO",
        gastos_locales_pago:
          op.air?.gastos_locales_pago ??
          cfVal("gastos_locales_pago") ??
          "CREDITO",
      });

      setOcean({
        mbl: op.ocean?.mbl ?? cfVal("doc_master") ?? "",
        hbl: op.ocean?.hbl ?? cfVal("doc_house") ?? "",
        shipping_line:
          op.ocean?.shipping_line ?? cfVal("linea_marit") ?? "",
        load_type: op.ocean?.load_type ?? cfVal("tipo_carga") ?? "LCL",
        pol: op.ocean?.pol ?? cfVal("origen_pto") ?? "",
        transshipment_port:
          op.ocean?.transshipment_port ?? cfVal("transb_pto") ?? "",
        pod: op.ocean?.pod ?? cfVal("destino_pto") ?? "",
        commodity: op.ocean?.commodity ?? cfVal("mercaderia") ?? "",
        packages: op.ocean?.packages ?? cfVal("cant_bultos") ?? "",
        weight_kg: op.ocean?.weight_kg ?? cfVal("peso_bruto") ?? "",
        volume_m3: op.ocean?.volume_m3 ?? cfVal("vol_m3") ?? "",
        chargeable_kg:
          op.ocean?.chargeable_kg ?? cfVal("p_vol") ?? "",
        transit_time_days:
          op.ocean?.transit_time_days ?? cfVal("tiempo_trans") ?? "",
        free_days: op.ocean?.free_days ?? cfVal("dias_libre") ?? "",
        itinerary: op.ocean?.itinerary ?? cfVal("itinerario") ?? "",
        doc_nav_delivery:
          op.ocean?.doc_nav_delivery ?? cfVal("f_ent_doc_nav") ?? "",
        doc_client_delivery:
          op.ocean?.doc_client_delivery ??
          cfVal("f_ent_doc_cliente") ??
          "",
        free_start:
          op.ocean?.free_start ?? cfVal("inicio_dias_libre") ?? "",
        free_end: op.ocean?.free_end ?? cfVal("fin_dias_libre") ?? "",
        observations:
          op.ocean?.observations ?? cfVal("observaciones") ?? "",
        etd: op.ocean?.etd ?? cfVal("f_est_salida") ?? "",
        trans_arrival:
          op.ocean?.trans_arrival ?? cfVal("llegada_transb") ?? "",
        trans_depart:
          op.ocean?.trans_depart ?? cfVal("salida_transb") ?? "",
        eta: op.ocean?.eta ?? cfVal("llegada_destino") ?? "",
        containers_json: Array.isArray(op.ocean?.containers_json)
          ? op.ocean.containers_json
          : [],
        // NUEVO: términos doc
        doc_master_term:
          op.ocean?.doc_master_term ?? cfVal("doc_master_term") ?? "",
        doc_house_term:
          op.ocean?.doc_house_term ?? cfVal("doc_house_term") ?? "",
      });

      setRoad({
        cmr_crt_number: getRoadField("cmr_crt_number", "crt"),
        micdta_number: getRoadField("micdta_number"),
        provider_org_id: getRoadField("provider_org_id", "prov_id"),
        truck_plate: getRoadField("truck_plate", "placa_camion"),
        trailer_plate: getRoadField("trailer_plate", "placa_remolque"),
        driver_name: getRoadField("driver_name", "chofer"),
        driver_phone: getRoadField("driver_phone", "chofer_tel"),
        border_crossing: getRoadField("border_crossing", "cruce_frontera"),
        origin_city: getRoadField("origin_city", "origen_pto"),
        destination_city: getRoadField("destination_city", "destino_pto"),
        route_itinerary: getRoadField("route_itinerary", "itinerario"),
        cargo_class: getRoadField("cargo_class", "clase_carga") || "FTL",
        commodity: getRoadField("commodity", "mercaderia"),
        packages: getRoadField("packages", "cant_bultos"),
        weight_kg: getRoadField("weight_kg", "peso_bruto"),
        volume_m3: getRoadField("volume_m3", "vol_m3"),
        hazmat: !!(
          opRoad.hazmat ??
          roadSnap.hazmat ??
          (cfVal("hazmat") === "1")
        ),
        temp_control: !!(
          opRoad.temp_control ??
          roadSnap.temp_control ??
          (cfVal("temp_ctrl") === "1")
        ),
        temp_c: getRoadField("temp_c", "temp_c"),
        seal_no: getRoadField("seal_no", "precinto"),
        observations: getRoadField("observations", "observaciones"),
        etd: getRoadField("etd", "f_est_salida"),
        eta: getRoadField("eta", "llegada_destino"),
        transit_days: getRoadField("transit_days", "dias_transito"),
        containers_json: Array.isArray(opRoad.containers_json)
          ? opRoad.containers_json
          : Array.isArray(roadSnap.containers_json)
          ? roadSnap.containers_json
          : [],
      });

      setMulti({
        doc_master: op.multimodal?.doc_master ?? cfVal("doc_master") ?? "",
        doc_house: op.multimodal?.doc_house ?? cfVal("doc_house") ?? "",
        crt_number: op.multimodal?.crt_number ?? cfVal("crt") ?? "",
        shipping_line:
          op.multimodal?.shipping_line ?? cfVal("linea_marit") ?? "",
        itinerary: op.multimodal?.itinerary ?? cfVal("itinerario") ?? "",
        free_days: op.multimodal?.free_days ?? cfVal("dias_libre") ?? "",
        legs: Array.isArray(op.multimodal?.legs)
          ? op.multimodal.legs
          : [],
        observations:
          op.multimodal?.observations ?? cfVal("observaciones") ?? "",
        // NUEVO: términos doc
        doc_master_term:
          op.multimodal?.doc_master_term ??
          cfVal("doc_master_term") ??
          "",
        doc_house_term:
          op.multimodal?.doc_house_term ?? cfVal("doc_house_term") ?? "",
      });

      let profit = null;
      try {
        const csResp = await api
          .get(`/deals/${id}/cost-sheet`)
          .then((r) => r.data)
          .catch(() => null);
        profit = computeProfitFromCostSheet(csResp);
      } catch {}
      setProfitUSD(profit);
      try {
        if (profit != null) {
          const curVal = Number(detail.deal?.value ?? 0);
          if (Math.abs(curVal - profit) > 0.01) {
            await api.patch(`/deals/${id}`, { value: profit });
            setDeal((d) => (d ? { ...d, value: profit } : d));
          }
        }
      } catch {}

      await Promise.all([loadFiles(), loadParams()]);
      await loadNotes();
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const getCF = (key) => cf[key]?.value ?? "";
  const setCFLocal = (key, updater) =>
    setCf((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || {}), ...updater },
    }));
  function markDirty(key) {
    setDirtyCF((prev) => {
      const s = new Set(prev);
      s.add(key);
      return s;
    });
  }

  // Reemplazar COMPLETO por esta versión
  async function upsertCF(key, label, type, value) {
    const sid = Number(id);

    // Normalizar valor
    const safeValue =
      value !== null && typeof value === "object"
        ? JSON.stringify(value)
        : String(value ?? "");

    // Si el backend no soporta 'json', guardamos como 'text'
    const safeType = type === "json" ? "text" : type || "text";

    const row = cf[key];

    const putById = async (cfId) => {
      await api.put(`/deals/${sid}/custom-fields/${cfId}`, {
        value: safeValue,
      });
      setCFLocal(key, { id: cfId, value: safeValue });
      return true;
    };

    // 1) Si ya tenemos id en memoria, PUT directo
    if (row?.id) {
      try {
        await putById(row.id);
        return;
      } catch (e) {
        console.warn(
          `[CF PUT by id] falló (${key}). Sigo…`,
          e?.response?.data || e.message
        );
      }
    }

    // 2) Buscar por key (para evitar 500 por duplicado en POST)
    try {
      const { data: list } = await api.get(`/deals/${sid}/custom-fields`);
      const found = Array.isArray(list)
        ? list.find((r) => r.key === key)
        : null;
      if (found?.id) {
        await putById(found.id);
        setCFLocal(key, {
          id: found.id,
          label: found.label || label || key,
          type: found.type || safeType,
          value: safeValue,
        });
        return;
      }
    } catch (e) {
      console.warn(
        `[CF GET list] falló (${key})`,
        e?.response?.data || e.message
      );
    }

    // 3) Si no existe, recién ahí POST create
    try {
      const { data } = await api.post(`/deals/${sid}/custom-fields`, {
        key,
        label: label || key,
        value: safeValue,
        type: safeType,
      });
      setCFLocal(key, {
        id: data?.id,
        label: data?.label || label || key,
        type: data?.type || safeType,
        value: safeValue,
      });
      return;
    } catch (e) {
      console.warn(
        `[CF POST create] falló (${key})`,
        e?.response?.data || e.message
      );
      throw e;
    }
  }

  // ===== Guardado por modalidad: SOLO CF (más snapshot JSON por modalidad) =====
  async function saveModal(modal, payload, mirrorCF = []) {
    // 1) normalizar payload (strings vacíos en vez de null/undefined)
    const clean = {};
    for (const [k, v] of Object.entries(payload || {})) {
      if (v === undefined) continue;
      clean[k] = v === null ? "" : v;
    }

    // 2) Espejar cada campo indicado en mirrorCF -> CF (no bloquea si falla alguno)
    const tasks = (mirrorCF || []).map((m) => {
      const val =
        typeof m.pick === "function" ? m.pick(clean) : clean?.[m.key];
      return upsertCF(m.key, m.label || m.key, m.type || "text", val).catch(
        (e) => {
          console.warn(
            `[CF mirror:${modal}] fallo "${m.key}"`,
            e?.response?.data || e.message
          );
        }
      );
    });

    // 3) Guardar snapshot del modal
    const snapshotKey = `op_${modal}_json`;
    tasks.push(
      upsertCF(snapshotKey, `OP ${modal} JSON`, "json", clean).catch(() => {})
    );

    await Promise.all(tasks);
    return true;
  }

  async function saveAll() {
    try {
      // 1) guardar deal (valor)
      await api.patch(`/deals/${id}`, {
        description: desc || null,
        value: profitUSD != null ? profitUSD : Number(deal?.value || 0),
      });

      // 2) upsert CFs sucios (incluye file_labels_json si se marcó)
      if (cfSupported) {
        const saves = [];

        dirtyCF.forEach((key) => {
          const row = cf[key];
          if (!row) return;
          saves.push(
            upsertCF(key, row.label || key, row.type || "text", row.value).catch(
              (e) => {
                const msg =
                  e?.response?.data || e?.message || "Error desconocido";
                console.warn(`[CF] Falló guardar "${key}":`, msg);
              }
            )
          );
        });

        // siempre mandamos los rótulos de archivos
        saves.push(
          upsertCF(
            "file_labels_json",
            "Rótulos de archivos",
            "json",
            fileLabels || {}
          ).catch((e) => {
            const msg =
              e?.response?.data || e?.message || "Error desconocido";
            console.warn(`[CF] Falló guardar "file_labels_json":`, msg);
          })
        );

        await Promise.all(saves);
      } else {
        console.warn(
          "[saveAll] cfSupported=false: omito guardado de custom fields"
        );
      }

      // 3) guardar subformularios según modalidad (y espejar en CF)
      const dealTT = String(deal?.transport_type || "").toUpperCase();
      const cfTTraw = String(getCF("modalidad_carga") || "").toUpperCase();
      const mapCF2TT = {
        AEREO: "AIR",
        MARITIMO: "OCEAN",
        TERRESTRE: "ROAD",
        MULTIMODAL: "MULTIMODAL",
      };
      const currentTT = ["AIR", "OCEAN", "ROAD", "MULTIMODAL"].includes(dealTT)
        ? dealTT
        : mapCF2TT[cfTTraw] || "AIR";

      let okAir = true,
        okOcean = true,
        okRoad = true,
        okMulti = true;

      if (currentTT === "AIR") {
        okAir = await saveModal("air", air, [
          {
            key: "doc_master",
            label: "DOC MASTER",
            type: "text",
            pick: (p) => p.doc_master,
          },
          {
            key: "doc_house",
            label: "DOC HOUSE",
            type: "text",
            pick: (p) => p.doc_house,
          },
          {
            key: "factura",
            label: "FACTURA",
            type: "text",
            pick: (p) => p.factura,
          },
          {
            key: "packing_list",
            label: "PACKING LIST",
            type: "text",
            pick: (p) => p.packing_list,
          },
          {
            key: "certificado_origen",
            label: "CERTIFICADO DE ORIGEN",
            type: "text",
            pick: (p) => p.certificado_origen,
          },
          {
            key: "linea_aerea",
            label: "Línea aérea",
            type: "text",
            pick: (p) => p.airline,
          },
          {
            key: "shpr_cnee",
            label: "SHPR - CNEE",
            type: "text",
            pick: (p) => p.shpr_cnee,
          },
          {
            key: "agente",
            label: "Agente",
            type: "text",
            pick: (p) => p.agent,
          },
          {
            key: "ag_aduanera",
            label: "Ag Aduanera",
            type: "text",
            pick: (p) => p.customs_broker,
          },
          {
            key: "proveedor",
            label: "Proveedor",
            type: "text",
            pick: (p) => p.provider,
          },
          {
            key: "origen_pto",
            label: "Origen",
            type: "text",
            pick: (p) => p.origin_airport,
          },
          {
            key: "transb_pto",
            label: "Transbordo",
            type: "text",
            pick: (p) => p.transshipment_airport,
          },
          {
            key: "destino_pto",
            label: "Destino",
            type: "text",
            pick: (p) => p.destination_airport,
          },
          {
            key: "mercaderia",
            label: "Mercadería",
            type: "text",
            pick: (p) => p.commodity,
          },
          {
            key: "cant_bultos",
            label: "Cant bultos",
            type: "number",
            pick: (p) => p.packages,
          },
          {
            key: "peso_bruto",
            label: "Peso",
            type: "text",
            pick: (p) => p.weight_gross_kg,
          },
          {
            key: "vol_m3",
            label: "Vol m³",
            type: "text",
            pick: (p) => p.volume_m3,
          },
          {
            key: "p_vol",
            label: "P. Vol",
            type: "text",
            pick: (p) => p.weight_chargeable_kg,
          },
          {
            key: "dimensiones",
            label: "Dimensiones",
            type: "text",
            pick: (p) => p.dimensions_text,
          },
          {
            key: "f_est_salida",
            label: "F. Est. Salida",
            type: "date",
            pick: (p) => p.etd,
          },
          {
            key: "llegada_transb",
            label: "Arribo Transb.",
            type: "date",
            pick: (p) => p.trans_arrival,
          },
          {
            key: "salida_transb",
            label: "Salida Transb.",
            type: "date",
            pick: (p) => p.trans_depart,
          },
          {
            key: "llegada_destino",
            label: "ETA",
            type: "date",
            pick: (p) => p.eta,
          },
          {
            key: "dias_transito",
            label: "Días Tránsito",
            type: "number",
            pick: (p) => p.transit_days,
          },
          {
            key: "observaciones",
            label: "OBS",
            type: "text",
            pick: (p) => p.observations,
          },
          {
            key: "doc_master_term",
            label: "Doc Master (term)",
            type: "text",
            pick: (p) => p.doc_master_term,
          },
          {
            key: "doc_house_term",
            label: "Doc House (term)",
            type: "text",
            pick: (p) => p.doc_house_term,
          },
          {
            key: "flete_pago",
            label: "Flete pago",
            type: "text",
            pick: (p) => p.flete_pago,
          },
          {
            key: "gastos_locales_pago",
            label: "Gastos locales pago",
            type: "text",
            pick: (p) => p.gastos_locales_pago,
          },
        ]);
      }

      if (currentTT === "OCEAN") {
        okOcean = await saveModal("ocean", ocean, [
          {
            key: "doc_master",
            label: "DOC MASTER",
            type: "text",
            pick: (p) => p.mbl,
          },
          {
            key: "doc_house",
            label: "DOC HOUSE",
            type: "text",
            pick: (p) => p.hbl,
          },
          {
            key: "linea_marit",
            label: "Línea marítima",
            type: "text",
            pick: (p) => p.shipping_line,
          },
          {
            key: "origen_pto",
            label: "Puerto Origen",
            type: "text",
            pick: (p) => p.pol,
          },
          {
            key: "transb_pto",
            label: "Transbordo",
            type: "text",
            pick: (p) => p.transshipment_port,
          },
          {
            key: "destino_pto",
            label: "Puerto Destino",
            type: "text",
            pick: (p) => p.pod,
          },
          {
            key: "mercaderia",
            label: "Mercadería",
            type: "text",
            pick: (p) => p.commodity,
          },
          {
            key: "cant_bultos",
            label: "Cant bultos",
            type: "number",
            pick: (p) => p.packages,
          },
          {
            key: "peso_bruto",
            label: "Peso (kg)",
            type: "text",
            pick: (p) => p.weight_kg,
          },
          {
            key: "vol_m3",
            label: "Vol m³",
            type: "text",
            pick: (p) => p.volume_m3,
          },
          {
            key: "p_vol",
            label: "Chg. (kg)",
            type: "text",
            pick: (p) => p.chargeable_kg,
          },
          {
            key: "tiempo_trans",
            label: "Tiempo tránsito (d)",
            type: "text",
            pick: (p) => p.transit_time_days,
          },
          {
            key: "dias_libre",
            label: "Free days",
            type: "text",
            pick: (p) => p.free_days,
          },
          {
            key: "itinerario",
            label: "Itinerario",
            type: "text",
            pick: (p) => p.itinerary,
          },
          {
            key: "observaciones",
            label: "OBS",
            type: "text",
            pick: (p) => p.observations,
          },
          // NUEVO: términos
          {
            key: "doc_master_term",
            label: "Doc Master (term)",
            type: "text",
            pick: (p) => p.doc_master_term,
          },
          {
            key: "doc_house_term",
            label: "Doc House (term)",
            type: "text",
            pick: (p) => p.doc_house_term,
          },
        ]);
      }

      if (currentTT === "ROAD") {
        okRoad = await saveModal("road", road, [
          {
            key: "crt",
            label: "CRT",
            type: "text",
            pick: (p) => p.cmr_crt_number,
          },
          {
            key: "placa_camion",
            label: "Placa Camión",
            type: "text",
            pick: (p) => p.truck_plate,
          },
          {
            key: "placa_remolque",
            label: "Placa Remolque",
            type: "text",
            pick: (p) => p.trailer_plate,
          },
          {
            key: "chofer",
            label: "Chofer",
            type: "text",
            pick: (p) => p.driver_name,
          },
          {
            key: "chofer_tel",
            label: "Tel. Chofer",
            type: "text",
            pick: (p) => p.driver_phone,
          },
          {
            key: "cruce_frontera",
            label: "Cruce Fronterizo",
            type: "text",
            pick: (p) => p.border_crossing,
          },
          {
            key: "precinto",
            label: "Precinto",
            type: "text",
            pick: (p) => p.seal_no,
          },
          {
            key: "observaciones",
            label: "OBS",
            type: "text",
            pick: (p) => p.observations,
          },
        ]);
      }

      if (currentTT === "MULTIMODAL") {
        okMulti = await saveModal("multimodal", multi, [
          {
            key: "doc_master",
            label: "DOC MASTER",
            type: "text",
            pick: (p) => p.doc_master,
          },
          {
            key: "doc_house",
            label: "DOC HOUSE",
            type: "text",
            pick: (p) => p.doc_house,
          },
          {
            key: "crt",
            label: "CRT",
            type: "text",
            pick: (p) => p.crt_number,
          },
          {
            key: "linea_marit",
            label: "Naviera/Carrier",
            type: "text",
            pick: (p) => p.shipping_line,
          },
          {
            key: "itinerario",
            label: "Itinerario",
            type: "text",
            pick: (p) => p.itinerary,
          },
          {
            key: "dias_libre",
            label: "Free days",
            type: "text",
            pick: (p) => p.free_days,
          },
          {
            key: "observaciones",
            label: "OBS",
            type: "text",
            pick: (p) => p.observations,
          },
          // NUEVO: términos
          {
            key: "doc_master_term",
            label: "Doc Master (term)",
            type: "text",
            pick: (p) => p.doc_master_term,
          },
          {
            key: "doc_house_term",
            label: "Doc House (term)",
            type: "text",
            pick: (p) => p.doc_house_term,
          },
        ]);
      }

      // 4) cerrar edición y recargar
      setEditMode(false);
      setDirtyCF(new Set());
      await reload();

      const anyFail = !okAir || !okOcean || !okRoad || !okMulti;
      if (anyFail) {
        alert(
          "Guardado parcial: algunos datos de la modalidad no pudieron guardarse. Revisá la consola para ver el detalle."
        );
      } else {
        alert("Cambios guardados.");
      }
    } catch (e) {
      console.error("[saveAll] error", e);
      alert(
        "No se pudieron guardar los cambios. Revisá la consola para más detalles."
      );
    }
  } // <-- CIERRE CORRECTO DE saveAll()

  // Cancelar edición: descarta cambios locales y recarga desde el servidor
  async function cancelEdit() {
    setEditMode(false);
    setDirtyCF(new Set());
    await reload();
  }

  async function removeFile(fileId) {
    if (!editMode) return;
    if (!window.confirm("¿Eliminar archivo?")) return;
    try {
      await api.delete(`/deals/${id}/files/${fileId}`);
      // limpiar rótulo si existía
      setFileLabels((prev) => {
        const next = { ...prev };
        if (next[fileId] !== undefined) {
          delete next[fileId];
          setCFLocal("file_labels_json", {
            label: "Rótulos de archivos",
            type: "json",
            value: JSON.stringify(next),
          });
          markDirty("file_labels_json");
        }
        return next;
      });
      await loadFiles();
    } catch {
      alert("No se pudo eliminar el archivo.");
    }
  }

    async function addNote() {
    const txt = (note || "").trim();
    if (!txt) return;

    const me = getCurrentUserFromStorage();
    const tempId = `tmp-${Date.now()}`;
    const nowIso = new Date().toISOString();

    // ids de archivos que se adjuntaron a ESTA nota
    const attachedIds = (notePendingFiles || [])
      .map((f) => f.id)
      .filter(Boolean);

    // Nota optimista (sin adjuntos aún, solo texto)
    setNotesList((prev) => [
      {
        id: tempId,
        type: "note",
        subject: `Nota en ${deal?.reference || "operación"}`,
        notes: txt,
        deal_id: Number(id),
        created_at: nowIso,
        created_by: me.id,
        created_by_name: me.name,
        created_by_email: me.email,
      },
      ...prev,
    ]);

    setNote(""); // vaciar textarea

    try {
      const { data: created } = await api.post("/activities", {
        type: "note",
        subject: `Nota en ${deal?.reference || "operación"}`,
        notes: txt,
        deal_id: Number(id),
        done: 1,
        ...(me.id ? { created_by: me.id } : {}),
      });

      const activityId = created?.id;
      if (activityId && attachedIds.length) {
        // armamos nuevo mapa: activityId -> [fileIds]
        const nextMap = {
          ...(noteAttachmentsMap || {}),
          [activityId]: attachedIds,
        };

        // lo guardamos en CF usando el helper upsertCF
        try {
          await upsertCF(
            "note_attachments_json",
            "Adjuntos por nota",
            "json",
            nextMap
          );
        } catch (e) {
          console.warn(
            "[addNote] No se pudo guardar note_attachments_json",
            e?.response?.data || e.message
          );
        }

        // actualizamos mapa en memoria
        setNoteAttachmentsMap(nextMap);
      }

      // limpiamos adjuntos pendientes (esta nota ya quedó grabada)
      setNotePendingFiles([]);

      // recargamos notas desde el servidor (para tener ids reales, etc.)
      await loadNotes();
    } catch (err) {
      console.error("No se pudo crear la nota", err);
      // revertimos la nota temporal
      setNotesList((prev) => prev.filter((x) => x.id !== tempId));
      alert("No se pudo crear la nota.");
    }
  }


  function triggerUpload(type) {
    if (!fileInputsRef.current[type]) return;
    fileInputsRef.current[type].click();
  }

  function downloadBlob(blob, filename = "informe.pdf") {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function generateStatusReport() {
    if (!id) return;
    try {
      setGeneratingReport(true);
      try {
        const { data } = await api.post(
          "/reports/status/informes",
          { deal_id: Number(id) },
          { responseType: "blob" }
        );
        const blob = new Blob([data], { type: "application/pdf" });
        downloadBlob(blob, `informe-estado-${deal?.reference || id}.pdf`);
        return;
      } catch {}
      try {
        const { data } = await api.get(`/reports/status/${id}`, {
          responseType: "blob",
        });
        const blob = new Blob([data], { type: "application/pdf" });
        downloadBlob(blob, `informe-estado-${deal?.reference || id}.pdf`);
        return;
      } catch {}
      try {
        const { data } = await api.get(`/reports/status`, {
          params: { deal_id: id },
          responseType: "blob",
        });
        const blob = new Blob([data], { type: "application/pdf" });
        downloadBlob(blob, `informe-estado-${deal?.reference || id}.pdf`);
        return;
      } catch (e3) {
        throw e3;
      }
    } catch {
      alert("No se pudo generar el informe de estado.");
    } finally {
      setGeneratingReport(false);
    }
  }

  // pestañas de visor
  const pushUploading = ({ name, type }) => {
    const tempId = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    setUploadingFiles((prev) => [
      ...prev,
      { tempId, name, type, progress: 0, docLabel: docLabelFor(type) },
    ]);
    return tempId;
  };
  const setUploadingProgress = (tempId, progress) => {
    setUploadingFiles((prev) =>
      prev.map((u) => (u.tempId === tempId ? { ...u, progress } : u))
    );
  };
  const popUploading = (tempId) => {
    setUploadingFiles((prev) => prev.filter((u) => u.tempId !== tempId));
  };

    // ===== Adjuntos de la NOTA en edición =====
  async function handleNoteAttachmentChange(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;

    for (const file of files) {
      try {
        const form = new FormData();
        form.append("type", "note_attachment");
        form.append("file", file);

        const { data: info } = await api.post(`/deals/${id}/files`, form, {
          headers: { "Content-Type": "multipart/form-data" },
        });

        if (info) {
          // lo agregamos a los adjuntos de la nota en edición
          setNotePendingFiles((prev) => [...prev, info]);
        }
      } catch (err) {
        console.error("No se pudo subir adjunto de nota", err);
        alert(`No se pudo subir el archivo "${file.name}".`);
      }
    }

    // refrescamos listado general de archivos de la operación
    await loadFiles();
  }

  async function removePendingAttachment(fileId) {
    // lo sacamos de la lista de adjuntos de la nota en edición
    setNotePendingFiles((prev) => prev.filter((f) => f.id !== fileId));

    try {
      await api.delete(`/deals/${id}/files/${fileId}`);
      await loadFiles();
    } catch (err) {
      console.warn("No se pudo eliminar adjunto de nota", err);
    }
  }


  // Soporta selección múltiple y sube en serie
  async function handleFileChange(type, e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    for (const file of files) {
      const tempId = pushUploading({ name: file.name, type });
      setActiveTab(`up-${tempId}`);
      try {
        const form = new FormData();
        form.append("type", type);
        form.append("file", file);
        const { data: info } = await api.post(`/deals/${id}/files`, form, {
          headers: { "Content-Type": "multipart/form-data" },
          onUploadProgress: (ev) => {
            if (ev.total) {
              const p = Math.round((ev.loaded / ev.total) * 100);
              setUploadingProgress(tempId, p);
            }
          },
        });
        popUploading(tempId);
        await loadFiles();

        // asignar rótulo por defecto al nuevo archivo y marcar CF sucio
        const newId = info?.id;
        if (newId) {
          setFileLabels((prev) => {
            const next = { ...prev, [newId]: file.name };
            setCFLocal("file_labels_json", {
              label: "Rótulos de archivos",
              type: "json",
              value: JSON.stringify(next),
            });
            markDirty("file_labels_json");
            return next;
          });
          setActiveTab(`f-${newId}`);
        } else {
          const all = flattenFiles(filesByType);
          const newest = all[0];
          if (newest) setActiveTab(`f-${newest.id}`);
        }
      } catch {
        popUploading(tempId);
        alert("No se pudo subir el archivo.");
      }
    }
  }

  const flatUploadingTabs = uploadingFiles.map((u) => ({
    id: `up-${u.tempId}`,
    kind: "upload",
    label: `${u.docLabel} — Subiendo ${u.progress}%`,
    progress: u.progress,
    name: u.name,
    type: u.type,
    docLabel: u.docLabel,
  }));
  const flatFiles = useMemo(
    () => flattenFiles(filesByType),
    [filesByType, filesRefreshKey]
  );

    const fileById = useMemo(() => {
    const map = {};
    flatFiles.forEach((f) => {
      if (f.id != null) map[f.id] = f;
    });
    return map;
  }, [flatFiles]);

  const dealTT = String(deal?.transport_type || "").toUpperCase();
  const cfTTraw = String(getCF("modalidad_carga") || "").toUpperCase();
  const mapCF2TT = {
    AEREO: "AIR",
    MARITIMO: "OCEAN",
    TERRESTRE: "ROAD",
    MULTIMODAL: "MULTIMODAL",
  };
  const currentTT = ["AIR", "OCEAN", "ROAD", "MULTIMODAL"].includes(dealTT)
    ? dealTT
    : mapCF2TT[cfTTraw] || "AIR";

  


  const flatFileTabs = flatFiles.map((f) => ({
  id: `f-${f.id}`,
  kind: "file",
  label: `${docLabelFor(f.type, currentTT)} — ${truncate(
    f.filename,
    22
  )}`,
  file: f,
  docLabel: docLabelFor(f.type, currentTT),
}));
  const topTabs = [
    { id: "detalle", kind: "base", label: "Detalle" },
    { id: "documentos", kind: "base", label: "Documentos" },
    { id: "detcos", kind: "base", label: "Planilla de costos (DET COS)" },
    ...flatUploadingTabs,
    ...flatFileTabs,
  ];
  function openFileTabByType(type) {
    const list = filesByType[type] || [];
    if (!list.length) return false;
    const f = list[0]; // más reciente
    setActiveTab(`f-${f.id}`);
    return true;
  }
  const isFileTab = (id) =>
    String(id).startsWith("f-") || String(id).startsWith("up-");
  function getFileFromTab(id) {
    const sid = String(id);
    if (sid.startsWith("up-")) {
      const u = uploadingFiles.find((x) => `up-${x.tempId}` === sid);
      return u ? { uploading: true, ...u } : null;
    }
    if (sid.startsWith("f-")) {
  const fileId = Number(sid.slice(2));
  const f = flatFiles.find((x) => x.id === fileId);
  return f
    ? {
        uploading: false,
        file: f,
        docLabel: docLabelFor(f.type, currentTT),
      }
    : null;
}
    return null;
  }

  const opts = {
    tipo_operacion: (
      paramMap.tipo_operacion.length
        ? paramMap.tipo_operacion
        : [{ value: "IMPORT" }, { value: "EXPORT" }]
    ).map((o) => o.value),
    modalidad_carga: (
      paramMap.modalidad_carga.length
        ? paramMap.modalidad_carga
        : [
            { value: "AEREO" },
            { value: "MARITIMO" },
            { value: "TERRESTRE" },
            { value: "MULTIMODAL" },
          ]
    ).map((o) => o.value),
    tipo_carga: (
      paramMap.tipo_carga.length
        ? paramMap.tipo_carga
        : [{ value: "LCL" }, { value: "FCL" }]
    ).map((o) => o.value),
    incoterm: (paramMap.incoterm.length ? paramMap.incoterm : []).map(
      (o) => o.value
    ),
  };

  const orgRuc = deal?.org_ruc || getCF("org_ruc") || getCF("ruc") || "";
  const orgAddress =
    deal?.org_address || getCF("org_address") || getCF("address") || "";
  const orgPhone =
    deal?.org_phone || getCF("org_phone") || getCF("phone") || "";
  const orgEmail =
    deal?.org_email || getCF("org_email") || getCF("email") || "";

  const [modalTab, setModalTab] = useState("AIR");
  useEffect(() => {
    setModalTab(currentTT);
  }, [currentTT]);

  // 👉 Estado del pipeline a mostrar en el header
  const rawStage =
    deal?.stage_name || // si viene directo del backend
    deal?.stage?.name || // si viene como objeto stage
    deal?.status_ops || // si tenés este campo en la tabla deals
    getCF("estado") || // campo personalizado
    "Sin etapa";

const pipelineState = String(rawStage);

// Ejecutivo de cuenta (quien lleva la operación)
// Usamos optional chaining porque deal puede ser null al principio

// Después (sin fallback al creador):
const executiveName =
  deal?.deal_advisor_name ||
  deal?.advisor_user_name ||
  deal?.advisor_name ||
  "—";

  // Rótulo/resumen de la operación (para mostrar en el header)
 // Rótulo / resumen de la operación (para mostrar en el header y en correos)
  const headerLabelParts = [];

  const tipoOp = getCF("tipo_operacion");
  const modalidad = getCF("modalidad_carga");
  const tipoCarga = getCF("tipo_carga");
  const origen = getCF("origen_pto");
  const destino = getCF("destino_pto");
  const merca = getCF("mercaderia");

  if (tipoOp) headerLabelParts.push(tipoOp);
  if (modalidad) headerLabelParts.push(modalidad);
  if (tipoCarga) headerLabelParts.push(tipoCarga);
  if (origen || destino)
    headerLabelParts.push(`${origen || "?"} → ${destino || "?"}`);
  if (merca) headerLabelParts.push(merca);

  const headerLabel = headerLabelParts.join(" • ");

  // 📨 Asunto base para correos (formato: Solicitud - Referencia · Rótulo)
  const emailSubjectBase = `Solicitud - ${deal?.reference || id}${
    headerLabel ? ` · ${headerLabel}` : ""
  }`;

  // abrir archivo por tipo
  const openDocType = (type) => {
    const f = (filesByType[type] || [])[0];
    if (f) setActiveTab(`f-${f.id}`);
    else alert("No hay archivo cargado para este documento.");
  };

  // helper para que los inputs del detalle y la pestaña Documentos escriban el mismo CF
  const setCFAndDirty = (key, label, value) => {
    setCFLocal(key, { label, type: "text", value });
    markDirty(key);
  };

  /* user helpers (cliente) */
  function getCurrentUserFromStorage() {
    try {
      const keys = ["auth", "user", "authUser", "session", "crm_user"];
      for (const k of keys) {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const obj = JSON.parse(raw);
        const id =
          obj?.user?.id ??
          obj?.id ??
          obj?.userId ??
          obj?.user_id ??
          null;
        const name =
          obj?.user?.name ??
          obj?.user?.fullName ??
          obj?.name ??
          obj?.fullName ??
          null;
        const email = obj?.user?.email ?? obj?.email ?? null;
        if (id || name || email) {
          return {
            id: id ? Number(id) : null,
            name: name || null,
            email: email || null,
          };
        }
      }
    } catch {}
    return { id: null, name: null, email: null };
  }

  // ======== CORREO: helpers ========

  // Carga proveedores que tengan rubro "FLETE"
// Carga proveedores que tengan rubro "FLETE"
// Devuelve true si el proveedor tiene algo parecido a "flete" en su rubro/categoría
function providerHasFreightTag(p = {}) {
  const parts = [];

  if (p.category) parts.push(p.category);
  if (p.rubro) parts.push(p.rubro);
  if (p.segment) parts.push(p.segment);
  if (p.type) parts.push(p.type);
  if (Array.isArray(p.tags)) parts.push(...p.tags);
  if (typeof p.tags_text === "string") parts.push(p.tags_text);

  const txt = parts
    .join(" ")
    .toString()
    .toLowerCase();

  return txt.includes("flete");
}

// Carga proveedores que tengan rubro "FLETE".
// IMPORTANTE: tenés que apuntar PROVIDERS_ENDPOINT a una ruta que exista.
async function loadFreightProviders() {
  // Si por algún motivo no querés hacer la llamada, podés desactivar acá:
  if (!PROVIDERS_ENDPOINT) {
    setProviders([]);
    return;
  }

  try {
    setProvidersLoading(true);

    const { data } = await api
      .get(PROVIDERS_ENDPOINT)
      .catch((err) => {
        // Si el backend devuelve 404, lo anotamos en consola y seguimos sin romper nada
        if (err?.response?.status === 404) {
          console.warn(
            `[loadFreightProviders] La ruta "${PROVIDERS_ENDPOINT}" no existe en el backend (404).` +
              " Ajustá PROVIDERS_ENDPOINT o creá el endpoint en el servidor."
          );
          return { data: [] };
        }
        throw err;
      });

    const list = Array.isArray(data) ? data : [];

    // Filtramos por "flete" en rubro/categoría/tags
    const onlyFreight = list.filter(providerHasFreightTag);

    // Si no encontramos ninguno con “flete”, mostramos todos para no dejar la lista vacía
    setProviders(onlyFreight.length ? onlyFreight : list);
  } catch (e) {
    console.warn("No se pudieron cargar proveedores de flete", e);
    setProviders([]);
  } finally {
    setProvidersLoading(false);
  }
}

  // Devuelve true si el proveedor tiene algo parecido a "flete" en su rubro/categoría
function providerHasFreightTag(p = {}) {
  const parts = [];

  if (p.category) parts.push(p.category);
  if (p.rubro) parts.push(p.rubro);
  if (p.segment) parts.push(p.segment);
  if (p.type) parts.push(p.type);
  if (Array.isArray(p.tags)) parts.push(...p.tags);
  if (typeof p.tags_text === "string") parts.push(p.tags_text);

  const txt = parts
    .join(" ")
    .toString()
    .toLowerCase();

  return txt.includes("flete");
}

  // Usa los datos de la operación para armar el mail de pedido de tarifa
  // Usa los datos de la operación para armar el mail de pedido de tarifa
  // Asunto: usa siempre emailSubjectBase => "Solicitud - REF · Rótulo"
  function buildFreightRequestTemplate() {
    const tipoOpV = getCF("tipo_operacion") || "—";
    const modalidadV = getCF("modalidad_carga") || currentTT || "—";
    const incotermV = getCF("incoterm") || "—";
    const origenV =
      getCF("origen_pto") ||
      air.origin_airport ||
      ocean.pol ||
      road.origin_city ||
      "—";
    const destinoV =
      getCF("destino_pto") ||
      air.destination_airport ||
      ocean.pod ||
      road.destination_city ||
      "—";
    const mercaV =
      getCF("mercaderia") ||
      air.commodity ||
      ocean.commodity ||
      road.commodity ||
      "—";

    const bultos =
      air.packages || ocean.packages || road.packages || "—";
    const peso =
      air.weight_gross_kg || ocean.weight_kg || road.weight_kg || "—";
    const volumen =
      air.volume_m3 || ocean.volume_m3 || road.volume_m3 || "—";

    const me = getCurrentUserFromStorage();

    // 👉 Usamos el asunto base común
    const subj = emailSubjectBase;

    const body =
      `Estimados,\n\n` +
      `Solicitamos su mejor tarifa de flete para la siguiente operación:\n\n` +
      `• Tipo de operación: ${tipoOpV}\n` +
      `• Modalidad: ${modalidadV}\n` +
      `• Incoterm: ${incotermV}\n` +
      `• Origen: ${origenV}\n` +
      `• Destino: ${destinoV}\n` +
      `• Mercadería: ${mercaV}\n` +
      `• Bultos: ${bultos}\n` +
      `• Peso bruto: ${peso} kg\n` +
      `• Volumen: ${volumen} m³\n\n` +
      `Favor indicar:\n` +
      `• Frecuencia y transit time\n` +
      `• Free time en destino\n` +
      `• Condiciones de pago\n\n` +
      `Referencia interna: ${deal.reference || id}\n\n` +
      `Saludos,\n` +
      `${me.name || ""}`;

    setEmailSubject(subj);
    setEmailBody(body);
  }

  // Abre el modal de correo y prepara los campos
  function openEmailModal(mode = "general") {
    const me = getCurrentUserFromStorage();
    const defaultTo =
      (deal?.contact_email && String(deal.contact_email).trim()) ||
      (orgEmail && String(orgEmail).trim()) ||
      "";
    const subjBase = emailSubjectBase;

    setEmailMode(mode);
    setEmailTo(defaultTo);
    setEmailCc("");
    setSelectedProviderIds([]);

    if (mode === "flete") {
      buildFreightRequestTemplate();
      loadFreightProviders();
    } else {
      const body =
        `Hola ${deal?.contact_name || ""},\n\n` +
        `Te escribo respecto a la operación ${deal?.reference || ""}.\n\n` +
        `Saludos.\n` +
        `${me.name || ""}`;
      setEmailSubject(subjBase);
      setEmailBody(body);
    }

    setShowEmailModal(true);
  }

  // Marca / desmarca un proveedor en la lista y actualiza el campo "Para"
  function toggleProvider(provider) {
    setSelectedProviderIds((prev) => {
      const exists = prev.includes(provider.id);
      const next = exists
        ? prev.filter((id) => id !== provider.id)
        : [...prev, provider.id];

      const selected = providers.filter((p) => next.includes(p.id));
      const emailsFromProviders = selected.map((p) => p.email).filter(Boolean);

      const currentManual = (emailTo || "")
        .split(/[;,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const merged = Array.from(
        new Set([...currentManual, ...emailsFromProviders])
      ).join("; ");

      setEmailTo(merged);
      return next;
    });
  }

  // Desde la vista previa, dispara Outlook / cliente de correo
  function handleSendEmailFromModal() {
    if (!emailTo.trim()) {
      alert("Tenés que indicar al menos un destinatario (Para).");
      return;
    }

    const params = [];
    if (emailCc.trim()) {
      params.push(`cc=${encodeURIComponent(emailCc)}`);
    }
    params.push(`subject=${encodeURIComponent(emailSubject)}`);
    params.push(`body=${encodeURIComponent(emailBody)}`);

    const mailtoUrl =
      `mailto:${encodeURIComponent(emailTo)}` + `?${params.join("&")}`;

    window.location.href = mailtoUrl;
  }

  if (loading) return <p className="text-sm text-slate-600">Cargando…</p>;
  if (!deal)
    return <p className="text-sm text-slate-600">Operación no encontrada.</p>;

  const me = getCurrentUserFromStorage();
  const authorOf = (a) => {
    const candidates = [
      a?.created_by_name,
      a?.created_by_username,
      a?.creator_name,
      a?.user_name,
      a?.owner_name,
      a?.created_by_email,
      a?.creator_email,
      a?.user_email,
      a?.owner_email,
    ].filter(Boolean);
    if (me.id && a?.created_by && Number(a.created_by) === Number(me.id))
      return "vos";
    if (candidates.length) return candidates[0];
    if (a?.created_by) return `Usuario #${a.created_by}`;
    return "—";
  };

  return (
    <div className="space-y-4">
      {/* ENCABEZADO */}
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="flex items-center justify-between gap-3">
          {/* LADO IZQUIERDO */}
          <div className="flex-1">
            <div className="text-xs text-slate-500">VISTA DE OPERACIÓN</div>

            <div className="flex items-center gap-4 flex-wrap">
              {/* Referencia */}
              <div className="text-2xl font-bold">{deal.reference}</div>

              {/* Estado del pipeline */}
              <div className="text-2xl font-bold text-slate-800">
                {pipelineState}
              </div>
            </div>

            <div className="text-xs text-slate-500 mt-1">
              Cliente: {deal.org_name || "—"} • Contacto:{" "}
              {deal.contact_name || "—"}
            </div>

            {/* RÓTULO / RESUMEN CENTRADO */}
            {headerLabel && (
              <div className="mt-[-10px] text-sm text-slate-800 font-semibold text-center leading-tight">
                {headerLabel}
              </div>
            )}
          </div>

          {/* LADO DERECHO: BOTONES */}
          <div className="flex gap-2 flex-wrap">
            {!editMode ? (
              <button
                className="px-3 py-1.5 text-xs rounded-lg border"
                onClick={() => setEditMode(true)}
              >
                Modificar
              </button>
            ) : (
              <>
                <button
                  className="px-3 py-1.5 text-xs rounded-lg border"
                  onClick={cancelEdit}
                >
                  Cancelar
                </button>
                <button
                  className="px-3 py-1.5 text-xs rounded-lg bg-black text-white"
                  onClick={saveAll}
                >
                  Guardar cambios
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* TABS */}
      <div className="bg-white rounded-2xl shadow px-4 pt-3 pb-0">
        <div className="flex gap-1 flex-wrap overflow-x-auto">
          {topTabs.map((t) => (
            <button
              key={t.id}
              className={`px-3 py-2 text-sm rounded-t-lg border-b-0 border whitespace-nowrap ${
                activeTab === t.id ? "bg-black text-white" : "bg-white"
              }`}
              onClick={() => setActiveTab(t.id)}
              title={t.label}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4">
        {/* PRINCIPAL */}
        <section className="space-y-4">
          {activeTab === "detcos" ? (
            <DetCosSheet
              deal={deal}
              cf={{
                modalidad_carga: (cf["modalidad_carga"] || {}).value,
                tipo_carga: (cf["tipo_carga"] || {}).value,
                origen_pto: (cf["origen_pto"] || {}).value,
                destino_pto: (cf["destino_pto"] || {}).value,
                mercaderia: (cf["mercaderia"] || {}).value,
              }}
            />
          ) : isFileTab(activeTab) ? (
            <FileTabViewer context={getFileFromTab(activeTab)} />
          ) : activeTab === "documentos" ? (
            /* ================= PESTAÑA DOCUMENTOS ================= */
            <div className="bg-white rounded-2xl shadow p-4">
              <h3 className="font-medium mb-3">Documentos de la operación</h3>
              {FILE_TYPES.map((t) => {
                const cfKey = t.key;
                const list = filesByType[cfKey] || [];
                const latest = list[0] || null;
                const href = latest ? resolveUploadUrl(latest.url) : null;

                return (
                  <div key={t.key} className="border rounded-xl p-3 mb-3">
                    <div className="grid grid-cols-1 md:grid-cols-[220px_1fr_auto] items-start gap-2">
                      <div className="text-sm font-medium">
  {docLabelFor(t.key, currentTT)}
</div>
                      <ul className="mt-2 space-y-1">
                        {list.map((f) => (
                          <li
                            key={f.id}
                            className="flex items-center justify-between gap-3 text-sm border rounded px-2 py-1"
                          >
                            <div className="flex-1 grid grid-cols-1 md:grid-cols-[minmax(220px,1fr)_auto] gap-2 items-center">
                              {editMode ? (
                                <input
                                  className="border rounded-lg px-2 py-1 text-sm w-full"
                                  value={
                                    fileLabels?.[f.id] ?? visibleNameOf(f)
                                  }
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setFileLabels((prev) => {
                                      const next = {
                                        ...(prev || {}),
                                        [f.id]: val,
                                      };
                                      setCFLocal("file_labels_json", {
                                        label: "Rótulos de archivos",
                                        type: "json",
                                        value: JSON.stringify(next),
                                      });
                                      markDirty("file_labels_json");
                                      return next;
                                    });
                                  }}
                                  placeholder="Rótulo visible (lo que se ve en el Detalle)"
                                  title="Este texto será el que se mostrará en el Detalle como hipervínculo"
                                />
                              ) : (
                                <a
                                  className="underline text-blue-600 truncate"
                                  href={resolveUploadUrl(f.url)}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={visibleNameOf(f)}
                                >
                                  {labelOfFile(f, fileLabels)}
                                </a>
                              )}

                              <div className="flex gap-2 justify-end">
                                <button
                                  className="px-2 py-0.5 text-xs rounded border"
                                  onClick={() => setActiveTab(`f-${f.id}`)}
                                >
                                  Ver
                                </button>
                                {editMode && (
                                  <button
                                    className="px-2 py-0.5 text-xs rounded border"
                                    onClick={() => removeFile(f.id)}
                                  >
                                    Eliminar
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="hidden md:block text-[11px] text-slate-500 ml-2">
                              {f.filename || f.original_name}
                            </div>
                          </li>
                        ))}
                        {!list.length && (
                          <li className="text-xs text-slate-500">
                            Sin archivos
                          </li>
                        )}
                      </ul>

                      <div className="flex gap-2">
                        <input
                          type="file"
                          multiple
                          className="hidden"
                          ref={(el) =>
                            (fileInputsRef.current[t.key] = el)
                          }
                          onChange={(e) => handleFileChange(t.key, e)}
                        />
                        <button
                          className="px-2 py-1 text-xs rounded border"
                          onClick={() => triggerUpload(t.key)}
                        >
                          Subir archivo
                        </button>
                        {latest && (
                          <button
                            className="px-2 py-1 text-xs rounded border"
                            onClick={() =>
                              openFileTabByType(t.key) ||
                              window.open(href, "_blank")
                            }
                            title="Abrir última versión"
                          >
                            Abrir
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              {/* ========= TAB DETALLE ========= */}
              {/* Datos generales */}
              <div className="bg-white rounded-2xl shadow p-4">
                <h3 className="font-medium mb-3">Datos generales</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 mb-3">
                  <Field label="Cliente (Organización)">
                    <Input value={deal.org_name || ""} readOnly />
                  </Field>
                  <Field label="RUC">
                    <Input value={orgRuc} readOnly />
                  </Field>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-3 mb-3">
                  <Field label="Dirección">
                    <Input value={orgAddress} readOnly />
                  </Field>
                  <Field label="Teléfono (empresa)">
                    <Input value={orgPhone} readOnly />
                  </Field>
                  <Field label="Email (empresa)">
                    <Input value={orgEmail} readOnly />
                  </Field>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-3 mb-4">
                  <Field label="Contacto">
                    <Input value={deal.contact_name || ""} readOnly />
                  </Field>
                  <Field label="Teléfono (contacto)">
                    <Input value={deal.contact_phone || ""} readOnly />
                  </Field>
                  <Field label="Email (contacto)">
                    <Input value={deal.contact_email || ""} readOnly />
                  </Field>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                  <Field label="Valor (Profit presupuesto)">
                    <Input
                      readOnly
                      value={
                        profitUSD != null
                          ? `$ ${Number(profitUSD).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`
                          : "—"
                      }
                    />
                  </Field>

                  <Field label="Ejecutivo de cuenta">
                    <Input readOnly value={executiveName} />
                  </Field>
                </div>
              </div>

              {/* Fechas logísticas */}
              <div className="bg-white rounded-2xl shadow p-4">
                <h3 className="font-medium mb-3">Fechas logísticas</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                  {[
                    ["f_inicio", "F. Inicio", "date"],
                    ["f_cotiz", "F. Cotiz", "date"],
                    ["f_cierre_aprox", "F. Cierre (aprox)", "date"],
                    ["f_confirm", "F. Confirm", "date"],
                  ].map(([key, label, type]) => (
                    <Field key={key} label={label}>
                      <Input
                        readOnly={!editMode}
                        type={type}
                        value={getCF(key)}
                        onChange={(e) => {
                          setCFLocal(key, {
                            label,
                            type,
                            value: e.target.value,
                          });
                          markDirty(key);
                        }}
                      />
                    </Field>
                  ))}
                </div>
              </div>

              {/* Detalles de operación + Seguro */}
              <div className="bg-white rounded-2xl shadow p-4">
                <h3 className="font-medium mb-3">Detalles de operación</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 mb-3">
                  <Field label="Tipo de operación">
                    <Select
                      readOnly={!editMode}
                      value={getCF("tipo_operacion")}
                      onChange={(e) => {
                        setCFLocal("tipo_operacion", {
                          label: "Tipo de operación",
                          type: "select",
                          value: e.target.value,
                        });
                        markDirty("tipo_operacion");
                      }}
                    >
                      <option value="">—</option>
                      {opts.tipo_operacion.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Mercadería">
                    <Input
                      readOnly={!editMode}
                      value={getCF("mercaderia")}
                      onChange={(e) => {
                        setCFLocal("mercaderia", {
                          label: "Mercadería",
                          type: "text",
                          value: e.target.value,
                        });
                        markDirty("mercaderia");
                      }}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 mb-3">
                  <Field label="Tipo de embarque">
                    <Select
                      readOnly={!editMode}
                      value={getCF("modalidad_carga")}
                      onChange={(e) => {
                        setCFLocal("modalidad_carga", {
                          label: "Tipo de embarque",
                          type: "select",
                          value: e.target.value,
                        });
                        markDirty("modalidad_carga");
                      }}
                    >
                      <option value="">—</option>
                      {opts.modalidad_carga.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Tipo de carga">
                    <Select
                      readOnly={!editMode}
                      value={getCF("tipo_carga")}
                      onChange={(e) => {
                        setCFLocal("tipo_carga", {
                          label: "Tipo de carga",
                          type: "select",
                          value: e.target.value,
                        });
                        markDirty("tipo_carga");
                      }}
                    >
                      <option value="">—</option>
                      {opts.tipo_carga.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 mb-3">
                  <Field label="Origen">
                    <Input
                      readOnly={!editMode}
                      value={getCF("origen_pto")}
                      onChange={(e) => {
                        setCFLocal("origen_pto", {
                          label: "Origen",
                          type: "text",
                          value: e.target.value,
                        });
                        markDirty("origen_pto");
                      }}
                    />
                  </Field>
                  <Field label="Destino">
                    <Input
                      readOnly={!editMode}
                      value={getCF("destino_pto")}
                      onChange={(e) => {
                        setCFLocal("destino_pto", {
                          label: "Destino",
                          type: "text",
                          value: e.target.value,
                        });
                        markDirty("destino_pto");
                      }}
                    />
                  </Field>
                </div>

                {/* Incoterm + Seguro */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                  <Field label="Incoterm">
                    <Select
                      readOnly={!editMode}
                      value={getCF("incoterm")}
                      onChange={(e) => {
                        setCFLocal("incoterm", {
                          label: "Incoterm",
                          type: "select",
                          value: e.target.value,
                        });
                        markDirty("incoterm");
                      }}
                    >
                      <option value="">—</option>
                      {opts.incoterm.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Seguro">
                    <Select
                      readOnly={!editMode}
                      value={getCF("seguro")}
                      onChange={(e) => {
                        setCFLocal("seguro", {
                          label: "Seguro",
                          type: "select",
                          value: e.target.value,
                        });
                        markDirty("seguro");
                      }}
                    >
                      <option value="">—</option>
                      <option value="SI">SI</option>
                      <option value="NO">NO</option>
                      <option value="A CARGO DEL CLIENTE">
                        A CARGO DEL CLIENTE
                      </option>
                    </Select>
                  </Field>
                  <Field label="Tipo de seguro">
                    <Select
                      readOnly={!editMode}
                      value={getCF("tipo_seguro")}
                      onChange={(e) => {
                        setCFLocal("tipo_seguro", {
                          label: "Tipo de seguro",
                          type: "select",
                          value: e.target.value,
                        });
                        markDirty("tipo_seguro");
                      }}
                    >
                      <option value="">—</option>
                      <option value="PUERTA A PUERTA">PUERTA A PUERTA</option>
                      <option value="PUERTA A PUERTO">PUERTA A PUERTO</option>
                      <option value="PUERTO A PUERTA">PUERTO A PUERTA</option>
                      <option value="PUERTO A PUERTO">PUERTO A PUERTO</option>
                    </Select>
                  </Field>
                  <Field label="Condición">
                    <Select
                      readOnly={!editMode}
                      value={getCF("condicion")}
                      onChange={(e) => {
                        setCFLocal("condicion", {
                          label: "Condición",
                          type: "select",
                          value: e.target.value,
                        });
                        markDirty("condicion");
                      }}
                    >
                      <option value="">—</option>
                      <option value="CTR">CTR - CONTRA TODO RIESGO</option>
                      <option value="LAP">LAP - LIBRE AVERIA PARTICULAR</option>
                    </Select>
                  </Field>
                </div>
              </div>

              {/* Pestañas por modalidad */}
              <div className="bg-white rounded-2xl shadow p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium">Detalle por modalidad</h3>
                  <div className="text-xs text-slate-500">
                    Tipo actual: <b>{currentTT}</b>
                  </div>
                </div>
                <div className="flex gap-1 flex-wrap mb-4">
                  {[
                    { key: "AIR", label: "Aéreo" },
                    { key: "OCEAN", label: "Marítimo" },
                    { key: "ROAD", label: "Terrestre" },
                    { key: "MULTIMODAL", label: "Multimodal" },
                  ].map((t) => {
                    const disabled = t.key !== currentTT;
                    const active = modalTab === t.key;
                    return (
                      <button
                        key={t.key}
                        className={`px-3 py-2 text-sm rounded-lg border ${
                          active ? "bg-black text-white" : "bg-white"
                        } ${
                          disabled ? "opacity-60 cursor-not-allowed" : ""
                        }`}
                        onClick={() => !disabled && setModalTab(t.key)}
                        disabled={disabled}
                        title={
                          disabled
                            ? "Pestaña deshabilitada: la operación es de otro tipo"
                            : `Ver ${t.label}`
                        }
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>

                {modalTab === "AIR" && (
                  <AirForm
                    f={air}
                    set={setAirF}
                    readOnly={!editMode}
                    editMode={editMode}
                    getCF={getCF}
                    setCFLocal={setCFLocal}
                    markDirty={markDirty}
                    filesByType={filesByType}
                    openFileTabByType={openFileTabByType}
                    fileLabels={fileLabels}
                  />
                )}
                {modalTab === "OCEAN" && (
                  <OceanForm
                  f={ocean}
                  set={setOceanF}
                  readOnly={!editMode}
                  editMode={editMode}
                  getCF={getCF}
                  setCFLocal={setCFLocal}
                  markDirty={markDirty}
                  filesByType={filesByType}
                  openFileTabByType={openFileTabByType}
                  fileLabels={fileLabels}
                />
                )}
                {modalTab === "ROAD" && (
                  <RoadForm
                    f={road}
                    set={setRoadF}
                    readOnly={!editMode}
                    editMode={editMode}
                    getCF={getCF}
                    setCFLocal={setCFLocal}
                    markDirty={markDirty}
                    filesByType={filesByType}
                    openFileTabByType={openFileTabByType}
                    fileLabels={fileLabels}
                  />
                )}
                {modalTab === "MULTIMODAL" && (
                  <MultimodalForm
                    f={multi}
                    set={setMultiF}
                    readOnly={!editMode}
                    editMode={editMode}
                    getCF={getCF}
                    setCFLocal={setCFLocal}
                    markDirty={markDirty}
                    filesByType={filesByType}
                    openFileTabByType={openFileTabByType}
                    fileLabels={fileLabels}
                  />
                )}
                </div>

                          {/* Notas */}
                        <div className="bg-white rounded-2xl shadow p-4">
                          <h3 className="font-medium mb-3">Notas / Comentarios</h3>

                          {/* textarea + botón guardar */}
                          <div className="flex gap-2">
                            <textarea
                              className="w-full border rounded-lg px-3 py-2 text-sm"
                              rows={3}
                              placeholder="Añadí una nota…"
                              value={note}
                              onChange={(e) => setNote(e.target.value)}
                            />
                            <button
                              className="px-3 py-2 rounded-lg bg-black text-white h-10"
                              onClick={addNote}
                            >
                              Guardar
                            </button>
                          </div>

                          {/* input oculto para adjuntos de la nota */}
                          <input
                            type="file"
                            multiple
                            className="hidden"
                            ref={noteAttachInputRef}
                            onChange={handleNoteAttachmentChange}
                          />

                          {/* Botón para adjuntar documentos a la nota en edición */}
                          <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="px-2 py-1 rounded-lg border text-xs"
                                onClick={() => noteAttachInputRef.current?.click()}
                              >
                                📎 Adjuntar documento a esta nota
                              </button>
                              <span>
                                Los archivos se vincularán a la nota cuando hagas clic en{" "}
                                <b>Guardar</b>.
                              </span>
                            </div>
                          </div>

                          {/* Adjuntos de la nota en edición (todavía sin guardar) */}
                          {notePendingFiles.length > 0 && (
                            <div className="mt-3 border-t pt-3 text-xs">
                              <div className="font-semibold mb-1">
                                Adjuntos para esta nota (sin guardar aún)
                              </div>
                              <ul className="space-y-1">
                                {notePendingFiles.map((f) => (
                                  <li
                                    key={f.id}
                                    className="flex items-center justify-between gap-2"
                                  >
                                    <span className="truncate">
                                      {labelOfFile(f, fileLabels)}
                                    </span>
                                    <div className="flex gap-1">
                                      <a
                                        href={resolveUploadUrl(f.url)}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="underline"
                                      >
                                        Ver
                                      </a>
                                      <button
                                        type="button"
                                        className="text-[11px] px-2 py-0.5 border rounded"
                                        onClick={() => removePendingAttachment(f.id)}
                                      >
                                        Quitar
                                      </button>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

  {/* Listado de notas con sus adjuntos ya vinculados */}
  <div className="mt-4 space-y-2">
    {notesLoading ? (
      <div className="text-sm text-slate-600">
        Cargando notas…
      </div>
    ) : notesList.length ? (
      notesList.map((a) => {
        const author = authorOf(a);
        const when = a.created_at
          ? new Date(a.created_at).toLocaleString()
          : "—";

        const attachIds = (noteAttachmentsMap && noteAttachmentsMap[a.id]) || [];
        const attachFiles = (attachIds || [])
          .map((fid) => fileById[fid])
          .filter(Boolean);

        return (
          <div key={a.id} className="border rounded-xl p-3">
            <div className="text-sm font-medium">
              {a.subject || "Nota"}
            </div>
            <div className="text-xs text-slate-600">
              {when} • por {author}
            </div>
            {a.notes && (
              <div className="text-sm mt-1 whitespace-pre-wrap">
                {a.notes}
              </div>
            )}

            {attachFiles.length > 0 && (
              <div className="mt-2 text-xs text-slate-700">
                <div className="font-semibold mb-1">Adjuntos:</div>
                <ul className="space-y-1">
                  {attachFiles.map((f) => (
                    <li key={f.id}>
                      <a
                        href={resolveUploadUrl(f.url)}
                        target="_blank"
                        rel="noreferrer"
                        className="underline text-blue-600 truncate"
                        title={visibleNameOf(f)}
                      >
                        {labelOfFile(f, fileLabels)}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })
    ) : (
      <div className="text-sm text-slate-500">
        Sin notas todavía.
      </div>
    )}
  </div>
</div>

            </>
          )}
        
        </section>
        {/* ASIDE */}
        <aside className="space-y-4">
          <div className="bg-white rounded-2xl shadow p-4">
            <h3 className="font-medium mb-3">Resumen</h3>
            <div className="text-sm space-y-1">
              <div>
                <span className="text-slate-500">Referencia: </span>
                <span className="font-medium">{deal.reference}</span>
              </div>
              <div>
                <span className="text-slate-500">Descripción: </span>
                <span>{desc || "—"}</span>
              </div>
              <div>
                <span className="text-slate-500">Valor (Profit): </span>
                {profitUSD != null
                  ? `$ ${Number(profitUSD).toLocaleString()}`
                  : "—"}
              </div>
            </div>
          </div>

          {/* Acciones */}
          <div className="bg-white rounded-2xl shadow p-4">
            <h3 className="font-medium mb-2">Acciones</h3>
            <div className="flex flex-col gap-2">
              {FILE_TYPES.map((t) => (
                <input
                  key={`input-${t.key}`}
                  type="file"
                  multiple
                  className="hidden"
                  ref={(el) => (fileInputsRef.current[t.key] = el)}
                  onChange={(e) => handleFileChange(t.key, e)}
                />
              ))}
              <button
                type="button"
                className="px-3 py-2 text-sm rounded-lg border w-full text-center"
                onClick={() => setShowReportPreview(true)}
              >
                📄 Informe de estado (vista previa)
              </button>
              <Link
                to={`/operations/${id}/quote`}
                className="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white text-center hover:opacity-90"
              >
                🧾 Presupuesto (nuevo)
              </Link>
              <button
                className="px-3 py-2 text-sm rounded-lg border"
                onClick={() => openEmailModal("general")}
              >
                Enviar correo
              </button>
              <button
                className="px-3 py-2 text-sm rounded-lg border"
                onClick={() => openEmailModal("flete")}
              >
                Pedir tarifa (flete)
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow p-4">
            <h3 className="font-medium mb-2">Volver</h3>
            <Link to={-1} className="text-sm underline">
              ← Regresar
            </Link>
          </div>
        </aside>
      </div>

      {/* MODAL DE VISTA PREVIA DEL INFORME DE ESTADO */}
      {showReportPreview && (
        <ReportPreview
          open={showReportPreview}
          onClose={() => setShowReportPreview(false)}
          deal={deal}
          cf={cf}
          // onObsChange lo dejamos listo por si después querés usar las OBS en el correo
          // onObsChange={(texto) => { console.log("OBS del informe:", texto); }}
        />
      )}

      {/* MODAL DE VISTA PREVIA DE CORREO */}
      {showEmailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">
                  Vista previa de correo
                </span>
                <select
                  className="text-xs border rounded px-2 py-1"
                  value={emailMode}
                  onChange={(e) => openEmailModal(e.target.value)}
                >
                  <option value="general">Correo general</option>
                  <option value="flete">Pedido de tarifa (flete)</option>
                </select>
              </div>
              <button
                className="text-xs px-2 py-1 rounded hover:bg-slate-100"
                onClick={() => setShowEmailModal(false)}
              >
                ✕ Cerrar
              </button>
            </div>

            {/* Cuerpo */}
            <div className="p-4 space-y-3 overflow-auto text-sm">
              <div className="grid grid-cols-[60px_1fr] items-center gap-2">
                <span className="text-right text-slate-500">Para</span>
                <input
                  className="border rounded px-2 py-1 w-full text-sm"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  placeholder="destinatarios@example.com; otro@proveedor.com"
                />
              </div>
              <div className="grid grid-cols-[60px_1fr] items-center gap-2">
                <span className="text-right text-slate-500">CC</span>
                <input
                  className="border rounded px-2 py-1 w-full text-sm"
                  value={emailCc}
                  onChange={(e) => setEmailCc(e.target.value)}
                  placeholder="opcional"
                />
              </div>
              <div className="grid grid-cols-[60px_1fr] items-center gap-2">
                <span className="text-right text-slate-500">Asunto</span>
                <input
                  className="border rounded px-2 py-1 w-full text-sm"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                />
              </div>
              <div>
                <div className="mb-1 text-slate-500">Mensaje</div>
                <textarea
                  className="border rounded px-2 py-2 w-full font-mono text-xs"
                  rows={12}
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                />
              </div>

              {emailMode === "flete" && (
                <div className="mt-2 border-t pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold">
                      Proveedores (rubro: flete)
                    </span>
                    {providersLoading && (
                      <span className="text-[11px] text-slate-500">
                        Cargando…
                      </span>
                    )}
                  </div>
                  {!providersLoading && !providers.length && (
                    <div className="text-xs text-slate-500">
                      No se encontraron proveedores con rubro FLETE.
                    </div>
                  )}
                  <div className="max-h-40 overflow-auto space-y-1">
                    {providers.map((p) => (
                      <label
                        key={p.id}
                        className="flex items-center gap-2 text-xs border rounded px-2 py-1 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedProviderIds.includes(p.id)}
                          onChange={() => toggleProvider(p)}
                        />
                        <div className="flex flex-col">
                          <span className="font-medium">{p.name}</span>
                          <span className="text-[11px] text-slate-500">
                            {p.email || "Sin email"}
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    Al marcar proveedores, sus emails se agregan al campo{" "}
                    <b>Para</b>.
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t flex items-center justify-between">
              <button
                className="px-3 py-1.5 text-xs rounded-lg border"
                onClick={() => setShowEmailModal(false)}
              >
                Cerrar
              </button>
              <div className="flex gap-2">
                <button
                  className="px-3 py-1.5 text-xs rounded-lg border"
                  onClick={() => {
                    try {
                      navigator.clipboard.writeText(
                        `${emailSubject}\n\n${emailBody}`
                      );
                      alert("Asunto + mensaje copiados al portapapeles.");
                    } catch {
                      alert("No se pudo copiar al portapapeles.");
                    }
                  }}
                >
                  Copiar texto
                </button>
                <button
                  className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white"
                  onClick={handleSendEmailFromModal}
                >
                  Enviar con Outlook / mail
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ======= Subformularios ======= */
function OceanForm({
  f,
  set,
  readOnly,
  editMode,
  getCF,
  setCFLocal,
  markDirty,
  filesByType,
  openFileTabByType,
  fileLabels,
}) {
  const list = Array.isArray(f.containers_json) ? f.containers_json : [];

  const addCntr = () => {
    if (!readOnly)
      set("containers_json", [...list, { cntr_no: "", seal_no: "" }]);
  };

  const setCntr = (i, k, v) => {
    if (!readOnly) {
      const next = [...list];
      next[i] = { ...next[i], [k]: v };
      set("containers_json", next);
    }
  };

  const delCntr = (i) => {
    if (!readOnly) {
      const next = [...list];
      next.splice(i, 1);
      set("containers_json", next);
    }
  };

  const bind = (key) => ({
    value: f[key] || "",
    onChange: (e) => set(key, e.target.value),
    readOnly,
  });

  // === TOMAMOS LOS ARCHIVOS Y RÓTULOS IGUAL QUE EN PESTAÑA "DOCUMENTOS" ===
  const masterFiles = (filesByType && filesByType.doc_master) || [];
  const houseFiles  = (filesByType && filesByType.doc_house) || [];

  const masterFile = masterFiles[0] || null;
  const houseFile  = houseFiles[0] || null;

  const masterLabel =
    masterFile ? labelOfFile(masterFile, fileLabels) : "";
  const houseLabel =
    houseFile ? labelOfFile(houseFile, fileLabels) : "";

  // helpers para abrir la pestaña Documentos en el tipo correcto
  const openMasterTab = () =>
    openFileTabByType && openFileTabByType("doc_master");
  const openHouseTab = () =>
    openFileTabByType && openFileTabByType("doc_house");

  const renderDocBadge = (label, file, onClick) => {
    const text =
      label || (file && file.filename) || "Sin documento";
    const title =
      label && file
        ? `${label} — ${file.filename}`
        : text;

    return (
      <button
        type="button"
        className="w-full text-left text-xs px-2 py-1 border rounded-lg bg-white hover:bg-slate-50 truncate disabled:text-slate-400"
        onClick={onClick}
        disabled={!file}
        title={title}
      >
        {text}
      </button>
    );
  };

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* ===== MBL con término ===== */}
        <div className="flex items-center w-full">
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium text-slate-600 whitespace-nowrap">
              MBL
            </span>
            <select
              className="text-[10px] h-6 px-1 border rounded-md bg-white disabled:bg-slate-100"
              disabled={readOnly}
              value={f.doc_master_term || ""}
              onChange={(e) => set("doc_master_term", e.target.value)}
              title="Término (Prepaid/Collect)"
            >
              <option value="">—</option>
              <option value="Prepaid">Prepaid</option>
              <option value="Collect">Collect</option>
            </select>
          </div>
          <div className="flex-1 ml-2 min-w-[280px]">
            {/* Rótulo + link MBL: toma label/archivo desde deal_files */}
            {renderDocBadge(masterLabel, masterFile, openMasterTab)}
          </div>
        </div>

        {/* ===== HBL con término ===== */}
        <div className="flex items-center w-full">
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium text-slate-600 whitespace-nowrap">
              HBL
            </span>
            <select
              className="text-[10px] h-6 px-1 border rounded-md bg-white disabled:bg-slate-100"
              disabled={readOnly}
              value={f.doc_house_term || ""}
              onChange={(e) => set("doc_house_term", e.target.value)}
              title="Término (Prepaid/Collect)"
            >
              <option value="">—</option>
              <option value="Prepaid">Prepaid</option>
              <option value="Collect">Collect</option>
            </select>
          </div>
          <div className="flex-1 ml-2 min-w-[280px]">
            {/* Rótulo + link HBL: igual que en pestaña Documentos */}
            {renderDocBadge(houseLabel, houseFile, openHouseTab)}
          </div>
        </div>

        <Field label="Naviera">
          <Input {...bind("shipping_line")} />
        </Field>
        <Field label="Puerto Origen">
          <Input {...bind("pol")} />
        </Field>
        <Field label="Transbordo">
          <Input {...bind("transshipment_port")} />
        </Field>
        <Field label="Puerto Destino">
          <Input {...bind("pod")} />
        </Field>
        <Field label="Mercadería">
          <Input {...bind("commodity")} />
        </Field>
        <Field label="Bultos">
          <Input type="number" {...bind("packages")} />
        </Field>
        <Field label="Peso (kg)">
          <Input type="number" {...bind("weight_kg")} />
        </Field>
        <Field label="Volumen (m³)">
          <Input type="number" {...bind("volume_m3")} />
        </Field>
        <Field label="Chg. (kg)">
          <Input type="number" {...bind("chargeable_kg")} />
        </Field>
        <Field label="Tránsito (días)">
          <Input type="number" {...bind("transit_time_days")} />
        </Field>
        <Field label="Free days">
          <Input type="number" {...bind("free_days")} />
        </Field>
        <Field label="Itinerario">
          <Input {...bind("itinerary")} />
        </Field>
        <Field label="Entrega Doc. Naviera">
          <Input type="datetime-local" {...bind("doc_nav_delivery")} />
        </Field>
        <Field label="Entrega Doc. Cliente">
          <Input type="datetime-local" {...bind("doc_client_delivery")} />
        </Field>
        <Field label="Inicio Free">
          <Input type="datetime-local" {...bind("free_start")} />
        </Field>
        <Field label="Fin Free">
          <Input type="datetime-local" {...bind("free_end")} />
        </Field>
        <Field label="ETD">
          <Input type="datetime-local" {...bind("etd")} />
        </Field>
        <Field label="Arribo Transb.">
          <Input type="datetime-local" {...bind("trans_arrival")} />
        </Field>
        <Field label="Salida Transb.">
          <Input type="datetime-local" {...bind("trans_depart")} />
        </Field>
        <Field label="ETA">
          <Input type="datetime-local" {...bind("eta")} />
        </Field>
        <Field label="Observaciones">
          <Input {...bind("observations")} />
        </Field>
      </div>

      <details className="mt-3 bg-white border rounded-xl">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm flex items-center gap-2">
          <b>Contenedores</b>
          <span className="text-xs text-slate-600">({list.length})</span>
          <span className="text-xs text-slate-500 truncate">
            {list.length
              ? list.map((c, i) => c.cntr_no || `CNTR #${i + 1}`).join(" • ")
              : "—"}
          </span>
        </summary>
        <div className="p-3 grid gap-2">
          {list.map((c, i) => (
            <div
              key={i}
              className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-end"
            >
              <Field label="CNTR Nro">
                <Input
                  readOnly={readOnly}
                  value={c.cntr_no || ""}
                  onChange={(e) => setCntr(i, "cntr_no", e.target.value)}
                />
              </Field>
              <Field label="PRECINTO Nro">
                <Input
                  readOnly={readOnly}
                  value={c.seal_no || ""}
                  onChange={(e) => setCntr(i, "seal_no", e.target.value)}
                />
              </Field>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => delCntr(i)}
                  className="px-2 py-2 text-xs rounded border h-9"
                >
                  Eliminar
                </button>
              )}
            </div>
          ))}
          {!readOnly && (
            <button
              type="button"
              onClick={addCntr}
              className="px-3 py-2 text-sm rounded-lg border w-[200px]"
            >
              + Agregar contenedor
            </button>
          )}
        </div>
      </details>
    </div>
  );
}

function RoadForm({
  f,
  set,
  readOnly,
  editMode,
  getCF,
  setCFLocal,
  markDirty,
  filesByType,
  openFileTabByType,
  fileLabels,
}) {
  const trucks = Array.isArray(f.containers_json)
    ? f.containers_json
    : [];

  const addTruck = () => {
    if (readOnly) return;
    set("containers_json", [
      ...trucks,
      { truck_plate: "", trailer_plate: "", seal_no: "" },
    ]);
  };

  const setTruckField = (index, key, value) => {
    if (readOnly) return;
    const next = [...trucks];
    next[index] = { ...next[index], [key]: value };
    set("containers_json", next);
  };

  const removeTruck = (index) => {
    if (readOnly) return;
    const next = [...trucks];
    next.splice(index, 1);
    set("containers_json", next);
  };

  const bind = (key) => ({
    value: f[key] || "",
    onChange: (e) => set(key, e.target.value),
    readOnly,
  });

  return (
    <div className="space-y-4">
      {/* Datos principales */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Empresa (transporte) */}
        <Field label="Empresa (transporte)">
          <Input {...bind("provider_org_id")} />
        </Field>

        {/* MIC/DTA = DOC MASTER (cfKey: doc_master) */}
        <DocTextLink
          label="MIC/DTA"
          cfKey="doc_master"
          editMode={editMode}
          getCF={getCF}
          setCFLocal={setCFLocal}
          markDirty={markDirty}
          filesByType={filesByType}
          openFileTabByType={openFileTabByType}
          fileLabels={fileLabels}
        />

        {/* CRT = DOC HOUSE (cfKey: doc_house) */}
        <DocTextLink
          label="CRT"
          cfKey="doc_house"
          editMode={editMode}
          getCF={getCF}
          setCFLocal={setCFLocal}
          markDirty={markDirty}
          filesByType={filesByType}
          openFileTabByType={openFileTabByType}
          fileLabels={fileLabels}
        />
      </div>

      {/* TODO: a partir de acá dejá tal cual todo lo que ya tenés */}
      {/* Origen / Destino / Cruce frontera */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Origen">
          <Input {...bind("origin_city")} />
        </Field>
        <Field label="Destino">
          <Input {...bind("destination_city")} />
        </Field>
        <Field label="Cruce frontera">
          <Input {...bind("border_crossing")} />
        </Field>
      </div>

      {/* ... resto de RoadForm igual como lo tenías ... */}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Origen">
          <Input {...bind("origin_city")} />
        </Field>
        <Field label="Destino">
          <Input {...bind("destination_city")} />
        </Field>
        <Field label="Cruce frontera">
          <Input {...bind("border_crossing")} />
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Chofer">
          <Input {...bind("driver_name")} />
        </Field>
        <Field label="Tel. chofer">
          <Input {...bind("driver_phone")} />
        </Field>
        <Field label="Clase de carga">
          <Input {...bind("cargo_class")} />
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Mercadería">
          <Input {...bind("commodity")} />
        </Field>
        <Field label="Bultos">
          <Input type="number" {...bind("packages")} />
        </Field>
        <Field label="Peso (kg)">
          <Input type="number" {...bind("weight_kg")} />
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Volumen (m³)">
          <Input type="number" {...bind("volume_m3")} />
        </Field>
        <Field label="Precinto general">
          <Input {...bind("seal_no")} />
        </Field>
        <Field label="Itinerario / ruta">
          <Input {...bind("route_itinerary")} />
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="ETD">
          <Input type="datetime-local" {...bind("etd")} />
        </Field>
        <Field label="ETA">
          <Input type="datetime-local" {...bind("eta")} />
        </Field>
        <Field label="Días de tránsito">
          <Input type="number" {...bind("transit_days")} />
        </Field>
      </div>

      {/* Camiones / unidades (similar a contenedores) */}
      <div className="border-t pt-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium">
            Camiones / unidades
          </h4>
          {!readOnly && (
            <button
              type="button"
              className="px-2 py-1 text-xs rounded border"
              onClick={addTruck}
            >
              + Agregar camión
            </button>
          )}
        </div>

        {trucks.length ? (
          <div className="space-y-2">
            {trucks.map((t, index) => (
              <div
                key={index}
                className="border rounded-xl p-2 grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end"
              >
                <div>
                  <div className="text-[11px] text-slate-600 mb-1">
                    Placa camión
                  </div>
                  <Input
                    readOnly={readOnly}
                    value={t.truck_plate || t.cntr_no || ""}
                    onChange={(e) =>
                      setTruckField(
                        index,
                        "truck_plate",
                        e.target.value
                      )
                    }
                  />
                </div>
                <div>
                  <div className="text-[11px] text-slate-600 mb-1">
                    Placa remolque
                  </div>
                  <Input
                    readOnly={readOnly}
                    value={t.trailer_plate || ""}
                    onChange={(e) =>
                      setTruckField(
                        index,
                        "trailer_plate",
                        e.target.value
                      )
                    }
                  />
                </div>
                <div>
                  <div className="text-[11px] text-slate-600 mb-1">
                    Precinto remolque
                  </div>
                  <Input
                    readOnly={readOnly}
                    value={t.seal_no || ""}
                    onChange={(e) =>
                      setTruckField(
                        index,
                        "seal_no",
                        e.target.value
                      )
                    }
                  />
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    className="text-[11px] px-2 py-1 border rounded"
                    onClick={() => removeTruck(index)}
                  >
                    Quitar
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-slate-500">
            {readOnly
              ? "Sin camiones cargados."
              : 'Agregá camiones con el botón "Agregar camión".'}
          </div>
        )}
      </div>

      {/* Observaciones */}
      <div>
        <Field label="Observaciones">
          <Input {...bind("observations")} />
        </Field>
      </div>
    </div>
  );
}

function MultimodalForm({
  f,
  set,
  readOnly,
  editMode,
  getCF,
  setCFLocal,
  markDirty,
  filesByType,
  openFileTabByType,
  fileLabels,
}) {
  const list = Array.isArray(f.containers_json) ? f.containers_json : [];

  const addCntr = () => {
    if (!readOnly)
      set("containers_json", [...list, { cntr_no: "", seal_no: "" }]);
  };

  const setCntr = (i, k, v) => {
    if (!readOnly) {
      const next = [...list];
      next[i] = { ...next[i], [k]: v };
      set("containers_json", next);
    }
  };

  const delCntr = (i) => {
    if (!readOnly) {
      const next = [...list];
      next.splice(i, 1);
      set("containers_json", next);
    }
  };

  const addLeg = () => {
    const leg_no = (f.legs?.length || 0) + 1;
    set("legs", [
      ...(f.legs || []),
      {
        leg_no,
        mode: "OCEAN",
        carrier: "",
        origin: "",
        destination: "",
        ref_doc: "",
        etd: "",
        eta: "",
        weight_kg: "",
        volume_m3: "",
        packages: "",
      },
    ]);
  };

  const setLeg = (i, k, v) => {
    const arr = [...(f.legs || [])];
    arr[i] = { ...arr[i], [k]: v };
    set("legs", arr);
  };

  const delLeg = (i) => {
    const a = [...(f.legs || [])];
    a.splice(i, 1);
    a.forEach((L, idx) => (L.leg_no = idx + 1));
    set("legs", a);
  };

  const bind = (key) => ({
    value: f[key] || "",
    onChange: (e) => set(key, e.target.value),
    readOnly,
  });

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* ===== DOC MASTER con término ===== */}
        <div className="flex items-center w-full">
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium text-slate-600 whitespace-nowrap">
              DOC MASTER
            </span>
            <select
              className="text-[10px] h-6 px-1 border rounded-md bg-white disabled:bg-slate-100"
              disabled={readOnly}
              value={f.doc_master_term || ""}
              onChange={(e) => set("doc_master_term", e.target.value)}
              title="Término (Prepaid/Collect)"
            >
              <option value="">—</option>
              <option value="Prepaid">Prepaid</option>
              <option value="Collect">Collect</option>
            </select>
          </div>
          <div className="flex-1 ml-2 min-w-[280px]">
            <DocTextLink
              label=""
              cfKey="doc_master"
              editMode={editMode}
              getCF={getCF}
              setCFLocal={setCFLocal}
              markDirty={markDirty}
              filesByType={filesByType}
              openFileTabByType={openFileTabByType}
              fileLabels={fileLabels}
            />
          </div>
        </div>

        {/* ===== DOC HOUSE con término ===== */}
        <div className="flex items-center w-full">
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium text-slate-600 whitespace-nowrap">
              DOC HOUSE
            </span>
            <select
              className="text-[10px] h-6 px-1 border rounded-md bg-white disabled:bg-slate-100"
              disabled={readOnly}
              value={f.doc_house_term || ""}
              onChange={(e) => set("doc_house_term", e.target.value)}
              title="Término (Prepaid/Collect)"
            >
              <option value="">—</option>
              <option value="Prepaid">Prepaid</option>
              <option value="Collect">Collect</option>
            </select>
          </div>
          <div className="flex-1 ml-2 min-w-[280px]">
            <DocTextLink
              label=""
              cfKey="doc_house"
              editMode={editMode}
              getCF={getCF}
              setCFLocal={setCFLocal}
              markDirty={markDirty}
              filesByType={filesByType}
              openFileTabByType={openFileTabByType}
              fileLabels={fileLabels}
            />
          </div>
        </div>

        {/* CRT también como documento con link */}
        <Field label="CRT">
          <DocTextLink
            label=""
            cfKey="crt_number"
            editMode={editMode}
            getCF={getCF}
            setCFLocal={setCFLocal}
            markDirty={markDirty}
            filesByType={filesByType}
            openFileTabByType={openFileTabByType}
            fileLabels={fileLabels}
          />
        </Field>

        <Field label="Naviera / Carrier">
          <Input {...bind("shipping_line")} />
        </Field>
        <Field label="Itinerario">
          <Input {...bind("itinerary")} />
        </Field>
        <Field label="Free days">
          <Input type="number" {...bind("free_days")} />
        </Field>
      </div>

      <details className="mt-3 bg-white border rounded-xl" open>
        <summary className="cursor-pointer select-none px-3 py-2 text-sm flex items-center gap-2">
          <b>Tramos</b>
          <span className="text-xs text-slate-600">
            {(f.legs || []).length}
          </span>
        </summary>
        <div className="p-3 grid gap-2">
          {(f.legs || []).map((L, i) => (
            <div key={i} className="border rounded-xl p-3">
              <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
                <Field label="N°">
                  <Input readOnly value={L.leg_no} />
                </Field>
                <Field label="Modo">
                  <Select
                    readOnly={readOnly}
                    value={L.mode || "OCEAN"}
                    onChange={(e) => setLeg(i, "mode", e.target.value)}
                  >
                    <option value="AIR">AIR</option>
                    <option value="OCEAN">OCEAN</option>
                    <option value="ROAD">ROAD</option>
                  </Select>
                </Field>
                <Field label="Carrier">
                  <Input
                    readOnly={readOnly}
                    value={L.carrier || ""}
                    onChange={(e) => setLeg(i, "carrier", e.target.value)}
                  />
                </Field>
                <Field label="Origen">
                  <Input
                    readOnly={readOnly}
                    value={L.origin || ""}
                    onChange={(e) => setLeg(i, "origin", e.target.value)}
                  />
                </Field>
                <Field label="Destino">
                  <Input
                    readOnly={readOnly}
                    value={L.destination || ""}
                    onChange={(e) => setLeg(i, "destination", e.target.value)}
                  />
                </Field>
                <Field label="Ref. Doc">
                  <Input
                    readOnly={readOnly}
                    value={L.ref_doc || ""}
                    onChange={(e) => setLeg(i, "ref_doc", e.target.value)}
                  />
                </Field>
                <Field label="ETD">
                  <Input
                    readOnly={readOnly}
                    type="datetime-local"
                    value={toLocal(L.etd)}
                    onChange={(e) => setLeg(i, "etd", e.target.value)}
                  />
                </Field>
                <Field label="ETA">
                  <Input
                    readOnly={readOnly}
                    type="datetime-local"
                    value={toLocal(L.eta)}
                    onChange={(e) => setLeg(i, "eta", e.target.value)}
                  />
                </Field>
                <Field label="Peso (kg)">
                  <Input
                    readOnly={readOnly}
                    type="number"
                    value={L.weight_kg || ""}
                    onChange={(e) => setLeg(i, "weight_kg", e.target.value)}
                  />
                </Field>
                <Field label="Volumen (m³)">
                  <Input
                    readOnly={readOnly}
                    type="number"
                    value={L.volume_m3 || ""}
                    onChange={(e) => setLeg(i, "volume_m3", e.target.value)}
                  />
                </Field>
                <Field label="Bultos">
                  <Input
                    readOnly={readOnly}
                    type="number"
                    value={L.packages || ""}
                    onChange={(e) => setLeg(i, "packages", e.target.value)}
                  />
                </Field>
              </div>
              {!readOnly && (
                <div className="mt-2 text-right">
                  <button
                    onClick={() => delLeg(i)}
                    className="px-2 py-1 text-xs rounded border"
                  >
                    Eliminar tramo
                  </button>
                </div>
              )}
            </div>
          ))}
          {!readOnly && (
            <button
              onClick={addLeg}
              className="px-3 py-2 text-sm rounded-lg border w-[180px]"
            >
              + Agregar tramo
            </button>
          )}
        </div>
      </details>

      <div className="mt-3">
        <Field label="Observaciones">
          <Input {...bind("observations")} />
        </Field>
      </div>
    </div>
  );
}

function AirForm({
  f,
  set,
  readOnly,
  editMode,
  getCF,
  setCFLocal,
  markDirty,
  filesByType,
  openFileTabByType,
  fileLabels,
}) {
  const setVolAndChg = (rawVol) => {
    const v = Number(String(rawVol).toString().replace(",", "."));
    if (isNaN(v) || !isFinite(v)) {
      set("volume_m3", "");
      set("weight_chargeable_kg", "");
      return;
    }
    const vFixed = Number(v.toFixed(3));
    const chg = Number((vFixed * AIR_CHARGE_FACTOR).toFixed(3));
    set("volume_m3", vFixed);
    set("weight_chargeable_kg", chg);
  };

  const onDimensionsChange = (txt) => {
    set("dimensions_text", txt);
    const vol = parseDimensionsToM3(txt);
    if (vol != null) setVolAndChg(vol);
  };

  const onVolumeChange = (val) => {
    set("volume_m3", val);
    setVolAndChg(val);
  };

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* ===== DOC MASTER ===== */}
        <div className="flex items-center w-full">
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium text-slate-600 whitespace-nowrap">
              DOC MASTER
            </span>
            <select
              className="text-[10px] h-6 px-1 border rounded-md bg-white disabled:bg-slate-100"
              disabled={readOnly}
              value={f.doc_master_term || ""}
              onChange={(e) => set("doc_master_term", e.target.value)}
            >
              <option value="">—</option>
              <option value="Prepaid">Prepaid</option>
              <option value="Collect">Collect</option>
            </select>
          </div>
          <div className="flex-1 ml-2 min-w-[280px]">
            <DocTextLink
              label=""
              cfKey="doc_master"
              editMode={editMode}
              getCF={getCF}
              setCFLocal={setCFLocal}
              markDirty={markDirty}
              filesByType={filesByType}
              openFileTabByType={openFileTabByType}
              fileLabels={fileLabels}
            />
          </div>
        </div>

        {/* ===== DOC HOUSE ===== */}
        <div className="flex items-center w-full">
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium text-slate-600 whitespace-nowrap">
              DOC HOUSE
            </span>
            <select
              className="text-[10px] h-6 px-1 border rounded-md bg-white disabled:bg-slate-100"
              disabled={readOnly}
              value={f.doc_house_term || ""}
              onChange={(e) => set("doc_house_term", e.target.value)}
            >
              <option value="">—</option>
              <option value="Prepaid">Prepaid</option>
              <option value="Collect">Collect</option>
            </select>
          </div>
          <div className="flex-1 ml-2 min-w-[280px]">
            <DocTextLink
              label=""
              cfKey="doc_house"
              editMode={editMode}
              getCF={getCF}
              setCFLocal={setCFLocal}
              markDirty={markDirty}
              filesByType={filesByType}
              openFileTabByType={openFileTabByType}
              fileLabels={fileLabels}
            />
          </div>
        </div>

        {/* Línea aérea */}
        <Field label="Línea aérea">
          <Input
            readOnly={readOnly}
            value={f.airline || ""}
            onChange={(e) => set("airline", e.target.value)}
          />
        </Field>

        {/* FACTURA – PACKING LIST – CERTIFICADO DE ORIGEN */}
        <DocTextLink
          label="FACTURA"
          cfKey="factura"
          editMode={editMode}
          getCF={getCF}
          setCFLocal={setCFLocal}
          markDirty={markDirty}
          filesByType={filesByType}
          openFileTabByType={openFileTabByType}
          fileLabels={fileLabels}
        />
        <DocTextLink
          label="PACKING LIST"
          cfKey="packing_list"
          editMode={editMode}
          getCF={getCF}
          setCFLocal={setCFLocal}
          markDirty={markDirty}
          filesByType={filesByType}
          openFileTabByType={openFileTabByType}
          fileLabels={fileLabels}
        />
        <DocTextLink
          label="CERTIFICADO DE ORIGEN"
          cfKey="certificado_origen"
          editMode={editMode}
          getCF={getCF}
          setCFLocal={setCFLocal}
          markDirty={markDirty}
          filesByType={filesByType}
          openFileTabByType={openFileTabByType}
          fileLabels={fileLabels}
        />

        {/* Resto de campos */}
        <Field label="Agente">
          <Input
            readOnly={readOnly}
            value={f.agent || ""}
            onChange={(e) => set("agent", e.target.value)}
          />
        </Field>
        <Field label="Ag. Aduanera">
          <Input
            readOnly={readOnly}
            value={f.customs_broker || ""}
            onChange={(e) => set("customs_broker", e.target.value)}
          />
        </Field>
        <Field label="Proveedor">
          <Input
            readOnly={readOnly}
            value={f.provider || ""}
            onChange={(e) => set("provider", e.target.value)}
          />
        </Field>

        <div className="md:col-span-3">
          <Field label="SHPR / CNEE">
            <Input
              readOnly={readOnly}
              placeholder=""
              value={f.shpr_cnee || ""}
              onChange={(e) => set("shpr_cnee", e.target.value)}
            />
          </Field>
        </div>

        <Field label="Origen (AP)">
          <Input
            readOnly={readOnly}
            value={f.origin_airport || ""}
            onChange={(e) => set("origin_airport", e.target.value)}
          />
        </Field>
        <Field label="Transbordo (AP)">
          <Input
            readOnly={readOnly}
            value={f.transshipment_airport || ""}
            onChange={(e) => set("transshipment_airport", e.target.value)}
          />
        </Field>
        <Field label="Destino (AP)">
          <Input
            readOnly={readOnly}
            value={f.destination_airport || ""}
            onChange={(e) => set("destination_airport", e.target.value)}
          />
        </Field>

        <Field label="Mercadería">
          <Input
            readOnly={readOnly}
            value={f.commodity || ""}
            onChange={(e) => set("commodity", e.target.value)}
          />
        </Field>
        <Field label="Bultos">
          <Input
            readOnly={readOnly}
            type="number"
            value={f.packages || ""}
            onChange={(e) => set("packages", e.target.value)}
          />
        </Field>
        <Field label="P. Bruto (kg)">
          <Input
            readOnly={readOnly}
            type="number"
            value={f.weight_gross_kg || ""}
            onChange={(e) => set("weight_gross_kg", e.target.value)}
          />
        </Field>

        <Field label="Volumen (m³)">
          <Input
            readOnly={readOnly}
            type="number"
            step="0.001"
            value={f.volume_m3 || ""}
            onChange={(e) => onVolumeChange(e.target.value)}
          />
        </Field>
        <Field label="P. Vol/Chg (kg)">
          <Input
            readOnly
            type="number"
            value={f.weight_chargeable_kg || ""}
            title="Se calcula como Volumen × 167"
          />
        </Field>
        <Field label="Dimensiones">
          <Input
            readOnly={readOnly}
            placeholder={"Ej: 1.2x0.8x0.6x2\n0.9x0.7x0.5"}
            value={f.dimensions_text || ""}
            onChange={(e) => onDimensionsChange(e.target.value)}
          />
        </Field>

        <Field label="ETD">
          <Input
            readOnly={readOnly}
            type="datetime-local"
            value={f.etd || ""}
            onChange={(e) => set("etd", e.target.value)}
          />
        </Field>
        <Field label="Arribo Transb.">
          <Input
            readOnly={readOnly}
            type="datetime-local"
            value={f.trans_arrival || ""}
            onChange={(e) => set("trans_arrival", e.target.value)}
          />
        </Field>
        <Field label="Salida Transb.">
          <Input
            readOnly={readOnly}
            type="datetime-local"
            value={f.trans_depart || ""}
            onChange={(e) => set("trans_depart", e.target.value)}
          />
        </Field>
        <Field label="ETA">
          <Input
            readOnly={readOnly}
            type="datetime-local"
            value={f.eta || ""}
            onChange={(e) => set("eta", e.target.value)}
          />
        </Field>
        <Field label="Días tránsito">
          <Input
            readOnly={readOnly}
            type="number"
            value={f.transit_days || ""}
            onChange={(e) => set("transit_days", e.target.value)}
          />
        </Field>

        <Field label="Flete pago">
          <Select
            readOnly={readOnly}
            value={f.flete_pago || ""}
            onChange={(e) => set("flete_pago", e.target.value)}
          >
            <option value="">—</option>
            <option value="CONTADO">CONTADO</option>
            <option value="CREDITO">CREDITO</option>
          </Select>
        </Field>
        <Field label="Gastos locales pago">
          <Select
            readOnly={readOnly}
            value={f.gastos_locales_pago || ""}
            onChange={(e) => set("gastos_locales_pago", e.target.value)}
          >
            <option value="">—</option>
            <option value="CONTADO">CONTADO</option>
            <option value="CREDITO">CREDITO</option>
          </Select>
        </Field>

        <Field label="Observaciones">
          <Input
            readOnly={readOnly}
            value={f.observations || ""}
            onChange={(e) => set("observations", e.target.value)}
          />
        </Field>
      </div>
    </div>
  );
}
