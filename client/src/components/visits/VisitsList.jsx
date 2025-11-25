// client/src/components/visits/VisitsList.jsx
import React, { useState } from "react";
import VisitDetail from "./VisitDetail";

export default function VisitsList({ visits = [], onRefresh, orgs = [], contacts = [] }) {
  const [filter, setFilter] = useState("all");
  const [selectedVisitId, setSelectedVisitId] = useState(null);

  const filteredVisits = visits.filter((v) => {
    if (filter === "all") return true;
    return v.status === filter;
  });

  const getStatusBadge = (status) => {
    const badges = {
      scheduled: "bg-blue-100 text-blue-700",
      confirmed: "bg-green-100 text-green-700",
      completed: "bg-slate-100 text-slate-700",
      cancelled: "bg-red-100 text-red-700",
      rescheduled: "bg-amber-100 text-amber-700",
    };
    const labels = {
      scheduled: "Programada",
      confirmed: "Confirmada",
      completed: "Completada",
      cancelled: "Cancelada",
      rescheduled: "Reprogramada",
    };
    return (
      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${badges[status] || badges.scheduled}`}>
        {labels[status] || status}
      </span>
    );
  };

  const getOutcomeBadge = (outcome) => {
    if (!outcome) return null;
    const badges = {
      successful: "bg-emerald-100 text-emerald-700",
      neutral: "bg-slate-100 text-slate-700",
      negative: "bg-rose-100 text-rose-700",
    };
    const labels = {
      successful: "Exitosa",
      neutral: "Neutral",
      negative: "Negativa",
    };
    return (
      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${badges[outcome]}`}>
        {labels[outcome]}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-600">Filtrar:</span>
        <select
          className="border rounded-lg px-3 py-1.5 text-sm"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">Todas</option>
          <option value="scheduled">Programadas</option>
          <option value="confirmed">Confirmadas</option>
          <option value="completed">Completadas</option>
          <option value="cancelled">Canceladas</option>
        </select>
        <span className="text-sm text-slate-500">
          Total: <b>{filteredVisits.length}</b>
        </span>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left p-2 border">Fecha programada</th>
              <th className="text-left p-2 border">Organización</th>
              <th className="text-left p-2 border">Contactos</th>
              <th className="text-left p-2 border">Objetivo</th>
              <th className="text-left p-2 border">Estado</th>
              <th className="text-left p-2 border">Resultado</th>
              <th className="text-right p-2 border">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filteredVisits.length ? (
              filteredVisits.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50">
                  <td className="p-2 border">
                    {v.scheduled_at
                      ? new Date(v.scheduled_at).toLocaleString()
                      : "—"}
                  </td>
                  <td className="p-2 border">{v.org_name || "—"}</td>
                  <td className="p-2 border">
                    {v.contacts && v.contacts.length > 0
                      ? v.contacts.map((c) => c.name).join(", ")
                      : "—"}
                  </td>
                  <td className="p-2 border">{v.objective || "—"}</td>
                  <td className="p-2 border">{getStatusBadge(v.status)}</td>
                  <td className="p-2 border">{getOutcomeBadge(v.outcome)}</td>
                  <td className="p-2 border text-right">
                    <button
                      className="px-2 py-1 text-xs rounded-lg border hover:bg-slate-100"
                      onClick={() => setSelectedVisitId(v.id)}
                    >
                      Ver
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="p-4 text-center text-slate-500">
                  No hay visitas registradas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal de detalle */}
      {selectedVisitId && (
        <VisitDetail
          visitId={selectedVisitId}
          onClose={() => setSelectedVisitId(null)}
          onUpdate={() => {
            setSelectedVisitId(null);
            if (onRefresh) onRefresh();
          }}
        />
      )}
    </div>
  );
}
