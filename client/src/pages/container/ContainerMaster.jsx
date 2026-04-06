import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";

const STATUSES = [
  "",
  "pendiente_confirmacion",
  "confirmado",
  "reservado",
  "entregado",
  "activo",
  "en_mantenimiento",
  "retirado",
  "devuelto",
  "cancelado",
];

const TYPES = ["", "20 ST", "40 ST", "20 RF", "40 RF"];

function FilterInput(props) {
  return <input className="w-full border rounded-lg px-3 py-2 text-sm" {...props} />;
}

function statusPill(status) {
  const key = String(status || "").toLowerCase();
  if (["activo", "entregado", "confirmado", "reservado"].includes(key)) return "bg-emerald-100 text-emerald-700";
  if (["en_mantenimiento"].includes(key)) return "bg-amber-100 text-amber-700";
  if (["retirado", "devuelto", "cancelado"].includes(key)) return "bg-slate-200 text-slate-700";
  return "bg-slate-100 text-slate-700";
}

function statusLabel(status) {
  return String(status || "-").replaceAll("_", " ");
}

export default function ContainerMaster() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ q: "", status: "", type: "" });
  const [updatingId, setUpdatingId] = useState(null);

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/container/master");
        if (!live) return;
        setRows(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("load container master", err);
        if (live) setRows([]);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  async function quickStatus(row, nextStatus) {
    try {
      setUpdatingId(row.id);
      const today = new Date().toISOString().slice(0, 10);
      const payload = { status: nextStatus };
      if (["entregado", "activo", "en_mantenimiento"].includes(nextStatus) && !row.delivered_at) {
        payload.delivered_at = today;
      }
      if (["retirado", "devuelto"].includes(nextStatus) && !row.removed_at) {
        payload.removed_at = today;
      }
      if (["confirmado", "reservado"].includes(nextStatus) && row.removed_at) {
        payload.removed_at = null;
      }
      const { data } = await api.put(`/container/units/${row.id}`, payload);
      setRows((prev) => prev.map((item) => (item.id === row.id ? { ...item, ...data } : item)));
    } catch (err) {
      console.error("quick container status", err);
      alert(err?.response?.data?.error || "No se pudo actualizar el estado del contenedor.");
    } finally {
      setUpdatingId(null);
    }
  }

  function actionButtons(row) {
    const status = String(row.status || "").toLowerCase();
    const common = "px-2 py-1 rounded border text-xs";
    if (status === "pendiente_confirmacion") {
      return [
        <button key="confirmado" type="button" className={common} onClick={() => quickStatus(row, "confirmado")} disabled={updatingId === row.id}>
          Confirmar
        </button>,
        <button key="cancelado" type="button" className={`${common} text-red-700`} onClick={() => quickStatus(row, "cancelado")} disabled={updatingId === row.id}>
          Cancelar
        </button>,
      ];
    }
    if (status === "confirmado") {
      return [
        <button key="reservado" type="button" className={common} onClick={() => quickStatus(row, "reservado")} disabled={updatingId === row.id}>
          Reservar
        </button>,
        <button key="entregado" type="button" className={common} onClick={() => quickStatus(row, "entregado")} disabled={updatingId === row.id}>
          Entregar
        </button>,
      ];
    }
    if (status === "reservado") {
      return [
        <button key="entregado" type="button" className={common} onClick={() => quickStatus(row, "entregado")} disabled={updatingId === row.id}>
          Entregar
        </button>,
        <button key="cancelado" type="button" className={`${common} text-red-700`} onClick={() => quickStatus(row, "cancelado")} disabled={updatingId === row.id}>
          Cancelar
        </button>,
      ];
    }
    if (["entregado", "activo"].includes(status)) {
      return [
        <button key="activo" type="button" className={common} onClick={() => quickStatus(row, "activo")} disabled={updatingId === row.id}>
          Activar
        </button>,
        <button key="mantenimiento" type="button" className={common} onClick={() => quickStatus(row, "en_mantenimiento")} disabled={updatingId === row.id}>
          Mantenimiento
        </button>,
        <button key="retirado" type="button" className={common} onClick={() => quickStatus(row, "retirado")} disabled={updatingId === row.id}>
          Retirar
        </button>,
      ];
    }
    if (status === "en_mantenimiento") {
      return [
        <button key="activo" type="button" className={common} onClick={() => quickStatus(row, "activo")} disabled={updatingId === row.id}>
          Reactivar
        </button>,
        <button key="retirado" type="button" className={common} onClick={() => quickStatus(row, "retirado")} disabled={updatingId === row.id}>
          Retirar
        </button>,
      ];
    }
    if (status === "retirado") {
      return [
        <button key="devuelto" type="button" className={common} onClick={() => quickStatus(row, "devuelto")} disabled={updatingId === row.id}>
          Devolver
        </button>,
      ];
    }
    return [];
  }

  const filtered = useMemo(() => {
    const q = String(filters.q || "").trim().toLowerCase();
    return rows.filter((row) => {
      if (filters.status && row.status !== filters.status) return false;
      if (filters.type && row.container_type !== filters.type) return false;
      if (!q) return true;
      const haystack = [
        row.reference,
        row.title,
        row.container_no,
        row.container_type,
        row.client_name,
        row.provider_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, filters]);

  const summary = useMemo(() => {
    return filtered.reduce(
      (acc, row) => {
        acc.total += 1;
        const key = String(row.status || "").toLowerCase();
        if (["activo", "entregado"].includes(key)) acc.activos += 1;
        if (key === "en_mantenimiento") acc.mantenimiento += 1;
        if (["retirado", "devuelto"].includes(key)) acc.finalizados += 1;
        if (["pendiente_confirmacion", "confirmado", "reservado"].includes(key)) acc.preparacion += 1;
        return acc;
      },
      { total: 0, activos: 0, mantenimiento: 0, finalizados: 0, preparacion: 0 }
    );
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-white p-5">
        <div className="font-semibold">Maestro de contenedores</div>
        <div className="text-sm text-slate-500 mt-1">
          Vista global de contenedores confirmados, entregados, activos y retirados.
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          <FilterInput
            placeholder="Buscar por contenedor, cliente, proveedor u operacion"
            value={filters.q}
            onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))}
          />
          <select
            className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
            value={filters.type}
            onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value }))}
          >
            <option value="">Tipo de contenedor</option>
            {TYPES.filter(Boolean).map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
          <div className="rounded-xl border bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-500">Total</div>
            <div className="text-xl font-semibold">{summary.total}</div>
          </div>
          <div className="rounded-xl border bg-emerald-50 px-4 py-3">
            <div className="text-xs text-emerald-700">Activos</div>
            <div className="text-xl font-semibold text-emerald-800">{summary.activos}</div>
          </div>
          <div className="rounded-xl border bg-amber-50 px-4 py-3">
            <div className="text-xs text-amber-700">Mantenimiento</div>
            <div className="text-xl font-semibold text-amber-800">{summary.mantenimiento}</div>
          </div>
          <div className="rounded-xl border bg-blue-50 px-4 py-3">
            <div className="text-xs text-blue-700">Preparacion</div>
            <div className="text-xl font-semibold text-blue-800">{summary.preparacion}</div>
          </div>
          <div className="rounded-xl border bg-slate-100 px-4 py-3">
            <div className="text-xs text-slate-600">Finalizados</div>
            <div className="text-xl font-semibold text-slate-800">{summary.finalizados}</div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left">Contenedor</th>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-left">Estado</th>
                <th className="px-3 py-2 text-left">Operacion</th>
                <th className="px-3 py-2 text-left">Cliente</th>
                <th className="px-3 py-2 text-left">Proveedor</th>
                <th className="px-3 py-2 text-left">Entrega</th>
                <th className="px-3 py-2 text-left">Retiro</th>
                <th className="px-3 py-2 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    Cargando...
                  </td>
                </tr>
              )}
              {!loading &&
                filtered.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{row.container_no || "-"}</td>
                    <td className="px-3 py-2">{row.container_type || "-"}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${statusPill(row.status)}`}>
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Link className="text-blue-700 underline" to={`/operations/${row.deal_id}`}>
                        {row.reference || `OP #${row.deal_id}`}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{row.client_name || "-"}</td>
                    <td className="px-3 py-2">{row.provider_name || "-"}</td>
                    <td className="px-3 py-2">{row.delivered_at || "-"}</td>
                    <td className="px-3 py-2">{row.removed_at || "-"}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        {actionButtons(row)}
                        <Link className="px-2 py-1 rounded border text-xs" to={`/operations/${row.deal_id}`}>
                          Abrir
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              {!loading && !filtered.length && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    No hay contenedores para los filtros actuales.
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
