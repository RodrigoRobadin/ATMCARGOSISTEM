import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../api";

const TYPES = [
  { value: "PRODUCTO", label: "Producto" },
  { value: "SERVICIO", label: "Servicio" },
];

const CURRENCIES = ["USD", "PYG", "EUR"];
const UNITS = ["UN", "KG", "M3", "SERV"];
const MODALITIES = ["MARITIMO", "AEREO", "TERRESTRE", "MULTIMODAL"];
const CATEGORY_PRESETS = [
  "Flete marítimo",
  "Flete aéreo",
  "Flete terrestre",
  "Gastos portuarios",
  "Gastos aeroportuarios",
  "Documentación",
  "Despacho aduanero",
  "Seguro",
  "Honorarios",
  "Transporte interno",
  "Almacenaje",
  "Servicio técnico",
];

function normalizeModalities(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((it) => String(it || "").trim().toUpperCase()).filter(Boolean))];
  }
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return normalizeModalities(parsed);
  } catch {}
  return String(value)
    .split(",")
    .map((it) => it.trim().toUpperCase())
    .filter(Boolean);
}

function normalizeItemRow(row = {}) {
  const rawType = row.type ?? row.kind ?? row.tipo ?? "PRODUCTO";
  let type = "PRODUCTO";
  if (rawType === "PRODUCT" || rawType === "PRODUCTO") type = "PRODUCTO";
  else if (rawType === "SERVICE" || rawType === "SERVICIO") type = "SERVICIO";

  const sku = row.sku ?? row.code ?? row.item_code ?? null;
  const name = row.name ?? row.item_name ?? row.title ?? row.descripcion ?? "";
  const unit = row.unit ?? row.uom ?? row.unidad ?? "UN";
  const currency = row.currency ?? row.moneda ?? "USD";
  const active = row.active ?? row.enabled ?? row.activo ?? 1;
  const description = row.description ?? row.detalle ?? row.notes ?? null;
  const category = row.category ?? row.categoria ?? null;
  const appliesToModalities = normalizeModalities(
    row.applies_to_modalities ?? row.modalities ?? row.modalidad_aplicable ?? []
  );
  const price = Number(row.price ?? row.unit_price ?? row.precio ?? 0) || 0;
  const taxRate = Number(row.tax_rate ?? row.vat_pct ?? row.iva ?? 0) || 0;
  const brand = row.brand ?? row.marca ?? null;

  return {
    type,
    sku,
    name,
    brand,
    category,
    description,
    applies_to_modalities: appliesToModalities,
    unit,
    currency,
    price,
    tax_rate: taxRate,
    active: active ? 1 : 0,
  };
}

function toViewRow(item = {}) {
  const id = item.id ?? item.item_id ?? item.code_id ?? item.pk ?? Math.random();
  return {
    id,
    type: item.type ?? item.kind ?? item.tipo ?? "PRODUCTO",
    sku: item.sku ?? item.code ?? item.item_code ?? "",
    name: item.name ?? item.title ?? item.descripcion ?? "",
    brand: item.brand ?? item.marca ?? "",
    category: item.category ?? item.categoria ?? "",
    description: item.description ?? item.detalle ?? item.notes ?? "",
    applies_to_modalities: normalizeModalities(item.applies_to_modalities ?? item.modalities ?? item.modalidad_aplicable ?? []),
    unit: item.unit ?? item.uom ?? item.unidad ?? "UN",
    currency: item.currency ?? item.moneda ?? "USD",
    price: Number(item.price ?? item.unit_price ?? item.precio ?? 0) || 0,
    tax_rate: Number(item.tax_rate ?? item.vat_pct ?? item.iva ?? 0) || 0,
    active: item.active ?? item.enabled ?? item.activo ?? 1,
  };
}

function createEmptyItem() {
  return {
    id: null,
    type: "PRODUCTO",
    sku: "",
    name: "",
    brand: "",
    category: "",
    description: "",
    applies_to_modalities: [],
    unit: "UN",
    currency: "USD",
    price: 0,
    tax_rate: 0,
    active: 1,
    __isNew: true,
  };
}

function formatMoney(value, currency) {
  const amount = Number(value || 0);
  try {
    return new Intl.NumberFormat("es-PY", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: currency === "PYG" ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency || "USD"} ${amount.toFixed(2)}`;
  }
}

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      {children}
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </label>
  );
}

export default function ProductsServices() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [onlyActive, setOnlyActive] = useState(true);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [modalityFilter, setModalityFilter] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const load = async ({ preserveSelection = true, forceSelectId = null } = {}) => {
    setLoading(true);
    setErr("");
    try {
      const { data } = await api.get("/catalog/items", {
        params: { active: onlyActive ? 1 : 0, t: Date.now() },
      });
      const list = (Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []).map(toViewRow);
      setRows(list);

      const desiredId = forceSelectId ?? (preserveSelection ? selectedId : null);
      if (desiredId != null) {
        const found = list.find((item) => String(item.id) === String(desiredId));
        if (found) {
          setSelectedId(found.id);
          setDraft({ ...found });
          return;
        }
      }

      if (!draft?.__isNew) {
        const first = list[0] || null;
        setSelectedId(first?.id ?? null);
        setDraft(first ? { ...first } : createEmptyItem());
      }
    } catch (e) {
      console.error("[catalog] load", e);
      setErr(
        typeof e?.response?.data === "string"
          ? e.response.data
          : "No se pudo cargar el catálogo."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load({ preserveSelection: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyActive]);

  useEffect(() => {
    if (!rows.length && !draft) setDraft(createEmptyItem());
  }, [rows, draft]);

  const brandOptions = useMemo(() => {
    const set = new Set();
    rows.forEach((r) => {
      const b = String(r.brand || "").trim();
      if (b) set.add(b);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const categoryOptions = useMemo(() => {
    const set = new Set(CATEGORY_PRESETS);
    rows.forEach((r) => {
      const value = String(r.category || "").trim();
      if (value) set.add(value);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter && r.type !== typeFilter) return false;
      if (brandFilter && String(r.brand || "") !== brandFilter) return false;
      if (categoryFilter && String(r.category || "") !== categoryFilter) return false;
      if (modalityFilter && !normalizeModalities(r.applies_to_modalities).includes(modalityFilter)) return false;
      if (!term) return true;
      return [r.name, r.sku, r.brand, r.category, r.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [rows, typeFilter, brandFilter, categoryFilter, modalityFilter, search]);

  const stats = useMemo(() => {
    const total = rows.length;
    const active = rows.filter((r) => !!r.active).length;
    const services = rows.filter((r) => r.type === "SERVICIO").length;
    const products = rows.filter((r) => r.type === "PRODUCTO").length;
    return { total, active, services, products };
  }, [rows]);

  const updateDraft = (key, value) => {
    setDraft((prev) => ({ ...(prev || createEmptyItem()), [key]: value }));
  };

  const toggleDraftModality = (modality) => {
    setDraft((prev) => {
      const base = prev || createEmptyItem();
      const selected = new Set(normalizeModalities(base.applies_to_modalities));
      if (selected.has(modality)) selected.delete(modality);
      else selected.add(modality);
      return { ...base, applies_to_modalities: Array.from(selected) };
    });
  };

  const openItem = (item) => {
    setSelectedId(item.id);
    setDraft({ ...item, applies_to_modalities: normalizeModalities(item.applies_to_modalities) });
    setErr("");
  };

  const startNew = () => {
    setSelectedId("new");
    setDraft(createEmptyItem());
    setErr("");
  };

  const duplicateItem = (item) => {
    setSelectedId("new");
    setDraft({
      ...item,
      id: null,
      sku: "",
      name: item.name ? `${item.name} copia` : "",
      applies_to_modalities: normalizeModalities(item.applies_to_modalities),
      __isNew: true,
    });
    setErr("");
  };

  const saveDraft = async () => {
    if (!draft) return;
    if (!String(draft.name || "").trim()) {
      setErr("El nombre es obligatorio.");
      return;
    }

    setSaving(true);
    setErr("");
    const payload = normalizeItemRow(draft);

    try {
      if (draft.__isNew || !draft.id || draft.id === "new") {
        const { data } = await api.post("/catalog/items", payload);
        await load({ preserveSelection: false, forceSelectId: data?.id ?? null });
      } else {
        await api.put(`/catalog/items/${draft.id}`, payload);
        await load({ preserveSelection: false, forceSelectId: draft.id });
      }
    } catch (e) {
      console.error("[catalog] save", e);
      setErr(
        e?.response?.data
          ? typeof e.response.data === "string"
            ? e.response.data
            : JSON.stringify(e.response.data)
          : "No se pudo guardar el ítem."
      );
    } finally {
      setSaving(false);
    }
  };

  const removeItem = async (item) => {
    if (!item?.id) {
      startNew();
      return;
    }
    if (!window.confirm(`Eliminar "${item.name || item.sku || "ítem"}"?`)) return;

    setDeletingId(item.id);
    setErr("");
    try {
      await api.delete(`/catalog/items/${item.id}`);
      const nextRows = rows.filter((r) => String(r.id) !== String(item.id));
      setRows(nextRows);
      const first = nextRows[0] || null;
      setSelectedId(first?.id ?? null);
      setDraft(first ? { ...first } : createEmptyItem());
    } catch (e) {
      console.error("[catalog] delete", e);
      setErr(
        typeof e?.response?.data === "string"
          ? e.response.data
          : "No se pudo eliminar el ítem."
      );
    } finally {
      setDeletingId(null);
    }
  };

  const toggleActive = async (item) => {
    try {
      await api.put(`/catalog/items/${item.id}`, normalizeItemRow({ ...item, active: item.active ? 0 : 1 }));
      await load({ preserveSelection: false, forceSelectId: selectedId === item.id ? item.id : selectedId });
    } catch (e) {
      console.error("[catalog] toggle active", e);
      setErr("No se pudo actualizar el estado del ítem.");
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
              Catálogo base para ATM Cargo
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
              Productos y servicios
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Administra los ítems que después alimentan la planilla de costos: fletes, gastos,
              servicios y productos base. El listado queda para consulta rápida y la edición vive
              en un panel lateral más ordenado.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={!!onlyActive}
                onChange={(e) => setOnlyActive(e.target.checked)}
              />
              Mostrar solo activos
            </label>
            <button
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              onClick={() => load({ preserveSelection: true })}
            >
              Recargar
            </button>
            <button
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              onClick={startNew}
            >
              + Nuevo ítem
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total" value={stats.total} hint="Catálogo visible con el filtro actual de activos" />
        <StatCard label="Activos" value={stats.active} hint="Ítems disponibles para usar en DET COS" />
        <StatCard label="Productos" value={stats.products} hint="Ítems de tipo producto" />
        <StatCard label="Servicios" value={stats.services} hint="Ítems de tipo servicio" />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[180px_180px_220px_180px_minmax(0,1fr)]">
          <Field label="Tipo">
            <select
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="">Todos</option>
              <option value="PRODUCTO">Productos</option>
              <option value="SERVICIO">Servicios</option>
            </select>
          </Field>
          <Field label="Marca">
            <select
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={brandFilter}
              onChange={(e) => setBrandFilter(e.target.value)}
            >
              <option value="">Todas</option>
              {brandOptions.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </Field>
          <Field label="Categoría">
            <select
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">Todas</option>
              {categoryOptions.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </Field>
          <Field label="Modalidad">
            <select
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={modalityFilter}
              onChange={(e) => setModalityFilter(e.target.value)}
            >
              <option value="">Todas</option>
              {MODALITIES.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </Field>
          <Field label="Buscar" hint="Busca por nombre, SKU, marca, categoría o descripción.">
            <input
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Flete marítimo, THC, SRV-HORA, Rayflex..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
        </div>
      </section>

      {err ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {err}
        </div>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Catálogo</h2>
              <p className="text-sm text-slate-500">Listado limpio para revisar, filtrar y seleccionar el ítem a editar.</p>
            </div>
            <div className="text-sm text-slate-500">{filtered.length} resultado(s)</div>
          </div>

          {loading ? (
            <div className="px-5 py-10 text-sm text-slate-500">Cargando catálogo...</div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-500">
              No hay ítems con los filtros actuales.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Ítem</th>
                    <th className="px-4 py-3 text-left font-medium">Categoría</th>
                    <th className="px-4 py-3 text-left font-medium">Modalidad</th>
                    <th className="px-4 py-3 text-left font-medium">Precio base</th>
                    <th className="px-4 py-3 text-left font-medium">IVA</th>
                    <th className="px-4 py-3 text-left font-medium">Estado</th>
                    <th className="px-5 py-3 text-right font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => {
                    const isSelected = String(selectedId) === String(item.id);
                    return (
                      <tr
                        key={item.id}
                        className={`border-t border-slate-100 ${isSelected ? "bg-sky-50/70" : "hover:bg-slate-50"}`}
                      >
                        <td className="px-5 py-4">
                          <button className="block text-left" onClick={() => openItem(item)}>
                            <div className="font-medium text-slate-900">{item.name || "Sin nombre"}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              <span className={`mr-2 inline-flex rounded-full px-2 py-0.5 font-medium ${item.type === "SERVICIO" ? "bg-violet-100 text-violet-700" : "bg-emerald-100 text-emerald-700"}`}>
                                {item.type}
                              </span>
                              {item.sku ? `SKU ${item.sku}` : "Sin SKU"}
                              {item.brand ? ` · ${item.brand}` : ""}
                            </div>
                          </button>
                        </td>
                        <td className="px-4 py-4 text-slate-700">{item.category || "-"}</td>
                        <td className="px-4 py-4 text-slate-700">
                          {normalizeModalities(item.applies_to_modalities).length
                            ? normalizeModalities(item.applies_to_modalities).join(", ")
                            : "Todas"}
                        </td>
                        <td className="px-4 py-4 text-slate-700">{formatMoney(item.price, item.currency)}</td>
                        <td className="px-4 py-4 text-slate-700">{Number(item.tax_rate || 0)}%</td>
                        <td className="px-4 py-4">
                          <button
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${item.active ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-500"}`}
                            onClick={() => toggleActive(item)}
                          >
                            {item.active ? "Activo" : "Inactivo"}
                          </button>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-2">
                            <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700" onClick={() => openItem(item)}>
                              Editar
                            </button>
                            <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700" onClick={() => duplicateItem(item)}>
                              Duplicar
                            </button>
                            <button
                              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600"
                              onClick={() => removeItem(item)}
                              disabled={deletingId === item.id}
                            >
                              {deletingId === item.id ? "Eliminando..." : "Eliminar"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {draft?.__isNew ? "Alta" : "Edición"}
                </div>
                <h2 className="mt-1 text-xl font-semibold text-slate-900">
                  {draft?.__isNew ? "Nuevo ítem" : draft?.name || "Editar ítem"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Este panel concentra el alta y edición. La tabla queda solo para navegar y elegir.
                </p>
              </div>
              <button className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600" onClick={startNew}>
                Limpiar
              </button>
            </div>

            <div className="mt-5 space-y-5">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                <Field label="Tipo">
                  <select
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    value={draft?.type || "PRODUCTO"}
                    onChange={(e) => updateDraft("type", e.target.value)}
                  >
                    {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </Field>
                <Field label="Activo" hint="Los inactivos se conservan, pero no se ofrecen por defecto en DET COS.">
                  <label className="inline-flex h-[42px] items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={!!draft?.active}
                      onChange={(e) => updateDraft("active", e.target.checked ? 1 : 0)}
                    />
                    Disponible para usar
                  </label>
                </Field>
              </div>

              <Field label="Nombre" hint="Usa el nombre operativo que después verá el equipo al cargar costos.">
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={draft?.name || ""}
                  onChange={(e) => updateDraft("name", e.target.value)}
                  placeholder="Flete marítimo, documentación, servicio técnico..."
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                <Field label="SKU">
                  <input
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    value={draft?.sku || ""}
                    onChange={(e) => updateDraft("sku", e.target.value)}
                    placeholder="Código opcional"
                  />
                </Field>
                <Field label="Marca / proveedor">
                  <input
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    value={draft?.brand || ""}
                    onChange={(e) => updateDraft("brand", e.target.value)}
                    placeholder="Naviera, agente, proveedor, marca"
                  />
                </Field>
              </div>

              <Field label="Categoría" hint="Agrupa el ítem según el tipo de costo que después usarás en DET COS.">
                <input
                  list="catalog-category-options"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={draft?.category || ""}
                  onChange={(e) => updateDraft("category", e.target.value)}
                  placeholder="Flete marítimo, documentación, seguro..."
                />
                <datalist id="catalog-category-options">
                  {categoryOptions.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </Field>

              <Field label="Modalidad aplicable" hint="Sirve para sugerir el ítem correcto según la operación de ATM Cargo.">
                <div className="flex flex-wrap gap-2">
                  {MODALITIES.map((modality) => {
                    const selected = normalizeModalities(draft?.applies_to_modalities).includes(modality);
                    return (
                      <button
                        key={modality}
                        type="button"
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium ${selected ? "border-sky-300 bg-sky-50 text-sky-700" : "border-slate-200 text-slate-600"}`}
                        onClick={() => toggleDraftModality(modality)}
                      >
                        {modality}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label="Descripción interna" hint="Útil para aclarar el uso del ítem dentro de la planilla de costos.">
                <textarea
                  className="min-h-[88px] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={draft?.description || ""}
                  onChange={(e) => updateDraft("description", e.target.value)}
                  placeholder="Ej.: usar para gastos documentales de importación aérea"
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Unidad">
                  <select
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    value={draft?.unit || "UN"}
                    onChange={(e) => updateDraft("unit", e.target.value)}
                  >
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </Field>
                <Field label="Moneda">
                  <select
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    value={draft?.currency || "USD"}
                    onChange={(e) => updateDraft("currency", e.target.value)}
                  >
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Precio base">
                  <input
                    type="number"
                    step="0.01"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    value={draft?.price ?? 0}
                    onChange={(e) => updateDraft("price", e.target.value)}
                  />
                </Field>
                <Field label="IVA %">
                  <input
                    type="number"
                    step="0.01"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    value={draft?.tax_rate ?? 0}
                    onChange={(e) => updateDraft("tax_rate", e.target.value)}
                  />
                </Field>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                <div className="font-medium text-slate-800">Vista rápida</div>
                <div className="mt-2">{draft?.type || "PRODUCTO"} · {draft?.unit || "UN"} · {draft?.currency || "USD"}</div>
                <div className="mt-1">Categoría: {draft?.category || "Sin categoría"}</div>
                <div className="mt-1">
                  Modalidades: {normalizeModalities(draft?.applies_to_modalities).length ? normalizeModalities(draft?.applies_to_modalities).join(", ") : "Todas"}
                </div>
                <div className="mt-1">Precio base: {formatMoney(draft?.price, draft?.currency)}</div>
                <div className="mt-1">IVA: {Number(draft?.tax_rate || 0)}%</div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-200 pt-4">
              <button
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={saveDraft}
                disabled={saving}
              >
                {saving ? "Guardando..." : draft?.__isNew ? "Crear ítem" : "Guardar cambios"}
              </button>
              {!draft?.__isNew && draft?.id ? (
                <button
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700"
                  onClick={() => duplicateItem(draft)}
                >
                  Duplicar
                </button>
              ) : null}
              {!draft?.__isNew && draft?.id ? (
                <button
                  className="rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600"
                  onClick={() => removeItem(draft)}
                  disabled={deletingId === draft.id}
                >
                  {deletingId === draft.id ? "Eliminando..." : "Eliminar"}
                </button>
              ) : null}
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
