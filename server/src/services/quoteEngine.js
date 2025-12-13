// server/src/services/quoteEngine.js
// Motor deterministico de cotizacion usando aritmetica decimal basada en escala (1e6)

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

function sum(arr) {
  return arr.reduce((acc, v) => acc + v, 0n);
}

export function computeQuote(inputs = {}) {
  const {
    rent_rate = 0,
    freight_international_total_usd = 0,
    additional_global_usd = 0,
    additional_mode = "COMPAT_SINGLE_ITEM",
    insurance_sale_total_usd = 0,
    insurance_buy_rate = 0,
    insurance_profit_mode = "CORRECTED",
    exchange_rate_customs_gs_per_usd = 0,
    exchange_rate_customs_internal_gs_per_usd = 1,
    exchange_rate_install_gs_per_usd = 1,
    exchange_rate_operation_buy_usd = 1,
    exchange_rate_operation_sell_usd = 1,
    items = [],
    install_items = [],
    customs_lines = [],
    financing_buy_annual_rate = 0,
    financing_sell_annual_rate = 0,
    financing_term_months = 0,
    financing_surcharge_rate = 0,
    freight_buy_usd = 0,
  } = inputs;

  // -------- Instalacion (Gs -> USD)
  const instLines = install_items.map((l) => {
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
  const installation_total_cost_gs = fromBig(sum(instLines.map((l) => toBig(l.total_cost_gs))));
  const installation_total_sale_gs = fromBig(sum(instLines.map((l) => toBig(l.total_sale_gs))));
  const installation_total_profit_gs = fromBig(sum(instLines.map((l) => toBig(l.profit_gs))));
  const installation_total_cost_usd =
    installation_total_cost_gs / (exchange_rate_install_gs_per_usd || 1);
  const installation_total_sale_usd =
    installation_total_sale_gs / (exchange_rate_install_gs_per_usd || 1);
  const installation_total_profit_usd =
    installation_total_profit_gs / (exchange_rate_install_gs_per_usd || 1);

  // -------- Oferta base
  const total_door_usd = items.reduce(
    (acc, r) => acc + (Number(r.door_value_usd) || 0),
    0
  );
  const totalDoorBig = toBig(total_door_usd);
  if (total_door_usd === 0) {
    throw new Error("total_door_usd es 0; no se puede prorratear");
  }

  const insuranceSaleTotal = toBig(insurance_sale_total_usd || 0);
  const rentRateBig = toBig(rent_rate || 0);
  const freightTotalBig = toBig(freight_international_total_usd || 0);
  const additionalGlobalBig = toBig(additional_global_usd || 0);

  // Despacho se calculara mas abajo; inicializamos
  let customs_total_sale_usd = 0;
  let customs_total_usd_theoretical = 0;

  // Financiacion se calculara mas abajo
  let financing_total_sale_usd = 0;

  const ofertaItems = items.map((it, idx) => {
    const doorVal = toBig(it.door_value_usd || 0);
    const participation = doorVal === 0n ? 0 : Number(doorVal) / Number(totalDoorBig);
    const flete = fromBig(freightTotalBig) * participation;
    const seguro = fromBig(insuranceSaleTotal) * participation;
    // despacho/finan/instal se rellenan luego tras calcular totales
    return {
      line_no: it.line_no ?? idx + 1,
      description: it.description || "",
      qty: Number(it.qty || 0),
      door_value_usd: Number(it.door_value_usd || 0),
      participation,
      flete,
      seguro,
    };
  });

  // -------- Despacho (depende de valor imponible)
  const valorImpTotal = ofertaItems.reduce(
    (acc, r) => acc + (r.door_value_usd + r.flete + r.seguro),
    0
  );
  const imponibleBig = toBig(valorImpTotal);
  let ivaBaseAccum = 0n;
  const customsLinesOut = customs_lines
    .filter((l) => l.enabled !== false)
    .map((l) => {
      let usd = 0n;
      let gs = 0n;
      if (l.type === "FIXED_USD") {
        usd = toBig(l.amount_usd || 0);
        gs = mul(usd, toBig(exchange_rate_customs_gs_per_usd || 0));
      } else if (l.type === "PERCENT_OF_IMPONIBLE_USD") {
        usd = mul(imponibleBig, toBig(l.rate_decimal || 0));
        gs = mul(usd, toBig(exchange_rate_customs_gs_per_usd || 0));
      } else if (l.type === "IVA_PERCENT_OF_BASE_USD") {
        const baseIvaUsd = add(imponibleBig, ivaBaseAccum);
        usd = mul(baseIvaUsd, toBig(l.rate_decimal || 0));
        gs = mul(usd, toBig(exchange_rate_customs_gs_per_usd || 0));
      } else if (l.type === "FIXED_GS") {
        gs = toBig(l.amount_gs || 0);
        usd = div(gs, toBig(exchange_rate_customs_gs_per_usd || 1));
      }
      if (l.include_in_iva_base) {
        ivaBaseAccum = add(ivaBaseAccum, usd);
      }
      return {
        ...l,
        usd: fromBig(usd),
        gs: Math.round(fromBig(gs)),
      };
    });

  customs_total_usd_theoretical = customsLinesOut.reduce(
    (acc, l) => acc + Number(l.usd || 0),
    0
  );
  const customs_total_gs = customsLinesOut.reduce((acc, l) => acc + Number(l.gs || 0), 0);
  customs_total_sale_usd =
    customs_total_gs / (exchange_rate_customs_internal_gs_per_usd || 1);
  const customs_exchange_diff_usd =
    customs_total_sale_usd - customs_total_usd_theoretical;

  // -------- Financiacion
  const base_door = total_door_usd;
  const base_flete_seguro =
    Number(freight_international_total_usd || 0) +
    Number(insurance_sale_total_usd || 0);
  const base_despacho = customs_total_sale_usd;
  const base_install_cost = installation_total_cost_usd;

  const term_rate_buy =
    (Number(financing_buy_annual_rate || 0) / 12) *
    Number(financing_term_months || 0);
  const term_rate_sell =
    (Number(financing_sell_annual_rate || 0) / 12) *
    Number(financing_term_months || 0);

  const baseSum =
    base_door + base_flete_seguro + base_despacho + base_install_cost;
  const interest_buy = baseSum * term_rate_buy;
  const interest_sell = baseSum * term_rate_sell;
  const buy_surcharge = interest_buy * Number(financing_surcharge_rate || 0);
  const sell_surcharge = interest_sell * Number(financing_surcharge_rate || 0);
  const financing_total_buy_usd = interest_buy + buy_surcharge;
  financing_total_sale_usd = interest_sell + sell_surcharge;
  const financing_margin_usd =
    financing_total_sale_usd - financing_total_buy_usd;

  // -------- Oferta: completar columnas dependientes
  const total_flete_usd = Number(freight_international_total_usd || 0);
  const total_seguro_usd = Number(insurance_sale_total_usd || 0);
  const total_instal_usd = installation_total_sale_usd;
  const total_finan_usd = financing_total_sale_usd;
  const total_despacho_usd = customs_total_sale_usd;

  const rentRate = Number(rent_rate || 0);
  const ofertaItemsFull = ofertaItems.map((r, idx) => {
    const flete_i = total_flete_usd * r.participation;
    const seguro_i = total_seguro_usd * r.participation;
    const despacho_i = total_despacho_usd * r.participation;
    const finan_i = total_finan_usd * r.participation;
    const instal_i = total_instal_usd * r.participation;
    const valor_imp_i = r.door_value_usd + flete_i + seguro_i;
    const sub_total_i = valor_imp_i + despacho_i + finan_i + instal_i;
    const rent_i = r.door_value_usd * rentRate;
    let adicional_i = 0;
    if (additional_mode === "PRORATED") {
      adicional_i = Number(additional_global_usd || 0) * r.participation;
    } else {
      adicional_i = idx === 0 ? Number(additional_global_usd || 0) : 0;
    }
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

  const total_valor_imp_usd = ofertaItemsFull.reduce(
    (acc, r) => acc + r.valor_imp,
    0
  );
  const total_sales_usd = ofertaItemsFull.reduce(
    (acc, r) => acc + r.total_sales,
    0
  );
  const total_rent_usd = ofertaItemsFull.reduce((acc, r) => acc + r.rent, 0);
  const total_additional_usd = ofertaItemsFull.reduce(
    (acc, r) => acc + r.adicional,
    0
  );

  // -------- Operacion
  const seguros_compra_usd =
    total_door_usd * Number(insurance_buy_rate || 0);
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
  const venta_adic = Number(additional_global_usd || 0);
  const profit_adic = venta_adic - compra_adic;

  const compra_finan = financing_total_buy_usd;
  const venta_finan = financing_total_sale_usd;
  const profit_finan = venta_finan - compra_finan;

  const local_buy_usd =
    installation_total_cost_gs / (exchange_rate_operation_buy_usd || 1);
  const local_sell_usd =
    installation_total_sale_gs / (exchange_rate_operation_sell_usd || 1);
  const local_profit_usd = local_sell_usd - local_buy_usd;

  const total_buy_usd =
    compra_puertas +
    compra_flete +
    compra_despacho +
    compra_adic +
    compra_finan +
    local_buy_usd +
    seguros_compra_usd;
  const total_sell_usd = total_sales_usd; // debe igualar oferta
  const profit_total_usd = total_sell_usd - total_buy_usd;
  const vendor_profit_usd = profit_total_usd * 0.15;
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
    },
    despacho: {
      lines: customsLinesOut,
      totals: {
        customs_total_usd_theoretical: round2(customs_total_usd_theoretical),
        customs_total_gs: Math.round(customs_total_gs),
        customs_total_sale_usd: round2(customs_total_sale_usd),
        customs_exchange_diff_usd: round2(customs_exchange_diff_usd),
      },
    },
    instalacion: {
      lines: instLines,
      totals: {
        installation_total_cost_gs: Math.round(installation_total_cost_gs),
        installation_total_sale_gs: Math.round(installation_total_sale_gs),
        installation_total_profit_gs: Math.round(
          installation_total_profit_gs
        ),
        installation_total_cost_usd: round2(installation_total_cost_usd),
        installation_total_sale_usd: round2(installation_total_sale_usd),
        installation_total_profit_usd: round2(installation_total_profit_usd),
      },
    },
    financiacion: {
      buy: {
        financing_total_buy_usd: round2(financing_total_buy_usd),
        interest_buy: round2(interest_buy),
        buy_surcharge: round2(buy_surcharge),
      },
      sell: {
        financing_total_sale_usd: round2(financing_total_sale_usd),
        interest_sell: round2(interest_sell),
        sell_surcharge: round2(sell_surcharge),
      },
      margin: {
        financing_margin_usd: round2(financing_margin_usd),
      },
    },
    operacion: {
      rubros: {
        puertas: {
          compra: round2(compra_puertas),
          venta: round2(venta_puertas),
          profit: round2(profit_puertas),
        },
        flete: {
          compra: round2(compra_flete),
          venta: round2(venta_flete),
          profit: round2(profit_flete),
        },
        despacho: {
          compra: round2(compra_despacho),
          venta: round2(venta_despacho_op),
          profit: round2(profit_despacho_op),
        },
        adicional: {
          compra: round2(compra_adic),
          venta: round2(venta_adic),
          profit: round2(profit_adic),
        },
        financiacion: {
          compra: round2(compra_finan),
          venta: round2(venta_finan),
          profit: round2(profit_finan),
        },
        locales: {
          compra: round2(local_buy_usd),
          venta: round2(local_sell_usd),
          profit: round2(local_profit_usd),
        },
        seguro: {
          compra: round2(seguros_compra_usd),
          venta: round2(total_seguro_usd),
          profit: round2(seguro_profit),
        },
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
