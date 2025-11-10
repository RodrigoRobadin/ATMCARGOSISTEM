// client/src/components/op-details/ReportPreview.jsx
import React, { useMemo, useEffect, useState } from "react";
import { api } from "../../api";

/**
 * Previsualización / impresión del "Status de Embarque".
 *
 * Props:
 *  - open, onClose
 *  - deal (puede ser parcial)
 *  - cf (custom fields) (se usa como fuente principal)
 *  - onObsChange (opcional): callback para notificar cambios en las observaciones
 *
 * Nota importante:
 *  - Ya no dependemos de /api/operations/:id.
 *  - Usamos detail.data (si viene en deal) o los snapshots
 *    guardados en CF: op_air_json, op_ocean_json, op_road_json, op_multimodal_json.
 */
export default function ReportPreview({
  open,
  onClose,
  deal: initialDeal = {},
  cf = {},
  onObsChange = () => {},
}) {
  const [loading, setLoading] = useState(false);
  const [deal, setDeal] = useState(initialDeal);
  const [detail, setDetail] = useState(
    initialDeal.detail || { type: null, data: {} }
  );

  // Observaciones que el usuario puede escribir/modificar en la vista previa
  const [obsLocal, setObsLocal] = useState("");

  // Campos para enviar correo desde el sistema
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [sending, setSending] = useState(false);

  // helpers
  const getCF = (k) => {
    const raw = cf?.[k];
    if (raw == null) return "";
    // Soporta tanto cf[k] = { value: "..." } como cf[k] = "..."
    if (typeof raw === "object" && raw !== null && "value" in raw) {
      return raw.value ?? "";
    }
    return raw;
  };

  const safe = (v, fallback = "—") =>
    v === null || v === undefined || v === "" ? fallback : String(v);

  const num = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const s = String(v).replace(/\./g, "").replace(",", ".");
    const n = Number(s);
    return Number.isNaN(n) ? null : n;
  };

  const fmtKg = (v) => {
    const n = num(v);
    return n === null
      ? "—"
      : `${n.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} KG`;
  };

  const fmtM3 = (v) => {
    const n = num(v);
    return n === null
      ? "—"
      : `${n.toLocaleString(undefined, {
          minimumFractionDigits: 3,
          maximumFractionDigits: 3,
        })} M3`;
  };

  const fmtDate = (v) => {
    if (!v) return "A confirmar";
    try {
      const d = new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return d.toLocaleDateString();
    } catch {
      return String(v);
    }
  };

  // Determinar modalidad (igual que en OperationDetail)
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

  const headerLinea2 = [
    safe(getCF("tipo_operacion")),
    safe(getCF("modalidad_carga")),
    safe(getCF("tipo_carga")),
  ]
    .filter(Boolean)
    .join("  ");

  // Snapshot según modalidad: op_air_json, op_ocean_json, etc.
  const getModalSnapshot = () => {
    const keyByTT = {
      AIR: "op_air_json",
      OCEAN: "op_ocean_json",
      ROAD: "op_road_json",
      MULTIMODAL: "op_multimodal_json",
    };
    const cfKey = keyByTT[currentTT];
    if (!cfKey) return {};

    const raw = getCF(cfKey); // puede ser string JSON o ya objeto
    if (!raw) return {};

    try {
      if (typeof raw === "string") {
        return JSON.parse(raw);
      }
      // si ya es objeto
      return raw && typeof raw === "object" ? raw : {};
    } catch (e) {
      console.warn(
        "[ReportPreview] No se pudo parsear snapshot CF:",
        cfKey,
        raw
      );
      return {};
    }
  };

  const rows = useMemo(() => {
    // Elegir origen de datos específicos:
    // 1) detail.data (si viene)
    // 2) snapshot de CF (op_air_json / op_ocean_json / etc.)
    let specific = {};
    if (detail && detail.data && Object.keys(detail.data || {}).length > 0) {
      specific = detail.data;
    } else {
      specific = getModalSnapshot();
    }

    if (currentTT === "AIR") {
      const origen =
        specific.origin_airport ||
        specific.origin_iata ||
        getCF("origen_pto");
      const destino =
        specific.destination_airport ||
        specific.destination_iata ||
        getCF("destino_pto");
      const peso = specific.weight_gross_kg ?? getCF("peso_bruto");
      const vol = specific.volume_m3 ?? getCF("vol_m3");
      const bultos =
        specific.packages ?? specific.pieces ?? getCF("cant_bultos");

      return [
        ["REF No:", safe(deal?.reference)],
        ["CLIENTE", safe(deal?.org_name)],
        [
          "SHPR / CNEE:",
          safe(
            specific.shpr_cnee ?? getCF("shpr_cnee") ?? getCF("shipper")
          ),
        ],
        ["LÍNEA AÉREA:", safe(specific.airline ?? getCF("linea_aerea"))],
        ["CANTIDAD BULTOS:", safe(bultos)],
        ["MERCADERIA:", safe(specific.commodity || getCF("mercaderia"))],
        ["AEROPUERTO ORIGEN:", safe(origen)],
        ["DESTINO:", safe(destino)],
        ["PESO:", fmtKg(peso)],
        ["VOLUMEN:", fmtM3(vol)],
        [
          "FECHA SAL AEROP. ORIGEN (APROX):",
          fmtDate(specific.etd || getCF("f_est_salida")),
        ],
        [
          "FECHA LLEG. AEROP. TRANSB (APROX):",
          fmtDate(specific.trans_arrival || getCF("llegada_transb")),
        ],
        [
          "FECHA SAL AEROP. TRANSB (APROX):",
          fmtDate(specific.trans_depart || getCF("salida_transb")),
        ],
        [
          "FECHA LLEGADA DESTINO (APROX):",
          fmtDate(specific.eta || getCF("llegada_destino")),
        ],
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
        [
          "FECHA SAL PTO. ORIGEN (APROX):",
          fmtDate(specific.etd || getCF("f_est_salida")),
        ],
        [
          "FECHA LLEG. PTO TRANSB (APROX):",
          fmtDate(specific.trans_arrival || getCF("llegada_transb")),
        ],
        [
          "FECHA SAL PTO TRANSB (APROX):",
          fmtDate(specific.trans_depart || getCF("salida_transb")),
        ],
        [
          "FECHA LLEGADA DESTINO (APROX):",
          fmtDate(specific.eta || getCF("llegada_destino")),
        ],
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
        [
          "FECHA SAL ORIGEN (APROX):",
          fmtDate(specific.etd || getCF("f_est_salida")),
        ],
        [
          "CRUCE FRONTERIZO (APROX):",
          safe(
            specific.border_crossing ?? getCF("border_crossing"),
            "—"
          ),
        ],
        ["FECHA SALIDA CRUCE (APROX):", "—"],
        [
          "FECHA LLEGADA DESTINO (APROX):",
          fmtDate(specific.eta || getCF("llegada_destino")),
        ],
      ];
    }

    // MULTIMODAL (fallback)
    return [
      ["REF No:", safe(deal?.reference)],
      ["CLIENTE", safe(deal?.org_name)],
      ["CANTIDAD BULTOS:", safe(getCF("cant_bultos"))],
      ["MERCADERIA:", safe(getCF("mercaderia"))],
      ["ORIGEN:", safe(getCF("origen_pto"))],
      ["DESTINO:", safe(getCF("destino_pto"))],
      ["PESO:", fmtKg(getCF("peso_bruto"))],
      ["VOLUMEN:", fmtM3(getCF("vol_m3"))],
      [
        "FECHA SAL ORIGEN (APROX):",
        fmtDate(getCF("f_est_salida")),
      ],
      ["FECHA TRANSBORDO (APROX):", "—"],
      ["FECHA SAL TRANSBORDO (APROX):", "—"],
      [
        "FECHA LLEGADA DESTINO (APROX):",
        fmtDate(getCF("llegada_destino")),
      ],
    ];
  }, [currentTT, deal, detail, cf]); // deps incluyen detail y cf

  // Observaciones base: mismo criterio que rows (detail.data -> snapshot -> CF)
  const specificForObs =
    detail && detail.data && Object.keys(detail.data || {}).length > 0
      ? detail.data
      : getModalSnapshot();

  const obsBase =
    (currentTT === "AIR" &&
      (specificForObs.observations || getCF("observaciones"))) ||
    (currentTT === "OCEAN" &&
      (specificForObs.observations || getCF("observaciones"))) ||
    (currentTT === "ROAD" &&
      (specificForObs.observations || getCF("observaciones"))) ||
    (currentTT === "MULTIMODAL" &&
      (specificForObs.observations || getCF("observaciones"))) ||
    "";

  // Al abrir el modal inicializamos datos locales (deal, detail, email, obs)
  useEffect(() => {
    if (!open) return;

    setLoading(true);
    setDeal(initialDeal);
    setDetail(initialDeal.detail || { type: null, data: {} });

    const baseObs = obsBase || "";
    setObsLocal(baseObs);
    onObsChange(baseObs);

    // valores por defecto para el correo
    const possibleTo =
      (initialDeal?.contact_email &&
        String(initialDeal.contact_email).trim()) ||
      (getCF("org_email") && String(getCF("org_email")).trim()) ||
      (getCF("email") && String(getCF("email")).trim()) ||
      "";

    setEmailTo(possibleTo);
    setEmailSubject(`Status de embarque ${initialDeal?.reference || ""}`);

    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  // ===== Helpers para correo =====
  const escapeHtml = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const buildHtmlEmailBody = () => {
    const rowsHtml = rows
      .map(
        ([label, value]) => `
      <tr>
        <td style="padding:6px 8px;border:1px solid #ddd;background:#f8fafc;font-weight:bold;width:220px;">
          ${escapeHtml(label)}
        </td>
        <td style="padding:6px 8px;border:1px solid #ddd;">
          ${escapeHtml(value ?? "")}
        </td>
      </tr>`
      )
      .join("");

    const obsHtml =
      obsLocal && obsLocal.trim()
        ? `
      <div style="margin-top:12px;">
        <strong>OBS:</strong><br>
        ${escapeHtml(obsLocal).replace(/\n/g, "<br>")}
      </div>`
        : "";

    const html = `
<div style="font-family: Arial, sans-serif; font-size: 13px; color: #0f172a;">
  <p style="margin:0 0 12px 0;">
    Estimado cliente,<br><br>
    A continuación el status de embarque:
  </p>
  <h2 style="margin:0 0 4px 0;font-size:18px;">STATUS DE EMBARQUE</h2>
  <div style="margin:0 0 16px 0;font-weight:600;font-size:14px;color:#334155;">
    ${escapeHtml(headerLinea2)}
  </div>
  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:720px;">
    ${rowsHtml}
  </table>
  ${obsHtml}
</div>
`.trim();

    return html;
  };

  const handleCopyHtml = async () => {
    const html = buildHtmlEmailBody();
    try {
      await navigator.clipboard.writeText(html);
      alert("HTML del informe copiado al portapapeles.");
    } catch (e) {
      console.error("No se pudo copiar HTML", e);
      alert("No se pudo copiar el HTML al portapapeles.");
    }
  };

  // Enviar correo desde el backend
  const handleSendEmailSystem = async () => {
    if (!emailTo.trim()) {
      alert("Indicá al menos un destinatario (Para).");
      return;
    }

    const finalSubject =
      emailSubject || `Status de embarque ${deal?.reference || ""}`;
    const html = buildHtmlEmailBody();

    try {
      setSending(true);
      await api.post("/emails/status-report", {
        to: emailTo,
        subject: finalSubject,
        html,
        deal_id: deal?.id || null,
        reference: deal?.reference || "",
      });
      alert("Correo enviado desde el sistema.");
    } catch (e) {
      console.error("Error al enviar correo", e);
      alert("No se pudo enviar el correo desde el sistema.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4 print:p-0">
      <div className="w-[980px] max-w-full bg-white rounded-2xl shadow-xl print:shadow-none print:rounded-none">
        {/* HEADER */}
        <div className="flex items-center justify-between px-4 py-3 border-b print:hidden">
          <div className="font-medium">
            Previsualización — Status de Embarque
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              className="px-3 py-1.5 text-sm rounded-lg border disabled:opacity-60"
              onClick={handleSendEmailSystem}
              disabled={sending}
            >
              {sending ? "Enviando…" : "Enviar desde sistema"}
            </button>
            <button
              className="px-3 py-1.5 text-sm rounded-lg border"
              onClick={handleCopyHtml}
            >
              Copiar HTML informe
            </button>
            <button
              className="px-3 py-1.5 text-sm rounded-lg border"
              onClick={() => window.print()}
            >
              Imprimir / PDF
            </button>
            <button
              className="px-3 py-1.5 text-sm rounded-lg border"
              onClick={onClose}
            >
              Cerrar
            </button>
          </div>
        </div>

        {/* CUERPO */}
        <div className="p-6 text-sm leading-6 print:p-8">
          {/* Campos de correo (solo en pantalla, no en impresión) */}
          <div className="mb-4 space-y-2 print:hidden">
            <div className="grid grid-cols-[70px_1fr] gap-2 items-center">
              <span className="text-right text-slate-500 text-xs">Para</span>
              <input
                className="border rounded px-2 py-1 text-sm w-full"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                placeholder="cliente@empresa.com; otro@dominio.com"
              />
            </div>
            <div className="grid grid-cols-[70px_1fr] gap-2 items-center">
              <span className="text-right text-slate-500 text-xs">
                Asunto
              </span>
              <input
                className="border rounded px-2 py-1 text-sm w-full"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
              />
            </div>
          </div>

          <div className="text-xl font-bold text-slate-800">
            STATUS DE EMBARQUE
          </div>
          <div className="text-base font-semibold text-slate-700 mb-4">
            {headerLinea2}
          </div>

          {loading ? (
            <div>Obteniendo datos...</div>
          ) : (
            rows.map(([label, value]) => (
              <TableRow key={label} label={label} value={value} />
            ))
          )}

          {/* OBSERVACIONES EDITABLES */}
          <div className="mt-4">
            <div className="px-3 py-1 bg-slate-100 rounded text-slate-700 inline-block">
              OBS:
            </div>
            <textarea
              className="mt-2 w-full border rounded p-3 min-h-[80px] text-sm"
              value={obsLocal}
              onChange={(e) => {
                const val = e.target.value;
                setObsLocal(val);
                onObsChange(val);
              }}
              placeholder="Escribí aquí las observaciones que se incluirán al enviar el informe…"
            />
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
