// server/src/services/quoteCalculator.js

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function safeDiv(a, b) {
  a = n(a); b = n(b);
  return b === 0 ? 0 : a / b;
}

/**
 * 1) Oferta: distribuye flete/seguro/despacho/finan/instal por participación
 * y arma totales por item.
 */
function computeOferta(inputs, computedParts) {
  const items = Array.isArray(inputs.items) ? inputs.items : [];

  const freightTotal = n(inputs.freight_international_total_usd);
  const insuranceTotal = n(inputs.insurance_sale_total_usd);
  const additionalGlobal = n(inputs.additional_global_usd);
  const rentRate = n(inputs.rent_rate); // 0.3

  // Base puertas (SUMA V.PUERTA)
  const sumDoors = items.reduce((acc, it) => acc + n(it.door_value_usd) * n(it.qty || 1), 0);

  // Totales que vienen de otros módulos (ya calculados)
  const despachoSaleUsd = n(computedParts?.despacho?.totals?.customs_total_sale_usd);
  const financSaleUsd = n(computedParts?.financiacion?.sell?.financing_total_sale_usd);
  const instalSaleUsd = n(computedParts?.instalacion?.totals?.installation_total_sale_usd);

  // Reglas según tu Excel:
  // - participación = door_i / sumDoors
  // - adicional se reparte "en partes iguales" (tu S22/2). Ajustable.
  const enabledItems = items.filter(it => n(it.qty || 1) > 0);
  const equalAdditionalPerItem = enabledItems.length ? additionalGlobal / enabledItems.length : 0;

  const rows = items.map((it) => {
    const qty = n(it.qty || 1);
    const door = n(it.door_value_usd) * qty;

    const part = safeDiv(door, sumDoors);

    const flete = freightTotal * part;
    const seguro = insuranceTotal * part;
    const valorImp = door + flete + seguro;

    const despacho = despachoSaleUsd * part;
    const finan = financSaleUsd * part;
    const instal = instalSaleUsd * part;

    const subTotal = valorImp + despacho + finan + instal;

    // OJO: en tu excel rent parece = V.PUERTA * rentRate (no sobre subTotal)
    const rent = door * rentRate;

    // adicional igualitario por ítem (como tu S22/2)
    const adicional = qty > 0 ? equalAdditionalPerItem : 0;

    const totalSales = subTotal + rent + adicional;
    const unitPrice = qty > 0 ? totalSales / qty : 0;

    return {
      line_no: it.line_no,
      description: it.description,
      qty,
      door_value: door,
      participation: part,     // 0..1
      flete,
      seguro,
      valor_imponible: valorImp,
      despacho,
      finan,
      instal,
      subtotal: subTotal,
      rent,
      adicional,
      total_sales: totalSales,
      unit_price: unitPrice,
    };
  });

  const totals = {
    sum_doors_usd: sumDoors,
    freight_total_usd: freightTotal,
    insurance_total_usd: insuranceTotal,
    despacho_sale_usd: despachoSaleUsd,
    financing_sale_usd: financSaleUsd,
    instal_sale_usd: instalSaleUsd,
    additional_global_usd: additionalGlobal,
    total_sales_usd: rows.reduce((a, r) => a + n(r.total_sales), 0),
  };

  return { items: rows, totals };
}

/**
 * 2) Despacho: usa tus customs_lines con tipos:
 * FIXED_USD, FIXED_GS, PERCENT_OF_IMPONIBLE_USD, IVA_PERCENT_OF_BASE_USD
 * y respeta include_in_iva_base para armar base de IVA.
 */
function computeDespacho(inputs, ofertaTotals) {
  const lines = Array.isArray(inputs.customs_lines) ? inputs.customs_lines : [];

  const imponibleUsd = n(ofertaTotals?.sum_doors_usd) + n(inputs.freight_international_total_usd) + n(inputs.insurance_sale_total_usd);
  const tcAduana = n(inputs.exchange_rate_customs_gs_per_usd); // ej 7800
  const tcInterno = n(inputs.exchange_rate_customs_internal_gs_per_usd || 1);

  // Acumulamos base IVA (en USD) con los que tienen include_in_iva_base
  let ivaBaseUsd = imponibleUsd;

  const computedLines = lines
    .filter(l => l && l.enabled !== false)
    .map((l) => {
      const type = String(l.type || "FIXED_USD");
      const rate = n(l.rate_decimal);
      const amountUsd = n(l.amount_usd);
      const amountGs = n(l.amount_gs);

      let usd = 0;
      let gs = 0;

      if (type === "FIXED_USD") usd = amountUsd;
      else if (type === "FIXED_GS") gs = amountGs;
      else if (type === "PERCENT_OF_IMPONIBLE_USD") usd = imponibleUsd * rate;
      else if (type === "IVA_PERCENT_OF_BASE_USD") usd = ivaBaseUsd * rate;

      // Convertimos si hace falta
      if (gs === 0 && usd !== 0) gs = usd * tcAduana;
      if (usd === 0 && gs !== 0) usd = tcAduana ? gs / tcAduana : 0;

      // si este concepto entra a base IVA, lo suma
      if (l.include_in_iva_base) {
        ivaBaseUsd += usd;
      }

      return { name: l.name, type, rate_decimal: rate, usd, gs, include_in_iva_base: !!l.include_in_iva_base };
    });

  const totals = {
    imponible_usd: imponibleUsd,
    imponible_gs: imponibleUsd * tcAduana,
    tc_aduana: tcAduana,
    // “teórico” = suma de líneas (USD)
    customs_total_usd_theoretical: computedLines.reduce((a, x) => a + n(x.usd), 0),
    customs_total_gs: computedLines.reduce((a, x) => a + n(x.gs), 0),
  };

  // Si querés “venta despacho” con TC interno / margen por diferencia:
  // En tu excel aparece “venta despacho” y “diferencia tc”.
  // Regla sugerida: venta = totalGs / tcInterno (si tcInterno ≠ tcAduana)
  const saleUsd = tcInterno ? totals.customs_total_gs / tcInterno : totals.customs_total_usd_theoretical;

  totals.customs_total_sale_usd = saleUsd;
  totals.customs_exchange_diff_usd = saleUsd - totals.customs_total_usd_theoretical;

  return { lines: computedLines, totals };
}

/**
 * 3) Instalación (Gs -> USD)
 */
function computeInstalacion(inputs) {
  const tc = n(inputs.exchange_rate_install_gs_per_usd || 1);
  const rows = (Array.isArray(inputs.install_items) ? inputs.install_items : []).map((it) => {
    const qty = n(it.qty || 1);
    const cost = n(it.unit_cost_gs) * qty;
    const sale = n(it.unit_price_gs) * qty;
    const profitGs = sale - cost;

    const saleUsd = tc ? sale / tc : 0;
    const profitUsd = tc ? profitGs / tc : 0;

    return {
      line_no: it.line_no,
      description: it.description,
      qty,
      total_cost_gs: cost,
      total_sale_gs: sale,
      profit_gs: profitGs,
      sale_usd: saleUsd,
      profit_usd: profitUsd,
    };
  });

  const totals = {
    installation_total_cost_gs: rows.reduce((a, r) => a + n(r.total_cost_gs), 0),
    installation_total_sale_gs: rows.reduce((a, r) => a + n(r.total_sale_gs), 0),
    installation_total_profit_gs: rows.reduce((a, r) => a + n(r.profit_gs), 0),
    installation_total_sale_usd: rows.reduce((a, r) => a + n(r.sale_usd), 0),
    installation_total_profit_usd: rows.reduce((a, r) => a + n(r.profit_usd), 0),
  };

  return { lines: rows, totals };
}

/**
 * 4) Financiación (modelo “interés simple” por plazo + recargo)
 * (esto lo ajustamos exacto con tus respuestas)
 */
function computeFinanciacion(inputs, despacho, instalacion, ofertaTotals) {
  const termMonths = n(inputs.financing_term_months); // ej 6 para 180 días
  const buyAnnual = n(inputs.financing_buy_annual_rate);
  const sellAnnual = n(inputs.financing_sell_annual_rate);
  const surcharge = n(inputs.financing_surcharge_rate); // 0.1

  const imponibleDoor = n(ofertaTotals?.sum_doors_usd);
  const fleteSeguro = n(inputs.freight_international_total_usd) + n(inputs.insurance_sale_total_usd);
  const despachoSale = n(despacho?.totals?.customs_total_sale_usd);
  const instalSale = n(instalacion?.totals?.installation_total_sale_usd);

  const base = imponibleDoor + fleteSeguro + despachoSale + instalSale;

  const buyMonthly = buyAnnual / 12;
  const sellMonthly = sellAnnual / 12;

  const interestBuy = base * buyMonthly * termMonths;
  const interestSell = base * sellMonthly * termMonths;

  const buySurcharge = interestBuy * surcharge;
  const sellSurcharge = interestSell * surcharge;

  const totalsBuy = interestBuy + buySurcharge;
  const totalsSell = interestSell + sellSurcharge;

  return {
    buy: { base, interest_buy: interestBuy, buy_surcharge: buySurcharge, financing_total_buy_usd: totalsBuy },
    sell: { base, interest_sell: interestSell, sell_surcharge: sellSurcharge, financing_total_sale_usd: totalsSell },
    margin: { financing_margin_usd: totalsSell - totalsBuy },
  };
}

/**
 * 5) Operación: compra vs venta por rubro + distribución
 */
function computeOperacion(inputs, oferta, despacho, financiacion, instalacion) {
  const buyTC = n(inputs.exchange_rate_operation_buy_usd || 1);
  const sellTC = n(inputs.exchange_rate_operation_sell_usd || 1);

  // Aquí vos tenés más rubros en tu excel (retención, seguro, etc.)
  // Dejamos base y ajustamos con tus reglas:
  const doors = n(oferta?.totals?.sum_doors_usd);
  const flete = n(inputs.freight_international_total_usd);
  const seguro = n(inputs.insurance_sale_total_usd);

  const despachoBuy = n(despacho?.totals?.customs_total_usd_theoretical);
  const despachoSell = n(despacho?.totals?.customs_total_sale_usd);

  const finanBuy = n(financiacion?.buy?.financing_total_buy_usd);
  const finanSell = n(financiacion?.sell?.financing_total_sale_usd);

  const instalBuy = n(instalacion?.totals?.installation_total_cost_gs) / (buyTC || 1);
  const instalSell = n(instalacion?.totals?.installation_total_sale_usd);

  const totalBuy = doors + flete + seguro + despachoBuy + finanBuy + instalBuy;
  const totalSell = n(oferta?.totals?.total_sales_usd); // ventas finales del módulo oferta

  const profit = totalSell - totalBuy;

  const vendorProfit = profit * 0.15;
  const finalProfit = profit - vendorProfit;

  return {
    rubros: {
      PUERTAS: { compra: doors, venta: doors, profit: 0 }, // si querés separar costo vs venta real, lo ajustamos
      FLETE: { compra: flete, venta: flete, profit: 0 },
      SEGURO: { compra: seguro, venta: seguro, profit: 0 },
      DESPACHO: { compra: despachoBuy, venta: despachoSell, profit: despachoSell - despachoBuy },
      FINANCIACION: { compra: finanBuy, venta: finanSell, profit: finanSell - finanBuy },
      INSTALACION: { compra: instalBuy, venta: instalSell, profit: instalSell - instalBuy },
    },
    totals: { total_buy_usd: totalBuy, total_sell_usd: totalSell, profit_total_usd: profit },
    distribution: { vendor_profit_usd: vendorProfit, final_profit_usd: finalProfit },
  };
}

/**
 * Motor principal
 */
function calculateQuote(inputs) {
  // Orden importa: instalación -> ofertaTotals base -> despacho -> financiación -> oferta final -> operación
  const instalacion = computeInstalacion(inputs);

  // ofertaTotals base: necesitamos sum_doors, pero oferta final depende de despacho/finan/instal
  const ofertaBaseTotals = { sum_doors_usd: (inputs.items || []).reduce((a, it) => a + n(it.door_value_usd) * n(it.qty || 1), 0) };

  const despacho = computeDespacho(inputs, ofertaBaseTotals);
  const financiacion = computeFinanciacion(inputs, despacho, instalacion, ofertaBaseTotals);

  const oferta = computeOferta(inputs, { despacho, financiacion, instalacion });

  const operacion = computeOperacion(inputs, oferta, despacho, financiacion, instalacion);

  return { oferta, despacho, financiacion, instalacion, operacion };
}

module.exports = { calculateQuote };