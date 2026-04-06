import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";

const ALERT_FILTERS = [
  { value: "", label: "Todas" },
  { value: "contract", label: "Vigencia contrato" },
  { value: "monthly", label: "Vencimiento mensual" },
  { value: "mora", label: "Mora" },
];

function pill(type) {
  const key = String(type || "").toLowerCase();
  if (key.includes("mora")) return "bg-red-100 text-red-700";
  if (key.includes("contrato")) return "bg-violet-100 text-violet-700";
  if (key.includes("venc")) return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

function alertLabel(type) {
  const key = String(type || "").toLowerCase();
  if (key === "mora_activa") return "Mora activa";
  if (key === "vence_hoy") return "Vence hoy";
  if (key.startsWith("vence_en_")) return `Vence en ${key.replace("vence_en_", "")} dias`;
  if (key === "contrato_vence_hoy") return "Contrato vence hoy";
  if (key === "contrato_vencido") return "Contrato vencido";
  if (key.startsWith("contrato_vence_en_")) return `Contrato vence en ${key.replace("contrato_vence_en_", "")} dias`;
  return type || "-";
}

function alertBucket(type) {
  const key = String(type || "").toLowerCase();
  if (key.includes("mora")) return "mora";
  if (key.includes("contrato")) return "contract";
  return "monthly";
}

function rowTone(type) {
  const bucket = alertBucket(type);
  if (bucket === "mora") return "bg-red-50/40";
  if (bucket === "contract") return "bg-violet-50/40";
  return "";
}

export default function ContainerAlerts() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ query: "", bucket: "" });

  async function loadAlerts() {
    setLoading(true);
    try {
      const { data } = await api.get("/container/alerts");
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("load container global alerts", err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAlerts();
  }, []);

  const filtered = useMemo(() => {
    const q = String(filters.query || "").trim().toLowerCase();
    return rows.filter((row) => {
      if (filters.bucket && alertBucket(row.alert_type) !== filters.bucket) return false;
      if (!q) return true;
      return (
      [
        row.reference,
        row.contract_no,
        row.container_no,
        row.container_type,
        row.message,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
      );
    });
  }, [rows, filters]);

  const summary = useMemo(() => {
    return filtered.reduce(
      (acc, row) => {
        const bucket = alertBucket(row.alert_type);
        acc.total += 1;
        acc[bucket] += 1;
        return acc;
      },
      { total: 0, mora: 0, monthly: 0, contract: 0 }
    );
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-white p-5">
        <div className="font-semibold">Alertas ATM CONTAINER</div>
        <div className="text-sm text-slate-500 mt-1">
          Seguimiento global de vencimientos y mora activa por contrato y contenedor.
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_220px_auto] gap-3 mt-4">
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm"
            placeholder="Buscar por operacion, contrato, contenedor o mensaje"
            value={filters.query}
            onChange={(e) => setFilters((prev) => ({ ...prev, query: e.target.value }))}
          />
          <select
            className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
            value={filters.bucket}
            onChange={(e) => setFilters((prev) => ({ ...prev, bucket: e.target.value }))}
          >
            {ALERT_FILTERS.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button type="button" className="px-4 py-2 rounded-lg border text-sm" onClick={loadAlerts}>
            Actualizar
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <div className="rounded-xl border bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-500">Total</div>
            <div className="text-xl font-semibold">{summary.total}</div>
          </div>
          <div className="rounded-xl border bg-red-50 px-4 py-3">
            <div className="text-xs text-red-600">Mora</div>
            <div className="text-xl font-semibold text-red-700">{summary.mora}</div>
          </div>
          <div className="rounded-xl border bg-amber-50 px-4 py-3">
            <div className="text-xs text-amber-700">Mensuales</div>
            <div className="text-xl font-semibold text-amber-800">{summary.monthly}</div>
          </div>
          <div className="rounded-xl border bg-violet-50 px-4 py-3">
            <div className="text-xs text-violet-700">Vigencia contrato</div>
            <div className="text-xl font-semibold text-violet-800">{summary.contract}</div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-left">Operacion</th>
                <th className="px-3 py-2 text-left">Contrato</th>
                <th className="px-3 py-2 text-left">Contenedor</th>
                <th className="px-3 py-2 text-left">Fecha de vencimiento</th>
                <th className="px-3 py-2 text-left">Dias</th>
                <th className="px-3 py-2 text-left">Mensaje</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    Cargando...
                  </td>
                </tr>
              )}
              {!loading &&
                filtered.map((row, index) => (
                  <tr key={`${row.contract_id}-${row.unit_id || "na"}-${index}`} className={`border-t ${rowTone(row.alert_type)}`}>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${pill(row.alert_type)}`}>
                        {alertLabel(row.alert_type)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Link className="text-blue-700 underline" to={`/operations/${row.deal_id}`}>
                        {row.reference || `OP #${row.deal_id}`}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{row.contract_no || "-"}</td>
                    <td className="px-3 py-2">
                      {row.container_no || "-"} {row.container_type ? `- ${row.container_type}` : ""}
                    </td>
                    <td className="px-3 py-2">{row.due_date || "-"}</td>
                    <td className="px-3 py-2">
                      {row.days_left === 0 ? "Hoy" : row.days_left ?? "-"}
                    </td>
                    <td className="px-3 py-2">{row.message || "-"}</td>
                  </tr>
                ))}
              {!loading && !filtered.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No hay alertas para los filtros actuales.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
