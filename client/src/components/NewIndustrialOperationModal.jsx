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

/* ==================== Helpers productos catálogo ==================== */

// Normalizar items de catálogo para uso en el modal
function normalizeCatalogItem(item) {
  if (!item) return null;
  const id = item.id ?? item.item_id ?? item.code_id ?? null;
  const name = item.name ?? item.title ?? item.descripcion ?? "";
  if (!id || !name) return null;

  const type = item.type ?? item.kind ?? item.tipo ?? "PRODUCTO";
  const brand =
    item.brand ??
    item.marca ??
    item.industrial_brand ??
    item.brand_code ??
    "";

  return {
    id,
    name: String(name),
    sku: item.sku ?? item.code ?? item.item_code ?? "",
    type,
    brand: String(brand || "").toUpperCase(), // RAYFLEX / BOPLAN / ""
  };
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

  // Contactos
  const [contacts, setContacts] = useState([]);
  const [contactResults, setContactResults] = useState([]);
  const [contactLoading, setContactLoading] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactFilter, setContactFilter] = useState("");
  const debContact = useDebounced(contactFilter, 250);

  const orgBoxRef = useRef(null);
  const contactBoxRef = useRef(null);

  // ------- Productos catálogo (Rayflex / Boplan / otros) -------
  const [catalogItems, setCatalogItems] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productToAddId, setProductToAddId] = useState("");
  const [dealProducts, setDealProducts] = useState([]); // lista de productos para esta operación

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

  // Cargar productos del catálogo (todos activos) y filtrar a PRODUCTO
  useEffect(() => {
    (async () => {
      setProductsLoading(true);
      try {
        const ts = Date.now();
        const { data } = await api.get("/catalog/items", {
          params: { active: 1, t: ts },
        });
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.items)
          ? data.items
          : [];
        const normalized = list
          .map(normalizeCatalogItem)
          .filter(Boolean)
          .filter((it) => it.type === "PRODUCTO");
        setCatalogItems(normalized);
      } catch (err) {
        console.error("[industrial] load catalog items error", err);
        setCatalogItems([]);
      } finally {
        setProductsLoading(false);
      }
    })();
  }, []);

  const canSave = useMemo(() => {
    return pipelineId && stageId && orgName.trim().length > 0;
  }, [pipelineId, stageId, orgName]);

  // Productos agrupados por marca (para mostrar en el select)
  const brandsInCatalog = useMemo(() => {
    const set = new Set();
    catalogItems.forEach((it) => {
      if (it.brand) set.add(it.brand);
    });
    return Array.from(set);
  }, [catalogItems]);

  const productToAdd = useMemo(
    () =>
      catalogItems.find((it) => String(it.id) === String(productToAddId)) ||
      null,
    [catalogItems, productToAddId]
  );

  function handleAddProduct() {
    if (!productToAdd) return;
    setDealProducts((prev) => [
      ...prev,
      {
        tempId: `tmp-${Date.now()}-${Math.random()}`,
        product_id: productToAdd.id,
        product_name: productToAdd.name,
        brand: productToAdd.brand || "",
      },
    ]);
    setProductToAddId("");
    // Si aún no definiste marca principal, podés usar la de este primer producto
    if (!mainBrand && productToAdd.brand) {
      setMainBrand(productToAdd.brand.toUpperCase());
    }
  }

  function handleRemoveProduct(tempId) {
    setDealProducts((prev) => prev.filter((p) => p.tempId !== tempId));
  }

  // Referencia visual
  useEffect(() => {
    const brandLabel = mainBrand
      ? mainBrand === "RAYFLEX"
        ? "Rayflex"
        : mainBrand === "BOPLAN"
        ? "Boplan"
        : mainBrand
      : "";
    const firstProd = dealProducts[0]?.product_name || "";
    const parts = [brandLabel, orgName, projectType, location, firstProd]
      .map((x) => (x || "").trim())
      .filter(Boolean);
    setReferencePreview(parts.length ? parts.join(" • ") : "—");
  }, [mainBrand, orgName, projectType, location, dealProducts]);

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
    const v = e.target.value;
    setOrgName(v);
    setOrgQuery(v);
    setSelectedOrg(null);
    setContacts([]);
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

    if (list && list.length === 1) {
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
    e && e.preventDefault && e.preventDefault();
    if (!canSave || saving) return;
    setSaving(true);

    try {
      const brandLabel =
        mainBrand === "RAYFLEX"
          ? "Rayflex"
          : mainBrand === "BOPLAN"
          ? "Boplan"
          : mainBrand || "";

      const firstProd = dealProducts[0]?.product_name || "";
      const titleFromForm = [brandLabel, orgName, firstProd]
        .map((x) => (x || "").trim())
        .filter(Boolean)
        .join(" · ");
      const safeTitle = titleFromForm || "Operación industrial";

      const payload = {
        pipeline_id: pipelineId,
        stage_id: stageId,
        title: safeTitle,
        value: 0, // ya no usamos valor estimado
        business_unit_id: businessUnitId || null,
        account_exec_id: execId || null,
        org_name: orgName || null,
        contact_name: contactName || null,
        contact_phone: contactPhone || null,
        contact_email: contactEmail || null,
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

      // Crear puertas iniciales en industrial_doors según los productos seleccionados
      if (dealProducts.length) {
        await Promise.all(
          dealProducts.map((p, idx) =>
            api.post(`/deals/${dealId}/industrial-doors`, {
              product_id: p.product_id,
              // Identifier inicial: P1, P2, ...
              identifier: `P${idx + 1}`,
              // Opcionalmente podríamos enviar brand/product_name,
              // pero el backend ya los puede resolver desde catalog_items.
            })
          )
        );
      }

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
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl">
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
                Organización
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

              <label className="text-sm" ref={contactBoxRef}>
                Contacto
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

          {/* Proyecto industrial */}
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="font-medium mb-2">Proyecto industrial</div>
            <div className="grid gap-2">
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
                Ubicación / Planta
                <Input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Ciudad, planta, sucursal…"
                />
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

          {/* Productos industriales seleccionados */}
          <div className="bg-slate-50 rounded-xl p-3 md:col-span-2">
            <div className="font-medium mb-2">Productos industriales</div>

            <div className="flex flex-col md:flex-row gap-2 mb-3">
              <div className="flex-1">
                <Select
                  value={productToAddId || ""}
                  onChange={(e) => setProductToAddId(e.target.value)}
                >
                  <option value="">
                    {productsLoading
                      ? "Cargando productos…"
                      : "Seleccionar producto del catálogo…"}
                  </option>
                  {brandsInCatalog.map((b) => (
                    <optgroup key={b || "sin-marca"} label={b || "Sin marca"}>
                      {catalogItems
                        .filter((it) => it.brand === b)
                        .map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.name}
                            {it.sku ? ` · ${it.sku}` : ""}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                  {/* También listamos productos sin marca, si existiesen */}
                  {catalogItems
                    .filter((it) => !it.brand)
                    .map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name}
                        {it.sku ? ` · ${it.sku}` : ""}
                      </option>
                    ))}
                </Select>
              </div>
              <button
                type="button"
                className="px-3 py-2 text-sm rounded-lg bg-black text-white disabled:opacity-60"
                onClick={handleAddProduct}
                disabled={!productToAdd}
              >
                + Agregar a la operación
              </button>
            </div>

            {dealProducts.length === 0 ? (
              <div className="text-xs text-slate-500">
                No hay productos agregados. Seleccioná uno del catálogo y haga
                clic en &quot;Agregar a la operación&quot;. Podés mezclar Rayflex,
                Boplan y otros productos.
              </div>
            ) : (
              <div className="border rounded-lg bg-white overflow-hidden">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-100 text-slate-600">
                    <tr>
                      <th className="px-2 py-1 text-left w-24">Marca</th>
                      <th className="px-2 py-1 text-left">Producto</th>
                      <th className="px-2 py-1 text-right w-16">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dealProducts.map((p) => (
                      <tr key={p.tempId} className="border-t">
                        <td className="px-2 py-1 align-top">
                          {p.brand || "—"}
                        </td>
                        <td className="px-2 py-1 align-top">{p.product_name}</td>
                        <td className="px-2 py-1 align-top text-right">
                          <button
                            type="button"
                            className="px-2 py-0.5 rounded border border-red-500 text-red-600"
                            onClick={() => handleRemoveProduct(p.tempId)}
                          >
                            Quitar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-3 py-2 text-[11px] text-slate-500">
                  Los detalles de medidas, SECOT, lado de instalación, etc. se
                  completan luego en el <strong>detalle de operación
                  industrial</strong>, puerta por puerta.
                </div>
              </div>
            )}
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
              {saving ? "Creando…" : "Crear operación industrial"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}