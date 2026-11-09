import React, { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "../api";
import AddDealModal from "../components/AddDealModal";

export default function General() {
  const [pipelineId, setPipelineId] = useState(null);
  const [stages, setStages] = useState([]);
  const [deals, setDeals] = useState([]);
  const [businessUnits, setBusinessUnits] = useState([]);
  const [selectedBU, setSelectedBU] = useState(""); // '' = todos
  const [openModal, setOpenModal] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadAll(pid, buId = "") {
    const [{ data: s }, { data: d }] = await Promise.all([
      api.get(`/pipelines/${pid}/stages`),
      api.get("/deals", {
        params: { pipeline_id: pid, business_unit_id: buId || undefined, commercial_outcome: "active" },
      }),
    ]);
    setStages(s);
    setDeals(d);
  }

  useEffect(() => {
    (async () => {
      const { data: p } = await api.get("/pipelines");
      const pid = p?.[0]?.id;
      setPipelineId(pid);

      const { data: bu } = await api.get("/business-units");
      setBusinessUnits(bu);

      await loadAll(pid);
      setLoading(false);
    })();
  }, []);

  async function onChangeBU(e) {
    const buId = e.target.value;
    setSelectedBU(buId);
    if (pipelineId) await loadAll(pipelineId, buId);
  }

  if (loading) return <div className="text-sm text-slate-600">Cargando…</div>;

  return (
    <div className="atm-general min-w-0 space-y-5">
      <header className="atm-page-heading flex-wrap">
        <div>
          <h1>Vista general</h1>
          <p className="atm-page-subtitle">Operaciones comerciales</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Unidad de negocio"
            className="atm-general-filter"
            value={selectedBU}
            onChange={onChangeBU}
          >
            <option value="">Todos los negocios</option>
            {businessUnits.map((b) => (
              <option key={b.id} value={b.id}>
                {b.parent_id ? "— " : ""}
                {b.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setOpenModal(true)}
            className="atm-primary inline-flex min-h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold"
          >
            <Plus size={17} /> Nueva operación
          </button>
        </div>
      </header>

      <div className="atm-general-count">{deals.length} {deals.length === 1 ? "operación" : "operaciones"}</div>
      <div className="atm-general-table overflow-x-auto">
        <table className="w-full min-w-[940px] border-collapse text-sm">
          <thead className="text-left">
            <tr>
              <th className="px-4 py-2 border-b">ID</th>
              <th className="px-4 py-2 border-b">Unidad de negocio</th>
              <th className="px-4 py-2 border-b">Referencia</th>
              <th className="px-4 py-2 border-b">Organización</th>
              <th className="px-4 py-2 border-b">Contacto</th>
              <th className="px-4 py-2 border-b">Valor</th>
              <th className="px-4 py-2 border-b">Etapa</th>
              <th className="px-4 py-2 border-b">Creado</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((d) => {
              const etapa = stages.find((s) => s.id === d.stage_id)?.name || "—";
              return (
                <tr key={d.id}>
                  <td className="px-4 py-2 border-b">{d.id}</td>
                  <td className="px-4 py-2 border-b">{d.business_unit_name || "—"}</td>
                  <td className="px-4 py-2 border-b font-semibold">{d.title}</td>
                  <td className="px-4 py-2 border-b">{d.org_name || "—"}</td>
                  <td className="px-4 py-2 border-b">{d.contact_name || "—"}</td>
                  <td className="px-4 py-2 border-b whitespace-nowrap tabular-nums">
                    ${Number(d.value || 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 border-b">{etapa}</td>
                  <td className="px-4 py-2 border-b">
                    {d.created_at
                      ? new Date(d.created_at).toLocaleDateString()
                      : "—"}
                  </td>
                </tr>
              );
            })}
            {!deals.length && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                  No hay operaciones para este filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {openModal && (
        <AddDealModal
          onClose={() => setOpenModal(false)}
          pipelineId={pipelineId}
          stages={stages}
          defaultBusinessUnitId={selectedBU || undefined}
          onCreated={() => loadAll(pipelineId, selectedBU)}
        />
      )}
    </div>
  );
}
