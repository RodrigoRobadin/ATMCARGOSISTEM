import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth.jsx";

const today = new Date();

const toYMD = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);

const currencyName = (currency) => String(currency || "PYG").toUpperCase();

function money(value, currency = "PYG") {
  const code = currencyName(currency);
  const decimals = code === "PYG" || code === "GS" ? 0 : 2;
  return `${code} ${Number(value || 0).toLocaleString("es-PY", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function amountText(value, currency = "PYG") {
  const code = currencyName(currency);
  const decimals = code === "PYG" || code === "GS" ? 0 : 2;
  return Number(value || 0).toLocaleString("es-PY", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

const MONTH_LABELS = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SET", "OCT", "NOV", "DIC"];

function dateText(value) {
  if (!value) return "Sin fecha";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString("es-PY");
}

function monthText(value) {
  if (!value) return "-";
  const d = new Date(`${value}-01T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("es-PY", { month: "long", year: "numeric" });
}

function monthlyGoalKey(year, businessUnitId, currency) {
  return [year || "", businessUnitId || "all", currencyName(currency)].join("|");
}

function statusTone(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("vencido")) return "bg-red-50 text-red-700 border-red-200";
  if (s.includes("pag") || s.includes("cobrado")) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (s.includes("sin_fecha")) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

function docHref(doc) {
  if (doc.source_type === "invoice") return `/invoices/${doc.source_id}`;
  if (doc.source_type === "operation_expense_invoice") return `/admin-ops/purchases`;
  if (doc.source_type === "admin_expense") return `/admin-expenses`;
  return "";
}

function SummaryCard({ title, values, tone = "slate" }) {
  const entries = Object.entries(values || {}).sort(([a], [b]) => a.localeCompare(b));
  const toneClass = tone === "red" ? "text-red-700" : tone === "emerald" ? "text-emerald-700" : "text-slate-900";
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-xs text-slate-500">{title}</div>
      <div className={`mt-2 space-y-1 text-lg font-semibold ${toneClass}`}>
        {entries.length ? entries.map(([currency, amount]) => (
          <div key={currency}>{money(amount, currency)}</div>
        )) : <div>{money(0, "PYG")}</div>}
      </div>
    </div>
  );
}

function TabButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-sm ${active ? "bg-black text-white" : "border bg-white hover:bg-slate-50"}`}
    >
      {children}
    </button>
  );
}

function AdjustmentModal({ row, onClose, onSave, onClear }) {
  const [expectedDate, setExpectedDate] = useState(row?.expected_date || "");
  const [amount, setAmount] = useState(row?.amount ?? "");
  const [note, setNote] = useState(row?.adjustment_note || "");

  useEffect(() => {
    setExpectedDate(row?.expected_date || "");
    setAmount(row?.amount ?? "");
    setNote(row?.adjustment_note || "");
  }, [row]);

  if (!row) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded-lg border bg-white shadow-xl">
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div>
            <div className="text-lg font-semibold">Ajustar proyeccion</div>
            <div className="text-sm text-slate-500">{row.label} - {row.party_name || "Sin cliente/proveedor"}</div>
          </div>
          <button type="button" className="text-sm underline" onClick={onClose}>Cerrar</button>
        </div>
        <div className="space-y-3 p-5">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Fecha esperada</span>
              <input type="date" value={expectedDate || ""} onChange={(e) => setExpectedDate(e.target.value)} className="w-full rounded-lg border px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Monto esperado</span>
              <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded-lg border px-3 py-2" />
            </label>
          </div>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Observacion</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="w-full rounded-lg border px-3 py-2" />
          </label>
        </div>
        <div className="flex justify-between border-t px-5 py-4">
          <button type="button" onClick={() => onClear(row)} className="rounded-lg border border-red-200 px-4 py-2 text-sm text-red-700">
            Quitar ajuste
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
            <button
              type="button"
              onClick={() => onSave(row, { expected_date: expectedDate || null, expected_amount: amount, note })}
              className="rounded-lg bg-black px-4 py-2 text-sm text-white"
            >
              Guardar ajuste
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DocumentsTable({ rows, onAdjust }) {
  return (
    <div className="overflow-auto rounded-lg border bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-100 text-slate-600">
          <tr>
            <th className="px-3 py-2 text-left">Fecha</th>
            <th className="px-3 py-2 text-left">Tipo</th>
            <th className="px-3 py-2 text-left">Documento</th>
            <th className="px-3 py-2 text-left">Cliente/Proveedor</th>
            <th className="px-3 py-2 text-left">Operacion</th>
            <th className="px-3 py-2 text-right">Monto</th>
            <th className="px-3 py-2 text-right">Pagado/Cobrado</th>
            <th className="px-3 py-2 text-right">Saldo</th>
            <th className="px-3 py-2 text-left">Estado</th>
            <th className="px-3 py-2 text-right">Accion</th>
          </tr>
        </thead>
        <tbody>
          {(rows || []).map((row) => {
            const href = docHref(row);
            const date = row.expected_date || row.actual_date;
            return (
              <tr key={`${row.source_type}-${row.source_id}-${row.direction}-${row.kind}`} className="border-t">
                <td className="px-3 py-2 whitespace-nowrap">
                  <div>{dateText(date)}</div>
                  {row.adjusted ? <div className="text-[11px] text-blue-600">ajustado</div> : null}
                </td>
                <td className="px-3 py-2">
                  <span className={row.direction === "in" ? "text-emerald-700" : "text-red-700"}>
                    {row.direction === "in" ? "Entrada" : "Salida"} {row.kind === "actual" ? "real" : "proyectada"}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {href ? <Link className="font-medium text-blue-700 hover:underline" to={href}>{row.label}</Link> : row.label}
                </td>
                <td className="px-3 py-2">{row.party_name || "-"}</td>
                <td className="px-3 py-2">{row.operation_reference || "-"}</td>
                <td className="px-3 py-2 text-right">{money(row.amount, row.currency_code)}</td>
                <td className="px-3 py-2 text-right">{money(row.paid_amount, row.currency_code)}</td>
                <td className="px-3 py-2 text-right">{money(row.balance, row.currency_code)}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${statusTone(row.schedule_status || row.status)}`}>
                    {row.schedule_status || row.status || "-"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  {row.kind === "projected" ? (
                    <button type="button" onClick={() => onAdjust(row)} className="rounded border px-2 py-1 text-xs hover:bg-slate-50">
                      Ajustar
                    </button>
                  ) : "-"}
                </td>
              </tr>
            );
          })}
          {!rows?.length ? (
            <tr>
              <td colSpan={10} className="px-3 py-6 text-center text-slate-500">Sin documentos</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function DiagnosticsPanel({ diagnostics }) {
  const summary = diagnostics?.summary || { total: 0, by_severity: {}, by_category: {} };
  const issues = diagnostics?.issues || [];
  const severityTone = (severity) => {
    if (severity === "alta") return "border-red-200 bg-red-50 text-red-700";
    if (severity === "media") return "border-amber-200 bg-amber-50 text-amber-700";
    return "border-slate-200 bg-slate-50 text-slate-600";
  };
  const categoryLabels = {
    fechas: "Fechas",
    vencidos: "Vencidos",
    vinculos: "Vinculos",
    terceros: "Clientes/Proveedores",
    montos: "Montos",
    facturacion: "Facturacion",
    costos_reales: "Costos reales",
    presupuesto: "Presupuesto",
    revision: "Revision",
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border bg-white p-4">
          <div className="text-xs text-slate-500">Observaciones</div>
          <div className="mt-1 text-2xl font-bold">{summary.total || 0}</div>
        </div>
        {["alta", "media", "baja"].map((severity) => (
          <div key={severity} className={`rounded-lg border p-4 ${severityTone(severity)}`}>
            <div className="text-xs capitalize">Prioridad {severity}</div>
            <div className="mt-1 text-2xl font-bold">{summary.by_severity?.[severity] || 0}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border bg-white p-4">
        <div className="mb-3 font-semibold">Tipos de problemas detectados</div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(summary.by_category || {}).map(([category, count]) => (
            <span key={category} className="rounded-full border bg-slate-50 px-3 py-1 text-sm">
              {categoryLabels[category] || category}: <b>{count}</b>
            </span>
          ))}
          {!Object.keys(summary.by_category || {}).length ? (
            <span className="text-sm text-slate-500">Sin problemas detectados en el rango.</span>
          ) : null}
        </div>
      </div>

      <div className="overflow-auto rounded-lg border bg-white">
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">Prioridad</th>
              <th className="px-3 py-2 text-left">Problema</th>
              <th className="px-3 py-2 text-left">Documento/Operacion</th>
              <th className="px-3 py-2 text-left">Cliente/Proveedor</th>
              <th className="px-3 py-2 text-right">Monto</th>
              <th className="px-3 py-2 text-left">Fecha</th>
              <th className="px-3 py-2 text-left">Accion sugerida</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue) => (
              <tr key={issue.id} className="border-t align-top">
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs capitalize ${severityTone(issue.severity)}`}>
                    {issue.severity}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{issue.title}</div>
                  <div className="text-xs text-slate-500">{issue.detail}</div>
                </td>
                <td className="px-3 py-2">
                  <div>{issue.operation_reference || "-"}</div>
                  <div className="text-xs text-slate-500">{issue.document_number || issue.source_type || "-"}</div>
                </td>
                <td className="px-3 py-2">{issue.party_name || "-"}</td>
                <td className="px-3 py-2 text-right">{money(issue.amount, issue.currency_code)}</td>
                <td className="px-3 py-2">{dateText(issue.expected_date)}</td>
                <td className="px-3 py-2 text-slate-700">{issue.action || "Revisar dato origen."}</td>
              </tr>
            ))}
            {!issues.length ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">Sin observaciones para este rango.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function addMoneyBucket(target, currency, key, value) {
  const cur = currencyName(currency);
  if (!target[cur]) {
    target[cur] = {
      incoming_actual: 0,
      incoming_projected: 0,
      outgoing_actual: 0,
      outgoing_projected: 0,
      net_actual: 0,
      net_projected: 0,
    };
  }
  target[cur][key] += Number(value || 0);
}

function OperationFlowTable({ rows }) {
  const grouped = useMemo(() => {
    const map = new Map();
    (rows || [])
      .filter((doc) => String(doc.operation_reference || "").trim())
      .forEach((doc) => {
        const ref = String(doc.operation_reference || "").trim();
        const key = `${ref}__${currencyName(doc.currency_code)}`;
        if (!map.has(key)) {
          map.set(key, {
            key,
            operation_reference: ref,
            party_name: doc.party_name || "",
            currency_code: currencyName(doc.currency_code),
            documents_count: 0,
            totals: {
              incoming_actual: 0,
              incoming_projected: 0,
              outgoing_actual: 0,
              outgoing_projected: 0,
            },
          });
        }
        const item = map.get(key);
        if (!item.party_name && doc.party_name) item.party_name = doc.party_name;
        item.documents_count += 1;
        const amount = Number(doc.amount || 0) || 0;
        if (doc.direction === "in" && doc.kind === "actual") item.totals.incoming_actual += amount;
        if (doc.direction === "in" && doc.kind !== "actual") item.totals.incoming_projected += amount;
        if (doc.direction === "out" && doc.kind === "actual") item.totals.outgoing_actual += amount;
        if (doc.direction === "out" && doc.kind !== "actual") item.totals.outgoing_projected += amount;
      });

    return Array.from(map.values()).map((item) => {
      const incomingTotal = item.totals.incoming_actual + item.totals.incoming_projected;
      const outgoingTotal = item.totals.outgoing_actual + item.totals.outgoing_projected;
      return {
        ...item,
        incoming_total: incomingTotal,
        outgoing_total: outgoingTotal,
        net_actual: item.totals.incoming_actual - item.totals.outgoing_actual,
        net_projected: incomingTotal - outgoingTotal,
      };
    }).sort((a, b) => Math.abs(b.net_projected) - Math.abs(a.net_projected));
  }, [rows]);

  const summary = useMemo(() => {
    const out = {};
    grouped.forEach((row) => {
      addMoneyBucket(out, row.currency_code, "incoming_actual", row.totals.incoming_actual);
      addMoneyBucket(out, row.currency_code, "incoming_projected", row.totals.incoming_projected);
      addMoneyBucket(out, row.currency_code, "outgoing_actual", row.totals.outgoing_actual);
      addMoneyBucket(out, row.currency_code, "outgoing_projected", row.totals.outgoing_projected);
    });
    Object.values(out).forEach((bucket) => {
      bucket.net_actual = bucket.incoming_actual - bucket.outgoing_actual;
      bucket.net_projected =
        bucket.incoming_actual +
        bucket.incoming_projected -
        bucket.outgoing_actual -
        bucket.outgoing_projected;
    });
    return out;
  }, [grouped]);

  const maxTotal = Math.max(1, ...grouped.map((row) => Math.max(row.incoming_total, row.outgoing_total)));

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Object.entries(summary).map(([cur, vals]) => (
          <div key={cur} className="rounded-lg border bg-white p-4">
            <div className="text-xs font-medium text-slate-500">{cur}</div>
            <div className="mt-2 grid gap-1 text-sm">
              <div className="flex justify-between"><span>Cobrado</span><span className="font-medium text-emerald-700">{money(vals.incoming_actual, cur)}</span></div>
              <div className="flex justify-between"><span>Por cobrar</span><span className="font-medium text-emerald-700">{money(vals.incoming_projected, cur)}</span></div>
              <div className="flex justify-between"><span>Pagado</span><span className="font-medium text-red-700">{money(vals.outgoing_actual, cur)}</span></div>
              <div className="flex justify-between"><span>Por pagar</span><span className="font-medium text-red-700">{money(vals.outgoing_projected, cur)}</span></div>
              <div className="mt-2 flex justify-between border-t pt-2"><span>Neto proyectado</span><span className={`font-semibold ${vals.net_projected >= 0 ? "text-slate-900" : "text-red-700"}`}>{money(vals.net_projected, cur)}</span></div>
            </div>
          </div>
        ))}
        {!Object.keys(summary).length ? (
          <div className="rounded-lg border bg-white p-4 text-sm text-slate-500">Sin operaciones con movimientos en el rango.</div>
        ) : null}
      </div>

      <div className="overflow-auto rounded-lg border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">Operacion</th>
              <th className="px-3 py-2 text-left">Cliente/Proveedor</th>
              <th className="px-3 py-2 text-left">Grafico</th>
              <th className="px-3 py-2 text-right">Cobrado</th>
              <th className="px-3 py-2 text-right">Por cobrar</th>
              <th className="px-3 py-2 text-right">Pagado</th>
              <th className="px-3 py-2 text-right">Por pagar</th>
              <th className="px-3 py-2 text-right">Neto actual</th>
              <th className="px-3 py-2 text-right">Neto proyectado</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map((row) => {
              const inPct = Math.max(3, Math.round((row.incoming_total / maxTotal) * 100));
              const outPct = Math.max(3, Math.round((row.outgoing_total / maxTotal) * 100));
              return (
                <tr key={row.key} className="border-t">
                  <td className="px-3 py-2">
                    <div className="font-medium">{row.operation_reference}</div>
                    <div className="text-[11px] text-slate-500">{row.documents_count} docs - {row.currency_code}</div>
                  </td>
                  <td className="px-3 py-2">{row.party_name || "-"}</td>
                  <td className="px-3 py-2 min-w-[220px]">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="w-10 text-[11px] text-emerald-700">Entra</span>
                        <div className="h-2 rounded bg-emerald-500" style={{ width: `${inPct}%` }} />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-10 text-[11px] text-red-700">Sale</span>
                        <div className="h-2 rounded bg-red-500" style={{ width: `${outPct}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">{money(row.totals.incoming_actual, row.currency_code)}</td>
                  <td className="px-3 py-2 text-right">{money(row.totals.incoming_projected, row.currency_code)}</td>
                  <td className="px-3 py-2 text-right">{money(row.totals.outgoing_actual, row.currency_code)}</td>
                  <td className="px-3 py-2 text-right">{money(row.totals.outgoing_projected, row.currency_code)}</td>
                  <td className={`px-3 py-2 text-right font-medium ${row.net_actual >= 0 ? "text-slate-900" : "text-red-700"}`}>{money(row.net_actual, row.currency_code)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${row.net_projected >= 0 ? "text-slate-900" : "text-red-700"}`}>{money(row.net_projected, row.currency_code)}</td>
                </tr>
              );
            })}
            {!grouped.length ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-500">Sin operaciones con ingresos o egresos para mostrar.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SalesYearMatrix({ months, year, onSelectMonth, onOpenMonthly, onEditGoals, canConfigure }) {
  const selectedYear = String(year || today.getFullYear());
  const monthKey = (idx) => `${selectedYear}-${String(idx + 1).padStart(2, "0")}`;
  const currencies = Array.from(new Set((months || []).map((row) => currencyName(row.currency_code)))).sort();
  const visibleCurrencies = currencies.length ? currencies : ["USD"];
  const rowDefs = [
    { key: "budget_purchase", label: "COMPRA" },
    { key: "budget_sale", label: "VENTA" },
    { key: "budget_profit", label: "PROFIT BRUTO", tone: "profit" },
    { key: "meta", label: "METAS", tone: "meta" },
    { key: "meta_difference", label: "DIF PROFIT", tone: "diff" },
    { key: "total_sale", label: "TOTAL", tone: "total" },
  ];

  const monthRowsFor = (currency) => MONTH_LABELS.map((_, idx) => (
    (months || []).find((row) => String(row.month) === monthKey(idx) && currencyName(row.currency_code) === currency) || null
  ));

  const valueFor = (row, key) => {
    if (key === "total_sale") return Number(row?.budget_sale || 0);
    return Number(row?.[key] || 0);
  };
  const averageDivisor = (rows, key) => {
    if (key === "meta") return 12;
    const active = rows.filter((row) => (
      Number(row?.budget_purchase || 0)
      || Number(row?.budget_sale || 0)
      || Number(row?.budget_profit || 0)
      || Number(row?.collected || 0)
      || Number(row?.receivable || 0)
    )).length;
    return Math.max(active, 1);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold">Detalle de ventas {selectedYear}</div>
          <div className="text-sm text-slate-500">Resumen anual por mes. TocÃ¡ cualquier mes para abrir el detalle.</div>
        </div>
        {canConfigure ? (
          <button type="button" onClick={onEditGoals} className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50">
            Editar metas
          </button>
        ) : null}
      </div>

      {visibleCurrencies.map((currency) => {
        const monthRows = monthRowsFor(currency);
        return (
          <div key={currency} className="overflow-auto rounded-lg border bg-white">
            <table className="min-w-[1260px] w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th colSpan={15} className="border-b px-2 py-3 text-left text-xl font-bold">
                    DETALLE DE VENTAS {selectedYear} <span className="text-sm font-semibold text-slate-500">({currency})</span>
                  </th>
                </tr>
                <tr className="bg-white">
                  <th className="w-32 border px-2 py-1 text-left">MESES</th>
                  {MONTH_LABELS.map((label, idx) => (
                    <th key={label} className={`border px-2 py-1 text-center ${label === "DIC" ? "bg-yellow-300" : ""}`}>
                      <button
                        type="button"
                        onClick={() => onSelectMonth?.(monthKey(idx))}
                        className="font-semibold underline decoration-slate-300 underline-offset-2 hover:text-blue-700"
                      >
                        {label}
                      </button>
                    </th>
                  ))}
                  <th className="border px-2 py-1 text-center">TOTAL</th>
                  <th className="border px-2 py-1 text-center">PROM.</th>
                </tr>
              </thead>
              <tbody>
                {rowDefs.map((def) => {
                  const total = monthRows.reduce((sum, row) => sum + valueFor(row, def.key), 0);
                  const average = total / averageDivisor(monthRows, def.key);
                  return (
                    <tr key={def.key} className={def.tone === "profit" ? "bg-cyan-100" : def.tone === "total" ? "bg-slate-100" : ""}>
                      <td className={`border px-2 py-1 font-bold ${def.tone === "meta" || def.tone === "diff" ? "text-blue-700" : ""}`}>
                        {def.label}
                      </td>
                      {monthRows.map((row, idx) => {
                        const value = valueFor(row, def.key);
                        const valueClass = def.tone === "diff"
                          ? value < 0 ? "text-red-600" : "text-blue-700"
                          : def.tone === "profit" || def.tone === "meta" ? "text-blue-700" : "text-slate-900";
                        return (
                          <td
                            key={`${def.key}-${idx}`}
                            onClick={() => onSelectMonth?.(monthKey(idx))}
                            className={`cursor-pointer border px-2 py-1 text-right font-semibold hover:bg-blue-50 ${valueClass}`}
                          >
                            {amountText(value, currency)}
                          </td>
                        );
                      })}
                      <td className={`border px-2 py-1 text-right font-bold ${def.tone === "diff" && total < 0 ? "text-red-600" : "text-slate-900"}`}>
                        {amountText(total, currency)}
                      </td>
                      <td className={`border px-2 py-1 text-right font-bold ${def.tone === "diff" && average < 0 ? "text-red-600" : "text-blue-700"}`}>
                        {amountText(average, currency)}
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td className="border px-2 py-2">
                    <button
                      type="button"
                      onClick={onOpenMonthly}
                      className="rounded border border-slate-900 bg-white px-3 py-1 text-xs font-bold hover:bg-slate-100"
                    >
                      MENSUAL
                    </button>
                  </td>
                  {MONTH_LABELS.map((label) => (
                    <td key={label} className="border px-2 py-2 text-center">&nbsp;</td>
                  ))}
                  <td className="border px-2 py-2">&nbsp;</td>
                  <td className="border px-2 py-2">&nbsp;</td>
                </tr>
                <tr>
                  <td className="border px-2 py-3">&nbsp;</td>
                  {MONTH_LABELS.map((label) => <td key={label} className="border px-2 py-3">&nbsp;</td>)}
                  <td className="border px-2 py-3">&nbsp;</td>
                  <td className="border px-2 py-3">&nbsp;</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function MonthlySalesModal({ open, year, operations, onClose, onSelectMonth }) {
  if (!open) return null;
  const selectedYear = String(year || today.getFullYear());
  const monthKey = (idx) => `${selectedYear}-${String(idx + 1).padStart(2, "0")}`;
  const currencyGroup = (currency) => {
    const code = currencyName(currency);
    if (code === "USD") return "USD";
    if (["PYG", "GS", "GRS"].includes(code)) return "GRS";
    return code;
  };
  const monthRows = (month) => (operations || []).filter((row) => String(row.month) === month);
  const cellValue = (row, field, group) => currencyGroup(row.currency_code) === group ? Number(row?.[field] || 0) : 0;
  const sectionTotals = (rows) => rows.reduce((acc, row) => {
    const group = currencyGroup(row.currency_code);
    if (!acc[group]) acc[group] = { budget_purchase: 0, budget_sale: 0, budget_profit: 0 };
    acc[group].budget_purchase += Number(row.budget_purchase || 0);
    acc[group].budget_sale += Number(row.budget_sale || 0);
    acc[group].budget_profit += Number(row.budget_profit || 0);
    return acc;
  }, {});
  const monthName = (idx) => new Date(Number(selectedYear), idx, 1).toLocaleDateString("es-PY", { month: "long" }).toUpperCase();

  return (
    <div className="fixed inset-0 z-[88] bg-black/35 p-3 md:p-6">
      <div className="mx-auto flex h-full max-w-[1600px] flex-col rounded-lg bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div>
            <div className="text-xl font-bold">Detalle mensual de ventas {selectedYear}</div>
            <div className="text-sm text-slate-500">Vista tipo planilla con todas las operaciones separadas por mes.</div>
          </div>
          <button type="button" onClick={onClose} className="rounded border px-3 py-2 text-sm hover:bg-slate-50">Cerrar</button>
        </div>
        <div className="overflow-auto p-5">
          <div className="space-y-10">
            {MONTH_LABELS.map((label, idx) => {
              const key = monthKey(idx);
              const rows = monthRows(key);
              const totals = sectionTotals(rows);
              const usd = totals.USD || { budget_purchase: 0, budget_sale: 0, budget_profit: 0 };
              const grs = totals.GRS || { budget_purchase: 0, budget_sale: 0, budget_profit: 0 };
              return (
                <section key={key} className="min-w-[1320px]">
                  <div className="mb-3 flex items-end gap-4">
                    <button
                      type="button"
                      onClick={() => onSelectMonth?.(key)}
                      className="text-2xl font-bold uppercase underline decoration-slate-900 underline-offset-4 hover:text-blue-700"
                    >
                      {monthName(idx)}
                    </button>
                    <span className="text-xs text-slate-500">{rows.length} operacion(es)</span>
                  </div>
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className="border border-slate-900 px-2 py-1" rowSpan={2}>NÂ°</th>
                        <th className="border border-slate-900 px-2 py-1" rowSpan={2}>REF NÂ°</th>
                        <th className="border border-slate-900 px-2 py-1" rowSpan={2}>CLIENTE</th>
                        <th className="border border-slate-900 px-2 py-1" rowSpan={2}>ORIG</th>
                        <th className="border border-slate-900 px-2 py-1" rowSpan={2}>DEST</th>
                        <th className="border border-slate-900 px-2 py-1" rowSpan={2}>PROV</th>
                        <th className="border border-slate-900 px-2 py-1" rowSpan={2}>DESCRIPCION</th>
                        <th className="border border-slate-900 px-2 py-1 text-center" colSpan={3}>USD</th>
                        <th className="border border-slate-900 px-2 py-1 text-center" colSpan={3}>GRS</th>
                      </tr>
                      <tr>
                        <th className="border border-slate-900 px-2 py-1 text-center">COSTO</th>
                        <th className="border border-slate-900 px-2 py-1 text-center">VENTA</th>
                        <th className="border border-slate-900 px-2 py-1 text-center">PROFIT</th>
                        <th className="border border-slate-900 px-2 py-1 text-center">COSTO</th>
                        <th className="border border-slate-900 px-2 py-1 text-center">VENTA</th>
                        <th className="border border-slate-900 px-2 py-1 text-center">PROFIT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, rowIdx) => (
                        <tr key={row.key || `${key}-${rowIdx}`}>
                          <td className="border border-slate-900 px-2 py-1 text-center">{rowIdx + 1}</td>
                          <td className="border border-slate-900 px-2 py-1 font-bold">{row.operation_reference || "-"}</td>
                          <td className="border border-slate-900 px-2 py-1 font-semibold">{row.client_name || "-"}</td>
                          <td className="border border-slate-900 px-2 py-1 text-center font-semibold">{row.origin || "-"}</td>
                          <td className="border border-slate-900 px-2 py-1 text-center font-semibold">{row.destination || "-"}</td>
                          <td className="border border-slate-900 px-2 py-1 font-semibold">{row.provider_brand || "-"}</td>
                          <td className="border border-slate-900 px-2 py-1 font-semibold">{row.description || "-"}</td>
                          <td className="border border-slate-900 px-2 py-1 text-right">{amountText(cellValue(row, "budget_purchase", "USD"), "USD")}</td>
                          <td className="border border-slate-900 px-2 py-1 text-right font-semibold">{amountText(cellValue(row, "budget_sale", "USD"), "USD")}</td>
                          <td className="border border-slate-900 px-2 py-1 text-right font-semibold">{amountText(cellValue(row, "budget_profit", "USD"), "USD")}</td>
                          <td className="border border-slate-900 px-2 py-1 text-right">{amountText(cellValue(row, "budget_purchase", "GRS"), "PYG")}</td>
                          <td className="border border-slate-900 px-2 py-1 text-right font-semibold">{amountText(cellValue(row, "budget_sale", "GRS"), "PYG")}</td>
                          <td className="border border-slate-900 px-2 py-1 text-right font-semibold">{amountText(cellValue(row, "budget_profit", "GRS"), "PYG")}</td>
                        </tr>
                      ))}
                      {!rows.length ? (
                        <tr>
                          <td className="border border-slate-900 px-2 py-6 text-center text-slate-500" colSpan={13}>Sin operaciones para este mes.</td>
                        </tr>
                      ) : null}
                      <tr>
                        <td className="border border-slate-900 px-2 py-2" colSpan={7}></td>
                        <td className="border border-slate-900 px-2 py-2 text-right font-bold">{amountText(usd.budget_purchase, "USD")}</td>
                        <td className="border border-slate-900 px-2 py-2 text-right font-bold">{amountText(usd.budget_sale, "USD")}</td>
                        <td className="border border-slate-900 px-2 py-2 text-right font-bold">{amountText(usd.budget_profit, "USD")}</td>
                        <td className="border border-slate-900 px-2 py-2 text-right font-bold">{amountText(grs.budget_purchase, "PYG")}</td>
                        <td className="border border-slate-900 px-2 py-2 text-right font-bold">{amountText(grs.budget_sale, "PYG")}</td>
                        <td className="border border-slate-900 px-2 py-2 text-right font-bold">{amountText(grs.budget_profit, "PYG")}</td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="mt-6 grid max-w-[520px] grid-cols-[160px_1fr_1fr] text-sm font-bold">
                    <div className="px-2 py-1 text-blue-700">COTIZ. AL CIERRE DE MES</div>
                    <div></div>
                    <div></div>
                    <div className="bg-yellow-300 px-2 py-1">TOTAL USD</div>
                    <div className="bg-yellow-300 px-2 py-1 text-right">{amountText(usd.budget_sale, "USD")}</div>
                    <div className="px-2 py-1 text-right">{amountText(usd.budget_profit, "USD")}</div>
                    <div className="bg-yellow-300 px-2 py-1">TOTAL GS</div>
                    <div className="bg-yellow-300 px-2 py-1 text-right">{amountText(grs.budget_sale, "PYG")}</div>
                    <div className="px-2 py-1 text-right">{amountText(grs.budget_profit, "PYG")}</div>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
function SalesMonthTable({ months, operations, onSelectMonth, onEditGoals, canConfigure }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold">Ventas, caja y profit por mes</div>
          <div className="text-sm text-slate-500">Vista mensual tipo planilla, proporcional a facturas/cobros parciales.</div>
        </div>
        {canConfigure ? (
          <button type="button" onClick={onEditGoals} className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50">
            Editar metas
          </button>
        ) : null}
      </div>
      <div className="overflow-auto rounded-lg border bg-white">
        <table className="min-w-[1320px] w-full text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="px-3 py-2 text-left">Mes</th>
              <th className="px-3 py-2 text-left">Moneda</th>
              <th className="px-3 py-2 text-right">Compra pres.</th>
              <th className="px-3 py-2 text-right">Venta</th>
              <th className="px-3 py-2 text-right">Profit pres.</th>
              <th className="px-3 py-2 text-right">Profit real</th>
              <th className="px-3 py-2 text-right">Cobrado</th>
              <th className="px-3 py-2 text-right">Por cobrar</th>
              <th className="px-3 py-2 text-right">Pagado</th>
              <th className="px-3 py-2 text-right">Por pagar</th>
              <th className="px-3 py-2 text-right">Meta</th>
              <th className="px-3 py-2 text-right">Dif. meta</th>
              <th className="px-3 py-2 text-center">Ops</th>
            </tr>
          </thead>
          <tbody>
            {(months || []).map((row) => {
              const diffClass = Number(row.meta_difference || 0) >= 0 ? "text-emerald-700" : "text-red-700";
              return (
                <tr
                  key={`${row.month}-${row.currency_code}`}
                  className="cursor-pointer border-t hover:bg-slate-50"
                  onClick={() => onSelectMonth(row.month)}
                >
                  <td className="px-3 py-2 font-medium capitalize">{monthText(row.month)}</td>
                  <td className="px-3 py-2">{row.currency_code}</td>
                  <td className="px-3 py-2 text-right">{money(row.budget_purchase, row.currency_code)}</td>
                  <td className="px-3 py-2 text-right">{money(row.budget_sale, row.currency_code)}</td>
                  <td className="px-3 py-2 text-right font-medium">{money(row.budget_profit, row.currency_code)}</td>
                  <td className="px-3 py-2 text-right">{row.real_profit ? money(row.real_profit, row.currency_code) : <span className="text-slate-400">Sin real</span>}</td>
                  <td className="px-3 py-2 text-right text-emerald-700">{money(row.collected, row.currency_code)}</td>
                  <td className="px-3 py-2 text-right text-emerald-700">{money(row.receivable, row.currency_code)}</td>
                  <td className="px-3 py-2 text-right text-red-700">{money(row.paid, row.currency_code)}</td>
                  <td className="px-3 py-2 text-right text-red-700">{money(row.payable, row.currency_code)}</td>
                  <td className="px-3 py-2 text-right">{money(row.meta, row.currency_code)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${diffClass}`}>{money(row.meta_difference, row.currency_code)}</td>
                  <td className="px-3 py-2 text-center">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{row.operations_count || 0}</span>
                    {row.warnings_count ? <span className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">{row.warnings_count} obs.</span> : null}
                  </td>
                </tr>
              );
            })}
            {!months?.length ? (
              <tr>
                <td colSpan={13} className="px-3 py-6 text-center text-slate-500">Sin ventas/caja proyectada en el rango.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="rounded-lg border bg-white p-3 text-xs text-slate-500">
        El profit se distribuye proporcionalmente al monto facturado/cobrado del mes para no duplicar operaciones con 60/30/10.
      </div>
    </div>
  );
}

function SalesMonthDrawer({ month, operations, onClose }) {
  const rows = (operations || []).filter((row) => row.month === month);
  const totals = rows.reduce((acc, row) => {
    const cur = currencyName(row.currency_code);
    acc[cur] = acc[cur] || { sale: 0, profit: 0, real: 0, receivable: 0, collected: 0, paid: 0, payable: 0 };
    acc[cur].sale += Number(row.budget_sale || 0);
    acc[cur].profit += Number(row.budget_profit || 0);
    acc[cur].real += Number(row.real_profit || 0);
    acc[cur].receivable += Number(row.receivable || 0);
    acc[cur].collected += Number(row.collected || 0);
    acc[cur].paid += Number(row.paid || 0);
    acc[cur].payable += Number(row.payable || 0);
    return acc;
  }, {});

  if (!month) return null;
  return (
    <div className="fixed inset-0 z-[85] bg-black/30">
      <div className="ml-auto flex h-full w-full max-w-6xl flex-col bg-white shadow-xl">
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div>
            <div className="text-xl font-semibold capitalize">{monthText(month)}</div>
            <div className="text-sm text-slate-500">Detalle mensual de operaciones, documentos y profit.</div>
          </div>
          <button type="button" onClick={onClose} className="rounded border px-3 py-2 text-sm">Cerrar</button>
        </div>
        <div className="space-y-4 overflow-auto p-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {Object.entries(totals).map(([cur, total]) => (
              <div key={cur} className="rounded-lg border p-3 text-sm">
                <div className="font-semibold">{cur}</div>
                <div className="mt-2 grid gap-1">
                  <div className="flex justify-between"><span>Venta</span><b>{money(total.sale, cur)}</b></div>
                  <div className="flex justify-between"><span>Profit pres.</span><b>{money(total.profit, cur)}</b></div>
                  <div className="flex justify-between"><span>Profit real</span><b>{money(total.real, cur)}</b></div>
                  <div className="flex justify-between"><span>Cobrado/Por cobrar</span><b>{money(total.collected + total.receivable, cur)}</b></div>
                  <div className="flex justify-between"><span>Pagado/Por pagar</span><b>{money(total.paid + total.payable, cur)}</b></div>
                </div>
              </div>
            ))}
          </div>
          <div className="overflow-auto rounded-lg border">
            <table className="min-w-[1120px] w-full text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-3 py-2 text-left">REF</th>
                  <th className="px-3 py-2 text-left">Cliente</th>
                  <th className="px-3 py-2 text-left">Prov/Marca</th>
                  <th className="px-3 py-2 text-left">Descripcion</th>
                  <th className="px-3 py-2 text-right">Compra</th>
                  <th className="px-3 py-2 text-right">Venta</th>
                  <th className="px-3 py-2 text-right">Profit pres.</th>
                  <th className="px-3 py-2 text-right">Profit real</th>
                  <th className="px-3 py-2 text-left">Alertas</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-t">
                    <td className="px-3 py-2 font-medium">{row.operation_reference}</td>
                    <td className="px-3 py-2">{row.client_name || "-"}</td>
                    <td className="px-3 py-2">{row.provider_brand || "-"}</td>
                    <td className="px-3 py-2">{row.description || "-"}</td>
                    <td className="px-3 py-2 text-right">{money(row.budget_purchase, row.currency_code)}</td>
                    <td className="px-3 py-2 text-right">{money(row.budget_sale, row.currency_code)}</td>
                    <td className="px-3 py-2 text-right">{money(row.budget_profit, row.currency_code)}</td>
                    <td className="px-3 py-2 text-right">{row.real_profit != null ? money(row.real_profit, row.currency_code) : <span className="text-slate-400">Sin costo real</span>}</td>
                    <td className="px-3 py-2">
                      {row.warnings?.length ? row.warnings.map((w) => <span key={w} className="mr-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">{w}</span>) : "-"}
                    </td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-500">Sin operaciones para este mes.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {rows.map((row) => (
              <div key={`${row.key}-docs`} className="rounded-lg border p-3">
                <div className="font-medium">{row.operation_reference}</div>
                <div className="mt-2 space-y-1 text-sm">
                  {(row.documents || []).map((doc, idx) => (
                    <div key={`${doc.source_type}-${doc.source_id}-${idx}`} className="flex justify-between gap-3 border-t py-1 first:border-t-0">
                      <span>{doc.label} <span className="text-xs text-slate-500">({doc.kind === "actual" ? "real" : "proy."})</span></span>
                      <span className={doc.direction === "in" ? "text-emerald-700" : "text-red-700"}>{money(doc.amount, doc.currency_code)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MonthlyGoalsModal({ open, year, currency, goals, onClose, onSave }) {
  const months = Array.from({ length: 12 }, (_, idx) => idx + 1);
  const [values, setValues] = useState({});

  useEffect(() => {
    if (!open) return;
    const next = {};
    months.forEach((m) => {
      const key = String(m).padStart(2, "0");
      next[key] = goals?.[key] ?? goals?.[String(m)] ?? "";
    });
    setValues(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, goals, year, currency]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl rounded-lg border bg-white shadow-xl">
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div>
            <div className="text-lg font-semibold">Metas mensuales {year} - {currency}</div>
            <div className="text-sm text-slate-500">Estas metas se comparan contra el profit presupuestado mensual.</div>
          </div>
          <button type="button" onClick={onClose} className="text-sm underline">Cerrar</button>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2 md:grid-cols-3">
          {months.map((m) => {
            const key = String(m).padStart(2, "0");
            return (
              <label key={key} className="text-sm">
                <span className="mb-1 block capitalize text-slate-600">{monthText(`${year}-${key}`)}</span>
                <input
                  type="number"
                  step="0.01"
                  value={values[key] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
                  className="w-full rounded-lg border px-3 py-2 text-right"
                />
              </label>
            );
          })}
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          <button
            type="button"
            onClick={() => onSave(values)}
            className="rounded-lg bg-black px-4 py-2 text-sm text-white"
          >
            Guardar metas
          </button>
        </div>
      </div>
    </div>
  );
}

function CalendarView({ days, selectedDay, calendarMonth, onSelectDay, onMonthChange }) {
  const dayMap = new Map((days || []).map((day) => [day.date, day]));
  const base = calendarMonth ? new Date(`${calendarMonth}-01T00:00:00`) : selectedDay ? new Date(`${selectedDay}T00:00:00`) : today;
  const first = startOfMonth(base);
  const last = endOfMonth(base);
  const cells = [];
  const startOffset = first.getDay();
  for (let i = 0; i < startOffset; i += 1) cells.push(null);
  for (let d = 1; d <= last.getDate(); d += 1) {
    cells.push(toYMD(new Date(first.getFullYear(), first.getMonth(), d)));
  }
  const monthLabel = base.toLocaleDateString("es-PY", { month: "long", year: "numeric" });
  const moveMonth = (delta) => {
    const next = addMonths(first, delta);
    onMonthChange?.(toYMD(next).slice(0, 7));
  };
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold">Calendario proyectado</div>
          <div className="text-sm capitalize text-slate-500">{monthLabel}</div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => moveMonth(-1)} className="rounded border px-2 py-1 text-sm">Anterior</button>
          <button
            type="button"
            onClick={() => {
              onMonthChange?.(toYMD(today).slice(0, 7));
              onSelectDay?.(toYMD(today));
            }}
            className="rounded border px-2 py-1 text-sm"
          >
            Hoy
          </button>
          <button type="button" onClick={() => moveMonth(1)} className="rounded border px-2 py-1 text-sm">Siguiente</button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-2 text-xs text-slate-500">
        {["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"].map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-2">
        {cells.map((day, idx) => {
          const info = day ? dayMap.get(day) : null;
          const docs = info?.documents || [];
          const projectedCount = docs.filter((doc) => doc.kind === "projected").length;
          const actualCount = docs.filter((doc) => doc.kind === "actual").length;
          return (
            <button
              key={day || `empty-${idx}`}
              type="button"
              disabled={!day}
              onClick={() => onSelectDay(day)}
              className={`min-h-[122px] rounded-lg border p-2 text-left ${selectedDay === day ? "border-black bg-slate-50" : "bg-white hover:bg-slate-50"} disabled:border-transparent disabled:bg-transparent`}
            >
              {day ? (
                <div className="flex items-start justify-between gap-1">
                  <div className="font-medium">{Number(day.slice(8, 10))}</div>
                  {projectedCount || actualCount ? (
                    <div className="flex flex-wrap justify-end gap-1">
                      {projectedCount ? <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">{projectedCount} proy.</span> : null}
                      {actualCount ? <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">{actualCount} real</span> : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {info ? Object.entries(info.by_currency || {}).map(([currency, val]) => (
                <div key={currency} className="mt-1 text-[11px] leading-tight">
                  <div className="text-emerald-700">+ {money(val.incoming, currency)}</div>
                  <div className="text-red-700">- {money(val.outgoing, currency)}</div>
                  <div className={val.net >= 0 ? "text-slate-700" : "text-red-700"}>= {money(val.net, currency)}</div>
                </div>
              )) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function AdminFinance() {
  const { user } = useAuth();
  const role = String(user?.role || "").toLowerCase();
  const canView = role === "admin" || role === "finanzas";
  const canConfigure = role === "admin";
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(toYMD(startOfMonth(today)));
  const [to, setTo] = useState(toYMD(endOfMonth(addMonths(today, 2))));
  const [bus, setBus] = useState([]);
  const [buId, setBuId] = useState("");
  const [currency, setCurrency] = useState("");
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("flow");
  const [docFilter, setDocFilter] = useState("all");
  const [selectedDay, setSelectedDay] = useState(toYMD(today));
  const [calendarMonth, setCalendarMonth] = useState(toYMD(today).slice(0, 7));
  const [selectedSalesMonth, setSelectedSalesMonth] = useState("");
  const [monthlySalesOpen, setMonthlySalesOpen] = useState(false);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [goalCurrency, setGoalCurrency] = useState("USD");
  const [adjustRow, setAdjustRow] = useState(null);
  const [saving, setSaving] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [error, setError] = useState("");

  async function load(overrides = {}) {
    if (!canView) return;
    setLoading(true);
    setError("");
    try {
      const params = {};
      const nextFrom = overrides.from ?? from;
      const nextTo = overrides.to ?? to;
      const nextBuId = overrides.business_unit_id ?? buId;
      const nextCurrency = overrides.currency_code ?? currency;
      if (nextFrom) params.from = nextFrom;
      if (nextTo) params.to = nextTo;
      if (nextBuId) params.business_unit_id = nextBuId;
      if (nextCurrency) params.currency_code = nextCurrency;
      const { data: res } = await api.get("/admin/finance/cash-flow", { params });
      setData(res);
      setSettingsDraft(res?.settings || { rule_enabled: true, collection_rule: [] });
      const firstCurrency = res?.sales_months?.[0]?.currency_code || nextCurrency || "USD";
      setGoalCurrency((prev) => prev || firstCurrency);
    } catch (e) {
      setError(e?.response?.data?.error || "No se pudo cargar Gerencia.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!canView) return;
    api.get("/business-units").then((r) => setBus(r.data || [])).catch(() => {});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyPreset(kind) {
    const now = new Date();
    let nextFrom = from;
    let nextTo = to;
    if (kind === "m1") {
      nextFrom = toYMD(startOfMonth(now));
      nextTo = toYMD(endOfMonth(now));
    } else if (kind === "m3") {
      nextFrom = toYMD(startOfMonth(addMonths(now, -2)));
      nextTo = toYMD(endOfMonth(now));
    } else if (kind === "next3") {
      nextFrom = toYMD(startOfMonth(now));
      nextTo = toYMD(endOfMonth(addMonths(now, 2)));
    } else if (kind === "ytd") {
      nextFrom = toYMD(new Date(now.getFullYear(), 0, 1));
      nextTo = toYMD(endOfMonth(now));
    }
    setFrom(nextFrom);
    setTo(nextTo);
    load({ from: nextFrom, to: nextTo });
  }

  const summary = data?.summary_by_currency || {};
  const summaryTotals = useMemo(() => {
    const out = {
      collected_real: {},
      receivable_projected: {},
      paid_real: {},
      payable_projected: {},
      net_expected: {},
    };
    Object.entries(summary).forEach(([currencyCode, vals]) => {
      Object.keys(out).forEach((key) => {
        out[key][currencyCode] = vals?.[key] || 0;
      });
    });
    return out;
  }, [summary]);

  const allDocuments = useMemo(() => [
    ...(data?.incoming_documents || []),
    ...(data?.outgoing_documents || []),
  ].sort((a, b) => String(a.expected_date || a.actual_date || "").localeCompare(String(b.expected_date || b.actual_date || ""))), [data]);

  const filteredDocuments = useMemo(() => {
    if (docFilter === "incoming") return allDocuments.filter((d) => d.direction === "in");
    if (docFilter === "outgoing") return allDocuments.filter((d) => d.direction === "out");
    if (docFilter === "unplanned") return allDocuments.filter((d) => d.kind === "projected" && !d.expected_date);
    if (docFilter === "overdue") return allDocuments.filter((d) => d.schedule_status === "vencido");
    return allDocuments;
  }, [allDocuments, docFilter]);

  const selectedDayDocs = useMemo(() => {
    const day = (data?.calendar_days || []).find((item) => item.date === selectedDay);
    return day?.documents || [];
  }, [data, selectedDay]);

  async function saveAdjustment(row, payload) {
    setSaving(true);
    try {
      await api.patch("/admin/finance/cash-flow/adjustment", {
        source_type: row.source_type,
        source_id: row.source_id,
        direction: row.direction,
        expected_date: payload.expected_date,
        expected_amount: payload.expected_amount,
        currency_code: row.currency_code,
        note: payload.note,
      });
      setAdjustRow(null);
      await load();
    } catch (e) {
      alert(e?.response?.data?.error || "No se pudo guardar el ajuste.");
    } finally {
      setSaving(false);
    }
  }

  async function clearAdjustment(row) {
    if (!window.confirm("Quitar el ajuste manual de este documento?")) return;
    setSaving(true);
    try {
      await api.delete("/admin/finance/cash-flow/adjustment", {
        params: { source_type: row.source_type, source_id: row.source_id, direction: row.direction },
      });
      setAdjustRow(null);
      await load();
    } catch (e) {
      alert(e?.response?.data?.error || "No se pudo quitar el ajuste.");
    } finally {
      setSaving(false);
    }
  }

  async function saveSettings() {
    if (!settingsDraft) return;
    setSaving(true);
    try {
      await api.patch("/admin/finance/cash-flow/settings", settingsDraft);
      await load();
      alert("Configuracion guardada.");
    } catch (e) {
      alert(e?.response?.data?.error || "No se pudo guardar configuracion.");
    } finally {
      setSaving(false);
    }
  }

  async function saveMonthlyGoals(values) {
    const year = Number(String(from || toYMD(today)).slice(0, 4));
    const goals = Object.entries(values || {}).map(([month, amount]) => ({
      month: Number(month),
      amount: Number(amount || 0),
    }));
    setSaving(true);
    try {
      await api.patch("/admin/finance/cash-flow/monthly-goals", {
        year,
        business_unit_id: buId || null,
        currency_code: goalCurrency,
        goals,
      });
      setGoalsOpen(false);
      await load();
    } catch (e) {
      alert(e?.response?.data?.error || "No se pudieron guardar las metas.");
    } finally {
      setSaving(false);
    }
  }

  function updateRule(index, patch) {
    setSettingsDraft((prev) => ({
      ...(prev || {}),
      collection_rule: (prev?.collection_rule || []).map((rule, idx) => idx === index ? { ...rule, ...patch } : rule),
    }));
  }

  const goalYear = Number(String(from || toYMD(today)).slice(0, 4));
  const goalValues = data?.monthly_goals?.[monthlyGoalKey(goalYear, buId || "", goalCurrency)] ||
    data?.monthly_goals?.[monthlyGoalKey(goalYear, "", goalCurrency)] ||
    {};

  if (!canView) {
    return (
      <div className="p-4">
        <h2 className="text-lg font-semibold">Gerencia</h2>
        <p className="text-sm text-slate-600">No tenes permisos para ver esta pagina.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-1">
      <div className="rounded-lg border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-slate-500">Gerencia</div>
            <div className="text-2xl font-bold">Flujo de caja proyectado</div>
            <div className="text-sm text-slate-500">Entradas, salidas y saldo esperado por moneda.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className="rounded-lg border px-2 py-2 text-sm" value={buId} onChange={(e) => setBuId(e.target.value)}>
              <option value="">Todas las unidades</option>
              {bus.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select className="rounded-lg border px-2 py-2 text-sm" value={currency} onChange={(e) => {
              setCurrency(e.target.value);
              if (e.target.value) setGoalCurrency(e.target.value);
            }}>
              <option value="">Todas las monedas</option>
              <option value="USD">USD</option>
              <option value="PYG">PYG</option>
            </select>
            <button className="rounded border px-2 py-2 text-xs" onClick={() => applyPreset("m1")} type="button">Mes actual</button>
            <button className="rounded border px-2 py-2 text-xs" onClick={() => applyPreset("next3")} type="button">Prox. 3 meses</button>
            <button className="rounded border px-2 py-2 text-xs" onClick={() => applyPreset("m3")} type="button">Ult. 3 meses</button>
            <input type="date" className="rounded-lg border px-2 py-2 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" className="rounded-lg border px-2 py-2 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
            <button className="rounded-lg bg-black px-3 py-2 text-sm text-white" onClick={load} type="button">Aplicar</button>
          </div>
        </div>
      </div>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {loading ? <div className="text-sm text-slate-600">Cargando...</div> : null}

      {!loading && data ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <SummaryCard title="Cobrado real" values={summaryTotals.collected_real} tone="emerald" />
            <SummaryCard title="Por cobrar proyectado" values={summaryTotals.receivable_projected} tone="emerald" />
            <SummaryCard title="Pagado real" values={summaryTotals.paid_real} tone="red" />
            <SummaryCard title="Por pagar proyectado" values={summaryTotals.payable_projected} tone="red" />
            <SummaryCard title="Neto esperado" values={summaryTotals.net_expected} />
          </div>

          <div className="flex flex-wrap gap-2">
            <TabButton active={tab === "flow"} onClick={() => setTab("flow")}>Flujo de caja</TabButton>
            <TabButton active={tab === "operations"} onClick={() => setTab("operations")}>Por operacion</TabButton>
            <TabButton active={tab === "calendar"} onClick={() => setTab("calendar")}>Calendario mensual</TabButton>
            <TabButton active={tab === "documents"} onClick={() => setTab("documents")}>Documentos</TabButton>
            <TabButton active={tab === "diagnostics"} onClick={() => setTab("diagnostics")}>Diagnostico</TabButton>
            <TabButton active={tab === "settings"} onClick={() => setTab("settings")}>Configuracion</TabButton>
          </div>

          {tab === "flow" ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-3">
                <span className="text-sm text-slate-600">Moneda para metas:</span>
                <select value={goalCurrency} onChange={(e) => setGoalCurrency(e.target.value)} className="rounded-lg border px-2 py-1 text-sm">
                  <option value="USD">USD</option>
                  <option value="PYG">PYG</option>
                </select>
                <span className="text-xs text-slate-500">Las metas se guardan por aÃ±o, moneda y unidad filtrada.</span>
              </div>
              <SalesYearMatrix
                months={data.sales_months || []}
                year={goalYear}
                onSelectMonth={setSelectedSalesMonth}
                onOpenMonthly={() => setMonthlySalesOpen(true)}
                onEditGoals={() => setGoalsOpen(true)}
                canConfigure={canConfigure}
              />
              <div>
                <div className="mb-2 font-semibold">Documentos recientes del rango</div>
                <DocumentsTable rows={filteredDocuments.slice(0, 12)} onAdjust={setAdjustRow} />
              </div>
            </div>
          ) : null}

          {tab === "operations" ? (
            <OperationFlowTable rows={allDocuments} />
          ) : null}

          {tab === "calendar" ? (
            <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
              <CalendarView
                days={data.calendar_days || []}
                selectedDay={selectedDay}
                calendarMonth={calendarMonth}
                onSelectDay={setSelectedDay}
                onMonthChange={setCalendarMonth}
              />
              <div className="rounded-lg border bg-white p-4">
                <div className="font-semibold">Detalle del dia {dateText(selectedDay)}</div>
                <div className="mt-3 space-y-2">
                  {selectedDayDocs.map((doc, idx) => (
                    <div key={`${doc.source_type}-${doc.source_id}-${idx}`} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium">{doc.label}</div>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${doc.kind === "projected" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-700"}`}>
                          {doc.kind === "projected" ? "Proyectado" : "Real"}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {[doc.operation_reference, doc.party_name].filter(Boolean).join(" - ") || "Sin operacion vinculada"}
                      </div>
                      <div className={doc.direction === "in" ? "text-emerald-700" : "text-red-700"}>
                        {doc.direction === "in" ? "Entrada" : "Salida"} {money(doc.amount, doc.currency_code)}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{doc.status || doc.schedule_status || ""}</div>
                    </div>
                  ))}
                  {!selectedDayDocs.length ? <div className="text-sm text-slate-500">Sin movimientos para este dia.</div> : null}
                </div>
              </div>
            </div>
          ) : null}

          {tab === "documents" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {[
                  ["all", "Todos"],
                  ["incoming", "Entradas"],
                  ["outgoing", "Salidas"],
                  ["overdue", "Vencidos"],
                  ["unplanned", "Sin fecha"],
                ].map(([key, label]) => (
                  <button key={key} type="button" onClick={() => setDocFilter(key)} className={`rounded-lg px-3 py-2 text-sm ${docFilter === key ? "bg-black text-white" : "border bg-white"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <DocumentsTable rows={filteredDocuments} onAdjust={setAdjustRow} />
            </div>
          ) : null}

          {tab === "diagnostics" ? (
            <DiagnosticsPanel diagnostics={data.diagnostics || {}} />
          ) : null}

          {tab === "settings" ? (
            <div className="rounded-lg border bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">Regla global de cobros</div>
                  <div className="text-sm text-slate-500">Se aplica a facturas de credito por porcentaje si no hay ajuste manual.</div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!settingsDraft?.rule_enabled}
                    disabled={!canConfigure}
                    onChange={(e) => setSettingsDraft((prev) => ({ ...(prev || {}), rule_enabled: e.target.checked }))}
                  />
                  Activa
                </label>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {(settingsDraft?.collection_rule || []).map((rule, idx) => (
                  <div key={idx} className="rounded-lg border p-3">
                    <label className="block text-sm">
                      <span className="text-slate-600">Porcentaje</span>
                      <input disabled={!canConfigure} type="number" value={rule.percentage} onChange={(e) => updateRule(idx, { percentage: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" />
                    </label>
                    <label className="mt-2 block text-sm">
                      <span className="text-slate-600">Dias desde emision</span>
                      <input disabled={!canConfigure} type="number" value={rule.days} onChange={(e) => updateRule(idx, { days: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" />
                    </label>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end">
                <button type="button" disabled={!canConfigure || saving} onClick={saveSettings} className="rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-40">
                  Guardar configuracion
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <AdjustmentModal row={adjustRow} onClose={() => setAdjustRow(null)} onSave={saveAdjustment} onClear={clearAdjustment} />
      <MonthlySalesModal
        open={monthlySalesOpen}
        year={goalYear}
        operations={data?.sales_operations || []}
        onClose={() => setMonthlySalesOpen(false)}
        onSelectMonth={(month) => {
          setMonthlySalesOpen(false);
          setSelectedSalesMonth(month);
        }}
      />
      <SalesMonthDrawer
        month={selectedSalesMonth}
        operations={data?.sales_operations || []}
        onClose={() => setSelectedSalesMonth("")}
      />
      <MonthlyGoalsModal
        open={goalsOpen}
        year={goalYear}
        currency={goalCurrency}
        goals={goalValues}
        onClose={() => setGoalsOpen(false)}
        onSave={saveMonthlyGoals}
      />
    </div>
  );
}


