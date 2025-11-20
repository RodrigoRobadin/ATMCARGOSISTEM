// client/src/pages/catalog/ProductsServices.jsx
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../api"; // IMPORTANTE: ruta correcta desde /pages/catalog

// Valores que coinciden con el ENUM de la BD: enum('PRODUCTO','SERVICIO')
const TYPES = [
  { value: "PRODUCTO", label: "PRODUCTO" },
  { value: "SERVICIO", label: "SERVICIO" },
];

const CURRENCIES = ["USD", "PYG", "EUR"];
const UNITS = ["UN", "KG", "M3", "SERV"];

/** Normaliza la fila para ENVIAR al backend con claves que matchean la tabla. */
function normalizeItemRow(row = {}) {
  // --- TYPE: mapeamos cualquier variante a PRODUCTO / SERVICIO ---
  const rawType = row.type ?? row.kind ?? row.tipo ?? "PRODUCTO";
  let type = "PRODUCTO";
  if (rawType === "PRODUCT" || rawType === "PRODUCTO") type = "PRODUCTO";
  else if (rawType === "SERVICE" || rawType === "SERVICIO") type = "SERVICIO";

  const sku = row.sku ?? row.code ?? row.item_code ?? null;
  const name = row.name ?? row.item_name ?? row.title ?? row.descripcion ?? "";
  const unit = row.unit ?? row.uom ?? row.unidad ?? "UN";
  const currency = row.currency ?? row.moneda ?? "USD";
  const active = row.active ?? row.enabled ?? row.activo ?? 1;

  const price = Number(row.price ?? row.unit_price ?? row.precio ?? 0) || 0;
  const tax_rate =
    Number(row.tax_rate ?? row.vat_pct ?? row.iva ?? 0) || 0; // la tabla tiene tax_rate

  // 🔹 NUEVO: Marca industrial (Rayflex, Boplan, etc.)
  const brand = row.brand ?? row.marca ?? null;

  return {
    // estas claves deben coincidir con las columnas de catalog_items
    type,       // enum('PRODUCTO','SERVICIO')
    sku,        // varchar(64)
    name,       // varchar(200)
    brand,      // varchar(100) NULL
    unit,       // varchar(24)
    currency,   // char(3)
    price,      // decimal(14,2)
    tax_rate,   // decimal(5,2)
    active: active ? 1 : 0, // tinyint(1)
  };
}

/** Normaliza filas que VIENEN del backend para mostrarlas en la tabla. */
function toViewRow(item) {
  const id = item.id ?? item.item_id ?? item.code_id ?? item.pk ?? Math.random();
  return {
    id,
    type: item.type ?? item.kind ?? item.tipo ?? "PRODUCTO", // viene PRODUCTO / SERVICIO
    sku: item.sku ?? item.code ?? item.item_code ?? "",
    name: item.name ?? item.title ?? item.descripcion ?? "",
    brand: item.brand ?? item.marca ?? "", // 🔹 traemos la marca si existe
    unit: item.unit ?? item.uom ?? item.unidad ?? "UN",
    currency: item.currency ?? item.moneda ?? "USD",
    price: Number(item.price ?? item.unit_price ?? item.precio ?? 0) || 0,
    tax_rate: Number(item.tax_rate ?? item.vat_pct ?? item.iva ?? 0) || 0,
    active: item.active ?? item.enabled ?? item.activo ?? 1,
  };
}

export default function ProductsServices() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [onlyActive, setOnlyActive] = useState(true);
  const [err, setErr] = useState("");
  const [savingId, setSavingId] = useState(null); // spinner por fila
  const [tempId, setTempId] = useState(-1); // ids temporales negativos

  // filtros
  const [typeFilter, setTypeFilter] = useState(""); // PRODUCTO / SERVICIO / ""
  const [brandFilter, setBrandFilter] = useState(""); // Rayflex / Boplan / ""
  const [search, setSearch] = useState(""); // texto libre (SKU/Nombre)

  // ------- Cargar ----------
  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      const ts = Date.now(); // anti-cache
      const { data } = await api.get(`/catalog/items`, {
        params: { active: onlyActive ? 1 : 0, t: ts },
      });
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.items)
        ? data.items
        : [];
      setRows(list.map(toViewRow));
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
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyActive]);

  // ------- Helpers UI ----------
  const onChangeCell = (id, key, value) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [key]: value } : r))
    );
  };

  const addRow = () => {
    const id = tempId; // negativo para key estable hasta que el server devuelva el real
    setTempId((n) => n - 1);
    const newRow = {
      id,
      type: "PRODUCTO",
      sku: "",
      name: "",
      brand: "",
      unit: "UN",
      currency: "USD",
      price: 0,
      tax_rate: 0,
      active: 1,
      __isNew: true,
    };
    setRows((prev) => [newRow, ...prev]);
  };

  const saveRow = async (row) => {
    setSavingId(row.id);
    setErr("");

    if (!row.name || !String(row.name).trim()) {
      setSavingId(null);
      setErr("El nombre es obligatorio.");
      return;
    }

    const payload = normalizeItemRow(row);
    console.log("[catalog] saveRow payload =>", payload);

    try {
      if (row.__isNew || row.id < 0) {
        // CREATE
        await api.post("/catalog/items", payload);
        await load(); // refrescamos para tomar id real y normalización del servidor
      } else {
        // UPDATE
        await api.put(`/catalog/items/${row.id}`, payload);
        await load();
      }
    } catch (e) {
      console.error(
        "[catalog] saveRow ERROR =>",
        e?.response?.status,
        e?.response?.data || e?.message
      );
      setErr(
        e?.response?.data
          ? typeof e.response.data === "string"
            ? e.response.data
            : JSON.stringify(e.response.data)
          : "No se pudo guardar la fila."
      );
    } finally {
      setSavingId(null);
    }
  };

  const deleteRow = async (row) => {
    setErr("");
    // Si es temporal, borramos local solamente
    if (row.id < 0 || row.__isNew) {
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      return;
    }
    try {
      await api.delete(`/catalog/items/${row.id}`);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (e) {
      console.error("[catalog] deleteRow", e);
      setErr(
        typeof e?.response?.data === "string"
          ? e.response.data
          : "No se pudo eliminar el ítem."
      );
    }
  };

  const toggleActive = async (row) => {
    const next = { ...row, active: row.active ? 0 : 1 };
    onChangeCell(row.id, "active", next.active);
    await saveRow(next);
  };

  // lista de marcas únicas (para filtro)
  const brandOptions = useMemo(() => {
    const set = new Set();
    rows.forEach((r) => {
      const b = (r.brand || "").trim();
      if (b) set.add(b);
    });
    return Array.from(set);
  }, [rows]);

  // filtrado en memoria
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter && r.type !== typeFilter) return false;
      if (brandFilter && (r.brand || "") !== brandFilter) return false;
      if (term) {
        const inSku = (r.sku || "").toLowerCase().includes(term);
        const inName = (r.name || "").toLowerCase().includes(term);
        if (!inSku && !inName) return false;
      }
      return true;
    });
  }, [rows, typeFilter, brandFilter, search]);

  // ------- UI -------
  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">
            Productos y servicios
          </h1>
          <p className="text-slate-500 text-sm">
            Definí ítems para usar en presupuestos (SKU, unidad, moneda,
            precio, IVA).
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <label className="text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!onlyActive}
              onChange={(e) => setOnlyActive(e.target.checked)}
            />
            Mostrar solo activos
          </label>
          <button
            className="px-3 py-2 rounded-lg bg-slate-900 text-white text-sm"
            onClick={addRow}
          >
            + Nuevo ítem
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap gap-3 items-center text-sm">
        <div className="flex flex-col">
          <span className="text-xs text-slate-500">Tipo</span>
          <select
            className="border rounded px-2 py-1 min-w-[140px]"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">Todos</option>
            <option value="PRODUCTO">Productos</option>
            <option value="SERVICIO">Servicios</option>
          </select>
        </div>

        <div className="flex flex-col">
          <span className="text-xs text-slate-500">Marca</span>
          <select
            className="border rounded px-2 py-1 min-w-[160px]"
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
          >
            <option value="">Todas</option>
            {brandOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col flex-1 min-w-[180px]">
          <span className="text-xs text-slate-500">Buscar</span>
          <input
            className="border rounded px-2 py-1"
            placeholder="Nombre o SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {err && (
        <div className="mb-3 text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded break-words">
          {err}
        </div>
      )}

      {loading ? (
        <div className="text-slate-500">Cargando…</div>
      ) : (
        <div className="overflow-auto border rounded-lg bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left w-28">Tipo</th>
                <th className="px-3 py-2 text-left w-36">SKU</th>
                <th className="px-3 py-2 text-left">Nombre</th>
                <th className="px-3 py-2 text-left w-32">Marca</th>
                <th className="px-3 py-2 text-left w-24">Unidad</th>
                <th className="px-3 py-2 text-left w-24">Moneda</th>
                <th className="px-3 py-2 text-right w-32">Precio</th>
                <th className="px-3 py-2 text-right w-28">IVA %</th>
                <th className="px-3 py-2 text-center w-24">Activo</th>
                <th className="px-3 py-2 text-right w-40">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  {/* Tipo */}
                  <td className="px-3 py-2">
                    <select
                      className="border rounded px-2 py-1 w-full"
                      value={r.type || "PRODUCTO"}
                      onChange={(e) =>
                        onChangeCell(r.id, "type", e.target.value)
                      }
                    >
                      {TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* SKU */}
                  <td className="px-3 py-2">
                    <input
                      className="border rounded px-2 py-1 w-full"
                      value={r.sku || ""}
                      onChange={(e) =>
                        onChangeCell(r.id, "sku", e.target.value)
                      }
                      placeholder="SKU (opcional)"
                    />
                  </td>

                  {/* Nombre */}
                  <td className="px-3 py-2">
                    <input
                      className="border rounded px-2 py-1 w-full"
                      value={r.name || ""}
                      onChange={(e) =>
                        onChangeCell(r.id, "name", e.target.value)
                      }
                      placeholder="Nombre del producto/servicio"
                    />
                  </td>

                  {/* Marca */}
                  <td className="px-3 py-2">
                    <input
                      className="border rounded px-2 py-1 w-full"
                      value={r.brand || ""}
                      onChange={(e) =>
                        onChangeCell(r.id, "brand", e.target.value)
                      }
                      placeholder="Rayflex, Boplan…"
                    />
                  </td>

                  {/* Unidad */}
                  <td className="px-3 py-2">
                    <select
                      className="border rounded px-2 py-1 w-full"
                      value={r.unit || "UN"}
                      onChange={(e) =>
                        onChangeCell(r.id, "unit", e.target.value)
                      }
                    >
                      {UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Moneda */}
                  <td className="px-3 py-2">
                    <select
                      className="border rounded px-2 py-1 w-full"
                      value={r.currency || "USD"}
                      onChange={(e) =>
                        onChangeCell(r.id, "currency", e.target.value)
                      }
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Precio */}
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      className="border rounded px-2 py-1 w-full text-right"
                      value={r.price ?? 0}
                      onChange={(e) =>
                        onChangeCell(r.id, "price", e.target.value)
                      }
                    />
                  </td>

                  {/* IVA */}
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      className="border rounded px-2 py-1 w-full text-right"
                      value={r.tax_rate ?? 0}
                      onChange={(e) =>
                        onChangeCell(r.id, "tax_rate", e.target.value)
                      }
                    />
                  </td>

                  {/* Activo */}
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={!!r.active}
                      onChange={() => toggleActive(r)}
                    />
                  </td>

                  {/* Acciones */}
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-2">
                      <button
                        className="px-3 py-1 rounded border"
                        disabled={savingId === r.id}
                        onClick={() => saveRow(r)}
                        title="Guardar"
                      >
                        {savingId === r.id ? "Guardando…" : "Guardar"}
                      </button>
                      <button
                        className="px-3 py-1 rounded border border-red-500 text-red-600"
                        onClick={() => deleteRow(r)}
                        title="Eliminar"
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && !loading && (
                <tr>
                  <td
                    className="px-3 py-6 text-center text-slate-500"
                    colSpan={10}
                  >
                    No hay ítems. Creá el primero con “+ Nuevo ítem”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button className="px-3 py-2 rounded-lg border" onClick={load}>
          Recargar
        </button>
      </div>
    </div>
  );
}