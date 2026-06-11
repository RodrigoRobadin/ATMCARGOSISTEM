from reportlab.lib import colors
from reportlab.lib.pagesizes import A3, landscape
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.lib.utils import simpleSplit
from pathlib import Path


OUT = Path(__file__).with_name("flujo-detallado-sistema-atm.pdf")
W, H = landscape(A3)

PAL = {
    "paper": colors.HexColor("#FBFAF6"),
    "ink": colors.HexColor("#13232F"),
    "muted": colors.HexColor("#66727C"),
    "blue": colors.HexColor("#174A63"),
    "blue2": colors.HexColor("#2F6F8F"),
    "orange": colors.HexColor("#D46A37"),
    "green": colors.HexColor("#3A7D6A"),
    "yellow": colors.HexColor("#D7A441"),
    "line": colors.HexColor("#D9D5CB"),
    "soft": colors.HexColor("#F0EDE5"),
    "white": colors.white,
    "dark": colors.HexColor("#0E1A24"),
    "red": colors.HexColor("#B94A48"),
}


def setup(c, title, subtitle=None, page=1, dark=False):
    c.setFillColor(PAL["dark"] if dark else PAL["paper"])
    c.rect(0, 0, W, H, stroke=0, fill=1)
    c.setFillColor(PAL["orange"])
    c.rect(0, 0, 10, H, stroke=0, fill=1)
    c.setFillColor(PAL["blue"])
    c.rect(10, 0, 10, H, stroke=0, fill=1)
    c.setFillColor(PAL["white"] if dark else PAL["ink"])
    c.setFont("Times-Bold", 30)
    c.drawString(52, H - 62, title)
    if subtitle:
        c.setFillColor(colors.HexColor("#C9D7DF") if dark else PAL["muted"])
        c.setFont("Helvetica", 11)
        for i, line in enumerate(simpleSplit(subtitle, "Helvetica", 11, W - 130)):
            c.drawString(54, H - 84 - i * 14, line)
    c.setStrokeColor(colors.HexColor("#2C3A44") if dark else PAL["line"])
    c.line(52, 38, W - 52, 38)
    c.setFillColor(colors.HexColor("#8FA3B0") if dark else PAL["muted"])
    c.setFont("Helvetica", 8)
    c.drawString(52, 24, "ATM Cargo Sistem | Flujo detallado del sistema")
    c.setFillColor(PAL["white"] if dark else PAL["ink"])
    c.setFont("Helvetica-Bold", 10)
    c.drawRightString(W - 52, 24, f"{page:02d}")


def box(c, x, y, w, h, title, body="", fill="#FFFFFF", accent=None, font_size=8.5, title_size=10.5):
    c.setFillColor(colors.HexColor(fill) if isinstance(fill, str) else fill)
    c.setStrokeColor(PAL["line"])
    c.roundRect(x, y, w, h, 4, stroke=1, fill=1)
    if accent:
        c.setFillColor(accent)
        c.rect(x, y, 5, h, stroke=0, fill=1)
    c.setFillColor(PAL["ink"])
    c.setFont("Helvetica-Bold", title_size)
    title_lines = simpleSplit(title, "Helvetica-Bold", title_size, w - 24)
    max_title_lines = max(1, int((h * 0.34) // (title_size + 3)))
    title_lines = title_lines[:max_title_lines]
    for i, line in enumerate(title_lines):
        c.drawString(x + 14, y + h - 18 - i * 13, line)
    if body:
        c.setFillColor(PAL["muted"])
        c.setFont("Helvetica", font_size)
        yy = y + h - 24 - len(title_lines) * 13
        min_y = y + 12
        lines = simpleSplit(body, "Helvetica", font_size, w - 24)
        max_body_lines = max(1, int((yy - min_y) // (font_size + 3)))
        if len(lines) > max_body_lines:
            lines = lines[:max_body_lines]
            if lines:
                lines[-1] = lines[-1].rstrip(".") + "..."
        for line in lines:
            c.drawString(x + 14, yy, line)
            yy -= font_size + 3


def arrow(c, x1, y1, x2, y2, color=None):
    color = color or PAL["blue"]
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(1.4)
    c.line(x1, y1, x2, y2)
    import math
    ang = math.atan2(y2 - y1, x2 - x1)
    size = 6
    p1 = (x2, y2)
    p2 = (x2 - size * math.cos(ang - 0.45), y2 - size * math.sin(ang - 0.45))
    p3 = (x2 - size * math.cos(ang + 0.45), y2 - size * math.sin(ang + 0.45))
    c.line(p1[0], p1[1], p2[0], p2[1])
    c.line(p1[0], p1[1], p3[0], p3[1])
    c.setLineWidth(1)


def lane_label(c, text, x, y, w, color):
    c.setFillColor(color)
    c.roundRect(x, y, w, 24, 3, stroke=0, fill=1)
    c.setFillColor(PAL["white"])
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString(x + w / 2, y + 8, text)


def page_overview(c):
    setup(
        c,
        "Flujo general del sistema",
        "Vista completa: ingreso, CRM, unidades de negocio, operaciones, administracion, finanzas, reportes y gobierno.",
        1,
    )
    y_top = H - 150
    xs = [58, 235, 412, 589, 766, 943]
    titles = [
        ("Login y roles", "Usuario autenticado; permisos por admin, manager, finanzas, servicio y perfiles operativos."),
        ("Vista general", "Pipeline, busqueda global, organizaciones, contactos, oportunidades y seguimiento."),
        ("Unidad de negocio", "El deal se deriva a ATM Cargo, Container, Industrial o Servicio Tecnico."),
        ("Operacion", "Cada modulo registra sus datos, documentos, fechas, costos y responsables."),
        ("Administracion", "Compras, facturas, pagos, cuentas a pagar y gastos se conectan con la operacion."),
        ("Gerencia", "Dashboards, reportes, auditoria y exportaciones para decision."),
    ]
    for i, (t, b) in enumerate(titles):
        box(c, xs[i], y_top, 145, 82, t, b, "#FFFFFF", [PAL["blue"], PAL["green"], PAL["orange"], PAL["blue2"], PAL["yellow"], PAL["green"]][i])
        if i < len(xs) - 1:
            arrow(c, xs[i] + 145, y_top + 41, xs[i + 1] - 10, y_top + 41)

    # Module hub
    hub_y = H - 345
    box(c, 455, hub_y, 250, 76, "Nucleo compartido", "Clientes, organizaciones, contactos, parametros, usuarios, auditoria, documentos y asistente interno.", "#EDF4F3", PAL["green"], 10, 12)
    modules = [
        (90, hub_y + 110, "ATM CARGO", "Carga aerea, maritima, terrestre y multimodal."),
        (90, hub_y - 92, "ATM CONTAINER", "Contenedores, contratos, alertas y facturacion mensual."),
        (820, hub_y + 110, "ATM INDUSTRIAL", "Cotizaciones industriales, despacho, instalacion y financiacion."),
        (820, hub_y - 92, "Servicio tecnico", "Casos, puertas, ordenes de trabajo, repuestos e historial."),
    ]
    for x, y, t, b in modules:
        box(c, x, y, 230, 72, t, b, "#FFFFFF", PAL["blue"] if "CARGO" in t else PAL["orange"], 9, 12)
        arrow(c, 455 if x < 455 else 705, hub_y + 38, x + (230 if x < 455 else 0), y + 36, PAL["muted"])
        arrow(c, x + (230 if x < 455 else 0), y + 20, 455 if x < 455 else 705, hub_y + 16, PAL["muted"])

    box(c, 325, 92, 510, 72, "Salida final del sistema", "Facturacion, recibos, estados de cuenta, cuentas a pagar, reportes operativos, reportes gerenciales y trazabilidad de actividad.", "#F7EEE8", PAL["orange"], 10, 13)


def page_commercial(c):
    setup(c, "Flujo comercial y CRM", "Como entra una oportunidad al sistema y como se convierte en una operacion real.", 2)
    lane_y = H - 135
    lane_label(c, "COMERCIAL", 54, lane_y, 220, PAL["blue"])
    lane_label(c, "OPERACION", 324, lane_y, 220, PAL["green"])
    lane_label(c, "ADMIN / FINANZAS", 594, lane_y, 220, PAL["orange"])
    lane_label(c, "GERENCIA", 864, lane_y, 220, PAL["yellow"])

    y = H - 245
    steps = [
        (70, y, "Organizacion / Contacto", "Registro del cliente, RUC, datos de contacto, sucursales, responsable y notas."),
        (250, y, "Deal / Oportunidad", "Se asigna pipeline, etapa, unidad de negocio, ejecutivo, referencia y valor estimado."),
        (430, y, "Seguimiento", "Actividades, notas, recordatorios, tareas, visitas y senales de alerta por falta de avance."),
        (610, y, "Cotizacion", "Generador o editor de cotizacion; condiciones, items, moneda, PDF y revisiones."),
        (790, y, "Confirmacion", "Al aprobarse, pasa a operacion con datos heredados del deal y la cotizacion."),
        (970, y, "Tablero", "La direccion ve oportunidades, estados, usuarios activos, actividad y resultados."),
    ]
    for i, (x, yy, t, b) in enumerate(steps):
        box(c, x, yy, 145, 94, t, b, "#FFFFFF", [PAL["blue"], PAL["blue"], PAL["green"], PAL["orange"], PAL["green"], PAL["yellow"]][i], 8.3, 10)
        if i < len(steps) - 1:
            arrow(c, x + 145, yy + 47, steps[i + 1][0] - 10, yy + 47)

    y2 = H - 410
    box(c, 70, y2, 235, 92, "Decisiones del flujo", "Si la cotizacion no se confirma, el deal vuelve a seguimiento. Si se confirma, genera una operacion o expediente operativo.", "#EDF4F3", PAL["green"], 9, 12)
    box(c, 350, y2, 235, 92, "Datos que se reutilizan", "Cliente, contacto, referencia, modalidad, origen, destino, mercaderia, pesos, volumenes y condiciones comerciales.", "#FFFFFF", PAL["blue"], 9, 12)
    box(c, 630, y2, 235, 92, "Control comercial", "Alertas de seguimiento, tareas vencidas, ultima actividad, ultima cotizacion y responsable asignado.", "#F7EEE8", PAL["orange"], 9, 12)
    box(c, 910, y2, 170, 92, "Resultado", "Menos oportunidades perdidas y mas orden antes de operar.", "#F4F0DF", PAL["yellow"], 9, 12)

    arrow(c, 188, y - 10, 188, y2 + 92, PAL["muted"])
    arrow(c, 490, y2 + 92, 490, y - 10, PAL["muted"])
    arrow(c, 745, y2 + 92, 745, y - 10, PAL["muted"])


def page_module_detail(c, page_num, name, color, subtitle, steps, details):
    setup(c, f"Modulo: {name}", subtitle, page_num)
    lane_label(c, name, 54, H - 132, 180, color)
    y = H - 255
    x0 = 70
    step_w = 150
    gap = 34
    for i, (t, b) in enumerate(steps):
        x = x0 + i * (step_w + gap)
        box(c, x, y, step_w, 105, t, b, "#FFFFFF" if i % 2 == 0 else "#F7EEE8", color, 8.0, 10)
        if i < len(steps) - 1:
            arrow(c, x + step_w, y + 52, x + step_w + gap - 8, y + 52, color)
    c.setFillColor(PAL["ink"])
    c.setFont("Times-Bold", 20)
    c.drawString(70, H - 330, "Detalle funcional")
    for i, (t, b) in enumerate(details):
        x = 74 + (i % 3) * 350
        yy = H - 455 - (i // 3) * 126
        box(c, x, yy, 300, 90, t, b, "#EDF4F3" if i % 2 == 0 else "#FFFFFF", color, 8.5, 10.5)


def page_admin(c, page_num=7):
    setup(c, "Administracion, finanzas y documentos", "Lo que ocurre cuando una operacion confirmada necesita control administrativo y financiero.", page_num)
    y = H - 210
    steps = [
        ("Operacion confirmada", "Referencia, cliente, unidad de negocio, etapa y responsable."),
        ("Compras / gastos", "Compra operativa, factura de compra, proveedor, items y adjuntos."),
        ("Cuentas a pagar", "Resumen por proveedor, vencimientos, saldos, pagos y exportes."),
        ("Orden de pago", "Agrupa facturas, aprueba pago y genera PDF/ZIP cuando aplica."),
        ("Facturacion cliente", "Factura emitida, nota de credito si aplica, PDF, saldo y vencimiento."),
        ("Cobro / recibo", "Pagos recibidos, recibo PDF, saldo neto y estado de cuenta."),
    ]
    for i, (t, b) in enumerate(steps):
        x = 62 + i * 176
        box(c, x, y, 145, 98, t, b, "#FFFFFF" if i % 2 == 0 else "#F7EEE8", [PAL["blue"], PAL["orange"], PAL["green"], PAL["yellow"], PAL["blue2"], PAL["green"]][i], 8, 9.5)
        if i < len(steps) - 1:
            arrow(c, x + 145, y + 49, x + 166, y + 49)

    y2 = H - 415
    box(c, 80, y2, 260, 95, "Documentos asociados", "Archivos de operacion, adjuntos de gastos, adjuntos de pagos, PDFs de factura, recibo, orden de pago, contrato o reporte.", "#EDF4F3", PAL["blue"], 9, 12)
    box(c, 390, y2, 260, 95, "Estado financiero", "Facturado, pagado, pendiente, saldos por cliente, saldos por proveedor, gastos administrativos y operativos.", "#FFFFFF", PAL["green"], 9, 12)
    box(c, 700, y2, 260, 95, "Reportes y exportes", "Reportes internos por operacion, status report, exportaciones CSV/XLS/PDF y dashboards de gerencia.", "#F7EEE8", PAL["orange"], 9, 12)
    box(c, 1010, y2, 120, 95, "Resultado", "Control de caja, deuda y rentabilidad.", "#F4F0DF", PAL["yellow"], 9, 12)

    arrow(c, 210, y - 10, 210, y2 + 95, PAL["muted"])
    arrow(c, 520, y2 + 95, 520, y - 10, PAL["muted"])
    arrow(c, 830, y2 + 95, 830, y - 10, PAL["muted"])


def page_governance(c, page_num=8):
    setup(c, "Gobierno del sistema y trazabilidad", "Capas transversales que sostienen todo el flujo: seguridad, parametros, busqueda, auditoria, notificaciones y asistente.", page_num)
    items = [
        ("Usuarios y roles", "Administra acceso por perfil: administracion, gerencia, finanzas, servicio y usuarios operativos."),
        ("Parametros", "Listas editables para etapas, condiciones de cotizacion, valores por defecto, bancos, categorias y opciones."),
        ("Auditoria", "Registro de eventos y actividad para saber quien hizo que y cuando."),
        ("Busqueda global", "Acceso rapido a clientes, contactos, operaciones, documentos y referencias."),
        ("Notificaciones y mensajes", "Alertas internas, seguimiento y comunicacion dentro del flujo."),
        ("Asistente interno", "Ayuda contextual sobre operaciones, clientes y acciones asistidas."),
        ("Archivos", "Subidas, descargas, adjuntos, etiquetas visibles y PDFs generados."),
        ("Reportes gerenciales", "Indicadores de pipeline, actividad, finanzas, facturacion, pagos y gastos."),
    ]
    for i, (t, b) in enumerate(items):
        x = 80 + (i % 4) * 270
        y = H - 220 - (i // 4) * 170
        box(c, x, y, 220, 105, t, b, "#FFFFFF" if i % 2 == 0 else "#EDF4F3", [PAL["blue"], PAL["orange"], PAL["green"], PAL["yellow"]][i % 4], 8.8, 11)

    c.setFillColor(PAL["ink"])
    c.setFont("Times-Bold", 22)
    c.drawCentredString(W / 2, 120, "Idea clave: el sistema convierte operaciones dispersas en expedientes trazables, medibles y administrables.")
    c.setFillColor(PAL["muted"])
    c.setFont("Helvetica", 10)
    c.drawCentredString(W / 2, 95, "Ventas, operaciones, administracion y gerencia trabajan sobre la misma informacion.")


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=landscape(A3))
    pages = [
        page_overview,
        page_commercial,
        lambda cc: page_module_detail(
            cc,
            3,
            "ATM CARGO",
            PAL["blue"],
            "Flujo de carga: cotizacion, operacion por modalidad, documentos, cost sheet, facturacion y profit.",
            [
                ("Deal", "Cliente, contacto, ejecutivo, referencia y unidad."),
                ("Cotizacion", "Ruta, incoterm, modalidad, pesos, volumen, items y PDF."),
                ("Operacion", "Aereo, maritimo, terrestre o multimodal."),
                ("Documentos", "House/master, factura comercial, packing list y certificados."),
                ("Cost sheet", "Compra, venta, gastos locales, seguro y profit."),
                ("Factura / cobro", "Factura emitida, recibos y estado de cuenta."),
            ],
            [
                ("Modalidad aerea", "Aeropuertos, aerolinea, peso bruto, volumen, peso chargeable, ETD, ETA y documentos."),
                ("Modalidad maritima", "MBL, HBL, naviera, puertos, free days, itinerario y referencias documentales."),
                ("Modalidad terrestre", "CRT, MIC/DTA, transportista, origen, destino, fechas y datos del traslado."),
                ("Multimodal", "Tramos por modo, carrier, origen, destino, documentos y fechas por tramo."),
                ("Reportes", "Informe interno por operacion, status report y envio por correo cuando aplica."),
                ("Rentabilidad", "Versiones del cost sheet, comparacion compra/venta, alertas y margen por OP."),
            ],
        ),
        lambda cc: page_module_detail(
            cc,
            4,
            "ATM CONTAINER",
            PAL["green"],
            "Flujo de contenedores: unidad, contrato, alertas, servicios y facturacion mensual.",
            [
                ("Deal container", "Cliente, proveedor, tipo de contenedor y referencia."),
                ("Unidad", "Contenedor, tipo, estado, entrega, retiro y mantenimiento."),
                ("Contrato", "Rentas, unidades, plazo minimo, condiciones y revisiones."),
                ("Alertas", "Vencimientos, pagos, intimaciones y revisiones."),
                ("Servicios", "Mantenimiento, adjuntos y registro de intervenciones."),
                ("Facturacion", "Ciclos mensuales, impuesto, estado e invoice."),
            ],
            [
                ("Maestro", "Vista global de contenedores confirmados, reservados, entregados, activos y retirados."),
                ("Contratos", "Contratos con unidades asociadas, lineas de cobro, revisiones, renovaciones y PDF."),
                ("Facturacion mensual", "Generacion de ciclos por contrato/unidad, estado, impuesto e invoice asociado."),
                ("Alertas operativas", "Control de pagos, revisiones, vencimientos, intimaciones e inspecciones."),
                ("Servicios", "Logs de servicios, adjuntos, mantenimiento y cambios de estado del contenedor."),
                ("Control", "Disponibilidad, cliente, proveedor, fechas de entrega/retiro y estado del activo."),
            ],
        ),
        lambda cc: page_module_detail(
            cc,
            5,
            "ATM INDUSTRIAL",
            PAL["orange"],
            "Flujo industrial: oferta, despacho, instalacion, financiacion, operacion y cotizacion formal.",
            [
                ("Oferta", "Puertas, productos, cantidades, moneda, flete y seguro."),
                ("Despacho", "CIF, tasas, IVA, honorarios y gastos aduaneros."),
                ("Instalacion", "Items, costo, precio de venta y profit."),
                ("Financiacion", "Plazos, tasas, recargos y margen financiero."),
                ("Operacion", "Resumen, planillas y datos de ejecucion."),
                ("Cotizacion", "Documento formal con revisiones y exportaciones."),
            ],
            [
                ("Motor de calculo", "Calcula oferta, despacho, instalacion, financiacion y operacion con rubros separados."),
                ("Despacho", "Derecho aduanero, valoracion, IVA, anticipo IRE, SOFIA, honorarios y otros conceptos."),
                ("Instalacion", "Costo y venta en Gs/USD, profit de instalacion y total de venta."),
                ("Financiacion", "Interes de compra, interes de venta, recargos, plazo y margen financiero."),
                ("Rentabilidad", "Compra vs venta por rubro: producto, flete, despacho, adicional, financiacion, instalacion y seguro."),
                ("Documentos", "Cotizaciones formales, revisiones y reportes asociados a la operacion industrial."),
            ],
        ),
        lambda cc: page_module_detail(
            cc,
            6,
            "SERVICIO TECNICO",
            PAL["yellow"],
            "Flujo de servicio: casos, puertas del cliente, ordenes de trabajo, historial, repuestos y cotizaciones.",
            [
                ("Caso", "Cliente, prioridad, etapa, tipo de trabajo y responsable."),
                ("Puertas", "Puertas del cliente, componentes, actuadores y sucursal."),
                ("Trabajo", "Detalle de mantenimiento, reparacion o revision."),
                ("Partes", "Repuestos, componentes usados, notas y costos."),
                ("Orden", "Orden de trabajo y reporte en PDF."),
                ("Cotizacion", "Cotizacion inicial o adicional y revisiones."),
            ],
            [
                ("Pipeline de servicio", "Etapas propias para casos de mantenimiento, reparacion y seguimiento tecnico."),
                ("Ficha de puerta", "Referencia interna, serie, sector, sucursal, componentes y actuadores."),
                ("Historial", "Acciones del caso, cambio de etapa, trabajos realizados, repuestos y costos."),
                ("Orden de trabajo", "PDF con cliente, contacto, prioridad, direccion, tecnicos e items de trabajo."),
                ("Cotizaciones", "Cotizacion del caso, adicionales, revisiones, recalculo y exportacion XLSX."),
                ("Finanzas", "Costos de instalacion, facturacion del servicio y acceso para finanzas cuando aplica."),
            ],
        ),
        lambda cc: page_admin(cc, 7),
        lambda cc: page_governance(cc, 8),
    ]
    for fn in pages:
        fn(c)
        c.showPage()
    c.save()
    print(OUT)


if __name__ == "__main__":
    main()
