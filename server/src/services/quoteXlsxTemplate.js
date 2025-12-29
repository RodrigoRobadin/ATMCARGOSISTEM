// server/src/services/quoteXlsxTemplate.js
import ExcelJS from "exceljs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Poné aquí tu template dentro del repo
const TEMPLATE_PATH = path.join(
  __dirname,
  "..",
  "templates",
  "DETALLE_CALCULO_TEMPLATE.xlsx"
);

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function setCell(ws, addr, value) {
  const cell = ws.getCell(addr);
  cell.value = value;
  return cell;
}

// Copia estilo + valor/formula de una fila a otra (y ajusta referencias de fila)
function shiftFormula(formula, srcRow, dstRow) {
  if (typeof formula !== "string") return formula;
  // reemplaza A9, B9, ... AA9 por A{dstRow} manteniendo $A$9 intacto
  const re = new RegExp(`(\\$?[A-Z]{1,3}\\$?)${srcRow}\\b`, "g");
  return formula.replace(re, (m, col) => `${col}${dstRow}`);
}

function cloneRow(ws, srcRow, dstRow) {
  const sRow = ws.getRow(srcRow);
  const dRow = ws.getRow(dstRow);

  dRow.height = sRow.height;

  sRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const target = dRow.getCell(colNumber);

    // estilo
    target.style = { ...cell.style };
    target.numFmt = cell.numFmt;

    // valor / formula
    const v = cell.value;

    if (v && typeof v === "object" && v.formula) {
      target.value = {
        ...v,
        formula: shiftFormula(v.formula, srcRow, dstRow),
      };
    } else if (typeof v === "string") {
      target.value = v;
    } else {
      target.value = v;
    }
  });

  dRow.commit();
}

function updateTotalsFormula(ws, totalsRow, startRow, endRow, cols) {
  cols.forEach((col) => {
    const addr = `${col}${totalsRow}`;
    const cell = ws.getCell(addr);
    cell.value = { formula: `SUM(${col}${startRow}:${col}${endRow})` };
  });
}

export async function buildQuoteXlsxBuffer(inputs = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH);

  // OJO: tu archivo tiene algunos sheets con espacio al final.
  // Los referenciamos por "includes" para que no te falle si cambia.
  const sheetBy = (name) =>
    wb.worksheets.find((s) => s.name.trim() === name.trim());

  const wsOferta = sheetBy("DETALLE OFERTA");
  const wsDesp = wb.worksheets.find((s) => s.name.trim() === "COSTO DESPACHO DE IMPORTACION");
  const wsFin = sheetBy("FINANCIACION");
  const wsInst = wb.worksheets.find((s) => s.name.trim() === "DETALLE DE INSTALACION");
  const wsOp = wb.worksheets.find((s) => s.name.trim() === "DETALLE OPERACION");

  if (!wsOferta) throw new Error("Template: no existe sheet DETALLE OFERTA");
  if (!wsDesp) throw new Error("Template: no existe sheet COSTO DESPACHO DE IMPORTACION");
  if (!wsFin) throw new Error("Template: no existe sheet FINANCIACION");
  if (!wsInst) throw new Error("Template: no existe sheet DETALLE DE INSTALACION");
  if (!wsOp) throw new Error("Template: no existe sheet DETALLE OPERACION");

  // -----------------------
  // DETALLE OFERTA (inputs amarillos)
  // -----------------------
  setCell(wsOferta, "D5", inputs.client_name || "");
  setCell(wsOferta, "R7", isNum(inputs.rent_rate) ? inputs.rent_rate : Number(inputs.rent_rate || 0));

  // Puente:
  // K17 = Flete Intl Total (USD) (input)
  // S17 = Adicional total (USD) (input)
  setCell(wsOferta, "K17", Number(inputs.freight_international_total_usd || 0));
  setCell(wsOferta, "S17", Number(inputs.additional_global_usd || 0));

  // Logística (según tu Excel real)
  // DIM (D17), CAJA (D18), KG (D19)
  if (inputs.dimens != null) setCell(wsOferta, "D17", String(inputs.dimens));
  if (inputs.caja != null) setCell(wsOferta, "D18", Number(inputs.caja || 0));
  if (inputs.kg != null) setCell(wsOferta, "D19", Number(inputs.kg || 0));

  // Items: en tu Excel real son 3 filas base (9-11)
  // B = item, C = cant, D = descripcion, J = valor puerta
  const baseStart = 9;
  const baseEnd = 11;

  const items = Array.isArray(inputs.items) ? inputs.items : [];
  const needed = Math.max(items.length, 1);

  // Si hay más ítems que el template, insertamos filas y clonamos la última fila base (11)
  if (needed > (baseEnd - baseStart + 1)) {
    const extra = needed - (baseEnd - baseStart + 1);
    // Insertamos abajo de la fila 11, antes de la 12/13
    // ExcelJS: spliceRows(pos, deleteCount, ...rows)
    // Creamos filas vacías y luego clonamos
    for (let i = 0; i < extra; i++) {
      const insertAt = baseEnd + 1 + i;
      wsOferta.spliceRows(insertAt, 0, []);
      cloneRow(wsOferta, baseEnd, insertAt); // clona estilo + formulas ajustadas
    }
  }

  const finalEnd = baseStart + needed - 1;

  // Rellenar items
  for (let i = 0; i < needed; i++) {
    const r = baseStart + i;
    const it = items[i] || { line_no: i + 1, qty: 0, description: "", door_value_usd: 0 };
    setCell(wsOferta, `B${r}`, Number(it.line_no ?? i + 1));
    setCell(wsOferta, `C${r}`, Number(it.qty || 0));
    setCell(wsOferta, `D${r}`, String(it.description || ""));
    setCell(wsOferta, `J${r}`, Number(it.door_value_usd || 0));
  }

  // Actualizar fila de totales (13) para sumar hasta finalEnd
  // En tu Excel, totales están en fila 13
  updateTotalsFormula(wsOferta, 13, baseStart, finalEnd, ["J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T"]);

  // -----------------------
  // COSTO DESPACHO DE IMPORTACION
  // -----------------------
  // I22 = TC ADUANA (Gs/USD)
  if (inputs.exchange_rate_customs_gs_per_usd != null) {
    setCell(wsDesp, "I22", Number(inputs.exchange_rate_customs_gs_per_usd || 0));
  }

  // Si querés que el sistema pueda editar tasas/valores por línea:
  // mapeamos por nombre (col B 25..44) y editamos F (rate) o G (fixed)
  const customs = Array.isArray(inputs.customs_lines) ? inputs.customs_lines : [];
  if (customs.length) {
    const map = new Map();
    for (let r = 25; r <= 44; r++) {
      const name = String(wsDesp.getCell(`B${r}`).value || "").trim().toLowerCase();
      if (name) map.set(name, r);
    }

    customs.forEach((l) => {
      const key = String(l.name || l.label || "").trim().toLowerCase();
      const row = map.get(key);
      if (!row) return;

      if (l.type === "FIXED_USD") {
        setCell(wsDesp, `G${row}`, Number(l.amount_usd || 0)); // fijo en USD
      } else if (l.type === "PERCENT_OF_IMPONIBLE_USD" || l.type === "IVA_PERCENT_OF_BASE_USD") {
        setCell(wsDesp, `F${row}`, Number(l.rate_decimal || 0)); // porcentaje
      } else if (l.type === "FIXED_GS") {
        // tu template trabaja en USD en G y convierte a Gs en I,
        // si necesitás FIXED_GS real, se puede agregar una celda auxiliar.
        // Por ahora lo dejamos sin tocar para no romper formulas.
      }
    });
  }

  // -----------------------
  // FINANCIACION
  // -----------------------
  if (inputs.financing_buy_annual_rate != null) {
    setCell(wsFin, "K5", Number(inputs.financing_buy_annual_rate || 0));
  }
  if (inputs.financing_sell_annual_rate != null) {
    setCell(wsFin, "K22", Number(inputs.financing_sell_annual_rate || 0));
  }

  // -----------------------
  // DETALLE DE INSTALACION
  // -----------------------
  if (inputs.exchange_rate_install_gs_per_usd != null) {
    setCell(wsInst, "L3", Number(inputs.exchange_rate_install_gs_per_usd || 1));
  }

  const instItems = Array.isArray(inputs.install_items) ? inputs.install_items : [];
  const instStart = 7;
  const instBaseEnd = 16; // tu template tiene 10 filas
  const instNeed = Math.max(instItems.length, 0);

  if (instNeed > (instBaseEnd - instStart + 1)) {
    const extra = instNeed - (instBaseEnd - instStart + 1);
    for (let i = 0; i < extra; i++) {
      const insertAt = instBaseEnd + 1 + i;
      wsInst.spliceRows(insertAt, 0, []);
      cloneRow(wsInst, instBaseEnd, insertAt);
    }
  }

  for (let i = 0; i < instNeed; i++) {
    const r = instStart + i;
    const l = instItems[i];
    // En tu template:
    // B = item, C = cant, D = descripcion, G = costo unit gs, I = venta unit gs
    setCell(wsInst, `B${r}`, Number(l.line_no ?? i + 1));
    setCell(wsInst, `C${r}`, Number(l.qty || 0));
    setCell(wsInst, `D${r}`, String(l.description || ""));
    setCell(wsInst, `G${r}`, Number(l.unit_cost_gs || 0));
    setCell(wsInst, `I${r}`, Number(l.unit_price_gs || 0));
  }

  // -----------------------
  // DETALLE OPERACION (inputs)
  // -----------------------
  if (inputs.exchange_rate_operation_buy_usd != null) {
    setCell(wsOp, "L19", Number(inputs.exchange_rate_operation_buy_usd || 1));
  }
  if (inputs.exchange_rate_operation_sell_usd != null) {
    setCell(wsOp, "L20", Number(inputs.exchange_rate_operation_sell_usd || 1));
  }
  if (inputs.freight_buy_usd != null) {
    setCell(wsOp, "E27", Number(inputs.freight_buy_usd || 0));
  }
  if (inputs.insurance_sale_total_usd != null) {
    setCell(wsOp, "K49", Number(inputs.insurance_sale_total_usd || 0));
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export default buildQuoteXlsxBuffer;