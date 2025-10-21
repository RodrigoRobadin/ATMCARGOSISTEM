// client/src/components/op-details/MultimodalDetail.jsx
import { useEffect, useState } from 'react';
import { api } from '../../api';

const MODES = ['AIR', 'OCEAN', 'ROAD'];

export default function MultimodalDetail({ dealId, data = {}, saving, onSaving, onSaved }) {
  const [form, setForm] = useState({
    // Cabecera / docs
    start_date: '', quote_date: '', confirm_date: '',
    invoice_no: '', invoice_value: '',

    // Partes
    shipper_cnee: '', agent: '', shipping_line: '', provider: '', customs_broker: '',

    // Operación
    operation_type: '', load_mode: '', cargo_type: '', incoterm: '',
    insurance_flag: '', insurance_type: 'CRT', condition: 'PUERTO A PUERTA', insurance_cert: '',

    // Puertos
    origin_port: '', transshipment_port: '', destination_port: '',

    // Carga
    commodity: '', packages: '', weight_gross_kg: '', volume_m3: '', chargeable_kg: '', dimensions_text: '',

    // Tránsitos / free / itinerario
    transit_time_days: '', free_days: '', itinerary: '',
    doc_nav_delivery: '', doc_client_delivery: '', free_start: '', free_end: '',

    // Contenedores / placas (dos posiciones simples)
    cntr_no: '', seal_no: '', cntr_no_2: '', seal_no_2: '',
    truck_plate: '', truck_plate_2: '',

    // Hitos
    etd: '', trans_arrival: '', trans_depart: '', eta: '', transit_days: '',

    // Observaciones
    observations: '',

    // Documentos base multimodal
    doc_master: '', doc_house: '', crt_number: '',

    // Estructuras
    containers_json: [], truck_plates_json: [], legs: []
  });

  useEffect(() => {
    setForm(f => ({
      ...f,
      ...data,
      legs: data?.legs || [],
      containers_json: data?.containers_json || [],
      truck_plates_json: data?.truck_plates_json || []
    }));
  }, [data]);

  const set = (k, v) => setForm(s => ({ ...s, [k]: v }));

  // Legs
  const addLeg = () => {
    const leg_no = (form.legs?.length || 0) + 1;
    set('legs', [
      ...(form.legs || []),
      {
        leg_no, mode: 'OCEAN',
        carrier: '', origin: '', destination: '', ref_doc: '',
        etd: '', eta: '', weight_kg: '', volume_m3: '', packages: ''
      }
    ]);
  };
  const setLeg = (i, k, v) => {
    const arr = [...(form.legs || [])];
    arr[i] = { ...arr[i], [k]: v };
    set('legs', arr);
  };
  const delLeg = (i) => {
    const a = [...(form.legs || [])];
    a.splice(i, 1);
    a.forEach((L, idx) => (L.leg_no = idx + 1));
    set('legs', a);
  };

  const save = async () => {
    try {
      onSaving?.(true);
      await api.putMultimodal(dealId, form);
      onSaved?.();
    } catch (e) {
      console.error(e);
      alert('No se pudo guardar Multimodal');
    } finally { onSaving?.(false); }
  };

  return (
    <div>
      {/* ======= Cabecera ======= */}
      <Section title="Fechas & Facturación">
        <Grid cols={4}>
          <Input label="F. INICIO" type="date" value={toDate(form.start_date)} onChange={v => set('start_date', v)} />
          <Input label="F. COTIZ" type="date" value={toDate(form.quote_date)} onChange={v => set('quote_date', v)} />
          <Input label="F. CONFIR" type="date" value={toDate(form.confirm_date)} onChange={v => set('confirm_date', v)} />
          <Input label="FACT No" value={form.invoice_no} onChange={v => set('invoice_no', v)} />
          <Input label="VALOR FACT" value={form.invoice_value} onChange={v => set('invoice_value', v)} />
        </Grid>
      </Section>

      {/* ======= Partes ======= */}
      <Section title="Partes">
        <Grid cols={3}>
          <Input label="SHPR/CNEE" value={form.shipper_cnee} onChange={v => set('shipper_cnee', v)} />
          <Input label="AGENTE" value={form.agent} onChange={v => set('agent', v)} />
          <Input label="LÍNEA MARÍT / CARRIER" value={form.shipping_line} onChange={v => set('shipping_line', v)} />
          <Input label="PROVEEDOR" value={form.provider} onChange={v => set('provider', v)} />
          <Input label="AG. ADUANERA" value={form.customs_broker} onChange={v => set('customs_broker', v)} />
        </Grid>
      </Section>

      {/* ======= Operación ======= */}
      <Section title="Operación">
        <Grid cols={4}>
          <Input label="TIPO OPERACIÓN" value={form.operation_type} onChange={v => set('operation_type', v)} />
          <Input label="MOD DE CARGA" value={form.load_mode} onChange={v => set('load_mode', v)} />
          <Input label="TIPO CARGA" value={form.cargo_type} onChange={v => set('cargo_type', v)} />
          <Input label="INCOTERM" value={form.incoterm} onChange={v => set('incoterm', v)} />
          <Select label="SEGURO" value={form.insurance_flag} onChange={v => set('insurance_flag', v)} options={['', 'X']} />
          <Input label="TIPO SEGURO" value={form.insurance_type} onChange={v => set('insurance_type', v)} />
          <Input label="CONDICIÓN" value={form.condition} onChange={v => set('condition', v)} />
          <Input label="CERT. SEGURO" value={form.insurance_cert} onChange={v => set('insurance_cert', v)} />
        </Grid>
      </Section>

      {/* ======= Puertos ======= */}
      <Section title="Puertos">
        <Grid cols={3}>
          <Input label="PTO ORIG" value={form.origin_port} onChange={v => set('origin_port', v)} />
          <Input label="PTO TRANB" value={form.transshipment_port} onChange={v => set('transshipment_port', v)} />
          <Input label="PTO DEST" value={form.destination_port} onChange={v => set('destination_port', v)} />
        </Grid>
      </Section>

      {/* ======= Carga ======= */}
      <Section title="Datos de la carga">
        <Grid cols={4}>
          <Input label="MERCADERÍA" value={form.commodity} onChange={v => set('commodity', v)} />
          <Input label="CANT BULTOS" type="number" value={form.packages} onChange={v => set('packages', v)} />
          <Input label="P. BRUTO (kg)" type="number" value={form.weight_gross_kg} onChange={v => set('weight_gross_kg', v)} />
          <Input label="VOL M3" type="number" value={form.volume_m3} onChange={v => set('volume_m3', v)} />
          <Input label="P. VOL (kg)" type="number" value={form.chargeable_kg} onChange={v => set('chargeable_kg', v)} />
          <Input label="DIMENSIONES" value={form.dimensions_text} onChange={v => set('dimensions_text', v)} />
        </Grid>
      </Section>

      {/* ======= Tiempos / Free / Itinerario ======= */}
      <Section title="Tiempos & Free">
        <Grid cols={4}>
          <Input label="TIEMPO TRANS (d)" type="number" value={form.transit_time_days} onChange={v => set('transit_time_days', v)} />
          <Input label="DÍAS LIBRE" type="number" value={form.free_days} onChange={v => set('free_days', v)} />
          <Input label="ITINERARIO" value={form.itinerary} onChange={v => set('itinerary', v)} />
          <Input label="F. ENT. DOC NAV" type="datetime-local" value={toLocal(form.doc_nav_delivery)} onChange={v => set('doc_nav_delivery', v)} />
          <Input label="F. ENT. DOC CLIENTE" type="datetime-local" value={toLocal(form.doc_client_delivery)} onChange={v => set('doc_client_delivery', v)} />
          <Input label="INICIO DÍAS LIBRE" type="datetime-local" value={toLocal(form.free_start)} onChange={v => set('free_start', v)} />
          <Input label="FIN DÍAS LIBRE" type="datetime-local" value={toLocal(form.free_end)} onChange={v => set('free_end', v)} />
        </Grid>
      </Section>

      {/* ======= Contenedor / Precinto / Placas ======= */}
      <Section title="Equipos & Precintos">
        <Grid cols={4}>
          <Input label="CNTR No" value={form.cntr_no} onChange={v => set('cntr_no', v)} />
          <Input label="PRECINTO No" value={form.seal_no} onChange={v => set('seal_no', v)} />
          <Input label="CNTR No (2)" value={form.cntr_no_2} onChange={v => set('cntr_no_2', v)} />
          <Input label="PRECINTO No (2)" value={form.seal_no_2} onChange={v => set('seal_no_2', v)} />
          <Input label="PLACA CAMIÓN" value={form.truck_plate} onChange={v => set('truck_plate', v)} />
          <Input label="PLACA CAMIÓN (2)" value={form.truck_plate_2} onChange={v => set('truck_plate_2', v)} />
        </Grid>
      </Section>

      {/* ======= Observaciones ======= */}
      <Section title="Observaciones">
        <Grid>
          <TextArea label="OBS" value={form.observations} onChange={v => set('observations', v)} />
        </Grid>
      </Section>

      {/* ======= Hitos ======= */}
      <Section title="Hitos del viaje">
        <Grid cols={5}>
          <Input label="F. EST SALIDA (ETD)" type="datetime-local" value={toLocal(form.etd)} onChange={v => set('etd', v)} />
          <Input label="LLEGADA TRANSB" type="datetime-local" value={toLocal(form.trans_arrival)} onChange={v => set('trans_arrival', v)} />
          <Input label="SAL TRANSB" type="datetime-local" value={toLocal(form.trans_depart)} onChange={v => set('trans_depart', v)} />
          <Input label="LLEGADA DESTINO (ETA)" type="datetime-local" value={toLocal(form.eta)} onChange={v => set('eta', v)} />
          <Input label="DÍAS T." type="number" value={form.transit_days} onChange={v => set('transit_days', v)} />
        </Grid>
      </Section>

      {/* ======= Documentos base multimodal ======= */}
      <Section title="Documentación Multimodal">
        <Grid cols={3}>
          <Input label="Doc. Master" value={form.doc_master} onChange={v => set('doc_master', v)} />
          <Input label="Doc. House" value={form.doc_house} onChange={v => set('doc_house', v)} />
          <Input label="CRT" value={form.crt_number} onChange={v => set('crt_number', v)} />
        </Grid>
      </Section>

      {/* ======= Tramos ======= */}
      <h4 style={{ marginTop: 16, marginBottom: 8 }}>Tramos</h4>
      <div style={{ display: 'grid', gap: 12 }}>
        {(form.legs || []).map((L, i) => (
          <div key={i} style={{ border: '1px solid #eee', borderRadius: 8, padding: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0,1fr))', gap: 8 }}>
              <Input label="N°" value={L.leg_no} onChange={() => {}} />
              <Select label="Modo" value={L.mode} onChange={v => setLeg(i, 'mode', v)} options={MODES} />
              <Input label="Carrier" value={L.carrier} onChange={v => setLeg(i, 'carrier', v)} />
              <Input label="Origen" value={L.origin} onChange={v => setLeg(i, 'origin', v)} />
              <Input label="Destino" value={L.destination} onChange={v => setLeg(i, 'destination', v)} />
              <Input label="Ref. Doc" value={L.ref_doc} onChange={v => setLeg(i, 'ref_doc', v)} />
              <Input label="ETD" type="datetime-local" value={toLocal(L.etd)} onChange={v => setLeg(i, 'etd', v)} />
              <Input label="ETA" type="datetime-local" value={toLocal(L.eta)} onChange={v => setLeg(i, 'eta', v)} />
              <Input label="Peso (kg)" type="number" value={L.weight_kg} onChange={v => setLeg(i, 'weight_kg', v)} />
              <Input label="Volumen (m³)" type="number" value={L.volume_m3} onChange={v => setLeg(i, 'volume_m3', v)} />
              <Input label="Bultos" type="number" value={L.packages} onChange={v => setLeg(i, 'packages', v)} />
            </div>
            <div style={{ marginTop: 8, textAlign: 'right' }}>
              <button onClick={() => delLeg(i)} style={{ border: 0, background: '#eee', borderRadius: 6, padding: '6px 10px' }}>
                Eliminar tramo
              </button>
            </div>
          </div>
        ))}
        <button
          onClick={addLeg}
          style={{ width: 180, padding: '8px 12px', borderRadius: 6, border: '1px dashed #bbb', background: 'transparent' }}
        >
          + Agregar tramo
        </button>
      </div>

      <Actions onSave={save} saving={saving} />
    </div>
  );
}

/* ===== helpers UI ===== */
function Section({ title, children }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,.06)', padding: 12, marginBottom: 12 }}>
      <h4 style={{ margin: 0, marginBottom: 8, fontWeight: 600 }}>{title}</h4>
      {children}
    </div>
  );
}

function toLocal(v) { return v ? String(v).replace('Z', '').slice(0, 16) : ''; }
function toDate(v) { return v ? String(v).slice(0, 10) : ''; }

const Grid = ({ children, cols = 3 }) => (
  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gap: 12 }}>
    {children}
  </div>
);

const Input = ({ label, value, onChange, type = 'text' }) => (
  <label style={{ display: 'grid', gap: 6 }}>
    <span style={{ fontSize: 12, opacity: 0.7 }}>{label}</span>
    <input type={type} value={value ?? ''} onChange={e => onChange(e.target.value)} style={{ padding: 8, border: '1px solid #ddd', borderRadius: 6 }} />
  </label>
);

const Select = ({ label, value, onChange, options = [] }) => (
  <label style={{ display: 'grid', gap: 6 }}>
    <span style={{ fontSize: 12, opacity: 0.7 }}>{label}</span>
    <select value={value ?? ''} onChange={e => onChange(e.target.value)} style={{ padding: 8, border: '1px solid #ddd', borderRadius: 6 }}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  </label>
);

const TextArea = ({ label, value, onChange }) => (
  <label style={{ display: 'grid', gap: 6, gridColumn: '1 / -1' }}>
    <span style={{ fontSize: 12, opacity: 0.7 }}>{label}</span>
    <textarea rows={3} value={value ?? ''} onChange={e => onChange(e.target.value)} style={{ padding: 8, border: '1px solid #ddd', borderRadius: 6 }} />
  </label>
);

const Actions = ({ onSave, saving }) => (
  <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
    <button onClick={onSave} disabled={saving} style={{ padding: '8px 12px', borderRadius: 6, background: '#2563eb', color: '#fff', border: 0 }}>
      {saving ? 'Guardando…' : 'Guardar'}
    </button>
  </div>
);
