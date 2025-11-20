// client/src/pages/OperationDetailIndustrial.jsx
import React, {
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import DetCosSheet from "./DetCosSheet";
import ReportPreview from "../components/op-details/ReportPreview";
import IndustrialDoorList from "../components/op-details/IndustrialDoorList";
import { generateQuoteEmail } from "../utils/generateQuoteEmail";
/* ---------- helpers ---------- */

// nombre visible actual de un file (fallback si no hay rótulo)
function visibleNameOf(f) {
  return f.display_name || f.custom_name || f.filename || "archivo";
}

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
    className={`border rounded-lg px-2 py-1 text-sm w-full focus:outline-none ${readOnly
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
    className={`border rounded-lg px-2 py-1 text-sm w-full bg-white focus:outline-none ${readOnly
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

// Label de documento según tipo y modalidad (para Industrial igual nos sirve)
const docLabelFor = (type, mode) => {
  const base =
    FILE_TYPES.find((t) => t.key === type)?.label || "Documento";

  if (type === "doc_master") {
    if (mode === "AIR") return "DOC MASTER";
    if (mode === "OCEAN") return "MBL";
    if (mode === "ROAD") return "MIC/DTA";
    if (mode === "MULTIMODAL") return "DOC MASTER";
  }
  if (type === "doc_house") {
    if (mode === "AIR") return "DOC HOUSE";
    if (mode === "OCEAN") return "HBL";
    if (mode === "ROAD") return "CRT";
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

/* ---------- usuarios ---------- */
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
  } catch {
    // ignore
  }
  return { id: null, name: null, email: null };
}

/* ====== Proveedores y correo (mismo motor que operación normal) ====== */

const PROVIDERS_ENDPOINT = "/organizations";

function providerHasFreightTag(p = {}) {
  const parts = [];
  if (p.category) parts.push(p.category);
  if (p.rubro) parts.push(p.rubro);
  if (p.segment) parts.push(p.segment);
  if (p.type) parts.push(p.type);
  if (Array.isArray(p.tags)) parts.push(...p.tags);
  if (typeof p.tags_text === "string") parts.push(p.tags_text);

  const txt = parts.join(" ").toString().toLowerCase();
  return txt.includes("flete");
}

/* =================== PÁGINA INDUSTRIAL =================== */

export default function OperationDetailIndustrial() {
  const { id } = useParams();

  const [loading, setLoading] = useState(true);
  const [deal, setDeal] = useState(null);

  const [desc, setDesc] = useState("");
  const [cf, setCf] = useState({});
  const [cfSupported, setCfSupported] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [dirtyCF, setDirtyCF] = useState(new Set());

  const [profitUSD, setProfitUSD] = useState(null);

  const [filesByType, setFilesByType] = useState({});
  const [fileLabels, setFileLabels] = useState({});
  const [filesRefreshKey, setFilesRefreshKey] = useState(0);
  const fileInputsRef = useRef({});

  const [activeTab, setActiveTab] = useState("detalle");
  const [uploadingFiles, setUploadingFiles] = useState([]);

  const [notesList, setNotesList] = useState([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [note, setNote] = useState("");
  const [noteAttachmentsMap, setNoteAttachmentsMap] = useState({});
  const [notePendingFiles, setNotePendingFiles] = useState([]);
  const noteAttachInputRef = useRef(null);

  const [paramMap, setParamMap] = useState({
    tipo_operacion: [],
    modalidad_carga: [],
    tipo_carga: [],
    incoterm: [],
  });

  const [generatingReport, setGeneratingReport] = useState(false);
  const [showReportPreview, setShowReportPreview] = useState(false);

  // correo
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailMode, setEmailMode] = useState("general");
  const [emailTo, setEmailTo] = useState("");
  const [emailCc, setEmailCc] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [providers, setProviders] = useState([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [selectedProviderIds, setSelectedProviderIds] = useState([]);

  /* ---------- CF helpers ---------- */

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

  async function upsertCF(key, label, type, value) {
    const sid = Number(id);

    const safeValue =
      value !== null && typeof value === "object"
        ? JSON.stringify(value)
        : String(value ?? "");

    const safeType = type === "json" ? "text" : type || "text";
    const row = cf[key];

    const putById = async (cfId) => {
      await api.put(`/deals/${sid}/custom-fields/${cfId}`, {
        value: safeValue,
      });
      setCFLocal(key, { id: cfId, value: safeValue });
      return true;
    };

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
    } catch (e) {
      console.warn(
        `[CF POST create] falló (${key})`,
        e?.response?.data || e.message
      );
      throw e;
    }
  }

  /* ---------- carga de datos ---------- */

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
      const [{ data: detail }, cfRes] = await Promise.all([
        api.get(`/deals/${id}`),
        api.get(`/deals/${id}/custom-fields`).catch(() => ({
          data: null,
        })),
      ]);

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

      // rótulos de archivos
      try {
        const parsed = JSON.parse(cfVal("file_labels_json") || "{}");
        if (parsed && typeof parsed === "object") setFileLabels(parsed);
      } catch {
        setFileLabels({});
      }

      // mapa de adjuntos por nota
      try {
        const parsedNA = JSON.parse(
          cfVal("note_attachments_json") || "{}"
        );
        if (parsedNA && typeof parsedNA === "object") {
          setNoteAttachmentsMap(parsedNA);
        } else {
          setNoteAttachmentsMap({});
        }
      } catch {
        setNoteAttachmentsMap({});
      }

      // profit desde cost sheet
      let profit = null;
      try {
        const csResp = await api
          .get(`/deals/${id}/cost-sheet`)
          .then((r) => r.data)
          .catch(() => null);
        profit = computeProfitFromCostSheet(csResp);
      } catch {
        // ignore
      }
      setProfitUSD(profit);

      try {
        if (profit != null) {
          const curVal = Number(detail.deal?.value ?? 0);
          if (Math.abs(curVal - profit) > 0.01) {
            await api.patch(`/deals/${id}`, { value: profit });
            setDeal((d) => (d ? { ...d, value: profit } : d));
          }
        }
      } catch {
        // ignore
      }

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

  /* ---------- guardar ---------- */

  async function saveAll() {
    try {
      await api.patch(`/deals/${id}`, {
        description: desc || null,
        value:
          profitUSD != null ? profitUSD : Number(deal?.value || 0),
      });

      if (cfSupported) {
        const saves = [];

        dirtyCF.forEach((key) => {
          const row = cf[key];
          if (!row) return;
          saves.push(
            upsertCF(
              key,
              row.label || key,
              row.type || "text",
              row.value
            ).catch((e) => {
              const msg =
                e?.response?.data ||
                e?.message ||
                "Error desconocido";
              console.warn(`[CF] Falló guardar "${key}":`, msg);
            })
          );
        });

        saves.push(
          upsertCF(
            "file_labels_json",
            "Rótulos de archivos",
            "json",
            fileLabels || {}
          ).catch((e) => {
            const msg =
              e?.response?.data ||
              e?.message ||
              "Error desconocido";
            console.warn(
              `[CF] Falló guardar "file_labels_json":`,
              msg
            );
          })
        );

        await Promise.all(saves);
      } else {
        console.warn(
          "[saveAll] cfSupported=false: omito guardado de custom fields"
        );
      }

      setEditMode(false);
      setDirtyCF(new Set());
      await reload();
      alert("Cambios guardados.");
    } catch (e) {
      console.error("[saveAll] error", e);
      alert(
        "No se pudieron guardar los cambios. Revisá la consola para más detalles."
      );
    }
  }

  async function cancelEdit() {
    setEditMode(false);
    setDirtyCF(new Set());
    await reload();
  }

  /* ---------- archivos ---------- */

  async function removeFile(fileId) {
    if (!editMode) return;
    if (!window.confirm("¿Eliminar archivo?")) return;
    try {
      await api.delete(`/deals/${id}/files/${fileId}`);
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
      prev.map((u) =>
        u.tempId === tempId ? { ...u, progress } : u
      )
    );
  };

  const popUploading = (tempId) => {
    setUploadingFiles((prev) =>
      prev.filter((u) => u.tempId !== tempId)
    );
  };

  function triggerUpload(type) {
    if (!fileInputsRef.current[type]) return;
    fileInputsRef.current[type].click();
  }

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
        const { data: info } = await api.post(
          `/deals/${id}/files`,
          form,
          {
            headers: { "Content-Type": "multipart/form-data" },
            onUploadProgress: (ev) => {
              if (ev.total) {
                const p = Math.round(
                  (ev.loaded / ev.total) * 100
                );
                setUploadingProgress(tempId, p);
              }
            },
          }
        );
        popUploading(tempId);
        await loadFiles();

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

  // para docLabelFor en pestañas de archivo
  const dealTT = String(deal?.transport_type || "").toUpperCase();
  const cfTTraw = String(getCF("modalidad_carga") || "").toUpperCase();
  const mapCF2TT = {
    AEREO: "AIR",
    MARITIMO: "OCEAN",
    TERRESTRE: "ROAD",
    MULTIMODAL: "MULTIMODAL",
  };
  const currentTT = ["AIR", "OCEAN", "ROAD", "MULTIMODAL"].includes(
    dealTT
  )
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
    {
      id: "detcos",
      kind: "base",
      label: "Planilla de costos (DET COS)",
    },
    ...flatUploadingTabs,
    ...flatFileTabs,
  ];

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

  /* ---------- opciones de selects ---------- */

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

  /* ---------- datos de organización ---------- */

  const orgRuc =
    deal?.org_ruc || getCF("org_ruc") || getCF("ruc") || "";
  const orgAddress =
    deal?.org_address ||
    getCF("org_address") ||
    getCF("address") ||
    "";
  const orgPhone =
    deal?.org_phone || getCF("org_phone") || getCF("phone") || "";
  const orgEmail =
    deal?.org_email || getCF("org_email") || getCF("email") || "";

  /* ---------- pipeline / ejecutivo ---------- */

  const rawStage =
    deal?.stage_name ||
    deal?.stage?.name ||
    deal?.status_ops ||
    getCF("estado") ||
    "Sin etapa";

  const pipelineState = String(rawStage);

  const executiveName =
    deal?.deal_advisor_name ||
    deal?.advisor_user_name ||
    deal?.advisor_name ||
    "—";

  /* ---------- header label / subject ---------- */

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

  const emailSubjectBase = `Solicitud - ${deal?.reference || id
    }${headerLabel ? ` · ${headerLabel}` : ""}`;

  /* ---------- notas ---------- */

  async function addNote() {
    const txt = (note || "").trim();
    if (!txt) return;

    const me = getCurrentUserFromStorage();
    const tempId = `tmp-${Date.now()}`;
    const nowIso = new Date().toISOString();

    const attachedIds = (notePendingFiles || [])
      .map((f) => f.id)
      .filter(Boolean);

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

    setNote("");

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
        const nextMap = {
          ...(noteAttachmentsMap || {}),
          [activityId]: attachedIds,
        };

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

        setNoteAttachmentsMap(nextMap);
      }

      setNotePendingFiles([]);
      await loadNotes();
    } catch (err) {
      console.error("No se pudo crear la nota", err);
      setNotesList((prev) => prev.filter((x) => x.id !== tempId));
      alert("No se pudo crear la nota.");
    }
  }

  async function handleNoteAttachmentChange(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;

    for (const file of files) {
      try {
        const form = new FormData();
        form.append("type", "note_attachment");
        form.append("file", file);

        const { data: info } = await api.post(
          `/deals/${id}/files`,
          form,
          {
            headers: { "Content-Type": "multipart/form-data" },
          }
        );

        if (info) {
          setNotePendingFiles((prev) => [...prev, info]);
        }
      } catch (err) {
        console.error("No se pudo subir adjunto de nota", err);
        alert(`No se pudo subir el archivo "${file.name}".`);
      }
    }

    await loadFiles();
  }

  async function removePendingAttachment(fileId) {
    setNotePendingFiles((prev) =>
      prev.filter((f) => f.id !== fileId)
    );
    try {
      await api.delete(`/deals/${id}/files/${fileId}`);
      await loadFiles();
    } catch (err) {
      console.warn("No se pudo eliminar adjunto de nota", err);
    }
  }

  /* ---------- informe PDF ---------- */

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
        downloadBlob(
          blob,
          `informe-estado-${deal?.reference || id}.pdf`
        );
        return;
      } catch { }
      try {
        const { data } = await api.get(`/reports/status/${id}`, {
          responseType: "blob",
        });
        const blob = new Blob([data], { type: "application/pdf" });
        downloadBlob(
          blob,
          `informe-estado-${deal?.reference || id}.pdf`
        );
        return;
      } catch { }
      try {
        const { data } = await api.get(`/reports/status`, {
          params: { deal_id: id },
          responseType: "blob",
        });
        const blob = new Blob([data], { type: "application/pdf" });
        downloadBlob(
          blob,
          `informe-estado-${deal?.reference || id}.pdf`
        );
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

  /* ---------- pestañas Archivo ---------- */

  function openFileTabByType(type) {
    const list = filesByType[type] || [];
    if (!list.length) return false;
    const f = list[0];
    setActiveTab(`f-${f.id}`);
    return true;
  }

  /* ---------- opciones/email proveedores ---------- */

  async function loadFreightProviders() {
    if (!PROVIDERS_ENDPOINT) {
      setProviders([]);
      return;
    }

    try {
      setProvidersLoading(true);

      const { data } = await api
        .get(PROVIDERS_ENDPOINT)
        .catch((err) => {
          if (err?.response?.status === 404) {
            console.warn(
              `[loadFreightProviders] La ruta "${PROVIDERS_ENDPOINT}" no existe en el backend (404).`
            );
            return { data: [] };
          }
          throw err;
        });

      const list = Array.isArray(data) ? data : [];
      const onlyFreight = list.filter(providerHasFreightTag);
      setProviders(onlyFreight.length ? onlyFreight : list);
    } catch (e) {
      console.warn(
        "No se pudieron cargar proveedores de flete",
        e
      );
      setProviders([]);
    } finally {
      setProvidersLoading(false);
    }
  }

  function buildFreightRequestTemplate() {
    const tipoOpV = getCF("tipo_operacion") || "—";
    const modalidadV =
      getCF("modalidad_carga") || currentTT || "—";
    const incotermV = getCF("incoterm") || "—";
    const origenV = getCF("origen_pto") || "—";
    const destinoV = getCF("destino_pto") || "—";
    const mercaV = getCF("mercaderia") || "—";

    const bultos = getCF("cant_bultos") || "—";
    const peso = getCF("peso_bruto") || "—";
    const volumen = getCF("vol_m3") || "—";

    const me = getCurrentUserFromStorage();
    const subj = emailSubjectBase;

    const body =
      `Estimados,\n\n` +
      `Solicitamos su mejor tarifa de flete para la siguiente operación industrial:\n\n` +
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
      `• Condiciones de servicio / instalación\n` +
      `• Condiciones de pago\n\n` +
      `Referencia interna: ${deal.reference || id}\n\n` +
      `Saludos,\n` +
      `${me.name || ""}`;

    setEmailSubject(subj);
    setEmailBody(body);
  }

  function openEmailModal(mode = "general") {
    const me = getCurrentUserFromStorage();
    const defaultTo =
      (deal?.contact_email &&
        String(deal.contact_email).trim()) ||
      (orgEmail && String(orgEmail).trim()) ||
      "";

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
        `Te escribo respecto a la operación industrial ${deal?.reference || ""
        }.\n\n` +
        `Saludos.\n` +
        `${me.name || ""}`;
      setEmailSubject(emailSubjectBase);
      setEmailBody(body);
    }

    setShowEmailModal(true);
  }

  function toggleProvider(provider) {
    setSelectedProviderIds((prev) => {
      const exists = prev.includes(provider.id);
      const next = exists
        ? prev.filter((id) => id !== provider.id)
        : [...prev, provider.id];

      const selected = providers.filter((p) =>
        next.includes(p.id)
      );
      const emailsFromProviders = selected
        .map((p) => p.email)
        .filter(Boolean);

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
      `mailto:${encodeURIComponent(emailTo)}` +
      `?${params.join("&")}`;

    window.location.href = mailtoUrl;
  }

  if (loading)
    return (
      <p className="text-sm text-slate-600">Cargando…</p>
    );
  if (!deal)
    return (
      <p className="text-sm text-slate-600">
        Operación industrial no encontrada.
      </p>
    );

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

  const setCFAndDirty = (key, label, value) => {
    setCFLocal(key, { label, type: "text", value });
    markDirty(key);
  };

  return (
    <div className="space-y-4">
      {/* ENCABEZADO */}
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <div className="text-xs text-slate-500">
              VISTA DE OPERACIÓN INDUSTRIAL
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              <div className="text-2xl font-bold">
                {deal.reference}
              </div>
              <div className="text-2xl font-bold text-slate-800">
                {pipelineState}
              </div>
            </div>

            <div className="text-xs text-slate-500 mt-1">
              Cliente: {deal.org_name || "—"} • Contacto:{" "}
              {deal.contact_name || "—"}
            </div>

            {headerLabel && (
              <div className="mt-[-10px] text-sm text-slate-800 font-semibold text-center leading-tight">
                {headerLabel}
              </div>
            )}
          </div>

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
              className={`px-3 py-2 text-sm rounded-t-lg border-b-0 border whitespace-nowrap ${activeTab === t.id
                ? "bg-black text-white"
                : "bg-white"
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
                modalidad_carga:
                  (cf["modalidad_carga"] || {}).value,
                tipo_carga: (cf["tipo_carga"] || {}).value,
                origen_pto: (cf["origen_pto"] || {}).value,
                destino_pto: (cf["destino_pto"] || {}).value,
                mercaderia: (cf["mercaderia"] || {}).value,
              }}
            />
          ) : isFileTab(activeTab) ? (
            <FileTabViewer
              context={getFileFromTab(activeTab)}
            />
          ) : activeTab === "documentos" ? (
            /* ================= PESTAÑA DOCUMENTOS ================= */
            <div className="bg-white rounded-2xl shadow p-4">
              <h3 className="font-medium mb-3">
                Documentos de la operación industrial
              </h3>
              {FILE_TYPES.map((t) => {
                const cfKey = t.key;
                const list = filesByType[cfKey] || [];
                const latest = list[0] || null;
                const href = latest
                  ? resolveUploadUrl(latest.url)
                  : null;

                return (
                  <div
                    key={t.key}
                    className="border rounded-xl p-3 mb-3"
                  >
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
                                    fileLabels?.[f.id] ??
                                    visibleNameOf(f)
                                  }
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setFileLabels((prev) => {
                                      const next = {
                                        ...(prev || {}),
                                        [f.id]: val,
                                      };
                                      setCFLocal(
                                        "file_labels_json",
                                        {
                                          label:
                                            "Rótulos de archivos",
                                          type: "json",
                                          value:
                                            JSON.stringify(
                                              next
                                            ),
                                        }
                                      );
                                      markDirty(
                                        "file_labels_json"
                                      );
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
                                  onClick={() =>
                                    setActiveTab(`f-${f.id}`)
                                  }
                                >
                                  Ver
                                </button>
                                {editMode && (
                                  <button
                                    className="px-2 py-0.5 text-xs rounded border"
                                    onClick={() =>
                                      removeFile(f.id)
                                    }
                                  >
                                    Eliminar
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="hidden md:block text-[11px] text-slate-500 ml-2">
                              {f.filename ||
                                f.original_name}
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
                          (fileInputsRef.current[t.key] =
                            el)
                          }
                          onChange={(e) =>
                            handleFileChange(t.key, e)
                          }
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
                              window.open(
                                href,
                                "_blank"
                              )
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
                <h3 className="font-medium mb-3">
                  Datos generales
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 mb-3">
                  <Field label="Cliente (Organización)">
                    <Input
                      value={deal.org_name || ""}
                      readOnly
                    />
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
                    <Input
                      value={deal.contact_name || ""}
                      readOnly
                    />
                  </Field>
                  <Field label="Teléfono (contacto)">
                    <Input
                      value={deal.contact_phone || ""}
                      readOnly
                    />
                  </Field>
                  <Field label="Email (contacto)">
                    <Input
                      value={deal.contact_email || ""}
                      readOnly
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                  <Field label="Valor (Profit presupuesto)">
                    <Input
                      readOnly
                      value={
                        profitUSD != null
                          ? `$ ${Number(
                            profitUSD
                          ).toLocaleString(
                            undefined,
                            {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            }
                          )}`
                          : "—"
                      }
                    />
                  </Field>

                  <Field label="Ejecutivo de cuenta">
                    <Input
                      readOnly
                      value={executiveName}
                    />
                  </Field>
                </div>
              </div>

              {/* Fechas (para Industrial igual te sirve como timeline) */}
              <div className="bg-white rounded-2xl shadow p-4">
                <h3 className="font-medium mb-3">
                  Fechas de proyecto / logística
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                  {[
                    ["f_inicio", "F. Inicio", "date"],
                    ["f_cotiz", "F. Cotiz", "date"],
                    [
                      "f_cierre_aprox",
                      "F. Cierre (aprox)",
                      "date",
                    ],
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

              {/* Detalles generales de la operación industrial */}
              <div className="bg-white rounded-2xl shadow p-4">
                <h3 className="font-medium mb-3">
                  Detalles de la operación industrial
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 mb-3">
                  <Field label="Tipo de operación">
                    <Select
                      readOnly={!editMode}
                      value={getCF("tipo_operacion")}
                      onChange={(e) =>
                        setCFAndDirty(
                          "tipo_operacion",
                          "Tipo de operación",
                          e.target.value
                        )
                      }
                    >
                      <option value="">—</option>
                      {opts.tipo_operacion.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Mercadería / Equipo">
                    <Input
                      readOnly={!editMode}
                      value={getCF("mercaderia")}
                      onChange={(e) =>
                        setCFAndDirty(
                          "mercaderia",
                          "Mercadería",
                          e.target.value
                        )
                      }
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 mb-3">
                  <Field label="Tipo de embarque / modalidad">
                    <Select
                      readOnly={!editMode}
                      value={getCF("modalidad_carga")}
                      onChange={(e) =>
                        setCFAndDirty(
                          "modalidad_carga",
                          "Tipo de embarque",
                          e.target.value
                        )
                      }
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
                      onChange={(e) =>
                        setCFAndDirty(
                          "tipo_carga",
                          "Tipo de carga",
                          e.target.value
                        )
                      }
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
                  <Field label="Origen (fábrica / depósito)">
                    <Input
                      readOnly={!editMode}
                      value={getCF("origen_pto")}
                      onChange={(e) =>
                        setCFAndDirty(
                          "origen_pto",
                          "Origen",
                          e.target.value
                        )
                      }
                    />
                  </Field>
                  <Field label="Destino (obra / planta)">
                    <Input
                      readOnly={!editMode}
                      value={getCF("destino_pto")}
                      onChange={(e) =>
                        setCFAndDirty(
                          "destino_pto",
                          "Destino",
                          e.target.value
                        )
                      }
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                  <Field label="Incoterm">
                    <Select
                      readOnly={!editMode}
                      value={getCF("incoterm")}
                      onChange={(e) =>
                        setCFAndDirty(
                          "incoterm",
                          "Incoterm",
                          e.target.value
                        )
                      }
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
                      onChange={(e) =>
                        setCFAndDirty(
                          "seguro",
                          "Seguro",
                          e.target.value
                        )
                      }
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
                      onChange={(e) =>
                        setCFAndDirty(
                          "tipo_seguro",
                          "Tipo de seguro",
                          e.target.value
                        )
                      }
                    >
                      <option value="">—</option>
                      <option value="PUERTA A PUERTA">
                        PUERTA A PUERTA
                      </option>
                      <option value="PUERTA A PUERTO">
                        PUERTA A PUERTO
                      </option>
                      <option value="PUERTO A PUERTA">
                        PUERTO A PUERTA
                      </option>
                      <option value="PUERTO A PUERTO">
                        PUERTO A PUERTO
                      </option>
                    </Select>
                  </Field>
                  <Field label="Condición">
                    <Select
                      readOnly={!editMode}
                      value={getCF("condicion")}
                      onChange={(e) =>
                        setCFAndDirty(
                          "condicion",
                          "Condición",
                          e.target.value
                        )
                      }
                    >
                      <option value="">—</option>
                      <option value="CTR">
                        CTR - CONTRA TODO RIESGO
                      </option>
                      <option value="LAP">
                        LAP - LIBRE AVERIA PARTICULAR
                      </option>
                    </Select>
                  </Field>
                </div>
              </div>

              {/* Puertas Industriales */}
              <IndustrialDoorList dealId={id} editMode={editMode} />

              {/* Notas */}
              <div className="bg-white rounded-2xl shadow p-4">
                <h3 className="font-medium mb-3">
                  Notas / Comentarios
                </h3>

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

                <input
                  type="file"
                  multiple
                  className="hidden"
                  ref={noteAttachInputRef}
                  onChange={handleNoteAttachmentChange}
                />

                <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="px-2 py-1 rounded-lg border text-xs"
                      onClick={() =>
                        noteAttachInputRef.current?.click()
                      }
                    >
                      📎 Adjuntar documento a esta nota
                    </button>
                    <span>
                      Los archivos se vincularán a la nota cuando
                      hagas clic en <b>Guardar</b>.
                    </span>
                  </div>
                </div>

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
                              onClick={() =>
                                removePendingAttachment(f.id)
                              }
                            >
                              Quitar
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-4 space-y-2">
                  {notesLoading ? (
                    <div className="text-sm text-slate-600">
                      Cargando notas…
                    </div>
                  ) : notesList.length ? (
                    notesList.map((a) => {
                      const author = authorOf(a);
                      const when = a.created_at
                        ? new Date(
                          a.created_at
                        ).toLocaleString()
                        : "—";

                      const attachIds =
                        (noteAttachmentsMap &&
                          noteAttachmentsMap[a.id]) ||
                        [];
                      const attachFiles = (attachIds || [])
                        .map((fid) => fileById[fid])
                        .filter(Boolean);

                      return (
                        <div
                          key={a.id}
                          className="border rounded-xl p-3"
                        >
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
                              <div className="font-semibold mb-1">
                                Adjuntos:
                              </div>
                              <ul className="space-y-1">
                                {attachFiles.map((f) => (
                                  <li key={f.id}>
                                    <a
                                      href={resolveUploadUrl(
                                        f.url
                                      )}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="underline text-blue-600 truncate"
                                      title={visibleNameOf(f)}
                                    >
                                      {labelOfFile(
                                        f,
                                        fileLabels
                                      )}
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
                <span className="text-slate-500">
                  Referencia:{" "}
                </span>
                <span className="font-medium">
                  {deal.reference}
                </span>
              </div>
              <div>
                <span className="text-slate-500">
                  Descripción:{" "}
                </span>
                <span>{desc || "—"}</span>
              </div>
              <div>
                <span className="text-slate-500">
                  Valor (Profit):{" "}
                </span>
                {profitUSD != null
                  ? `$ ${Number(
                    profitUSD
                  ).toLocaleString()}`
                  : "—"}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow p-4">
            <h3 className="font-medium mb-2">Acciones</h3>
            <div className="flex flex-col gap-2">
              {FILE_TYPES.map((t) => (
                <input
                  key={`input-${t.key}`}
                  type="file"
                  multiple
                  className="hidden"
                  ref={(el) =>
                    (fileInputsRef.current[t.key] = el)
                  }
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

              <button
                className="px-3 py-2 text-sm rounded-lg border w-full text-left"
                onClick={() => setActiveTab("documentos")}
              >
                📎 Abrir pestaña Documentos
              </button>

              <button
                className="px-3 py-2 text-sm rounded-lg bg-green-600 text-white text-center hover:opacity-90 disabled:opacity-60"
                onClick={generateStatusReport}
                disabled={generatingReport}
                title="Generar informe del estado actual de la operación industrial"
              >
                {generatingReport
                  ? "Generando informe…"
                  : "📄 Generar informe de estado"}
              </button>

              <Link
                to={`/operations/${id}/quote`}
                className="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white text-center hover:opacity-90"
              >
                🧾 Presupuesto (Industrial)
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
        />
      )}

      {/* MODAL DE VISTA PREVIA DE CORREO */}
      {showEmailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">
                  Vista previa de correo
                </span>
                <select
                  className="text-xs border rounded px-2 py-1"
                  value={emailMode}
                  onChange={(e) =>
                    openEmailModal(e.target.value)
                  }
                >
                  <option value="general">
                    Correo general
                  </option>
                  <option value="flete">
                    Pedido de tarifa (flete)
                  </option>
                </select>
              </div>
              <button
                className="text-xs px-2 py-1 rounded hover:bg-slate-100"
                onClick={() => setShowEmailModal(false)}
              >
                ✕ Cerrar
              </button>
            </div>

            <div className="p-4 space-y-3 overflow-auto text-sm">
              <div className="grid grid-cols-[60px_1fr] items-center gap-2">
                <span className="text-right text-slate-500">
                  Para
                </span>
                <input
                  className="border rounded px-2 py-1 w-full text-sm"
                  value={emailTo}
                  onChange={(e) =>
                    setEmailTo(e.target.value)
                  }
                  placeholder="destinatarios@example.com; otro@proveedor.com"
                />
              </div>
              <div className="grid grid-cols-[60px_1fr] items-center gap-2">
                <span className="text-right text-slate-500">
                  CC
                </span>
                <input
                  className="border rounded px-2 py-1 w-full text-sm"
                  value={emailCc}
                  onChange={(e) =>
                    setEmailCc(e.target.value)
                  }
                  placeholder="opcional"
                />
              </div>
              <div className="grid grid-cols-[60px_1fr] items-center gap-2">
                <span className="text-right text-slate-500">
                  Asunto
                </span>
                <input
                  className="border rounded px-2 py-1 w-full text-sm"
                  value={emailSubject}
                  onChange={(e) =>
                    setEmailSubject(e.target.value)
                  }
                />
              </div>
              <div>
                <div className="mb-1 text-slate-500">
                  Mensaje
                </div>
                <textarea
                  className="border rounded px-2 py-2 w-full font-mono text-xs"
                  rows={12}
                  value={emailBody}
                  onChange={(e) =>
                    setEmailBody(e.target.value)
                  }
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
                      No se encontraron proveedores con rubro
                      FLETE.
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
                          checked={selectedProviderIds.includes(
                            p.id
                          )}
                          onChange={() => toggleProvider(p)}
                        />
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {p.name}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {p.email || "Sin email"}
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    Al marcar proveedores, sus emails se agregan
                    al campo <b>Para</b>.
                  </div>
                </div>
              )}
            </div>

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
                      alert(
                        "Asunto + mensaje copiados al portapapeles."
                      );
                    } catch {
                      alert(
                        "No se pudo copiar al portapapeles."
                      );
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