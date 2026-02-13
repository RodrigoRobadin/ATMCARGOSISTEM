// client/src/pages/AdminFinance.jsx
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth.jsx";

const money = (v) =>
  Number(v || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });

const toYMD = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);

const addMonths = (d, n) => {
  const nd = new Date(d.getFullYear(), d.getMonth() + n, 1);
  return nd;
};

const pct = (cur, prev) => {
  if (!prev) return cur ? 100 : 0;
  return ((cur - prev) / prev) * 100;
};

function KPI({ label, value, delta }) {
  const pos = delta >= 0;
  return (
    <div className="bg-white rounded-2xl shadow p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-bold mt-1">{money(value)}</div>
      <div
        className={`text-xs mt-1 ${
          pos ? "text-emerald-600" : "text-red-600"
        }`}
      >
        {pos ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}% vs periodo anterior
      </div>
    </div>
  );
}

function Chart({ labels, a, b, c }) {
  const max = Math.max(1, ...a, ...b, ...c);
  const w = 680;
  const h = 220;
  const padX = 24;
  const padY = 20;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;
  const toPoints = (series) =>
    series
      .map((v, i) => {
        const x = padX + (innerW * i) / Math.max(1, series.length - 1);
        const y = padY + innerH - (innerH * (v || 0)) / max;
        return `${x},${y}`;
      })
      .join(" ");

  return (
    <div className="bg-white rounded-2xl shadow p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-medium">Tendencia mensual</div>
        <div className="text-[11px] text-slate-500">
          Azul: Facturado · Verde: Cobrado · Rojo: Gastos
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          className="min-w-[680px]"
        >
          <line x1={padX} y1={h - padY} x2={w - padX} y2={h - padY} stroke="#e5e7eb" />
          <line x1={padX} y1={padY} x2={padX} y2={h - padY} stroke="#e5e7eb" />
          <polyline
            fill="none"
            stroke="#3b82f6"
            strokeWidth="2"
            points={toPoints(a)}
          />
          <polyline
            fill="none"
            stroke="#10b981"
            strokeWidth="2"
            points={toPoints(b)}
          />
          <polyline
            fill="none"
            stroke="#ef4444"
            strokeWidth="2"
            points={toPoints(c)}
          />
          {labels.map((l, i) => {
            const x = padX + (innerW * i) / Math.max(1, labels.length - 1);
            return (
              <text
                key={l}
                x={x}
                y={h - 4}
                textAnchor="middle"
                fontSize="10"
                fill="#94a3b8"
              >
                {l}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function Table({ title, rows, cols }) {
  return (
    <div className="bg-white rounded-2xl shadow p-4">
      <div className="font-medium mb-3">{title}</div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border-collapse">
          <thead className="bg-slate-100">
            <tr>
              {cols.map((c) => (
                <th key={c.key} className="px-2 py-2 text-left border-b">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={r.id || idx} className="hover:bg-slate-50">
                {cols.map((c) => (
                  <td key={c.key} className="px-2 py-2 border-b">
                    {c.render ? c.render(r) : r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td
                  colSpan={cols.length}
                  className="px-2 py-3 text-slate-500"
                >
                  Sin datos
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminFinance() {
  const { user } = useAuth();
  const isAdmin = (user?.role || "").toLowerCase() === "admin";
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [bus, setBus] = useState([]);
  const [buId, setBuId] = useState("");
  const [data, setData] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (from) params.from = from;
      if (to) params.to = to;
      if (buId) params.business_unit_id = buId;
      const { data: res } = await api.get("/admin/finance", { params });
      setData(res);
      if (!from) setFrom(res?.range?.from || "");
      if (!to) setTo(res?.range?.to || "");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    api.get("/business-units").then((r) => setBus(r.data || [])).catch(() => {});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyPreset(kind) {
    const now = new Date();
    let fromDate = startOfMonth(now);
    let toDate = now;
    if (kind === "m1") {
      fromDate = startOfMonth(now);
    } else if (kind === "m3") {
      fromDate = startOfMonth(addMonths(now, -2));
    } else if (kind === "m6") {
      fromDate = startOfMonth(addMonths(now, -5));
    } else if (kind === "ytd") {
      fromDate = new Date(now.getFullYear(), 0, 1);
    }
    setFrom(toYMD(fromDate));
    setTo(toYMD(toDate));
  }

  const kpi = data?.kpi || {};
  const prev = data?.prev || {};
  const labels = data?.series?.labels || [];
  const series = data?.series || { invoiced: [], paid: [], expenses: [] };

  if (!isAdmin) {
    return (
      <div className="p-4">
        <h2 className="text-lg font-semibold">Gerencia</h2>
        <p className="text-sm text-slate-600">
          No tenés permisos para ver esta página (requiere rol admin).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500">Gerencia</div>
            <div className="text-2xl font-bold">Finanzas</div>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="border rounded-lg px-2 py-1 text-sm"
              value={buId}
              onChange={(e) => setBuId(e.target.value)}
            >
              <option value="">Todas las unidades</option>
              {bus.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1">
              <button
                className="px-2 py-1 text-[11px] rounded border hover:bg-slate-50"
                onClick={() => applyPreset("m1")}
                type="button"
              >
                Mes actual
              </button>
              <button
                className="px-2 py-1 text-[11px] rounded border hover:bg-slate-50"
                onClick={() => applyPreset("m3")}
                type="button"
              >
                Últ. 3 meses
              </button>
              <button
                className="px-2 py-1 text-[11px] rounded border hover:bg-slate-50"
                onClick={() => applyPreset("m6")}
                type="button"
              >
                Últ. 6 meses
              </button>
              <button
                className="px-2 py-1 text-[11px] rounded border hover:bg-slate-50"
                onClick={() => applyPreset("ytd")}
                type="button"
              >
                Año actual
              </button>
            </div>
            <input
              type="date"
              className="border rounded-lg px-2 py-1 text-sm"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <input
              type="date"
              className="border rounded-lg px-2 py-1 text-sm"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <button
              className="px-3 py-2 text-sm rounded-lg bg-black text-white"
              onClick={load}
            >
              Aplicar
            </button>
            <button
              className="px-3 py-2 text-sm rounded-lg border"
              onClick={() => {
                const params = new URLSearchParams();
                if (from) params.set("from", from);
                if (to) params.set("to", to);
                if (buId) params.set("business_unit_id", buId);
                window.open(`/api/admin/finance/export?${params.toString()}`, "_blank");
              }}
            >
              Exportar Excel
            </button>
          </div>
        </div>
      </div>

      {loading && (
        <div className="text-sm text-slate-600">Cargando…</div>
      )}

      {!loading && data && (
        <>
          {data?.meta?.business_unit_id && (
            <div className="text-xs text-slate-500">
              Nota: los gastos administrativos se muestran a nivel empresa (no filtrados por unidad).
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
            <KPI
              label="Facturado"
              value={kpi.invoiced}
              delta={pct(kpi.invoiced, prev.invoiced)}
            />
            <KPI
              label="Cobrado"
              value={kpi.paid}
              delta={pct(kpi.paid, prev.paid)}
            />
            <KPI
              label="Pendiente de cobro"
              value={kpi.pending}
              delta={pct(kpi.pending, prev.pending)}
            />
            <KPI
              label="Gastos administrativos"
              value={kpi.expenses}
              delta={pct(kpi.expenses, prev.expenses)}
            />
            <KPI
              label="Utilidad"
              value={kpi.profit}
              delta={pct(kpi.profit, prev.profit)}
            />
          </div>

          <Chart
            labels={labels}
            a={series.invoiced}
            b={series.paid}
            c={series.expenses}
          />

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <Table
              title="Pendiente de cobro (top 10)"
              rows={data?.lists?.pending || []}
              cols={[
                { key: "invoice_number", label: "Factura" },
                { key: "organization_name", label: "Cliente" },
                { key: "issue_date", label: "Fecha" },
                {
                  key: "net_balance",
                  label: "Saldo",
                  render: (r) => money(r.net_balance),
                },
              ]}
            />
            <Table
              title="Cobros recientes"
              rows={data?.lists?.paid || []}
              cols={[
                { key: "receipt_number", label: "Recibo" },
                { key: "invoice_number", label: "Factura" },
                { key: "organization_name", label: "Cliente" },
                { key: "issue_date", label: "Fecha" },
                {
                  key: "net_amount",
                  label: "Monto",
                  render: (r) => money(r.net_amount),
                },
              ]}
            />
            <Table
              title="Gastos recientes"
              rows={data?.lists?.expenses || []}
              cols={[
                { key: "expense_date", label: "Fecha" },
                { key: "supplier_name", label: "Proveedor" },
                { key: "description", label: "Detalle" },
                {
                  key: "amount_usd",
                  label: "Monto USD",
                  render: (r) => money(r.amount_usd),
                },
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
}
