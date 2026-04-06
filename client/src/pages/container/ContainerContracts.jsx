import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";

const STATUSES = ["", "borrador", "emitido", "vigente", "vencido", "renovado", "cerrado", "anulado"];

function formatMoney(amount, currency) {
  const num = Number(amount || 0);
  const code = String(currency || "PYG").toUpperCase();
  const isUsd = code === "USD";
  return `${code} ${num.toLocaleString(isUsd ? "en-US" : "es-PY", {
    minimumFractionDigits: isUsd ? 2 : 0,
    maximumFractionDigits: isUsd ? 2 : 0,
  })}`;
}

function pill(status) {
  const key = String(status || "").toLowerCase();
  if (["vigente", "renovado"].includes(key)) return "bg-emerald-100 text-emerald-700";
  if (["vencido", "anulado"].includes(key)) return "bg-red-100 text-red-700";
  if (["emitido"].includes(key)) return "bg-blue-100 text-blue-700";
  return "bg-slate-100 text-slate-700";
}

function renewalLabel(row) {
  if (!Number(row?.renewal_no || 0)) return "Original";
  return `Ren ${row.renewal_no}${row.renewed_from_contract_no ? ` de ${row.renewed_from_contract_no}` : ""}`;
}

function operationalStatus(row) {
  const status = String(row?.status || "").toLowerCase();
  if (["anulado", "cerrado", "renovado"].includes(status)) return status;
  const now = new Date();
  const from = row?.effective_from ? new Date(`${row.effective_from}T00:00:00`) : null;
  const to = row?.effective_to ? new Date(`${row.effective_to}T00:00:00`) : null;
  if (to && to < now) return "vencido";
  if (from && from > now) return "programado";
  return status || "borrador";
}

export default function ContainerContracts() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ q: "", status: "" });
  const [updatingId, setUpdatingId] = useState(null);

  async function loadContracts() {
    setLoading(true);
    try {
      const { data } = await api.get("/container/contracts", {
        params: {
          q: filters.q || undefined,
          status: filters.status || undefined,
        },
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("load container contracts global", err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const handle = setTimeout(() => {
      loadContracts();
    }, 250);
    return () => clearTimeout(handle);
  }, [filters.q, filters.status]);

  async function quickStatus(contractId, status) {
    try {
      setUpdatingId(contractId);
      await api.patch(`/container/contracts/${contractId}/status`, { status });
      await loadContracts();
    } catch (err) {
      console.error("global contract quick status", err);
      alert(err?.response?.data?.error || "No se pudo actualizar el estado.");
    } finally {
      setUpdatingId(null);
    }
  }

  const totals = useMemo(() => {
    return rows.reduce((acc, row) => {
      const key = String(row.currency_code || "PYG").toUpperCase();
      acc[key] = (acc[key] || 0) + Number(row.total_amount || 0);
      return acc;
    }, {});
  }, [rows]);

  const summary = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.total += 1;
        const key = String(row.status || "").toLowerCase();
        if (key === "vigente") acc.vigente += 1;
        if (key === "renovado") acc.renovado += 1;
        if (key === "vencido") acc.vencido += 1;
        if (key === "anulado") acc.anulado += 1;
        return acc;
      },
      { total: 0, vigente: 0, renovado: 0, vencido: 0, anulado: 0 }
    );
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-white p-5">
        <div className="font-semibold">Contratos ATM CONTAINER</div>
        <div className="text-sm text-slate-500 mt-1">
          Control global de contratos, renovaciones, revisiones y montos por operacion.
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_260px] gap-3 mt-4">
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm"
            placeholder="Buscar por contrato, operacion, cliente, proveedor o contenedor"
            value={filters.q}
            onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))}
          />
          <select
            className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
            value={filters.status}
            onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
          >
            <option value="">Estado</option>
            {STATUSES.filter(Boolean).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
        <div className="text-sm text-slate-600 mt-3">
          Totales:{" "}
          {Object.keys(totals).length
            ? Object.entries(totals)
                .map(([currency, amount]) => formatMoney(amount, currency))
                .join(" | ")
            : "-"}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
          <div className="rounded-xl border bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-500">Total</div>
            <div className="text-xl font-semibold">{summary.total}</div>
          </div>
          <div className="rounded-xl border bg-emerald-50 px-4 py-3">
            <div className="text-xs text-emerald-700">Vigentes</div>
            <div className="text-xl font-semibold text-emerald-800">{summary.vigente}</div>
          </div>
          <div className="rounded-xl border bg-blue-50 px-4 py-3">
            <div className="text-xs text-blue-700">Renovados</div>
            <div className="text-xl font-semibold text-blue-800">{summary.renovado}</div>
          </div>
          <div className="rounded-xl border bg-amber-50 px-4 py-3">
            <div className="text-xs text-amber-700">Vencidos</div>
            <div className="text-xl font-semibold text-amber-800">{summary.vencido}</div>
          </div>
          <div className="rounded-xl border bg-red-50 px-4 py-3">
            <div className="text-xs text-red-700">Anulados</div>
            <div className="text-xl font-semibold text-red-800">{summary.anulado}</div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left">Contrato</th>
                <th className="px-3 py-2 text-left">Operacion</th>
                <th className="px-3 py-2 text-left">Cliente</th>
                <th className="px-3 py-2 text-left">Proveedor</th>
                <th className="px-3 py-2 text-left">Locador</th>
                <th className="px-3 py-2 text-left">Contenedores</th>
                <th className="px-3 py-2 text-left">Vigencia</th>
                <th className="px-3 py-2 text-left">Monto</th>
                <th className="px-3 py-2 text-left">Estado</th>
                <th className="px-3 py-2 text-left">Operativo</th>
                <th className="px-3 py-2 text-left">Revision</th>
                <th className="px-3 py-2 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-slate-500">
                    Cargando...
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{row.contract_no || `Contrato #${row.id}`}</td>
                    <td className="px-3 py-2">
                      <Link className="text-blue-700 underline" to={`/operations/${row.deal_id}`}>
                        {row.reference || `OP #${row.deal_id}`}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{row.client_name || "-"}</td>
                    <td className="px-3 py-2">{row.provider_name || "-"}</td>
                    <td className="px-3 py-2">{row.lessor_name || "-"}</td>
                    <td className="px-3 py-2 max-w-[340px]">{row.containers_label || "-"}</td>
                    <td className="px-3 py-2">
                      <div>{row.effective_from || "-"}</div>
                      <div className="text-xs text-slate-500">
                        {row.effective_to || "abierto"} · {renewalLabel(row)}
                      </div>
                    </td>
                    <td className="px-3 py-2">{formatMoney(row.total_amount, row.currency_code)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${pill(row.status)}`}>
                        {row.status || "-"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${pill(operationalStatus(row))}`}>
                        {operationalStatus(row)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div>R{row.revision_no || 1}</div>
                      <div className="text-xs text-slate-500">{renewalLabel(row)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="px-2 py-1 rounded border text-xs" onClick={() => quickStatus(row.id, "vigente")} disabled={updatingId === row.id}>
                          Vigente
                        </button>
                        <button type="button" className="px-2 py-1 rounded border text-xs" onClick={() => quickStatus(row.id, "cerrado")} disabled={updatingId === row.id}>
                          Cerrar
                        </button>
                        <button type="button" className="px-2 py-1 rounded border text-xs text-red-700" onClick={() => quickStatus(row.id, "anulado")} disabled={updatingId === row.id}>
                          Anular
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              {!loading && !rows.length && (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-slate-500">
                    No hay contratos para los filtros actuales.
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
