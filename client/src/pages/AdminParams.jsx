// client/src/pages/AdminParams.jsx
import React, { useEffect, useMemo, useState } from "react";
import { API_BASE, api } from "../api";
import { parseCompanyBankAccountRow } from "../utils/companyBankAccounts";

// === Grupos de parametros administrables ===
const PARAM_GROUPS = [
  {
    title: "Organizaciones",
    description: "Opciones usadas en el formulario de organizaciones.",
    keys: ["org_tipo", "org_rubro", "org_operacion"],
  },
  {
    title: "Operacion",
    description: "Listas para usar en la operacion (detalle).",
    keys: ["tipo_operacion", "modalidad_carga", "tipo_carga", "incoterm"],
  },
  {
    title: "Kanban / Pipeline",
    description:
      "Configura alias y visibilidad de columnas. Para un workspace en particular, crea la misma clave con sufijo __{key_slug}, ej.: kanban_stage_labels__atm-cargo.",
    keys: ["kanban_stage_labels", "kanban_hide_stages", "kanban_pipeline_id"],
  },
  {
    title: "Presupuesto - Terminos",
    description:
      "Opciones administrables del presupuesto (se veran como sugerencias en el generador).",
    keys: [
      "quote_validez",
      "quote_condicion_venta",
      "quote_plazo_credito",
      "quote_forma_pago",
      "quote_incluye",
      "quote_no_incluye",
    ],
  },
  {
    title: "Presupuesto - Plantillas de condiciones",
    description:
      "Plantillas completas para presupuesto industrial (contenido en JSON).",
    keys: ["quote_template"],
  },
  {
    title: "Presupuesto - Branding",
    description:
      "Logo y datos fijos del PDF formal de cotizacion.",
    keys: [
      "quote_brand_logo_url",
      "quote_brand_city",
      "quote_brand_footer_web",
      "quote_brand_footer_address",
      "quote_brand_footer_phone",
    ],
  },
  {
    title: "Kanban",
    description: "Config simple por nombre o ID (los nombres ganan).",
    keys: [
      "kanban_pipeline",
      "kanban_pipeline_id",
      "kanban_stage_alias",
      "kanban_hide_stage",
    ],
  },
  {
    title: "Facturaci?n",
    description:
      "Timbrado, vigencia y numeraci?n de facturas por unidad de negocio. Las claves legacy viejas quedan ocultas y solo se usan como compatibilidad interna.",
    keys: [
      "invoice_timbre_number_cargo",
      "invoice_timbre_valid_from_cargo",
      "invoice_timbre_valid_to_cargo",
      "invoice_exp_industrial",
      "invoice_exp_cargo",
      "invoice_next_number_cargo",
      "invoice_timbre_number_industrial",
      "invoice_timbre_valid_from_industrial",
      "invoice_timbre_valid_to_industrial",
      "invoice_next_number_industrial",
    ],
  },
  {
    title: "Notas de cr?dito",
    description:
      "Serie fiscal de notas de cr?dito por unidad de negocio. El correlativo administrativo solo se usa como semilla si la serie todav?a no tiene emitidos. Las claves legacy viejas quedan ocultas en la UI.",
    keys: [
      "credit_exp_cargo",
      "credit_next_number_cargo",
      "credit_exp_industrial",
      "credit_next_number_industrial",
    ],
  },
  {
    title: "Cuentas de empresa",
    description:
      "Cuentas bancarias propias para registrar cobros de clientes y pagos a proveedores.",
    keys: ["company_bank_account"],
  },
];

// Normaliza la forma de pedir todas las claves
function buildKeysParam() {
  const all = PARAM_GROUPS.flatMap((g) => g.keys);
  return all.join(",");
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function AdminParams() {
  const [loading, setLoading] = useState(true);
  const [map, setMap] = useState({}); // { key: [{id,value,ord,active}, ...] }
  const [invoiceNumbering, setInvoiceNumbering] = useState(null);
  const [creditNumbering, setCreditNumbering] = useState(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [openSections, setOpenSections] = useState(() => new Set([slugify(PARAM_GROUPS[0]?.title), slugify("Facturaci?n")]));
  const keysParam = useMemo(buildKeysParam, []);
  const groupedSections = useMemo(
    () =>
      PARAM_GROUPS.map((group) => ({
        ...group,
        sectionId: slugify(group.title),
      })),
    []
  );

  async function loadInvoiceNumberingStatus() {
    try {
      const { data } = await api.get("/invoices/numbering-status");
      setInvoiceNumbering(data || null);
    } catch {
      setInvoiceNumbering(null);
    }
  }

  async function loadCreditNumberingStatus() {
    try {
      const { data } = await api.get("/invoices/credit-numbering-status");
      setCreditNumbering(data || null);
    } catch {
      setCreditNumbering(null);
    }
  }

  // Carga inicial
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/params", {
          params: { keys: keysParam },
        });
        const next = {};
        PARAM_GROUPS.flatMap((g) => g.keys).forEach((k) => {
          next[k] = (Array.isArray(data?.[k]) ? data[k] : []).map((r) => ({
            id: r.id,
            value: r.value,
            ord: r.ord ?? 0,
            active: r.active === 0 ? 0 : 1,
          }));
          next[k].sort((a, b) => (a.ord || 0) - (b.ord || 0));
        });
        setMap(next);
      } finally {
        setLoading(false);
      }
    })();
  }, [keysParam]);

  useEffect(() => {
    loadInvoiceNumberingStatus();
    loadCreditNumberingStatus();
  }, []);

  async function createParam(key, payload) {
    const body = {
      key,
      value: payload.value ?? "",
      ord: payload.ord ?? 0,
      active: payload.active === 0 ? 0 : 1,
    };
    const { data } = await api.post("/params", body);
    return data; // {id, key, value, ord, active}
  }

  async function updateParam(row) {
    const id = row.id;
    const body = {
      value: row.value,
      ord: row.ord ?? 0,
      active: row.active === 0 ? 0 : 1,
    };
    // El backend expone PATCH
    await api.patch(`/params/${id}`, body);
  }

  async function deleteParam(id) {
    await api.delete(`/params/${id}`);
  }

  function setKeyList(key, updater) {
    setMap((prev) => ({ ...prev, [key]: updater(prev[key] || []) }));
  }

  function changeFirstParamValue(key, value) {
    setKeyList(key, (list) => {
      if (!list.length) return [{ id: null, value, ord: 0, active: 1 }];
      return list.map((row, idx) =>
        idx === 0 ? { ...row, value, active: 1 } : row
      );
    });
  }

  async function saveFirstParamValue(key) {
    const row = (map[key] || [])[0];
    if (row?.id) {
      await updateParam({ ...row, active: 1 });
      return row;
    }
    const created = await createParam(key, {
      value: row?.value || "",
      ord: 0,
      active: 1,
    });
    setKeyList(key, (list) => {
      const rest = list.filter((item) => item.id);
      return [{ ...created, active: created.active ? 1 : 0 }, ...rest];
    });
    return created;
  }

  async function saveFiscalStampSettings(unit) {
    const suffix = unit === "industrial" ? "industrial" : "cargo";
    const keys = [
      `invoice_timbre_number_${suffix}`,
      `invoice_timbre_valid_from_${suffix}`,
      `invoice_timbre_valid_to_${suffix}`,
    ];
    const hasMissingValue = keys.some((key) => !String((map[key] || [])[0]?.value || "").trim());
    if (hasMissingValue) {
      alert("Completa numero de timbrado, inicio y fin de vigencia antes de guardar.");
      return;
    }
    setSaving(true);
    try {
      for (const key of keys) {
        await saveFirstParamValue(key);
      }
      await loadInvoiceNumberingStatus();
      alert("Timbrado actualizado.");
    } finally {
      setSaving(false);
    }
  }

  async function addRow(key, newValue) {
    if (!String(newValue || "").trim()) return;
    setSaving(true);
    try {
      const created = await createParam(key, {
        value: newValue,
        ord: (map[key]?.[map[key].length - 1]?.ord || 0) + 10,
        active: 1,
      });
      setKeyList(key, (list) => {
        const next = [...list, { ...created, active: created.active ? 1 : 0 }];
        next.sort((a, b) => (a.ord || 0) - (b.ord || 0));
        return next;
      });
      if (key.startsWith("invoice_")) await loadInvoiceNumberingStatus();
      if (key.startsWith("credit_")) await loadCreditNumberingStatus();
    } finally {
      setSaving(false);
    }
  }

  async function saveRow(key, idx) {
    const row = map[key][idx];
    setSaving(true);
    try {
      await updateParam(row);
      if (key.startsWith("invoice_")) await loadInvoiceNumberingStatus();
      if (key.startsWith("credit_")) await loadCreditNumberingStatus();
    } finally {
      setSaving(false);
    }
  }

  async function removeRow(key, idx) {
    const row = map[key][idx];
    if (!row?.id) return;
    if (!window.confirm("¿Eliminar este valor?")) return;
    setSaving(true);
    try {
      await deleteParam(row.id);
      setKeyList(key, (list) => list.filter((_, i) => i !== idx));
      if (key.startsWith("invoice_")) await loadInvoiceNumberingStatus();
      if (key.startsWith("credit_")) await loadCreditNumberingStatus();
    } finally {
      setSaving(false);
    }
  }

  const searchTerm = search.trim().toLowerCase();
  const visibleSections = groupedSections
    .map((group) => ({
      ...group,
      visibleKeys: group.keys.filter((key) => {
        if (!searchTerm) return true;
        return [group.title, group.description, prettyLabel(key), key]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(searchTerm));
      }),
    }))
    .filter((group) => group.visibleKeys.length > 0)
    .map((group) => ({
      ...group,
      isOpen: searchTerm ? true : openSections.has(group.sectionId),
    }));

  function toggleSection(sectionId) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  if (loading) return <div className="text-sm text-slate-600">Cargando?</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-5 shadow">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-2">
            <div className="inline-flex w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
              Parametros del sistema
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Administraci?n de Par?metros</h1>
              <p className="max-w-3xl text-sm text-slate-600">
                Agrupa la configuraci?n por bloque funcional para que puedas ubicar y editar m?s r?pido cada secci?n del sistema.
              </p>
            </div>
          </div>

          <div className="w-full xl:max-w-sm">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Buscar par?metro o secci?n
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ej.: timbrado, logo, incoterm"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="rounded-2xl bg-white p-4 shadow xl:sticky xl:top-4 xl:h-fit">
          <div className="mb-3 text-sm font-semibold text-slate-900">Bloques</div>
          <div className="space-y-2">
            {visibleSections.map((group) => (
              <button
                key={group.sectionId}
                type="button"
                onClick={() => {
                  document.getElementById(group.sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
                  if (!group.isOpen) toggleSection(group.sectionId);
                }}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                <span>{group.title}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                  {group.visibleKeys.length}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <div className="space-y-4">
          {!visibleSections.length && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500 shadow">
              No hay coincidencias para la b?squeda actual.
            </div>
          )}

          {visibleSections.map((group) => (
            <section
              key={group.sectionId}
              id={group.sectionId}
              className="rounded-2xl bg-white shadow"
            >
              <button
                type="button"
                onClick={() => toggleSection(group.sectionId)}
                className="flex w-full flex-col gap-3 rounded-2xl p-4 text-left lg:flex-row lg:items-start lg:justify-between"
              >
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold text-slate-900">{group.title}</h2>
                    <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {group.visibleKeys.length} campo{group.visibleKeys.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  {group.description && (
                    <p className="mt-1 max-w-3xl text-sm text-slate-600">
                      {group.description}
                    </p>
                  )}
                </div>
                <span className="text-sm font-semibold text-slate-500">
                  {group.isOpen ? "Ocultar" : "Mostrar"}
                </span>
              </button>

              {group.isOpen && (
                <div className="border-t border-slate-100 p-4 pt-4">
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {group.title === "Facturaci?n" && (
                      <div className="lg:col-span-2">
                        <FiscalStampQuickEditor
                          map={map}
                          saving={saving}
                          onChange={changeFirstParamValue}
                          onSave={saveFiscalStampSettings}
                        />
                        <InvoiceNumberingStatusPanel status={invoiceNumbering} />
                  </div>
                )}
                {group.title === "Notas de cr?dito" && (
                  <div className="lg:col-span-2">
                    <CreditNoteNumberingStatusPanel status={creditNumbering} />
                      </div>
                    )}
                    {group.visibleKeys.map((key) => (
                      <ParamCard
                        key={key}
                        label={key}
                        keyName={key}
                        rows={map[key] || []}
                        onReplaceRows={(nextRows) => setKeyList(key, () => nextRows)}
                        onChangeRow={(idx, patch) =>
                          setKeyList(key, (list) =>
                            list.map((r, i) => (i === idx ? { ...r, ...patch } : r))
                          )
                        }
                        onClickSave={(idx) => saveRow(key, idx)}
                        onClickRemove={(idx) => removeRow(key, idx)}
                        onAdd={(val) => addRow(key, val)}
                        saving={saving}
                      />
                    ))}
                  </div>
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Tarjeta de edición de una clave de parámetros */
function ParamCard({
  label,
  keyName,
  rows,
  onReplaceRows,
  onChangeRow,
  onClickSave,
  onClickRemove,
  onAdd,
  saving,
}) {
  const [newVal, setNewVal] = useState("");
  const [uploading, setUploading] = useState(false);
  const [tplForm, setTplForm] = useState({
    name: "",
    observaciones: "",
    plazo_entrega: "",
    asistencia_garantia: "",
    responsabilidad_cliente: "",
    que_incluye: "",
    que_no_incluye: "",
    condicion_pago: "",
    tipo_instalacion: "",
    garantia: "",
    observaciones_producto: "",
  });
  const [accountForm, setAccountForm] = useState({
    alias: "",
    bank_name: "",
    account_holder: "",
    holder_ruc: "",
    account_number: "",
    currency_code: "PYG",
    account_type: "",
    cci_iban: "",
    swift: "",
    notes: "",
    active: true,
  });
  const isTemplate = keyName === "quote_template";
  const isCompanyBankAccount = keyName === "company_bank_account";
  const isLogo = keyName === "quote_brand_logo_url";
  const isDate =
    keyName === "invoice_timbre_valid_from_cargo" ||
    keyName === "invoice_timbre_valid_to_cargo" ||
    keyName === "invoice_timbre_valid_from_industrial" ||
    keyName === "invoice_timbre_valid_to_industrial";
  const logoPreviewSrc =
    isLogo && rows[0]?.value
      ? String(rows[0].value).startsWith("/uploads/")
        ? `${String(API_BASE || "").replace(/\/api$/, "")}${rows[0].value}`
        : rows[0].value
      : "";

  async function uploadLogo(file) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("key", keyName);
      const { data } = await api.post("/params/upload-logo", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const nextRows = rows.length
        ? rows.map((row, idx) =>
            idx === 0
              ? {
                  ...row,
                  id: data.id,
                  value: data.value,
                  ord: data.ord ?? row.ord ?? 0,
                  active: data.active === 0 ? 0 : 1,
                }
              : row
          )
        : [
            {
              id: data.id,
              value: data.value,
              ord: data.ord ?? 0,
              active: data.active === 0 ? 0 : 1,
            },
          ];
      onReplaceRows?.(nextRows);
    } catch (e) {
      console.error("No se pudo subir el logo:", e);
      alert("No se pudo subir el logo.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="border rounded-xl p-3">
      <div className="font-medium mb-2">{prettyLabel(label)}</div>

      {isCompanyBankAccount ? (
        <CompanyBankAccountCard
          rows={rows}
          form={accountForm}
          setForm={setAccountForm}
          saving={saving}
          onChangeRow={onChangeRow}
          onClickSave={onClickSave}
          onClickRemove={onClickRemove}
          onAdd={onAdd}
        />
      ) : (
        <>

      {isLogo && (
        <div className="mb-3 rounded-lg border bg-slate-50 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={(e) => uploadLogo(e.target.files?.[0])}
              disabled={saving || uploading}
            />
            <span className="text-xs text-slate-500">
              {uploading ? "Subiendo..." : "Subi el logo para el PDF formal."}
            </span>
          </div>
          {rows[0]?.value ? (
            <div className="mt-3">
              <img
                src={logoPreviewSrc}
                alt="Logo cotizacion"
                className="max-h-24 rounded border bg-white p-2"
              />
            </div>
          ) : null}
        </div>
      )}

      {/* Tabla de valores */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-1 pr-2">Valor</th>
              <th className="py-1 pr-2 w-20">Orden</th>
              <th className="py-1 pr-2 w-28">Activo</th>
              <th className="py-1 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((r, idx) => (
                <tr key={r.id || idx} className="border-b last:border-0">
                  <td className="py-1 pr-2">
                    {isTemplate ? (
                      <textarea
                        className="w-full border rounded px-2 py-1"
                        rows={6}
                        value={r.value || ""}
                        onChange={(e) =>
                          onChangeRow(idx, { value: e.target.value })
                        }
                      />
                    ) : (
                      <input
                        type={isDate ? "date" : "text"}
                        className="w-full border rounded px-2 py-1"
                        value={r.value || ""}
                        onChange={(e) =>
                          onChangeRow(idx, { value: e.target.value })
                        }
                      />
                    )}
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      className="w-full border rounded px-2 py-1"
                      value={r.ord ?? 0}
                      onChange={(e) =>
                        onChangeRow(idx, { ord: Number(e.target.value) })
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <select
                      className="border rounded px-2 py-1 w-full"
                      value={r.active ? 1 : 0}
                      onChange={(e) =>
                        onChangeRow(idx, { active: Number(e.target.value) })
                      }
                    >
                      <option value={1}>Sí</option>
                      <option value={0}>No</option>
                    </select>
                  </td>
                  <td className="py-1">
                    <div className="flex gap-2">
                      <button
                        className="px-2 py-1 text-xs rounded border"
                        onClick={() => onClickSave(idx)}
                        disabled={saving}
                      >
                        Guardar
                      </button>
                      <button
                        className="px-2 py-1 text-xs rounded border text-red-600"
                        onClick={() => onClickRemove(idx)}
                        disabled={saving}
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="py-2 text-slate-500" colSpan={4}>
                  Sin valores aún.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

            {/* Alta rapida */}
      <div className="mt-3 space-y-2">
        {isTemplate ? (
          <div className="space-y-2">
            <div className="font-semibold text-sm">Nueva plantilla (sin JSON)</div>
            <input
              className="w-full border rounded px-2 py-1 text-sm"
              placeholder="Nombre de la plantilla"
              value={tplForm.name}
              onChange={(e) => setTplForm((f) => ({ ...f, name: e.target.value }))}
            />
            <textarea
              className="w-full border rounded px-2 py-1 text-sm"
              rows={3}
              placeholder="Observaciones"
              value={tplForm.observaciones}
              onChange={(e) => setTplForm((f) => ({ ...f, observaciones: e.target.value }))}
            />
            <textarea
              className="w-full border rounded px-2 py-1 text-sm"
              rows={2}
              placeholder="Plazo de entrega"
              value={tplForm.plazo_entrega}
              onChange={(e) => setTplForm((f) => ({ ...f, plazo_entrega: e.target.value }))}
            />
            <textarea
              className="w-full border rounded px-2 py-1 text-sm"
              rows={2}
              placeholder="Asistencia / garantía"
              value={tplForm.asistencia_garantia}
              onChange={(e) => setTplForm((f) => ({ ...f, asistencia_garantia: e.target.value }))}
            />
            <textarea
              className="w-full border rounded px-2 py-1 text-sm"
              rows={2}
              placeholder="Responsabilidad del cliente"
              value={tplForm.responsabilidad_cliente}
              onChange={(e) => setTplForm((f) => ({ ...f, responsabilidad_cliente: e.target.value }))}
            />
            <textarea
              className="w-full border rounded px-2 py-1 text-sm"
              rows={2}
              placeholder="Qué incluye"
              value={tplForm.que_incluye}
              onChange={(e) => setTplForm((f) => ({ ...f, que_incluye: e.target.value }))}
            />
            <textarea
              className="w-full border rounded px-2 py-1 text-sm"
              rows={2}
              placeholder="Qué no incluye"
              value={tplForm.que_no_incluye}
              onChange={(e) => setTplForm((f) => ({ ...f, que_no_incluye: e.target.value }))}
            />
            <input
              className="w-full border rounded px-2 py-1 text-sm"
              placeholder="Condición de pago"
              value={tplForm.condicion_pago}
              onChange={(e) => setTplForm((f) => ({ ...f, condicion_pago: e.target.value }))}
            />
            <input
              className="w-full border rounded px-2 py-1 text-sm"
              placeholder="Tipo de instalación"
              value={tplForm.tipo_instalacion}
              onChange={(e) => setTplForm((f) => ({ ...f, tipo_instalacion: e.target.value }))}
            />
            <input
              className="w-full border rounded px-2 py-1 text-sm"
              placeholder="Garantía"
              value={tplForm.garantia}
              onChange={(e) => setTplForm((f) => ({ ...f, garantia: e.target.value }))}
            />
            <textarea
              className="w-full border rounded px-2 py-1 text-sm"
              rows={2}
              placeholder="Observaciones de producto"
              value={tplForm.observaciones_producto}
              onChange={(e) => setTplForm((f) => ({ ...f, observaciones_producto: e.target.value }))}
            />
            <button
              className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white disabled:opacity-60"
              onClick={() => {
                if (!tplForm.name.trim()) return;
                const payload = JSON.stringify({
                  name: tplForm.name.trim(),
                  ...tplForm,
                });
                onAdd(payload);
                setTplForm({
                  name: "",
                  observaciones: "",
                  plazo_entrega: "",
                  asistencia_garantia: "",
                  responsabilidad_cliente: "",
                  que_incluye: "",
                  que_no_incluye: "",
                  condicion_pago: "",
                  tipo_instalacion: "",
                  garantia: "",
                  observaciones_producto: "",
                });
              }}
              disabled={saving}
            >
              Agregar plantilla
            </button>
          </div>
        ) : (
          <input
            className="flex-1 border rounded px-2 py-1 text-sm"
            placeholder="Nuevo valor"
            value={newVal}
            onChange={(e) => setNewVal(e.target.value)}
          />
        )}
        {!isTemplate && (
          <button
            className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white disabled:opacity-60"
            onClick={() => {
              if (!newVal.trim()) return;
              onAdd(newVal.trim());
              setNewVal("");
            }}
            disabled={saving}
          >
            Agregar
          </button>
        )}
      </div>
        </>
      )}
    </div>
  );
}

function accountToParamValue(account) {
  return JSON.stringify({
    alias: String(account.alias || "").trim(),
    bank_name: String(account.bank_name || "").trim(),
    account_holder: String(account.account_holder || "").trim(),
    holder_ruc: String(account.holder_ruc || "").trim(),
    account_number: String(account.account_number || "").trim(),
    currency_code: String(account.currency_code || "PYG").toUpperCase(),
    account_type: String(account.account_type || "").trim(),
    cci_iban: String(account.cci_iban || "").trim(),
    swift: String(account.swift || "").trim(),
    notes: String(account.notes || "").trim(),
    active: account.active !== false && account.active !== 0,
  });
}

function CompanyBankAccountCard({
  rows,
  form,
  setForm,
  saving,
  onChangeRow,
  onClickSave,
  onClickRemove,
  onAdd,
}) {
  const emptyForm = {
    alias: "",
    bank_name: "",
    account_holder: "",
    holder_ruc: "",
    account_number: "",
    currency_code: "PYG",
    account_type: "",
    cci_iban: "",
    swift: "",
    notes: "",
    active: true,
  };

  function patchRow(idx, patch) {
    const current = parseCompanyBankAccountRow(rows[idx]);
    onChangeRow(idx, {
      value: accountToParamValue({ ...current, ...patch }),
      active: patch.active === undefined ? rows[idx]?.active : patch.active ? 1 : 0,
    });
  }

  function addAccount() {
    if (!String(form.alias || "").trim() || !String(form.bank_name || "").trim()) {
      alert("Alias y banco son requeridos.");
      return;
    }
    onAdd(accountToParamValue(form));
    setForm(emptyForm);
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-1 pr-2">Alias</th>
              <th className="py-1 pr-2">Banco</th>
              <th className="py-1 pr-2">Nro cuenta</th>
              <th className="py-1 pr-2">Moneda</th>
              <th className="py-1 pr-2">Activa</th>
              <th className="py-1 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, idx) => {
                const account = parseCompanyBankAccountRow(row);
                return (
                  <tr key={row.id || idx} className="border-b last:border-0 align-top">
                    <td className="py-1 pr-2">
                      <input className="w-full border rounded px-2 py-1" value={account.alias} onChange={(e) => patchRow(idx, { alias: e.target.value })} />
                    </td>
                    <td className="py-1 pr-2">
                      <input className="w-full border rounded px-2 py-1" value={account.bank_name} onChange={(e) => patchRow(idx, { bank_name: e.target.value })} />
                      <input className="mt-1 w-full border rounded px-2 py-1 text-xs" placeholder="Titular" value={account.account_holder} onChange={(e) => patchRow(idx, { account_holder: e.target.value })} />
                      <input className="mt-1 w-full border rounded px-2 py-1 text-xs" placeholder="RUC titular" value={account.holder_ruc} onChange={(e) => patchRow(idx, { holder_ruc: e.target.value })} />
                    </td>
                    <td className="py-1 pr-2">
                      <input className="w-full border rounded px-2 py-1" value={account.account_number} onChange={(e) => patchRow(idx, { account_number: e.target.value })} />
                      <input className="mt-1 w-full border rounded px-2 py-1 text-xs" placeholder="CCI / IBAN" value={account.cci_iban} onChange={(e) => patchRow(idx, { cci_iban: e.target.value })} />
                      <input className="mt-1 w-full border rounded px-2 py-1 text-xs" placeholder="SWIFT" value={account.swift} onChange={(e) => patchRow(idx, { swift: e.target.value })} />
                    </td>
                    <td className="py-1 pr-2">
                      <select className="w-full border rounded px-2 py-1" value={account.currency_code} onChange={(e) => patchRow(idx, { currency_code: e.target.value })}>
                        <option value="PYG">PYG</option>
                        <option value="USD">USD</option>
                        <option value="BRL">BRL</option>
                        <option value="ARS">ARS</option>
                      </select>
                      <input className="mt-1 w-full border rounded px-2 py-1 text-xs" placeholder="Tipo de cuenta" value={account.account_type} onChange={(e) => patchRow(idx, { account_type: e.target.value })} />
                      <textarea className="mt-1 w-full border rounded px-2 py-1 text-xs" rows={2} placeholder="Observaciones" value={account.notes} onChange={(e) => patchRow(idx, { notes: e.target.value })} />
                    </td>
                    <td className="py-1 pr-2">
                      <select className="border rounded px-2 py-1 w-full" value={account.active ? 1 : 0} onChange={(e) => patchRow(idx, { active: Number(e.target.value) === 1 })}>
                        <option value={1}>Si</option>
                        <option value={0}>No</option>
                      </select>
                    </td>
                    <td className="py-1">
                      <div className="flex gap-2">
                        <button className="px-2 py-1 text-xs rounded border" onClick={() => onClickSave(idx)} disabled={saving}>Guardar</button>
                        <button className="px-2 py-1 text-xs rounded border text-red-600" onClick={() => onClickRemove(idx)} disabled={saving}>Eliminar</button>
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className="py-2 text-slate-500" colSpan={6}>Sin cuentas cargadas.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border bg-slate-50 p-3">
        <div className="mb-2 font-semibold text-sm">Nueva cuenta</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input className="border rounded px-2 py-1 text-sm" placeholder="Alias" value={form.alias} onChange={(e) => setForm((f) => ({ ...f, alias: e.target.value }))} />
          <input className="border rounded px-2 py-1 text-sm" placeholder="Banco" value={form.bank_name} onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))} />
          <input className="border rounded px-2 py-1 text-sm" placeholder="Nro de cuenta" value={form.account_number} onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value }))} />
          <input className="border rounded px-2 py-1 text-sm" placeholder="Titular" value={form.account_holder} onChange={(e) => setForm((f) => ({ ...f, account_holder: e.target.value }))} />
          <input className="border rounded px-2 py-1 text-sm" placeholder="RUC titular" value={form.holder_ruc} onChange={(e) => setForm((f) => ({ ...f, holder_ruc: e.target.value }))} />
          <select className="border rounded px-2 py-1 text-sm" value={form.currency_code} onChange={(e) => setForm((f) => ({ ...f, currency_code: e.target.value }))}>
            <option value="PYG">PYG</option>
            <option value="USD">USD</option>
            <option value="BRL">BRL</option>
            <option value="ARS">ARS</option>
          </select>
          <input className="border rounded px-2 py-1 text-sm" placeholder="Tipo de cuenta" value={form.account_type} onChange={(e) => setForm((f) => ({ ...f, account_type: e.target.value }))} />
          <input className="border rounded px-2 py-1 text-sm" placeholder="CCI / IBAN" value={form.cci_iban} onChange={(e) => setForm((f) => ({ ...f, cci_iban: e.target.value }))} />
          <input className="border rounded px-2 py-1 text-sm" placeholder="SWIFT" value={form.swift} onChange={(e) => setForm((f) => ({ ...f, swift: e.target.value }))} />
          <textarea className="border rounded px-2 py-1 text-sm md:col-span-2" rows={2} placeholder="Observaciones" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active !== false} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
            Activa
          </label>
        </div>
        <button className="mt-3 px-3 py-1.5 text-sm rounded bg-blue-600 text-white disabled:opacity-60" onClick={addAccount} disabled={saving}>
          Agregar cuenta
        </button>
      </div>
    </div>
  );
}

function prettyLabel(key) {
  const map = {
    // Organizaciones
    org_tipo: "Tipo de organizacion",
    org_rubro: "Rubro (organizacion)",
    org_operacion: "Operacion (organizacion)",

    // Operacion
    tipo_operacion: "Tipo de operacion",
    modalidad_carga: "Modalidad de carga",
    tipo_carga: "Tipo de carga (LCL/FCL)",
    incoterm: "Incoterms",

    // Presupuesto
    quote_validez: "Validez de la oferta",
    quote_condicion_venta: "Condicion de venta",
    quote_plazo_credito: "Plazo de credito",
    quote_forma_pago: "Forma de pago",
    quote_incluye: "Que incluye",
    quote_no_incluye: "Que no incluye",
    quote_template: "Plantillas de condiciones",
    quote_brand_logo_url: "Logo PDF formal",
    quote_brand_city: "Ciudad para fecha",
    quote_brand_footer_web: "Web pie de pagina",
    quote_brand_footer_address: "Direccion pie de pagina",
    quote_brand_footer_phone: "Telefono pie de pagina",

    // Facturacion
    invoice_timbre_number_cargo: "Timbrado ATM CARGO",
    invoice_timbre_valid_from_cargo: "Vigencia desde ATM CARGO",
    invoice_timbre_valid_to_cargo: "Vigencia hasta ATM CARGO",
    invoice_exp_cargo: "Punto de expedicion ATM CARGO",
    invoice_next_number_cargo: "Correlativo administrativo ATM CARGO",
    invoice_timbre_number_industrial: "Timbrado ATM INDUSTRIAL",
    invoice_timbre_valid_from_industrial: "Vigencia desde ATM INDUSTRIAL",
    invoice_timbre_valid_to_industrial: "Vigencia hasta ATM INDUSTRIAL",
    invoice_exp_industrial: "Punto de expedicion ATM INDUSTRIAL",
    invoice_next_number_industrial: "Correlativo administrativo ATM INDUSTRIAL",
    credit_exp_cargo: "Punto de expedici?n NC ATM CARGO",
    credit_next_number_cargo: "Correlativo administrativo NC ATM CARGO",
    credit_exp_industrial: "Punto de expedici?n NC ATM INDUSTRIAL",
    credit_next_number_industrial: "Correlativo administrativo NC ATM INDUSTRIAL",
    company_bank_account: "Cuentas bancarias de la empresa",

    // Kanban
    kanban_pipeline: "Pipeline (por nombre)",
    kanban_pipeline_id: "Pipeline (por ID) opcional",
    kanban_stage_alias: "Alias de columnas (por nombre)",
    kanban_hide_stage: "Ocultar columnas (por nombre)",
    kanban_stage_labels: "Etiquetas de columnas",
    kanban_hide_stages: "Ocultar columnas",
  };
  return map[key] || key;
}

function FiscalStampQuickEditor({ map, saving, onChange, onSave }) {
  const sections = [
    {
      key: "cargo",
      label: "ATM CARGO",
      numberKey: "invoice_timbre_number_cargo",
      fromKey: "invoice_timbre_valid_from_cargo",
      toKey: "invoice_timbre_valid_to_cargo",
    },
    {
      key: "industrial",
      label: "ATM INDUSTRIAL",
      numberKey: "invoice_timbre_number_industrial",
      fromKey: "invoice_timbre_valid_from_industrial",
      toKey: "invoice_timbre_valid_to_industrial",
    },
  ];
  const valueOf = (key) => (map[key] || [])[0]?.value || "";

  return (
    <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50/60 p-3">
      <div className="mb-3">
        <div className="font-semibold text-slate-900">Timbrado vigente</div>
        <div className="text-sm text-slate-600">
          Estos datos se usan al crear facturas nuevas. Las facturas ya creadas conservan el timbrado que tenian al emitirse.
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {sections.map((section) => (
          <div key={section.key} className="rounded-xl border bg-white p-3">
            <div className="mb-3 font-semibold text-slate-900">{section.label}</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="text-sm">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Numero
                </span>
                <input
                  type="text"
                  value={valueOf(section.numberKey)}
                  onChange={(e) => onChange(section.numberKey, e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  placeholder="18954219"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Inicio vigencia
                </span>
                <input
                  type="date"
                  value={valueOf(section.fromKey)}
                  onChange={(e) => onChange(section.fromKey, e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Fin vigencia
                </span>
                <input
                  type="date"
                  value={valueOf(section.toKey)}
                  onChange={(e) => onChange(section.toKey, e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </label>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => onSave(section.key)}
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Guardar timbrado
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InvoiceNumberingStatusPanel({ status }) {
  const sections = [
    { key: "cargo", label: "ATM CARGO" },
    { key: "industrial", label: "ATM INDUSTRIAL" },
  ];

  return (
    <div className="rounded-xl border bg-slate-50 p-3">
      <div className="mb-3">
        <div className="font-medium">Estado actual de numeración</div>
        <div className="text-sm text-slate-600">
          Muestra la serie fiscal activa, el siguiente número real según facturas emitidas y el correlativo administrativo configurado en parámetros.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {sections.map((section) => {
          const row = status?.[section.key];
          return (
            <div key={section.key} className="rounded-xl border bg-white p-3">
              <div className="mb-2 font-semibold">{section.label}</div>
              {!row ? (
                <div className="text-sm text-slate-500">Sin datos disponibles.</div>
              ) : (
                <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
                  <StatusItem label="Punto de expedición" value={row.point_of_issue} />
                  <StatusItem label="Establecimiento" value={row.establishment} />
                  <StatusItem label="Código expedición" value={row.expedition_code} />
                  <StatusItem label="Próximo correlativo real" value={row.next_number_padded} />
                  <StatusItem label="Próximo número real" value={row.next_invoice_number} wide />
                  <StatusItem label="Correlativo administrativo" value={row.configured_next_number_padded} />
                  <StatusItem label="Número administrativo" value={row.configured_invoice_number} wide />
                  <StatusItem
                    label="Origen del siguiente número"
                    value={row.sequence_source === "param_seed" ? "Parámetros (serie sin emitidos)" : "Base de datos"}
                  />
                  <StatusItem label="Timbrado" value={row.timbrado_number} />
                  <StatusItem label="Vigencia desde" value={row.timbrado_start_date} />
                  <StatusItem label="Vigencia hasta" value={row.timbrado_expires_at} />
                  <StatusItem label="Última factura emitida" value={row.last_issued_invoice_number} wide />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CreditNoteNumberingStatusPanel({ status }) {
  const sections = [
    { key: "cargo", label: "ATM CARGO" },
    { key: "industrial", label: "ATM INDUSTRIAL" },
  ];

  return (
    <div className="rounded-xl border bg-slate-50 p-3">
      <div className="mb-3">
        <div className="font-medium">Estado actual de numeraci?n de notas de cr?dito</div>
        <div className="text-sm text-slate-600">
          Muestra la serie activa de NC, el siguiente n?mero real seg?n notas emitidas y el correlativo administrativo configurado en par?metros.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {sections.map((section) => {
          const row = status?.[section.key];
          return (
            <div key={section.key} className="rounded-xl border bg-white p-3">
              <div className="mb-2 font-semibold">{section.label}</div>
              {!row ? (
                <div className="text-sm text-slate-500">Sin datos disponibles.</div>
              ) : (
                <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
                  <StatusItem label="Punto de expedici?n" value={row.point_of_issue} />
                  <StatusItem label="Establecimiento" value={row.establishment} />
                  <StatusItem label="C?digo expedici?n" value={row.expedition_code} />
                  <StatusItem label="Pr?ximo correlativo real" value={row.next_number_padded} />
                  <StatusItem label="Pr?ximo n?mero real" value={row.next_credit_note_number} wide />
                  <StatusItem label="Correlativo administrativo" value={row.configured_next_number_padded} />
                  <StatusItem label="N?mero administrativo" value={row.configured_credit_note_number} wide />
                  <StatusItem
                    label="Origen del siguiente n?mero"
                    value={row.sequence_source === "param_seed" ? "Par?metros (serie sin emitidos)" : "Base de datos"}
                  />
                  <StatusItem label="?ltima NC emitida" value={row.last_issued_credit_note_number} wide />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusItem({ label, value, wide = false }) {
  return (
    <div className={wide ? "md:col-span-2" : ""}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="font-medium text-slate-800">{value || "—"}</div>
    </div>
  );
}
