// client/src/pages/catalog/ProductsServices.jsx
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../api"; // IMPORTANTE: ruta correcta desde /pages/catalog

const TYPES = [
  { value: "PRODUCT", label: "PRODUCTO" },
  { value: "SERVICE", label: "SERVICIO" },
];

const CURRENCIES = ["USD", "PYG", "EUR"];
const UNITS = ["UN", "KG", "M3", "SERV"];

export default function ProductsServices() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [onlyActive, setOnlyActive] = useState(true);
  const [err, setErr] = useState("");
  const [savingId, setSavingId] = useState(null); // para mostrar spinner por fila
  const [tempId, setTempId] = useState(-1); // ids temporales negativos para filas nuevas

  // ------- Cargar ----------
  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      const ts = Date.now(); // anti-cache
      const { data } = await api.get(`/catalog/items?active=${onlyActive ? 1 : 0}&t=${ts}`);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("[catalog] load", e);
      setErr("No se pudo cargar el catálogo.");
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
      type: "PRODUCT",
      sku: "",
      name: "",
      unit: "UN",
      currency: "USD",
      price: 0,
      tax_rate: 0,
      active: 1,
      __isNew: true,
    };
    setRows((prev) => [newRow, ...prev]);
  };

  const normalizePayload = (row) => ({
    type: row.type || "PRODUCT",
    sku: row.sku || null,
    name: row.name || null,
    unit: row.unit || null,
    currency: row.currency || "USD",
    price: row.price === "" || row.price == null ? 0 : Number(row.price),
    tax_rate: row.tax_rate === "" || row.tax_rate == null ? 0 : Number(row.tax_rate),
    active: row.active ? 1 : 0,
  });

  const saveRow = async (row) => {
    setSavingId(row.id);
    setErr("");
    try {
      const payload = normalizePayload(row);

      if (row.__isNew || row.id < 0) {
        // CREATE
        await api.post("/catalog/items", payload);
        // Para que se vea inmediatamente lo que guarda el server, recargamos:
        await load();
      } else {
        // UPDATE
        await api.put(`/catalog/items/${row.id}`, payload);
        await load();
      }
    } catch (e) {
      console.error("[catalog] saveRow", e);
      setErr("No se pudo guardar la fila.");
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
      setErr("No se pudo eliminar el ítem.");
    }
  };

  const toggleActive = async (row) => {
    // Cambiamos en memoria para feedback instantáneo…
    const next = { ...row, active: row.active ? 0 : 1 };
    onChangeCell(row.id, "active", next.active);
    // …y persistimos de inmediato
    await saveRow(next);
  };

  const filtered = useMemo(() => rows, [rows]);

  // ------- UI -------
  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Productos y servicios</h1>
          <p className="text-slate-500 text-sm">
            Definí ítems para usar en presupuestos (SKU, unidad, moneda, precio, IVA).
          </p>
        </div>
        <div className="flex items-center gap-2">
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

      {err && (
        <div className="mb-3 text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">
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
                <th className="px-3 py-2 text-left w-36">Tipo</th>
                <th className="px-3 py-2 text-left w-40">SKU</th>
                <th className="px-3 py-2 text-left">Nombre</th>
                <th className="px-3 py-2 text-left w-28">Unidad</th>
                <th className="px-3 py-2 text-left w-24">Moneda</th>
                <th className="px-3 py-2 text-right w-32">Precio</th>
                <th className="px-3 py-2 text-right w-28">IVA %</th>
                <th className="px-3 py-2 text-center w-24">Activo</th>
                <th className="px-3 py-2 text-right w-40">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t">
                  {/* Tipo */}
                  <td className="px-3 py-2">
                    <select
                      className="border rounded px-2 py-1 w-full"
                      value={r.type || "PRODUCT"}
                      onChange={(e) => onChangeCell(r.id, "type", e.target.value)}
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
                      onChange={(e) => onChangeCell(r.id, "sku", e.target.value)}
                      placeholder="SKU (opcional)"
                    />
                  </td>

                  {/* Nombre */}
                  <td className="px-3 py-2">
                    <input
                      className="border rounded px-2 py-1 w-full"
                      value={r.name || ""}
                      onChange={(e) => onChangeCell(r.id, "name", e.target.value)}
                      placeholder="Nombre del producto/servicio"
                    />
                  </td>

                  {/* Unidad */}
                  <td className="px-3 py-2">
                    <select
                      className="border rounded px-2 py-1 w-full"
                      value={r.unit || "UN"}
                      onChange={(e) => onChangeCell(r.id, "unit", e.target.value)}
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
                      onChange={(e) => onChangeCell(r.id, "currency", e.target.value)}
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
                      onChange={(e) => onChangeCell(r.id, "price", e.target.value)}
                    />
                  </td>

                  {/* IVA */}
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      className="border rounded px-2 py-1 w-full text-right"
                      value={r.tax_rate ?? 0}
                      onChange={(e) => onChangeCell(r.id, "tax_rate", e.target.value)}
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
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={9}>
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
