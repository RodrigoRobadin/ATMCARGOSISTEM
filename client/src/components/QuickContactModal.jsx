import React, { useEffect, useState } from 'react';
import { api } from '../api';

export default function QuickContactModal({ initialOrganization, ownerUserId, onClose, onCreated }) {
  const [organization, setOrganization] = useState(initialOrganization || null);
  const [query, setQuery] = useState(initialOrganization?.name || '');
  const [results, setResults] = useState([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (organization || query.trim().length < 2) { setResults([]); return; }
    let active = true;
    const timer = setTimeout(() => {
      api.get('/organizations', { params: { q: query.trim(), limit: 8 } })
        .then(({ data }) => { if (active) setResults(Array.isArray(data) ? data : data?.items || []); })
        .catch(() => { if (active) setResults([]); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query, organization]);

  async function submit(event) {
    event.preventDefault();
    if (!organization?.id) { setError('Seleccioná una organización existente.'); return; }
    setSaving(true); setError('');
    try {
      const { data } = await api.post('/contacts', {
        name: name.trim(), email: email.trim() || null, phone: phone.trim() || null,
        title: title.trim() || null, org_id: organization.id,
        owner_user_id: organization.owner_user_id || ownerUserId || null,
        visibility: 'company',
      });
      if (data?.deduped) { setError('Ya existe un contacto con ese correo. No se creó otro registro.'); return; }
      onCreated?.({ ...data, org_name: organization.name });
      onClose?.();
    } catch (requestError) {
      setError(requestError?.response?.data?.error || 'No se pudo crear el contacto.');
    } finally { setSaving(false); }
  }

  return <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/35 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label="Nuevo contacto">
    <form onSubmit={submit} className="w-full max-w-xl bg-white shadow-xl">
      <div className="flex items-center justify-between border-b px-5 py-4"><h2 className="text-base font-semibold">Nuevo contacto</h2><button type="button" onClick={onClose} className="text-sm text-slate-600 hover:text-slate-900">Cerrar</button></div>
      <div className="space-y-4 p-5">
        <div className="relative">
          <label htmlFor="quick-contact-organization" className="block text-sm font-medium">Organización *</label>
          <input id="quick-contact-organization" value={query} onChange={(event) => { setQuery(event.target.value); setOrganization(null); }} className="mt-1 w-full border px-3 py-2 text-sm" placeholder="Buscar por nombre o RUC" autoComplete="off" />
          {results.length > 0 && <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto border bg-white shadow-lg">{results.map((item) => <button key={item.id} type="button" onClick={() => { setOrganization(item); setQuery(item.name || item.razon_social || ''); setResults([]); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">{item.name || item.razon_social}{item.ruc ? ` · ${item.ruc}` : ''}</button>)}</div>}
          {organization && <p className="mt-1 text-xs text-emerald-700">Seleccionada: {organization.name || organization.razon_social}</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">Nombre *<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full border px-3 py-2 font-normal" required /></label>
          <label className="block text-sm font-medium">Cargo<input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full border px-3 py-2 font-normal" /></label>
          <label className="block text-sm font-medium">Correo<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full border px-3 py-2 font-normal" /></label>
          <label className="block text-sm font-medium">Teléfono<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-1 w-full border px-3 py-2 font-normal" /></label>
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t px-5 py-4"><button type="button" onClick={onClose} className="border px-3 py-2 text-sm">Cancelar</button><button type="submit" disabled={saving} className="bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Guardando...' : 'Crear contacto'}</button></div>
    </form>
  </div>;
}
