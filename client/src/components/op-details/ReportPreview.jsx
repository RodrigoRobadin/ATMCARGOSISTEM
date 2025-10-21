// client/src/components/op-details/ReportPreview.jsx
import React, { useMemo, useEffect, useState } from "react";
import { api } from "../../api";

/**
 * Previsualización / impresión del "Status de Embarque".
 * Al abrir, pide datos frescos del servidor (/api/operations/:id) para asegurar
 * que lo que se muestra coincide con lo guardado en la base.
 *
 * Props:
 *  - open, onClose
 *  - deal (puede ser parcial — se recarga si existe id)
 *  - cf (custom fields) (se usa como fallback)
 *
 * Nota: requiere que la API /api/operations/:id devuelva { ...deal, detail: { type, data } }
 */
export default function ReportPreview({ open, onClose, deal: initialDeal = {}, cf = {} }) {
  const [loading, setLoading] = useState(false);
  const [deal, setDeal] = useState(initialDeal);
  const [detail, setDetail] = useState(initialDeal.detail || { type: null, data: {} });

  useEffect(() => {
    // cuando se abre el modal, recargamos desde servidor para garantizar datos recientes
    if (!open) return;
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const id = Number(initialDeal?.id || initialDeal?.deal_id || 0);
        if (!id) {
          // no tenemos id; usamos lo que haya
          setDeal(initialDeal);
          setDetail(initialDeal.detail || { type: null, data: {} });
          setLoading(false);
          return;
        }
        const { data } = await api.get(`/api/operations/${id}`);
        if (!mounted) return;
        // la API devuelve el deal con detail
        setDeal(data);
        setDetail(data.detail || { type: null, data: {} });
      } catch (e) {
        console.error("[ReportPreview] error fetching operation:", e);
        // fallback a datos iniciales
        setDeal(initialDeal);
        setDetail(initialDeal.detail || { type: null, data: {} });
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialDeal?.id]);

  if (!open) return null;

  // helpers (copiados/compatibles con el estilo del resto)
  const getCF = (k) => (cf?.[k]?.value ?? "");
  const safe = (v, fallback = "—") => (v === null || v === undefined || v === "" ? fallback : String(v));
  const num = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const s = String(v).replace(/\./g, "").replace(",", ".");
    const n = Number(s);
    return Number.isNaN(n) ? null : n;
  };
  const fmtKg = (v) => {
    const n = num(v);
    return n === null ? "—" : `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KG`;
  };
  const fmtM3 = (v) => {
    const n = num(v);
    return n === null ? "—" : `${n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} M3`;
  };
  const fmtDate = (v) => {
    if (!v) return "A confirmar";
    try {
      const d = new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return d.toLocaleDateString();
    } catch { return String(v); }
  };

  // Determinar modalidad y origen de datos (detail.data es prioridad)
  const dealTT = String(deal?.transport_type || "").toUpperCase();
  const cfTTraw = String(getCF("modalidad_carga") || "").toUpperCase();
  const mapCF2TT = { AEREO: "AIR", MARITIMO: "OCEAN", TERRESTRE: "ROAD", MULTIMODAL: "MULTIMODAL" };
  const currentTT = ["AIR","OCEAN","ROAD","MULTIMODAL"].includes(dealTT) ? dealTT : (mapCF2TT[cfTTraw] || "AIR");

  const specific = detail?.data || {};
  const headerLinea2 = [ safe(getCF("tipo_operacion")), safe(getCF("modalidad_carga")), safe(getCF("tipo_carga")) ]
    .filter(Boolean).join("  ");

  // Construcción rows por modalidad (prioriza specific, si no usa CF)
  const rows = useMemo(() => {
    if (currentTT === "AIR") {
      const origen = specific.origin_airport || specific.origin_iata || getCF("origen_pto");
      const destino = specific.destination_airport || specific.destination_iata || getCF("destino_pto");
      const peso = specific.weight_gross_kg ?? getCF("peso_bruto");
      const vol = specific.volume_m3 ?? getCF("vol_m3");
      const bultos = specific.packages ?? specific.pieces ?? getCF("cant_bultos");

      return [
        ["REF No:", safe(deal?.reference)],
        ["CLIENTE", safe(deal?.org_name)],
        ["SHPR / CNEE:", safe(specific.shpr_cnee ?? getCF("shpr_cnee") ?? getCF("shipper"))],
        ["LÍNEA AÉREA:", safe(specific.airline ?? getCF("linea_aerea"))],
        ["CANTIDAD BULTOS:", safe(bultos)],
        ["MERCADERIA:", safe(specific.commodity || getCF("mercaderia"))],
        ["AEROPUERTO ORIGEN:", safe(origen)],
        ["DESTINO:", safe(destino)],
        ["PESO:", fmtKg(peso)],
        ["VOLUMEN:", fmtM3(vol)],
        ["FECHA SAL AEROP. ORIGEN (APROX):", fmtDate(specific.etd || getCF("f_est_salida"))],
        ["FECHA LLEG. AEROP. TRANSB (APROX):", fmtDate(specific.trans_arrival || getCF("llegada_transb"))],
        ["FECHA SAL AEROP. TRANSB (APROX):", fmtDate(specific.trans_depart || getCF("salida_transb"))],
        ["FECHA LLEGADA DESTINO (APROX):", fmtDate(specific.eta || getCF("llegada_destino"))],
      ];
    }

    if (currentTT === "OCEAN") {
      const origen = specific.pol || getCF("origen_pto");
      const destino = specific.pod || getCF("destino_pto");
      const peso = specific.weight_kg ?? getCF("peso_bruto");
      const vol = specific.volume_m3 ?? getCF("vol_m3");
      const bultos = specific.packages ?? getCF("cant_bultos");

      return [
        ["REF No:", safe(deal?.reference)],
        ["CLIENTE", safe(deal?.org_name)],
        ["CANTIDAD BULTOS:", safe(bultos)],
        ["MERCADERIA:", safe(specific.commodity || getCF("mercaderia"))],
        ["PUERTO ORIGEN:", safe(origen)],
        ["DESTINO:", safe(destino)],
        ["PESO:", fmtKg(peso)],
        ["VOLUMEN:", fmtM3(vol)],
        ["FECHA SAL PTO. ORIGEN (APROX):", fmtDate(specific.etd || getCF("f_est_salida"))],
        ["FECHA LLEG. PTO TRANSB (APROX):", fmtDate(specific.trans_arrival || getCF("llegada_transb"))],
        ["FECHA SAL PTO TRANSB (APROX):", fmtDate(specific.trans_depart || getCF("salida_transb"))],
        ["FECHA LLEGADA DESTINO (APROX):", fmtDate(specific.eta || getCF("llegada_destino"))],
      ];
    }

    if (currentTT === "ROAD") {
      const origen = specific.origin_city || getCF("origen_pto");
      const destino = specific.destination_city || getCF("destino_pto");
      const peso = specific.weight_kg ?? getCF("peso_bruto");
      const vol = specific.volume_m3 ?? getCF("vol_m3");
      const bultos = specific.packages ?? getCF("cant_bultos");

      return [
        ["REF No:", safe(deal?.reference)],
        ["CLIENTE", safe(deal?.org_name)],
        ["CANTIDAD BULTOS:", safe(bultos)],
        ["MERCADERIA:", safe(specific.commodity || getCF("mercaderia"))],
        ["CIUDAD ORIGEN:", safe(origen)],
        ["DESTINO:", safe(destino)],
        ["PESO:", fmtKg(peso)],
        ["VOLUMEN:", fmtM3(vol)],
        ["FECHA SAL ORIGEN (APROX):", fmtDate(specific.etd || getCF("f_est_salida"))],
        ["CRUCE FRONTERIZO (APROX):", safe(specific.border_crossing ?? getCF("border_crossing"), "—")],
        ["FECHA SALIDA CRUCE (APROX):", "—"],
        ["FECHA LLEGADA DESTINO (APROX):", fmtDate(specific.eta || getCF("llegada_destino"))],
      ];
    }

    // MULTIMODAL (fallback genérico)
    return [
      ["REF No:", safe(deal?.reference)],
      ["CLIENTE", safe(deal?.org_name)],
      ["CANTIDAD BULTOS:", safe(getCF("cant_bultos"))],
      ["MERCADERIA:", safe(getCF("mercaderia"))],
      ["ORIGEN:", safe(getCF("origen_pto"))],
      ["DESTINO:", safe(getCF("destino_pto"))],
      ["PESO:", fmtKg(getCF("peso_bruto"))],
      ["VOLUMEN:", fmtM3(getCF("vol_m3"))],
      ["FECHA SAL ORIGEN (APROX):", fmtDate(getCF("f_est_salida"))],
      ["FECHA TRANSBORDO (APROX):", "—"],
      ["FECHA SAL TRANSBORDO (APROX):", "—"],
      ["FECHA LLEGADA DESTINO (APROX):", fmtDate(getCF("llegada_destino"))],
    ];
  }, [currentTT, deal, specific, cf]);

  const obs = (
    (currentTT === "AIR" && (specific.observations || getCF("observaciones"))) ||
    (currentTT === "OCEAN" && (specific.observations || getCF("observaciones"))) ||
    (currentTT === "ROAD" && (specific.observations || getCF("observaciones"))) ||
    (currentTT === "MULTIMODAL" && (specific.observations || getCF("observaciones"))) ||
    ""
  );

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4 print:p-0">
      <div className="w-[980px] max-w-full bg-white rounded-2xl shadow-xl print:shadow-none print:rounded-none">
        <div className="flex items-center justify-between px-4 py-3 border-b print:hidden">
          <div className="font-medium">Previsualización — Status de Embarque</div>
          <div className="flex gap-2">
            <button className="px-3 py-1.5 text-sm rounded-lg border" onClick={() => window.print()}>Imprimir / PDF</button>
            <button className="px-3 py-1.5 text-sm rounded-lg border" onClick={onClose}>Cerrar</button>
          </div>
        </div>

        <div className="p-6 text-sm leading-6 print:p-8">
          <div className="text-xl font-bold text-slate-800">STATUS DE EMBARQUE</div>
          <div className="text-base font-semibold text-slate-700 mb-4">{headerLinea2}</div>

          {loading ? <div>Obteniendo datos...</div> : rows.map(([label, value]) => (
            <TableRow key={label} label={label} value={value} />
          ))}

          <div className="mt-4">
            <div className="px-3 py-1 bg-slate-100 rounded text-slate-700 inline-block">OBS:</div>
            <div className="mt-2 whitespace-pre-wrap border rounded p-3 min-h-[64px]">{safe(obs, "")}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TableRow({ label, value }) {
  return (
    <div className="grid grid-cols-[320px_1fr] items-center border-b last:border-b-0">
      <div className="bg-slate-100 px-3 py-2 font-medium">{label}</div>
      <div className="px-3 py-2">{value || "—"}</div>
    </div>
  );
}
