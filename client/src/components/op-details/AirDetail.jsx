// client/src/sections/operation-detail/AirDetail.jsx
import React, { useState } from "react";
import { api } from "../../api";

export default function AirDetail({ op, onChange }) {
  // Normalizamos el payload inicial
  const seed = { ...(op.detail?.data || {}) };
  if (!seed.origin_airport && seed.origin_iata) seed.origin_airport = seed.origin_iata;
  if (!seed.destination_airport && seed.destination_iata) seed.destination_airport = seed.destination_iata;
  if (seed.packages == null && seed.pieces != null) seed.packages = seed.pieces;

  const [form, setForm] = useState(seed);
  const disabled = op.locked;

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  const setNum = (k) => (e) => set(k, e.target.value === "" ? "" : Number(e.target.value));

  // date (yyyy-mm-dd) -> 'yyyy-mm-dd' (DB DATETIME admite este formato; si querés, podés sumar "T00:00:00")
  const toDate = (v) => (v === "" || v == null ? null : v);

  const save = async () => {
    const { id } = op;

    const b = {
      doc_master: form.doc_master || null,
      doc_house: form.doc_house || null,
      airline: form.airline || null,
      shpr_cnee: form.shpr_cnee || null,

      origin_airport: form.origin_airport || null,
      destination_airport: form.destination_airport || null,

      packages: form.packages === "" ? null : (form.packages ?? null),
      weight_gross_kg: form.weight_gross_kg === "" ? null : (form.weight_gross_kg ?? null),
      weight_chargeable_kg: form.weight_chargeable_kg === "" ? null : (form.weight_chargeable_kg ?? null),
      volume_m3: form.volume_m3 === "" ? null : (form.volume_m3 ?? null),

      commodity: form.commodity || null,
      observations: form.observations || null,
      dimensions_text: form.dimensions_text || null,

      // Fechas (normalizadas)
      etd: toDate(form.etd),
      trans_arrival: toDate(form.trans_arrival),
      trans_depart: toDate(form.trans_depart),
      eta: toDate(form.eta),

      // Alias de compatibilidad
      origin_iata: form.origin_airport || null,
      destination_iata: form.destination_airport || null,
      pieces: form.packages === "" ? null : (form.packages ?? null),
    };

    try {
      // 1) Guardar
      await api.put(`/api/operations/${id}/air`, b);

      // 2) Refrescar desde el backend para asegurar consistencia con la DB
      const { data: fresh } = await api.get(`/api/operations/${id}?t=${Date.now()}`);
      // Actualizá el padre con lo que REALMENTE quedó
      onChange(fresh);

      // 3) (Opcional) si tenés un botón para ver el informe en una pestaña:
      // window.open(`/api/reports/status/view/${id}?t=${Date.now()}`, "_blank");

    } catch (err) {
      console.error("Error guardando detalle aéreo:", err);
      alert("No se pudo guardar el detalle. Revisá consola.");
    }
  };

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="col-span-2">
        <Field label="SHPR / CNEE">
          <input
            disabled={disabled}
            className="input"
            placeholder="Ej: SHPR: ... / CNEE: ..."
            value={form.shpr_cnee || ""}
            onChange={(e) => set("shpr_cnee", e.target.value)}
          />
        </Field>
      </div>

      <Field label="Línea aérea">
        <input
          disabled={disabled}
          className="input"
          placeholder="Ej: AMERICAN AIRLINES"
          value={form.airline || ""}
          onChange={(e) => set("airline", e.target.value)}
        />
      </Field>

      <Field label="DOC MASTER (MAWB)">
        <input
          disabled={disabled}
          className="input"
          value={form.doc_master || ""}
          onChange={(e) => set("doc_master", e.target.value)}
        />
      </Field>

      <Field label="DOC HOUSE (HAWB)">
        <input
          disabled={disabled}
          className="input"
          value={form.doc_house || ""}
          onChange={(e) => set("doc_house", e.target.value)}
        />
      </Field>

      <Field label="Aeropuerto Origen (IATA o nombre)">
        <input
          disabled={disabled}
          className="input"
          placeholder="Ej: MIA"
          value={form.origin_airport || ""}
          onChange={(e) => set("origin_airport", e.target.value.toUpperCase())}
        />
      </Field>

      <Field label="Aeropuerto Destino (IATA o nombre)">
        <input
          disabled={disabled}
          className="input"
          placeholder="Ej: ASU"
          value={form.destination_airport || ""}
          onChange={(e) => set("destination_airport", e.target.value.toUpperCase())}
        />
      </Field>

      <div className="col-span-2">
        <Field label="Mercadería">
          <input
            disabled={disabled}
            className="input"
            placeholder="Ej: PARTES DE IMPRESORAS"
            value={form.commodity || ""}
            onChange={(e) => set("commodity", e.target.value)}
          />
        </Field>
      </div>

      <Field label="Bultos">
        <input
          disabled={disabled}
          type="number"
          className="input"
          value={form.packages ?? ""}
          onChange={setNum("packages")}
        />
      </Field>

      <Field label="Peso bruto (kg)">
        <input
          disabled={disabled}
          type="number"
          step="0.001"
          className="input"
          value={form.weight_gross_kg ?? ""}
          onChange={setNum("weight_gross_kg")}
        />
      </Field>

      <Field label="Peso cobrable (kg)">
        <input
          disabled={disabled}
          type="number"
          step="0.001"
          className="input"
          value={form.weight_chargeable_kg ?? ""}
          onChange={setNum("weight_chargeable_kg")}
        />
      </Field>

      <Field label="Volumen (m³)">
        <input
          disabled={disabled}
          type="number"
          step="0.001"
          className="input"
          value={form.volume_m3 ?? ""}
          onChange={setNum("volume_m3")}
        />
      </Field>

      <Field label="Fecha SAL Aerop. Origen (ETD)">
        <input
          disabled={disabled}
          type="date"
          className="input"
          value={form.etd || ""}
          onChange={(e) => set("etd", e.target.value || null)}
        />
      </Field>

      <Field label="Fecha LLEG. Aerop. Transb (Arribo)">
        <input
          disabled={disabled}
          type="date"
          className="input"
          value={form.trans_arrival || ""}
          onChange={(e) => set("trans_arrival", e.target.value || null)}
        />
      </Field>

      <Field label="Fecha SAL Aerop. Transb (Salida)">
        <input
          disabled={disabled}
          type="date"
          className="input"
          value={form.trans_depart || ""}
          onChange={(e) => set("trans_depart", e.target.value || null)}
        />
      </Field>

      <Field label="Fecha LLEG. Destino (ETA)">
        <input
          disabled={disabled}
          type="date"
          className="input"
          value={form.eta || ""}
          onChange={(e) => set("eta", e.target.value || null)}
        />
      </Field>

      <div className="col-span-2">
        <Field label="Dimensiones (texto)">
          <input
            disabled={disabled}
            className="input"
            placeholder="Ej: 1.20x0.80x0.60x2; 0.90x0.70x0.50"
            value={form.dimensions_text || ""}
            onChange={(e) => set("dimensions_text", e.target.value)}
          />
        </Field>
      </div>

      <div className="col-span-2">
        <Field label="Observaciones">
          <textarea
            disabled={disabled}
            className="input"
            rows={3}
            value={form.observations || ""}
            onChange={(e) => set("observations", e.target.value)}
          />
        </Field>
      </div>

      {!disabled && (
        <div className="col-span-2 flex justify-end gap-2">
          <button className="btn" onClick={() => setForm(seed)}>Deshacer</button>
          <button className="btn btn-primary" onClick={save}>Guardar</button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="text-sm">
      <div className="text-gray-500 mb-1">{label}</div>
      {children}
    </label>
  );
}
