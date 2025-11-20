// client/src/utils/generateQuoteEmail.js

/**
 * Genera un correo de cotización para puertas industriales
 * @param {Array} doors - Array de puertas industriales
 * @param {string} dealReference - Referencia de la operación
 * @returns {void} - Abre el cliente de correo y copia el HTML al portapapeles
 */
export function generateQuoteEmail(doors, dealReference) {
  if (!doors || doors.length === 0) {
    alert("No hay puertas para cotizar");
    return;
  }

  // Asunto
  const subject = `Cotizacion - ${dealReference || "SIN-REF"} - Grupo ATM`;

  // Tabla de puertas en HTML
  let tableRows = "";
  doors.forEach((door, index) => {
    const item = index + 1;
    const cant = 1; // Por defecto 1
    const tipo = door.frame_type || "-";
    const dimensiones =
      door.width_available && door.height_available
        ? `${door.width_available}mm ancho x ${door.height_available}mm alto`
        : "-";
    const lugar = door.identifier || "-";
    const tipoMarco = door.frame_material || "-";
    const accionadores = door.actuators || "-";
    const acabado = door.finish || "-";
    const visores = door.visor_lines || "-";

    tableRows += `
        <tr>
          <td style="border: 1px solid #ddd; padding: 8px;">${item}</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${cant}</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${tipo}</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${dimensiones}</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${lugar}</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${tipoMarco}</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${accionadores}</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${acabado}</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${visores}</td>
        </tr>`;
  });

  // Cuerpo del correo
  const body = `
Estimados,

Solicitamos cotización para los siguientes productos:

<table style="border-collapse: collapse; width: 100%; margin: 20px 0;">
  <thead>
    <tr style="background-color: #333; color: white;">
      <th style="border: 1px solid #ddd; padding: 8px;">ITEM</th>
      <th style="border: 1px solid #ddd; padding: 8px;">CANT</th>
      <th style="border: 1px solid #ddd; padding: 8px;">TIPO PRODUCTO</th>
      <th style="border: 1px solid #ddd; padding: 8px;">DIMENSIONES L x H</th>
      <th style="border: 1px solid #ddd; padding: 8px;">LUGAR DESTINADO</th>
      <th style="border: 1px solid #ddd; padding: 8px;">TIPO MARCO</th>
      <th style="border: 1px solid #ddd; padding: 8px;">ACCIONADORES</th>
      <th style="border: 1px solid #ddd; padding: 8px;">ACABADO</th>
      <th style="border: 1px solid #ddd; padding: 8px;">VISORES</th>
    </tr>
  </thead>
  <tbody>
    ${tableRows}
  </tbody>
</table>

<p><strong>Datos necesarios para cotizar FLETE:</strong></p>
<ol>
  <li>Peso y Dimensiones de Producto Embalado de tal manera que podamos calcular flete.</li>
  <li>Listado de Precios de los Productos con su identificación de tal manera de poder cotizar en forma correcta.</li>
  <li>Favor mencionar detalles adicionales que crean convenientes que mencionemos en las cotizaciones.</li>
</ol>

<p>Quedamos atentos a su respuesta.</p>

<p>Saludos cordiales,<br/>Grupo ATM</p>
`;

  // Copiar versión HTML al portapapeles
  const htmlContent = `<div><p><strong>Asunto:</strong> ${subject}</p>${body}</div>`;

  try {
    // Intentar copiar al portapapeles
    const textArea = document.createElement("textarea");
    textArea.value = htmlContent;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);

    alert(
      "Correo HTML copiado al portapapeles. Puedes pegarlo en tu cliente de correo.\n\nTambién se abrirá tu cliente de correo predeterminado."
    );
  } catch (err) {
    console.error("Error copiando al portapapeles:", err);
  }

  // Abrir mailto (versión texto plano)
  const textBody = body.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ");
  const mailtoLink = `mailto:?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(textBody)}`;
  window.location.href = mailtoLink;
}
