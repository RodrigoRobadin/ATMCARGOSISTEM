import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import QuoteEditor from "./QuoteEditor";
import ContainerContractsPanel from "../components/container/ContainerContractsPanel";
import ContainerServicesPanel from "../components/container/ContainerServicesPanel";
import ContainerAlertsPanel from "../components/container/ContainerAlertsPanel";
import ContainerBillingPanel from "../components/container/ContainerBillingPanel";

const TABS = [
  { key: "detail", label: "Detalle" },
  { key: "containers", label: "Contenedores" },
  { key: "quote", label: "Detalle de oferta" },
  { key: "contracts", label: "Contratos" },
  { key: "billing", label: "Facturacion mensual" },
  { key: "service", label: "Servicio técnico" },
  { key: "alerts", label: "Alertas" },
];

const CONTAINER_TYPES = ["20 ST", "40 ST", "20 RF", "40 RF"];
const CONTAINER_STATUSES = [
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

const Input = ({ readOnly, ...props }) => (
  <input
    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10 ${
      readOnly ? "bg-slate-50 cursor-not-allowed" : ""
    }`}
    readOnly={readOnly}
    {...props}
  />
);

const Select = ({ children, ...props }) => (
  <select
    className="w-full border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/10"
    {...props}
  >
    {children}
  </select>
);

function useDebounced(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}

function OrgAutocomplete({ label, selected, onSelect, placeholder, query, onQueryChange }) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(query, 250);
  const boxRef = useRef(null);

  useEffect(() => {
    function closeIfOutside(event) {
      if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", closeIfOutside);
    return () => document.removeEventListener("mousedown", closeIfOutside);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const q = String(debounced || "").trim();
      if (!q) {
        if (live) setResults([]);
        return;
      }
      try {
        const { data } = await api.get("/search", { params: { q } });
        if (!live) return;
        setResults(Array.isArray(data?.organizations) ? data.organizations : []);
      } catch {
        if (live) setResults([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [debounced]);

  return (
    <div className="relative" ref={boxRef}>
      <div className="text-xs text-slate-600 mb-1">{label}</div>
      <Input
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          const next = e.target.value;
          onQueryChange(next);
          setOpen(true);
          if (!next.trim()) {
            onSelect(null);
          } else if (selected?.id && next.trim() !== String(selected.name || "").trim()) {
            onSelect(null);
          }
        }}
      />
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border bg-white shadow-lg max-h-56 overflow-auto">
          {results.map((row) => (
            <button
              key={row.id}
              type="button"
              className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
              onClick={() => {
                onSelect(row);
                onQueryChange(row.name || "");
                setOpen(false);
              }}
            >
              {row.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PlaceholderPane({ title, text }) {
  return (
    <div className="rounded-2xl border bg-white p-5">
      <div className="font-semibold">{title}</div>
      <div className="text-sm text-slate-500 mt-2">{text}</div>
    </div>
  );
}

export default function OperationDetailContainer() {
  const { id } = useParams();
  const [activeTab, setActiveTab] = useState("detail");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deal, setDeal] = useState(null);
  const [units, setUnits] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [selectedLessor, setSelectedLessor] = useState(null);
  const [providerQuery, setProviderQuery] = useState("");
  const [lessorQuery, setLessorQuery] = useState("");
  const [form, setForm] = useState({
    title: "",
    delivery_location: "",
    request_summary: "",
    internal_status: "pendiente",
    notes: "",
  });

  async function loadData() {
    setLoading(true);
    try {
      const [{ data: dealData }, { data: metaData }, { data: unitData }] = await Promise.all([
        api.get(`/deals/${id}`),
        api.get(`/container/deals/${id}`),
        api.get(`/container/deals/${id}/units`),
      ]);
      const nextDeal = dealData?.deal || null;
      setDeal(nextDeal);
      setUnits(Array.isArray(unitData) ? unitData : []);
      setSelectedProvider(
        metaData?.provider_id
          ? { id: metaData.provider_id, name: metaData.provider_name || "" }
          : null
      );
      setProviderQuery(metaData?.provider_name || "");
      setSelectedLessor(
        metaData?.lessor_org_id
          ? { id: metaData.lessor_org_id, name: metaData.lessor_name || "" }
          : null
      );
      setLessorQuery(metaData?.lessor_name || "");
      setForm({
        title: nextDeal?.title || "",
        delivery_location: metaData?.delivery_location || "",
        request_summary: metaData?.request_summary || "",
        internal_status: metaData?.internal_status || "pendiente",
        notes: metaData?.notes || "",
      });
    } catch (err) {
      console.error("load container operation", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [id]);

  async function resolveOrganizationSelection(query, selected) {
    if (selected?.id) return selected;
    const q = String(query || "").trim();
    if (!q) return null;
    const { data } = await api.get("/organizations", { params: { q, limit: 10 } });
    const rows = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    if (!rows.length) {
      throw new Error(`No se encontró la organización "${q}".`);
    }
    const normalized = q.toLowerCase();
    const exact =
      rows.find((row) => String(row.name || "").toLowerCase() === normalized) ||
      rows.find((row) => String(row.razon_social || "").toLowerCase() === normalized) ||
      rows.find((row) => String(row.ruc || "").toLowerCase() === normalized);
    if (exact) return { id: exact.id, name: exact.name || exact.razon_social || q };
    if (rows.length === 1) {
      const row = rows[0];
      return { id: row.id, name: row.name || row.razon_social || q };
    }
    throw new Error(`Seleccioná "${q}" desde la lista para evitar duplicados o ambigüedad.`);
  }

  async function saveDetail() {
    setSaving(true);
    try {
      const resolvedProvider = await resolveOrganizationSelection(providerQuery, selectedProvider);
      const resolvedLessor = await resolveOrganizationSelection(lessorQuery, selectedLessor);
      setSelectedProvider(resolvedProvider);
      setSelectedLessor(resolvedLessor);
      setProviderQuery(resolvedProvider?.name || "");
      setLessorQuery(resolvedLessor?.name || "");
      await api.patch(`/deals/${id}`, { title: form.title });
      await api.put(`/container/deals/${id}`, {
        provider_id: resolvedProvider?.id || null,
        lessor_org_id: resolvedLessor?.id || null,
        delivery_location: form.delivery_location || null,
        request_summary: form.request_summary || null,
        internal_status: form.internal_status || "pendiente",
        notes: form.notes || null,
      });
      setDeal((prev) => (prev ? { ...prev, title: form.title } : prev));
      await loadData();
    } catch (err) {
      console.error("save container detail", err);
      alert(err?.response?.data?.error || err?.message || "No se pudo guardar el detalle.");
    } finally {
      setSaving(false);
    }
  }

  async function addUnit() {
    try {
      const { data } = await api.post(`/container/deals/${id}/units`, {
        status: "pendiente_confirmacion",
      });
      setUnits((prev) => [...prev, data]);
      setActiveTab("containers");
    } catch (err) {
      console.error("add container unit", err);
      alert(err?.response?.data?.error || "No se pudo agregar el contenedor.");
    }
  }

  async function saveUnit(unit) {
    try {
      const { data } = await api.put(`/container/units/${unit.id}`, unit);
      setUnits((prev) => prev.map((row) => (row.id === unit.id ? data : row)));
    } catch (err) {
      console.error("save container unit", err);
      alert(err?.response?.data?.error || "No se pudo guardar el contenedor.");
    }
  }

  async function removeUnit(unitId) {
    if (!window.confirm("¿Eliminar este contenedor de la operación?")) return;
    try {
      await api.delete(`/container/units/${unitId}`);
      setUnits((prev) => prev.filter((row) => row.id !== unitId));
    } catch (err) {
      console.error("delete container unit", err);
      alert(err?.response?.data?.error || "No se pudo eliminar el contenedor.");
    }
  }

  const containerSummary = useMemo(() => {
    if (!units.length) return "Sin contenedores confirmados";
    const byType = units.reduce((acc, row) => {
      const key = row.container_type || "Sin tipo";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(byType)
      .map(([type, qty]) => `${qty} x ${type}`)
      .join(" • ");
  }, [units]);

  if (loading) return <div className="text-sm text-slate-600">Cargando...</div>;
  if (!deal) {
    return <div className="text-sm text-red-600">Operación ATM CONTAINER no encontrada.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border bg-white px-5 py-4 flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Vista de operación
          </div>
          <div className="text-[2rem] font-semibold leading-none mt-1">
            {deal.reference}{" "}
            <span className="text-slate-700 text-[1.75rem]">
              {form.title || deal.title}
            </span>
          </div>
          <div className="mt-2 text-sm text-slate-600">
            Cliente:{" "}
            {deal.org_id ? (
              <Link className="text-blue-700 underline" to={`/organizations/${deal.org_id}`}>
                {deal.org_name || "Sin organización"}
              </Link>
            ) : (
              deal.org_name || "Sin organización"
            )}
            {deal.contact_name ? ` • Contacto: ${deal.contact_name}` : ""}
          </div>
          <div className="mt-2 text-sm text-slate-700">
            {selectedProvider?.name ? `Proveedor: ${selectedProvider.name}` : "Proveedor pendiente"}
            {" • "}
            {selectedLessor?.name ? `Locador: ${selectedLessor.name}` : "Locador pendiente"}
            {" • "}
            {containerSummary}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="px-4 py-2 rounded-xl border text-sm" onClick={addUnit}>
            + Contenedor
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded-xl bg-black text-white text-sm disabled:opacity-60"
            onClick={saveDetail}
            disabled={saving}
          >
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`px-4 py-2 rounded-xl border text-sm ${
              activeTab === tab.key ? "bg-black text-white border-black" : "bg-white"
            }`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "detail" && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="rounded-2xl border bg-white p-5 space-y-3">
            <div className="font-semibold">Detalle comercial</div>
            <div>
              <div className="text-xs text-slate-600 mb-1">Título</div>
              <Input
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              />
            </div>
            <OrgAutocomplete
              label="Proveedor"
              selected={selectedProvider}
              onSelect={(row) => {
                setSelectedProvider(row);
                setProviderQuery(row?.name || "");
              }}
              query={providerQuery}
              onQueryChange={setProviderQuery}
              placeholder="Buscar proveedor..."
            />
            <OrgAutocomplete
              label="Locador"
              selected={selectedLessor}
              onSelect={(row) => {
                setSelectedLessor(row);
                setLessorQuery(row?.name || "");
              }}
              query={lessorQuery}
              onQueryChange={setLessorQuery}
              placeholder="Buscar locador..."
            />
            <div>
              <div className="text-xs text-slate-600 mb-1">Estado interno</div>
              <Select
                value={form.internal_status}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, internal_status: e.target.value }))
                }
              >
                <option value="pendiente">pendiente</option>
                <option value="cotizando">cotizando</option>
                <option value="confirmado">confirmado</option>
                <option value="activo">activo</option>
                <option value="cerrado">cerrado</option>
              </Select>
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-5 space-y-3">
            <div className="font-semibold">Operación</div>
            <div>
              <div className="text-xs text-slate-600 mb-1">Lugar de entrega</div>
              <Input
                value={form.delivery_location}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, delivery_location: e.target.value }))
                }
              />
            </div>
            <div>
              <div className="text-xs text-slate-600 mb-1">Resumen del pedido</div>
              <textarea
                className="w-full min-h-[140px] border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                value={form.request_summary}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, request_summary: e.target.value }))
                }
              />
            </div>
            <div>
              <div className="text-xs text-slate-600 mb-1">Observaciones</div>
              <textarea
                className="w-full min-h-[100px] border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                value={form.notes}
                onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              />
            </div>
          </div>
        </div>
      )}

      {activeTab === "containers" && (
        <div className="rounded-2xl border bg-white overflow-hidden">
          <div className="px-5 py-4 border-b flex items-center justify-between">
            <div>
              <div className="font-semibold">Contenedores</div>
              <div className="text-sm text-slate-500">
                Confirmación, entrega real y estado operativo por contenedor.
              </div>
            </div>
            <button type="button" className="px-4 py-2 rounded-xl border text-sm" onClick={addUnit}>
              + Agregar
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left">Nro contenedor</th>
                  <th className="px-3 py-2 text-left">Tipo</th>
                  <th className="px-3 py-2 text-left">Estado</th>
                  <th className="px-3 py-2 text-left">Entrega</th>
                  <th className="px-3 py-2 text-left">Retiro</th>
                  <th className="px-3 py-2 text-left">Notas</th>
                  <th className="px-3 py-2 text-left">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {units.map((unit) => (
                  <tr key={unit.id} className="border-t align-top">
                    <td className="px-3 py-2">
                      <Input
                        value={unit.container_no || ""}
                        onChange={(e) =>
                          setUnits((prev) =>
                            prev.map((row) =>
                              row.id === unit.id
                                ? { ...row, container_no: e.target.value }
                                : row
                            )
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Select
                        value={unit.container_type || ""}
                        onChange={(e) =>
                          setUnits((prev) =>
                            prev.map((row) =>
                              row.id === unit.id
                                ? { ...row, container_type: e.target.value }
                                : row
                            )
                          )
                        }
                      >
                        <option value="">Elegir...</option>
                        {CONTAINER_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      <Select
                        value={unit.status || "pendiente_confirmacion"}
                        onChange={(e) =>
                          setUnits((prev) =>
                            prev.map((row) =>
                              row.id === unit.id ? { ...row, status: e.target.value } : row
                            )
                          )
                        }
                      >
                        {CONTAINER_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="date"
                        value={unit.delivered_at || ""}
                        onChange={(e) =>
                          setUnits((prev) =>
                            prev.map((row) =>
                              row.id === unit.id
                                ? { ...row, delivered_at: e.target.value }
                                : row
                            )
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="date"
                        value={unit.removed_at || ""}
                        onChange={(e) =>
                          setUnits((prev) =>
                            prev.map((row) =>
                              row.id === unit.id
                                ? { ...row, removed_at: e.target.value }
                                : row
                            )
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2 min-w-[260px]">
                      <textarea
                        className="w-full min-h-[84px] border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                        value={unit.notes || ""}
                        onChange={(e) =>
                          setUnits((prev) =>
                            prev.map((row) =>
                              row.id === unit.id ? { ...row, notes: e.target.value } : row
                            )
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          className="px-3 py-2 rounded-lg border text-sm"
                          onClick={() => saveUnit(unit)}
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          className="px-3 py-2 rounded-lg border text-sm"
                          onClick={() => removeUnit(unit.id)}
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!units.length && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      No hay contenedores cargados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "quote" && (
        <QuoteEditor embedded dealId={Number(id)} key={`container-quote-${id}`} />
      )}
      {activeTab === "contracts" && (
        <ContainerContractsPanel
          dealId={Number(id)}
          dealReference={deal.reference}
          dealOrgName={deal.org_name}
          units={units}
        />
      )}
      {activeTab === "billing" && (
        <ContainerBillingPanel dealId={Number(id)} />
      )}
      {activeTab === "service" && (
        <ContainerServicesPanel dealId={Number(id)} units={units} />
      )}
      {activeTab === "alerts" && (
        <ContainerAlertsPanel dealId={Number(id)} />
      )}
    </div>
  );
}
