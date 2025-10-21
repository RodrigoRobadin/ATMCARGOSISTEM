import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api";
import NewOperationModal from "../components/NewOperationModal";

function Badge({ children, color = "slate" }) {
  const map = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-100 text-emerald-700",
    yellow: "bg-amber-100 text-amber-700",
    gray: "bg-gray-100 text-gray-700",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${map[color] || map.slate}`}>
      {children}
    </span>
  );
}
const statusBadge = (s) => {
  if (s === "bloqueado") return <Badge color="yellow">Bloqueado</Badge>;
  if (s === "confirmado") return <Badge color="green">Confirmado</Badge>;
  return <Badge color="gray">Borrador</Badge>;
};

export default function WorkspaceTable() {
  const { key } = useParams();              // p.ej. 'atm-cargo'
  const [bu, setBu] = useState(null);       // business unit actual
  const [pipelineId, setPipelineId] = useState(null);
  const [stages, setStages] = useState([]);
  const [deals, setDeals] = useState([]);
  const [openModal, setOpenModal] = useState(false);
  const [loading, setLoading] = useState(true);

  // Filtros
  const [statusFilter, setStatusFilter] = useState("");      // borrador|bloqueado|confirmado|"" (todos)
  const [advisorFilter, setAdvisorFilter] = useState("");    // user id | ""
  const [advisors, setAdvisors] = useState([]);              // si /users da 403 => []

  // Carga inicial
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // 1) Business units
        const { data: units } = await api.get("/business-units");
        const found = (Array.isArray(units) ? units : []).find((u) => u.key_slug === key);
        setBu(found || null);

        // 2) Pipelines
        const { data: p } = await api.get("/pipelines");
        const pid = Array.isArray(p) && p.length ? p[0].id : null;
        setPipelineId(pid);

        // 3) Stages + Deals (en paralelo)
        if (pid) {
          const [{ data: s }, { data: d }] = await Promise.all([
            api.get(`/pipelines/${pid}/stages`),
            api.get("/deals", {
              params: { pipeline_id: pid, business_unit_id: found?.id },
            }),
          ]);
          setStages(Array.isArray(s) ? s : []);
          setDeals(Array.isArray(d) ? d : []);
        } else {
          setStages([]);
          setDeals([]);
        }

        // 4) Users (opcional — puede devolver 403)
        try {
          const { data: users } = await api.get("/users");
          setAdvisors(Array.isArray(users) ? users : []);
        } catch (e) {
          const status = e?.response?.status;
          console.warn("No se pudo cargar /users:", status || e);
          setAdvisors([]); // ocultamos el filtro de Asesor si no hay permisos
        }
      } catch (e) {
        console.error("Error cargando workspace:", e);
        setStages([]);
        setDeals([]);
        setAdvisors([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [key]);

  // Refresco con filtros
  async function refresh() {
    if (!pipelineId || !bu?.id) return;
    const params = { pipeline_id: pipelineId, business_unit_id: bu.id };
    if (statusFilter)  params.org_budget_status = statusFilter;
    if (advisorFilter) params.deal_advisor_user_id = advisorFilter; // 👈 filtra por asesor de la OPERACIÓN

    try {
      const { data: d } = await api.get("/deals", { params });
      setDeals(Array.isArray(d) ? d : []);
    } catch (e) {
      console.warn("No se pudo refrescar /deals:", e?.response?.status || e);
    }
  }

  // Refrescar cuando cambian los filtros
  useEffect(() => {
    if (!pipelineId || !bu?.id) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, advisorFilter]);

  if (loading) return <div className="text-sm text-slate-600">Cargando…</div>;
  if (!bu) return <div className="text-sm text-slate-600">Workspace no encontrado.</div>;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold">Workspace: {bu.name} (tabla)</h2>
          <p className="text-xs text-slate-500">Pipeline: {pipelineId ?? "—"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/workspace/${key}`}
            className="px-3 py-2 text-sm rounded-lg border hover:bg-slate-50"
          >
            Volver a Kanban
          </Link>
          <button
            onClick={() => setOpenModal(true)}
            className="px-3 py-2 text-sm rounded-lg bg-black text-white"
          >
            ➕ Nueva operación
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl shadow p-3 mb-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block mb-1 text-slate-600">Estado (org)</span>
            <select
              className="border rounded-lg px-3 py-2"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">Todos</option>
              <option value="borrador">Borrador</option>
              <option value="bloqueado">Bloqueado</option>
              <option value="confirmado">Confirmado</option>
            </select>
          </label>

          {/* Mostrar filtro Asesor solo si hay datos */}
          {advisors.length > 0 && (
            <label className="text-sm">
              <span className="block mb-1 text-slate-600">Asesor (operación)</span>
              <select
                className="border rounded-lg px-3 py-2 min-w-[220px]"
                value={advisorFilter}
                onChange={(e) => setAdvisorFilter(e.target.value)}
              >
                <option value="">Todos</option>
                {advisors.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </label>
          )}

          {(statusFilter || advisorFilter) && (
            <button
              className="ml-auto px-3 py-2 text-sm rounded-lg border hover:bg-slate-50"
              onClick={() => { setStatusFilter(""); setAdvisorFilter(""); }}
              title="Limpiar filtros"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto bg-white shadow rounded-xl">
        <table className="min-w-full border-collapse">
          <thead className="bg-slate-100 text-sm text-left">
            <tr>
              <th className="px-4 py-2 border-b">Referencia</th>
              <th className="px-4 py-2 border-b">Descripción</th>
              <th className="px-4 py-2 border-b">Organización</th>
              <th className="px-4 py-2 border-b">Contacto</th>
              <th className="px-4 py-2 border-b">Valor aprox.</th>
              <th className="px-4 py-2 border-b">Etapa</th>
              <th className="px-4 py-2 border-b">Creado</th>
              <th className="px-4 py-2 border-b">Estado</th>
              <th className="px-4 py-2 border-b">Asesor</th>
              <th className="px-4 py-2 border-b">Valor Profit</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {deals.map((d) => {
              const etapa = stages.find((s) => s.id === d.stage_id)?.name || "—";
              const asesor =
                d.deal_advisor_name ||      // asesor de la operación
                d.created_by_name ||        // quien creó
                d.org_advisor_name ||       // asesor de la organización
                "—";

              return (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 border-b">
                    <a
                      href={`/operations/${d.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline"
                      title="Abrir vista de operación"
                    >
                      {d.reference ?? d.title ?? "—"}
                    </a>
                  </td>
                  <td className="px-4 py-2 border-b">{d.title || "—"}</td>
                  <td className="px-4 py-2 border-b">{d.org_name || "—"}</td>
                  <td className="px-4 py-2 border-b">{d.contact_name || "—"}</td>
                  <td className="px-4 py-2 border-b">
                    ${Number(d.value || 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 border-b">{etapa}</td>
                  <td className="px-4 py-2 border-b">
                    {d.created_at ? new Date(d.created_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-2 border-b">{statusBadge(d.org_budget_status)}</td>
                  <td className="px-4 py-2 border-b">{asesor}</td>
                  <td className="px-4 py-2 border-b">
                    {typeof d.org_budget_profit_value === "number"
                      ? `$${Number(d.org_budget_profit_value).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`
                      : "—"}
                  </td>
                </tr>
              );
            })}
            {!deals.length && (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-slate-500">
                  No hay operaciones en este workspace.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {openModal && (
        <NewOperationModal
          onClose={() => setOpenModal(false)}
          pipelineId={pipelineId}
          stages={stages}
          defaultBusinessUnitId={bu.id}
          onCreated={async () => {
            await refresh();
            setOpenModal(false);
          }}
        />
      )}
    </div>
  );
}
