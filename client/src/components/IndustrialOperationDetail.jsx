// client/src/components/IndustrialOperationDetail.jsx
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";

/* --- UI helpers --- */
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

const TextArea = (props) => (
  <textarea
    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
    {...props}
  />
);

/* --- Normalizar items de catálogo --- */
function normalizeCatalogItem(item) {
  if (!item) return null;
  const id = item.id ?? item.item_id ?? item.code_id ?? null;
  const name = item.name ?? item.title ?? item.descripcion ?? "";
  if (!id || !name) return null;

  const rawType = item.type ?? item.kind ?? item.tipo ?? "PRODUCTO";
  let type = rawType;
  if (rawType === "PRODUCTO") type = "PRODUCT";
  else if (rawType === "SERVICIO") type = "SERVICE";

  const brandRaw =
    item.brand ??
    item.marca ??
    item.industrial_brand ??
    item.brand_code ??
    "";

  return {
    id,
    name: String(name),
    sku: item.sku ?? item.code ?? item.item_code ?? "",
    type, // PRODUCT | SERVICE
    brand: String(brandRaw || "").toUpperCase(), // RAYFLEX / BOPLAN / ...
  };
}

// Generar ID local para cada puerta (no se guarda en BD)
function genLineId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Detalle de operación industrial
 *
 * Props mínimas:
 *  - dealId: ID de la operación
 */
export default function IndustrialOperationDetail({ dealId }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Catálogo completo (PRODUCTOS)
  const [catalogItems, setCatalogItems] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  // Lista de puertas de esta operación
  const [doors, setDoors] = useState([]);

  // ----- Cargar catálogo (productos activos) -----
  useEffect(() => {
    (async () => {
      setCatalogLoading(true);
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
          .filter((it) => it && it.type === "PRODUCT");
        setCatalogItems(normalized);
      } catch (err) {
        console.error("[industrial-detail] load catalog error", err);
        setCatalogItems([]);
      } finally {
        setCatalogLoading(false);
      }
    })();
  }, []);

  const productsById = useMemo(() => {
    const map = new Map();
    catalogItems.forEach((p) => map.set(String(p.id), p));
    return map;
  }, [catalogItems]);

  // ----- Cargar detalle industrial desde custom fields -----
  useEffect(() => {
    if (!dealId) return;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const { data } = await api.get(`/deals/${dealId}/custom-fields`);
        const arr = Array.isArray(data)
          ? data
          : Array.isArray(data?.items)
          ? data.items
          : [];

        const cfDoors = arr.find((cf) => cf.key === "industrial_doors");
        const cfItems = arr.find((cf) => cf.key === "industrial_items");

        let initialDoors = [];

        // Si ya hay detalle de puertas, usamos eso
        if (cfDoors?.value) {
          try {
            const parsed = JSON.parse(cfDoors.value);
            if (Array.isArray(parsed)) {
              initialDoors = parsed.map((d) => ({
                lineId: d.lineId || genLineId(),
                productId: d.productId || d.id || null,
                productName: d.productName || d.name || "",
                brand: d.brand || "",
                sku: d.sku || "",
                quantity: d.quantity ?? 1,

                doorCode: d.doorCode || d.identifier || "",
                widthAvailable: d.widthAvailable || d.anchoDisponible || "",
                heightAvailable: d.heightAvailable || d.altoDisponible || "",
                sector: d.sector || d.secot || "",
                installSide: d.installSide || d.ladoInstal || "",
                headroomAvailable:
                  d.headroomAvailable || d.sobreAltoDispo || "",
                frameType: d.frameType || d.tipoMarco || "",
                rightSideSpace: d.rightSideSpace || d.dispLadoDer || "",
                leftSideSpace: d.leftSideSpace || d.dispLadoIzq || "",
                motorSide: d.motorSide || d.ladoMotor || "",
                actuators: d.actuators || d.accionadores || "",
                visorLines: d.visorLines || d.lineasVisor || "",
                rightPost: d.rightPost || d.pieDerecho || "",
                notes: d.notes || d.obs || "",
              }));
            }
          } catch (e) {
            console.warn(
              "[industrial-detail] No se pudo parsear industrial_doors",
              e
            );
          }
        }

        // Si NO hay detalle de puertas, pero sí industrial_items, usamos eso como base
        if (!initialDoors.length && cfItems?.value) {
          try {
            const parsed = JSON.parse(cfItems.value);
            if (Array.isArray(parsed)) {
              initialDoors = parsed.map((it) => ({
                lineId: genLineId(),
                productId: it.productId || it.id || null,
                productName: it.productName || it.name || "",
                brand: it.brand || "",
                sku: it.sku || "",
                quantity: it.quantity ?? 1,

                doorCode: "",
                widthAvailable: "",
                heightAvailable: "",
                sector: "",
                installSide: "",
                headroomAvailable: "",
                frameType: "",
                rightSideSpace: "",
                leftSideSpace: "",
                motorSide: "",
                actuators: "",
                visorLines: "",
                rightPost: "",
                notes: "",
              }));
            }
          } catch (e) {
            console.warn(
              "[industrial-detail] No se pudo parsear industrial_items",
              e
            );
          }
        }

        setDoors(initialDoors);
      } catch (err) {
        console.error("[industrial-detail] load custom fields error", err);
        setError(
          "No se pudo cargar el detalle industrial. Probá recargar la página."
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [dealId]);

  // ----- CRUD local de puertas -----
  const addEmptyDoor = () => {
    setDoors((prev) => [
      ...prev,
      {
        lineId: genLineId(),
        productId: "",
        productName: "",
        brand: "",
        sku: "",
        quantity: 1,

        doorCode: "",
        widthAvailable: "",
        heightAvailable: "",
        sector: "",
        installSide: "",
        headroomAvailable: "",
        frameType: "",
        rightSideSpace: "",
        leftSideSpace: "",
        motorSide: "",
        actuators: "",
        visorLines: "",
        rightPost: "",
        notes: "",
      },
    ]);
  };

  const handleChangeField = (lineId, key, value) => {
    setDoors((prev) =>
      prev.map((d) => (d.lineId === lineId ? { ...d, [key]: value } : d))
    );
  };

  const handleChangeProduct = (lineId, productId) => {
    const prod = productsById.get(String(productId));
    setDoors((prev) =>
      prev.map((d) => {
        if (d.lineId !== lineId) return d;
        if (!prod) {
          return { ...d, productId: "", productName: "", brand: "", sku: "" };
        }
        return {
          ...d,
          productId: prod.id,
          productName: prod.name,
          brand: prod.brand || "",
          sku: prod.sku || "",
        };
      })
    );
  };

  const handleRemoveDoor = (lineId) => {
    if (!window.confirm("¿Eliminar esta puerta del detalle?")) return;
    setDoors((prev) => prev.filter((d) => d.lineId !== lineId));
  };

  const hasDoors = doors.length > 0;

  const canSave = hasDoors && !loading && !!dealId;

  // ----- Guardar en custom field industrial_doors -----
  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError("");

    try {
      // Normalizamos para guardar (sin lineId interno)
      const payloadDoors = doors.map((d) => ({
        productId: d.productId || null,
        productName: d.productName || "",
        brand: d.brand || "",
        sku: d.sku || "",
        quantity: d.quantity || 1,

        doorCode: d.doorCode || "",
        widthAvailable: d.widthAvailable || "",
        heightAvailable: d.heightAvailable || "",
        sector: d.sector || "",
        installSide: d.installSide || "",
        headroomAvailable: d.headroomAvailable || "",
        frameType: d.frameType || "",
        rightSideSpace: d.rightSideSpace || "",
        leftSideSpace: d.leftSideSpace || "",
        motorSide: d.motorSide || "",
        actuators: d.actuators || "",
        visorLines: d.visorLines || "",
        rightPost: d.rightPost || "",
        notes: d.notes || "",
      }));

      await api.post(`/deals/${dealId}/custom-fields`, {
        key: "industrial_doors",
        label: "Detalle de puertas industriales",
        type: "text",
        value: JSON.stringify(payloadDoors),
      });

      // Opcional: feedback rápido
      alert("Detalle industrial guardado correctamente.");
    } catch (err) {
      console.error("SAVE industrial_doors failed:", {
        message: err?.message,
        status: err?.response?.status,
        data: err?.response?.data,
      });
      setError(
        `No se pudo guardar el detalle industrial. ` +
          `Status: ${err?.response?.status || "?"}`
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-6 border rounded-2xl bg-white">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide">
            Detalle de operación industrial
          </div>
          <div className="text-sm text-slate-600">
            Medidas y datos por puerta (Rayflex / Boplan / otras).
          </div>
        </div>
        <button
          type="button"
          onClick={addEmptyDoor}
          className="px-3 py-1.5 text-xs rounded-lg bg-slate-900 text-white"
        >
          + Agregar puerta
        </button>
      </div>

      <div className="p-4 space-y-4">
        {loading && (
          <div className="text-sm text-slate-500">Cargando detalle…</div>
        )}

        {error && (
          <div className="text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">
            {error}
          </div>
        )}

        {!loading && !hasDoors && (
          <div className="text-sm text-slate-500">
            Todavía no definiste puertas para esta operación.
            <br />
            Usá <strong>“+ Agregar puerta”</strong> para empezar.
          </div>
        )}

        {doors.map((door, idx) => {
          const prodLabel = door.productName || "Sin producto seleccionado";
          const brandLabel = door.brand ? ` · ${door.brand}` : "";
          const skuLabel = door.sku ? ` · ${door.sku}` : "";

          return (
            <div
              key={door.lineId}
              className="border rounded-xl p-3 bg-slate-50 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs text-slate-500">
                    Puerta #{idx + 1}
                  </div>
                  <div className="text-sm font-semibold text-slate-800">
                    {door.doorCode || prodLabel}
                    <span className="text-xs font-normal text-slate-500">
                      {brandLabel}
                      {skuLabel}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveDoor(door.lineId)}
                  className="text-xs text-red-600 border border-red-400 px-2 py-1 rounded-lg bg-white"
                >
                  Eliminar puerta
                </button>
              </div>

              {/* Identificador y tipo de puerta */}
              <div className="grid md:grid-cols-2 gap-3">
                <label className="text-xs">
                  Identificador de puerta
                  <Input
                    value={door.doorCode}
                    onChange={(e) =>
                      handleChangeField(door.lineId, "doorCode", e.target.value)
                    }
                    placeholder="Ej: P1, P2, Puerta Depósito, etc."
                  />
                </label>

                <label className="text-xs">
                  Tipo de puerta (producto catálogo)
                  <Select
                    value={door.productId || ""}
                    onChange={(e) =>
                      handleChangeProduct(door.lineId, e.target.value)
                    }
                  >
                    <option value="">
                      {catalogLoading
                        ? "Cargando productos…"
                        : "Seleccionar producto…"}
                    </option>
                    {catalogItems.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.brand ? ` · ${p.brand}` : ""}
                        {p.sku ? ` · ${p.sku}` : ""}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>

              {/* Medidas principales */}
              <div className="grid md:grid-cols-2 gap-3">
                <label className="text-xs">
                  Ancho disponible
                  <Input
                    value={door.widthAvailable}
                    onChange={(e) =>
                      handleChangeField(
                        door.lineId,
                        "widthAvailable",
                        e.target.value
                      )
                    }
                    placeholder="Ej: 3.20 m"
                  />
                </label>
                <label className="text-xs">
                  Alto disponible
                  <Input
                    value={door.heightAvailable}
                    onChange={(e) =>
                      handleChangeField(
                        door.lineId,
                        "heightAvailable",
                        e.target.value
                      )
                    }
                    placeholder="Ej: 4.00 m"
                  />
                </label>
              </div>

              {/* Lugar / sector / instalación */}
              <div className="grid md:grid-cols-3 gap-3">
                <label className="text-xs">
                  Sector / Lugar instalación
                  <Input
                    value={door.sector}
                    onChange={(e) =>
                      handleChangeField(door.lineId, "sector", e.target.value)
                    }
                    placeholder="Ej: Dársena 1, Cámara Frío, etc."
                  />
                </label>
                <label className="text-xs">
                  Lado de instalación
                  <Input
                    value={door.installSide}
                    onChange={(e) =>
                      handleChangeField(
                        door.lineId,
                        "installSide",
                        e.target.value
                      )
                    }
                    placeholder="Ej: Interior / Exterior / Nave 1"
                  />
                </label>
                <label className="text-xs">
                  Sobre alto disponible
                  <Input
                    value={door.headroomAvailable}
                    onChange={(e) =>
                      handleChangeField(
                        door.lineId,
                        "headroomAvailable",
                        e.target.value
                      )
                    }
                    placeholder="Espacio por encima del vano"
                  />
                </label>
              </div>

              {/* Marco y espacios laterales */}
              <div className="grid md:grid-cols-4 gap-3">
                <label className="text-xs">
                  Tipo de marco
                  <Input
                    value={door.frameType}
                    onChange={(e) =>
                      handleChangeField(
                        door.lineId,
                        "frameType",
                        e.target.value
                      )
                    }
                    placeholder="Ej: Inox, Galvanizado, Pintado…"
                  />
                </label>
                <label className="text-xs">
                  Disp. lado derecho
                  <Input
                    value={door.rightSideSpace}
                    onChange={(e) =>
                      handleChangeField(
                        door.lineId,
                        "rightSideSpace",
                        e.target.value
                      )
                    }
                    placeholder="Espacio lado der."
                  />
                </label>
                <label className="text-xs">
                  Disp. lado izquierdo
                  <Input
                    value={door.leftSideSpace}
                    onChange={(e) =>
                      handleChangeField(
                        door.lineId,
                        "leftSideSpace",
                        e.target.value
                      )
                    }
                    placeholder="Espacio lado izq."
                  />
                </label>
                <label className="text-xs">
                  Lado del motor
                  <Input
                    value={door.motorSide}
                    onChange={(e) =>
                      handleChangeField(
                        door.lineId,
                        "motorSide",
                        e.target.value
                      )
                    }
                    placeholder="Der / Izq / Otro"
                  />
                </label>
              </div>

              {/* Accionadores / visor / pie derecho */}
              <div className="grid md:grid-cols-3 gap-3">
                <label className="text-xs">
                  Accionadores
                  <Input
                    value={door.actuators}
                    onChange={(e) =>
                      handleChangeField(
                        door.lineId,
                        "actuators",
                        e.target.value
                      )
                    }
                    placeholder="Ej: Pulsador, Control remoto, Radar…"
                  />
                </label>
                <label className="text-xs">
                  Líneas de visor
                  <Input
                    value={door.visorLines}
                    onChange={(e) =>
                      handleChangeField(
                        door.lineId,
                        "visorLines",
                        e.target.value
                      )
                    }
                    placeholder="Cantidad / altura"
                  />
                </label>
                <label className="text-xs">
                  Pie derecho
                  <Input
                    value={door.rightPost}
                    onChange={(e) =>
                      handleChangeField(
                        door.lineId,
                        "rightPost",
                        e.target.value
                      )
                    }
                    placeholder="Detalles del pie derecho"
                  />
                </label>
              </div>

              {/* Observaciones */}
              <label className="text-xs block">
                Observaciones
                <TextArea
                  rows={2}
                  value={door.notes}
                  onChange={(e) =>
                    handleChangeField(door.lineId, "notes", e.target.value)
                  }
                  placeholder="Algo relevante de esta puerta: inclinaciones, interferencias, fotos, etc."
                />
              </label>
            </div>
          );
        })}

        {/* Botones inferior */}
        <div className="flex justify-between items-center pt-2 border-t mt-2">
          <button
            type="button"
            onClick={addEmptyDoor}
            className="px-3 py-1.5 text-xs rounded-lg border"
          >
            + Agregar puerta
          </button>

          <button
            type="button"
            disabled={!canSave || saving}
            onClick={handleSave}
            className="px-4 py-2 text-sm rounded-lg bg-black text-white disabled:opacity-60"
          >
            {saving ? "Guardando detalle…" : "Guardar detalle industrial"}
          </button>
        </div>
      </div>
    </div>
  );
}