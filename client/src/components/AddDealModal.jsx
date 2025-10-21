import React, { useEffect, useState } from 'react';
import { api } from '../api';

export default function AddDealModal({ onClose, pipelineId, stages, onCreated, defaultBusinessUnitId }){
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [stageId, setStageId] = useState(stages?.[0]?.id || null);
  const [orgName, setOrgName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const [businessUnits, setBusinessUnits] = useState([]);
  const [businessUnitId, setBusinessUnitId] = useState(defaultBusinessUnitId || '');

  useEffect(()=>{
    (async ()=>{
      const { data } = await api.get('/business-units');
      setBusinessUnits(data);
      if (!defaultBusinessUnitId && data.length) {
        setBusinessUnitId(data[0].id);
      }
    })();
  }, [defaultBusinessUnitId]);

  async function submit(e){
    e.preventDefault();
    if(!title || !pipelineId || !stageId) return;
    await api.post('/deals', {
      title,
      value: Number(value)||0,
      pipeline_id: pipelineId,
      stage_id: stageId,
      business_unit_id: businessUnitId || null,
      organization: orgName ? { name: orgName } : undefined,
      contact: contactName ? { name: contactName, email: contactEmail } : undefined,
    });
    onCreated?.();
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-2xl p-4 w-full max-w-md space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Nuevo Deal</h3>
          <button type="button" onClick={onClose} className="text-sm">✕</button>
        </div>

        <div className="space-y-2">
          <label className="block text-sm">Título
            <input className="w-full border rounded-lg px-3 py-2" value={title} onChange={e=>setTitle(e.target.value)} />
          </label>

          <label className="block text-sm">Negocio
            <select className="w-full border rounded-lg px-3 py-2" value={businessUnitId} onChange={e=>setBusinessUnitId(Number(e.target.value))}>
              {businessUnits.map(b => (
                <option key={b.id} value={b.id}>
                  {b.parent_id ? '— ' : ''}{b.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">Valor
            <input className="w-full border rounded-lg px-3 py-2" value={value} onChange={e=>setValue(e.target.value)} type="number" min="0" />
          </label>

          <label className="block text-sm">Etapa
            <select className="w-full border rounded-lg px-3 py-2" value={stageId||''} onChange={e=>setStageId(Number(e.target.value))}>
              {stages.map(s=> <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm col-span-2">Empresa
              <input className="w-full border rounded-lg px-3 py-2" value={orgName} onChange={e=>setOrgName(e.target.value)} placeholder="Opcional" />
            </label>
            <label className="block text-sm">Contacto
              <input className="w-full border rounded-lg px-3 py-2" value={contactName} onChange={e=>setContactName(e.target.value)} placeholder="Opcional" />
            </label>
            <label className="block text-sm">Email del contacto
              <input className="w-full border rounded-lg px-3 py-2" value={contactEmail} onChange={e=>setContactEmail(e.target.value)} placeholder="Opcional" />
            </label>
          </div>
        </div>

        <div className="pt-2 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 border rounded-lg">Cancelar</button>
          <button className="px-3 py-2 rounded-lg bg-black text-white">Crear</button>
        </div>
      </form>
    </div>
  );
}
