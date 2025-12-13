// server/src/routes/quotes.js
import { Router } from "express";
import db from "../services/db.js";
import { computeQuote } from "../services/quoteEngine.js";
import ExcelJS from "exceljs";

const router = Router();

// asegurar tabla simple para quotes (inputs/computed en JSON)
(async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS quotes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ref_code VARCHAR(100),
        revision VARCHAR(50),
        client_name VARCHAR(255),
        status VARCHAR(50) DEFAULT 'draft',
        inputs_json JSON,
        computed_json JSON,
        created_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch (e) {
    console.error("[quotes] no se pudo crear tabla:", e?.message || e);
  }
})();

function normalizeInputs(body = {}) {
  const inputs = body.inputs || body || {};
  return inputs;
}

router.get("/quotes", async (_req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, ref_code, client_name, status, computed_json, updated_at FROM quotes ORDER BY updated_at DESC"
    );
    const list = rows.map((r) => ({
      id: r.id,
      ref_code: r.ref_code,
      client_name: r.client_name,
      status: r.status,
      total_sales_usd: r.computed_json?.oferta?.totals?.total_sales_usd || null,
      profit_total_usd: r.computed_json?.operacion?.totals?.profit_total_usd || null,
      updated_at: r.updated_at,
    }));
    res.json(list);
  } catch (e) {
    console.error("[quotes][GET] error:", e);
    res.status(500).json({ error: "No se pudo listar cotizaciones" });
  }
});

router.post("/quotes", async (req, res) => {
  try {
    const inputs = normalizeInputs(req.body);
    const computed = computeQuote(inputs);
    const { ref_code, revision, client_name, status, created_by } = inputs;
    const [result] = await db.query(
      `INSERT INTO quotes (ref_code, revision, client_name, status, created_by, inputs_json, computed_json)
       VALUES (?,?,?,?,?,?,?)`,
      [
        ref_code || null,
        revision || null,
        client_name || null,
        status || "draft",
        created_by || null,
        JSON.stringify(inputs),
        JSON.stringify(computed),
      ]
    );
    res.status(201).json({ id: result.insertId, inputs, computed });
  } catch (e) {
    console.error("[quotes][POST] error:", e);
    res.status(500).json({ error: e?.message || "No se pudo crear la cotizacion" });
  }
});

router.get("/quotes/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[row]] = await db.query("SELECT * FROM quotes WHERE id = ?", [id]);
    if (!row) return res.status(404).json({ error: "No encontrada" });
    res.json({
      id: row.id,
      inputs: row.inputs_json || {},
      computed: row.computed_json || null,
      meta: {
        ref_code: row.ref_code,
        revision: row.revision,
        client_name: row.client_name,
        status: row.status,
        updated_at: row.updated_at,
      },
    });
  } catch (e) {
    console.error("[quotes][GET /:id] error:", e);
    res.status(500).json({ error: "No se pudo obtener la cotizacion" });
  }
});

router.put("/quotes/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const inputs = normalizeInputs(req.body);
    const computed = computeQuote(inputs);
    const { ref_code, revision, client_name, status, created_by } = inputs;
    await db.query(
      `UPDATE quotes SET ref_code=?, revision=?, client_name=?, status=?, created_by=?, inputs_json=?, computed_json=? WHERE id=?`,
      [
        ref_code || null,
        revision || null,
        client_name || null,
        status || "draft",
        created_by || null,
        JSON.stringify(inputs),
        JSON.stringify(computed),
        id,
      ]
    );
    res.json({ id, inputs, computed });
  } catch (e) {
    console.error("[quotes][PUT] error:", e);
    res.status(500).json({ error: "No se pudo actualizar la cotizacion" });
  }
});

router.post("/quotes/:id/recalculate", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[row]] = await db.query("SELECT * FROM quotes WHERE id = ?", [id]);
    if (!row) return res.status(404).json({ error: "No encontrada" });
    const inputs = normalizeInputs(row.inputs_json || {});
    const computed = computeQuote(inputs);
    await db.query("UPDATE quotes SET computed_json=? WHERE id=?", [
      JSON.stringify(computed),
      id,
    ]);
    res.json({ id, inputs, computed });
  } catch (e) {
    console.error("[quotes][recalculate] error:", e);
    res.status(500).json({ error: "No se pudo recalcular" });
  }
});

router.post("/quotes/:id/duplicate", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[row]] = await db.query("SELECT * FROM quotes WHERE id = ?", [id]);
    if (!row) return res.status(404).json({ error: "No encontrada" });
    const inputs = row.inputs_json || {};
    const computed = row.computed_json || null;
    const [result] = await db.query(
      `INSERT INTO quotes (ref_code, revision, client_name, status, created_by, inputs_json, computed_json)
       VALUES (?,?,?,?,?,?,?)`,
      [
        `${row.ref_code || "REF"}-COPY`,
        row.revision,
        row.client_name,
        "draft",
        row.created_by,
        JSON.stringify(inputs),
        JSON.stringify(computed),
      ]
    );
    res.status(201).json({ id: result.insertId, inputs, computed });
  } catch (e) {
    console.error("[quotes][duplicate] error:", e);
    res.status(500).json({ error: "No se pudo duplicar la cotizacion" });
  }
});

function applyHeaderFill(cell) {
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD9E1F2" },
  };
  cell.font = { bold: true };
  cell.alignment = { horizontal: "center", vertical: "middle" };
}

function applyInputFill(cell) {
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFFFF2CC" },
  };
}

function borderAll(cell) {
  cell.border = {
    top: { style: "thin" },
    left: { style: "thin" },
    right: { style: "thin" },
    bottom: { style: "thin" },
  };
}

function setTableStyle(row) {
  row.eachCell((cell) => {
    applyHeaderFill(cell);
    borderAll(cell);
  });
}

function numberFmt(sheet, range, fmt) {
  const cells = sheet.getCells ? sheet.getCells(range) : null;
}

function fmtNumber(cell, fmt) {
  cell.numFmt = fmt;
}

function buildWorkbook(inputs = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ATM Cotizador";
  wb.created = new Date();

  const usdFmt = '"$"#,##0.00';
  const gsFmt = '#,##0';
  const pctFmt = '0.00%';
  const qtyFmt = '0.00';

  // HOJA 1: DETALLE OFERTA
  const oferta = wb.addWorksheet("DETALLE OFERTA");
  const colWidths = {
    A: 6, B: 35, C: 8, I: 10,
    J: 14, K: 14, L: 14, M: 14,
    N: 14, O: 14, P: 14, Q: 14,
    R: 14, S: 14, T: 14, U: 14,
  };
  Object.entries(colWidths).forEach(([k, w]) => {
    oferta.getColumn(k).width = w;
  });
  oferta.mergeCells("A1:U1");
  oferta.getCell("A1").value = "DETALLE OFERTA";
  applyHeaderFill(oferta.getCell("A1"));
  oferta.getCell("A1").font = { bold: true, size: 12 };
  oferta.getRow(1).height = 20;

  oferta.getCell("C5").value = "CLIENTE:";
  oferta.getCell("D5").value = inputs.client_name || "";
  applyInputFill(oferta.getCell("D5"));

  oferta.getCell("Q7").value = "RENT %";
  oferta.getCell("R7").value = inputs.rent_rate ?? 0.3;
  applyInputFill(oferta.getCell("R7"));
  fmtNumber(oferta.getCell("R7"), pctFmt);

  oferta.getCell("J16").value = "TOTALES / PUENTE";

  // Encabezado fila 8
  const headers = [
    "ITEM", "DESCRIPCION", "CANT", "", "", "", "", "", "%PART",
    "V. PUERTA", "FLETE INTL", "SEGURO", "VALOR IMP", "DESP. IMP.", "FINAN.", "INSTALAC",
    "SUB TOTAL", "RENT", "ADICIONAL", "TOTAL VENTAS", "PV UNIT",
  ];
  oferta.getRow(8).values = headers;
  setTableStyle(oferta.getRow(8));

  // Filas 9-12 items
  const items = Array.isArray(inputs.items) && inputs.items.length ? inputs.items.slice(0, 4) : [ { line_no: 1, description: "ITEM 1", qty: 1, door_value_usd: 1000 } ];
  for (let i = 0; i < 4; i++) {
    const r = 9 + i;
    const it = items[i] || { line_no: i + 1, description: "", qty: 0, door_value_usd: 0 };
    const row = oferta.getRow(r);
    row.getCell("A").value = it.line_no;
    row.getCell("B").value = it.description;
    row.getCell("C").value = it.qty;
    row.getCell("J").value = it.door_value_usd;
    ["A","B","C","J"].forEach((c)=>applyInputFill(row.getCell(c)));
    fmtNumber(row.getCell("C"), qtyFmt);
    fmtNumber(row.getCell("J"), usdFmt);

    row.getCell("I").value = { formula: "IF($J$17=0,0,$J"+r+"/$J$17*100)" };
    row.getCell("K").value = { formula: "$K$17*I"+r+"%" };
    row.getCell("L").value = { formula: "$L$17*I"+r+"%" };
    row.getCell("M").value = { formula: "SUM(J"+r+":L"+r+")" };
    row.getCell("N").value = { formula: "$N$17*I"+r+"%" };
    row.getCell("O").value = { formula: "$O$17*I"+r+"%" };
    row.getCell("P").value = { formula: "$P$17*I"+r+"%" };
    row.getCell("Q").value = { formula: "M"+r+"+N"+r+"+O"+r+"+P"+r };
    row.getCell("R").value = { formula: "J"+r+"*$R$7" };
    row.getCell("S").value = { formula: "$S$17" };
    row.getCell("T").value = { formula: "Q"+r+"+R"+r+"+S"+r };
    row.getCell("U").value = { formula: "IF(C"+r+"=0,\"\",T"+r+"/C"+r+")" };
    // formatos
    ["K","L","M","N","O","P","Q","R","S","T","U"].forEach((c)=>fmtNumber(row.getCell(c), usdFmt));
    fmtNumber(row.getCell("I"), qtyFmt);
    row.eachCell((cell, col)=> {
      if(col>=9 && col<=21) borderAll(cell);
    });
  }

  // Totales fila 13
  const tRow = oferta.getRow(13);
  tRow.getCell("J").value = { formula: "SUM(J9:J12)" };
  tRow.getCell("K").value = { formula: "SUM(K9:K12)" };
  tRow.getCell("L").value = { formula: "SUM(L9:L12)" };
  tRow.getCell("M").value = { formula: "SUM(M9:M12)" };
  tRow.getCell("N").value = { formula: "SUM(N9:N12)" };
  tRow.getCell("O").value = { formula: "SUM(O9:O12)" };
  tRow.getCell("P").value = { formula: "SUM(P9:P12)" };
  tRow.getCell("Q").value = { formula: "SUM(Q9:Q12)" };
  tRow.getCell("R").value = { formula: "SUM(R9:R12)" };
  tRow.getCell("S").value = { formula: "SUM(S9:S12)" };
  tRow.getCell("T").value = { formula: "SUM(T9:T12)" };
  ["J","K","L","M","N","O","P","Q","R","S","T"].forEach((c)=>fmtNumber(tRow.getCell(c), usdFmt));

  // Fila 17 puente
  oferta.getCell("J17").value = { formula: "J13" };
  oferta.getCell("K17").value = inputs.freight_international_total_usd ?? 0;
  oferta.getCell("L17").value = "'DETALLE OPERACION'!K53";
  oferta.getCell("N17").value = "'COSTO DESPACHO DE IMPORTACION'!G46";
  oferta.getCell("O17").value = "FINANCIACION!K32";
  oferta.getCell("P17").value = "'DETALLE DE INSTALACION'!I18";
  oferta.getCell("S17").value = inputs.additional_global_usd ?? 0;
  ["K17","S17"].forEach((c)=>applyInputFill(oferta.getCell(c)));
  ["J17","K17","L17","N17","O17","P17","S17"].forEach((c)=>fmtNumber(oferta.getCell(c), usdFmt));

  // logistica
  oferta.getCell("B18").value = "BULTOS";
  oferta.getCell("C18").value = inputs.bultos || "";
  applyInputFill(oferta.getCell("C18"));
  oferta.getCell("D18").value = "PESO BRUTO";
  oferta.getCell("E18").value = inputs.peso_bruto || "";
  applyInputFill(oferta.getCell("E18"));
  oferta.getCell("F18").value = "PESO VOL";
  oferta.getCell("G18").value = inputs.peso_vol || "";
  applyInputFill(oferta.getCell("G18"));
  oferta.getCell("B19").value = "DIMENS";
  oferta.getCell("C19").value = inputs.dimens || "";
  applyInputFill(oferta.getCell("C19"));

  oferta.views = [{ state: "frozen", ySplit: 8 }];

  // HOJA 2: COSTO DESPACHO DE IMPORTACION
  const desp = wb.addWorksheet("COSTO DESPACHO DE IMPORTACION");
  desp.mergeCells("A1:K1");
  desp.getCell("A1").value = "COSTO DESPACHO DE IMPORTACION";
  applyHeaderFill(desp.getCell("A1"));
  desp.getCell("A1").font = { bold: true, size: 12 };
  desp.getCell("F22").value = "VALOR IMP (USD)";
  desp.getCell("G22").value = "='DETALLE OFERTA'!M13";
  fmtNumber(desp.getCell("G22"), usdFmt);
  desp.getCell("H22").value = "TC ADUANA (Gs/USD)";
  desp.getCell("I22").value = inputs.exchange_rate_customs_gs_per_usd ?? 0;
  applyInputFill(desp.getCell("I22"));
  fmtNumber(desp.getCell("I22"), gsFmt);

  // Tabla lineas 25-44
  const baseRow = 25;
  const concepts = [
    "Derecho Aduanero",
    "Servicio de Valoracion",
    "Arancel Consular",
    "I.N.D.I.",
    "Impuesto Selectivo al Consumo",
    "I.V.A.",
    "I.V.A. Casual",
    "Tasa Portuaria DINAC (1er periodo)",
    "Decreto 13087",
    "Gastos Terminales ATM",
    "Fotocopias AEDA",
    "Anticipo IRE",
    "Canon Informatico SOFIA",
    "Flete deposito importador",
    "Personal Verificacion",
    "Gastos Tramite Despacho",
    "Honorarios Profesionales",
    "IVA S/Honorarios",
    "Otros",
    "Otros 2",
  ];
  concepts.forEach((name, idx) => {
    const r = baseRow + idx;
    desp.getCell(`B${r}`).value = name;
    borderAll(desp.getCell(`B${r}`));
    // ejemplo formulas
    if (idx === 0) { // derecho % imponible
      desp.getCell(`F${r}`).value = 0;
      desp.getCell(`G${r}`).value = { formula: "$G$22*$F"+r };
      desp.getCell(`I${r}`).value = { formula: "G"+r+"*$I$22" };
    } else if (idx === 1) {
      desp.getCell(`F${r}`).value = 0.005;
      desp.getCell(`G${r}`).value = { formula: "$G$22*$F"+r };
      desp.getCell(`I${r}`).value = { formula: "G"+r+"*$I$22" };
    } else if (idx === 5) { // IVA
      desp.getCell(`F${r}`).value = 0.1;
      desp.getCell(`G${r}`).value = { formula: "($G$22+SUM(G25:G29))*$F"+r };
      desp.getCell(`I${r}`).value = { formula: "G"+r+"*$I$22" };
    } else {
      desp.getCell(`G${r}`).value = 0;
      desp.getCell(`I${r}`).value = { formula: "G"+r+"*$I$22" };
    }
    fmtNumber(desp.getCell(`G${r}`), usdFmt);
    fmtNumber(desp.getCell(`I${r}`), gsFmt);
    ["F","G","I"].forEach((c)=>borderAll(desp.getCell(c+r)));
  });

  desp.getCell("G45").value = { formula: "SUM(G25:G44)" };
  desp.getCell("I45").value = { formula: "SUM(I25:I44)" };
  fmtNumber(desp.getCell("G45"), usdFmt);
  fmtNumber(desp.getCell("I45"), gsFmt);

  desp.getCell("H46").value = "TC INTERNO (Gs/USD)";
  desp.getCell("I46").value = inputs.exchange_rate_customs_internal_gs_per_usd ?? 1;
  applyInputFill(desp.getCell("I46"));
  fmtNumber(desp.getCell("I46"), gsFmt);
  desp.getCell("G46").value = { formula: "I45/$I$46" };
  fmtNumber(desp.getCell("G46"), usdFmt);
  desp.getCell("K47").value = { formula: "G46-G45" };
  fmtNumber(desp.getCell("K47"), usdFmt);

  // HOJA 3: FINANCIACION
  const fin = wb.addWorksheet("FINANCIACION");
  fin.mergeCells("A1:K1");
  fin.getCell("A1").value = "FINANCIACION";
  applyHeaderFill(fin.getCell("A1"));

  // Bloque compra
  fin.mergeCells("A4:K4");
  fin.getCell("A4").value = "COMPRA - INTERESES";
  applyHeaderFill(fin.getCell("A4"));
  fin.getCell("K5").value = inputs.financing_buy_annual_rate ?? 0;
  applyInputFill(fin.getCell("K5"));
  fmtNumber(fin.getCell("K5"), pctFmt);
  fin.getCell("D5").value = { formula: "K5/12" };
  fin.getCell("E5").value = { formula: "D5*2" };
  fin.getCell("F5").value = { formula: "D5*3" };
  fin.getCell("G5").value = { formula: "D5*4" };
  fin.getCell("H5").value = { formula: "D5*5" };
  fin.getCell("I5").value = { formula: "D5*6" };
  ["D5","E5","F5","G5","H5","I5"].forEach((c)=>fmtNumber(fin.getCell(c), pctFmt));
  fin.getCell("C8").value = "='DETALLE OFERTA'!J17";
  fin.getCell("C9").value = "='DETALLE OFERTA'!K17+'DETALLE OFERTA'!L17";
  fin.getCell("C10").value = "='DETALLE OFERTA'!N17";
  fin.getCell("C11").value = "='DETALLE DE INSTALACION'!G18";
  ["C8","C9","C10","C11"].forEach((c)=>fmtNumber(fin.getCell(c), usdFmt));
  ["I8","I9","I10","I11"].forEach((c,idx)=>{
    const r = 8+idx;
    fin.getCell(c).value = { formula: "C"+r+"*$I$5" };
    fmtNumber(fin.getCell(c), usdFmt);
    fin.getCell("K"+r).value = { formula: "SUM(D"+r+":I"+r+")" };
    fmtNumber(fin.getCell("K"+r), usdFmt);
  });
  fin.getCell("K13").value = { formula: "SUM(K8:K11)" };
  fin.getCell("K14").value = { formula: "K13*0.10" };
  fin.getCell("K15").value = { formula: "K13+K14" };
  ["K13","K14","K15"].forEach((c)=>fmtNumber(fin.getCell(c), usdFmt));

  // Bloque venta
  fin.mergeCells("A21:K21");
  fin.getCell("A21").value = "VENTA - INTERESES";
  applyHeaderFill(fin.getCell("A21"));
  fin.getCell("K22").value = inputs.financing_sell_annual_rate ?? 0;
  applyInputFill(fin.getCell("K22"));
  fmtNumber(fin.getCell("K22"), pctFmt);
  fin.getCell("D22").value = { formula: "K22/12" };
  fin.getCell("E22").value = { formula: "D22*2" };
  fin.getCell("F22").value = { formula: "D22*3" };
  fin.getCell("G22").value = { formula: "D22*4" };
  fin.getCell("H22").value = { formula: "D22*5" };
  fin.getCell("I22").value = { formula: "D22*6" };
  ["D22","E22","F22","G22","H22","I22"].forEach((c)=>fmtNumber(fin.getCell(c), pctFmt));
  fin.getCell("C25").value = "='DETALLE OFERTA'!J17";
  fin.getCell("C26").value = "='DETALLE OFERTA'!K17+'DETALLE OFERTA'!L17";
  fin.getCell("C27").value = "='DETALLE OFERTA'!N17";
  fin.getCell("C28").value = "='DETALLE DE INSTALACION'!G18";
  ["C25","C26","C27","C28"].forEach((c)=>fmtNumber(fin.getCell(c), usdFmt));
  ["I25","I26","I27","I28"].forEach((c,idx)=>{
    const r = 25+idx;
    fin.getCell(c).value = { formula: "C"+r+"*$I$22" };
    fmtNumber(fin.getCell(c), usdFmt);
    fin.getCell("K"+r).value = { formula: "SUM(D"+r+":I"+r+")" };
    fmtNumber(fin.getCell("K"+r), usdFmt);
  });
  fin.getCell("K30").value = { formula: "SUM(K25:K28)" };
  fin.getCell("K31").value = { formula: "K30*0.10" };
  fin.getCell("K32").value = { formula: "K30+K31" };
  fin.getCell("K35").value = { formula: "K32-K15" };
  ["K30","K31","K32","K35"].forEach((c)=>fmtNumber(fin.getCell(c), usdFmt));

  // HOJA 4: DETALLE DE INSTALACION
  const inst = wb.addWorksheet("DETALLE DE INSTALACION");
  inst.mergeCells("A1:L1");
  inst.getCell("A1").value = "DETALLE DE INSTALACION";
  applyHeaderFill(inst.getCell("A1"));
  inst.getCell("K3").value = "TC";
  inst.getCell("L3").value = inputs.exchange_rate_install_gs_per_usd ?? 1;
  applyInputFill(inst.getCell("L3"));
  fmtNumber(inst.getCell("L3"), gsFmt);
  const headersInst = ["ITEM","DESCRIPCION","CANT","","","COSTO UNIT","COSTO TOTAL","VENTA UNIT","VENTA TOTAL","PROFIT GS","VENTA USD","PROFIT USD"];
  inst.getRow(6).values = headersInst;
  setTableStyle(inst.getRow(6));
  for(let i=0;i<10;i++){
    const r=7+i;
    inst.getCell(`A${r}`).value = i+1;
    applyInputFill(inst.getCell(`B${r}`));
    applyInputFill(inst.getCell(`C${r}`));
    applyInputFill(inst.getCell(`F${r}`));
    applyInputFill(inst.getCell(`H${r}`));
    fmtNumber(inst.getCell(`C${r}`), qtyFmt);
    fmtNumber(inst.getCell(`F${r}`), gsFmt);
    fmtNumber(inst.getCell(`H${r}`), gsFmt);
    inst.getCell(`G${r}`).value = { formula: `F${r}*C${r}` };
    inst.getCell(`I${r}`).value = { formula: `H${r}*C${r}` };
    inst.getCell(`J${r}`).value = { formula: `I${r}-G${r}` };
    inst.getCell(`K${r}`).value = { formula: `I${r}/$L$3` };
    inst.getCell(`L${r}`).value = { formula: `J${r}/$L$3` };
    ["G","I","J"].forEach((c)=>fmtNumber(inst.getCell(c+r), gsFmt));
    ["K","L"].forEach((c)=>fmtNumber(inst.getCell(c+r), usdFmt));
  }
  inst.getCell("G17").value = { formula: "SUM(G7:G16)" };
  inst.getCell("I17").value = { formula: "SUM(I7:I16)" };
  inst.getCell("J17").value = { formula: "SUM(J7:J16)" };
  ["G17","I17","J17"].forEach((c)=>fmtNumber(inst.getCell(c), gsFmt));
  inst.getCell("G18").value = { formula: "G17/$L$3" };
  inst.getCell("I18").value = { formula: "I17/$L$3" };
  inst.getCell("J18").value = { formula: "J17/$L$3" };
  ["G18","I18","J18"].forEach((c)=>fmtNumber(inst.getCell(c), usdFmt));

  // HOJA 5: DETALLE OPERACION
  const op = wb.addWorksheet("DETALLE OPERACION");
  op.mergeCells("A1:P1");
  op.getCell("A1").value = "DETALLE OPERACION";
  applyHeaderFill(op.getCell("A1"));
  op.getCell("B12").value = "CLIENTE";
  op.getCell("C12").value = "='DETALLE OFERTA'!D5";
  op.getCell("L19").value = inputs.exchange_rate_operation_buy_usd ?? 1;
  applyInputFill(op.getCell("L19"));
  op.getCell("L20").value = inputs.exchange_rate_operation_sell_usd ?? 1;
  applyInputFill(op.getCell("L20"));
  fmtNumber(op.getCell("L19"), gsFmt);
  fmtNumber(op.getCell("L20"), gsFmt);

  op.getCell("D25").value = "CARGOS";
  op.getCell("E25").value = "COMPRA USD";
  op.getCell("K25").value = "VENTA USD";
  op.getCell("L25").value = "PROFIT USD";
  [op.getCell("D25"),op.getCell("E25"),op.getCell("K25"),op.getCell("L25")].forEach(applyHeaderFill);

  op.getCell("D26").value = "Puertas";
  op.getCell("E26").value = "='DETALLE OFERTA'!J13";
  op.getCell("K26").value = "='DETALLE OFERTA'!J13+'DETALLE OFERTA'!R13";
  op.getCell("L26").value = "=K26-E26";

  op.getCell("D27").value = "Flete terrestre";
  op.getCell("E27").value = inputs.freight_buy_usd ?? 0;
  applyInputFill(op.getCell("E27"));
  op.getCell("K27").value = "='DETALLE OFERTA'!K17";
  op.getCell("L27").value = "=K27-E27";

  op.getCell("D28").value = "Despacho aduanero";
  op.getCell("E28").value = "'COSTO DESPACHO DE IMPORTACION'!G45";
  op.getCell("K28").value = "'COSTO DESPACHO DE IMPORTACION'!G46";
  op.getCell("L28").value = "=K28-E28";

  op.getCell("D29").value = "Adicional";
  op.getCell("E29").value = 0;
  op.getCell("K29").value = "='DETALLE OFERTA'!S17";
  op.getCell("L29").value = "=K29-E29";

  op.getCell("D30").value = "Financiacion";
  op.getCell("E30").value = "=FINANCIACION!K15";
  op.getCell("K30").value = "=FINANCIACION!K32";
  op.getCell("L30").value = "=K30-E30";

  op.getCell("E34").value = "=SUM(E26:E33)";
  op.getCell("K34").value = "=SUM(K26:K33)";
  op.getCell("L34").value = "=SUM(L26:L33)";

  op.getCell("D38").value = "INSTALACION (Gs)";
  op.getCell("E38").value = "='DETALLE DE INSTALACION'!G17";
  op.getCell("K38").value = "='DETALLE DE INSTALACION'!I17";
  op.getCell("L38").value = "=K38-E38";
  op.getCell("E45").value = "=SUM(E37:E44)";
  op.getCell("K45").value = "=SUM(K37:K44)";
  op.getCell("L45").value = "=SUM(L37:L44)";
  op.getCell("E46").value = "=E45/$L$19";
  op.getCell("K46").value = "=K45/$L$20";
  op.getCell("L46").value = "=K46-E46";

  op.getCell("D49").value = "Seguro de carga";
  op.getCell("E49").value = "=E26*0.0022";
  op.getCell("K49").value = inputs.insurance_sale_total_usd ?? 0;
  applyInputFill(op.getCell("K49"));
  op.getCell("L49").value = "=K49-E49";
  op.getCell("E53").value = "=E49";
  op.getCell("K53").value = "=K49";
  op.getCell("L53").value = "=L49";
  // K53 alimenta oferta!L17

  op.getCell("E55").value = "=E34+E46+E53";
  op.getCell("K55").value = "=K34+K46+K53";
  op.getCell("L55").value = "=K55-E55";
  op.getCell("E58").value = "PROFIT TOTAL";
  op.getCell("F58").value = "=L55";
  op.getCell("E62").value = "PROFIT VENDEDOR 15%";
  op.getCell("F62").value = "=F58*0.15";
  op.getCell("E64").value = "PROFIT FINAL";
  op.getCell("F64").value = "=F58-F62";

  return wb;
}

router.get("/quotes/:id/export-xlsx", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[row]] = await db.query("SELECT * FROM quotes WHERE id = ?", [id]);
    if (!row) return res.status(404).json({ error: "No encontrada" });
    const inputs = row.inputs_json || {};
    const wb = buildWorkbook(inputs);
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=quote-${id}.xlsx`);
    res.send(Buffer.from(buffer));
  } catch (e) {
    console.error("[quotes][export-xlsx] error:", e);
    res.status(500).json({ error: "No se pudo exportar XLSX (instale exceljs en server)" });
  }
});

export default router;
