// client/src/pages/service/ServiceDoorDetail.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../../api";

export default function ServiceDoorDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState("todos");

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/service/doors/${id}`);
        setData(data);
      } catch (e) {
        setError("No se pudo cargar el equipo");
      }
    })();
  }, [id]);

  const safeData = data || {};
  const { door, components, actuators, history, timeline } = safeData;
  const asList = (val) => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed;
      } catch (_) {}
      return [val];
    }
    return [String(val)];
  };
  const normalizeWorkTypes = (val) => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed;
      } catch (_) {}
      return [val];
    }
    return [String(val)];
  };
  const renderDetail = (h) => {
    const parts = [];
    if (h?.maintenance_detail) parts.push({ label: "Mantenimiento", value: h.maintenance_detail });
    if (h?.repair_detail) parts.push({ label: "Reparacion", value: h.repair_detail });
    if (h?.revision_detail) parts.push({ label: "Revision", value: h.revision_detail });
    const comp = asList(h?.parts_components);
    if (comp.length) parts.push({ label: "Componentes", value: comp.join(", ") });
    const act = asList(h?.parts_actuators);
    if (act.length) parts.push({ label: "Actuadores", value: act.join(", ") });
    if (h?.work_done) parts.push({ label: "Trabajo", value: h.work_done });
    if (h?.parts_used) parts.push({ label: "Repuestos", value: h.parts_used });
    if (!parts.length) return "—";
    return (
      <div className="space-y-1">
        {parts.map((p) => (
          <div key={p.label}>
            <span className="text-xs text-slate-500">{p.label}:</span>{" "}
            <span>{p.value}</span>
          </div>
        ))}
      </div>
    );
  };
  const formatDateTime = (val) => {
    if (!val) return "—";
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) return String(val).slice(0, 19).replace("T", " ");
    return d.toISOString().slice(0, 19).replace("T", " ");
  };
  const timelineRows = useMemo(() => {
    const base = Array.isArray(timeline) && timeline.length ? timeline : history || [];
    return base.filter((row) => {
      if (typeFilter === "todos") return true;
      if (typeFilter === "piezas") return row.event_type === "piezas";
      const list = normalizeWorkTypes(row.work_type);
      return list.includes(typeFilter);
    });
  }, [timeline, history, typeFilter]);

  const timelineAll = useMemo(() => {
    return Array.isArray(timeline) && timeline.length ? timeline : history || [];
  }, [timeline, history]);

  const summary = useMemo(() => {
    const totals = { parts: {}, service: {} };
    let lastDate = null;
    for (const row of timelineAll || []) {
      const dt = row?.created_at ? new Date(row.created_at) : null;
      if (dt && !Number.isNaN(dt.getTime())) {
        if (!lastDate || dt > lastDate) lastDate = dt;
      }
      if (row?.event_type === "piezas") {
        const curr = String(row.currency || "PYG").toUpperCase();
        const qty = Number(row.quantity || 0);
        const unit = Number(row.unit_cost || 0);
        if (!totals.parts[curr]) totals.parts[curr] = 0;
        totals.parts[curr] += qty * unit;
      } else if (row?.cost != null) {
        const curr = String(row.currency || "PYG").toUpperCase();
        if (!totals.service[curr]) totals.service[curr] = 0;
        totals.service[curr] += Number(row.cost || 0);
      }
    }
    return { totals, lastDate, count: (timelineAll || []).length };
  }, [timelineAll]);

  if (error) return <div className="text-red-600">{error}</div>;
  if (!data) return <div className="text-slate-500">Cargando...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Equipo {door?.nombre || door?.placa_id}</h1>
          <div className="text-sm text-slate-500">{door?.org_name || door?.org_id} {door?.org_ruc ? `? ${door.org_ruc}` : ""}</div>
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={() => nav(`/service?editDoor=${door?.id}`)}>
            Editar
          </button>
          <Link className="text-blue-600 underline" to="/service">
            Volver
          </Link>
        </div>
      </div>

      <div className="bg-white border rounded-lg p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div><span className="text-xs text-slate-500">Cliente</span><div>{door?.org_name || door?.org_id || "-"}</div></div>
        <div><span className="text-xs text-slate-500">Sucursal</span><div>{door?.org_branch_name || "Sin sucursal"}</div></div>
        <div><span className="text-xs text-slate-500">Direccion sucursal</span><div>{door?.org_branch_address || "-"}</div></div>
        <div><span className="text-xs text-slate-500">RUC</span><div>{door?.org_ruc || "-"}</div></div>
        <div><span className="text-xs text-slate-500">Nombre</span><div>{door?.nombre || "-"}</div></div>
        <div><span className="text-xs text-slate-500">Nro. Serie</span><div>{door?.nro_serie || "—"}</div></div>
        <div><span className="text-xs text-slate-500">Sector</span><div>{door?.sector || "—"}</div></div>
        <div><span className="text-xs text-slate-500">Marca</span><div>{door?.marca || "Rayflex"}</div></div>
        <div><span className="text-xs text-slate-500">Modelo</span><div>{door?.modelo || "—"}</div></div>
        <div><span className="text-xs text-slate-500">Dimensiones</span><div>{door?.dimensiones || "—"}</div></div>
        <div><span className="text-xs text-slate-500">Instalación</span><div>{door?.fecha_instalacion?.slice(0,10) || "—"}</div></div>
        <div><span className="text-xs text-slate-500">Últ. mantenimiento</span><div>{door?.fecha_ultimo_mantenimiento?.slice(0,10) || "—"}</div></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white border rounded-lg p-3">
          <div className="text-sm font-semibold mb-2">Componentes</div>
          <ul className="text-sm list-disc pl-5">
            {components?.length ? components.map((c) => (
              <li key={c.id}>{c.name}</li>
            )) : <li>—</li>}
          </ul>
        </div>
        <div className="bg-white border rounded-lg p-3">
          <div className="text-sm font-semibold mb-2">Accionadores</div>
          <ul className="text-sm list-disc pl-5">
            {actuators?.length ? actuators.map((a) => (
              <li key={a.id}>{a.name}</li>
            )) : <li>—</li>}
          </ul>
        </div>
      </div>

      <div className="bg-white border rounded-lg p-3">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="text-sm font-semibold">Historial de mantenimiento</div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500 text-xs">Filtrar</span>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="todos">Todos</option>
              <option value="mantenimiento">Mantenimiento</option>
              <option value="reparacion">Reparacion</option>
              <option value="revision">Revision</option>
              <option value="cambio_piezas">Cambio de piezas</option>
              <option value="piezas">Piezas (detalle)</option>
            </select>
          </div>
        </div>
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-1 rounded bg-slate-100 text-slate-700">
            Total eventos: {summary.count}
          </span>
          <span className="px-2 py-1 rounded bg-slate-100 text-slate-700">
            Última intervención: {summary.lastDate ? summary.lastDate.toISOString().slice(0,10) : "—"}
          </span>
          {Object.entries(summary.totals.parts || {}).map(([curr, total]) => (
            <span key={`parts-${curr}`} className="px-2 py-1 rounded bg-emerald-100 text-emerald-700">
              Total piezas {curr}: {Number(total).toLocaleString()}
            </span>
          ))}
          {Object.entries(summary.totals.service || {}).map(([curr, total]) => (
            <span key={`svc-${curr}`} className="px-2 py-1 rounded bg-amber-100 text-amber-700">
              Total servicio {curr}: {Number(total).toLocaleString()}
            </span>
          ))}
        </div>
        <div className="mb-4">
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Timeline</div>
          <div className="relative pl-6">
            <div className="absolute left-2 top-0 bottom-0 w-px bg-slate-200" />
            <div className="space-y-4">
              {timelineRows?.length ? timelineRows.map((h) => (
                <div key={`tl-${h.id}`} className="relative">
                  <div className="absolute left-0 top-2 h-3 w-3 rounded-full border-2 border-white shadow bg-slate-900" />
                  <div className="bg-slate-50 border rounded-lg p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold">
                        {h.event_type === "piezas"
                          ? "Piezas"
                          : (normalizeWorkTypes(h.work_type).join(", ") || h.work_type || "—")}
                      </div>
                      <div className="text-xs text-slate-500">{formatDateTime(h.created_at)}</div>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {h.reference || (h.service_case_id ? `#${h.service_case_id}` : `#${h.id}`)}
                      {h.stage_name ? ` · ${h.stage_name}` : ""}
                      {h.status ? ` · ${h.status}` : ""}
                      {h.user_name ? ` · ${h.user_name}` : ""}
                    </div>
                    <div className="mt-2 text-sm">
                      {h.event_type === "piezas" ? (
                        <div className="space-y-1">
                          <div>
                            <span className="text-xs text-slate-500">Pieza:</span>{" "}
                            <span>{h.part_name}</span>
                          </div>
                          <div>
                            <span className="text-xs text-slate-500">Cantidad:</span>{" "}
                            <span>{h.quantity}</span>
                          </div>
                          {h.unit_cost != null && (
                            <div>
                              <span className="text-xs text-slate-500">Costo unit.:</span>{" "}
                              <span>
                                {Number(h.unit_cost).toLocaleString()} {h.currency || ""}
                              </span>
                            </div>
                          )}
                          {h.notes && (
                            <div>
                              <span className="text-xs text-slate-500">Notas:</span> {h.notes}
                            </div>
                          )}
                        </div>
                      ) : (
                        renderDetail(h)
                      )}
                    </div>
                  </div>
                </div>
              )) : (
                <div className="text-sm text-slate-500">Sin historial</div>
              )}
            </div>
          </div>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="text-left px-3 py-2">Fecha</th>
                <th className="text-left px-3 py-2">Referencia</th>
                <th className="text-left px-3 py-2">Etapa</th>
                <th className="text-left px-3 py-2">Estado</th>
                <th className="text-left px-3 py-2">Tipo</th>
                <th className="text-left px-3 py-2">Detalle</th>
                <th className="text-left px-3 py-2">Costo</th>
                <th className="text-left px-3 py-2">Usuario</th>
              </tr>
            </thead>
            <tbody>
              {timelineRows?.length ? timelineRows.map((h) => (
                <tr key={h.id} className="border-t">
                  <td className="px-3 py-2">{h.created_at?.slice(0,10) || "—"}</td>
                  <td className="px-3 py-2">
                    {h.service_case_id ? (
                      <Link className="text-blue-600 underline" to={`/service/cases/${h.service_case_id}`}>
                        {h.reference || `#${h.service_case_id}`}
                      </Link>
                    ) : (
                      h.reference || `#${h.id}`
                    )}
                  </td>
                  <td className="px-3 py-2">{h.stage_name || "—"}</td>
                  <td className="px-3 py-2">{h.status || "—"}</td>
                  <td className="px-3 py-2">
                    {h.event_type === "piezas"
                      ? "Piezas"
                      : (normalizeWorkTypes(h.work_type).join(", ") || h.work_type || "—")}
                  </td>
                  <td className="px-3 py-2">
                    {h.event_type === "piezas" ? (
                      <div className="space-y-1">
                        <div>
                          <span className="text-xs text-slate-500">Pieza:</span>{" "}
                          <span>{h.part_name}</span>
                        </div>
                        <div>
                          <span className="text-xs text-slate-500">Cantidad:</span>{" "}
                          <span>{h.quantity}</span>
                        </div>
                        {h.unit_cost != null && (
                          <div>
                            <span className="text-xs text-slate-500">Costo unit.:</span>{" "}
                            <span>
                              {Number(h.unit_cost).toLocaleString()} {h.currency || ""}
                            </span>
                          </div>
                        )}
                        {h.notes && (
                          <div>
                            <span className="text-xs text-slate-500">Notas:</span> {h.notes}
                          </div>
                        )}
                      </div>
                    ) : (
                      renderDetail(h)
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {h.cost != null ? Number(h.cost).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2">{h.user_name || "—"}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-center text-slate-500">Sin historial</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
