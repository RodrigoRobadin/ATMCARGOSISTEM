import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth.jsx";

const fmtMoney = (value) =>
  new Intl.NumberFormat("es-PY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

function KpiCard({ label, value, hint, tone = "slate" }) {
  const toneClass =
    tone === "red"
      ? "text-red-700"
      : tone === "emerald"
        ? "text-emerald-700"
        : "text-slate-900";
  return (
    <div className="rounded-lg border bg-white p-4 dark:bg-slate-950 dark:border-slate-800">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-2 text-xl font-semibold ${toneClass}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

function DealTable({ title, rows, emptyText }) {
  return (
    <div className="rounded-lg border bg-white overflow-hidden dark:bg-slate-950 dark:border-slate-800">
      <div className="px-4 py-3 border-b font-semibold text-sm dark:border-slate-800">{title}</div>
      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
            <tr>
              <th className="text-left px-3 py-2">Operacion</th>
              <th className="text-left px-3 py-2">Cliente</th>
              <th className="text-left px-3 py-2">Etapa</th>
              <th className="text-right px-3 py-2">Valor</th>
              <th className="text-right px-3 py-2">Profit</th>
              <th className="text-right px-3 py-2">Dias</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((row) => (
              <tr key={row.id} className="border-t dark:border-slate-800">
                <td className="px-3 py-2">
                  <Link
                    to={`/operations/${row.id}`}
                    className="font-medium text-blue-700 hover:underline dark:text-blue-300"
                  >
                    {row.reference || row.title || `#${row.id}`}
                  </Link>
                  <div className="text-xs text-slate-500">{row.business_unit_name || ""}</div>
                </td>
                <td className="px-3 py-2">{row.org_name || "-"}</td>
                <td className="px-3 py-2">{row.stage_name || "-"}</td>
                <td className="px-3 py-2 text-right">USD {fmtMoney(row.sales_amount || row.value)}</td>
                <td className="px-3 py-2 text-right">USD {fmtMoney(row.profit_amount)}</td>
                <td className="px-3 py-2 text-right">{row.age_days ?? "-"}</td>
              </tr>
            ))}
            {!(rows || []).length ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                  {emptyText}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CommercialDashboard() {
  const { user } = useAuth();
  const isAdmin = String(user?.role || "").toLowerCase() === "admin";
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [businessUnit, setBusinessUnit] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  async function loadDashboard() {
    setLoading(true);
    setError("");
    try {
      const { data: payload } = await api.get("/commercial-dashboard", {
        params: {
          ...(isAdmin && selectedUserId ? { user_id: selectedUserId } : {}),
          ...(businessUnit ? { business_unit: businessUnit } : {}),
        },
      });
      setData(payload || null);
    } catch (e) {
      console.error("Error loading commercial dashboard", e);
      setError(e?.response?.data?.error || "No se pudo cargar el dashboard comercial.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    api
      .get("/users/select", { params: { active: 1 } })
      .then((res) => setUsers(Array.isArray(res.data) ? res.data : []))
      .catch(() => setUsers([]));
  }, [isAdmin]);

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserId, businessUnit]);

  const summary = data?.summary || {};
  const byStage = data?.by_stage || [];
  const maxStageValue = useMemo(
    () => Math.max(1, ...byStage.map((row) => Number(row.value || 0))),
    [byStage]
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Dashboard comercial</h1>
          <p className="text-sm text-slate-500">
            Operaciones comerciales de ATM Cargo e Industrial por ejecutivo.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isAdmin ? (
            <select
              className="border rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-950 dark:border-slate-700"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
            >
              <option value="">Todos los comerciales</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.email || `Usuario ${u.id}`}
                </option>
              ))}
            </select>
          ) : null}
          <select
            className="border rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-950 dark:border-slate-700"
            value={businessUnit}
            onChange={(e) => setBusinessUnit(e.target.value)}
          >
            <option value="">Cargo + Industrial</option>
            <option value="atm-cargo">ATM Cargo</option>
            <option value="atm-industrial">ATM Industrial</option>
          </select>
          <button className="border rounded-lg px-3 py-2 text-sm" type="button" onClick={loadDashboard}>
            Actualizar
          </button>
        </div>
      </div>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {loading ? <div className="text-sm text-slate-500">Cargando...</div> : null}

      {!loading && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <KpiCard label="Operaciones abiertas" value={summary.open_deals || 0} />
            <KpiCard label="Valor pipeline" value={`USD ${fmtMoney(summary.pipeline_value)}`} />
            <KpiCard label="Profit estimado" value={`USD ${fmtMoney(summary.estimated_profit)}`} tone="emerald" />
            <KpiCard label="Por cerrar" value={summary.closing_soon_count || 0} hint="Etapas de alta probabilidad" />
            <KpiCard label="Cotizadas" value={summary.quoted_deals || 0} />
            <KpiCard label="Sin cotizar" value={summary.unquoted_deals || 0} tone="red" />
            <KpiCard label="Actividades vencidas" value={summary.overdue_activities || 0} tone="red" />
            <KpiCard label="Estancadas" value={summary.stuck_deals || 0} tone="red" />
          </div>

          <div className="rounded-lg border bg-white p-4 dark:bg-slate-950 dark:border-slate-800">
            <div className="font-semibold text-sm mb-3">Pipeline por etapa</div>
            <div className="space-y-3">
              {byStage.map((row) => {
                const pct = Math.max(4, Math.round((Number(row.value || 0) / maxStageValue) * 100));
                return (
                  <div key={row.stage_id || row.stage_name}>
                    <div className="flex justify-between text-xs mb-1">
                      <span>{row.stage_name}</span>
                      <span>{row.count} ops - USD {fmtMoney(row.value)}</span>
                    </div>
                    <div className="h-2 rounded bg-slate-100 overflow-hidden dark:bg-slate-800">
                      <div className="h-full bg-black dark:bg-white" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              {!byStage.length ? <div className="text-sm text-slate-500">Sin operaciones para mostrar.</div> : null}
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <DealTable title="Operaciones por cerrar" rows={data?.closing_soon || []} emptyText="Sin operaciones cercanas a cierre." />
            <DealTable title="Operaciones estancadas" rows={data?.stuck || []} emptyText="Sin operaciones estancadas." />
          </div>

          <DealTable title="Top operaciones" rows={data?.top_deals || []} emptyText="Sin operaciones." />
        </>
      )}
    </div>
  );
}
