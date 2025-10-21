import React, { useEffect, useMemo, useState, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import DetCosSheet from "./DetCosSheet";

/* ---------- helpers ---------- */
const money = (n) =>
  isNaN(n)
    ? "0,00"
    : Number(n || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

const num = (v) => {
  if (v === "" || v === null || v === undefined) return 0;
  const s = String(v).replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return isNaN(n) ? 0 : n;
};

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
// Factor volumétrico aéreo (kg/m³)
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

  for (const k of ["profitUsd", "profit_usd", "profit", "margen_usd", "margen", "margin_usd"]) {
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

  const sumUsdRows = (rows = []) => rows.reduce((acc, r) => acc + toNum(r.usd || r.total), 0);

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

/* ---------- UI helpers ---------- */
function Field({ label, children }) {
  return (
    <label className="grid grid-cols-[160px_1fr] gap-2 items-center">
      <span className="text-xs text-slate-600">{label}</span>
      <div>{children}</div>
    </label>
  );
}

const Input = ({ readOnly, ...props }) => (
  <input
    className={`border rounded-lg px-2 py-1 text-sm w-full focus:outline-none ${
      readOnly ? "bg-slate-50 cursor-not-allowed" : "focus:ring-2 focus:ring-black/10"
    }`}
    readOnly={readOnly}
    {...props}
  />
);

const Select = ({ readOnly, children, ...props }) => (
  <select
    disabled={!!readOnly}
    className={`border rounded-lg px-2 py-1 text-sm w-full bg-white focus:outline-none ${
      readOnly ? "bg-slate-50 cursor-not-allowed" : "focus:ring-2 focus:ring-black/10"
    }`}
    {...props}
  >
    {children}
  </select>
);

/* ---------- constantes docs ---------- */
const DOC_TYPES = [
  { key: "fact_venta", label: "+ FACT VENTA" },
  { key: "fact_compra", label: "+ FACT COMPRA" },
  { key: "det_cos", label: "+ DET COS" },
  { key: "fact_shpr", label: "+ FACT SHPR" },
  { key: "fact_ag", label: "+ FACT AG" },
  { key: "fact_prov", label: "+ FACT PROV" },
  { key: "fact_atm", label: "+ FACT ATM" },
  { key: "rec_atm", label: "+ REC ATM" },
];

const toLocal = (v) => (v ? String(v).replace("Z", "").slice(0, 16) : "");

/* ======== Subcomponentes presentacionales (sin hooks) ======== */
function DocumentsBlock({ filesByType, editMode, removeFile }) {
  return (
    <div className="bg-white rounded-2xl shadow p-4">
      <h3 className="font-medium mb-3">Documentos</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
        {DOC_TYPES.map((t) => {
          const has = (filesByType[t.key] || []).length > 0;
          return (
            <label key={t.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={has} readOnly />
              <span>{t.label}</span>
            </label>
          );
        })}
      </div>

      <div className="space-y-3">
        {DOC_TYPES.map((t) => {
          const list = filesByType[t.key] || [];
          if (!list.length) return null;
          return (
            <div key={`list-${t.key}`}>
              <div className="text-xs text-slate-500 mb-1">{t.label}</div>
              <ul className="space-y-1">
                {list.map((f) => {
                  const src = resolveUploadUrl(f.url);
                  return (
                    <li
                      key={f.id}
                      className="flex items-center justify-between gap-3 border rounded-lg px-3 py-2"
                    >
                      <a
                        href={src}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm underline truncate"
                        title={f.filename}
                      >
                        {f.filename}
                      </a>
                      {editMode && (
                        <button
                          className="text-xs px-2 py-1 rounded border hover:bg-slate-50"
                          onClick={() => removeFile(f.id)}
                        >
                          Eliminar
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {!Object.values(filesByType).some((arr) => (arr || []).length) && (
          <div className="text-sm text-slate-500">Sin archivos todavía.</div>
        )}
      </div>
    </div>
  );
}

function FileTabViewer({ context }) {
  if (!context) return null;
  if (context.uploading) {
    return (
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="text-sm mb-2">
          <b>{context.docLabel}</b> — {context.name}
        </div>
        <div className="w-full bg-slate-200 h-2 rounded">
          <div className="h-2 rounded bg-black transition-all" style={{ width: `${context.progress}%` }} />
        </div>
        <div className="text-xs mt-1 text-slate-600">{context.progress}%</div>
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
          <iframe src={src} title={f.filename} className="w-full h-full border rounded" />
        </div>
      ) : isImg(ext) ? (
        <div className="flex flex-col items-start">
          <img src={src} alt={f.filename} className="max-h-[70vh] rounded border" />
        </div>
      ) : (
        <div className="text-sm">
          No se puede previsualizar este tipo de archivo aquí.{" "}
          <a className="underline" href={src} target="_blank" rel="noreferrer">
            Abrir / Descargar
          </a>
        </div>
      )}
      <div className="mt-2 text-sm">
        <a className="underline" href={src} target="_blank" rel="noreferrer">
          Abrir en pestaña nueva
        </a>
      </div>
    </div>
  );
}

/* ======= Subformularios (presentacionales, controlados por el padre) ======= */

function AirForm({ f, set, readOnly }) {
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
        <Field label="DOC MASTER"><Input readOnly={readOnly} value={f.doc_master} onChange={(e)=>set('doc_master',e.target.value)} /></Field>
        <Field label="DOC HOUSE"><Input readOnly={readOnly} value={f.doc_house} onChange={(e)=>set('doc_house',e.target.value)} /></Field>
        <Field label="Línea aérea"><Input readOnly={readOnly} value={f.airline} onChange={(e)=>set('airline',e.target.value)} /></Field>

        <Field label="Agente"><Input readOnly={readOnly} value={f.agent} onChange={(e)=>set('agent',e.target.value)} /></Field>
        <Field label="Ag. Aduanera"><Input readOnly={readOnly} value={f.customs_broker} onChange={(e)=>set('customs_broker',e.target.value)} /></Field>
        <Field label="Proveedor"><Input readOnly={readOnly} value={f.provider} onChange={(e)=>set('provider',e.target.value)} /></Field>

        {/* NUEVO: SHPR / CNEE */}
        <div className="md:col-span-3">
          <Field label="SHPR / CNEE">
            <Input
              readOnly={readOnly}
              placeholder="Ej: SHPR: RICOH CALIFORNIA / CNEE: J FLEISCHMAN Y CIA SRL"
              value={f.shpr_cnee || ""}
              onChange={(e)=>set('shpr_cnee', e.target.value)}
            />
          </Field>
        </div>

        <Field label="Origen (AP)"><Input readOnly={readOnly} value={f.origin_airport} onChange={(e)=>set('origin_airport',e.target.value)} /></Field>
        <Field label="Transbordo (AP)"><Input readOnly={readOnly} value={f.transshipment_airport} onChange={(e)=>set('transshipment_airport',e.target.value)} /></Field>
        <Field label="Destino (AP)"><Input readOnly={readOnly} value={f.destination_airport} onChange={(e)=>set('destination_airport',e.target.value)} /></Field>

        <Field label="Mercadería"><Input readOnly={readOnly} value={f.commodity} onChange={(e)=>set('commodity',e.target.value)} /></Field>
        <Field label="Bultos"><Input readOnly={readOnly} type="number" value={f.packages} onChange={(e)=>set('packages',e.target.value)} /></Field>
        <Field label="P. Bruto (kg)"><Input readOnly={readOnly} type="number" value={f.weight_gross_kg} onChange={(e)=>set('weight_gross_kg',e.target.value)} /></Field>

        <Field label="Volumen (m³)">
          <Input
            readOnly={readOnly}
            type="number"
            step="0.001"
            value={f.volume_m3}
            onChange={(e)=>onVolumeChange(e.target.value)}
          />
        </Field>
        <Field label="P. Vol/Chg (kg)">
          <Input
            readOnly
            type="number"
            value={f.weight_chargeable_kg}
            title="Se calcula como Volumen × 167"
          />
        </Field>

        <Field label="Dimensiones">
          <Input
            readOnly={readOnly}
            placeholder={"Ej: 1.2x0.8x0.6x2\n0.9x0.7x0.5"}
            value={f.dimensions_text}
            onChange={(e)=>onDimensionsChange(e.target.value)}
          />
        </Field>

        <Field label="Seguro (X/—)"><Input readOnly={readOnly} value={f.seguro_flag} onChange={(e)=>set('seguro_flag',e.target.value)} /></Field>
        <Field label="Tipo seguro"><Input readOnly={readOnly} value={f.tipo_seguro} onChange={(e)=>set('tipo_seguro',e.target.value)} /></Field>
        <Field label="Cert. seguro"><Input readOnly={readOnly} value={f.cert_seguro} onChange={(e)=>set('cert_seguro',e.target.value)} /></Field>

        <Field label="Condición"><Input readOnly={readOnly} value={f.condicion} onChange={(e)=>set('condicion',e.target.value)} /></Field>
        <Field label="FACT Nº"><Input readOnly={readOnly} value={f.fact_no} onChange={(e)=>set('fact_no',e.target.value)} /></Field>
        <Field label="Valor Factura"><Input readOnly={readOnly} value={f.valor_fact} onChange={(e)=>set('valor_fact',e.target.value)} /></Field>

        <Field label="ETD"><Input readOnly={readOnly} type="datetime-local" value={toLocal(f.etd)} onChange={(e)=>set('etd',e.target.value)} /></Field>
        <Field label="Arribo Transb."><Input readOnly={readOnly} type="datetime-local" value={toLocal(f.trans_arrival)} onChange={(e)=>set('trans_arrival',e.target.value)} /></Field>
        <Field label="Salida Transb."><Input readOnly={readOnly} type="datetime-local" value={toLocal(f.trans_depart)} onChange={(e)=>set('trans_depart',e.target.value)} /></Field>
        <Field label="ETA"><Input readOnly={readOnly} type="datetime-local" value={toLocal(f.eta)} onChange={(e)=>set('eta',e.target.value)} /></Field>
        <Field label="Días tránsito"><Input readOnly={readOnly} type="number" value={f.transit_days} onChange={(e)=>set('transit_days',e.target.value)} /></Field>

        <Field label="Observaciones"><Input readOnly={readOnly} value={f.observations} onChange={(e)=>set('observations',e.target.value)} /></Field>

        <Field label="DOC MASTER (término)"><Input readOnly={readOnly} value={f.doc_master_term} onChange={(e)=>set('doc_master_term',e.target.value)} /></Field>
        <Field label="DOC HOUSE (término)"><Input readOnly={readOnly} value={f.doc_house_term} onChange={(e)=>set('doc_house_term',e.target.value)} /></Field>
        <Field label="Flete (pago)"><Input readOnly={readOnly} value={f.flete_pago} onChange={(e)=>set('flete_pago',e.target.value)} /></Field>
        <Field label="Gastos locales (pago)"><Input readOnly={readOnly} value={f.gastos_locales_pago} onChange={(e)=>set('gastos_locales_pago',e.target.value)} /></Field>
      </div>
    </div>
  );
}


function OceanForm({ f, set, readOnly }) {
  // helpers de contenedores usando estado del padre (no hooks aquí)
  const list = Array.isArray(f.containers_json) ? f.containers_json : [];

  const addCntr = () => {
    if (readOnly) return;
    const next = [...list, { cntr_no: "", seal_no: "" }];
    set("containers_json", next);
  };
  const setCntr = (i, k, v) => {
    if (readOnly) return;
    const next = [...list];
    next[i] = { ...next[i], [k]: v };
    set("containers_json", next);
  };
  const delCntr = (i) => {
    if (readOnly) return;
    const next = [...list];
    next.splice(i, 1);
    set("containers_json", next);
  };

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="MBL"><Input readOnly={readOnly} value={f.mbl} onChange={(e)=>set("mbl",e.target.value)} /></Field>
        <Field label="HBL"><Input readOnly={readOnly} value={f.hbl} onChange={(e)=>set("hbl",e.target.value)} /></Field>
        <Field label="Naviera"><Input readOnly={readOnly} value={f.shipping_line} onChange={(e)=>set("shipping_line",e.target.value)} /></Field>

        {/* Tipo de carga se maneja en “Detalles de operación”, por eso no va aquí */}

        <Field label="Puerto Origen"><Input readOnly={readOnly} value={f.pol} onChange={(e)=>set("pol",e.target.value)} /></Field>
        <Field label="Transbordo"><Input readOnly={readOnly} value={f.transshipment_port} onChange={(e)=>set("transshipment_port",e.target.value)} /></Field>
        <Field label="Puerto Destino"><Input readOnly={readOnly} value={f.pod} onChange={(e)=>set("pod",e.target.value)} /></Field>

        <Field label="Mercadería"><Input readOnly={readOnly} value={f.commodity} onChange={(e)=>set("commodity",e.target.value)} /></Field>
        <Field label="Bultos"><Input readOnly={readOnly} type="number" value={f.packages} onChange={(e)=>set("packages",e.target.value)} /></Field>
        <Field label="Peso (kg)"><Input readOnly={readOnly} type="number" value={f.weight_kg} onChange={(e)=>set("weight_kg",e.target.value)} /></Field>
        <Field label="Volumen (m³)"><Input readOnly={readOnly} type="number" value={f.volume_m3} onChange={(e)=>set("volume_m3",e.target.value)} /></Field>
        <Field label="Chg. (kg)"><Input readOnly={readOnly} type="number" value={f.chargeable_kg} onChange={(e)=>set("chargeable_kg",e.target.value)} /></Field>

        <Field label="Tránsito (días)"><Input readOnly={readOnly} type="number" value={f.transit_time_days} onChange={(e)=>set("transit_time_days",e.target.value)} /></Field>
        <Field label="Free days"><Input readOnly={readOnly} type="number" value={f.free_days} onChange={(e)=>set("free_days",e.target.value)} /></Field>
        <Field label="Itinerario"><Input readOnly={readOnly} value={f.itinerary} onChange={(e)=>set("itinerary",e.target.value)} /></Field>

        <Field label="Entrega Doc. Naviera"><Input readOnly={readOnly} type="datetime-local" value={toLocal(f.doc_nav_delivery)} onChange={(e)=>set("doc_nav_delivery",e.target.value)} /></Field>
        <Field label="Entrega Doc. Cliente"><Input readOnly={readOnly} type="datetime-local" value={toLocal(f.doc_client_delivery)} onChange={(e)=>set("doc_client_delivery",e.target.value)} /></Field>
        <Field label="Inicio Free"><Input readOnly={readOnly} type="datetime-local" value={toLocal(f.free_start)} onChange={(e)=>set("free_start",e.target.value)} /></Field>
        <Field label="Fin Free"><Input readOnly={readOnly} type="datetime-local" value={toLocal(f.free_end)} onChange={(e)=>set("free_end",e.target.value)} /></Field>

        <Field label="ETD"><Input readOnly={readOnly} type="datetime-local" value={toLocal(f.etd)} onChange={(e)=>set("etd",e.target.value)} /></Field>
        <Field label="Arribo Transb."><Input readOnly={readOnly} type="datetime-local" value={toLocal(f.trans_arrival)} onChange={(e)=>set("trans_arrival",e.target.value)} /></Field>
        <Field label="Salida Transb."><Input readOnly={readOnly} type="datetime-local" value={toLocal(f.trans_depart)} onChange={(e)=>set("trans_depart",e.target.value)} /></Field>
        <Field label="ETA"><Input readOnly={readOnly} type="datetime-local" value={toLocal(f.eta)} onChange={(e)=>set("eta",e.target.value)} /></Field>

        <Field label="Observaciones"><Input readOnly={readOnly} value={f.observations} onChange={(e)=>set("observations",e.target.value)} /></Field>
      </div>

      {/* ===== Contenedores (acordeón nativo <details>) ===== */}
      <details className="mt-3 bg-white border rounded-xl">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm flex items-center gap-2">
          <b>Contenedores</b>
          <span className="text-xs text-slate-600">({list.length})</span>
          <span className="text-xs text-slate-500 truncate">
            {list.length ? list.map((c,i)=>c.cntr_no || `CNTR #${i+1}`).join(" • ") : "—"}
          </span>
        </summary>

        <div className="p-3 grid gap-2">
          {list.map((c, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <Field label="CNTR Nro">
                <Input readOnly={readOnly} value={c.cntr_no || ""} onChange={(e)=>setCntr(i, "cntr_no", e.target.value)} />
              </Field>
              <Field label="PRECINTO Nro">
                <Input readOnly={readOnly} value={c.seal_no || ""} onChange={(e)=>setCntr(i, "seal_no", e.target.value)} />
              </Field>
              {!readOnly && (
                <button
                  type="button"
                  onClick={()=>delCntr(i)}
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


function RoadForm({ f, set, readOnly }) {
  // helpers contenedores
  const list = Array.isArray(f.containers_json) ? f.containers_json : [];
  const addCntr = () => {
    if (readOnly) return;
    set("containers_json", [...list, { cntr_no: "", seal_no: "" }]);
  };
  const setCntr = (i, k, v) => {
    if (readOnly) return;
    const next = [...list];
    next[i] = { ...next[i], [k]: v };
    set("containers_json", next);
  };
  const delCntr = (i) => {
    if (readOnly) return;
    const next = [...list];
    next.splice(i, 1);
    set("containers_json", next);
  };

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="CMR/CRT"><Input readOnly={readOnly} value={f.cmr_crt_number} onChange={(e)=>set("cmr_crt_number",e.target.value)} /></Field>
        <Field label="Proveedor (ID)"><Input readOnly={readOnly} value={f.provider_org_id} onChange={(e)=>set("provider_org_id",e.target.value)} /></Field>
        <Field label="Placa Camión"><Input readOnly={readOnly} value={f.truck_plate} onChange={(e)=>set("truck_plate",e.target.value)} /></Field>
        <Field label="Placa Remolque"><Input readOnly={readOnly} value={f.trailer_plate} onChange={(e)=>set("trailer_plate",e.target.value)} /></Field>
        <Field label="Chofer"><Input readOnly={readOnly} value={f.driver_name} onChange={(e)=>set("driver_name",e.target.value)} /></Field>
        <Field label="Tel. Chofer"><Input readOnly={readOnly} value={f.driver_phone} onChange={(e)=>set("driver_phone",e.target.value)} /></Field>
        <Field label="Cruce Fronterizo"><Input readOnly={readOnly} value={f.border_crossing} onChange={(e)=>set("border_crossing",e.target.value)} /></Field>
        <Field label="Ciudad Origen"><Input readOnly={readOnly} value={f.origin_city} onChange={(e)=>set("origin_city",e.target.value)} /></Field>
        <Field label="Ciudad Destino"><Input readOnly={readOnly} value={f.destination_city} onChange={(e)=>set("destination_city",e.target.value)} /></Field>
        <Field label="Itinerario Ruta"><Input readOnly={readOnly} value={f.route_itinerary} onChange={(e)=>set("route_itinerary",e.target.value)} /></Field>
        <Field label="Clase carga">
          <Select readOnly={readOnly} value={f.cargo_class} onChange={(e)=>set("cargo_class",e.target.value)}>
            <option value="FTL">FTL</option>
            <option value="LTL">LTL</option>
          </Select>
        </Field>
        <Field label="Mercadería"><Input readOnly={readOnly} value={f.commodity} onChange={(e)=>set("commodity",e.target.value)} /></Field>
        <Field label="Bultos"><Input readOnly={readOnly} type="number" value={f.packages} onChange={(e)=>set("packages",e.target.value)} /></Field>
        <Field label="Peso (kg)"><Input readOnly={readOnly} type="number" value={f.weight_kg} onChange={(e)=>set("weight_kg",e.target.value)} /></Field>
        <Field label="Volumen (m³)"><Input readOnly={readOnly} type="number" value={f.volume_m3} onChange={(e)=>set("volume_m3",e.target.value)} /></Field>
        <Field label="Hazmat"><input type="checkbox" disabled={readOnly} checked={!!f.hazmat} onChange={(e)=>set("hazmat",e.target.checked)} /></Field>
        <Field label="Control temperatura"><input type="checkbox" disabled={readOnly} checked={!!f.temp_control} onChange={(e)=>set("temp_control",e.target.checked)} /></Field>
        <Field label="Temperatura (°C)"><Input readOnly={readOnly} type="number" value={f.temp_c} onChange={(e)=>set("temp_c",e.target.value)} /></Field>
        <Field label="Precinto"><Input readOnly={readOnly} value={f.seal_no} onChange={(e)=>set("seal_no",e.target.value)} /></Field>
        <Field label="ETD"><Input readOnly={readOnly} type="datetime-local" value={toLocal(f.etd)} onChange={(e)=>set("etd",e.target.value)} /></Field>
        <Field label="ETA"><Input readOnly={readOnly} type="datetime-local" value={toLocal(f.eta)} onChange={(e)=>set("eta",e.target.value)} /></Field>
        <Field label="Días tránsito"><Input readOnly={readOnly} type="number" value={f.transit_days} onChange={(e)=>set("transit_days",e.target.value)} /></Field>
        <Field label="Observaciones"><Input readOnly={readOnly} value={f.observations} onChange={(e)=>set("observations",e.target.value)} /></Field>
      </div>

      {/* ===== Contenedores (acordeón) ===== */}
      <details className="mt-3 bg-white border rounded-xl" open>
        <summary className="cursor-pointer select-none px-3 py-2 text-sm flex items-center gap-2">
          <b>Contenedores</b>
          <span className="text-xs text-slate-600">({list.length})</span>
          <span className="text-xs text-slate-500 truncate">
            {list.length ? list.map((c,i)=>c.cntr_no || `CNTR #${i+1}`).join(" • ") : "—"}
          </span>
        </summary>

        <div className="p-3 grid gap-2">
          {list.map((c, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <Field label="CNTR Nro">
                <Input readOnly={readOnly} value={c.cntr_no || ""} onChange={(e)=>setCntr(i,"cntr_no",e.target.value)} />
              </Field>
              <Field label="PRECINTO Nro">
                <Input readOnly={readOnly} value={c.seal_no || ""} onChange={(e)=>setCntr(i,"seal_no",e.target.value)} />
              </Field>
              {!readOnly && (
                <button type="button" onClick={()=>delCntr(i)} className="px-2 py-2 text-xs rounded border h-9">
                  Eliminar
                </button>
              )}
            </div>
          ))}

          {!readOnly && (
            <button type="button" onClick={addCntr} className="px-3 py-2 text-sm rounded-lg border w-[200px]">
              + Agregar contenedor
            </button>
          )}
        </div>
      </details>
    </div>
  );
}


function MultimodalForm({ f, set, readOnly }) {
  // helpers contenedores
  const list = Array.isArray(f.containers_json) ? f.containers_json : [];
  const addCntr = () => {
    if (readOnly) return;
    set("containers_json", [...list, { cntr_no: "", seal_no: "" }]);
  };
  const setCntr = (i, k, v) => {
    if (readOnly) return;
    const next = [...list];
    next[i] = { ...next[i], [k]: v };
    set("containers_json", next);
  };
  const delCntr = (i) => {
    if (readOnly) return;
    const next = [...list];
    next.splice(i, 1);
    set("containers_json", next);
  };

  // helpers tramos (como ya tenías)
  const addLeg = () => {
    const leg_no = (f.legs?.length || 0) + 1;
    set("legs", [...(f.legs || []), { leg_no, mode:"OCEAN", carrier:"", origin:"", destination:"", ref_doc:"", etd:"", eta:"", weight_kg:"", volume_m3:"", packages:"" }]);
  };
  const setLeg = (i, k, v) => {
    const arr = [...(f.legs || [])];
    arr[i] = { ...arr[i], [k]: v };
    set("legs", arr);
  };
  const delLeg = (i) => {
    const a = [...(f.legs || [])];
    a.splice(i,1);
    a.forEach((L, idx) => (L.leg_no = idx + 1));
    set("legs", a);
  };

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="DOC MASTER"><Input readOnly={readOnly} value={f.doc_master} onChange={(e)=>set("doc_master",e.target.value)} /></Field>
        <Field label="DOC HOUSE"><Input readOnly={readOnly} value={f.doc_house} onChange={(e)=>set("doc_house",e.target.value)} /></Field>
        <Field label="CRT"><Input readOnly={readOnly} value={f.crt_number} onChange={(e)=>set("crt_number",e.target.value)} /></Field>
        <Field label="Naviera / Carrier"><Input readOnly={readOnly} value={f.shipping_line} onChange={(e)=>set("shipping_line",e.target.value)} /></Field>
        <Field label="Itinerario"><Input readOnly={readOnly} value={f.itinerary} onChange={(e)=>set("itinerary",e.target.value)} /></Field>
        <Field label="Free days"><Input readOnly={readOnly} type="number" value={f.free_days} onChange={(e)=>set("free_days",e.target.value)} /></Field>
      </div>

      {/* ===== Contenedores (acordeón) ===== */}
      <details className="mt-3 bg-white border rounded-xl" open>
        <summary className="cursor-pointer select-none px-3 py-2 text-sm flex items-center gap-2">
          <b>Contenedores</b>
          <span className="text-xs text-slate-600">({list.length})</span>
          <span className="text-xs text-slate-500 truncate">
            {list.length ? list.map((c,i)=>c.cntr_no || `CNTR #${i+1}`).join(" • ") : "—"}
          </span>
        </summary>

        <div className="p-3 grid gap-2">
          {list.map((c, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <Field label="CNTR Nro">
                <Input readOnly={readOnly} value={c.cntr_no || ""} onChange={(e)=>setCntr(i,"cntr_no",e.target.value)} />
              </Field>
              <Field label="PRECINTO Nro">
                <Input readOnly={readOnly} value={c.seal_no || ""} onChange={(e)=>setCntr(i,"seal_no",e.target.value)} />
              </Field>
              {!readOnly && (
                <button type="button" onClick={()=>delCntr(i)} className="px-2 py-2 text-xs rounded border h-9">
                  Eliminar
                </button>
              )}
            </div>
          ))}

          {!readOnly && (
            <button type="button" onClick={addCntr} className="px-3 py-2 text-sm rounded-lg border w-[200px]">
              + Agregar contenedor
            </button>
          )}
        </div>
      </details>

      {/* ===== Tramos ===== */}
      <div className="mt-4">
        <h4 className="font-medium mb-2">Tramos</h4>
        <div className="grid gap-2">
          {(f.legs || []).map((L, i) => (
            <div key={i} className="border rounded-xl p-3">
              <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
                <Field label="N°"><Input readOnly value={L.leg_no} /></Field>
                <Field label="Modo">
                  <Select readOnly={readOnly} value={L.mode} onChange={(e)=>setLeg(i,'mode',e.target.value)}>
                    <option value="AIR">AIR</option>
                    <option value="OCEAN">OCEAN</option>
                    <option value="ROAD">ROAD</option>
                  </Select>
                </Field>
                <Field label="Carrier"><Input readOnly={readOnly} value={L.carrier||''} onChange={(e)=>setLeg(i,'carrier',e.target.value)} /></Field>
                <Field label="Origen"><Input readOnly={readOnly} value={L.origin||''} onChange={(e)=>setLeg(i,'origin',e.target.value)} /></Field>
                <Field label="Destino"><Input readOnly={readOnly} value={L.destination||''} onChange={(e)=>setLeg(i,'destination',e.target.value)} /></Field>
                <Field label="Ref. Doc"><Input readOnly={readOnly} value={L.ref_doc||''} onChange={(e)=>setLeg(i,'ref_doc',e.target.value)} /></Field>
                <Field label="ETD"><Input readOnly={readOnly} type="datetime-local" value={toLocal(L.etd)} onChange={(e)=>setLeg(i,'etd',e.target.value)} /></Field>
                <Field label="ETA"><Input readOnly={readOnly} type="datetime-local" value={toLocal(L.eta)} onChange={(e)=>setLeg(i,'eta',e.target.value)} /></Field>
                <Field label="Peso (kg)"><Input readOnly={readOnly} type="number" value={L.weight_kg||''} onChange={(e)=>setLeg(i,'weight_kg',e.target.value)} /></Field>
                <Field label="Volumen (m³)"><Input readOnly={readOnly} type="number" value={L.volume_m3||''} onChange={(e)=>setLeg(i,'volume_m3',e.target.value)} /></Field>
                <Field label="Bultos"><Input readOnly={readOnly} type="number" value={L.packages||''} onChange={(e)=>setLeg(i,'packages',e.target.value)} /></Field>
              </div>
              {!readOnly && (
                <div className="mt-2 text-right">
                  <button onClick={()=>delLeg(i)} className="px-2 py-1 text-xs rounded border">Eliminar tramo</button>
                </div>
              )}
            </div>
          ))}
          {!readOnly && <button onClick={addLeg} className="px-3 py-2 text-sm rounded-lg border w-[180px]">+ Agregar tramo</button>}
        </div>
      </div>

      <div className="mt-3">
        <Field label="Observaciones">
          <Input readOnly={readOnly} value={f.observations} onChange={(e)=>set("observations",e.target.value)} />
        </Field>
      </div>
    </div>
  );
}


/* ---- util ---- */
function getExt(name = "") {
  const m = String(name).toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/);
  return m ? m[1] : "";
}
function isImg(ext) { return ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext); }
function isPdf(ext) { return ext === "pdf"; }
function truncate(s = "", n = 26) { return String(s).length > n ? String(s).slice(0, n - 1) + "…" : s; }
function flattenFiles(filesByType) {
  const arr = [];
  Object.values(filesByType || {}).forEach((list) => (list || []).forEach((f) => arr.push(f)));
  arr.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  return arr;
}
const hasKey = (obj, k) => obj && Object.prototype.hasOwnProperty.call(obj, k);

/* =================== PÁGINA =================== */
export default function OperationDetail() {
  const { id } = useParams();
  const nav = useNavigate();

  // hooks SIEMPRE arriba
  const [loading, setLoading] = useState(true);
  const [deal, setDeal] = useState(null);
  const [activities, setActivities] = useState([]);

  const [desc, setDesc] = useState("");
  const [value, setValue] = useState(""); // mantiene compat, ya no se edita
  const [cf, setCf] = useState({});
  const [cfSupported, setCfSupported] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [dirtyCF, setDirtyCF] = useState(new Set());
  const [note, setNote] = useState("");

  // >>> NUEVO: Profit del presupuesto
  const [profitUSD, setProfitUSD] = useState(null);

  // Documentos
  const [filesByType, setFilesByType] = useState({});
  const fileInputsRef = useRef({});

  // pestañas
  const [activeTab, setActiveTab] = useState("detalle");
  const [filesRefreshKey, setFilesRefreshKey] = useState(0);

  // uploads en curso
  const [uploadingFiles, setUploadingFiles] = useState([]);

  // params admin
  const [paramMap, setParamMap] = useState({
    tipo_operacion: [],
    modalidad_carga: [],
    tipo_carga: [],
    incoterm: [],
  });

  // estados de formularios por modalidad
  const [air, setAir] = useState({});
  const [ocean, setOcean] = useState({});
  const [road, setRoad] = useState({});
  const [multi, setMulti] = useState({});
  const setAirF   = (k, v) => setAir((s)=>({ ...s, [k]: v }));
  const setOceanF = (k, v) => setOcean((s)=>({ ...s, [k]: v }));
  const setRoadF  = (k, v) => setRoad((s)=>({ ...s, [k]: v }));
  const setMultiF = (k, v) => setMulti((s)=>({ ...s, [k]: v }));

  // === NUEVO: estado de generación de informe ===
  const [generatingReport, setGeneratingReport] = useState(false);

  /* ------- carga -------- */
  async function loadFiles() {
    try {
      const { data } = await api.get(`/deals/${id}/files`).catch(() => ({ data: [] }));
      const map = {};
      (data || []).forEach((f) => {
        if (!map[f.type]) map[f.type] = [];
        map[f.type].push(f);
      });
      Object.keys(map).forEach((k) =>
        map[k].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      );
      setFilesByType(map);
      setFilesRefreshKey((k) => k + 1);
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
      setParamMap({ tipo_operacion: [], modalidad_carga: [], tipo_carga: [], incoterm: [] });
    }
  }

  async function reload() {
    setLoading(true);
    try {
      const [{ data: detail }, cfRes, opRes] = await Promise.all([
        api.get(`/deals/${id}`),
        api.get(`/deals/${id}/custom-fields`).catch(() => ({ data: null })),
        api.get(`/operations/${id}`).catch(() => ({ data: null })), // puede no existir aún
      ]);

      setDeal(detail.deal);
      setActivities(detail.activities || []);
      setDesc(detail.deal?.title || "");
      setValue(String(detail.deal?.value ?? ""));

      // ---- CFs
      let cfMapLocal = {};
      if (Array.isArray(cfRes?.data)) {
        cfRes.data.forEach((row) => {
          cfMapLocal[row.key] = { id: row.id, label: row.label, type: row.type, value: row.value ?? "" };
        });
        setCf(cfMapLocal);
        setCfSupported(true);
      } else {
        setCf({});
        setCfSupported(false);
      }
      const cfVal = (k) => (hasKey(cfMapLocal, k) ? cfMapLocal[k].value : "");

      // ---- datos de operación/modalidades
      const op = opRes?.data || {};
      setAir({
        doc_master: op.air?.doc_master ?? cfVal("doc_master") ?? "",
        doc_house: op.air?.doc_house ?? cfVal("doc_house") ?? "",
        airline: op.air?.airline ?? cfVal("linea_aerea") ?? "",
        shpr_cnee: op.air?.shpr_cnee ?? cfVal("shpr_cnee") ?? "",
        agent: op.air?.agent ?? cfVal("agente") ?? "",
        customs_broker: op.air?.customs_broker ?? cfVal("ag_aduanera") ?? "",
        provider: op.air?.provider ?? cfVal("proveedor") ?? "",
        origin_airport: op.air?.origin_airport ?? cfVal("origen_pto") ?? "",
        transshipment_airport: op.air?.transshipment_airport ?? cfVal("transb_pto") ?? "",
        destination_airport: op.air?.destination_airport ?? cfVal("destino_pto") ?? "",
        commodity: op.air?.commodity ?? cfVal("mercaderia") ?? "",
        packages: op.air?.packages ?? cfVal("cant_bultos") ?? "",
        weight_gross_kg: op.air?.weight_gross_kg ?? cfVal("peso_bruto") ?? "",
        volume_m3: op.air?.volume_m3 ?? cfVal("vol_m3") ?? "",
        weight_chargeable_kg: op.air?.weight_chargeable_kg ?? cfVal("p_vol") ?? "",
        dimensions_text: op.air?.dimensions_text ?? cfVal("dimensiones") ?? "",
        seguro_flag: op.air?.seguro_flag ?? cfVal("seguro") ?? "",
        tipo_seguro: op.air?.tipo_seguro ?? cfVal("tipo_seguro") ?? "CRT",
        cert_seguro: op.air?.cert_seguro ?? cfVal("cert_seguro") ?? "",
        condicion: op.air?.condicion ?? cfVal("condicion") ?? "PUERTO A PUERTA",
        fact_no: op.air?.fact_no ?? cfVal("fact_no") ?? "",
        valor_fact: op.air?.valor_fact ?? cfVal("valor_fact") ?? "",
        etd: op.air?.etd ?? cfVal("f_est_salida") ?? "",
        trans_arrival: op.air?.trans_arrival ?? cfVal("llegada_transb") ?? "",
        trans_depart: op.air?.trans_depart ?? cfVal("salida_transb") ?? "",
        eta: op.air?.eta ?? cfVal("llegada_destino") ?? "",
        transit_days: op.air?.transit_days ?? cfVal("dias_transito") ?? "",
        observations: op.air?.observations ?? cfVal("observaciones") ?? "",
        doc_master_term: op.air?.doc_master_term ?? cfVal("doc_master_term") ?? "PREPAID",
        doc_house_term: op.air?.doc_house_term ?? cfVal("doc_house_term") ?? "COLLECT",
        flete_pago: op.air?.flete_pago ?? cfVal("flete_pago") ?? "CONTADO",
        gastos_locales_pago: op.air?.gastos_locales_pago ?? cfVal("gastos_locales_pago") ?? "CREDITO",
        chk_fact_shpr: !!(op.air?.chk_fact_shpr ?? cfVal("chk_fact_shpr")),
        chk_fact_ag: !!(op.air?.chk_fact_ag ?? cfVal("chk_fact_ag")),
        chk_trf_ag: !!(op.air?.chk_trf_ag ?? cfVal("chk_trf_ag")),
        chk_fact_prov: !!(op.air?.chk_fact_prov ?? cfVal("chk_fact_prov")),
        chk_rec_prov: !!(op.air?.chk_rec_prov ?? cfVal("chk_rec_prov")),
        chk_fact_atm: !!(op.air?.chk_fact_atm ?? cfVal("chk_fact_atm")),
        chk_rec_atm: !!(op.air?.chk_rec_atm ?? cfVal("chk_rec_atm")),
      });

      setOcean({
        mbl: op.ocean?.mbl ?? cfVal("doc_master") ?? "",
        hbl: op.ocean?.hbl ?? cfVal("doc_house") ?? "",
        shipping_line: op.ocean?.shipping_line ?? cfVal("linea_marit") ?? "",
        load_type: op.ocean?.load_type ?? cfVal("tipo_carga") ?? "LCL",
        pol: op.ocean?.pol ?? cfVal("origen_pto") ?? "",
        transshipment_port: op.ocean?.transshipment_port ?? cfVal("transb_pto") ?? "",
        pod: op.ocean?.pod ?? cfVal("destino_pto") ?? "",
        commodity: op.ocean?.commodity ?? cfVal("mercaderia") ?? "",
        packages: op.ocean?.packages ?? cfVal("cant_bultos") ?? "",
        weight_kg: op.ocean?.weight_kg ?? cfVal("peso_bruto") ?? "",
        volume_m3: op.ocean?.volume_m3 ?? cfVal("vol_m3") ?? "",
        chargeable_kg: op.ocean?.chargeable_kg ?? cfVal("p_vol") ?? "",
        transit_time_days: op.ocean?.transit_time_days ?? cfVal("tiempo_trans") ?? "",
        free_days: op.ocean?.free_days ?? cfVal("dias_libre") ?? "",
        itinerary: op.ocean?.itinerary ?? cfVal("itinerario") ?? "",
        doc_nav_delivery: op.ocean?.doc_nav_delivery ?? cfVal("f_ent_doc_nav") ?? "",
        doc_client_delivery: op.ocean?.doc_client_delivery ?? cfVal("f_ent_doc_cliente") ?? "",
        free_start: op.ocean?.free_start ?? cfVal("inicio_dias_libre") ?? "",
        free_end: op.ocean?.free_end ?? cfVal("fin_dias_libre") ?? "",
        observations: op.ocean?.observations ?? cfVal("observaciones") ?? "",
        etd: op.ocean?.etd ?? cfVal("f_est_salida") ?? "",
        trans_arrival: op.ocean?.trans_arrival ?? cfVal("llegada_transb") ?? "",
        trans_depart: op.ocean?.trans_depart ?? cfVal("salida_transb") ?? "",
        eta: op.ocean?.eta ?? cfVal("llegada_destino") ?? "",
        containers_json: Array.isArray(op.ocean?.containers_json) ? op.ocean.containers_json : [],
      });

      setRoad({
        cmr_crt_number: op.road?.cmr_crt_number ?? cfVal("crt") ?? "",
        provider_org_id: op.road?.provider_org_id ?? cfVal("prov_id") ?? "",
        truck_plate: op.road?.truck_plate ?? cfVal("placa_camion") ?? "",
        trailer_plate: op.road?.trailer_plate ?? cfVal("placa_remolque") ?? "",
        driver_name: op.road?.driver_name ?? cfVal("chofer") ?? "",
        driver_phone: op.road?.driver_phone ?? cfVal("chofer_tel") ?? "",
        border_crossing: op.road?.border_crossing ?? cfVal("cruce_frontera") ?? "",
        origin_city: op.road?.origin_city ?? cfVal("origen_pto") ?? "",
        destination_city: op.road?.destination_city ?? cfVal("destino_pto") ?? "",
        route_itinerary: op.road?.route_itinerary ?? cfVal("itinerario") ?? "",
        cargo_class: op.road?.cargo_class ?? cfVal("clase_carga") ?? "FTL",
        commodity: op.road?.commodity ?? cfVal("mercaderia") ?? "",
        packages: op.road?.packages ?? cfVal("cant_bultos") ?? "",
        weight_kg: op.road?.weight_kg ?? cfVal("peso_bruto") ?? "",
        volume_m3: op.road?.volume_m3 ?? cfVal("vol_m3") ?? "",
        hazmat: !!(op.road?.hazmat ?? (cfVal("hazmat") === "1")),
        temp_control: !!(op.road?.temp_control ?? (cfVal("temp_ctrl") === "1")),
        temp_c: op.road?.temp_c ?? cfVal("temp_c") ?? "",
        seal_no: op.road?.seal_no ?? cfVal("precinto") ?? "",
        observations: op.road?.observations ?? cfVal("observaciones") ?? "",
        etd: op.road?.etd ?? cfVal("f_est_salida") ?? "",
        eta: op.road?.eta ?? cfVal("llegada_destino") ?? "",
        transit_days: op.road?.transit_days ?? cfVal("dias_transito") ?? "",
        containers_json: Array.isArray(op.road?.containers_json) ? op.road.containers_json : [],
      });

      setMulti({
        doc_master: op.multimodal?.doc_master ?? cfVal("doc_master") ?? "",
        doc_house: op.multimodal?.doc_house ?? cfVal("doc_house") ?? "",
        crt_number: op.multimodal?.crt_number ?? cfVal("crt") ?? "",
        shipping_line: op.multimodal?.shipping_line ?? cfVal("linea_marit") ?? "",
        itinerary: op.multimodal?.itinerary ?? cfVal("itinerario") ?? "",
        free_days: op.multimodal?.free_days ?? cfVal("dias_libre") ?? "",
        observations: op.multimodal?.observations ?? cfVal("observaciones") ?? "",
        legs: Array.isArray(op.multimodal?.legs) ? op.multimodal.legs : [],
        containers_json: Array.isArray(op.multimodal?.containers_json) ? op.multimodal.containers_json : [],
      });

      // === Cost-sheet → Profit
      let profit = null;
      try {
        const csResp = await api.get(`/deals/${id}/cost-sheet`).then(r => r.data).catch(() => null);
        profit = computeProfitFromCostSheet(csResp);
      } catch {}
      setProfitUSD(profit);

      try {
        if (profit != null) {
          const curVal = Number(detail.deal?.value ?? 0);
          if (Math.abs(curVal - profit) > 0.01) {
            await api.patch(`/deals/${id}`, { value: profit });
            setDeal(d => d ? { ...d, value: profit } : d);
          }
        }
      } catch {}

      await Promise.all([loadFiles(), loadParams()]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, [id]); // seguro: hook siempre registrado

  /* ---------- custom-field helpers ---------- */
  const getCF = (key) => cf[key]?.value ?? "";
  const setCFLocal = (key, updater) =>
    setCf((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), ...updater } }));
  function markDirty(key) {
    setDirtyCF((prev) => {
      const s = new Set(prev);
      s.add(key);
      return s;
    });
  }
  async function upsertCF(key, label, type, value) {
    const row = cf[key];
    if (!row?.id) {
      const { data } = await api.post(`/deals/${id}/custom-fields`, { key, label, type, value });
      setCFLocal(key, { id: data.id, label, type, value });
    } else {
      await api.put(`/deals/${id}/custom-fields/${row.id}`, { value });
      setCFLocal(key, { value });
    }
  }

  async function saveModal(kind, payload, cfMap = []) {
    try {
      await api.put(`/operations/${id}/${kind}`, payload);
    } catch {
      const ops = cfMap.map(({ key, label, type, pick }) =>
        upsertCF(key, label, type, pick(payload))
      );
      await Promise.all(ops);
    }
  }

  async function saveAll() {
    try {
      await api.patch(`/deals/${id}`, {
        description: desc || null,
        value: (profitUSD != null ? profitUSD : Number(deal?.value || 0)),
      });

      const saves = [];
      dirtyCF.forEach((key) => {
        const row = cf[key];
        if (!row) return;
        saves.push(upsertCF(key, row.label || key, row.type || "text", row.value));
      });
      await Promise.all(saves);

      const dealTT = String(deal?.transport_type || "").toUpperCase();
      const cfTTraw = String(getCF("modalidad_carga") || "").toUpperCase();
      const mapCF2TT = { AEREO: "AIR", MARITIMO: "OCEAN", TERRESTRE: "ROAD", MULTIMODAL: "MULTIMODAL" };
      const currentTT = ["AIR", "OCEAN", "ROAD", "MULTIMODAL"].includes(dealTT)
        ? dealTT
        : mapCF2TT[cfTTraw] || "AIR";

      if (currentTT === "AIR") {
        await saveModal("air", air, [
          { key: "doc_master", label: "DOC MASTER", type: "text", pick: (p) => p.doc_master },
          { key: "doc_house", label: "DOC HOUSE", type: "text", pick: (p) => p.doc_house },
          { key: "linea_aerea", label: "Línea aérea", type: "text", pick: (p) => p.airline },
          { key: "shpr_cnee", label: "SHPR - CNEE", type: "text", pick: (p) => p.shpr_cnee },
          { key: "agente", label: "Agente", type: "text", pick: (p) => p.agent },
          { key: "ag_aduanera", label: "Ag Aduanera", type: "text", pick: (p) => p.customs_broker },
          { key: "proveedor", label: "Proveedor", type: "text", pick: (p) => p.provider },
          { key: "origen_pto", label: "Origen", type: "text", pick: (p) => p.origin_airport },
          { key: "transb_pto", label: "Transbordo", type: "text", pick: (p) => p.transshipment_airport },
          { key: "destino_pto", label: "Destino", type: "text", pick: (p) => p.destination_airport },
          { key: "mercaderia", label: "Mercadería", type: "text", pick: (p) => p.commodity },
          { key: "cant_bultos", label: "Cant bultos", type: "number", pick: (p) => p.packages },
          { key: "peso_bruto", label: "Peso", type: "text", pick: (p) => p.weight_gross_kg },
          { key: "vol_m3", label: "Vol m³", type: "text", pick: (p) => p.volume_m3 },
          { key: "p_vol", label: "P. Vol", type: "text", pick: (p) => p.weight_chargeable_kg },
          { key: "dimensiones", label: "Dimensiones", type: "text", pick: (p) => p.dimensions_text },
          { key: "seguro", label: "Seguro", type: "text", pick: (p) => p.seguro_flag },
          { key: "tipo_seguro", label: "Tipo seguro", type: "text", pick: (p) => p.tipo_seguro },
          { key: "cert_seguro", label: "Cert. seguro", type: "text", pick: (p) => p.cert_seguro },
          { key: "condicion", label: "Condición", type: "text", pick: (p) => p.condicion },
          { key: "fact_no", label: "FACT No", type: "text", pick: (p) => p.fact_no },
          { key: "valor_fact", label: "Valor Fact", type: "text", pick: (p) => p.valor_fact },
          { key: "f_est_salida", label: "F. Est. Salida", type: "date", pick: (p) => p.etd },
          { key: "llegada_transb", label: "Arribo Transb.", type: "date", pick: (p) => p.trans_arrival },
          { key: "salida_transb", label: "Salida Transb.", type: "date", pick: (p) => p.trans_depart },
          { key: "llegada_destino", label: "ETA", type: "date", pick: (p) => p.eta },
          { key: "dias_transito", label: "Días Tránsito", type: "number", pick: (p) => p.transit_days },
          { key: "observaciones", label: "OBS", type: "text", pick: (p) => p.observations },
          { key: "doc_master_term", label: "Doc Master (term)", type: "text", pick: (p) => p.doc_master_term },
          { key: "doc_house_term", label: "Doc House (term)", type: "text", pick: (p) => p.doc_house_term },
          { key: "flete_pago", label: "Flete pago", type: "text", pick: (p) => p.flete_pago },
          { key: "gastos_locales_pago", label: "Gastos locales pago", type: "text", pick: (p) => p.gastos_locales_pago },
        ]);
      }
      if (currentTT === "OCEAN") {
        await saveModal("ocean", ocean, [
          { key: "doc_master", label: "DOC MASTER", type: "text", pick: (p) => p.mbl },
          { key: "doc_house", label: "DOC HOUSE", type: "text", pick: (p) => p.hbl },
          { key: "linea_marit", label: "Línea marítima", type: "text", pick: (p) => p.shipping_line },
          // ⚠️ Quitado el mapeo de "tipo_carga" para no sobreescribir desde subform
          { key: "origen_pto", label: "Puerto Origen", type: "text", pick: (p) => p.pol },
          { key: "transb_pto", label: "Transbordo", type: "text", pick: (p) => p.transshipment_port },
          { key: "destino_pto", label: "Puerto Destino", type: "text", pick: (p) => p.pod },
          { key: "mercaderia", label: "Mercadería", type: "text", pick: (p) => p.commodity },
          { key: "cant_bultos", label: "Cant bultos", type: "number", pick: (p) => p.packages },
          { key: "peso_bruto", label: "Peso (kg)", type: "text", pick: (p) => p.weight_kg },
          { key: "vol_m3", label: "Vol m³", type: "text", pick: (p) => p.volume_m3 },
          { key: "p_vol", label: "Chg. (kg)", type: "text", pick: (p) => p.chargeable_kg },
          { key: "tiempo_trans", label: "Tiempo tránsito (d)", type: "text", pick: (p) => p.transit_time_days },
          { key: "dias_libre", label: "Free days", type: "text", pick: (p) => p.free_days },
          { key: "itinerario", label: "Itinerario", type: "text", pick: (p) => p.itinerary },
          { key: "observaciones", label: "OBS", type: "text", pick: (p) => p.observations },
        ]);
      }
      if (currentTT === "ROAD") {
        await saveModal("road", road, [
          { key: "crt", label: "CRT", type: "text", pick: (p) => p.cmr_crt_number },
          { key: "placa_camion", label: "Placa Camión", type: "text", pick: (p) => p.truck_plate },
          { key: "placa_remolque", label: "Placa Remolque", type: "text", pick: (p) => p.trailer_plate },
          { key: "chofer", label: "Chofer", type: "text", pick: (p) => p.driver_name },
          { key: "chofer_tel", label: "Tel. Chofer", type: "text", pick: (p) => p.driver_phone },
          { key: "cruce_frontera", label: "Cruce Fronterizo", type: "text", pick: (p) => p.border_crossing },
          // ⚠️ Quitado el mapeo de "clase_carga" para no sobreescribir desde subform
          { key: "precinto", label: "Precinto", type: "text", pick: (p) => p.seal_no },
          { key: "observaciones", label: "OBS", type: "text", pick: (p) => p.observations },
        ]);
      }
      if (currentTT === "MULTIMODAL") {
        await saveModal("multimodal", multi, [
          { key: "doc_master", label: "DOC MASTER", type: "text", pick: (p) => p.doc_master },
          { key: "doc_house", label: "DOC HOUSE", type: "text", pick: (p) => p.doc_house },
          { key: "crt", label: "CRT", type: "text", pick: (p) => p.crt_number },
          { key: "linea_marit", label: "Naviera/Carrier", type: "text", pick: (p) => p.shipping_line },
          { key: "itinerario", label: "Itinerario", type: "text", pick: (p) => p.itinerary },
          { key: "dias_libre", label: "Free days", type: "text", pick: (p) => p.free_days },
          { key: "observaciones", label: "OBS", type: "text", pick: (p) => p.observations },
        ]);
      }

      setEditMode(false);
      await reload();
      alert("Cambios guardados.");
    } catch {
      alert("No se pudo guardar.");
    }
  }

  function cancelEdit() {
    setEditMode(false);
    reload();
  }

  async function addNote() {
    const txt = (note || "").trim();
    if (!txt) return;
    try {
      await api.post("/activities", {
        type: "note",
        subject: `Nota en ${deal?.reference || "operación"}`,
        notes: txt,
        deal_id: Number(id),
        done: 1,
      });
      setNote("");
      const { data } = await api.get(`/deals/${id}`);
      setActivities(data.activities || []);
    } catch {
      alert("No se pudo crear la nota.");
    }
  }

  function triggerUpload(type) {
    if (!fileInputsRef.current[type]) return;
    fileInputsRef.current[type].click();
  }

  // ===== NUEVO: descarga de informe (robusto a rutas distintas) =====
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

      // 1) intentar POST clásico a /reports/status/informes con body { deal_id }
      try {
        const { data } = await api.post(
          "/reports/status/informes",
          { deal_id: Number(id) },
          { responseType: "blob" }
        );
        const blob = new Blob([data], { type: "application/pdf" });
        downloadBlob(blob, `informe-estado-${(deal?.reference || id)}.pdf`);
        return;
      } catch (e1) {
        // sigue al fallback
      }

      // 2) fallback GET a /reports/status/:id
      try {
        const { data } = await api.get(`/reports/status/${id}`, { responseType: "blob" });
        const blob = new Blob([data], { type: "application/pdf" });
        downloadBlob(blob, `informe-estado-${(deal?.reference || id)}.pdf`);
        return;
      } catch (e2) {
        // sigue al fallback
      }

      // 3) fallback GET a /reports/status?deal_id=:id
      try {
        const { data } = await api.get(`/reports/status`, {
          params: { deal_id: id },
          responseType: "blob",
        });
        const blob = new Blob([data], { type: "application/pdf" });
        downloadBlob(blob, `informe-estado-${(deal?.reference || id)}.pdf`);
        return;
      } catch (e3) {
        // si nada funcionó:
        throw e3;
      }
    } catch (err) {
      console.error(err);
      alert("No se pudo generar el informe de estado. Verificá el endpoint del reporte.");
    } finally {
      setGeneratingReport(false);
    }
  }

  // subida con progreso -> pestaña "Subiendo…"
  const docLabelFor = (type) => DOC_TYPES.find((t) => t.key === type)?.label || "Documento";
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
  async function handleFileChange(type, e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

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

      if (info?.id) setActiveTab(`f-${info.id}`);
      else {
        const newest = flattenFiles(filesByType)[0];
        if (newest) setActiveTab(`f-${newest.id}`);
      }
    } catch {
      popUploading(tempId);
      alert("No se pudo subir el archivo.");
    }
  }

  /* --------- tabs de archivos --------- */
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
  const flatFileTabs = flatFiles.map((f) => ({
    id: `f-${f.id}`,
    kind: "file",
    label: `${docLabelFor(f.type)} — ${truncate(f.filename, 22)}`,
    file: f,
    docLabel: docLabelFor(f.type),
  }));

  const topTabs = [
    { id: "detalle", kind: "base", label: "Detalle" },
    { id: "detcos", kind: "base", label: "Planilla de costos (DET COS)" },
    ...flatUploadingTabs,
    ...flatFileTabs,
  ];

  const isFileTab = (id) => String(id).startsWith("f-") || String(id).startsWith("up-");
  function getFileFromTab(id) {
    const sid = String(id);
    if (sid.startsWith("up-")) {
      const u = uploadingFiles.find((x) => `up-${x.tempId}` === sid);
      return u ? { uploading: true, ...u } : null;
    }
    if (sid.startsWith("f-")) {
      const fileId = Number(sid.slice(2));
      const f = flatFiles.find((x) => x.id === fileId);
      return f ? { uploading: false, file: f, docLabel: docLabelFor(f.type) } : null;
    }
    return null;
  }

  // ====== opciones / derivados / tipo de transporte ======
  const opts = {
    tipo_operacion: (paramMap.tipo_operacion.length
      ? paramMap.tipo_operacion
      : [{ value: "IMPORT" }, { value: "EXPORT" }]).map((o) => o.value),
    modalidad_carga: (paramMap.modalidad_carga.length
      ? paramMap.modalidad_carga
      : [{ value: "AEREO" }, { value: "MARITIMO" }, { value: "TERRESTRE" }, { value: "MULTIMODAL" }]).map((o) => o.value),
    tipo_carga: (paramMap.tipo_carga.length ? paramMap.tipo_carga : [{ value: "LCL" }, { value: "FCL" }]).map(
      (o) => o.value
    ),
    incoterm: (paramMap.incoterm.length ? paramMap.incoterm : []).map((o) => o.value),
  };

  // valores empresa
  const orgRuc = deal?.org_ruc || getCF("org_ruc") || getCF("ruc") || "";
  const orgAddress = deal?.org_address || getCF("org_address") || getCF("address") || "";
  const orgPhone = deal?.org_phone || getCF("org_phone") || getCF("phone") || "";
  const orgEmail = deal?.org_email || getCF("org_email") || getCF("email") || "";

  const volumeM3 = (() => {
    const v = Number(String(getCF("vol_m3") || "").replace(",", "."));
    return isNaN(v) ? null : v;
  })();
  const volumetricKg = volumeM3 != null ? volumeM3 * 167 : null;

  const dealTT = String(deal?.transport_type || "").toUpperCase();
  const cfTTraw = String(getCF("modalidad_carga") || "").toUpperCase();
  const mapCF2TT = { AEREO: "AIR", MARITIMO: "OCEAN", TERRESTRE: "ROAD", MULTIMODAL: "MULTIMODAL" };
  const currentTT = ["AIR", "OCEAN", "ROAD", "MULTIMODAL"].includes(dealTT)
    ? dealTT
    : mapCF2TT[cfTTraw] || "AIR";

  const [modalTab, setModalTab] = useState("AIR");
  useEffect(() => { setModalTab(currentTT); }, [currentTT]);

  // ---- returns tempranos después de registrar TODOS los hooks
  if (loading) return <p className="text-sm text-slate-600">Cargando…</p>;
  if (!deal) return <p className="text-sm text-slate-600">Operación no encontrada.</p>;

  return (
    <div className="space-y-4">
      {/* ENCABEZADO */}
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-slate-500">VISTA DE OPERACIÓN</div>

            <div className="flex items-center gap-3 flex-wrap">
              <div className="text-2xl font-bold">{deal.reference}</div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Estado:</span>
                {editMode ? (
                  <div className="w-44">
                    <Input
                      value={getCF("estado")}
                      onChange={(e) => {
                        setCFLocal("estado", { label: "Estado", type: "text", value: e.target.value });
                        markDirty("estado");
                      }}
                    />
                  </div>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs">
                    {getCF("estado") || "—"}
                  </span>
                )}
              </div>
            </div>

            <div className="text-xs text-slate-500">
              Cliente: {deal.org_name || "—"} • Contacto: {deal.contact_name || "—"}
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            {!editMode ? (
              <button className="px-3 py-1.5 text-xs rounded-lg border" onClick={() => setEditMode(true)}>
                Modificar
              </button>
            ) : (
              <>
                <button className="px-3 py-1.5 text-xs rounded-lg border" onClick={cancelEdit}>
                  Cancelar
                </button>
                <button className="px-3 py-1.5 text-xs rounded-lg bg-black text-white" onClick={saveAll}>
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
                  <Field label="Dirección"><Input value={orgAddress} readOnly /></Field>
                  <Field label="Teléfono (empresa)"><Input value={orgPhone} readOnly /></Field>
                  <Field label="Email (empresa)"><Input value={orgEmail} readOnly /></Field>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-3 mb-4">
                  <Field label="Contacto"><Input value={deal.contact_name || ""} readOnly /></Field>
                  <Field label="Teléfono (contacto)"><Input value={deal.contact_phone || ""} readOnly /></Field>
                  <Field label="Email (contacto)"><Input value={deal.contact_email || ""} readOnly /></Field>
                </div>

                {/* 👇 Valor (solo lectura) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                  <Field label="Valor (Profit presupuesto)">
                    <Input
                      readOnly
                      value={
                        profitUSD != null
                          ? `$ ${Number(profitUSD).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : "—"
                      }
                    />
                  </Field>
                </div>
              </div>

              {/* ====== Detalles de operación (ÚNICA fuente de Tipo de carga) */}
              <div className="bg-white rounded-2xl shadow p-4">
                <h3 className="font-medium mb-3">Detalles de operación</h3>

                {/* TIPO DE OPERACIÓN - MERCADERÍA */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 mb-3">
                  <Field label="Tipo de operación">
                    <Select
                      readOnly={!editMode}
                      value={getCF("tipo_operacion")}
                      onChange={(e) => {
                        setCFLocal("tipo_operacion", { label: "Tipo de operación", type: "select", value: e.target.value });
                        markDirty("tipo_operacion");
                      }}
                    >
                      <option value="">—</option>
                      {opts.tipo_operacion.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="Mercadería">
                    <Input
                      readOnly={!editMode}
                      value={getCF("mercaderia")}
                      onChange={(e) => {
                        setCFLocal("mercaderia", { label: "Mercadería", type: "text", value: e.target.value });
                        markDirty("mercaderia");
                      }}
                    />
                  </Field>
                </div>

                {/* TIPO DE EMBARQUE - TIPO DE CARGA */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 mb-3">
                  <Field label="Tipo de embarque">
                    <Select
                      readOnly={!editMode}
                      value={getCF("modalidad_carga")}
                      onChange={(e) => {
                        setCFLocal("modalidad_carga", { label: "Tipo de embarque", type: "select", value: e.target.value });
                        markDirty("modalidad_carga");
                      }}
                    >
                      <option value="">—</option>
                      {opts.modalidad_carga.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="Tipo de carga">
                    <Select
                      readOnly={!editMode}
                      value={getCF("tipo_carga")}
                      onChange={(e) => {
                        setCFLocal("tipo_carga", { label: "Tipo de carga", type: "select", value: e.target.value });
                        markDirty("tipo_carga");
                      }}
                    >
                      <option value="">—</option>
                      {opts.tipo_carga.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </Select>
                  </Field>
                </div>

                {/* ORIGEN - DESTINO */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                  <Field label="Origen">
                    <Input
                      readOnly={!editMode}
                      value={getCF("origen_pto")}
                      onChange={(e) => {
                        setCFLocal("origen_pto", { label: "Origen", type: "text", value: e.target.value });
                        markDirty("origen_pto");
                      }}
                    />
                  </Field>
                  <Field label="Destino">
                    <Input
                      readOnly={!editMode}
                      value={getCF("destino_pto")}
                      onChange={(e) => {
                        setCFLocal("destino_pto", { label: "Destino", type: "text", value: e.target.value });
                        markDirty("destino_pto");
                      }}
                    />
                  </Field>
                </div>
              </div>

              {/* ====== Pestañas por modalidad */}
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
                        } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
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

                {modalTab === "AIR" && <AirForm f={air} set={setAirF} readOnly={!editMode} />}
                {modalTab === "OCEAN" && <OceanForm f={ocean} set={setOceanF} readOnly={!editMode} />}
                {modalTab === "ROAD" && <RoadForm f={road} set={setRoadF} readOnly={!editMode} />}
                {modalTab === "MULTIMODAL" && <MultimodalForm f={multi} set={setMultiF} readOnly={!editMode} />}
              </div>

              {/* Fechas / Incoterm / Seguro */}
              <div className="bg-white rounded-2xl shadow p-4">
                <h3 className="font-medium mb-3">Fechas & condiciones</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                  {[
                    ["f_inicio", "F. Inicio", "date"],
                    ["f_cotiz", "F. Cotiz", "date"],
                    ["f_confirm", "F. Confirm", "date"],
                  ].map(([key, label, type]) => (
                    <Field key={key} label={label}>
                      <Input
                        readOnly={!editMode}
                        type={type}
                        value={getCF(key)}
                        onChange={(e) => {
                          setCFLocal(key, { label, type, value: e.target.value });
                          markDirty(key);
                        }}
                      />
                    </Field>
                  ))}

                  <Field label="Incoterm">
                    <Select
                      readOnly={!editMode}
                      value={getCF("incoterm")}
                      onChange={(e) => {
                        setCFLocal("incoterm", { label: "Incoterm", type: "select", value: e.target.value });
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

                  <Field label="Seguro (X/—)">
                    <Select
                      readOnly={!editMode}
                      value={getCF("seguro")}
                      onChange={(e) => {
                        setCFLocal("seguro", { label: "Seguro", type: "select", value: e.target.value });
                        markDirty("seguro");
                      }}
                    >
                      <option value="">—</option>
                      <option value="X">X</option>
                    </Select>
                  </Field>

                  <Field label="Tipo seguro">
                    <Input
                      readOnly={!editMode}
                      value={getCF("tipo_seguro")}
                      onChange={(e) => {
                        setCFLocal("tipo_seguro", { label: "Tipo seguro", type: "text", value: e.target.value });
                        markDirty("tipo_seguro");
                      }}
                    />
                  </Field>

                  <Field label="Condición">
                    <Input
                      readOnly={!editMode}
                      value={getCF("condicion")}
                      onChange={(e) => {
                        setCFLocal("condicion", { label: "Condición", type: "text", value: e.target.value });
                        markDirty("condicion");
                      }}
                    />
                  </Field>
                </div>
              </div>

              {/* Documentos */}
              <DocumentsBlock
                filesByType={filesByType}
                editMode={editMode}
                removeFile={removeFile}
              />

              {/* Notas */}
              <div className="bg-white rounded-2xl shadow p-4">
                <h3 className="font-medium mb-3">Notas / Comentarios</h3>
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
                <div className="mt-4 space-y-2">
                  {activities.length ? (
                    activities.map((a) => (
                      <div key={a.id} className="border rounded-xl p-3">
                        <div className="text-sm font-medium">
                          {a.type || "actividad"} — {a.subject || "sin asunto"}
                        </div>
                        <div className="text-xs text-slate-600">
                          {a.created_at ? new Date(a.created_at).toLocaleString() : "—"}
                          {a.due_date ? ` • Vence: ${a.due_date}` : ""}
                        </div>
                        {a.notes && <div className="text-sm mt-1 whitespace-pre-wrap">{a.notes}</div>}
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-slate-500">Sin notas todavía.</div>
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
                {profitUSD != null ? `$ ${Number(profitUSD).toLocaleString()}` : "—"}
              </div>
            </div>
          </div>

          {/* Acciones */}
          <div className="bg-white rounded-2xl shadow p-4">
            <h3 className="font-medium mb-2">Acciones</h3>
            <div className="flex flex-col gap-2">
              {DOC_TYPES.map((t) => (
                <input
                  key={`input-${t.key}`}
                  type="file"
                  className="hidden"
                  ref={(el) => (fileInputsRef.current[t.key] = el)}
                  onChange={(e) => handleFileChange(t.key, e)}
                />
              ))}

              <a
                href={`/api/reports/status/view/${id}`}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-2 text-sm rounded-lg border w-full text-center"
              >
                📄 Informe de estado (vista previa)
              </a>

              {DOC_TYPES.map((t) =>
                t.key === "det_cos" ? (
                  <button
                    key={`btn-${t.key}`}
                    className="px-3 py-2 text-sm rounded-lg border w-full text-left"
                    onClick={() => setActiveTab("detcos")}
                  >
                    {t.label} (abrir planilla)
                  </button>
                ) : (
                  <button
                    key={`btn-${t.key}`}
                    className="px-3 py-2 text-sm rounded-lg border w-full text-left"
                    onClick={() => triggerUpload(t.key)}
                  >
                    {t.label}
                  </button>
                )
              )}

              {/* === NUEVO: botón generar informe === */}
              <button
                className="px-3 py-2 text-sm rounded-lg bg-green-600 text-white text-center hover:opacity-90 disabled:opacity-60"
                onClick={generateStatusReport}
                disabled={generatingReport}
                title="Generar informe del estado actual de la operación"
              >
                {generatingReport ? "Generando informe…" : "📄 Generar informe de estado"}
              </button>

              <Link
                to={`/operations/${id}/quote`}
                className="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white text-center hover:opacity-90"
              >
                🧾 Presupuesto (nuevo)
              </Link>
              <button className="px-3 py-2 text-sm rounded-lg border">Enviar correo</button>
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
    </div>
  );

  async function removeFile(fileId) {
    if (!editMode) return;
    if (!window.confirm("¿Eliminar archivo?")) return;
    try {
      await api.delete(`/deals/${id}/files/${fileId}`);
      await loadFiles();
    } catch {
      alert("No se pudo eliminar el archivo.");
    }
  }
}
