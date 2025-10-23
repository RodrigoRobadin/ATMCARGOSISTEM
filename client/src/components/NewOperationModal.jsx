// client/src/components/NewOperationModal.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import useParamOptions from "../hooks/useParamOptions";

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

// Tipos de carga por modalidad
const LOAD_TYPES = {
  AEREO: ["LCL"],
  MARITIMO: ["FCL", "LCL"],
  TERRESTRE: ["FTL", "LTL"],
  MULTIMODAL: ["N/A"],
};

// Fallback para Tipo de operación
const OP_TYPE_FALLBACK = [
  { value: "IMPORT", label: "Importación" },
  { value: "EXPORT", label: "Exportación" },
  { value: "EXTERIOR", label: "Exterior" },
];

// Helpers de labels
const OP_LABELS = {
  IMPORT: "Importación",
  EXPORT: "Exportación",
  EXTERIOR: "Exterior",
};
const opLabel = (v) => OP_LABELS[v] || v || "";

// Normalizador robusto para options de tipo de operación
function normalizeOpTypeOptions(raw) {
  // raw puede venir como:
  // - array de strings ["IMPORT","EXPORT",...]
  // - array de objetos {value,label} o {key,label}
  // - objeto { operation_type: [...] }
  let src = raw;
  if (raw && raw.operation_type) src = raw.operation_type;
  if (Array.isArray(src)) {
    const mapped = src
      .map((o) => {
        if (!o) return null;
        if (typeof o === "string") {
          return { value: o, label: opLabel(o) };
        }
        if (typeof o === "object") {
          const v = o.value ?? o.key ?? o.code ?? null;
          const l = o.label ?? opLabel(v);
          if (!v) return null;
          return { value: String(v), label: String(l || v) };
        }
        return null;
      })
      .filter(Boolean);
    return mapped.length ? mapped : OP_TYPE_FALLBACK;
  }
  return OP_TYPE_FALLBACK;
}

/* ====================  ExecSelect (usuarios del sistema)  ==================== */
function ExecSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        // Endpoint minimal que no requiere admin
        const { data } = await api.get("/users/select", { params: { active: 1 } });
        const list = (Array.isArray(data) ? data : [])
          .map((u) => {
            const id = u.id ?? u.user_id ?? null;
            const name =
              u.name ??
              (([u.first_name, u.last_name].filter(Boolean).join(" ")) ||
                u.username ||
                u.email ||
                null);
            if (!id || !name) return null;
            return { id, name: String(name) };
          })
          .filter(Boolean);
        setUsers(list);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const f = q.trim().toLowerCase();
    if (!f) return users;
    return users.filter((u) => u.name.toLowerCase().includes(f));
  }, [q, users]);

  const currentLabel =
    users.find((u) => String(u.id) === String(value))?.name || "";

  return (
    <div className="relative">
      <div className="flex gap-2">
        <input
          className="w-full border rounded-lg px-3 py-2 text-sm"
          value={currentLabel}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Buscar usuario…"
          readOnly
        />
        <button
          type="button"
          className="px-2 border rounded-lg text-sm"
          onClick={() => setOpen((o) => !o)}
          title="Seleccionar ejecutivo"
        >
          {open ? "▲" : "▼"}
        </button>
      </div>

      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-64 overflow-auto">
          <div className="p-2">
            <input
              className="w-full border rounded px-2 py-1 text-sm"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filtrar…"
              autoFocus
            />
          </div>
          {loading && (
            <div className="px-3 py-2 text-xs text-slate-500">Cargando…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="px-3 py-2 text-xs text-slate-500">Sin resultados</div>
          )}
          {!loading &&
            filtered.map((u) => (
              <div
                key={u.id}
                className="px-3 py-2 text-sm hover:bg-slate-100 cursor-pointer"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange?.(u.id);
                  setOpen(false);
                }}
              >
                {u.name}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/* ====================  Helpers de red (orgs/contacts)  ==================== */
async function searchOrganizations(term) {
  const q = String(term || "").trim();
  if (q.length < 2) return [];
  const attempts = [
    async () => {
      const { data } = await api.get("/search", { params: { q } });
      const arr = data?.organizations || data?.orgs || [];
      return normalizeOrgs(arr);
    },
    async () => {
      const { data } = await api.get("/organizations", { params: { search: q } });
      return normalizeOrgs(data);
    },
    async () => {
      const { data } = await api.get("/organizations", { params: { q } });
      return normalizeOrgs(data);
    },
    async () => {
      const { data } = await api.get("/organizations", { params: { name_like: q } });
      return normalizeOrgs(data);
    },
  ];
  for (const run of attempts) {
    try {
      const out = await run();
      if (Array.isArray(out) && out.length) return out;
    } catch (_) {}
  }
  return [];
}

function normalizeOrgs(data) {
  const arr = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  return arr
    .map((o) => {
      if (!o) return null;
      const id = o.id ?? o.org_id ?? o.organization_id ?? null;
      const name = o.name ?? o.org_name ?? o.title ?? null;
      if (!id || !name) return null;
      const extra =
        o.tax_id || o.ruc || o.document || o.doc || o.code
          ? ` (${o.tax_id || o.ruc || o.document || o.doc || o.code})`
          : "";
      return { id, name: String(name), display: `${name}${extra}` };
    })
    .filter(Boolean);
}

async function fetchContactsByOrg(orgId) {
  if (!orgId) return [];
  const attempts = [
    async () => {
      const { data } = await api.get(`/organizations/${orgId}/contacts`);
      return normalizeContacts(data);
    },
    async () => {
      const { data } = await api.get(`/contacts`, { params: { org_id: orgId } });
      return normalizeContacts(data);
    },
    async () => {
      const { data } = await api.get(`/contacts`, { params: { organization_id: orgId } });
      return normalizeContacts(data);
    },
  ];
  for (const run of attempts) {
    try {
      const out = await run();
      if (Array.isArray(out)) return out;
    } catch (_) {}
  }
  return [];
}

function normalizeContacts(data) {
  const arr = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  return arr
    .map((c) => {
      if (!c) return null;
      const id = c.id ?? c.contact_id ?? null;
      const fullNameFromParts = ((c.first_name || "") + " " + (c.last_name || "")).trim();
      const name = c.name ?? (fullNameFromParts || c.fullname || null);
      if (!id || !name) return null;
      const email = c.email ?? c.mail ?? null;
      const phone = c.phone ?? c.tel ?? c.mobile ?? null;
      return { id, name: String(name), email: email || "", phone: phone || "", org_id: c.org_id ?? null };
    })
    .filter(Boolean);
}

// Hook debounce
function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/* ====================  Componente principal  ==================== */
export default function NewOperationModal({
  onClose,
  pipelineId,
  stages,
  onCreated,
  defaultBusinessUnitId,
}) {
  const [referencePreview, setReferencePreview] = useState("—");

  // Transporte / carga
  const [modo, setModo] = useState("");
  const [clase, setClase] = useState("");
  const [origen, setOrigen] = useState("");
  const [destino, setDestino] = useState("");

  // Tipo de operación
  const [tipoOp, setTipoOp] = useState(""); // IMPORT | EXPORT | EXTERIOR
  const [tipoOpManual, setTipoOpManual] = useState(false);

  // Carga
  const [mercaderia, setMercaderia] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [unidad, setUnidad] = useState("Bultos");
  const [peso, setPeso] = useState("");
  const [volumen, setVolumen] = useState("");

  // Negocio/CRM
  const [businessUnits, setBusinessUnits] = useState([]);
  const [businessUnitId, setBusinessUnitId] = useState(defaultBusinessUnitId || "");
  const [stageId, setStageId] = useState(stages?.[0]?.id || null);
  const [execId, setExecId] = useState(""); // 👈 Ejecutivo de cuenta (opcional)

  const [saving, setSaving] = useState(false);

  // Empresa / contacto
  const [orgName, setOrgName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  // Autocomplete: Organización
  const [orgQuery, setOrgQuery] = useState("");
  const debOrg = useDebounced(orgQuery, 250);
  const [orgOpen, setOrgOpen] = useState(false);
  const [orgLoading, setOrgLoading] = useState(false);
  const [orgResults, setOrgResults] = useState([]);
  const [selectedOrg, setSelectedOrg] = useState(null);

  // Contactos: locales por organización
  const [contacts, setContacts] = useState([]);
  // Contactos: búsqueda global (cuando NO hay organización)
  const [contactResults, setContactResults] = useState([]);
  const [contactLoading, setContactLoading] = useState(false);

  const [contactOpen, setContactOpen] = useState(false);
  const [contactFilter, setContactFilter] = useState("");
  const debContact = useDebounced(contactFilter, 250);

  // Refs (SOLO una vez)
  const orgBoxRef = useRef(null);
  const contactBoxRef = useRef(null);

  // Parámetros: Tipo de operación (normalizados)
  const { options: paramOptions, loading: loadingParams } = useParamOptions(
    ["operation_type"],
    { onlyActive: true, fallback: { operation_type: OP_TYPE_FALLBACK }, useDefaults: true }
  );

  const tipoOperacionOptions = useMemo(() => {
    return normalizeOpTypeOptions(paramOptions);
  }, [paramOptions]);

  // Opciones de "tipo de carga" según modalidad
  const tipoCargaOptions = useMemo(() => {
    if (!modo) return [];
    return LOAD_TYPES[modo] || [];
  }, [modo]);

  // Ajuste de tipo de carga al cambiar modalidad
  useEffect(() => {
    if (!modo) {
      setClase("");
      return;
    }
    const opts = LOAD_TYPES[modo] || [];
    if (!opts.includes(clase)) setClase(opts[0] || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo]);

  // Cargar unidades de negocio
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/business-units").catch(() => ({ data: [] }));
        setBusinessUnits(Array.isArray(data) ? data : []);
        if (!businessUnitId && Array.isArray(data) && data.length) {
          setBusinessUnitId(data[0].id);
        }
      } catch {
        setBusinessUnits([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sugerir tipo de operación
  useEffect(() => {
    if (tipoOpManual) return;
    const o = (origen || "").toLowerCase();
    const d = (destino || "").toLowerCase();
    const isPY = (s) =>
      s.includes("paraguay") ||
      s.includes("py") ||
      s.includes("asu") ||
      s.includes("asunción") ||
      s.includes("asuncion");
    if (o && d) {
      if (isPY(o) && !isPY(d)) setTipoOp("EXPORT");
      else if (isPY(d) && !isPY(o)) setTipoOp("IMPORT");
      else if (!isPY(o) && !isPY(d)) setTipoOp("EXTERIOR");
    }
  }, [origen, destino, tipoOpManual]);

  // Validar valor seleccionado vs opciones
  useEffect(() => {
    const valid = new Set((tipoOperacionOptions || []).map((x) => x.value));
    if (tipoOp && !valid.has(tipoOp)) setTipoOp("");
  }, [tipoOperacionOptions, tipoOp]);

  // Referencia visual
  useEffect(() => {
    const parts = [modo, clase, origen, destino].map((x) => (x || "").trim()).filter(Boolean);
    setReferencePreview(parts.length ? parts.join(" • ") : "—");
  }, [modo, clase, origen, destino]);

  const canSave = useMemo(() => {
    return (
      pipelineId &&
      stageId &&
      (modo || "").length &&
      (clase || "").length &&
      (origen || "").length &&
      (destino || "").length &&
      (orgName || "").length
    );
  }, [pipelineId, stageId, modo, clase, origen, destino, orgName]);

  // Autocomplete ORG
  useEffect(() => {
    let live = true;
    (async () => {
      if (debOrg.trim().length < 2) {
        if (live) { setOrgResults([]); setOrgLoading(false); }
        return;
      }
      setOrgLoading(true);
      try {
        const rows = await searchOrganizations(debOrg);
        if (!live) return;
        setOrgResults(rows);
      } finally {
        if (live) setOrgLoading(false);
      }
    })();
    return () => { live = false; };
  }, [debOrg]);

  function handleOrgInput(e) {
    const v = e.target.value;
    setOrgName(v);
    setOrgQuery(v);
    setSelectedOrg(null);        // al escribir, deja de haber una org seleccionada
    setContacts([]);             // limpiamos contactos de esa org
    setContactName("");
    setContactEmail("");
    setContactPhone("");
    if (v.trim().length >= 2) setOrgOpen(true);
  }

  async function selectOrganization(org) {
    setSelectedOrg(org);
    setOrgName(org.name);
    setOrgQuery(org.name);
    setOrgOpen(false);

    const list = await fetchContactsByOrg(org.id);
    setContacts(list || []);

    if (list?.length === 1) {
      const c = list[0];
      setContactName(c.name || "");
      setContactEmail(c.email || "");
      setContactPhone(c.phone || "");
    } else {
      setContactName("");
      setContactEmail("");
      setContactPhone("");
    }
  }

  // Cerrar dropdowns al click afuera
  useEffect(() => {
    function onClick(e) {
      if (orgBoxRef.current && !orgBoxRef.current.contains(e.target)) {
        setOrgOpen(false);
      }
      if (contactBoxRef.current && !contactBoxRef.current.contains(e.target)) {
        setContactOpen(false);
      }
    }
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, []);

  // Contactos: abrir + filtrar (cuando hay organización)
  const filteredContacts = useMemo(() => {
    const f = (contactFilter || "").toLowerCase();
    if (!f) return contacts;
    return contacts.filter(
      (c) =>
        c.name?.toLowerCase().includes(f) ||
        c.email?.toLowerCase().includes(f) ||
        c.phone?.toLowerCase().includes(f)
    );
  }, [contacts, contactFilter]);

  // Contactos: búsqueda global si NO hay organización
  useEffect(() => {
    let live = true;
    const q = debContact?.trim();
    if (selectedOrg) { setContactResults([]); setContactLoading(false); return; }
    if (!q || q.length < 2) { setContactResults([]); setContactLoading(false); return; }

    (async () => {
      try {
        setContactLoading(true);
        const { data } = await api.get("/contacts", { params: { q, limit: 8 } }).catch(() => ({ data: [] }));
        if (!live) return;
        setContactResults(normalizeContacts(data));
      } catch {
        if (live) setContactResults([]);
      } finally {
        if (live) setContactLoading(false);
      }
    })();

    return () => { live = false; };
  }, [debContact, selectedOrg]);

  function handleContactInput(e) {
    const v = e.target.value;
    setContactName(v);
    setContactFilter(v);
    if ((selectedOrg && contacts.length) || v.trim().length >= 2) {
      setContactOpen(true);
    }
  }

  function selectContact(c) {
    setContactName(c.name || "");
    setContactEmail(c.email || "");
    setContactPhone(c.phone || "");
    setContactOpen(false);
  }

  async function handleCreate(e) {
    e?.preventDefault?.();
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const titleFromForm = `${orgName}`.trim();
      const fallbackPieces = [modo || "", clase || "", mercaderia || ""].filter(Boolean);
      const safeTitle =
        titleFromForm ||
        (fallbackPieces.length ? fallbackPieces.join(" • ") : "") ||
        "Operación";

      const payload = {
        pipeline_id: pipelineId,
        stage_id: stageId,
        title: safeTitle,
        value: 0,
        business_unit_id: businessUnitId || null,
        account_exec_id: execId || null, // opcional
        org_name: orgName || null,
        contact_name: contactName || null,
        contact_phone: contactPhone || null,
        contact_email: contactEmail || null,
      };

      const { data: created } = await api.post("/deals", payload);
      const dealId = created?.id;
      if (!dealId) throw new Error("No se obtuvo el ID de la operación");

      const cfPayloads = [
        { key: "modalidad_carga", label: "Modalidad de carga", type: "select", value: modo },
        { key: "tipo_carga", label: "Tipo de carga", type: "select", value: clase },
        { key: "tipo_operacion", label: "Tipo de operación", type: "select", value: tipoOp || "" },
        { key: "origen_pto", label: "Origen", type: "text", value: origen || "" },
        { key: "destino_pto", label: "Destino", type: "text", value: destino || "" },
        { key: "mercaderia", label: "Mercadería", type: "text", value: mercaderia || "" },
        { key: "cant_bultos", label: "Cant bultos", type: "number", value: cantidad || "" },
        { key: "peso_bruto", label: "Peso (kg)", type: "text", value: peso || "" },
        { key: "vol_m3", label: "Vol m³", type: "text", value: volumen || "" },
        { key: "unidad", label: "Unidad", type: "text", value: unidad || "" },
      ];
      await Promise.all(cfPayloads.map((p) => api.post(`/deals/${dealId}/custom-fields`, p)));

      if (modo === "MARITIMO") {
        await api.put(`/operations/${dealId}/ocean`, {
          load_type: clase,
          pol: origen || "",
          pod: destino || "",
          commodity: mercaderia || "",
          packages: cantidad || "",
          weight_kg: peso || "",
          volume_m3: volumen || "",
        }).catch(() => {});
      } else if (modo === "TERRESTRE") {
        await api.put(`/operations/${dealId}/road`, {
          cargo_class: clase,
          origin_city: origen || "",
          destination_city: destino || "",
          commodity: mercaderia || "",
          packages: cantidad || "",
          weight_kg: peso || "",
          volume_m3: volumen || "",
        }).catch(() => {});
      } else if (modo === "AEREO") {
        await api.put(`/operations/${dealId}/air`, {
          origin_airport: origen || "",
          destination_airport: destino || "",
          commodity: mercaderia || "",
          packages: cantidad || "",
          weight_gross_kg: peso || "",
          volume_m3: volumen || "",
        }).catch(() => {});
      }

      onCreated?.(created);
      onClose?.();
    } catch (err) {
      console.error("POST /deals failed:", {
        message: err?.message,
        status: err?.response?.status,
        data: err?.response?.data,
      });
      alert(
        `No se pudo crear la operación.\n` +
          `Status: ${err?.response?.status || "?"}\n` +
          `Detalle: ${JSON.stringify(err?.response?.data || {}, null, 2)}`
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500">Nueva operación</div>
            <div className="text-lg font-semibold">{referencePreview}</div>
          </div>
          <button className="text-sm px-3 py-1.5 rounded-lg border" onClick={onClose}>
            Cerrar
          </button>
        </div>

        <form onSubmit={handleCreate} className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Empresa / contacto */}
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="font-medium mb-2">Cliente</div>
            <div className="grid gap-2">
              <label className="text-sm" ref={orgBoxRef}>
                Organización
                <div className="relative">
                  <Input
                    value={orgName}
                    onChange={handleOrgInput}
                    onFocus={() => orgQuery.trim().length >= 2 && setOrgOpen(true)}
                    placeholder="Ej: ACME S.A."
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {orgOpen && (
                    <div className="absolute z-20 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-64 overflow-auto">
                      {orgLoading && (
                        <div className="px-3 py-2 text-xs text-slate-500">Buscando…</div>
                      )}
                      {!orgLoading && orgResults.length === 0 && (
                        <div className="px-3 py-2 text-xs text-slate-500">Sin resultados</div>
                      )}
                      {!orgLoading &&
                        orgResults.map((o) => (
                          <div
                            key={o.id}
                            className="px-3 py-2 text-sm hover:bg-slate-100 cursor-pointer"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              selectOrganization(o);
                            }}
                          >
                            {o.display || o.name}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </label>

              <label className="text-sm" ref={contactBoxRef}>
                Contacto
                <div className="relative">
                  <Input
                    value={contactName}
                    onChange={handleContactInput}
                    onFocus={() => {
                      if ((selectedOrg && contacts.length) || contactResults.length) {
                        setContactOpen(true);
                      }
                    }}
                    placeholder="Escribí para buscar o crear…"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {contactOpen && (
                    <div className="absolute z-20 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-64 overflow-auto">
                      {/* Si hay organización seleccionada, mostramos sus contactos filtrados */}
                      {selectedOrg ? (
                        <>
                          {filteredContacts.length === 0 && (
                            <div className="px-3 py-2 text-xs text-slate-500">Sin contactos</div>
                          )}
                          {filteredContacts.map((c) => (
                            <div
                              key={c.id}
                              className="px-3 py-2 text-sm hover:bg-slate-100 cursor-pointer"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                selectContact(c);
                              }}
                            >
                              <div className="font-medium">{c.name}</div>
                              <div className="text-xs text-slate-500">
                                {c.email || "—"} {c.phone ? `· ${c.phone}` : ""}
                              </div>
                            </div>
                          ))}
                        </>
                      ) : (
                        // Si NO hay organización, usamos búsqueda global
                        <>
                          {contactLoading && (
                            <div className="px-3 py-2 text-xs text-slate-500">Buscando…</div>
                          )}
                          {!contactLoading && contactResults.length === 0 && debContact.trim().length >= 2 && (
                            <div className="px-3 py-2 text-xs text-slate-500">Sin resultados</div>
                          )}
                          {contactResults.map((c) => (
                            <div
                              key={c.id}
                              className="px-3 py-2 text-sm hover:bg-slate-100 cursor-pointer"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                selectContact(c);
                              }}
                            >
                              <div className="font-medium">{c.name}</div>
                              <div className="text-xs text-slate-500">
                                {c.email || "—"} {c.phone ? `· ${c.phone}` : ""}
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm">
                  Teléfono
                  <Input
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="+595 ..."
                  />
                </label>
                <label className="text-sm">
                  Email
                  <Input
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="correo@dominio.com"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Datos de operación */}
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="font-medium mb-2">Operación</div>
            <div className="grid gap-2">
              <label className="text-sm">
                Modo
                <Select value={modo} onChange={(e) => setModo(e.target.value)} required>
                  <option value="">—</option>
                  <option value="AEREO">AÉREO</option>
                  <option value="MARITIMO">MARÍTIMO</option>
                  <option value="TERRESTRE">TERRESTRE</option>
                  <option value="MULTIMODAL">MULTIMODAL</option>
                </Select>
              </label>

              <label className="text-sm">
                Tipo de carga
                <Select
                  value={clase}
                  onChange={(e) => setClase(e.target.value)}
                  required
                  disabled={!modo}
                >
                  {!modo && <option value="">Elegí modalidad…</option>}
                  {modo &&
                    (LOAD_TYPES[modo] || []).map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                </Select>
              </label>

              <label className="text-sm">
                Origen
                <Input
                  value={origen}
                  onChange={(e) => setOrigen(e.target.value)}
                  placeholder="Ciudad / Puerto / Aeropuerto"
                  required
                />
              </label>
              <label className="text-sm">
                Destino
                <Input
                  value={destino}
                  onChange={(e) => setDestino(e.target.value)}
                  placeholder="Ciudad / Puerto / Aeropuerto"
                  required
                />
              </label>

              {/* Campo visible y robusto */}
              <label className="text-sm flex items-center gap-2">
                Tipo de operación
                <Select
                  value={tipoOp}
                  onChange={(e) => {
                    setTipoOp(e.target.value);
                    setTipoOpManual(true);
                  }}
                  disabled={loadingParams}
                >
                  <option value="">—</option>
                  {tipoOperacionOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label || opLabel(o.value)}
                    </option>
                  ))}
                </Select>
                <span className="text-xs text-slate-500">(editable)</span>
              </label>
            </div>
          </div>

          {/* Carga */}
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="font-medium mb-2">Carga</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm col-span-2">
                Mercadería
                <Input
                  value={mercaderia}
                  onChange={(e) => setMercaderia(e.target.value)}
                  placeholder="Descripción"
                />
              </label>
              <label className="text-sm">
                Cantidad
                <Input
                  value={cantidad}
                  onChange={(e) => setCantidad(e.target.value)}
                  placeholder="Ej: 10"
                />
              </label>
              <label className="text-sm">
                Unidad
                <Select value={unidad} onChange={(e) => setUnidad(e.target.value)}>
                  <option value="Bultos">Bultos</option>
                  <option value="Cajas">Cajas</option>
                  <option value="Pallets">Pallets</option>
                </Select>
              </label>
              <label className="text-sm">
                Peso (kg)
                <Input value={peso} onChange={(e) => setPeso(e.target.value)} placeholder="Ej: 2500" />
              </label>
              <label className="text-sm">
                Volumen (m³)
                <Input value={volumen} onChange={(e) => setVolumen(e.target.value)} placeholder="Ej: 12.5" />
              </label>
            </div>
          </div>

          {/* CRM */}
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="font-medium mb-2">CRM</div>
            <div className="grid gap-2">
              <label className="text-sm">
                Etapa del pipeline
                <Select
                  value={stageId || ""}
                  onChange={(e) => setStageId(Number(e.target.value) || null)}
                  required
                >
                  {stages?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="text-sm">
                Unidad de negocio
                <Select
                  value={businessUnitId || ""}
                  onChange={(e) => setBusinessUnitId(e.target.value)}
                >
                  <option value="">—</option>
                  {businessUnits.map((bu) => (
                    <option key={bu.id} value={bu.id}>
                      {bu.name || `BU ${bu.id}`}
                    </option>
                  ))}
                </Select>
              </label>

              {/* Ejecutivo de cuenta (opcional) */}
              <label className="text-sm">
                Ejecutivo de cuenta (opcional)
                <ExecSelect value={execId} onChange={setExecId} />
              </label>
            </div>
          </div>

          {/* Acciones */}
          <div className="md:col-span-2 flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              className="px-3 py-2 text-sm rounded-lg border"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSave || saving}
              className="px-3 py-2 text-sm rounded-lg bg-black text-white disabled:opacity-60"
            >
              {saving ? "Creando…" : "Crear operación"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
