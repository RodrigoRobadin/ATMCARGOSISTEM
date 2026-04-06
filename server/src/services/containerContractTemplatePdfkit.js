import PDFDocument from 'pdfkit';

function money(value, currency = 'PYG') {
  const amount = Number(value || 0);
  const code = String(currency || 'PYG').toUpperCase();
  const locale = code === 'USD' ? 'en-US' : 'es-PY';
  const decimals = code === 'USD' ? 2 : 0;
  return `${code} ${amount.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function ensureSpace(doc, needed = 80) {
  if (doc.y + needed <= doc.page.height - doc.page.margins.bottom) return;
  doc.addPage();
}

function sectionTitle(doc, text) {
  ensureSpace(doc, 36);
  doc.moveDown(0.3);
  const x = doc.page.margins.left;
  const y = doc.y;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.roundedRect(x, y, w, 20, 5).fill('#f3f4f6');
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(text, x + 9, y + 5);
  doc.y = y + 24;
}

function paragraph(doc, text, opts = {}) {
  ensureSpace(doc, opts.minSpace || 40);
  doc
    .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(opts.fontSize || 9.5)
    .fillColor(opts.color || '#111827')
    .text(text || '', doc.page.margins.left, doc.y, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      align: opts.align || 'justify',
      lineGap: opts.lineGap ?? 2,
    });
  doc.moveDown(opts.after ?? 0.55);
}

function simpleField(doc, label, value, labelW = 120) {
  ensureSpace(doc, 22);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151').text(label, doc.page.margins.left, doc.y, {
    width: labelW,
  });
  doc.font('Helvetica').fontSize(9).fillColor('#111827').text(value || '-', doc.page.margins.left + labelW, doc.y, {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right - labelW,
  });
  doc.moveDown(0.8);
}

function drawUnitsTable(doc, units) {
  ensureSpace(doc, 90);
  const x = doc.page.margins.left;
  const widths = [34, 160, 105, 110, 110];
  const headers = ['#', 'Contenedor', 'Tipo', 'Estado', 'Entrega'];
  let y = doc.y;

  let cursor = x;
  headers.forEach((header, index) => {
    doc.rect(cursor, y, widths[index], 22).fillAndStroke('#e5e7eb', '#cbd5e1');
    doc
      .fillColor('#111827')
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .text(header, cursor + 6, y + 7, {
        width: widths[index] - 12,
        align: index === 0 ? 'center' : 'left',
      });
    cursor += widths[index];
  });
  y += 22;

  if (!units.length) {
    doc.rect(x, y, widths.reduce((sum, width) => sum + width, 0), 22).stroke('#d1d5db');
    doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text('Sin contenedores vinculados.', x + 8, y + 7);
    doc.y = y + 30;
    return;
  }

  units.forEach((unit, index) => {
    ensureSpace(doc, 24);
    cursor = x;
    const row = [
      String(index + 1),
      unit.container_no || '-',
      unit.container_type || '-',
      unit.status || '-',
      unit.delivered_at || '-',
    ];
    row.forEach((value, cellIndex) => {
      doc.rect(cursor, y, widths[cellIndex], 22).stroke('#d1d5db');
      doc
        .fillColor('#111827')
        .font('Helvetica')
        .fontSize(8.5)
        .text(value, cursor + 6, y + 7, {
          width: widths[cellIndex] - 12,
          align: cellIndex === 0 ? 'center' : 'left',
        });
      cursor += widths[cellIndex];
    });
    y += 22;
  });

  doc.y = y + 6;
}

function drawLinesTable(doc, lines, currency) {
  ensureSpace(doc, 90);
  const x = doc.page.margins.left;
  const widths = [120, 275, 120];
  const headers = ['Concepto', 'Descripcion', 'Monto'];
  let y = doc.y;

  let cursor = x;
  headers.forEach((header, index) => {
    doc.rect(cursor, y, widths[index], 22).fillAndStroke('#e5e7eb', '#cbd5e1');
    doc
      .fillColor('#111827')
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .text(header, cursor + 6, y + 7, {
        width: widths[index] - 12,
        align: index === 2 ? 'right' : 'left',
      });
    cursor += widths[index];
  });
  y += 22;

  let total = 0;
  if (!lines.length) {
    doc.rect(x, y, widths.reduce((sum, width) => sum + width, 0), 22).stroke('#d1d5db');
    doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text('Sin lineas economicas definidas.', x + 8, y + 7);
    doc.y = y + 30;
    return total;
  }

  lines.forEach((line) => {
    ensureSpace(doc, 24);
    const amount = Number(line.amount || 0);
    total += amount;
    cursor = x;
    const row = [
      line.line_type || '-',
      line.description || '-',
      money(amount, line.currency_code || currency),
    ];
    row.forEach((value, cellIndex) => {
      doc.rect(cursor, y, widths[cellIndex], 22).stroke('#d1d5db');
      doc
        .fillColor('#111827')
        .font('Helvetica')
        .fontSize(8.5)
        .text(value, cursor + 6, y + 7, {
          width: widths[cellIndex] - 12,
          align: cellIndex === 2 ? 'right' : 'left',
        });
      cursor += widths[cellIndex];
    });
    y += 22;
  });

  ensureSpace(doc, 24);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(`TOTAL CONTRACTUAL: ${money(total, currency)}`, x, y + 5, {
    width: widths.reduce((sum, width) => sum + width, 0),
    align: 'right',
  });
  doc.y = y + 22;
  return total;
}

function spanishMonthName(date) {
  return new Intl.DateTimeFormat('es-PY', { month: 'long' }).format(date);
}

function longSpanishDate(dateLike) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return '-';
  const month = spanishMonthName(date);
  return `${date.getDate()} de ${month} de ${date.getFullYear()}`;
}

function noteDate(dateLike) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return '-';
  return `Asuncion, ${spanishMonthName(date)} de ${date.getFullYear()}`;
}

function findLine(lines, names) {
  const allowed = names.map((name) => String(name).toLowerCase());
  return lines.find((line) => allowed.includes(String(line.line_type || '').toLowerCase()));
}

function joinAddress(name, address, city) {
  return [name, address, city].filter(Boolean).join(', ');
}

function normalizeReps(reps, fallbackName = '', fallbackDoc = '') {
  if (Array.isArray(reps) && reps.length) {
    const cleaned = reps
      .map((row) => ({
        name: row?.name || '',
        doc: row?.doc || '',
        role: row?.role || '',
      }))
      .filter((row) => row.name || row.doc || row.role);
    if (cleaned.length) return cleaned;
  }
  if (fallbackName || fallbackDoc) {
    return [{ name: fallbackName || '', doc: fallbackDoc || '', role: '' }];
  }
  return [];
}

function repsInline(reps) {
  if (!reps.length) return '________________';
  if (reps.length === 1) {
    const rep = reps[0];
    return [rep.name, rep.doc ? `documento ${rep.doc}` : null, rep.role || null]
      .filter(Boolean)
      .join(', ');
  }
  return reps
    .map((rep) => [rep.name, rep.role || null, rep.doc ? `CI ${rep.doc}` : null].filter(Boolean).join(', '))
    .join('; ');
}

function renderAccompanimentLetter(doc, ctx) {
  paragraph(doc, 'NOTA DE ACOMPANAMIENTO', { bold: true, fontSize: 12, align: 'left', after: 0.7 });
  paragraph(doc, noteDate(ctx.issueDate), { align: 'left', after: 0.9 });
  paragraph(doc, `Senores\n${ctx.lesseeName || 'CLIENTE'}\nPresente`, { align: 'left', after: 1 });
  paragraph(
    doc,
    'De nuestra mayor consideracion:',
    { align: 'left', after: 0.7 }
  );
  paragraph(
    doc,
    `Por medio de la presente, tenemos el agrado de dirigirnos a ustedes a fin de remitirles, para su revision y consideracion, la version ejecutiva actualizada del Contrato de Arrendamiento ${ctx.contractSubject} celebrado entre ${ctx.lesseeName || 'EL LOCATARIO'} y ${ctx.lessorName || 'EL LOCADOR'}.`
  );
  paragraph(
    doc,
    'La presente version incorpora ajustes de forma y precision contractual, manteniendo el espiritu comercial del acuerdo originalmente convenido, con especial enfasis en la claridad de las condiciones de pago, mora y restitucion de la unidad arrendada, a efectos de evitar interpretaciones ambiguas y facilitar una correcta ejecucion del contrato por ambas partes.'
  );
  paragraph(
    doc,
    'Destacamos que las condiciones economicas esenciales del arrendamiento se mantienen, habiendose adecuado unicamente la metodologia de calculo del interes moratorio, estableciendose una tasa mensual razonable y su correspondiente prorrateo diario, asi como los procedimientos aplicables en caso de incumplimiento.'
  );
  paragraph(
    doc,
    `Asimismo, se deja expresa constancia de la incorporacion de nuevas clausulas y precisiones contractuales orientadas a fortalecer la seguridad juridica del acuerdo, incluyendo: (i) notificacion preventiva de ${ctx.preventiveNoticeHours} horas en mora, (ii) revision contractual desde el mes ${ctx.reviewAfterMonths}, (iii) ajustes de tarifa por mercado, (iv) exclusion de responsabilidad por mercaderia, (v) ${ctx.insuranceRequired ? 'seguro obligatorio' : 'condicion de seguro segun lo pactado'}, y (vi) determinacion del valor de reposicion del contenedor.`
  );
  paragraph(
    doc,
    `Igualmente, se precisa que el tope de intereses moratorios del ${ctx.annualLateFee}% sera aplicado sobre base anual.`
  );
  paragraph(doc, 'Aguardamos sus comentarios y quedamos a disposicion para cualquier aclaracion adicional.');
  paragraph(doc, 'Sin otro particular, saludamos a ustedes muy atentamente.', { after: 1.4 });

  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(ctx.lessorName || 'EL LOCADOR', {
    align: 'left',
  });
  doc.moveDown(2);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + 230, doc.y).stroke('#6b7280');
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(9.5).text(ctx.lessorRepName || 'Representante Legal');
  if (ctx.lessorRepRole) {
    doc.font('Helvetica').fontSize(9).text(ctx.lessorRepRole);
  }
}

function signaturesBlock(doc, ctx) {
  ensureSpace(doc, 110);
  const x = doc.page.margins.left;
  const totalW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const half = totalW / 2;
  const y = doc.y + 26;

  doc.moveTo(x + 20, y).lineTo(x + half - 20, y).stroke('#6b7280');
  doc.moveTo(x + half + 20, y).lineTo(x + totalW - 20, y).stroke('#6b7280');

  doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827').text(ctx.lessorName || 'EL LOCADOR', x, y + 6, {
    width: half,
    align: 'center',
  });
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827').text(ctx.lesseeName || 'EL LOCATARIO', x + half, y + 6, {
    width: half,
    align: 'center',
  });
  doc.font('Helvetica').fontSize(8.5).fillColor('#4b5563').text(
    ctx.lessorReps?.length
      ? ctx.lessorReps.map((rep) => [rep.name, rep.role || null].filter(Boolean).join(' - ')).join('\n')
      : (ctx.lessorRepName || 'Representante legal'),
    x,
    y + 20,
    {
      width: half,
      align: 'center',
    }
  );
  doc.font('Helvetica').fontSize(8.5).fillColor('#4b5563').text(
    ctx.lesseeReps?.length
      ? ctx.lesseeReps.map((rep) => [rep.name, rep.role || null].filter(Boolean).join(' - ')).join('\n')
      : (ctx.lesseeRepName || 'Representante legal'),
    x + half,
    y + 20,
    {
      width: half,
      align: 'center',
    }
  );
  doc.y = y + 52;
}

export default async function generateContainerContractPDF(data, outputStream) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 42,
    bufferPages: true,
  });
  doc.pipe(outputStream);

  const contract = data?.contract || {};
  const units = Array.isArray(data?.units) ? data.units : [];
  const lines = Array.isArray(data?.lines) ? data.lines : [];
  const currency = contract.currency_code || 'PYG';
  const issueDate = contract.updated_at || contract.created_at || new Date();
  const firstUnit = units[0] || {};
  const unitCount = units.length || 1;
  const lessorReps = normalizeReps(contract.lessor_legal_reps, contract.lessor_legal_rep_name, contract.lessor_legal_rep_doc);
  const lesseeReps = normalizeReps(contract.lessee_legal_reps, contract.lessee_legal_rep_name, contract.lessee_legal_rep_doc);

  const alquiler = findLine(lines, ['alquiler']);
  const garantia = findLine(lines, ['garantia']);
  const flete = findLine(lines, ['flete']);
  const minimumTermMonths = Number(contract.minimum_term_months ?? 3) || 3;
  const paymentDueDay = Number(contract.payment_due_day ?? 5) || 5;
  const preventiveNoticeHours = Number(contract.preventive_notice_hours ?? 48) || 48;
  const paymentIntimationDays = Number(contract.payment_intimation_days ?? 8) || 8;
  const reviewAfterMonths = Number(contract.review_after_months ?? 3) || 3;
  const reviewNoticeDays = Number(contract.review_notice_days ?? 15) || 15;
  const replacementValueUsd = Number(contract.replacement_value_usd ?? 21000) || 21000;
  const inspectionNoticeHours = Number(contract.inspection_notice_hours ?? 24) || 24;
  const insuranceRequired = Boolean(Number(contract.insurance_required ?? 1));
  const jurisdictionText = contract.jurisdiction_text || 'Tribunales del Departamento Central';

  const ctx = {
    issueDate,
    lessorName: contract.lessor_name || 'EL LOCADOR',
    lesseeName: contract.lessee_name || 'EL LOCATARIO',
    lessorRepName: lessorReps[0]?.name || 'Representante Legal',
    lesseeRepName: lesseeReps[0]?.name || 'Representante Legal',
    lessorRepRole: lessorReps[0]?.role || 'Representante Legal',
    lessorReps,
    lesseeReps,
    annualLateFee: contract.late_fee_annual_pct || 27.07,
    preventiveNoticeHours,
    reviewAfterMonths,
    insuranceRequired,
    contractSubject:
      unitCount > 1
        ? `de ${unitCount} contenedores ${firstUnit.container_type || ''}`.trim()
        : `de Contenedor ${firstUnit.container_type || 'Container'}`.trim(),
  };

  renderAccompanimentLetter(doc, ctx);
  doc.addPage();

  doc
    .font('Helvetica-Bold')
    .fontSize(15)
    .fillColor('#111827')
    .text(
      `CONTRATO DE ARRENDAMIENTO ${unitCount > 1 ? 'DE CONTENEDORES' : `DE ${firstUnit.container_type || 'CONTENEDOR'}`}`,
      {
        align: 'center',
      }
    );

  doc.moveDown(0.8);
  paragraph(
    doc,
    `En la ciudad de Mariano Roque Alonso, Republica del Paraguay, a los ${longSpanishDate(issueDate)}, por una parte, ${ctx.lessorName}${contract.lessor_ruc ? `, RUC Nro ${contract.lessor_ruc}` : ''}${joinAddress('', contract.lessor_address, contract.lessor_city) ? `, con domicilio en ${joinAddress('', contract.lessor_address, contract.lessor_city)}` : ''}, representada en este acto por ${repsInline(lessorReps)}, en adelante EL LOCADOR; y por la otra parte, ${ctx.lesseeName}${contract.lessee_ruc ? `, con RUC Nro ${contract.lessee_ruc}` : ''}${joinAddress('', contract.lessee_address, contract.lessee_city) ? `, con domicilio en ${joinAddress('', contract.lessee_address, contract.lessee_city)}` : ''}, representada por ${repsInline(lesseeReps)}, en adelante EL LOCATARIO; convienen en celebrar el presente Contrato de Arrendamiento, el cual se regira por las siguientes clausulas y condiciones:`,
    { after: 0.9 }
  );

  sectionTitle(doc, 'DATOS GENERALES');
  simpleField(doc, 'Contrato Nro', contract.contract_no || '-');
  simpleField(doc, 'Referencia OP', contract.deal_reference || '-');
  simpleField(doc, 'Estado', contract.status || '-');
  simpleField(doc, 'Revision', `R${contract.revision_no || 1}`);
  simpleField(doc, 'Renovacion', contract.renewal_no ? `Renovacion ${contract.renewal_no}${contract.renewed_from_contract_no ? ` de ${contract.renewed_from_contract_no}` : ''}` : '-');
  simpleField(doc, 'Vigencia desde', contract.effective_from || '-');
  simpleField(doc, 'Vigencia hasta', contract.effective_to || '-');
  simpleField(doc, 'Dia de pago', String(paymentDueDay));
  simpleField(doc, 'Mora diaria', `${contract.late_fee_daily_pct || 0.233}%`);
  simpleField(doc, 'Mora mensual', `${contract.late_fee_monthly_pct || 7}%`);
  simpleField(doc, 'Tope anual mora', `${contract.late_fee_annual_pct || 27.07}%`);
  simpleField(doc, 'Seguro obligatorio', insuranceRequired ? 'Si' : 'No');

  sectionTitle(doc, 'PRIMERA - OBJETO');
  paragraph(
    doc,
    `EL LOCADOR da en arrendamiento a EL LOCATARIO ${unitCount > 1 ? `los siguientes ${unitCount} contenedores` : 'un (1) contenedor'} individualizados en el presente documento, en el estado en que se encuentran, sin modificaciones, debiendo permanecer en la ubicacion informada a EL LOCADOR, no pudiendo ser trasladados sin autorizacion previa y expresa.`
  );
  drawUnitsTable(doc, units);

  sectionTitle(doc, 'SEGUNDA - CONDICIONES ECONOMICAS');
  paragraph(
    doc,
    `El precio del arrendamiento se fija${alquiler ? ` en la suma de ${money(alquiler.amount, alquiler.currency_code || currency)}` : ''} ${unitCount > 1 ? 'por los contenedores incluidos en el presente contrato' : 'mensuales'}.${
      garantia ? ` EL LOCATARIO debera abonar una garantia equivalente a dicho monto, representada en ${money(garantia.amount, garantia.currency_code || currency)}, la cual sera reembolsable una vez restituida la unidad y verificado su estado.` : ''
    }${flete ? ` El costo del flete de ida y vuelta se establece en ${money(flete.amount, flete.currency_code || currency)}, a cargo de EL LOCATARIO.` : ''}`
  );
  drawLinesTable(doc, lines, currency);

  sectionTitle(doc, 'TERCERA - PLAZO MINIMO Y REVISION');
  paragraph(
    doc,
    `El plazo minimo del presente contrato sera de ${minimumTermMonths} mes${minimumTermMonths === 1 ? '' : 'es'}, contados a partir de la fecha de entrega del contenedor, que se acreditara mediante acta o recibo correspondiente. Asimismo, una vez cumplido el plazo minimo de ${reviewAfterMonths} mes${reviewAfterMonths === 1 ? '' : 'es'}, EL LOCADOR se reserva el derecho de revisar y eventualmente modificar las condiciones economicas del presente contrato, incluyendo el canon de arrendamiento, en funcion de variaciones del mercado, costos operativos o condiciones comerciales, debiendo notificar a EL LOCATARIO con una antelacion minima de ${reviewNoticeDays} dia${reviewNoticeDays === 1 ? '' : 's'}.`
  );

  sectionTitle(doc, 'CUARTA - PAGO, MORA E INTIMACION');
  paragraph(
    doc,
    `El canon de arrendamiento debera ser abonado por EL LOCATARIO dentro de los primeros ${paymentDueDay} dia${paymentDueDay === 1 ? '' : 's'} de cada mes, por adelantado. EL LOCADOR podra, a su sola discrecion, cursar una notificacion preventiva con una antelacion minima de ${preventiveNoticeHours} hora${preventiveNoticeHours === 1 ? '' : 's'} respecto del vencimiento del plazo de pago, sin que dicha notificacion constituya requisito ni condicion para la configuracion automatica de la mora. En caso de falta de pago total o parcial dentro del plazo establecido, las sumas adeudadas devengaran un interes moratorio equivalente al ${contract.late_fee_monthly_pct || 7}% mensual, el cual sera calculado y exigible por cada dia de atraso, aplicandose una tasa diaria equivalente al ${contract.late_fee_daily_pct || 0.233}%, sobre el monto efectivamente adeudado. El interes se devengara desde el dia siguiente al vencimiento y hasta la fecha de pago efectivo, computandose todos los dias del mes, habiles o no, bajo la modalidad de interes simple y sin capitalizacion. Sin perjuicio de lo anterior, las partes convienen expresamente que el monto total de los intereses moratorios acumulados no podra superar en ningun caso el ${contract.late_fee_annual_pct || 27.07}% anual del monto del alquiler adeudado. En caso de persistir el incumplimiento, EL LOCADOR, previa intimacion de pago por un plazo de ${paymentIntimationDays} dia${paymentIntimationDays === 1 ? '' : 's'}, equivalentes a ${paymentIntimationDays * 24} hora${paymentIntimationDays * 24 === 1 ? '' : 's'}, y sin que se haya regularizado la deuda, podra descontar de la garantia constituida al inicio del presente contrato los importes correspondientes al alquiler adeudado, intereses y demas cargos pactados, quedando ademas expresamente autorizado a proceder al retiro del o de los contenedores, siendo todos los costos imputados exclusivamente a EL LOCATARIO.`
  );

  sectionTitle(doc, 'QUINTA - INTERES MORATORIO');
  paragraph(
    doc,
    'El interes moratorio pactado tiene caracter estrictamente convencional y sera exigible de pleno derecho por cada dia de atraso, sin necesidad de interpelacion judicial o extrajudicial previa.'
  );

  sectionTitle(doc, 'SEXTA - ESTADO DE LA UNIDAD Y RESPONSABILIDAD');
  paragraph(
    doc,
    'EL LOCATARIO declara haber examinado el o los contenedores objeto del presente contrato y recibirlos en buen estado. EL LOCADOR no sera responsable bajo ningun concepto por la mercaderia almacenada o conservada dentro del contenedor, ni por su custodia, conservacion, perdida o deterioro.'
  );

  sectionTitle(doc, 'SEPTIMA - VALOR DE REPOSICION');
  paragraph(
    doc,
    `En caso de perdida o dano total del contenedor, EL LOCATARIO debera abonar a EL LOCADOR el valor de reposicion de la unidad al momento del siniestro, el cual no podra ser inferior a ${money(replacementValueUsd, 'USD')}.`
  );

  sectionTitle(doc, 'OCTAVA - INSPECCION');
  paragraph(
    doc,
    `EL LOCADOR podra inspeccionar el contenedor con aviso previo de ${inspectionNoticeHours} hora${inspectionNoticeHours === 1 ? '' : 's'}.`
  );

  sectionTitle(doc, 'OCTAVA BIS - SEGURO');
  paragraph(
    doc,
    insuranceRequired
      ? 'EL LOCATARIO se obliga a contratar seguro sobre la mercaderia, siendo de su exclusiva responsabilidad la cobertura y vigencia de dicha poliza.'
      : 'Las partes dejan constancia de que el presente contrato no establece una obligacion especifica de contratar seguro, sin perjuicio de las coberturas que EL LOCATARIO decida mantener bajo su exclusiva responsabilidad.'
  );

  sectionTitle(doc, 'NOVENA - JURISDICCION');
  paragraph(
    doc,
    `Las partes se someten a la competencia de ${jurisdictionText}, Republica del Paraguay.`
  );

  sectionTitle(doc, 'DECIMA - OBSERVACIONES COMPLEMENTARIAS');
  paragraph(
    doc,
    contract.notes ||
      'Toda condicion adicional, aclaracion operativa, anexo tecnico o revision posterior debera quedar incorporada por escrito, formando parte integrante del presente contrato.'
  );

  sectionTitle(doc, 'CONFORMIDAD');
  paragraph(
    doc,
    'Leido el presente contrato y encontrandolo conforme, las partes firman en dos ejemplares de un mismo tenor y a un solo efecto.'
  );
  signaturesBlock(doc, ctx);

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(i);
    const footerY = doc.page.height - 26;
    doc.font('Helvetica').fontSize(8).fillColor('#6b7280').text(
      `Contrato ${contract.contract_no || '-'} | OP ${contract.deal_reference || '-'} | Pagina ${i + 1} de ${range.count}`,
      doc.page.margins.left,
      footerY,
      {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: 'center',
      }
    );
  }

  doc.end();
}
