import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";

const Input = (props) => (
  <input
    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
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

function OrganizationAutocomplete({
  label,
  value,
  onChange,
  placeholder = "Buscar organización...",
}) {
  const [query, setQuery] = useState(value?.name || "");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(query, 250);
  const boxRef = useRef(null);

  useEffect(() => {
    setQuery(value?.name || "");
  }, [value?.id, value?.name]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (boxRef.current && !boxRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
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
        const rows = Array.isArray(data?.organizations) ? data.organizations : [];
        setResults(rows);
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
          setQuery(next);
          setOpen(true);
          if (!next.trim()) {
            onChange(null);
          } else if (value?.id && next.trim() !== String(value.name || "").trim()) {
            onChange(null);
          }
        }}
      />
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border bg-white shadow-lg max-h-56 overflow-auto">
          {results.map((org) => (
            <button
              key={org.id}
              type="button"
              className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
              onClick={() => {
                onChange(org);
                setQuery(org.name || "");
                setOpen(false);
              }}
            >
              {org.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NewContainerOperationModal({
  onClose,
  pipelineId,
  stages,
  onCreated,
  defaultBusinessUnitId,
}) {
  const emptyTrackedUnit = () => ({
    container_no: "",
    container_type: "",
    status: "activo",
    delivered_at: "",
    notes: "",
  });

  const [creationMode, setCreationMode] = useState("commercial");
  const [stageId, setStageId] = useState(stages?.[0]?.id || "");
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [selectedContactId, setSelectedContactId] = useState("");
  const [providerOrg, setProviderOrg] = useState(null);
  const [lessorOrg, setLessorOrg] = useState(null);
  const [title, setTitle] = useState("");
  const [requestSummary, setRequestSummary] = useState("");
  const [deliveryLocation, setDeliveryLocation] = useState("");
  const [contractNo, setContractNo] = useState("");
  const [monthlyCurrency, setMonthlyCurrency] = useState("PYG");
  const [monthlyAmount, setMonthlyAmount] = useState("");
  const [trackedUnits, setTrackedUnits] = useState([emptyTrackedUnit()]);
  const [manualContactName, setManualContactName] = useState("");
  const [manualContactEmail, setManualContactEmail] = useState("");
  const [manualContactPhone, setManualContactPhone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStageId(stages?.[0]?.id || "");
  }, [stages]);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!selectedOrg?.id) {
        setContacts([]);
        setSelectedContactId("");
        return;
      }
      try {
        const { data } = await api.get(`/organizations/${selectedOrg.id}/contacts`);
        if (!live) return;
        setContacts(Array.isArray(data) ? data : []);
      } catch {
        if (live) setContacts([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [selectedOrg?.id]);

  const selectedContact = useMemo(
    () => contacts.find((item) => String(item.id) === String(selectedContactId)) || null,
    [contacts, selectedContactId]
  );

  const isActiveRentalMode = creationMode === "active_rental";

  function updateTrackedUnit(index, patch) {
    setTrackedUnits((prev) =>
      prev.map((row, idx) => (idx === index ? { ...row, ...patch } : row))
    );
  }

  function addTrackedUnit() {
    setTrackedUnits((prev) => [...prev, emptyTrackedUnit()]);
  }

  function removeTrackedUnit(index) {
    setTrackedUnits((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== index)));
  }

  async function handleSave() {
    if (!pipelineId || !stageId) {
      alert("Falta pipeline o etapa.");
      return;
    }
    if (!selectedOrg?.name && !title.trim()) {
      alert("Selecciona un cliente o carga un titulo.");
      return;
    }

    const normalizedUnits = trackedUnits
      .map((row) => ({
        container_no: String(row.container_no || "").trim(),
        container_type: String(row.container_type || "").trim(),
        status: String(row.status || "activo").trim() || "activo",
        delivered_at: row.delivered_at || null,
        notes: String(row.notes || "").trim(),
      }))
      .filter((row) => row.container_no || row.container_type || row.delivered_at || row.notes);

    if (isActiveRentalMode) {
      if (!deliveryLocation.trim()) {
        alert("Carga el lugar de entrega para el seguimiento del alquiler activo.");
        return;
      }
      if (!normalizedUnits.length) {
        alert("Agrega al menos un contenedor alquilado.");
        return;
      }
      if (!normalizedUnits.every((row) => row.delivered_at)) {
        alert("Cada contenedor alquilado debe tener fecha de entrega.");
        return;
      }
      if (!(Number(monthlyAmount) > 0)) {
        alert("Carg?? el monto mensual del alquiler.");
        return;
      }
    }

    setSaving(true);
    try {
      const dealTitle =
        title.trim() ||
        (isActiveRentalMode
          ? `Seguimiento alquiler - ${selectedOrg?.name || "ATM CONTAINER"}`
          : "") ||
        requestSummary.trim() ||
        `Container - ${selectedOrg?.name || "Operacion"}`;

      const dealPayload = {
        pipeline_id: pipelineId,
        stage_id: stageId,
        business_unit_id: defaultBusinessUnitId || null,
        title: dealTitle,
        value: 0,
        organization: selectedOrg
          ? { id: selectedOrg.id, name: selectedOrg.name }
          : null,
        org_name: selectedOrg?.name || null,
        contact: selectedContact
          ? {
              id: selectedContact.id,
              name: selectedContact.name,
              email: selectedContact.email,
              phone: selectedContact.phone,
            }
          : null,
        contact_name: selectedContact?.name || manualContactName || null,
        contact_email: selectedContact?.email || manualContactEmail || null,
        contact_phone: selectedContact?.phone || manualContactPhone || null,
      };

      const { data } = await api.post("/deals", dealPayload);
      const dealId = data?.id;
      if (!dealId) throw new Error("No se pudo crear la operacion");

      await api.put(`/container/deals/${dealId}`, {
        provider_id: providerOrg?.id || null,
        lessor_org_id: lessorOrg?.id || null,
        delivery_location: deliveryLocation || null,
        request_summary: requestSummary || null,
        internal_status: isActiveRentalMode ? "activo" : "pendiente",
        notes: isActiveRentalMode
          ? `Alta de seguimiento de alquiler activo${contractNo.trim() ? ` - Contrato ${contractNo.trim()}` : ""}`
          : null,
      });

      let createdUnits = [];
      if (isActiveRentalMode && normalizedUnits.length) {
        createdUnits = await Promise.all(
          normalizedUnits.map(async (row) => {
            const { data: unit } = await api.post(`/container/deals/${dealId}/units`, row);
            return unit;
          })
        );
      }

      if (isActiveRentalMode && createdUnits.length) {
        const unitIds = createdUnits.map((row) => Number(row.id)).filter(Boolean);
        const { data: contract } = await api.post(`/container/deals/${dealId}/contracts`, {
          contract_no: contractNo.trim() || null,
          currency_code: monthlyCurrency,
          title: `Contrato activo ${selectedOrg?.name || ""}`.trim(),
          unit_ids: unitIds,
        });

        if (contract?.contract?.id) {
          await api.put(`/container/contracts/${contract.contract.id}`, {
            contract: {
              ...contract.contract,
              status: "vigente",
              contract_no: contractNo.trim() || contract.contract.contract_no,
              currency_code: monthlyCurrency,
              title: contract.contract.title || `Contrato activo ${selectedOrg?.name || ""}`.trim(),
              lessor_org_id: lessorOrg?.id || contract.contract.lessor_org_id || null,
              lessee_org_id: selectedOrg?.id || contract.contract.lessee_org_id || null,
              effective_from:
                normalizedUnits
                  .map((row) => row.delivered_at)
                  .filter(Boolean)
                  .sort()[0] || null,
            },
            units: createdUnits.map((row, index) => ({
              container_unit_id: row.id,
              line_order: index + 1,
            })),
            lines: [
              {
                line_type: "alquiler",
                description: "Alquiler",
                amount: Number(monthlyAmount) || 0,
                currency_code: monthlyCurrency,
                line_order: 1,
              },
              {
                line_type: "flete",
                description: "Flete",
                amount: 0,
                currency_code: monthlyCurrency,
                line_order: 2,
              },
              {
                line_type: "garantia",
                description: "Garantia",
                amount: 0,
                currency_code: monthlyCurrency,
                line_order: 3,
              },
            ],
          });
        }
      }

      if (typeof onCreated === "function") {
        await onCreated(data);
      }
    } catch (err) {
      console.error("create container op", err);
      alert(err?.response?.data?.error || "No se pudo crear la operacion ATM CONTAINER");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/35 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl max-h-[calc(100vh-2rem)] rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div>
            <div className="text-lg font-semibold">Nueva operación ATM CONTAINER</div>
            <div className="text-sm text-slate-500">
              Alta comercial inicial con proveedor, locador y datos de entrega.
            </div>
          </div>
          <button type="button" className="text-sm underline" onClick={onClose}>
            Cerrar
          </button>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5 overflow-y-auto min-h-0">
          <div className="md:col-span-2 rounded-2xl border p-4 space-y-3">
            <div className="font-semibold">Modo de alta</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                type="button"
                className={`rounded-xl border px-4 py-3 text-left ${!isActiveRentalMode ? "border-black bg-slate-50" : "border-slate-200"}`}
                onClick={() => setCreationMode("commercial")}
              >
                <div className="font-medium">Operacion nueva</div>
                <div className="text-sm text-slate-500">Parte desde el circuito comercial normal.</div>
              </button>
              <button
                type="button"
                className={`rounded-xl border px-4 py-3 text-left ${isActiveRentalMode ? "border-black bg-slate-50" : "border-slate-200"}`}
                onClick={() => setCreationMode("active_rental")}
              >
                <div className="font-medium">Seguimiento de alquiler activo</div>
                <div className="text-sm text-slate-500">Carga un contrato ya alquilado para seguir contenedores, contrato y mensualidades.</div>
              </button>
            </div>
          </div>

          <div className="rounded-2xl border p-4 space-y-3">
            <div className="font-semibold">Cliente</div>
            <OrganizationAutocomplete
              label="Organización"
              value={selectedOrg}
              onChange={setSelectedOrg}
              placeholder="Buscar cliente..."
            />

            <div>
              <div className="text-xs text-slate-600 mb-1">Contacto</div>
              <Select
                value={selectedContactId}
                onChange={(e) => setSelectedContactId(e.target.value)}
              >
                <option value="">Sin contacto seleccionado</option>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </Select>
            </div>

            {!selectedContact && (
              <>
                <Input
                  placeholder="Nombre del contacto"
                  value={manualContactName}
                  onChange={(e) => setManualContactName(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    placeholder="Teléfono"
                    value={manualContactPhone}
                    onChange={(e) => setManualContactPhone(e.target.value)}
                  />
                  <Input
                    placeholder="Email"
                    value={manualContactEmail}
                    onChange={(e) => setManualContactEmail(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>

          <div className="rounded-2xl border p-4 space-y-3">
            <div className="font-semibold">Operación</div>
            <div>
              <div className="text-xs text-slate-600 mb-1">Etapa</div>
              <Select value={stageId} onChange={(e) => setStageId(e.target.value)}>
                {(stages || []).map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </Select>
            </div>
            <Input
              placeholder="Título de la operación"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <OrganizationAutocomplete
              label="Proveedor"
              value={providerOrg}
              onChange={setProviderOrg}
              placeholder="Buscar proveedor..."
            />
            <OrganizationAutocomplete
              label="Locador"
              value={lessorOrg}
              onChange={setLessorOrg}
              placeholder="Buscar locador..."
            />
            <Input
              placeholder="Lugar de entrega"
              value={deliveryLocation}
              onChange={(e) => setDeliveryLocation(e.target.value)}
            />
          </div>

          <div className="md:col-span-2 rounded-2xl border p-4 space-y-2">
            <div className="font-semibold">Resumen del pedido</div>
            <textarea
              className="w-full min-h-[140px] border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
              placeholder="Detalle comercial inicial del requerimiento..."
              value={requestSummary}
              onChange={(e) => setRequestSummary(e.target.value)}
            />
          </div>

          {isActiveRentalMode && (
            <div className="md:col-span-2 rounded-2xl border p-4 space-y-4">
              <div>
                <div className="font-semibold">Alquiler activo</div>
                <div className="text-sm text-slate-500">
                  Esto crea la operacion, registra los contenedores ya entregados y deja un contrato vigente base para seguimiento.
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input
                  placeholder="Nro de contrato"
                  value={contractNo}
                  onChange={(e) => setContractNo(e.target.value)}
                />
                <Select value={monthlyCurrency} onChange={(e) => setMonthlyCurrency(e.target.value)}>
                  <option value="PYG">PYG</option>
                  <option value="USD">USD</option>
                </Select>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Monto mensual de alquiler"
                  value={monthlyAmount}
                  onChange={(e) => setMonthlyAmount(e.target.value)}
                />
              </div>

              <div className="space-y-3">
                <div className="font-medium text-sm">Contenedores alquilados</div>
                {trackedUnits.map((row, index) => (
                  <div key={index} className="rounded-xl border p-3 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <Input
                        placeholder="Nro contenedor"
                        value={row.container_no}
                        onChange={(e) => updateTrackedUnit(index, { container_no: e.target.value })}
                      />
                      <Select
                        value={row.container_type}
                        onChange={(e) => updateTrackedUnit(index, { container_type: e.target.value })}
                      >
                        <option value="">Tipo de contenedor</option>
                        <option value="20 ST">20 ST</option>
                        <option value="40 ST">40 ST</option>
                        <option value="20 RF">20 RF</option>
                        <option value="40 RF">40 RF</option>
                      </Select>
                      <Input
                        type="date"
                        value={row.delivered_at}
                        onChange={(e) => updateTrackedUnit(index, { delivered_at: e.target.value })}
                      />
                      <Select
                        value={row.status}
                        onChange={(e) => updateTrackedUnit(index, { status: e.target.value })}
                      >
                        <option value="activo">Activo</option>
                        <option value="entregado">Entregado</option>
                        <option value="instalado">Instalado</option>
                        <option value="reservado">Reservado</option>
                      </Select>
                    </div>
                    <div className="flex items-center gap-3">
                      <Input
                        placeholder="Observaciones del contenedor"
                        value={row.notes}
                        onChange={(e) => updateTrackedUnit(index, { notes: e.target.value })}
                      />
                      <button
                        type="button"
                        className="px-3 py-2 rounded-lg border text-sm disabled:opacity-50"
                        onClick={() => removeTrackedUnit(index)}
                        disabled={trackedUnits.length <= 1}
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg border text-sm"
                  onClick={addTrackedUnit}
                >
                  + Agregar contenedor
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            className="px-4 py-2 rounded-lg border text-sm"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-black text-white text-sm disabled:opacity-60"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Guardando..." : "Crear operación"}
          </button>
        </div>
      </div>
    </div>
  );
}
