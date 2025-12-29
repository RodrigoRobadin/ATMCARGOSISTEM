// server/src/services/quoteEngine.js
// Motor deterministico de cotizacion alineado a tus 5 hojas (Oferta, Despacho, Financiación, Instalación, Operación).

const SCALE = 1_000_000n;

function toBig(value) {
  if (value === null || value === undefined || value === "") return 0n;
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) return 0n;
  return BigInt(Math.round(num * Number(SCALE)));
}
function fromBig(b) {
  return Number(b) / Number(SCALE);
}
function add(a, b) {
  return a + b;
}
function sub(a, b) {
  return a - b;
}
function mul(a, b) {
  return (a * b) / SCALE;
}
function div(a, b) {
  if (b === 0n) return 0n;
  return (a * SCALE) / b;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function sumBig(arr) {
  return arr.reduce((acc, v) => acc + v, 0n);
}
function sumNum(arr) {
  return arr.reduce((acc, v) => acc + Number(v || 0), 0);
}

// helpers despacho
function lineByName(customs_lines, name) {
  const arr = Array.isArray(customs_lines) ? customs_lines : [];
  return arr.find((x) => (x?.name || "").trim().toLowerCase() === name.trim().toLowerCase()) || null;
}
function rateOf(customs_lines, name, fallbackRate = 0) {
  const l = lineByName(customs_lines, name);
  const r = Number(l?.rate_decimal);
  return Number.isFinite(r) ? r : fallbackRate;
}
function amountUsdOf(customs_lines, name, fallbackAmount = 0) {
  const l = lineByName(customs_lines, name);
  const a = Number(l?.amount_usd);
  return Number.isFinite(a) ? a : fallbackAmount;
}

export function computeQuote(inputs = {}) {
  const {
    // negocio
    rent_rate = 0.3, // 30% default
    freight_international_total_usd = 0,
    insurance_sale_total_usd = 0,

    // adicional: AHORA ES POR ITEM
    additional_global_usd = 0, // se usa como "default" por item si el item no trae adicional_usd

    // seguros
    insurance_buy_rate = 0,
    insurance_profit_mode = "CORRECTED",

    // tipos de cambio
    exchange_rate_customs_gs_per_usd = 0, // TC Aduana (Gs/USD)
    exchange_rate_customs_internal_gs_per_usd = 7000, // TC interno para vender despacho
    exchange_rate_install_gs_per_usd = 1,
    exchange_rate_operation_buy_usd = 1,
    exchange_rate_operation_sell_usd = 1,

    // datos
    items = [],
    install_items = [],
    customs_lines = [],

    // financiación
    financing_buy_annual_rate = 0,
    financing_sell_annual_rate = 0,
    financing_term_months = 0,
    financing_surcharge_rate = 0,

    // flete compra (operación)
    freight_buy_usd = 0,
  } = inputs;

  const rentRate = Number(rent_rate || 0);

  /* ================= INSTALACION ================= */
  const instArray = Array.isArray(install_items) ? install_items : [];
  const instLines = instArray.map((l) => {
    const qty = toBig(l.qty || 0);
    const unitCost = toBig(l.unit_cost_gs || 0);
    const unitPrice = toBig(l.unit_price_gs || 0);
    const totalCostGs = mul(qty, unitCost);
    const totalSaleGs = mul(qty, unitPrice);
    const profitGs = sub(totalSaleGs, totalCostGs);
    const saleUsd = div(totalSaleGs, toBig(exchange_rate_install_gs_per_usd || 1));
    const profitUsd = div(profitGs, toBig(exchange_rate_install_gs_per_usd || 1));
    return {
      ...l,
      total_cost_gs: fromBig(totalCostGs),
      total_sale_gs: fromBig(totalSaleGs),
      profit_gs: fromBig(profitGs),
      sale_usd: fromBig(saleUsd),
      profit_usd: fromBig(profitUsd),
    };
  });

  const installation_total_cost_gs = fromBig(sumBig(instLines.map((l) => toBig(l.total_cost_gs))));
  const installation_total_sale_gs = fromBig(sumBig(instLines.map((l) => toBig(l.total_sale_gs))));
  const installation_total_profit_gs = fromBig(sumBig(instLines.map((l) => toBig(l.profit_gs))));

  const installation_total_cost_usd = installation_total_cost_gs / (exchange_rate_install_gs_per_usd || 1);
  const installation_total_sale_usd = installation_total_sale_gs / (exchange_rate_install_gs_per_usd || 1);
  const installation_total_profit_usd = installation_total_profit_gs / (exchange_rate_install_gs_per_usd || 1);

  /* ================= OFERTA (prorrateo por puerta) ================= */
  const itemsArr = Array.isArray(items) ? items : [];
  const total_door_usd = sumNum(itemsArr.map((r) => r.door_value_usd));
  const hasDoors = total_door_usd > 0;

  const total_flete_usd = Number(freight_international_total_usd || 0);
  const total_seguro_usd = Number(insurance_sale_total_usd || 0);

  const ofertaBase = itemsArr.map((it, idx) => {
    const doorVal = Number(it.door_value_usd || 0);
    const participation = hasDoors ? doorVal / total_door_usd : 0;
    const flete_i = total_flete_usd * participation;
    const seguro_i = total_seguro_usd * participation;
    const valor_imp_i = doorVal + flete_i + seguro_i; // CIF
    return {
      line_no: it.line_no ?? idx + 1,
      description: it.description || "",
      qty: Number(it.qty || 0),
      door_value_usd: doorVal,
      participation,
      flete_base: flete_i,
      seguro_base: seguro_i,
      valor_imp_base: valor_imp_i, // CIF por item
      adicional_input: Number(it.additional_usd ?? additional_global_usd ?? 0), // adicional por item
    };
  });

  const valorImpTotal = sumNum(ofertaBase.map((r) => r.valor_imp_base)); // CIF TOTAL
  const imponibleBig = toBig(valorImpTotal);

  /* ================= DESPACHO (FORMULAS FIJAS como tu Excel) =================
     Base: Valor Imponible = CIF = Puertas + Flete + Seguro
  */
  const tcAduana = Number(exchange_rate_customs_gs_per_usd || 0);
  const tcInterno = Number(exchange_rate_customs_internal_gs_per_usd || 1);

  // Rates (editable desde customs_lines)
  const rDerecho = rateOf(customs_lines, "Derecho Aduanero", 0);
  const rServVal = rateOf(customs_lines, "Servicio de Valoración", 0.005);
  const aArancel = amountUsdOf(customs_lines, "Arancel Consular", 55);

  const rINDI = rateOf(customs_lines, "I.N.D.I.", 0.07);
  const rISC = rateOf(customs_lines, "Impuesto Selectivo al Consumo", 0);
  const rIVA = rateOf(customs_lines, "I.V.A.", 0.1);
  const rIVACasual = rateOf(customs_lines, "I.V.A. Casual", 0);
  const rDINAC = rateOf(customs_lines, "Tasa Portuaria DINAC (1er periodo)", 0.02);

  const aDecreto13087 = amountUsdOf(customs_lines, "Decreto 13087", 0);
  const aGastosTerminales = amountUsdOf(customs_lines, "Gastos Terminales ATM", 0);
  const aFotocopias = amountUsdOf(customs_lines, "Fotocopias AEDA", 10);
  const rAnticipoIRE = rateOf(customs_lines, "Anticipo IRE", 0.004);
  const aCanonSofia = amountUsdOf(customs_lines, "Canon Informático SOFIA", 30);

  const aFleteDeposito = amountUsdOf(customs_lines, "Flete hasta depósito Importador", 0);
  const aPersonalVerif = amountUsdOf(customs_lines, "Personal p/ Verificación, Estiba", 0);
  const aGastosTramite = amountUsdOf(customs_lines, "Gastos de Trámite Despacho", 100);

  const rHonorarios = rateOf(customs_lines, "Honorarios Profesionales", 0.02);
  const rIVASHonor = rateOf(customs_lines, "I.V.A. S/ Honorarios", 0.1);

  const imponible = fromBig(imponibleBig);

  const derecho = imponible * rDerecho;
  const servVal = imponible * rServVal;
  const arancel = aArancel;
  const indi = arancel * rINDI;

  // ISC = (Imponible + Derecho + ServVal + Arancel) * rISC
  const iscBase = imponible + derecho + servVal + arancel;
  const isc = iscBase * rISC;

  // IVA = (Imponible + Derecho + ServVal + Arancel + INDI + ISC) * rIVA
  const ivaBase = imponible + derecho + servVal + arancel + indi + isc;
  const iva = ivaBase * rIVA;

  // IVA Casual = IVA * rIVACasual (en tu ejemplo es 0)
  const ivaCasual = iva * rIVACasual;

  // DINAC = Imponible * rDINAC
  const dinac = imponible * rDINAC;

  const decreto13087 = aDecreto13087;
  const gastosTerminales = aGastosTerminales;
  const fotocopias = aFotocopias;
  const anticipoIRE = imponible * rAnticipoIRE;
  const canonSofia = aCanonSofia;

  const fleteDeposito = aFleteDeposito;
  const personalVerif = aPersonalVerif;
  const gastosTramite = aGastosTramite;

  // Honorarios = Imponible * rHonorarios
  const honorarios = imponible * rHonorarios;

  // IVA S/Honorarios = (Honorarios + GastosTramite) * rIVASHonor
  const ivaSHonor = (honorarios + gastosTramite) * rIVASHonor;

  const customsLinesOut = [
    { name: "Derecho Aduanero", usd: derecho },
    { name: "Servicio de Valoración", usd: servVal },
    { name: "Arancel Consular", usd: arancel },
    { name: "I.N.D.I.", usd: indi },
    { name: "Impuesto Selectivo al Consumo", usd: isc, base_isc_usd: round2(iscBase) },
    { name: "I.V.A.", usd: iva, base_iva_usd: round2(ivaBase) },
    { name: "I.V.A. Casual", usd: ivaCasual },
    { name: "Tasa Portuaria DINAC (1er periodo)", usd: dinac },
    { name: "Decreto 13087", usd: decreto13087 },
    { name: "Gastos Terminales ATM", usd: gastosTerminales },
    { name: "Fotocopias AEDA", usd: fotocopias },
    { name: "Anticipo IRE", usd: anticipoIRE },
    { name: "Canon Informático SOFIA", usd: canonSofia },
    { name: "Flete hasta depósito Importador", usd: fleteDeposito },
    { name: "Personal p/ Verificación, Estiba", usd: personalVerif },
    { name: "Gastos de Trámite Despacho", usd: gastosTramite },
    { name: "Honorarios Profesionales", usd: honorarios },
    { name: "I.V.A. S/ Honorarios", usd: ivaSHonor, base_iva_honor_usd: round2(honorarios + gastosTramite) },
  ].map((l) => {
    const usdBig = toBig(l.usd || 0);
    const gsBig = mul(usdBig, toBig(tcAduana || 0));
    return {
      ...l,
      usd: round2(Number(l.usd || 0)),
      gs: Math.round(fromBig(gsBig)),
    };
  });

  const customs_total_usd_theoretical = sumNum(customsLinesOut.map((l) => l.usd));
  const customs_total_gs = sumNum(customsLinesOut.map((l) => l.gs));
  const customs_total_sale_usd = customs_total_gs / (tcInterno || 1);
  const customs_exchange_diff_usd = customs_total_sale_usd - customs_total_usd_theoretical;

  /* ================= FINANCIACION ================= */
  const base_door = total_door_usd;
  const base_flete_seguro = total_flete_usd + total_seguro_usd;
  const base_despacho = customs_total_sale_usd;
  const base_install_cost = installation_total_cost_usd;

  const monthly_buy = Number(financing_buy_annual_rate || 0) / 12;
  const monthly_sell = Number(financing_sell_annual_rate || 0) / 12;
  const term_months = Number(financing_term_months || 0);
  const surcharge_rate = Number(financing_surcharge_rate || 0);

  const financingBases = [
    { key: "puertas", base: base_door },
    { key: "flete_seguro", base: base_flete_seguro },
    { key: "despacho", base: base_despacho },
    { key: "instalacion", base: base_install_cost },
  ];

  const finLines = financingBases.map((b) => {
    const interest_buy = b.base * monthly_buy * term_months;
    const interest_sell = b.base * monthly_sell * term_months;
    const buy_surcharge = interest_buy * surcharge_rate;
    const sell_surcharge = interest_sell * surcharge_rate;
    return {
      key: b.key,
      base: b.base,
      interest_buy,
      interest_sell,
      buy_surcharge,
      sell_surcharge,
      total_buy: interest_buy + buy_surcharge,
      total_sell: interest_sell + sell_surcharge,
    };
  });

  const financing_total_buy_usd = sumNum(finLines.map((l) => l.total_buy));
  const financing_total_sale_usd = sumNum(finLines.map((l) => l.total_sell));
  const financing_margin_usd = financing_total_sale_usd - financing_total_buy_usd;

  /* ================= OFERTA COMPLETA ================= */
  const total_instal_usd = installation_total_sale_usd;
  const total_finan_usd = financing_total_sale_usd;
  const total_despacho_usd = customs_total_sale_usd;

  const ofertaItemsFull = ofertaBase.map((r) => {
    const flete_i = total_flete_usd * r.participation;
    const seguro_i = total_seguro_usd * r.participation;
    const despacho_i = total_despacho_usd * r.participation;
    const finan_i = total_finan_usd * r.participation;
    const instal_i = total_instal_usd * r.participation;

    const valor_imp_i = r.door_value_usd + flete_i + seguro_i; // CIF por item
    const sub_total_i = valor_imp_i + despacho_i + finan_i + instal_i;

    // ✅ RENT = 30% sobre VALOR IMP (CIF)
    const rent_i = r.door_value_usd * rentRate; // ✅ (solo puerta)


    // ✅ adicional por item (no prorrateo / no solo item 1)
    const adicional_i = Number(r.adicional_input || 0);

    const total_sales_i = sub_total_i + rent_i + adicional_i;
    const unit_price_i = r.qty > 0 ? total_sales_i / r.qty : null;

    return {
      ...r,
      flete: round2(flete_i),
      seguro: round2(seguro_i),
      despacho: round2(despacho_i),
      finan: round2(finan_i),
      instal: round2(instal_i),
      valor_imp: round2(valor_imp_i),
      sub_total: round2(sub_total_i),
      rent: round2(rent_i),
      adicional: round2(adicional_i),
      total_sales: round2(total_sales_i),
      unit_price: unit_price_i !== null ? round2(unit_price_i) : null,
    };
  });

  const total_valor_imp_usd = sumNum(ofertaItemsFull.map((r) => r.valor_imp));
  const total_sales_usd = sumNum(ofertaItemsFull.map((r) => r.total_sales));
  const total_rent_usd = sumNum(ofertaItemsFull.map((r) => r.rent));
  const total_additional_usd = sumNum(ofertaItemsFull.map((r) => r.adicional));

  /* ================= OPERACION (profit final) ================= */
  const seguros_compra_usd = total_door_usd * Number(insurance_buy_rate || 0);
  const seguro_profit =
    insurance_profit_mode === "COMPAT_SIMPLE"
      ? total_seguro_usd
      : total_seguro_usd - seguros_compra_usd;

  const compra_puertas = total_door_usd;
  const venta_puertas = total_door_usd + total_rent_usd;
  const profit_puertas = venta_puertas - compra_puertas;

  const compra_flete = Number(freight_buy_usd || 0);
  const venta_flete = total_flete_usd;
  const profit_flete = venta_flete - compra_flete;

  const compra_despacho = customs_total_usd_theoretical;
  const venta_despacho_op = customs_total_sale_usd;
  const profit_despacho_op = venta_despacho_op - compra_despacho;

  const compra_adic = 0;
  const venta_adic = total_additional_usd;
  const profit_adic = venta_adic - compra_adic;

  const compra_finan = financing_total_buy_usd;
  const venta_finan = financing_total_sale_usd;
  const profit_finan = venta_finan - compra_finan;

  // Instalación en USD directo (evitamos mezclar TC de compra/venta operativa)
  const local_buy_usd = installation_total_cost_usd;
  const local_sell_usd = installation_total_sale_usd;
  const local_profit_usd = local_sell_usd - local_buy_usd;

  const total_buy_usd =
    compra_puertas +
    compra_flete +
    compra_despacho +
    compra_adic +
    compra_finan +
    local_buy_usd +
    seguros_compra_usd;

  const total_sell_usd = total_sales_usd;
  const profit_total_usd = total_sell_usd - total_buy_usd;

  const vendor_profit_pct = Number.isFinite(Number(inputs.vendor_profit_pct))
    ? Number(inputs.vendor_profit_pct)
    : 0.15;
  const vendor_profit_usd = profit_total_usd * vendor_profit_pct;
  const final_profit_usd = profit_total_usd - vendor_profit_usd;

  return {
    oferta: {
      items: ofertaItemsFull,
      totals: {
        total_sales_usd: round2(total_sales_usd),
        total_valor_imp_usd: round2(total_valor_imp_usd),
        total_flete_usd: round2(total_flete_usd),
        total_seguro_usd: round2(total_seguro_usd),
        total_despacho_usd: round2(total_despacho_usd),
        total_finan_usd: round2(total_finan_usd),
        total_instal_usd: round2(total_instal_usd),
        total_rent_usd: round2(total_rent_usd),
        total_additional_usd: round2(total_additional_usd),
      },
      cif: {
        cif_total_usd: round2(valorImpTotal),
      },
    },
    despacho: {
      lines: customsLinesOut,
      totals: {
        valor_imponible_usd: round2(valorImpTotal), // CIF total
        customs_total_usd_theoretical: round2(customs_total_usd_theoretical),
        customs_total_gs: Math.round(customs_total_gs),
        customs_total_sale_usd: round2(customs_total_sale_usd),
        customs_exchange_diff_usd: round2(customs_exchange_diff_usd),
      },
      inputs: {
        exchange_rate_customs_gs_per_usd,
        exchange_rate_customs_internal_gs_per_usd,
      },
    },
    instalacion: {
      lines: instLines,
      totals: {
        installation_total_cost_gs: Math.round(installation_total_cost_gs),
        installation_total_sale_gs: Math.round(installation_total_sale_gs),
        installation_total_profit_gs: Math.round(installation_total_profit_gs),
        installation_total_cost_usd: round2(installation_total_cost_usd),
        installation_total_sale_usd: round2(installation_total_sale_usd),
        installation_total_profit_usd: round2(installation_total_profit_usd),
      },
    },
    financiacion: {
      bases: finLines.map((l) => ({
        key: l.key,
        base: round2(l.base),
        interest_buy: round2(l.interest_buy),
        interest_sell: round2(l.interest_sell),
        buy_surcharge: round2(l.buy_surcharge),
        sell_surcharge: round2(l.sell_surcharge),
        total_buy: round2(l.total_buy),
        total_sell: round2(l.total_sell),
      })),
      totals: {
        financing_total_buy_usd: round2(financing_total_buy_usd),
        financing_total_sale_usd: round2(financing_total_sale_usd),
        financing_margin_usd: round2(financing_margin_usd),
      },
      params: {
        monthly_buy,
        monthly_sell,
        term_months,
        surcharge_rate,
      },
    },
    operacion: {
      rubros: {
        PRODUCTO: { compra: round2(compra_puertas), venta: round2(venta_puertas), profit: round2(profit_puertas) },
        FLETE: { compra: round2(compra_flete), venta: round2(venta_flete), profit: round2(profit_flete) },
        DESPACHO: { compra: round2(compra_despacho), venta: round2(venta_despacho_op), profit: round2(profit_despacho_op) },
        ADICIONAL: { compra: round2(compra_adic), venta: round2(venta_adic), profit: round2(profit_adic) },
        FINANCIACION: { compra: round2(compra_finan), venta: round2(venta_finan), profit: round2(profit_finan) },
        INSTALACION: { compra: round2(local_buy_usd), venta: round2(local_sell_usd), profit: round2(local_profit_usd) },
        SEGURO: { compra: round2(seguros_compra_usd), venta: round2(total_seguro_usd), profit: round2(seguro_profit) },
      },
      totals: {
        total_buy_usd: round2(total_buy_usd),
        total_sell_usd: round2(total_sell_usd),
        profit_total_usd: round2(profit_total_usd),
      },
      distribution: {
        vendor_profit_usd: round2(vendor_profit_usd),
        final_profit_usd: round2(final_profit_usd),
      },
    },
  };
}

export default computeQuote;
