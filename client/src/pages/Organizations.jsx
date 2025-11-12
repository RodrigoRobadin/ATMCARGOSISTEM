// client/src/pages/Organizations.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import useParamOptions from '../hooks/useParamOptions';

function normalizeUrl(u) {
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : `http://${u}`;
}

/* =============== Selector interno de ejecutivos (usuarios) =============== */
function ExecSelect({ value, onChange, disabled = false, label = "Ejecutivo de cuenta (opcional)" }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        // ✅ Ruta abierta para cualquier autenticado
        const { data } = await api.get('/users/select', { params: { active: 1 } });
        const list = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
        const mapped = list
          .map((u) => {
            const id = u.id ?? u.user_id ?? null;
            const name =
              u.name ??
              (([u.first_name, u.last_name].filter(Boolean).join(' ')) ||
                u.username ||
                u.email ||
                null);
            if (!id || !name) return null;
            return { id, name: String(name), email: u.email || '' };
          })
          .filter(Boolean);
        if (live) setUsers(mapped);
      } catch (e) {
        if (live) setErr('No se pudo cargar usuarios.');
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, []);

  return (
    <label className="block text-sm">
      {label}
      <select
        className="w-full border rounded-lg px-3 py-2 mt-1"
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value ? Number(e.target.value) : null)}
        disabled={disabled || loading}
      >
        <option value="">— Sin asignar —</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} {u.email ? `· ${u.email}` : ''}
          </option>
        ))}
      </select>
      {!!err && <div className="text-xs text-red-600 mt-1">{err}</div>}
    </label>
  );
}

export default function Organizations(){
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);

  // Se mantienen para futuro
  const [owners, setOwners] = useState([]);
  const [labelOptions, setLabelOptions] = useState([]);

  const totalProfit = useMemo(
    () => rows.reduce((a, r) => a + (r.budget_status === 'confirmado' ? Number(r.budget_profit_value||0) : 0), 0),
    [rows]
  );

  async function fetch(){
    try {
      const { data } = await api.get('/organizations');
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
    }
  }

  useEffect(()=>{ 
    fetch();
    (async () => {
      try {
        // ✅ Cambiamos /users -> /users/select (no admin)
        const [{ data: usersLite }, { data: labels }] = await Promise.all([
          api.get('/users/select', { params: { active: 1 } }),
          api.get('/labels', { params: { scope: 'organization' } })
        ]);

        const mappedOwners = (Array.isArray(usersLite) ? usersLite : []).map(u => ({
          id: u.id,
          name: u.name || u.email || `Usuario ${u.id}`,
          email: u.email || ''
        }));

        setOwners(mappedOwners);
        setLabelOptions(Array.isArray(labels) ? labels : []);
      } catch {
        setOwners([]);
        setLabelOptions([]);
      }
    })();
  },[]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Organizaciones</h2>
        <div className="text-sm">
          <span className="text-slate-500 mr-1">Acumulado Valor Profit:</span>
          <span className="font-bold">
            ${Number(totalProfit).toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2})}
          </span>
        </div>
      </div>

      <div className="mb-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="px-3 py-2 rounded-lg bg-black text-white text-sm"
        >
          ➕ Nueva organización
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-2 text-left w-12">ID</th>
              <th className="p-2 text-left">Razón Social</th>
              <th className="p-2 text-left">RUC</th>
              <th className="p-2 text-left">Dirección</th>
              <th className="p-2 text-left">Email</th>
              <th className="p-2 text-left">Ciudad</th>
              <th className="p-2 text-left">País</th>
              <th className="p-2 text-left">Teléfono</th>
              <th className="p-2 text-left">Rubro</th>
              <th className="p-2 text-left">Tipo org</th>
              <th className="p-2 text-left">Operación</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r=>{
              return (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="p-2">{r.id}</td>
                  <td className="p-2">
                    <Link to={`/organizations/${r.id}`} className="text-blue-600 hover:underline">
                      {r.razon_social || r.name}
                    </Link>
                  </td>
                  <td className="p-2">{r.ruc || '—'}</td>
                  <td className="p-2">{r.address || '—'}</td>
                  <td className="p-2">{r.email || '—'}</td>
                  <td className="p-2">{r.city || '—'}</td>
                  <td className="p-2">{r.country || '—'}</td>
                  <td className="p-2">{r.phone || '—'}</td>
                  <td className="p-2">{r.rubro || '—'}</td>
                  <td className="p-2">{r.tipo_org || '—'}</td>
                  <td className="p-2">{r.operacion || '—'}</td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={11} className="p-6 text-center text-slate-500">Sin organizaciones</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <NewOrganizationModal
          onClose={() => setOpen(false)}
          onCreated={fetch}
          owners={owners}
          labelOptions={labelOptions}
        />
      )}
    </div>
  );
}

/* =====================  MODAL  ===================== */

function NewOrganizationModal({ onClose, onCreated /* owners, labelOptions */ }) {
  const [razonSocial, setRazonSocial] = useState('');
  const [ruc, setRuc] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [phone, setPhone] = useState('');
  const [rubro, setRubro] = useState('Seguro'); // fallback
  const [tipoOrg, setTipoOrg] = useState('');
  const [operacion, setOperacion] = useState('');
  const [notes, setNotes] = useState('');

  // 👇 Nuevo: hoja de ruta para flete
  const [hojaRuta, setHojaRuta] = useState('');

  // Ejecutivo de cuenta (opcional)
  const [accountExecutiveId, setAccountExecutiveId] = useState(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Parametría para "Tipo org", "Rubro" y "Operación"
  const { options: paramOpts } = useParamOptions(
    ['org_tipo','org_rubro','org_operacion','tipo_operacion'],
    { onlyActive: true, asValues: true }
  );
  const tipoOrgOptions = paramOpts?.org_tipo || [];
  const rubroOptions = paramOpts?.org_rubro || ['Seguro'];
  const operacionOptions = paramOpts?.org_operacion || paramOpts?.tipo_operacion || [];

  const isFreightOrg =
    (tipoOrg || '').toLowerCase().includes('flete') ||
    (rubro || '').toLowerCase().includes('flete');

  async function submit(e){
    e.preventDefault();
    setError('');
    if (!razonSocial.trim()) { setError('La Razón Social es obligatoria.'); return; }
    setSaving(true);
    try {
      const execId = accountExecutiveId ? Number(accountExecutiveId) : null;
      await api.post('/organizations', {
        razon_social: razonSocial.trim(),
        name: razonSocial.trim(),
        ruc: ruc || null,
        address: address || null,
        email: email || null,
        city: city || null,
        country: country || null,
        phone: phone || null,
        rubro: rubro || null,
        tipo_org: tipoOrg || null,
        operacion: operacion || null,
        notes: notes || null,
        hoja_ruta: hojaRuta || null,

        // Asignación comercial tolerante
        account_executive_id: execId,
        owner_id: execId,
        assigned_user_id: execId,
      });
      await onCreated?.();
      onClose?.();
    } catch (e) {
      setError(
        e?.response?.data
          ? (typeof e.response.data === 'string' ? e.response.data : 'No se pudo crear la organización.')
          : 'No se pudo crear la organización.'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-2xl p-4 w-full max-w-2xl space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Nueva organización</h3>
          <button type="button" onClick={onClose} className="text-sm">✕</button>
        </div>

        {error && <div className="text-sm text-red-600 break-words">{error}</div>}

        {/* Fila 1: Razón Social - RUC */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block text-sm">Razón Social *
            <input className="w-full border rounded-lg px-3 py-2" value={razonSocial} onChange={e=>setRazonSocial(e.target.value)} />
          </label>
          <label className="block text-sm">RUC
            <input className="w-full border rounded-lg px-3 py-2" value={ruc} onChange={e=>setRuc(e.target.value)} />
          </label>
        </div>

        {/* Fila 2: Dirección - Email */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block text-sm">Dirección
            <input className="w-full border rounded-lg px-3 py-2" value={address} onChange={e=>setAddress(e.target.value)} />
          </label>
          <label className="block text-sm">Email
            <input type="email" className="w-full border rounded-lg px-3 py-2" value={email} onChange={e=>setEmail(e.target.value)} />
          </label>
        </div>

        {/* Fila 3: Ciudad - País - Teléfono */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="block text-sm">Ciudad
            <input className="w-full border rounded-lg px-3 py-2" value={city} onChange={e=>setCity(e.target.value)} />
          </label>
          <label className="block text-sm">País
            <input className="w-full border rounded-lg px-3 py-2" value={country} onChange={e=>setCountry(e.target.value)} />
          </label>
          <label className="block text-sm">Teléfono
            <input className="w-full border rounded-lg px-3 py-2" value={phone} onChange={e=>setPhone(e.target.value)} />
          </label>
        </div>

        {/* Fila 4: Rubro - Tipo org */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block text-sm">Rubro
            <select className="w-full border rounded-lg px-3 py-2" value={rubro} onChange={e=>setRubro(e.target.value)}>
              {rubroOptions.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label className="block text-sm">Tipo org
            <select className="w-full border rounded-lg px-3 py-2" value={tipoOrg} onChange={e=>setTipoOrg(e.target.value)}>
              <option value="">(Seleccione)</option>
              {tipoOrgOptions.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        </div>

        {/* Operación */}
        <label className="block text-sm">Tipo de Operación
          <select className="w-full border rounded-lg px-3 py-2" value={operacion} onChange={e=>setOperacion(e.target.value)}>
            <option value="">(Seleccione)</option>
            {operacionOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>

        {/* Ejecutivo de cuenta */}
        <ExecSelect
          value={accountExecutiveId}
          onChange={setAccountExecutiveId}
          label="Ejecutivo de cuenta (opcional)"
        />

        {/* 👇 NUEVO: Hoja de ruta solo si es Flete */}
        {isFreightOrg && (
          <label className="block text-sm">
            Hoja de ruta (cobertura de flete)
            <textarea
              className="w-full border rounded-lg px-3 py-2"
              rows={3}
              placeholder="Ej: Aéreo: AR–BR–CL / Marítimo: China–Latam vía Panamá..."
              value={hojaRuta}
              onChange={e=>setHojaRuta(e.target.value)}
            />
          </label>
        )}

        {/* Notas */}
        <label className="block text-sm">Notas
          <textarea className="w-full border rounded-lg px-3 py-2" rows={3} value={notes} onChange={e=>setNotes(e.target.value)} />
        </label>

        <div className="pt-2 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 border rounded-lg">Cancelar</button>
          <button className="px-3 py-2 rounded-lg bg-black text-white disabled:opacity-60" disabled={saving}>
            {saving ? 'Creando…' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  );
}