// client/src/components/NewIndustrialOperationModal.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";

/* -------------------- UI basics -------------------- */
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

/* ==================== ExecSelect (usuarios) ==================== */
function ExecSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef(null);
  const [placement, setPlacement] = useState("down");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/users/select", {
          params: { active: 1 },
        });
        const list = (Array.isArray(data) ? data : [])
          .map((u) => {
            const id = u.id || u.user_id || null;
            const name =
              u.name ||
              [u.first_name, u.last_name].filter(Boolean).join(" ") ||
              u.username ||
              u.email ||
              null;
            if (!id || !name) return null;
            return { id, name: String(name) };
          })
          .filter(Boolean);
        setUsers(list);
      } catch {
        setUsers([]);
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

  const recalcPlacement = () => {
    try {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const viewportH =
        window.innerHeight || document.documentElement.clientHeight || 0;

      const spaceBelow = viewportH - rect.bottom;
      const spaceAbove = rect.top;
      const estimatedHeight = 260;

      if (spaceBelow < estimatedHeight && spaceAbove > spaceBelow) {
        setPlacement("up");
      } else {
        setPlacement("down");
      }
    } catch {
      // noop
    }
  };

  useEffect(() => {
    const onClick = (e) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onResizeScroll = () => {
      if (open) recalcPlacement();
    };

    window.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResizeScroll);
    window.addEventListener("scroll", onResizeScroll, true);

    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResizeScroll);
      window.removeEventListener("scroll", onResizeScroll, true);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <div className="flex gap-2">
        <input
          className="w-full border rounded-lg px-3 py-2 text-sm"
          value={currentLabel}
          onFocus={() => {
            recalcPlacement();
            setOpen(true);
          }}
          placeholder="Buscar usuario…"
          readOnly
        />
        <button
          type="button"
          className="px-2 border rounded-lg text-sm"
          onClick={() => {
            if (!open) recalcPlacement();
            setOpen((o) => !o);
          }}
          title="Seleccionar ejecutivo"
        >
          {open ? "▲" : "▼"}
        </button>
      </div>

      {open && (
        <div
          className={
            "absolute z-30 w-full bg-white border rounded-lg shadow-lg max-h-64 overflow-auto " +
            (placement === "up" ? "bottom-full mb-1" : "mt-1")
          }
        >
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
            <div className="px-3 py-2 text-xs text-slate-500">
              Sin resultados
            </div>
          )}
          {!loading &&
            filtered.map((u) => (
              <div
                key={u.id}
                className="px-3 py-2 text-sm hover:bg-slate-100 cursor-pointer"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange && onChange(u.id);
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

/* ==================== Helpers ORG / CONTACTOS ==================== */
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
      const { data } = await api.get("/organizations", {
        params: { search: q },
      });
      return normalizeOrgs(data);
    },
    async () => {
      const { data } = await api.get("/organizations", { params: { q } });
      return normalizeOrgs(data);
    },
    async () => {
      const { data } = await api.get("/organizations", {
        params: { name_like: q },
      });
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
  const arr = Array.isArray(data)
    ? data
    : Array.isArray(data?.items)
    ? data.items
    : [];
  return arr
    .map((o) => {
      if (!o) return null;
      const id = o.id || o.org_id || o.organization_id || null;
      const name = o.name || o.org_name || o.title || null;
      if (!id || !name) return null;
      const ruc = o.tax_id || o.ruc || o.document || o.doc || o.code || "";
      const extra =
        ruc
          ? ` (${o.tax_id || o.ruc || o.document || o.doc || o.code})`
          : "";
      return { id, name: String(name), ruc: String(ruc || ""), display: `${name}${extra}` };
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
      const { data } = await api.get(`/contacts`, {
        params: { org_id: orgId },
      });
      return normalizeContacts(data);
    },
    async () => {
      const { data } = await api.get(`/contacts`, {
        params: { organization_id: orgId },
      });
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
  const arr = Array.isArray(data)
    ? data
    : Array.isArray(data?.items)
    ? data.items
    : [];
  return arr
    .map((c) => {
      if (!c) return null;
      const id = c.id || c.contact_id || null;
      const fullNameFromParts =
        (c.first_name || "") + " " + (c.last_name || "");
      const name = c.name || fullNameFromParts.trim() || c.fullname || null;
      if (!id || !name) return null;
      const email = c.email || c.mail || "";
      const phone = c.phone || c.tel || c.mobile || "";
      return {
        id,
        name: String(name),
        email: email || "",
        phone: phone || "",
        org_id: c.org_id || null,
      };
    })
    .filter(Boolean);
}

function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function buildOrganizationLocations(organization, rawBranches) {
  const branches = Array.isArray(rawBranches) ? rawBranches : [];
  const locations = branches.map((branch) => ({
    ...branch,
    key: `branch-${branch.id}`,
    label: `${branch.is_default ? 'Casa matriz' : branch.name || 'Sucursal'}${
      branch.city || branch.address ? ` · ${[branch.city, branch.address].filter(Boolean).join(' · ')}` : ''
    }`,
  }));

  if (!branches.some((branch) => Number(branch.is_default) === 1)) {
    locations.unshift({
      id: null,
      key: 'matrix',
      is_default: 1,
      name: 'Casa matriz',
      address: organization?.address || '',
      city: organization?.city || '',
      country: organization?.country || '',
      label: `Casa matriz${
        organization?.city || organization?.address
          ? ` · ${[organization?.city, organization?.address].filter(Boolean).join(' · ')}`
          : ''
      }`,
    });
  }
  return locations;
}

/* ==================== Modal principal (Industrial) ==================== */
export default function NewIndustrialOperationModal({
  onClose,
  pipelineId,
  stages,
  onCreated,
  defaultBusinessUnitId,
}) {
  const [referencePreview, setReferencePreview] = useState("—");
  const [operationTitle, setOperationTitle] = useState("");

  // Marca principal de la operación (para referencia / filtros)
  const [mainBrand, setMainBrand] = useState("RAYFLEX");

  // Datos de proyecto industrial
  const [projectType, setProjectType] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");

  // CRM
  const [businessUnits, setBusinessUnits] = useState([]);
  const [businessUnitId, setBusinessUnitId] = useState(
    defaultBusinessUnitId || ""
  );
  const [stageId, setStageId] = useState(stages?.[0]?.id || null);
  const [execId, setExecId] = useState("");

  const [saving, setSaving] = useState(false);

  // Empresa / contacto
  const [orgName, setOrgName] = useState("");
  const [orgRuc, setOrgRuc] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  // Autocomplete ORG
  const [orgQuery, setOrgQuery] = useState("");
  const debOrg = useDebounced(orgQuery, 250);
  const [orgOpen, setOrgOpen] = useState(false);
  const [orgLoading, setOrgLoading] = useState(false);
  const [orgResults, setOrgResults] = useState([]);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [selectedContact, setSelectedContact] = useState(null);
  const [organizationLocations, setOrganizationLocations] = useState([]);
  const [selectedLocationKey, setSelectedLocationKey] = useState('');
  const [branchFormOpen, setBranchFormOpen] = useState(false);
  const [branchSaving, setBranchSaving] = useState(false);
  const [branchError, setBranchError] = useState('');
  const [cities, setCities] = useState([]);
  const [newBranch, setNewBranch] = useState({
    name: '',
    address: '',
    city_id: '',
    country: 'Paraguay',
    phone: '',
    email: '',
  });

  // Contactos
  const [contacts, setContacts] = useState([]);
  const [contactResults, setContactResults] = useState([]);
  const [contactLoading, setContactLoading] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactFilter, setContactFilter] = useState("");
  const debContact = useDebounced(contactFilter, 250);

  const orgBoxRef = useRef(null);
  const contactBoxRef = useRef(null);

  // Cargar unidades de negocio
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api
          .get("/business-units")
          .catch(() => ({ data: [] }));
        const list = Array.isArray(data) ? data : [];
        setBusinessUnits(list);
        if (!businessUnitId && list.length) {
          setBusinessUnitId(list[0].id);
        }
      } catch {
        setBusinessUnits([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!branchFormOpen || cities.length) return;
    let live = true;
    api.get('/cities')
      .then(({ data }) => {
        if (live) setCities(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (live) setBranchError('No se pudo cargar el catálogo de ciudades.');
      });
    return () => {
      live = false;
    };
  }, [branchFormOpen, cities.length]);

  const canSave = useMemo(() => {
    return Boolean(
      pipelineId &&
      stageId &&
      businessUnitId &&
      operationTitle.trim() &&
      selectedOrg?.id &&
      orgName.trim() &&
      orgRuc.trim() &&
      contactName.trim() &&
      contactPhone.trim() &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim()) &&
      selectedLocationKey &&
      execId
    );
  }, [pipelineId, stageId, businessUnitId, operationTitle, selectedOrg, orgName, orgRuc, contactName, contactPhone, contactEmail, selectedLocationKey, execId]);

  // Referencia visual
  useEffect(() => {
    const brandLabel = mainBrand
      ? mainBrand === "RAYFLEX"
        ? "Rayflex"
        : mainBrand === "BOPLAN"
        ? "Boplan"
        : mainBrand
      : "";
    const parts = [brandLabel, orgName, projectType, location]
      .map((x) => (x || "").trim())
      .filter(Boolean);
    setReferencePreview(parts.length ? parts.join(" • ") : "—");
  }, [mainBrand, orgName, projectType, location]);

  // Autocomplete ORG
  useEffect(() => {
    let live = true;
    (async () => {
      if (debOrg.trim().length < 2) {
        if (live) {
          setOrgResults([]);
          setOrgLoading(false);
        }
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
    return () => {
      live = false;
    };
  }, [debOrg]);

  function handleOrgInput(e) {
    const v = e.target.value.toUpperCase();
    setOrgName(v);
    setOrgQuery(v);
    setSelectedOrg(null);
    setSelectedContact(null);
    setOrganizationLocations([]);
    setSelectedLocationKey('');
    setLocation('');
    setBranchFormOpen(false);
    setOrgRuc("");
    setContacts([]);
    setContactName("");
    setContactEmail("");
    setContactPhone("");
    if (v.trim().length >= 2) setOrgOpen(true);
  }

  async function selectOrganization(org) {
    const uppercaseName = String(org.name || '').toUpperCase();
    setSelectedOrg({ ...org, name: uppercaseName });
    setOrgName(uppercaseName);
    setOrgQuery(uppercaseName);
    setOrgOpen(false);
    setSelectedContact(null);

    const [detailResponse, list, branchesResponse] = await Promise.all([
      api.get(`/organizations/${org.id}`).catch(() => ({ data: org })),
      fetchContactsByOrg(org.id),
      api.get(`/organizations/${org.id}/branches`).catch(() => ({ data: [] })),
    ]);
    const detail = detailResponse?.data?.organization || detailResponse?.data || org;
    const locations = buildOrganizationLocations(detail, branchesResponse?.data);
    const defaultLocation = locations.find((item) => Number(item.is_default) === 1) || locations[0] || null;

    setOrgRuc(detail?.ruc || detail?.tax_id || org.ruc || "");
    setSelectedOrg({ ...detail, id: org.id, name: uppercaseName });
    setOrganizationLocations(locations);
    setSelectedLocationKey(defaultLocation?.key || '');
    setLocation(defaultLocation?.label || '');
    setContacts(list || []);

    if (list && list.length === 1) {
      const c = list[0];
      setSelectedContact(c);
      setContactName(c.name || "");
      setContactEmail(c.email || detail?.email || "");
      setContactPhone(c.phone || detail?.phone || "");
    } else {
      setSelectedContact(null);
      setContactName("");
      setContactEmail(detail?.email || "");
      setContactPhone(detail?.phone || "");
    }
  }

  // Click afuera para cerrar combos
  useEffect(() => {
    function onClick(e) {
      if (orgBoxRef.current && !orgBoxRef.current.contains(e.target)) {
        setOrgOpen(false);
      }
      if (
        contactBoxRef.current &&
        !contactBoxRef.current.contains(e.target)
      ) {
        setContactOpen(false);
      }
    }
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, []);

  // Contactos: filtrado cuando hay organización
  const filteredContacts = useMemo(() => {
    const f = (contactFilter || "").toLowerCase();
    if (!f) return contacts;
    return contacts.filter(
      (c) =>
        (c.name && c.name.toLowerCase().includes(f)) ||
        (c.email && c.email.toLowerCase().includes(f)) ||
        (c.phone && c.phone.toLowerCase().includes(f))
    );
  }, [contacts, contactFilter]);

  // Contactos: búsqueda global si NO hay organización
  useEffect(() => {
    let live = true;
    const q = debContact.trim();
    if (selectedOrg) {
      if (live) {
        setContactResults([]);
        setContactLoading(false);
      }
      return;
    }
    if (!q || q.length < 2) {
      if (live) {
        setContactResults([]);
        setContactLoading(false);
      }
      return;
    }

    (async () => {
      try {
        setContactLoading(true);
        const { data } = await api
          .get("/contacts", { params: { q, limit: 8 } })
          .catch(() => ({ data: [] }));
        if (!live) return;
        setContactResults(normalizeContacts(data));
      } catch {
        if (live) setContactResults([]);
      } finally {
        if (live) setContactLoading(false);
      }
    })();

    return () => {
      live = false;
    };
  }, [debContact, selectedOrg]);

  function handleContactInput(e) {
    const v = e.target.value;
    setSelectedContact(null);
    setContactName(v);
    setContactFilter(v);
    if ((selectedOrg && contacts.length) || v.trim().length >= 2) {
      setContactOpen(true);
    }
  }

  function selectContact(c) {
    setSelectedContact(c);
    setContactName(c.name || "");
    setContactEmail(c.email || "");
    setContactPhone(c.phone || "");
    setContactOpen(false);
  }

  function openBranchForm() {
    setBranchError('');
    setNewBranch({
      name: '',
      address: '',
      city_id: selectedOrg?.city_id ? String(selectedOrg.city_id) : '',
      country: selectedOrg?.country || 'Paraguay',
      phone: selectedOrg?.phone || contactPhone || '',
      email: selectedOrg?.email || contactEmail || '',
    });
    setBranchFormOpen(true);
  }

  async function createBranch(e) {
    e?.preventDefault?.();
    if (branchSaving) return;
    const name = newBranch.name.trim();
    const cityId = Number(newBranch.city_id || 0);
    const isNewOrganization = !selectedOrg?.id;
    if (isNewOrganization && !orgName.trim()) {
      setBranchError('Escribe el nombre de la organización.');
      return;
    }
    if (isNewOrganization && !orgRuc.trim()) {
      setBranchError('El RUC de la organización es obligatorio.');
      return;
    }
    if (isNewOrganization && !contactName.trim()) {
      setBranchError('El contacto principal es obligatorio.');
      return;
    }
    if (isNewOrganization && !contactEmail.trim()) {
      setBranchError('El email es obligatorio.');
      return;
    }
    if (!name) {
      setBranchError('El nombre de la sucursal es obligatorio.');
      return;
    }
    if (!cityId) {
      setBranchError('Selecciona la ciudad de la sucursal.');
      return;
    }

    setBranchSaving(true);
    setBranchError('');
    try {
      let organization = selectedOrg;
      let createdBranchId = null;

      if (isNewOrganization) {
        const { data: createdOrganization } = await api.post('/organizations', {
          razon_social: orgName.trim().toUpperCase(),
          name: orgName.trim().toUpperCase(),
          ruc: orgRuc.trim(),
          contact_name: contactName.trim(),
          email: contactEmail.trim(),
          phone: contactPhone.trim() || null,
          address: newBranch.address.trim() || null,
          city_id: cityId,
          country: newBranch.country.trim() || 'Paraguay',
          skip_prospect: true,
          branches: [{
            name,
            address: newBranch.address.trim() || null,
            city_id: cityId,
            country: newBranch.country.trim() || 'Paraguay',
            phone: newBranch.phone.trim() || contactPhone.trim() || null,
            email: newBranch.email.trim() || contactEmail.trim() || null,
            is_default: 1,
          }],
        });
        organization = createdOrganization;
        const uppercaseName = String(createdOrganization?.name || orgName).toUpperCase();
        setSelectedOrg({ ...createdOrganization, name: uppercaseName });
        setOrgName(uppercaseName);
        setOrgQuery(uppercaseName);
        setOrgRuc(createdOrganization?.ruc || orgRuc.trim());

        const contactList = await fetchContactsByOrg(createdOrganization?.id);
        setContacts(contactList);
        const primaryContact = contactList[0] || null;
        setSelectedContact(primaryContact);
      } else {
        const { data: created } = await api.post(
          `/organizations/${selectedOrg.id}/branches`,
          {
          name,
          address: newBranch.address.trim() || null,
          city_id: cityId,
          country: newBranch.country.trim() || 'Paraguay',
          phone: newBranch.phone.trim() || null,
          email: newBranch.email.trim() || null,
          }
        );
        createdBranchId = created?.id || null;
      }

      const { data: refreshed } = await api.get(
        `/organizations/${organization.id}/branches`
      );
      const locations = buildOrganizationLocations(
        organization,
        Array.isArray(refreshed) ? refreshed : []
      );
      const createdLocation = locations.find(
        (item) => createdBranchId
          ? Number(item.id) === Number(createdBranchId)
          : Number(item.is_default) === 1
      ) || locations[0];
      setOrganizationLocations(locations);
      setSelectedLocationKey(createdLocation?.key || '');
      setLocation(createdLocation?.label || '');
      setBranchFormOpen(false);
    } catch (error) {
      setBranchError(
        error?.response?.data?.error || 'No se pudo guardar la sucursal.'
      );
    } finally {
      setBranchSaving(false);
    }
  }

  async function handleCreate(e) {
    e && e.preventDefault && e.preventDefault();
    if (!canSave || saving) return;
    setSaving(true);

    try {
      const safeTitle = operationTitle.trim();
      const selectedLocation = organizationLocations.find(
        (item) => item.key === selectedLocationKey
      );

      const payload = {
        pipeline_id: pipelineId,
        stage_id: stageId,
        title: safeTitle,
        value: 0, // ya no usamos valor estimado
        business_unit_id: businessUnitId || null,
        enforce_complete_data: true,
        account_exec_id: Number(execId),
        organization: { id: selectedOrg.id, name: orgName.trim().toUpperCase(), ruc: orgRuc.trim() },
        contact: {
          ...(selectedContact?.id ? { id: selectedContact.id } : {}),
          name: contactName.trim(),
          phone: contactPhone.trim(),
          email: contactEmail.trim(),
        },
        org_branch_id: selectedLocation?.id || null,
      };

      const { data: created } = await api.post("/deals", payload);
      const dealId = created?.id;
      if (!dealId) throw new Error("No se obtuvo el ID de la operación");

      // Custom fields básicos industriales
      const cfPayloads = [
        {
          key: "industrial_brand",
          label: "Marca industrial principal",
          type: "select",
          value: mainBrand || "",
        },
        {
          key: "industrial_project_type",
          label: "Tipo de proyecto",
          type: "text",
          value: projectType || "",
        },
        {
          key: "industrial_location",
          label: "Ubicación",
          type: "text",
          value: location || "",
        },
        {
          key: "industrial_notes",
          label: "Notas",
          type: "text",
          value: notes || "",
        },
      ];

      await Promise.all(
        cfPayloads.map((p) => api.post(`/deals/${dealId}/custom-fields`, p))
      );

      onCreated && onCreated(created);
      onClose && onClose();
    } catch (err) {
      console.error("POST /deals (industrial) failed:", {
        message: err?.message,
        status: err?.response?.status,
        data: err?.response?.data,
      });
      alert(
        `No se pudo crear la operación industrial.\n` +
          `Status: ${err?.response?.status || "?"}\n` +
          `Detalle: ${JSON.stringify(err?.response?.data || {}, null, 2)}`
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className={`w-full max-w-3xl bg-white rounded-2xl shadow-xl transition-[margin] ${branchFormOpen ? 'lg:mr-96' : ''}`}>
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500">
              Nueva operación industrial
            </div>
            <div className="text-lg font-semibold">{referencePreview}</div>
          </div>
          <button
            className="text-sm px-3 py-1.5 rounded-lg border"
            onClick={onClose}
          >
            Cerrar
          </button>
        </div>

        <form
          onSubmit={handleCreate}
          className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          {/* Cliente */}
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="font-medium mb-2">Cliente</div>
            <div className="grid gap-2">
              <label className="text-sm" ref={orgBoxRef}>
                Organización *
                <div className="relative">
                  <Input
                    value={orgName}
                    onChange={handleOrgInput}
                    onFocus={() =>
                      orgQuery.trim().length >= 2 && setOrgOpen(true)
                    }
                    placeholder="Ej: ACME S.A."
                    autoComplete="off"
                    spellCheck={false}
                    required
                  />
                  {orgOpen && (
                    <div className="absolute z-20 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-64 overflow-auto">
                      {orgLoading && (
                        <div className="px-3 py-2 text-xs text-slate-500">
                          Buscando…
                        </div>
                      )}
                      {!orgLoading && orgResults.length === 0 && (
                        <div className="px-3 py-2 text-xs text-slate-500">
                          Sin resultados
                        </div>
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

              <label className="text-sm">
                RUC *
                <Input
                  value={orgRuc}
                  onChange={(e) => setOrgRuc(e.target.value)}
                  placeholder="Ej: 80000000-1"
                  autoComplete="off"
                  required
                />
              </label>

              <label className="text-sm" ref={contactBoxRef}>
                Contacto *
                <div className="relative">
                  <Input
                    value={contactName}
                    onChange={handleContactInput}
                    onFocus={() => {
                      if (
                        (selectedOrg && contacts.length) ||
                        contactResults.length
                      ) {
                        setContactOpen(true);
                      }
                    }}
                    placeholder="Escribí para buscar o crear…"
                    autoComplete="off"
                    spellCheck={false}
                    required
                  />
                  {contactOpen && (
                    <div className="absolute z-20 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-64 overflow-auto">
                      {selectedOrg ? (
                        <>
                          {filteredContacts.length === 0 && (
                            <div className="px-3 py-2 text-xs text-slate-500">
                              Sin contactos
                            </div>
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
                                {c.email || "—"}{" "}
                                {c.phone ? `· ${c.phone}` : ""}
                              </div>
                            </div>
                          ))}
                        </>
                      ) : (
                        <>
                          {contactLoading && (
                            <div className="px-3 py-2 text-xs text-slate-500">
                              Buscando…
                            </div>
                          )}
                          {!contactLoading &&
                            contactResults.length === 0 &&
                            debContact.trim().length >= 2 && (
                              <div className="px-3 py-2 text-xs text-slate-500">
                                Sin resultados
                              </div>
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
                                {c.email || "—"}{" "}
                                {c.phone ? `· ${c.phone}` : ""}
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
                  Nro. de contacto *
                  <Input
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="+595 ..."
                    required
                  />
                </label>
                <label className="text-sm">
                  Email de contacto *
                  <Input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="correo@dominio.com"
                    required
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Proyecto industrial */}
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="font-medium mb-2">Proyecto industrial</div>
            <div className="grid gap-2">
              <label className="text-sm">
                Titulo de la operacion *
                <Input
                  value={operationTitle}
                  onChange={(e) => setOperationTitle(e.target.value)}
                  placeholder="Ej: Puertas rapidas para deposito central"
                  maxLength={255}
                  required
                />
              </label>

              <label className="text-sm">
                Marca principal
                <Select
                  value={mainBrand}
                  onChange={(e) => setMainBrand(e.target.value)}
                >
                  <option value="">—</option>
                  <option value="RAYFLEX">Rayflex</option>
                  <option value="BOPLAN">Boplan</option>
                </Select>
              </label>

              <label className="text-sm">
                Tipo de proyecto
                <Input
                  value={projectType}
                  onChange={(e) => setProjectType(e.target.value)}
                  placeholder="Ej: Puerta rápida, Barrera, etc."
                />
              </label>

              <label className="text-sm">
                Ubicación / Planta *
                <Select
                  value={selectedLocationKey}
                  onChange={(e) => {
                    const key = e.target.value;
                    const selected = organizationLocations.find((item) => item.key === key);
                    setSelectedLocationKey(key);
                    setLocation(selected?.label || '');
                  }}
                  disabled={!selectedOrg}
                  required
                >
                  <option value="">
                    {selectedOrg ? 'Seleccionar matriz o sucursal' : 'Primero selecciona una organización'}
                  </option>
                  {organizationLocations.map((item) => (
                    <option key={item.key} value={item.key}>{item.label}</option>
                  ))}
                </Select>
                <button
                  type="button"
                  className="mt-2 text-sm text-emerald-700 hover:underline"
                  onClick={openBranchForm}
                >
                  {selectedOrg ? '+ Agregar sucursal' : '+ Crear organización y sucursal'}
                </button>
              </label>

              <label className="text-sm">
                Notas internas
                <textarea
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Detalle técnico, referencias, comentarios…"
                />
              </label>
            </div>
          </div>

          {/* CRM */}
          <div className="bg-slate-50 rounded-xl p-3 md:col-span-2">
            <div className="font-medium mb-2">CRM</div>
            <div className="grid md:grid-cols-3 gap-2">
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
                  required
                >
                  <option value="">—</option>
                  {businessUnits.map((bu) => (
                    <option key={bu.id} value={bu.id}>
                      {bu.name || `BU ${bu.id}`}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="text-sm">
                Ejecutivo de cuenta *
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
              {saving ? "Creando…" : "Crear operación industrial"}
            </button>
          </div>
        </form>
      </div>

      {branchFormOpen && (
        <div className="fixed inset-4 lg:inset-auto lg:right-4 lg:top-1/2 lg:-translate-y-1/2 lg:w-96 z-[60] bg-white border shadow-xl rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <div>
              <div className="font-semibold">
                {selectedOrg ? 'Nueva sucursal' : 'Nueva organización y sucursal'}
              </div>
              <div className="text-xs text-slate-500 truncate max-w-72">
                {selectedOrg?.name || orgName || 'Completa primero los datos del cliente'}
              </div>
            </div>
            <button
              type="button"
              className="px-2 py-1 rounded border text-sm"
              onClick={() => setBranchFormOpen(false)}
                aria-label="Cerrar formulario de sucursal"
            >
              ×
            </button>
          </div>

          <form onSubmit={createBranch} className="p-4 grid gap-3 max-h-[calc(100vh-7rem)] overflow-y-auto">
            {branchError && (
              <div className="text-sm text-red-600">{branchError}</div>
            )}
            <label className="text-sm">
              Nombre de sucursal *
              <Input
                value={newBranch.name}
                onChange={(e) => setNewBranch((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Ej: Sucursal San Lorenzo"
                autoFocus
                required
              />
            </label>
            <label className="text-sm">
              Dirección
              <Input
                value={newBranch.address}
                onChange={(e) => setNewBranch((prev) => ({ ...prev, address: e.target.value }))}
                placeholder="Calle, número y referencia"
              />
            </label>
            <label className="text-sm">
              Ciudad *
              <Select
                value={newBranch.city_id}
                onChange={(e) => setNewBranch((prev) => ({ ...prev, city_id: e.target.value }))}
                required
              >
                <option value="">Seleccionar ciudad</option>
                {cities.map((city) => (
                  <option key={city.id} value={city.id}>
                    {city.name}{city.department ? ` · ${city.department}` : ''}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-sm">
              País
              <Input
                value={newBranch.country}
                onChange={(e) => setNewBranch((prev) => ({ ...prev, country: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              Teléfono
              <Input
                value={newBranch.phone}
                onChange={(e) => setNewBranch((prev) => ({ ...prev, phone: e.target.value }))}
                placeholder="+595 ..."
              />
            </label>
            <label className="text-sm">
              Email
              <Input
                type="email"
                value={newBranch.email}
                onChange={(e) => setNewBranch((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="sucursal@empresa.com"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="px-3 py-2 rounded-lg border text-sm"
                onClick={() => setBranchFormOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-3 py-2 rounded-lg bg-emerald-700 text-white text-sm disabled:opacity-60"
                disabled={branchSaving}
              >
                {branchSaving ? 'Guardando…' : 'Guardar sucursal'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
