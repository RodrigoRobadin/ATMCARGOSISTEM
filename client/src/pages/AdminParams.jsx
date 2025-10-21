// client/src/pages/AdminParams.jsx
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";

// === Grupos de parámetros administrables ===
const PARAM_GROUPS = [
  {
    title: "Organizaciones",
    description: "Opciones usadas en el formulario de organizaciones.",
    // ⬇️ Agregamos org_operacion para el desplegable de “Operación” del formulario
    keys: ["org_tipo", "org_rubro", "org_operacion"],
  },
  {
    title: "Operación",
    description: "Listas para usar en la operación (detalle).",
    keys: ["tipo_operacion", "modalidad_carga", "tipo_carga", "incoterm"],
  },
  {
    title: "Kanban / Pipeline",
    description:
      "Configura alias y visibilidad de columnas. Para un workspace en particular, creá la misma clave con sufijo __{key_slug}, ej.: kanban_stage_labels__atm-cargo.",
    keys: [
      "kanban_stage_labels",
      "kanban_hide_stages",
      "kanban_pipeline_id",
      // podés crear variantes con sufijo __{key_slug} desde esta misma pantalla
    ],
 },

  {
    title: "Presupuesto — Términos",
    description:
      "Opciones administrables del presupuesto (se verán como sugerencias en el generador).",
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
  title: "Kanban",
  description: "Config simple por nombre o ID (los nombres ganan).",
  keys: ["kanban_pipeline", "kanban_pipeline_id", "kanban_stage_alias", "kanban_hide_stage"],
}



];

// Normaliza la forma de pedir todas las claves
function buildKeysParam() {
  const all = PARAM_GROUPS.flatMap((g) => g.keys);
  return all.join(",");
}

export default function AdminParams() {
  const [loading, setLoading] = useState(true);
  const [map, setMap] = useState({}); // { key: [{id,value,ord,active}, ...] }
  const [saving, setSaving] = useState(false);
  const keysParam = useMemo(buildKeysParam, []);

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
    } finally {
      setSaving(false);
    }
  }

  async function saveRow(key, idx) {
    const row = map[key][idx];
    setSaving(true);
    try {
      await updateParam(row);
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
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-sm text-slate-600">Cargando…</div>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow p-4">
        <h1 className="text-xl font-semibold">Administración de Parámetros</h1>
        <p className="text-sm text-slate-600">
          Agregá, ordená y activá/desactivá valores. Los cambios impactan en los
          selectores del sistema (organizaciones, operación y presupuesto).
        </p>
      </div>

      {PARAM_GROUPS.map((group) => (
        <section key={group.title} className="bg-white rounded-2xl shadow p-4">
          <div className="mb-3">
            <h2 className="text-lg font-semibold">{group.title}</h2>
            {group.description && (
              <p className="text-sm text-slate-600">{group.description}</p>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {group.keys.map((key) => (
              <ParamCard
                key={key}
                label={key}
                rows={map[key] || []}
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
        </section>
      ))}
    </div>
  );
}

/** Tarjeta de edición de una clave de parámetros */
function ParamCard({
  label,
  rows,
  onChangeRow,
  onClickSave,
  onClickRemove,
  onAdd,
  saving,
}) {
  const [newVal, setNewVal] = useState("");

  return (
    <div className="border rounded-xl p-3">
      <div className="font-medium mb-2">{prettyLabel(label)}</div>

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
                    <input
                      className="w-full border rounded px-2 py-1"
                      value={r.value || ""}
                      onChange={(e) =>
                        onChangeRow(idx, { value: e.target.value })
                      }
                    />
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

      {/* Alta rápida */}
      <div className="mt-3 flex gap-2">
        <input
          className="flex-1 border rounded px-2 py-1 text-sm"
          placeholder="Nuevo valor…"
          value={newVal}
          onChange={(e) => setNewVal(e.target.value)}
        />
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
      </div>
    </div>
  );
}

function prettyLabel(key) {
  const map = {
    // Organizaciones
    org_tipo: "Tipo de organización",
    org_rubro: "Rubro (organización)",
    org_operacion: "Operación (organización)", // ⬅️ NUEVO

    // Operación
    tipo_operacion: "Tipo de operación",
    modalidad_carga: "Modalidad de carga",
    tipo_carga: "Tipo de carga (LCL/FCL)",
    incoterm: "Incoterms",

    // Presupuesto
    quote_validez: "Validez de la oferta",
    quote_condicion_venta: "Condición de venta",
    quote_plazo_credito: "Plazo de crédito",
    quote_forma_pago: "Forma de pago",
    quote_incluye: "Qué incluye",
    quote_no_incluye: "Qué no incluye",

    // +++ Agregar en prettyLabel():
    kanban_pipeline: "Pipeline (por nombre)",
    kanban_pipeline_id: "Pipeline (por ID) – opcional",
    kanban_stage_alias: "Alias de columnas (por nombre)",
    kanban_hide_stage: "Ocultar columnas (por nombre)",

    // Kanban    
  };
  return map[key] || key;
}
