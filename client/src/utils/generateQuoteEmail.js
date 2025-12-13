// client/src/utils/generateQuoteEmail.js
// Genera texto (y HTML) para correos de cotizacion de puertas industriales

function normalize(value) {
  if (value === null || value === undefined) return "-";
  const txt = String(value).replace(/\s+/g, " ").trim();
  return txt || "-";
}

function fmtNumberMm(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return null;
  if (Math.abs(num) >= 1000) return num.toFixed(0);
  return num.toFixed(3);
}

function buildPlainTable(doors = []) {
  const columns = [
    { label: "ITEM", value: d => String(d.__item || "").padStart(2, "0") },
    { label: "CANT", value: d => d.quantity || 1 },
    { label: "TIPO PRODUCTO", value: d => (d.product_name || d.frame_type || d.canvas_type || "-").toUpperCase() },
    {
      label: "DIMENSIONES L x H",
      value: d => {
        const w = fmtNumberMm(d.width_available);
        const h = fmtNumberMm(d.height_available);
        if (w && h) return `ANCHO: ${w} mm / ALTO: ${h} mm`;
        if (w) return `ANCHO: ${w} mm / ALTO: -`;
        if (h) return `ANCHO: - / ALTO: ${h} mm`;
        return "-";
      }
    },
    { label: "LUGAR DESTINADO", value: d => (d.identifier || "-").toUpperCase() },
    { label: "TIPO MARCO", value: d => (d.frame_material || d.frame_type || "-").toUpperCase() },
    { label: "ACCIONADORES", value: d => (d.actuators || "-").toUpperCase() },
    { label: "VISORES", value: d => (d.visor_lines || "-").toUpperCase() },
    { label: "ACABADO", value: d => (d.finish || "-").toUpperCase() },
    { label: "COLOR LONA", value: d => (d.canvas_color || d.canvas_type || "-").toUpperCase() }
  ];

  const header = `| ${columns.map(c => c.label).join(" | ")} |`;
  const separator = `| ${columns.map(c => "-".repeat(Math.max(4, c.label.length))).join(" | ")} |`;

  const rows = doors.map(door => {
    const enriched = { ...door };
    const cells = columns.map(c => normalize(c.value(enriched)));
    return `| ${cells.join(" | ")} |`;
  });

  return [header, separator, ...rows].join("\n");
}

export function buildQuoteEmailPlainText(doors, dealReference) {
  const subject = `Solicitud de cotizacion - ${dealReference || "SIN-REF"} - Grupo ATM`;
  const preparedDoors = Array.isArray(doors)
    ? doors.map((d, idx) => ({ ...d, __item: idx + 1, quantity: d.quantity || 1 }))
    : [];
  const table = buildPlainTable(preparedDoors);

  const bodyLines = [
    "Estimados,",
    "",
    "Solicitamos cotizacion para los siguientes productos:",
    "",
    table,
    "",
    "Datos necesarios para cotizar FLETE:",
    "1) Peso y dimensiones de producto embalado.",
    "2) Listado de precios con identificacion de producto.",
    "3) Detalles adicionales relevantes para la cotizacion.",
    "",
    "Saludos,",
    "Grupo ATM"
  ];

  return { subject, body: bodyLines.join("\n") };
}

export function buildQuoteEmailHtml(doors, dealReference) {
  const subject = `Solicitud de cotizacion - ${dealReference || "SIN-REF"} - Grupo ATM`;
  const rows = (Array.isArray(doors) ? doors : []).map((d, idx) => {
    const item = String(idx + 1).padStart(2, "0");
    const qty = d.quantity || 1;
    const tipo = (d.product_name || d.frame_type || d.canvas_type || "-").toUpperCase();
    const dim = `ANCHO: ${d.width_available ?? "-"} mm / ALTO: ${d.height_available ?? "-"} mm`;
    const lugar = (d.identifier || "-").toUpperCase();
    const marco = (d.frame_material || d.frame_type || "-").toUpperCase();
    const acc = (d.actuators || "-").toUpperCase();
    const vis = (d.visor_lines || "-").toUpperCase();
    const acab = (d.finish || "-").toUpperCase();
    const color = (d.canvas_color || d.canvas_type || "-").toUpperCase();

    return `
      <tr>
        <td style="border:1px solid #555;padding:6px 10px;">${item}</td>
        <td style="border:1px solid #555;padding:6px 10px;text-align:center;">${qty}</td>
        <td style="border:1px solid #555;padding:6px 10px;">${tipo}</td>
        <td style="border:1px solid #555;padding:6px 10px;">${dim}</td>
        <td style="border:1px solid #555;padding:6px 10px;">${lugar}</td>
        <td style="border:1px solid #555;padding:6px 10px;">${marco}</td>
        <td style="border:1px solid #555;padding:6px 10px;">${acc}</td>
        <td style="border:1px solid #555;padding:6px 10px;">${vis}</td>
        <td style="border:1px solid #555;padding:6px 10px;">${acab}</td>
        <td style="border:1px solid #555;padding:6px 10px;">${color}</td>
      </tr>
    `;
  }).join("");

  const html = `
  <div style="font-family:Arial, sans-serif; font-size:13px; color:#111; line-height:1.5;">
    <p>Estimados,</p>
    <p>Solicitamos cotizacion para los siguientes productos:</p>
    <table style="border-collapse:collapse; width:100%; margin:14px 0; background:#fdfdfd;">
      <thead>
        <tr style="background:#2f3136; color:#fff;">
          <th style="border:1px solid #555;padding:6px 10px;">ITEM</th>
          <th style="border:1px solid #555;padding:6px 10px;">CANT</th>
          <th style="border:1px solid #555;padding:6px 10px;">TIPO PRODUCTO</th>
          <th style="border:1px solid #555;padding:6px 10px;">DIMENSIONES L x H</th>
          <th style="border:1px solid #555;padding:6px 10px;">LUGAR DESTINADO</th>
          <th style="border:1px solid #555;padding:6px 10px;">TIPO MARCO</th>
          <th style="border:1px solid #555;padding:6px 10px;">ACCIONADORES</th>
          <th style="border:1px solid #555;padding:6px 10px;">VISORES</th>
          <th style="border:1px solid #555;padding:6px 10px;">ACABADO</th>
          <th style="border:1px solid #555;padding:6px 10px;">COLOR LONA</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    <p><strong>Datos necesarios para cotizar FLETE:</strong></p>
    <ol style="padding-left:20px;">
      <li>Peso y dimensiones de producto embalado.</li>
      <li>Listado de precios con identificacion de producto.</li>
      <li>Detalles adicionales relevantes para la cotizacion.</li>
    </ol>
    <p>Saludos,<br/>Grupo ATM</p>
  </div>
  `;

  return { subject, html };
}

async function safeCopy(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.error("No se pudo copiar con navigator.clipboard:", err);
  }

  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "absolute";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
    return true;
  } catch (err) {
    console.error("No se pudo copiar al portapapeles:", err);
    return false;
  }
}

/**
 * Genera el HTML y texto plano, intenta copiar HTML al portapapeles, y abre mailto con texto.
 * @returns {{ subject: string, body: string, copied: boolean }}
 */
export async function generateQuoteEmail(doors, dealReference) {
  const { subject, body } = buildQuoteEmailPlainText(doors, dealReference);
  const { html } = buildQuoteEmailHtml(doors, dealReference);

  let copied = false;
  // Intentar copiar HTML rico al portapapeles
  try {
    if (navigator?.clipboard?.write) {
      const plainBlob = new Blob([body], { type: "text/plain" });
      const htmlBlob = new Blob([html], { type: "text/html" });
      const item = new ClipboardItem({
        "text/html": htmlBlob,
        "text/plain": plainBlob,
      });
      await navigator.clipboard.write([item]);
      copied = true;
    }
  } catch (err) {
    console.error("No se pudo copiar HTML enriquecido:", err);
  }

  // Fallback: copiar texto plano si no se pudo HTML
  if (!copied) {
    copied = await safeCopy(`${subject}\n\n${body}`);
  }

  const mailtoLink = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = mailtoLink;
  return { subject, body, copied };
}
