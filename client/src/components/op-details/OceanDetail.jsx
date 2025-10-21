import { useEffect, useState } from 'react';
import { api } from '../../api';

export default function OceanDetail({ dealId, data = {}, saving, onSaving, onSaved }) {
  const [form, setForm] = useState({
    // Identificación / actores
    mbl:'', hbl:'', shipping_line:'', load_type:'LCL',
    shpr_cnee:'', agent:'', customs_broker:'', provider:'', incoterm:'',
    // Puertos
    pol:'', transshipment_port:'', pod:'',
    // Carga
    commodity:'', packages:'', weight_kg:'', volume_m3:'', chargeable_kg:'', dimensions_text:'',
    // Seguro / facturación / condición
    seguro_flag:'', tipo_seguro:'', cert_seguro:'', condicion:'', fact_no:'', valor_fact:'',
    // Tránsitos y free time
    transit_time_days:'', free_days:'', itinerary:'',
    doc_nav_delivery:'', doc_client_delivery:'', free_start:'', free_end:'',
    // Eventos de viaje / tiempos reales
    etd:'', trans_arrival:'', trans_depart:'', eta:'', transit_days:'',
    // Contenedores / varios
    containers_json: [], observations:'',
  });

  // control del acordeón de contenedores
  const [containersOpen, setContainersOpen] = useState(false);

  useEffect(() => {
    setForm(f => ({
      ...f,
      ...data,
      containers_json: Array.isArray(data?.containers_json) ? data.containers_json : [],
    }));
  }, [data]);

  useEffect(() => {
    // abrir automáticamente si ya hay contenedores
    setContainersOpen((form.containers_json || []).length > 0);
  }, [form.containers_json?.length]);

  const set = (k, v) => setForm(s => ({ ...s, [k]: v }));

  const addCntr = () => set('containers_json', [...(form.containers_json || []), { cntr_no:'', seal_no:'' }]);
  const setCntr = (i, k, v) => {
    const arr = [...(form.containers_json || [])];
    arr[i] = { ...arr[i], [k]: v };
    set('containers_json', arr);
  };
  const delCntr = (i) => {
    const a = [...(form.containers_json || [])];
    a.splice(i,1);
    set('containers_json', a);
  };

  const save = async () => {
    try {
      onSaving?.(true);
      await api.putOcean(dealId, form);
      onSaved?.();
    } catch (e) {
      console.error(e);
      alert('No se pudo guardar Marítimo');
    } finally {
      onSaving?.(false);
    }
  };

  // resumen compacto para la barra
  const containersSummary = (form.containers_json || [])
    .map((c, idx) => (c?.cntr_no ? c.cntr_no : `#${idx+1}`))
    .filter(Boolean)
    .join(' • ');

  return (
    <div>
      <Grid>
        {/* Identificación / actores */}
        <Input label="MBL" value={form.mbl} onChange={v => set('mbl', v)} />
        <Input label="HBL" value={form.hbl} onChange={v => set('hbl', v)} />
        <Input label="Naviera" value={form.shipping_line} onChange={v => set('shipping_line', v)} />
        {/* ⚠️ Quitado: Tipo carga (se maneja en Detalles de operación) */}
        <Input label="Shpr/Cnee" value={form.shpr_cnee} onChange={v => set('shpr_cnee', v)} />
        <Input label="Agente" value={form.agent} onChange={v => set('agent', v)} />
        <Input label="Ag. Aduanera" value={form.customs_broker} onChange={v => set('customs_broker', v)} />
        <Input label="Proveedor" value={form.provider} onChange={v => set('provider', v)} />
        <Input label="Incoterm" value={form.incoterm} onChange={v => set('incoterm', v)} />

        {/* Puertos */}
        <Input label="Puerto Origen" value={form.pol} onChange={v => set('pol', v)} />
        <Input label="Transbordo" value={form.transshipment_port} onChange={v => set('transshipment_port', v)} />
        <Input label="Puerto Destino" value={form.pod} onChange={v => set('pod', v)} />

        {/* Carga */}
        <Input label="Mercadería" value={form.commodity} onChange={v => set('commodity', v)} />
        <Input label="Bultos" type="number" value={form.packages} onChange={v => set('packages', v)} />
        <Input label="Peso (kg)" type="number" value={form.weight_kg} onChange={v => set('weight_kg', v)} />
        <Input label="Volumen (m³)" type="number" value={form.volume_m3} onChange={v => set('volume_m3', v)} />
        <Input label="Chg. (kg)" type="number" value={form.chargeable_kg} onChange={v => set('chargeable_kg', v)} />
        <Input label="Dimensiones" value={form.dimensions_text} onChange={v => set('dimensions_text', v)} />

        {/* Tránsitos / free time */}
        <Input label="Tránsito (días)" type="number" value={form.transit_time_days} onChange={v => set('transit_time_days', v)} />
        <Input label="Free days" type="number" value={form.free_days} onChange={v => set('free_days', v)} />
        <Input label="Itinerario" value={form.itinerary} onChange={v => set('itinerary', v)} />
        <Input label="Entrega Doc. Naviera" type="datetime-local" value={toLocal(form.doc_nav_delivery)} onChange={v => set('doc_nav_delivery', v)} />
        <Input label="Entrega Doc. Cliente" type="datetime-local" value={toLocal(form.doc_client_delivery)} onChange={v => set('doc_client_delivery', v)} />
        <Input label="Inicio Free" type="datetime-local" value={toLocal(form.free_start)} onChange={v => set('free_start', v)} />
        <Input label="Fin Free" type="datetime-local" value={toLocal(form.free_end)} onChange={v => set('free_end', v)} />

        {/* Seguro / facturación / condición */}
        <Input label="Seguro (X/—)" value={form.seguro_flag} onChange={v => set('seguro_flag', v)} />
        <Input label="Tipo seguro" value={form.tipo_seguro} onChange={v => set('tipo_seguro', v)} />
        <Input label="Cert. seguro" value={form.cert_seguro} onChange={v => set('cert_seguro', v)} />
        <Input label="Condición" value={form.condicion} onChange={v => set('condicion', v)} />
        <Input label="FACT Nº" value={form.fact_no} onChange={v => set('fact_no', v)} />
        <Input label="Valor Factura" value={form.valor_fact} onChange={v => set('valor_fact', v)} />

        {/* Eventos de viaje / tiempos reales */}
        <Input label="ETD" type="datetime-local" value={toLocal(form.etd)} onChange={v => set('etd', v)} />
        <Input label="Arribo Transb." type="datetime-local" value={toLocal(form.trans_arrival)} onChange={v => set('trans_arrival', v)} />
        <Input label="Salida Transb." type="datetime-local" value={toLocal(form.trans_depart)} onChange={v => set('trans_depart', v)} />
        <Input label="ETA" type="datetime-local" value={toLocal(form.eta)} onChange={v => set('eta', v)} />
        <Input label="Días T. (real)" type="number" value={form.transit_days} onChange={v => set('transit_days', v)} />

        {/* Observaciones */}
        <TextArea label="Observaciones" value={form.observations} onChange={v => set('observations', v)} />
      </Grid>

      {/* ====== Contenedores ====== */}
      <div
        style={{
          marginTop: 12,
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          overflow: 'hidden',
          background: '#fff'
        }}
      >
        {/* Barra desplegable */}
        <button
          type="button"
          onClick={() => setContainersOpen(o => !o)}
          style={{
            width: '100%',
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '10px 12px',
            background: '#f8fafc',
            border: 0,
            cursor: 'pointer'
          }}
        >
          <span style={{ fontWeight: 600 }}>
            Contenedores ({(form.containers_json || []).length})
          </span>
          <div style={{ flex: 1, marginLeft: 12, overflowX: 'auto', whiteSpace: 'nowrap' }}>
            {/* chips resumen */}
            {(form.containers_json || []).length ? (
              (form.containers_json || []).map((c, i) => (
                <span
                  key={`chip-${i}`}
                  style={{
                    display: 'inline-block',
                    fontSize: 12,
                    background: '#e5e7eb',
                    padding: '4px 8px',
                    borderRadius: 999,
                    marginRight: 6
                  }}
                  title={c.seal_no ? `Precinto: ${c.seal_no}` : 'Sin precinto'}
                >
                  {c.cntr_no || `CNTR #${i + 1}`}
                </span>
              ))
            ) : (
              <span style={{ fontSize: 12, color: '#64748b' }}>Sin contenedores</span>
            )}
          </div>
          <span style={{ fontSize: 18, lineHeight: 1 }}>{containersOpen ? '▴' : '▾'}</span>
        </button>

        {/* Cuerpo del acordeón */}
        {containersOpen && (
          <div style={{ padding: 12, display: 'grid', gap: 8 }}>
            {(form.containers_json || []).map((c, i) => (
              <div
                key={i}
                style={{
                  display:'grid',
                  gridTemplateColumns:'1fr 1fr auto',
                  gap: 8,
                  alignItems: 'end'
                }}
              >
                <Input label="CNTR Nro" value={c.cntr_no} onChange={v => setCntr(i, 'cntr_no', v)} />
                <Input label="PRECINTO Nro" value={c.seal_no} onChange={v => setCntr(i, 'seal_no', v)} />
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
                  ✕
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
        )}
      </div>

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
