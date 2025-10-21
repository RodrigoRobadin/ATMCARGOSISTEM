import React, { useEffect, useMemo, useState } from "react";
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

// Mapa local de tipos de carga por modalidad.
// Si más adelante querés leerlos desde /params, se puede, pero con esto ya funciona.
const LOAD_TYPES = {
  AEREO: ["LCL"],
  MARITIMO: ["FCL", "LCL"],
  TERRESTRE: ["FTL", "LTL"],
  MULTIMODAL: ["N/A"],
};

export default function NewOperationModal({
  onClose,
  pipelineId,
  stages,
  onCreated,
  defaultBusinessUnitId,
}) {
  // Preview de referencia
  const [referencePreview, setReferencePreview] = useState("—");

  // Transporte / carga
  const [modo, setModo] = useState("");   // AEREO | MARITIMO | TERRESTRE | MULTIMODAL
  const [clase, setClase] = useState(""); // según modalidad (FCL/LCL, FTL/LTL, etc.)
  const [origen, setOrigen] = useState("");
  const [destino, setDestino] = useState("");

  // auto-sugerencia de tipo op, editable
  const [tipoOp, setTipoOp] = useState(""); // IMPORT | EXPORT | ""
  const [tipoOpManual, setTipoOpManual] = useState(false);

  // Carga
  const [mercaderia, setMercaderia] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [unidad, setUnidad] = useState("Bultos"); // Cajas | Bultos | Pallets
  const [peso, setPeso] = useState("");     // kg (texto libre)
  const [volumen, setVolumen] = useState(""); // m3 (texto libre)

  // Negocio/CRM
  const [businessUnits, setBusinessUnits] = useState([]);
  const [businessUnitId, setBusinessUnitId] = useState(
    defaultBusinessUnitId || ""
  );
  const [stageId, setStageId] = useState(stages?.[0]?.id || null);

  // Empresa / contacto
  const [orgName, setOrgName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  const [saving, setSaving] = useState(false);

  // Opciones de "tipo de carga" según modalidad
  const tipoCargaOptions = useMemo(() => {
    if (!modo) return [];
    return LOAD_TYPES[modo] || [];
  }, [modo]);

  // Ajustar "tipo de carga" cuando cambia modalidad
  useEffect(() => {
    if (!modo) {
      setClase("");
      return;
    }
    const opts = LOAD_TYPES[modo] || [];
    // Si el valor actual no es válido para la nueva modalidad, setear el primero.
    if (!opts.includes(clase)) {
      setClase(opts[0] || "");
    }
  }, [modo]); // eslint-disable-line

  useEffect(() => {
    // Cargar unidades de negocio si aplica
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
  }, []); // eslint-disable-line

  // Sugerir tipo de operación según origen/destino (heurística simple)
  useEffect(() => {
    if (tipoOpManual) return;
    const o = (origen || "").toLowerCase();
    const d = (destino || "").toLowerCase();
    if (o && d) {
      const isPY = (s) => s.includes("paraguay") || s.includes("asu") || s.includes("asunción") || s.includes("ag");
      if (isPY(o) && !isPY(d)) setTipoOp("EXPORT");
      if (isPY(d) && !isPY(o)) setTipoOp("IMPORT");
    }
  }, [origen, destino, tipoOpManual]);

  // Armar referencia visual
  useEffect(() => {
    const parts = [
      (modo || "").trim(),
      (clase || "").trim(),
      (origen || "").trim(),
      (destino || "").trim(),
    ].filter(Boolean);
    setReferencePreview(parts.length ? parts.join(" • ") : "—");
  }, [modo, clase, origen, destino]);

  const canSave = useMemo(() => {
    return (
      pipelineId &&
      stageId &&
      (modo || "").length &&
      (clase || "").length && // ahora obligatorio para evitar inconsistencias
      (origen || "").length &&
      (destino || "").length &&
      (orgName || "").length
    );
  }, [pipelineId, stageId, modo, clase, origen, destino, orgName]);

  async function handleCreate(e) {
    e?.preventDefault?.();
    if (!canSave || saving) return;
    setSaving(true);
    try {
      // Título seguro (backend también blinda)
      const titleFromForm = `${orgName}`.trim();
      const fallbackPieces = [modo || "", clase || "", mercaderia || ""].filter(Boolean);
      const safeTitle =
        titleFromForm ||
        (fallbackPieces.length ? fallbackPieces.join(" • ") : "") ||
        "Operación";

      // Crear deal (enviamos formato PLANO, backend actual ya lo permite)
      const payload = {
        pipeline_id: pipelineId,
        stage_id: stageId,
        title: safeTitle,
        value: 0,
        business_unit_id: businessUnitId || null,

        // Organización / contacto (planos)
        org_name: orgName || null,
        contact_name: contactName || null,
        contact_phone: contactPhone || null,
        contact_email: contactEmail || null,
      };

      const { data: created } = await api.post("/deals", payload);
      const dealId = created?.id;
      if (!dealId) throw new Error("No se obtuvo el ID de la operación");

      // ==== Guardar CFs mínimos para que el Detalle muestre todo discriminado ====
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
      await Promise.all(
        cfPayloads.map((p) => api.post(`/deals/${dealId}/custom-fields`, p))
      );

      // ==== Espejo en /operations según modalidad (para que el subform se inicialice coherente) ====
      if (modo === "MARITIMO") {
        await api
          .put(`/operations/${dealId}/ocean`, {
            load_type: clase,               // "FCL" | "LCL"
            pol: origen || "",
            pod: destino || "",
            commodity: mercaderia || "",
            packages: cantidad || "",
            weight_kg: peso || "",
            volume_m3: volumen || "",
          })
          .catch(() => {}); // si aún no existe /operations, el CF ya cubre el detalle
      } else if (modo === "TERRESTRE") {
        await api
          .put(`/operations/${dealId}/road`, {
            cargo_class: clase,             // "FTL" | "LTL"
            origin_city: origen || "",
            destination_city: destino || "",
            commodity: mercaderia || "",
            packages: cantidad || "",
            weight_kg: peso || "",
            volume_m3: volumen || "",
          })
          .catch(() => {});
      } else if (modo === "AEREO") {
        // opcional: espejar algunos campos
        await api
          .put(`/operations/${dealId}/air`, {
            origin_airport: origen || "",
            destination_airport: destino || "",
            commodity: mercaderia || "",
            packages: cantidad || "",
            weight_gross_kg: peso || "",
            volume_m3: volumen || "",
          })
          .catch(() => {});
      } else if (modo === "MULTIMODAL") {
        // opcional: dejar solo CFs; el subform multimodal es más libre
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
              <label className="text-sm">
                Organización
                <Input
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Ej: ACME S.A."
                  required
                />
              </label>
              <label className="text-sm">
                Contacto
                <Input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Nombre y apellido"
                />
              </label>
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

          {/* Datos de operación */}
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="font-medium mb-2">Operación</div>
            <div className="grid gap-2">
              <label className="text-sm">
                Modo
                <Select
                  value={modo}
                  onChange={(e) => setModo(e.target.value)}
                  required
                >
                  <option value="">—</option>
                  <option value="AEREO">AÉREO</option>
                  <option value="MARITIMO">MARÍTIMO</option>
                  <option value="TERRESTRE">TERRESTRE</option>
                  <option value="MULTIMODAL">MULTIMODAL</option>
                </Select>
              </label>

              {/* 👇 Tipo de carga AHORA va ANTES de Origen y depende de "modo" */}
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
                    tipoCargaOptions.map((v) => (
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

              <label className="text-sm flex items-center gap-2">
                Tipo de operación
                <Select
                  value={tipoOp}
                  onChange={(e) => {
                    setTipoOp(e.target.value);
                    setTipoOpManual(true);
                  }}
                >
                  <option value="">—</option>
                  <option value="IMPORT">IMPORT</option>
                  <option value="EXPORT">EXPORT</option>
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
