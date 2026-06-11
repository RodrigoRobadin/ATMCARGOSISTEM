// server/src/routes/reports.js
import { Router } from "express";
import db from "../services/db.js";
import fs from "fs";
import nodemailer from "nodemailer";
import puppeteer from "puppeteer-core";
import { requireAuth } from "../middlewares/auth.js";

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

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

const fmtMoney = (value, currency = "USD") => {
  const n = num(value);
  if (n === null) return "â€”";
  const curr = String(currency || "USD").toUpperCase();
  const isPyg = curr === "PYG" || curr === "GS";
  return `${isPyg ? "PYG" : curr} ${n.toLocaleString(isPyg ? "es-PY" : "en-US", {
    minimumFractionDigits: isPyg ? 0 : 2,
    maximumFractionDigits: isPyg ? 0 : 2,
  })}`;
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

function parseMaybeJson(raw, fallback = null) {
  if (raw == null || raw === "") return fallback;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function sumCostSheetRows(rows = [], mode = "cargo") {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((acc, row) => {
    const total = num(row?.total ?? row?.totalUsd);
    if (total !== null && !row?.lockPerKg) return acc + total;
    const perKg = num(row?.usdXKg ?? row?.usd_per_kg);
    const weight = num(row?.pesoKg ?? row?.weightKg);
    if (perKg !== null && weight !== null) return acc + perKg * weight;
    const local = num(row?.gs ?? row?.usd ?? row?.monto ?? 0);
    return acc + (local || 0);
  }, 0);
}

function summarizeCostSheet(version) {
  const data = version?.data || {};
  const totals = data?.totals || {};
  const header = data?.header || {};
  const currency = String(header.operationCurrency || header.currency || "USD").toUpperCase();

  const totalCostos =
    num(totals.totalCostos) ??
    num(totals.total_costos) ??
    (sumCostSheetRows(data.compraRows) + sumCostSheetRows(data.locRows) + sumCostSheetRows(data.segCostoRows));
  const totalVentas =
    num(totals.totalVentas) ??
    num(totals.total_ventas) ??
    (sumCostSheetRows(data.ventaRows) + sumCostSheetRows(data.locCliRows) + sumCostSheetRows(data.segVentaRows));
  const profit =
    num(totals.profitGeneral) ??
    num(totals.profit_general) ??
    (Number(totalVentas || 0) - Number(totalCostos || 0));

  return {
    currency,
    totalCostos: Number(totalCostos || 0),
    totalVentas: Number(totalVentas || 0),
    profit: Number(profit || 0),
    rentabilidad: totalVentas ? (Number(profit || 0) / Number(totalVentas || 1)) * 100 : 0,
    rows: {
      compra: Array.isArray(data.compraRows) ? data.compraRows.length : 0,
      venta: Array.isArray(data.ventaRows) ? data.ventaRows.length : 0,
      locales: Array.isArray(data.locRows) ? data.locRows.length : 0,
      localesCliente: Array.isArray(data.locCliRows) ? data.locCliRows.length : 0,
      seguroCosto: Array.isArray(data.segCostoRows) ? data.segCostoRows.length : 0,
      seguroVenta: Array.isArray(data.segVentaRows) ? data.segVentaRows.length : 0,
    },
  };
}

async function safeQuery(sql, params = []) {
  try {
    const [rows] = await db.query(sql, params);
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(e?.code)) return [];
    throw e;
  }
}

async function fetchCurrentCostSheetVersion(dealId) {
  const rows = await safeQuery(
    `SELECT v.*
       FROM deal_cost_sheets s
       JOIN deal_cost_sheet_versions v ON v.id = s.current_version_id
      WHERE s.deal_id = ?
      LIMIT 1`,
    [dealId]
  );
  const row = rows?.[0] || null;
  if (!row) return null;
  return { ...row, data: parseMaybeJson(row.data, {}) || {} };
}

async function fetchOperationReportData(dealId) {
  const deal = await fetchDealCore(dealId);
  if (!deal) return null;

  const [[dealFull] = []] = await db.query(
    `SELECT d.*, o.name AS org_name, o.ruc AS org_ruc, o.email AS org_email, o.address AS org_address,
            c.name AS contact_name, c.email AS contact_email, c.phone AS contact_phone,
            s.name AS stage_name, p.name AS pipeline_name, bu.name AS business_unit_name,
            du.name AS deal_advisor_name, cu.name AS created_by_name
       FROM deals d
       LEFT JOIN organizations o ON o.id = d.org_id
       LEFT JOIN contacts c ON c.id = d.contact_id
       LEFT JOIN stages s ON s.id = d.stage_id
       LEFT JOIN pipelines p ON p.id = d.pipeline_id
       LEFT JOIN business_units bu ON bu.id = d.business_unit_id
       LEFT JOIN users du ON du.id = d.advisor_user_id
       LEFT JOIN users cu ON cu.id = d.created_by_user_id
      WHERE d.id = ?`,
    [dealId]
  );

  const cfMap = await fetchDealCFMap(dealId);
  const currentCostSheetVersion = await fetchCurrentCostSheetVersion(dealId);
  const costSummary = currentCostSheetVersion ? summarizeCostSheet(currentCostSheetVersion) : null;

  const files = await safeQuery(
    `SELECT id, type, filename, url, created_at
       FROM deal_files
      WHERE deal_id = ?
      ORDER BY created_at DESC`,
    [dealId]
  );

  const invoiceDocs = await safeQuery(
    `SELECT id, invoice_number, status, issue_date, due_date, payment_terms,
            currency_code, total_amount, paid_amount, balance, net_total_amount, net_balance
       FROM invoices
      WHERE deal_id = ?
      ORDER BY issue_date DESC, id DESC`,
    [dealId]
  );

  const expenseInvoices = await safeQuery(
    `SELECT id, invoice_date, supplier_name, supplier_ruc, receipt_number, condition_type,
            currency_code, amount_total, paid_amount, balance, status
       FROM operation_expense_invoices
      WHERE operation_id = ? AND operation_type = 'deal'
      ORDER BY invoice_date DESC, id DESC`,
    [dealId]
  );

  const activities = await safeQuery(
    `SELECT id, type, subject, due_date, done, notes, created_at
       FROM activities
      WHERE deal_id = ?
      ORDER BY created_at DESC
      LIMIT 20`,
    [dealId]
  );

  return {
    generatedAt: new Date().toISOString(),
    deal: dealFull || deal,
    customFields: cfMap,
    statusData: await fetchModalData(dealFull || deal).catch(() => null),
    currentCostSheetVersion,
    costSummary,
    files,
    invoices: invoiceDocs,
    expenseInvoices,
    activities,
  };
}

function reportTable(rows) {
  return `<table class="kv">${rows.map(([k, v]) => `
    <tr><th>${escapeHtml(k)}</th><td>${escapeHtml(safe(v))}</td></tr>
  `).join("")}</table>`;
}

function buildOperationReportHtml(data) {
  const d = data.deal || {};
  const cf = data.customFields || {};
  const cost = data.costSummary;
  const files = data.files || [];
  const invoices = data.invoices || [];
  const expenses = data.expenseInvoices || [];
  const activities = data.activities || [];
  const statusRows = data.statusData?.rows || [];
  const title = `Informe interno - ${d.reference || d.id}`;

  const filesRows = files.length ? files.map((f) => `
    <tr><td>${escapeHtml(f.type || "-")}</td><td>${escapeHtml(f.filename || "-")}</td><td>${escapeHtml(fmtDate(f.created_at))}</td></tr>
  `).join("") : `<tr><td colspan="3" class="muted">Sin documentos cargados.</td></tr>`;
  const invoiceRows = invoices.length ? invoices.map((i) => `
    <tr><td>${escapeHtml(i.invoice_number || i.id)}</td><td>${escapeHtml(i.status || "-")}</td><td>${escapeHtml(fmtDate(i.issue_date))}</td><td>${escapeHtml(fmtDate(i.due_date))}</td><td class="num">${escapeHtml(fmtMoney(i.net_total_amount ?? i.total_amount, i.currency_code))}</td><td class="num">${escapeHtml(fmtMoney(i.net_balance ?? i.balance, i.currency_code))}</td></tr>
  `).join("") : `<tr><td colspan="6" class="muted">Sin facturas emitidas.</td></tr>`;
  const expenseRows = expenses.length ? expenses.map((e) => `
    <tr><td>${escapeHtml(fmtDate(e.invoice_date))}</td><td>${escapeHtml(e.supplier_name || "-")}</td><td>${escapeHtml(e.receipt_number || "-")}</td><td>${escapeHtml(e.status || "-")}</td><td class="num">${escapeHtml(fmtMoney(e.amount_total, e.currency_code))}</td><td class="num">${escapeHtml(fmtMoney(e.balance, e.currency_code))}</td></tr>
  `).join("") : `<tr><td colspan="6" class="muted">Sin facturas de compra registradas.</td></tr>`;
  const activityRows = activities.length ? activities.map((a) => `
    <tr><td>${escapeHtml(fmtDate(a.created_at))}</td><td>${escapeHtml(a.type || "-")}</td><td>${escapeHtml(a.subject || a.notes || "-")}</td><td>${escapeHtml(a.done ? "Hecho" : "Pendiente")}</td></tr>
  `).join("") : `<tr><td colspan="4" class="muted">Sin actividades registradas.</td></tr>`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  *{box-sizing:border-box} body{margin:0;background:#f4f6f8;color:#111827;font-family:Arial,Helvetica,sans-serif;font-size:12px}
  .wrap{max-width:1120px;margin:24px auto;padding:0 16px}
  .sheet{background:white;border:1px solid #d8dee8;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(15,23,42,.08)}
  .hero{padding:22px 26px;border-bottom:1px solid #d8dee8;background:#eef2f7;display:flex;justify-content:space-between;gap:24px}
  .eyebrow{font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700}.title{font-size:24px;font-weight:800;margin-top:3px}.meta{color:#475569;margin-top:4px}
  .actions{padding:12px 26px;border-bottom:1px solid #e5e7eb;background:#fff;display:flex;gap:8px;justify-content:flex-end}
  .btn{border:1px solid #cbd5e1;border-radius:8px;padding:8px 11px;text-decoration:none;color:#111827;background:#fff}.btn.primary{background:#111827;color:white;border-color:#111827}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:18px 26px}.section{border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#fff}.section.full{grid-column:1/-1}
  h2{margin:0;padding:10px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-size:13px;text-transform:uppercase;letter-spacing:.03em}
  .body{padding:12px}.kv{width:100%;border-collapse:collapse}.kv th,.kv td{border-bottom:1px solid #eef2f7;padding:7px 8px;vertical-align:top}.kv th{width:38%;text-align:left;color:#475569;background:#fbfdff}
  table.list{width:100%;border-collapse:collapse}.list th,.list td{border-bottom:1px solid #eef2f7;padding:7px 8px;text-align:left}.list th{background:#f8fafc;color:#475569}.num{text-align:right!important;white-space:nowrap}.muted{color:#64748b}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.kpi{border:1px solid #e2e8f0;border-radius:10px;padding:10px;background:#fbfdff}.kpi .label{color:#64748b;font-size:11px}.kpi .value{font-size:16px;font-weight:800;margin-top:2px}
  @media(max-width:800px){.grid{grid-template-columns:1fr}.hero{display:block}.actions{justify-content:flex-start;flex-wrap:wrap}.kpis{grid-template-columns:1fr 1fr}}
  @media print{body{background:white}.wrap{margin:0;max-width:none;padding:0}.sheet{border:0;border-radius:0;box-shadow:none}.actions{display:none}.section{break-inside:avoid}.grid{padding:12px}}
</style>
</head>
<body>
<div class="wrap"><div class="sheet">
  <div class="hero">
    <div>
      <div class="eyebrow">Informe interno por operacion</div>
      <div class="title">${escapeHtml(d.reference || `Operacion ${d.id}`)}</div>
      <div class="meta">${escapeHtml(d.title || "")}</div>
    </div>
    <div class="meta">Generado: ${escapeHtml(new Date(data.generatedAt).toLocaleString("es-PY"))}</div>
  </div>
  <div class="actions">
    <a class="btn" href="#" onclick="window.print();return false;">Imprimir / guardar PDF</a>
    <a class="btn primary" href="/api/reports/operation/${Number(d.id)}/pdf" target="_blank">Descargar PDF</a>
  </div>
  <div class="grid">
    <section class="section">
      <h2>Operacion</h2><div class="body">${reportTable([
        ["Referencia", d.reference],
        ["Pipeline", d.pipeline_name],
        ["Etapa", d.stage_name],
        ["Unidad de negocio", d.business_unit_name],
        ["Ejecutivo", d.deal_advisor_name],
        ["Creado por", d.created_by_name],
        ["Fecha creacion", fmtDate(d.created_at)],
      ])}</div>
    </section>
    <section class="section">
      <h2>Cliente</h2><div class="body">${reportTable([
        ["Cliente", d.org_name],
        ["RUC", d.org_ruc],
        ["Contacto", d.contact_name],
        ["Email contacto", d.contact_email],
        ["Telefono contacto", d.contact_phone],
        ["Direccion", d.org_address],
      ])}</div>
    </section>
    <section class="section full">
      <h2>Resumen comercial</h2>
      <div class="body">
        ${cost ? `<div class="kpis">
          <div class="kpi"><div class="label">Compra</div><div class="value">${escapeHtml(fmtMoney(cost.totalCostos, cost.currency))}</div></div>
          <div class="kpi"><div class="label">Venta</div><div class="value">${escapeHtml(fmtMoney(cost.totalVentas, cost.currency))}</div></div>
          <div class="kpi"><div class="label">Profit</div><div class="value">${escapeHtml(fmtMoney(cost.profit, cost.currency))}</div></div>
          <div class="kpi"><div class="label">Rentabilidad</div><div class="value">${Number(cost.rentabilidad || 0).toFixed(2)}%</div></div>
        </div>` : `<div class="muted">Sin planilla de costos actual.</div>`}
      </div>
    </section>
    <section class="section full">
      <h2>Datos logisticos</h2><div class="body">${reportTable(statusRows.length ? statusRows : [
        ["Modalidad", cf.modalidad_carga],
        ["Tipo de carga", cf.tipo_carga],
        ["Origen", cf.origen_pto],
        ["Destino", cf.destino_pto],
        ["Mercaderia", cf.mercaderia],
        ["Bultos", cf.cant_bultos],
        ["Peso", cf.peso_bruto],
        ["Volumen", cf.vol_m3],
      ])}</div>
    </section>
    <section class="section full">
      <h2>Facturacion emitida</h2><div class="body"><table class="list"><thead><tr><th>Nro.</th><th>Estado</th><th>Emision</th><th>Vencimiento</th><th>Total</th><th>Saldo</th></tr></thead><tbody>${invoiceRows}</tbody></table></div>
    </section>
    <section class="section full">
      <h2>Facturas de compra / gastos</h2><div class="body"><table class="list"><thead><tr><th>Fecha</th><th>Proveedor</th><th>Documento</th><th>Estado</th><th>Total</th><th>Saldo</th></tr></thead><tbody>${expenseRows}</tbody></table></div>
    </section>
    <section class="section full">
      <h2>Documentos</h2><div class="body"><table class="list"><thead><tr><th>Tipo</th><th>Archivo</th><th>Fecha</th></tr></thead><tbody>${filesRows}</tbody></table></div>
    </section>
    <section class="section full">
      <h2>Seguimiento</h2><div class="body"><table class="list"><thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Estado</th></tr></thead><tbody>${activityRows}</tbody></table></div>
    </section>
  </div>
</div></div>
</body></html>`;
}

/* ===================== RUTAS ===================== */

router.get("/operation/:id/data", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const data = await fetchOperationReportData(id);
    if (!data) return res.status(404).json({ error: "Operacion no encontrada" });
    res.json(data);
  } catch (e) {
    console.error("[reports:operation:data]", e);
    res.status(500).json({ error: "No se pudo generar el informe", detail: e?.message });
  }
});

router.get("/operation/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const data = await fetchOperationReportData(id);
    if (!data) return res.status(404).send("Operacion no encontrada");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(buildOperationReportHtml(data));
  } catch (e) {
    console.error("[reports:operation:view]", e);
    res.status(500).send("No se pudo generar el informe.");
  }
});

router.get("/operation/:id/pdf", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const data = await fetchOperationReportData(id);
    if (!data) return res.status(404).json({ error: "Operacion no encontrada" });
    const html = buildOperationReportHtml(data);
    const { buffer } = await htmlToPdf(html);
    const filename = `informe-operacion-${data.deal?.reference || id}.pdf`.replace(/[^\w.-]+/g, "-");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.end(buffer);
  } catch (e) {
    const msg = e?.message || "";
    if (msg === "CHROME_NOT_FOUND") {
      return res.status(500).json({
        error: "No se encontro Chrome/Edge para generar el PDF.",
        howto: "Instala Chrome o configura PUPPETEER_EXECUTABLE_PATH en el .env del server.",
      });
    }
    console.error("[reports:operation:pdf]", e);
    res.status(500).json({ error: "No se pudo generar el PDF", detail: msg });
  }
});

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
