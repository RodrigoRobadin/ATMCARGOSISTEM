import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Printer, RefreshCw, Sparkles } from "lucide-react";
import api from "../api";
import AssistantBubble from "../components/AssistantBubble.jsx";
import "./AssistantDashboard.css";

const REPORTS = [
  { key: "open_operations", label: "Operaciones abiertas" },
  { key: "without_quote", label: "Sin cotización" },
  { key: "quote_delay", label: "Antigüedad de cotización" },
  { key: "followup", label: "Seguimientos pendientes" },
  { key: "service", label: "Servicio y mantenimiento" },
];

const number = (value) => Number(value || 0).toLocaleString("es-PY");
const money = (value) => value == null ? "-" : `USD ${Number(value).toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (value) => value ? new Date(value).toLocaleDateString("es-PY", { timeZone: "America/Asuncion" }) : "-";
const timestamp = (value) => value ? new Date(value).toLocaleString("es-PY", { timeZone: "America/Asuncion" }) : "-";

function reportTotal(kind, data) {
  if (!data) return 0;
  if (kind === "open_operations") return Number(data.summary?.total_open_operations || 0);
  if (kind === "without_quote" || kind === "quote_delay") return Number(data.total || 0);
  if (kind === "followup") return Number(data.summary?.pending_tasks || 0);
  return Number(data.summary?.total_service_cases || 0);
}

function reportRows(kind, data) {
  const items = data?.items || [];
  if (kind === "followup") return {
    headers: ["Tarea", "Operación", "Cliente", "Vence"],
    rows: items.map((item) => ({ key: item.id, cells: [item.title || "-", item.deal_reference || "-", item.org_name || "-", date(item.due_at)] })),
  };
  if (kind === "service") return {
    headers: ["Referencia", "Cliente", "Etapa", "Estado", "Programado"],
    rows: items.map((item) => ({ key: item.id, href: `/service/cases/${item.id}`, cells: [item.reference || `Servicio ${item.id}`, item.org_name || "-", item.stage_name || "-", item.status || "-", date(item.scheduled_date)] })),
  };
  if (kind === "quote_delay") return {
    headers: ["Referencia", "Cliente", "Unidad", "Días desde cotización", "Venta"],
    rows: items.map((item) => ({ key: item.id, href: `/operations/${item.id}`, cells: [item.reference || `Operación ${item.id}`, item.org_name || "-", item.business_unit_name || "-", number(item.quote_age_days), money(item.operation_sale_value_usd)] })),
  };
  if (kind === "without_quote") return {
    headers: ["Referencia", "Cliente", "Unidad", "Creada"],
    rows: items.map((item) => ({ key: item.id, href: `/operations/${item.id}`, cells: [item.reference || `Operación ${item.id}`, item.org_name || "-", item.business_unit_name || "-", date(item.created_at)] })),
  };
  return {
    headers: ["Referencia", "Cliente", "Unidad", "Cotización", "Venta"],
    rows: items.map((item) => ({ key: item.id, href: `/operations/${item.id}`, cells: [item.reference || `Operación ${item.id}`, item.org_name || "-", item.business_unit_name || "-", item.has_quote ? "Sí" : "No", money(item.operation_sale_value_usd)] })),
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  const safe = /^[=+@-]/.test(text.trimStart()) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export default function AssistantDashboard() {
  const [businessUnit, setBusinessUnit] = useState("");
  const [delayDays, setDelayDays] = useState(15);
  const [kind, setKind] = useState("open_operations");
  const [refreshKey, setRefreshKey] = useState(0);
  const [overview, setOverview] = useState(null);
  const [report, setReport] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(true);
  const [overviewError, setOverviewError] = useState("");
  const [reportError, setReportError] = useState("");

  useEffect(() => {
    let live = true;
    setOverviewLoading(true);
    setOverviewError("");
    api.get("/assistant/dashboard", { params: { business_unit_slug: businessUnit || undefined } })
      .then(({ data }) => { if (live) setOverview(data); })
      .catch((error) => { if (live) setOverviewError(error.response?.data?.message || "No se pudo cargar el panel."); })
      .finally(() => { if (live) setOverviewLoading(false); });
    return () => { live = false; };
  }, [businessUnit, refreshKey]);

  useEffect(() => {
    let live = true;
    setReport(null);
    setReportLoading(true);
    setReportError("");
    api.get(`/assistant/reports/${kind}`, { params: {
      business_unit_slug: ["followup", "service"].includes(kind) ? undefined : businessUnit || undefined,
      min_delay_days: kind === "quote_delay" ? delayDays : undefined,
      limit: 500,
    } })
      .then(({ data }) => { if (live) setReport(data); })
      .catch((error) => { if (live) setReportError(error.response?.data?.message || "No se pudo generar el informe."); })
      .finally(() => { if (live) setReportLoading(false); });
    return () => { live = false; };
  }, [kind, businessUnit, delayDays, refreshKey]);

  const availableReports = REPORTS.filter((item) => item.key !== "followup" || overview?.followup)
    .filter((item) => item.key !== "service" || overview?.service);
  const selected = REPORTS.find((item) => item.key === kind);
  const table = useMemo(() => reportRows(kind, report?.data), [kind, report]);
  const total = reportTotal(kind, report?.data);
  const unitName = overview?.business_units?.find((item) => item.key_slug === businessUnit)?.name || "Todas las unidades";

  function downloadCsv() {
    if (!report || !table.rows.length) return;
    const metadata = [
      ["Informe", selected.label],
      ["Generado", timestamp(report.generated_at)],
      ["Unidad", ["followup", "service"].includes(kind) ? "Todas" : unitName],
      ["Total de registros", total],
      ["Registros incluidos (máximo 500)", table.rows.length],
      [],
      table.headers,
      ...table.rows.map((row) => row.cells),
    ];
    const csv = `\uFEFF${metadata.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `atm-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <main className="atm-assistant-dashboard">
    <header className="atm-assistant-page-head">
      <div>
        <div className="atm-assistant-eyebrow"><Sparkles size={15} /> Inteligencia comercial</div>
        <h1>Asistente IA</h1>
        <p>Consultas e informes del CRM</p>
      </div>
      <button type="button" className="atm-assistant-icon-button" onClick={() => setRefreshKey((value) => value + 1)} title="Actualizar datos" aria-label="Actualizar datos"><RefreshCw size={18} /></button>
    </header>

    <div className="atm-assistant-toolbar">
      <label>Unidad de negocio
        <select value={businessUnit} onChange={(event) => setBusinessUnit(event.target.value)}>
          <option value="">Todas las unidades</option>
          {(overview?.business_units || []).map((unit) => <option key={unit.key_slug} value={unit.key_slug}>{unit.name}</option>)}
        </select>
      </label>
      <span className="atm-assistant-asof">Datos al {timestamp(overview?.generated_at)}</span>
    </div>

    {overviewError && <div className="atm-assistant-error" role="alert">{overviewError}</div>}
    <div className="atm-assistant-metrics" aria-busy={overviewLoading}>
      <div><span>Operaciones abiertas</span><strong>{overviewLoading ? "…" : number(overview?.operations?.summary?.total_open_operations)}</strong><small>{money(overview?.operations?.summary?.total_open_sales_value_usd)} presupuestados</small></div>
      <div><span>Sin cotización</span><strong>{overviewLoading ? "…" : number(overview?.without_quote?.total)}</strong><small>Operaciones abiertas</small></div>
      <div><span>Cotización de 15+ días</span><strong>{overviewLoading ? "…" : number(overview?.quote_delay?.total)}</strong><small>Con fecha registrada</small></div>
      {overview?.followup && <div><span>Tareas pendientes</span><strong>{number(overview.followup.summary?.pending_tasks)}</strong><small>Seguimiento general</small></div>}
      {overview?.service && <div><span>Servicios abiertos</span><strong>{number(overview.service.summary?.open_cases)}</strong><small>Servicio y mantenimiento</small></div>}
    </div>

    <div className="atm-assistant-columns">
      <section className="atm-assistant-reports" aria-label="Informes del CRM">
        <div className="atm-assistant-section-head"><div><h2>Informes</h2><p>Registros actuales del sistema</p></div></div>
        <div className="atm-assistant-report-tabs" role="tablist" aria-label="Tipo de informe">
          {availableReports.map((item) => <button key={item.key} type="button" role="tab" aria-selected={kind === item.key} onClick={() => setKind(item.key)}>{item.label}</button>)}
        </div>
        <div className="atm-assistant-report-head">
          <div><h3>{selected?.label}</h3><p>{reportLoading ? "Generando…" : `${number(total)} registros · ${number(table.rows.length)} incluidos · ${timestamp(report?.generated_at)}`}</p></div>
          <div className="atm-assistant-report-actions">
            {kind === "quote_delay" && <label>Días <select value={delayDays} onChange={(event) => setDelayDays(Number(event.target.value))}><option value={15}>15</option><option value={30}>30</option><option value={60}>60</option></select></label>}
            <button type="button" onClick={downloadCsv} disabled={!table.rows.length || reportLoading} title="Descargar CSV" aria-label="Descargar CSV"><Download size={17} /></button>
            <button type="button" onClick={() => window.print()} disabled={!report || reportLoading} title="Imprimir informe" aria-label="Imprimir informe"><Printer size={17} /></button>
          </div>
        </div>
        {reportError && <div className="atm-assistant-error" role="alert">{reportError}</div>}
        <div className="atm-assistant-table-wrap">
          <table><thead><tr>{table.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
            <tbody>{table.rows.map((row) => <tr key={row.key}>{row.cells.map((cell, index) => <td key={index}>{index === 0 && row.href ? <Link to={row.href}>{cell}</Link> : cell}</td>)}</tr>)}</tbody>
          </table>
          {!reportLoading && !reportError && !table.rows.length && <div className="atm-assistant-empty">No hay registros para este informe.</div>}
        </div>
        {total > table.rows.length && <p className="atm-assistant-limit">El informe muestra los primeros {number(table.rows.length)} registros de {number(total)}.</p>}
      </section>
      <section className="atm-assistant-chat" aria-label="Conversación con el asistente">
        <AssistantBubble embedded />
      </section>
    </div>
  </main>;
}
