// server/src/routes/reports.js
import { Router } from "express";
import db from "../services/db.js";
import fs from "fs";
import nodemailer from "nodemailer";
import puppeteer from "puppeteer-core";

const router = Router();

/* ===================== utils ===================== */
const safe = (v, d = "—") => (v === null || v === undefined || v === "" ? d : v);

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  let s = String(v).trim();
  if (s === "") return null;
  s = s.replace(/\s+/g, "");
  if (s.includes(".") && s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(/,/g, ".");
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
};

const fmtKg = (v) => {
  const n = num(v);
  return n === null
    ? "—"
    : `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KG`;
};
const fmtM3 = (v) => {
  const n = num(v);
  return n === null
    ? "—"
    : `${n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} M3`;
};
const fmtDate = (v) => {
  if (!v) return "—";
  try {
    const dt = new Date(v);
    if (Number.isNaN(+dt)) return safe(v);
    return dt.toLocaleDateString();
  } catch {
    return safe(v);
  }
};

/* ===== localizar Chrome/Edge (Windows) ===== */
function findLocalChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const winPaths = [
    "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe",
    "C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe",
    "C:\\\\Program Files\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe",
    "C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe",
  ];
  for (const p of winPaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/* ===== HTML (mismo estilo de tu vista) ===== */
function buildHtml({ title, modeText, rows }) {
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>
:root{--bg:#f6f7fb;--card:#fff;--txt:#1f2937;--border:#d1d5db;}
*{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--txt);font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto}
.wrap{max-width:960px;margin:24px auto;padding:0 16px}
.card{background:#fff;border-radius:16px;box-shadow:0 2px 10px rgba(0,0,0,.06);overflow:hidden}
.head{display:grid;grid-template-columns:1fr auto;align-items:center;background:#eef2ff;border-bottom:1px solid var(--border)}
.head-left{padding:18px 22px}.head-title{font-weight:700;color:#334155}
.head-sub{font-weight:800;font-size:20px;color:#0f172a;letter-spacing:.5px}
.logo{padding:10px 16px;font-weight:800;font-size:22px;color:#ef3a55}
.tr{display:grid;grid-template-columns:260px 1fr}
.th,.td{padding:10px 14px;border-bottom:1px solid var(--border)}
.th{background:#e9eef7;color:#0f172a;font-weight:700;font-size:13px;border-right:1px solid var(--border)}
.td{font-size:14px}
.foot{padding:12px 16px;display:flex;gap:8px;justify-content:flex-end}
.btn{border:1px solid var(--border);background:#fff;border-radius:10px;padding:10px 14px;font-size:13px;cursor:pointer;text-decoration:none;color:#111}
.btn.primary{background:#111827;color:#fff;border-color:#111827}
@media(max-width:640px){.tr{grid-template-columns:1fr}.th{border-right:none}}
@media print{body{background:#fff}.wrap{margin:0;max-width:none}.card{box-shadow:none;border-radius:0}.foot{display:none}}
</style></head>
<body><div class="wrap"><div class="card">
  <div class="head">
    <div class="head-left"><div class="head-title">STATUS DE EMBARQUE</div><div class="head-sub">${modeText}</div></div>
    <div class="logo">grupo<span style="color:#9e1e2f">atm</span></div>
  </div>
  <div>
    ${rows.map(([k,v])=>`<div class="tr"><div class="th">${k}</div><div class="td">${v ?? "—"}</div></div>`).join("")}
  </div>
  <div class="foot">
    <a class="btn" href="" onclick="window.print();return false;">🖨️ Imprimir / Guardar PDF</a>
    <a class="btn primary" id="dl" href="#">⬇️ Descargar PDF</a>
  </div>
</div></div>
<script>(function(){const id=location.pathname.split('/').pop();document.getElementById('dl').href='/api/reports/status/'+id+'?download=1';})();</script>
</body></html>`;
}

/* ===== HTML → PDF ===== */
async function htmlToPdf(html) {
  const exe = findLocalChrome();
  if (!exe) throw new Error("CHROME_NOT_FOUND");
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: true,
    args: ["--no-sandbox","--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.emulateMediaType("screen");
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
    });
    if (!pdf || pdf.length < 100) throw new Error("PDF_EMPTY");
    return { buffer: pdf, exe };
  } finally {
    await browser.close();
  }
}

/* ===== helpers ===== */
async function queryFirst(sql, params = []) {
  const [rows] = await db.query(sql, params);
  return rows?.[0] || null;
}

/** Cargar Custom Fields de un deal como mapa { key: value }
 *  OJO: ajustá el nombre de la tabla si es distinto.
 */
async function fetchDealCFMap(dealId) {
  const tables = [
    "deal_custom_fields",   // <- si tu tabla se llama distinto, cambiala acá
    "deals_custom_fields",
    "custom_fields",
  ];
  for (const table of tables) {
    try {
      const [rows] = await db.query(
        `SELECT \`key\`, value FROM ${table} WHERE deal_id=?`,
        [dealId]
      );
      if (!Array.isArray(rows)) continue;
      const map = {};
      for (const r of rows) {
        if (r.key == null) continue;
        map[r.key] = r.value;
      }
      return map;
    } catch (e) {
      // tabla no existe o columnas distintas → pruebo la siguiente
      if (e?.code === "ER_NO_SUCH_TABLE" || e?.code === "ER_BAD_FIELD_ERROR") continue;
      throw e;
    }
  }
  return {};
}

function parseJsonValue(raw) {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw;
  return null;
}

/** Última fila por deal en tablas operation_* (para operaciones viejas) */
async function latestRow(table, dealId) {
  // 1) Por created_at (si existe)
  try {
    const row = await queryFirst(
      `SELECT * FROM ${table} WHERE deal_id=? ORDER BY created_at DESC LIMIT 1`,
      [dealId]
    );
    if (row) return row;
  } catch (e) {
    if (e?.code !== "ER_BAD_FIELD_ERROR") throw e;
  }

  // 2) Heurística por fechas según modalidad
  const byDates = {
    operation_air: `
      SELECT * FROM operation_air
       WHERE deal_id=?
       ORDER BY
         (etd IS NOT NULL) DESC, etd DESC,
         (eta IS NOT NULL) DESC, eta DESC,
         (trans_depart IS NOT NULL) DESC, trans_depart DESC,
         (trans_arrival IS NOT NULL) DESC, trans_arrival DESC
       LIMIT 1`,
    operation_ocean: `
      SELECT * FROM operation_ocean
       WHERE deal_id=?
       ORDER BY
         (etd IS NOT NULL) DESC, etd DESC,
         (eta IS NOT NULL) DESC, eta DESC,
         (trans_depart IS NOT NULL) DESC, trans_depart DESC,
         (trans_arrival IS NOT NULL) DESC, trans_arrival DESC
       LIMIT 1`,
    operation_road: `
      SELECT * FROM operation_road
       WHERE deal_id=?
       ORDER BY
         (etd IS NOT NULL) DESC, etd DESC,
         (eta IS NOT NULL) DESC, eta DESC
       LIMIT 1`,
    operation_multimodal: `
      SELECT * FROM operation_multimodal
       WHERE deal_id=?
       ORDER BY
         (free_end IS NOT NULL) DESC, free_end DESC,
         (free_start IS NOT NULL) DESC, free_start DESC
       LIMIT 1`,
  };

  const sqlDates = byDates[table];
  if (sqlDates) {
    const row = await queryFirst(sqlDates, [dealId]);
    if (row) return row;
  }

  // 3) Último fallback
  return await queryFirst(`SELECT * FROM ${table} WHERE deal_id=? LIMIT 1`, [dealId]);
}

/* ===== datos base del deal ===== */
async function fetchDealCore(id) {
  const tries = [
`SELECT d.id,d.reference,d.title,d.value,d.transport_type,d.status_ops,o.name AS org_name,c.name AS contact_name
   FROM deals d
LEFT JOIN organizations o ON o.id=d.organization_id
LEFT JOIN contacts      c ON c.id=d.contact_id
  WHERE d.id=?`,
`SELECT d.id,d.reference,d.title,d.value,d.transport_type,d.status_ops,o.name AS org_name,c.name AS contact_name
   FROM deals d
LEFT JOIN organizations o ON o.id=d.org_id
LEFT JOIN contacts      c ON c.id=d.contact_id
  WHERE d.id=?`,
`SELECT d.id,d.reference,d.title,d.value,d.transport_type,d.status_ops FROM deals d WHERE d.id=?`,
  ];
  for (const sql of tries) {
    try {
      const row = await queryFirst(sql, [id]);
      if (row) return row;
    } catch (e) {
      if (e?.code !== "ER_BAD_FIELD_ERROR") throw e;
    }
  }
  return null;
}

/* ===== armar contenido por modalidad (AHORA LEYENDO CF + SNAPSHOTS) ===== */
async function fetchModalData(deal, debug = false) {
  const id = Number(deal.id);

  // 1) Cargar CF del deal
  const cfMap = await fetchDealCFMap(id);
  const getCF = (k) =>
    Object.prototype.hasOwnProperty.call(cfMap, k) ? cfMap[k] : null;

  const parseSnap = (key) => parseJsonValue(getCF(key)) || null;

  // 2) Determinar modalidad (deal.transport_type o CF modalidad_carga)
  const dealTT = String(deal.transport_type || "").toUpperCase();
  const cfTTraw = String(getCF("modalidad_carga") || "").toUpperCase();
  const mapCF2TT = {
    AEREO: "AIR",
    MARITIMO: "OCEAN",
    TERRESTRE: "ROAD",
    MULTIMODAL: "MULTIMODAL",
  };
  const mode = ["AIR","OCEAN","ROAD","MULTIMODAL"].includes(dealTT)
    ? dealTT
    : (mapCF2TT[cfTTraw] || "AIR");

  const tipoOperacion = String(getCF("tipo_operacion") || "").toUpperCase();
  const tipoCargaCF = String(getCF("tipo_carga") || "").toUpperCase();

  const buildHeaderMode = (shortMod, loadType = "") => {
    const op = tipoOperacion || "IMPORT";
    const carga = (loadType || tipoCargaCF || "").toUpperCase();
    const parts = [op, shortMod, carga].filter(Boolean);
    return parts.join(" ");
  };

  /* ===== AIR ===== */
  if (mode === "AIR") {
    const snap = parseSnap("op_air_json");
    const a = snap || (await latestRow("operation_air", id)) || {};
    if (debug) return { mode, snapshot: snap || null, row: a || null, cf: cfMap };

    const shprCnee =
      a.shpr_cnee ||
      getCF("shpr_cnee") ||
      (deal.org_name ? `CNEE: ${deal.org_name}` : null);

    const origin =
      a.origin_airport || a.origin_iata || getCF("origen_pto");
    const dest =
      a.destination_airport || a.destination_iata || getCF("destino_pto");
    const peso = a.weight_gross_kg ?? getCF("peso_bruto");
    const vol = a.volume_m3 ?? getCF("vol_m3");
    const bultos = a.packages ?? a.pieces ?? getCF("cant_bultos");

    return {
      headerMode: buildHeaderMode("AER"),
      rows: [
        ["REF No:", safe(deal.reference)],
        ["CLIENTE", safe(deal.org_name)],
        ["SHPR / CNEE:", safe(shprCnee)],
        ["LÍNEA AÉREA:", safe(a.airline ?? getCF("linea_aerea"))],
        ["CANTIDAD BULTOS:", safe(bultos)],
        ["MERCADERIA:", safe(a.commodity ?? getCF("mercaderia"))],
        ["AEROPUERTO ORIGEN:", safe(origin)],
        ["DESTINO:", safe(dest)],
        ["PESO:", fmtKg(peso)],
        ["VOLUMEN:", fmtM3(vol)],
        ["FECHA SAL AEROP. ORIGEN (APROX):", fmtDate(a.etd || getCF("f_est_salida"))],
        ["FECHA LLEG. AEROP. TRANSB (APROX):", fmtDate(a.trans_arrival || getCF("llegada_transb"))],
        ["FECHA SAL AEROP. TRANSB (APROX):", fmtDate(a.trans_depart || getCF("salida_transb"))],
        ["FECHA LLEGADA DESTINO (APROX):", fmtDate(a.eta || getCF("llegada_destino"))],
        ["OBS:", safe(a.observations ?? getCF("observaciones"))],
      ],
    };
  }

  /* ===== OCEAN ===== */
  if (mode === "OCEAN") {
    const snap = parseSnap("op_ocean_json");
    const o = snap || (await latestRow("operation_ocean", id)) || {};
    if (debug) return { mode, snapshot: snap || null, row: o || null, cf: cfMap };

    const origin = o.pol ?? getCF("origen_pto");
    const dest = o.pod ?? getCF("destino_pto");
    const peso = o.weight_kg ?? getCF("peso_bruto");
    const vol = o.volume_m3 ?? getCF("vol_m3");
    const bultos = o.packages ?? getCF("cant_bultos");
    const loadType = (o.load_type || tipoCargaCF || "").toUpperCase();

    return {
      headerMode: buildHeaderMode("MAR", loadType),
      rows: [
        ["REF No:", safe(deal.reference)],
        ["CLIENTE", safe(deal.org_name)],
        ["NAVIERA:", safe(o.shipping_line ?? getCF("linea_marit"))],
        ["CANTIDAD BULTOS:", safe(bultos)],
        ["MERCADERIA:", safe(o.commodity ?? getCF("mercaderia"))],
        ["PUERTO ORIGEN:", safe(origin)],
        ["PUERTO TRANSBORDO:", safe(o.transshipment_port ?? getCF("transb_pto"))],
        ["DESTINO:", safe(dest)],
        ["PESO:", fmtKg(peso)],
        ["VOLUMEN:", fmtM3(vol)],
        ["FECHA SAL PTO. ORIGEN (APROX):", fmtDate(o.etd || getCF("f_est_salida"))],
        ["FECHA LLEG. PTO TRANSB (APROX):", fmtDate(o.trans_arrival || getCF("llegada_transb"))],
        ["FECHA SAL PTO TRANSB (APROX):", fmtDate(o.trans_depart || getCF("salida_transb"))],
        ["FECHA LLEGADA DESTINO (APROX):", fmtDate(o.eta || getCF("llegada_destino"))],
        ["OBS:", safe(o.observations ?? getCF("observaciones"))],
      ],
    };
  }

  /* ===== ROAD ===== */
  if (mode === "ROAD") {
    const snap = parseSnap("op_road_json");
    const r = snap || (await latestRow("operation_road", id)) || {};
    if (debug) return { mode, snapshot: snap || null, row: r || null, cf: cfMap };

    const origin = r.origin_city ?? getCF("origen_pto");
    const dest = r.destination_city ?? getCF("destino_pto");
    const peso = r.weight_kg ?? getCF("peso_bruto");
    const vol = r.volume_m3 ?? getCF("vol_m3");
    const bultos = r.packages ?? getCF("cant_bultos");
    const cargoClass = (r.cargo_class || "FTL").toUpperCase();

    return {
      headerMode: buildHeaderMode("TER", cargoClass),
      rows: [
        ["REF No:", safe(deal.reference)],
        ["CLIENTE", safe(deal.org_name)],
        ["CANTIDAD BULTOS:", safe(bultos)],
        ["MERCADERIA:", safe(r.commodity ?? getCF("mercaderia"))],
        ["CIUDAD ORIGEN:", safe(origin)],
        ["CRUCE FRONTERIZO (APROX):", safe(r.border_crossing ?? getCF("cruce_frontera"))],
        ["DESTINO:", safe(dest)],
        ["PESO:", fmtKg(peso)],
        ["VOLUMEN:", fmtM3(vol)],
        ["FECHA SAL ORIGEN (APROX):", fmtDate(r.etd || getCF("f_est_salida"))],
        ["FECHA LLEGADA DESTINO (APROX):", fmtDate(r.eta || getCF("llegada_destino"))],
        ["OBS:", safe(r.observations ?? getCF("observaciones"))],
      ],
    };
  }

  /* ===== MULTIMODAL ===== */
  const snap = parseSnap("op_multimodal_json");
  let m = snap || (await latestRow("operation_multimodal", id)) || {};
  let legs = Array.isArray(m.legs) ? m.legs : null;

  if (!legs) {
    // fallback a tabla operation_legs si existiera
    try {
      const [rows] = await db.query(
        `SELECT * FROM operation_legs WHERE deal_id=? ORDER BY leg_no`,
        [id]
      );
      legs = Array.isArray(rows) ? rows : [];
    } catch (e) {
      if (e?.code === "ER_NO_SUCH_TABLE") {
        legs = [];
      } else {
        throw e;
      }
    }
  }

  if (debug) return { mode: "MULTIMODAL", snapshot: snap || null, row: m || null, legs, cf: cfMap };

  const origin = legs?.[0]?.origin || getCF("origen_pto");
  const destination = legs?.[legs.length - 1]?.destination || getCF("destino_pto");
  const firstEtd = legs?.[0]?.etd || getCF("f_est_salida");
  const eta = legs?.[legs.length - 1]?.eta || getCF("llegada_destino");

  const peso = legs?.[0]?.weight_kg ?? getCF("peso_bruto");
  const vol = legs?.[0]?.volume_m3 ?? getCF("vol_m3");
  const bultos =
    legs?.[0]?.packages ??
    (Array.isArray(m.containers_json) ? m.containers_json.length : getCF("cant_bultos"));

  return {
    headerMode: buildHeaderMode("MULTI"),
    rows: [
      ["REF No:", safe(deal.reference)],
      ["CLIENTE", safe(deal.org_name)],
      ["ORIGEN:", safe(origin)],
      ["DESTINO:", safe(destination)],
      ["CANTIDAD BULTOS:", safe(bultos)],
      ["PESO:", fmtKg(peso)],
      ["VOLUMEN:", fmtM3(vol)],
      ["FECHA SAL ORIGEN (APROX):", fmtDate(firstEtd || m.free_start)],
      ["FECHA TRANSBORDO (APROX):", legs?.length > 1 ? safe(legs[1].origin) : "—"],
      ["FECHA SAL TRANSBORDO (APROX):", legs?.length > 1 ? fmtDate(legs[1].etd) : "—"],
      ["FECHA LLEGADA DESTINO (APROX):", fmtDate(eta || m.free_end)],
      ["OBS:", safe(m.observations ?? getCF("observaciones"))],
    ],
  };
}

/* ===================== RUTAS ===================== */

// Vista previa (HTML) + modo debug
router.get("/status/view/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const deal = await fetchDealCore(id);
    if (!deal) return res.status(404).send("Operación no encontrada");

    if (req.query.debug != null) {
      const raw = await fetchModalData(deal, true);
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      return res.json({ deal, raw });
    }

    const modal = await fetchModalData(deal);
    const html = buildHtml({
      title: `Informe de estado — Operación ${deal.reference || deal.id}`,
      modeText: modal.headerMode,
      rows: modal.rows,
    });

    // Anti-cache fuerte
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (e) {
    console.error("[reports:view]", e);
    res.status(500).send("No se pudo generar la vista.");
  }
});

// PDF idéntico
router.get("/status/:id", async (req, res) => {
  const debug = req.query.debug != null;
  try {
    const id = Number(req.params.id);
    const deal = await fetchDealCore(id);
    if (!deal) return res.status(404).json({ error: "Operación no encontrada" });

    if (debug) {
      const raw = await fetchModalData(deal, true);
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      return res.json({ deal, raw });
    }

    const modal = await fetchModalData(deal);
    const html = buildHtml({
      title: `Informe de estado — Operación ${deal.reference || deal.id}`,
      modeText: modal.headerMode,
      rows: modal.rows,
    });

    const { buffer, exe } = await htmlToPdf(html);

    if (req.query.info != null) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      return res.json({ ok: true, engine: "puppeteer-core", exe, bytes: buffer.length });
    }

    const filename = `informe-estado-${id}.pdf`;
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      req.query.download ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`
    );
    res.end(buffer);
  } catch (e) {
    const msg = e?.message || "";
    if (req.query.debug != null) return res.status(500).json({ ok:false, error: msg });
    if (msg === "CHROME_NOT_FOUND") {
      return res.status(500).json({
        error: "No se encontró Chrome/Edge para generar el PDF idéntico.",
        howto: "Instalá Chrome o seteá PUPPETEER_EXECUTABLE_PATH en el .env del server apuntando al .exe",
      });
    }
    console.error("[reports:pdf]", e);
    res.status(500).json({ error: "No se pudo generar el PDF", detail: msg });
  }
});

// Atajos legacy
router.post("/status/informes", async (req, res) => {
  req.params.id = String(Number(req.body?.deal_id || 0) || "");
  return router.handle({ ...req, method: "GET", url: `/status/${req.params.id}` }, res);
});
router.get("/status", async (req, res) => {
  req.params.id = String(req.query.deal_id || "");
  return router.handle({ ...req, method: "GET", url: `/status/${req.params.id}` }, res);
});

/* ============== Enviar por correo con adjunto PDF ============== */
function buildTransport() {
  return nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT || 587),
    secure: false,
    auth: process.env.MAIL_USER ? { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS } : undefined,
  });
}

router.post("/status/:id/send", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { to, cc, subject, message } = req.body || {};
    if (!to) return res.status(400).json({ error: "Campo 'to' requerido" });

    const deal = await fetchDealCore(id);
    if (!deal) return res.status(404).json({ error: "Operación no encontrada" });

    const modal = await fetchModalData(deal);
    const html = buildHtml({
      title: `Informe de estado — Operación ${deal.reference || deal.id}`,
      modeText: modal.headerMode,
      rows: modal.rows,
    });
    const { buffer } = await htmlToPdf(html);
    const filename = `informe-estado-${deal.reference || id}.pdf`;

    const transporter = buildTransport();
    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.MAIL_USER,
      to, cc,
      subject: subject || `Informe de estado — ${deal.reference || id}`,
      html: message || `<p>Adjuntamos el informe de estado.</p>`,
      attachments: [{ filename, content: buffer, contentType: "application/pdf" }],
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("[reports:send]", e);
    res.status(500).json({ error: "No se pudo enviar el correo", detail: e?.message });
  }
});

export default router;
