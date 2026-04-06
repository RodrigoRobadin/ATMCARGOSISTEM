// client/src/components/op-details/RoadDetail.jsx
import { useEffect, useState } from 'react';
import { api } from '../../api';

const CONTAINER_TYPES = [
  { value: '40 ST', label: '40 ST' },
  { value: '20 ST', label: '20 ST' },
  { value: 'Reefer 40', label: 'Reefer 40' },
  { value: 'Reefer 20', label: 'Reefer 20' },
  { value: 'HC', label: 'HC' },
];

const parseContainers = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

export default function RoadDetail({ dealId, data = {}, saving, onSaving, onSaved }) {
  const [form, setForm] = useState({
    cmr_crt_number:'', provider_org_id:'', truck_plate:'', trailer_plate:'',
    driver_name:'', driver_phone:'', border_crossing:'',
    origin_city:'', destination_city:'', route_itinerary:'',
    cargo_class:'FTL', commodity:'', packages:'', weight_kg:'', volume_m3:'',
    hazmat:false, temp_control:false, temp_c:'', seal_no:'',
    observations:'', etd:'', eta:'', transit_days:'',
    containers_json: []
  });

  useEffect(() => { setForm(f => ({ ...f, ...data, containers_json: parseContainers(data?.containers_json) })); }, [data]);
  const set = (k, v) => setForm(s => ({ ...s, [k]: v }));

  const isFcl = String(form.cargo_class || '').toUpperCase() === 'FCL';
  const addCntr = () =>
    set('containers_json', [
      ...(form.containers_json || []),
      { type: '', qty: '' }
    ]);
  const setCntr = (i, k, v) => {
    const arr = [...(form.containers_json || [])];
    arr[i] = { ...arr[i], [k]: v };
    set('containers_json', arr);
  };
  const delCntr = (i) => {
    const arr = [...(form.containers_json || [])];
    arr.splice(i, 1);
    set('containers_json', arr);
  };

  const containersQty = (form.containers_json || []).reduce(
  useEffect(() => {
    if (isFcl) set('packages', String(containersQty || 0));
  }, [isFcl, containersQty]);
  useEffect(() => {
    if (isFcl && (form.containers_json || []).length === 0) {
      set('containers_json', [{ type: '', qty: '' }]);
    }
  }, [isFcl]);

    (s, c) => s + Number(c?.qty || 0),
    0
  );

  const save = async () => {
    try {
      onSaving?.(true);
      await api.putRoad(dealId, {
        ...form,
        hazmat: !!form.hazmat,
        temp_control: !!form.temp_control,
        containers_json: form.containers_json || []
      });
      onSaved?.();
    } catch (e) {
      console.error(e);
      alert('No se pudo guardar Terrestre');
    } finally { onSaving?.(false); }
  };

  return (
    <div>
      <Grid>
        <Input label="CMR/CRT" value={form.cmr_crt_number} onChange={v => set('cmr_crt_number', v)} />
        <Input label="Proveedor (ID)" value={form.provider_org_id} onChange={v => set('provider_org_id', v)} />
        <Input label="Placa Camión" value={form.truck_plate} onChange={v => set('truck_plate', v)} />
        <Input label="Placa Remolque" value={form.trailer_plate} onChange={v => set('trailer_plate', v)} />
        <Input label="Chofer" value={form.driver_name} onChange={v => set('driver_name', v)} />
        <Input label="Tel. Chofer" value={form.driver_phone} onChange={v => set('driver_phone', v)} />
        <Input label="Cruce Fronterizo" value={form.border_crossing} onChange={v => set('border_crossing', v)} />
        <Input label="Ciudad Origen" value={form.origin_city} onChange={v => set('origin_city', v)} />
        <Input label="Ciudad Destino" value={form.destination_city} onChange={v => set('destination_city', v)} />
        <Input label="Itinerario Ruta" value={form.route_itinerary} onChange={v => set('route_itinerary', v)} />
        <Select label="Clase carga" value={form.cargo_class} onChange={v => set('cargo_class', v)} options={['FTL','LTL','FCL']} />
        <Input label="Mercadería" value={form.commodity} onChange={v => set('commodity', v)} />
        <Input
          label={isFcl ? "Contenedores" : "Bultos"}
          type="number"
          value={isFcl ? containersQty : form.packages}
          onChange={v => set('packages', v)}
          disabled={isFcl}
        />
        <Input label="Peso (kg)" type="number" value={form.weight_kg} onChange={v => set('weight_kg', v)} />
        <Input label="Volumen (m³)" type="number" value={form.volume_m3} onChange={v => set('volume_m3', v)} />
        <Check label="Hazmat" checked={!!form.hazmat} onChange={v => set('hazmat', v)} />
        <Check label="Control temperatura" checked={!!form.temp_control} onChange={v => set('temp_control', v)} />
        <Input label="Temperatura (°C)" type="number" value={form.temp_c} onChange={v => set('temp_c', v)} />
        <Input label="Precinto" value={form.seal_no} onChange={v => set('seal_no', v)} />
        <Input label="ETD" type="datetime-local" value={toLocal(form.etd)} onChange={v => set('etd', v)} />
        <Input label="ETA" type="datetime-local" value={toLocal(form.eta)} onChange={v => set('eta', v)} />
        <Input label="Días tránsito" type="number" value={form.transit_days} onChange={v => set('transit_days', v)} />
        <TextArea label="Observaciones" value={form.observations} onChange={v => set('observations', v)} />
      </Grid>

      {isFcl && (
        <div
          style={{
            marginTop: 12,
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            overflow: 'hidden',
            background: '#fff'
          }}
        >
          <div style={{ padding: '10px 12px', background: '#f8fafc', fontWeight: 600 }}>
            Contenedores ({(form.containers_json || []).length})
          </div>
          <div style={{ padding: 12, display: 'grid', gap: 8 }}>
            {(form.containers_json || []).map((c, i) => (
              <div
                key={i}
                style={{
                  display:'grid',
                  gridTemplateColumns:'1fr 120px 1fr 1fr auto',
                  gap: 8,
                  alignItems: 'end'
                }}
              >
                <Select
                  label="Tipo de contenedor"
                  value={c.type || ''}
                  onChange={v => setCntr(i, 'type', v)}
                  options={['', ...CONTAINER_TYPES.map(t => t.value)]}
                />
                <Input label="Cantidad" type="number" value={c.qty} onChange={v => setCntr(i, 'qty', v)} />
                  <Input label="Nro contenedor" value={c.cntr_no} onChange={v => setCntr(i, 'cntr_no', v)} />
                  <Input label="Nro precinto" value={c.seal_no} onChange={v => setCntr(i, 'seal_no', v)} />
                <button
                  type="button"
                  onClick={() => delCntr(i)}
                  style={{
                    height: 36,
                    border: 0,
                    background: '#f1f5f9',
                    borderRadius: 8,
                    padding: '8px 10px',
                    cursor: 'pointer'
                  }}
                  title="Eliminar contenedor"
                >
                  X
                </button>
              </div>
            ))}
            <div>
              <button
                type="button"
                onClick={addCntr}
                style={{
                  width: 180,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px dashed #94a3b8',
                  background: 'transparent',
                  cursor: 'pointer'
                }}
              >
                + Agregar contenedor
              </button>
            </div>
          </div>
        </div>
      )}
      <Actions onSave={save} saving={saving} />
    </div>
  );
}

function toLocal(v){ return v ? v.replace('Z','').slice(0,16) : ''; }
const Grid = ({children}) => (<div style={{ display:'grid', gridTemplateColumns:'repeat(3,minmax(0,1fr))', gap:12 }}>{children}</div>);
const Input = ({label,value,onChange,type='text'}) => (
  <label style={{ display:'grid', gap:6 }}>
    <span style={{ fontSize:12, opacity:0.7 }}>{label}</span>
    <input type={type} value={value ?? ''} onChange={e=>onChange(e.target.value)} style={{ padding:8, border:'1px solid #ddd', borderRadius:6 }} />
  </label>
);
const Select = ({label,value,onChange,options=[]}) => (
  <label style={{ display:'grid', gap:6 }}>
    <span style={{ fontSize:12, opacity:0.7 }}>{label}</span>
    <select value={value} onChange={e=>onChange(e.target.value)} style={{ padding:8, border:'1px solid #ddd', borderRadius:6 }}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  </label>
);
const Check = ({label,checked,onChange}) => (
  <label style={{ display:'flex', alignItems:'center', gap:8 }}>
    <input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} />
    <span>{label}</span>
  </label>
);
const TextArea = ({label,value,onChange}) => (
  <label style={{ display:'grid', gap:6, gridColumn:'1/-1' }}>
    <span style={{ fontSize:12, opacity:0.7 }}>{label}</span>
    <textarea rows={3} value={value ?? ''} onChange={e=>onChange(e.target.value)} style={{ padding:8, border:'1px solid #ddd', borderRadius:6 }} />
  </label>
);
const Actions = ({ onSave, saving }) => (
  <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
    <button onClick={onSave} disabled={saving} style={{ padding: '8px 12px', borderRadius: 6, background: '#2563eb', color: '#fff', border: 0 }}>
      {saving ? 'Guardando…' : 'Guardar'}
    </button>
  </div>
);
