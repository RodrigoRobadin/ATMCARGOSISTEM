// src/components/DealFilesTabs.jsx
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";

/**
 * Visor de archivos con pestañas:
 * - Muestra una pestaña por CADA archivo subido (independiente del tipo).
 * - También muestra pestañas "Subiendo..." para uploads en curso (prop uploading).
 * Props:
 *  - dealId: number
 *  - refreshKey?: number  -> fuerza refetch cuando cambia
 *  - uploading?: Array<{ tempId, name, type, progress }>
 */
export default function DealFilesTabs({ dealId, refreshKey = 0, uploading = [] }) {
  const [files, setFiles] = useState([]);
  const [activeId, setActiveId] = useState(null); // puede ser "up-<tempId>" o "f-<id>"

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const { data } = await api.get(`/deals/${dealId}/files`).catch(() => ({ data: [] }));
        if (cancel) return;
        const list = Array.isArray(data) ? data : [];
        // Orden: más nuevos primero
        list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        setFiles(list);
        // Si no hay activo, seleccionar el primero subiendo o el primer archivo
        if (!activeId) {
          if (uploading.length) setActiveId(`up-${uploading[0].tempId}`);
          else if (list.length) setActiveId(`f-${list[0].id}`);
        }
      } catch {
        setFiles([]);
      }
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, refreshKey]);

  // Tabs "subiendo" + tabs definitivos
  const tabs = useMemo(() => {
    const upTabs = (uploading || []).map(u => ({
      id: `up-${u.tempId}`,
      label: `Subiendo: ${truncate(u.name, 24)}`,
      uploading: true,
      progress: Math.max(0, Math.min(100, Number(u.progress ?? 0))),
      name: u.name,
      type: u.type || "",
    }));
    const fileTabs = (files || []).map(f => ({
      id: `f-${f.id}`,
      label: makeTabLabel(f),
      uploading: false,
      file: f,
    }));
    return [...upTabs, ...fileTabs];
  }, [uploading, files]);

  // Si cambió la lista y no existe el activeId, elegir el primero disponible
  useEffect(() => {
    if (!tabs.length) { setActiveId(null); return; }
    const exists = tabs.some(t => t.id === activeId);
    if (!exists) setActiveId(tabs[0].id);
  }, [tabs, activeId]);

  if (!tabs.length) {
    return (
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="text-sm text-slate-500">Aún no hay archivos para mostrar.</div>
      </div>
    );
  }

  const active = tabs.find(t => t.id === activeId);

  return (
    <div className="bg-white rounded-2xl shadow">
      {/* Header de tabs */}
      <div className="flex gap-1 px-3 pt-3 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.id}
            className={`px-3 py-2 text-sm rounded-t-lg border-b-0 border whitespace-nowrap ${
              t.id === activeId ? "bg-black text-white" : "bg-white"
            }`}
            onClick={() => setActiveId(t.id)}
            title={t.label}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Contenido */}
      <div className="p-3 border-t">
        {!active ? null : active.uploading ? (
          <UploadingPanel name={active.name} progress={active.progress} />
        ) : (
          <FileViewer file={active.file} />
        )}
      </div>
    </div>
  );
}

/* ===== Helpers ===== */

function truncate(s = "", n = 24) {
  const str = String(s);
  return str.length > n ? str.slice(0, n - 1) + "… " : str;
}

function makeTabLabel(file) {
  const ext = getExt(file.filename);
  // Ej: "PDF — nombre.pdf"
  return `${ext.toUpperCase()} — ${truncate(file.filename, 28)}`;
}

function getExt(name = "") {
  const m = String(name).toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/);
  return m ? m[1] : "";
}

function isImage(ext) {
  return ["jpg","jpeg","png","gif","webp","bmp","svg"].includes(ext);
}
function isPdf(ext) {
  return ext === "pdf";
}

/* ===== Vistas ===== */

function UploadingPanel({ name, progress = 0 }) {
  return (
    <div>
      <div className="text-sm mb-2">
        <b>{name}</b> — Subiendo…
      </div>
      <div className="w-full bg-slate-200 h-2 rounded">
        <div
          className="h-2 rounded bg-black transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="text-xs mt-1 text-slate-600">{progress}%</div>
    </div>
  );
}

function FileViewer({ file }) {
  if (!file) return null;
  const ext = getExt(file.filename);

  // PDF embebido
  if (isPdf(ext)) {
    return (
      <div className="h-[70vh]">
        <iframe
          src={file.url}
          title={file.filename}
          className="w-full h-full border rounded"
        />
        <div className="mt-2 text-sm">
          <a className="underline" href={file.url} target="_blank" rel="noreferrer">
            Abrir en pestaña nueva
          </a>
        </div>
      </div>
    );
  }

  // Imagen
  if (isImage(ext)) {
    return (
      <div className="flex flex-col items-start">
        <img src={file.url} alt={file.filename} className="max-h-[70vh] rounded border" />
        <div className="mt-2 text-sm">
          <a className="underline" href={file.url} target="_blank" rel="noreferrer">
            Abrir en pestaña nueva
          </a>
        </div>
      </div>
    );
  }

  // Otros tipos: link de descarga / apertura
  return (
    <div className="text-sm">
      <div className="mb-2">No se puede previsualizar este tipo de archivo aquí.</div>
      <a className="underline" href={file.url} target="_blank" rel="noreferrer">
        Abrir / Descargar {file.filename}
      </a>
    </div>
  );
}
