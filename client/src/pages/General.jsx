import React, { useEffect, useState } from "react";
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
      api.get("/deals", { params: { pipeline_id: pid, business_unit_id: buId || undefined } }),
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
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Vista general</h2>
          <p className="text-xs text-slate-500">Pipeline: {pipelineId ?? "—"}</p>
        </div>

        <div className="flex items-center gap-2">
          <select
            className="border rounded-lg px-3 py-2 text-sm"
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
            onClick={() => setOpenModal(true)}
            className="px-3 py-2 text-sm rounded-lg bg-black text-white"
          >
            ➕ Nuevo Deal
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto bg-white shadow rounded-xl">
        <table className="min-w-full border-collapse">
          <thead className="bg-slate-100 text-sm text-left">
            <tr>
              <th className="px-4 py-2 border-b">ID</th>
              <th className="px-4 py-2 border-b">Unidad de Negocio</th>
              <th className="px-4 py-2 border-b">Referencia</th>
              <th className="px-4 py-2 border-b">Organización</th>
              <th className="px-4 py-2 border-b">Contacto</th>
              <th className="px-4 py-2 border-b">Valor</th>
              <th className="px-4 py-2 border-b">Etapa</th>
              <th className="px-4 py-2 border-b">Creado</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {deals.map((d) => {
              const etapa = stages.find((s) => s.id === d.stage_id)?.name || "—";
              return (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 border-b">{d.id}</td>
                  <td className="px-4 py-2 border-b">{d.business_unit_name || "—"}</td>
                  <td className="px-4 py-2 border-b">{d.title}</td>
                  <td className="px-4 py-2 border-b">{d.org_name || "—"}</td>
                  <td className="px-4 py-2 border-b">{d.contact_name || "—"}</td>
                  <td className="px-4 py-2 border-b">
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
                  No hay deals para este filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
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
