import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../api";

function statusPill(type) {
  const key = String(type || "").toLowerCase();
  if (key.includes("mora")) return "bg-red-100 text-red-700";
  if (key.includes("contrato")) return "bg-violet-100 text-violet-700";
  if (key.includes("venc")) return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

function statusLabel(type) {
  const key = String(type || "").toLowerCase();
  if (key === "mora_activa") return "Mora activa";
  if (key === "vence_hoy") return "Vence hoy";
  if (key.startsWith("vence_en_")) return `Vence en ${key.replace("vence_en_", "")} dias`;
  if (key === "contrato_vence_hoy") return "Contrato vence hoy";
  if (key === "contrato_vencido") return "Contrato vencido";
  if (key.startsWith("contrato_vence_en_")) return `Contrato vence en ${key.replace("contrato_vence_en_", "")} dias`;
  return type || "-";
}

function rowTone(type) {
  const key = String(type || "").toLowerCase();
  if (key.includes("mora")) return "bg-red-50/40";
  if (key.includes("contrato")) return "bg-violet-50/40";
  return "";
}

export default function ContainerAlertsPanel({ dealId }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);

  async function loadAlerts() {
    setLoading(true);
    try {
      const { data } = await api.get(`/container/deals/${dealId}/alerts`);
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("load container alerts", err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAlerts();
  }, [dealId]);

  const grouped = useMemo(() => {
    return rows.reduce((acc, row) => {
      const key = row.contract_no || `Contrato #${row.contract_id}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(row);
      return acc;
    }, {});
  }, [rows]);

  const summary = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        const key = String(row.alert_type || "").toLowerCase();
        acc.total += 1;
        if (key.includes("mora")) acc.mora += 1;
        else if (key.includes("contrato")) acc.contract += 1;
        else acc.monthly += 1;
        return acc;
      },
      { total: 0, mora: 0, contract: 0, monthly: 0 }
    );
  }, [rows]);

  if (loading) {
    return <div className="rounded-2xl border bg-white p-5 text-sm text-slate-500">Cargando alertas...</div>;
  }

  if (!rows.length) {
    return (
      <div className="rounded-2xl border bg-white p-5">
        <div className="font-semibold">Alertas</div>
        <div className="text-sm text-slate-500 mt-2">No hay alertas activas para esta operacion.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold">Alertas internas</div>
            <div className="text-sm text-slate-500">Vencimientos, mora y seguimiento mensual desde la entrega.</div>
          </div>
          <button type="button" className="px-3 py-2 rounded-lg border text-sm" onClick={loadAlerts}>
            Actualizar
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <div className="rounded-xl border bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-500">Total</div>
            <div className="text-lg font-semibold">{summary.total}</div>
          </div>
          <div className="rounded-xl border bg-red-50 px-4 py-3">
            <div className="text-xs text-red-600">Mora</div>
            <div className="text-lg font-semibold text-red-700">{summary.mora}</div>
          </div>
          <div className="rounded-xl border bg-amber-50 px-4 py-3">
            <div className="text-xs text-amber-700">Mensuales</div>
            <div className="text-lg font-semibold text-amber-800">{summary.monthly}</div>
          </div>
          <div className="rounded-xl border bg-violet-50 px-4 py-3">
            <div className="text-xs text-violet-700">Vigencia contrato</div>
            <div className="text-lg font-semibold text-violet-800">{summary.contract}</div>
          </div>
        </div>
      </div>

      {Object.entries(grouped).map(([contractKey, alerts]) => (
        <div key={contractKey} className="rounded-2xl border bg-white overflow-hidden">
          <div className="px-5 py-4 border-b">
            <div className="font-semibold">{contractKey}</div>
            <div className="text-sm text-slate-500">{alerts[0]?.reference || "-"}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left">Tipo</th>
                  <th className="px-3 py-2 text-left">Contenedor</th>
                  <th className="px-3 py-2 text-left">Fecha de vencimiento</th>
                  <th className="px-3 py-2 text-left">Mensaje</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((row, index) => (
                  <tr key={`${row.contract_id}-${row.unit_id || "na"}-${row.alert_type}-${index}`} className={`border-t ${rowTone(row.alert_type)}`}>
                    <td className="px-3 py-2">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${statusPill(row.alert_type)}`}>
                        {statusLabel(row.alert_type)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {row.container_no || "-"} {row.container_type ? `- ${row.container_type}` : ""}
                    </td>
                    <td className="px-3 py-2">
                      <div>{row.due_date || row.delivered_at || "-"}</div>
                      {row.days_left !== undefined && row.days_left !== null && (
                        <div className="text-xs text-slate-500">{row.days_left === 0 ? "Hoy" : `${row.days_left} dias`}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">{row.message || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
