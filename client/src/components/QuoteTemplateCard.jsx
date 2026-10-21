import React, { useState } from "react";
import { RichTextEditor } from "./RichTextEditor.jsx";
import { richTextToLines, sanitizeRichTextHtml } from "../utils/richText.js";

export const TEMPLATE_SECTIONS = [
  ["observaciones", "Observaciones"],
  ["plazo_entrega", "Plazo de entrega"],
  ["responsabilidad_cliente", "Responsabilidad del cliente"],
  ["que_incluye", "Que incluye"],
  ["que_no_incluye", "Que no incluye"],
  ["condicion_pago", "Condicion de pago"],
  ["tipo_entrega", "Tipo de entrega"],
  ["tipo_instalacion", "Tipo de instalacion"],
  ["garantia", "Asistencia y garantia"],
  ["observaciones_producto", "Observaciones de producto"],
];

const HEADING_SIZES = [12, 14, 16, 18, 20, 22, 24];

export function parseQuoteTemplate(raw) {
  try {
    const data = JSON.parse(raw);
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function plainHtml(value) {
  const text = Array.isArray(value) ? value.join("\n") : String(value || "");
  return sanitizeRichTextHtml(text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>"));
}

function sectionHtml(data, key) {
  const legacy = key === "que_incluye" ? data.incluye ?? data.que_incluye
    : key === "que_no_incluye" ? data.no_incluye ?? data.que_no_incluye
    : key === "plazo_entrega" ? data.plazos_entrega ?? data.plazo_entrega
    : key === "garantia" ? data.garantia ?? data.asistencia_garantia
    : data[key];
  return data.rich?.[key] ? sanitizeRichTextHtml(data.rich[key]) : plainHtml(legacy);
}

function TemplateFields({ data, onChange }) {
  function patch(patch) { onChange({ ...data, ...patch }); }
  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium">Nombre de la plantilla
        <input className="mt-1 w-full border rounded px-3 py-2" value={data.name || data.titulo || data.title || ""}
          onChange={(e) => patch({ name: e.target.value })} />
      </label>
      {TEMPLATE_SECTIONS.map(([key, label]) => (
        <div key={key}>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold" style={{ fontSize: `${data.heading_sizes?.[key] || 16}px` }}>{label}</div>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              Tamaño del título
              <select className="border rounded px-2 py-1" value={data.heading_sizes?.[key] || ""}
                onChange={(e) => patch({ heading_sizes: { ...(data.heading_sizes || {}), [key]: e.target.value ? Number(e.target.value) : null } })}>
                <option value="">Predeterminado (16 px)</option>
                {HEADING_SIZES.map((size) => <option key={size} value={size}>{size} px</option>)}
              </select>
            </label>
          </div>
          <RichTextEditor value={sectionHtml(data, key)} placeholder={label} minHeightClass="min-h-[100px]"
            onChange={({ html }) => {
              const rich = { ...(data.rich || {}), [key]: html };
              const text = richTextToLines(html);
              const aliases = key === "que_incluye" ? { incluye: text }
                : key === "que_no_incluye" ? { no_incluye: text }
                : key === "plazo_entrega" ? { plazos_entrega: text }
                : key === "garantia" ? { asistencia_garantia: text }
                : {};
              patch({ ...aliases, [key]: text, rich });
            }} />
        </div>
      ))}
      <label className="flex flex-wrap items-center justify-between gap-2 font-semibold">
        <span style={{ fontSize: `${data.heading_sizes?.terminos_condiciones || 16}px` }}>Términos y condiciones</span>
        <span className="flex items-center gap-2 text-xs font-normal text-slate-600">
          Tamaño del título
          <select className="border rounded px-2 py-1" value={data.heading_sizes?.terminos_condiciones || ""}
            onChange={(e) => patch({ heading_sizes: { ...(data.heading_sizes || {}), terminos_condiciones: e.target.value ? Number(e.target.value) : null } })}>
            <option value="">Predeterminado (16 px)</option>
            {HEADING_SIZES.map((size) => <option key={size} value={size}>{size} px</option>)}
          </select>
        </span>
      </label>
    </div>
  );
}

export default function QuoteTemplateCard({ rows, onChangeRow, onClickSave, onClickRemove, onAdd, saving }) {
  const [draft, setDraft] = useState({ name: "", rich: {} });
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-3">
      {rows.map((row, idx) => {
        const data = parseQuoteTemplate(row.value);
        return (
          <div key={row.id || idx} className="border-b pb-3 last:border-0">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="text-left font-medium text-sm text-blue-700" onClick={() => setOpen(open === idx ? null : idx)}>
                {data?.name || data?.titulo || data?.title || `Plantilla ${idx + 1}`} {open === idx ? "▴" : "▾"}
              </button>
              <label className="ml-auto text-xs">Orden <input type="number" className="w-16 border rounded px-1 py-1" value={row.ord ?? 0}
                onChange={(e) => onChangeRow(idx, { ord: Number(e.target.value) })} /></label>
              <label className="text-xs">Activo <input type="checkbox" checked={Boolean(row.active)}
                onChange={(e) => onChangeRow(idx, { active: e.target.checked ? 1 : 0 })} /></label>
              <button type="button" className="border rounded px-2 py-1 text-xs" disabled={saving || !(data?.name || data?.titulo || data?.title)?.trim()} onClick={() => onClickSave(idx)}>Guardar</button>
              <button type="button" className="border rounded px-2 py-1 text-xs text-red-600" disabled={saving} onClick={() => onClickRemove(idx)}>Eliminar</button>
            </div>
            {open === idx && (data ? <div className="mt-3"><TemplateFields data={data}
              onChange={(next) => onChangeRow(idx, { value: JSON.stringify(next) })} /></div>
              : <div className="mt-2 text-sm text-red-700">El contenido de esta plantilla no es JSON valido. No se puede editar hasta repararlo.</div>)}
          </div>
        );
      })}
      {!rows.length && <p className="text-sm text-slate-500">No hay plantillas todavia.</p>}
      <button type="button" className="border rounded px-3 py-2 text-sm" onClick={() => setCreating(!creating)}>
        {creating ? "Cancelar nueva plantilla" : "+ Nueva plantilla"}
      </button>
      {creating && <div className="space-y-3 border-t pt-3">
        <TemplateFields data={draft} onChange={setDraft} />
        <button type="button" className="bg-blue-600 text-white rounded px-3 py-2 text-sm" disabled={saving || !draft.name?.trim()}
          onClick={() => { onAdd(JSON.stringify({ ...draft, name: draft.name.trim() })); setDraft({ name: "", rich: {} }); setCreating(false); }}>
          Agregar plantilla
        </button>
      </div>}
    </div>
  );
}
