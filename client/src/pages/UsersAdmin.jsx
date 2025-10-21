// client/src/pages/UsersAdmin.jsx
import React, { useEffect, useState } from 'react';
import { api } from '../api';

const ROLES = ['admin','venta','ops','viewer'];

export default function UsersAdmin(){
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [openNew, setOpenNew] = useState(false);

  // form nuevo usuario
  const [nName, setNName] = useState('');
  const [nEmail, setNEmail] = useState('');
  const [nRole, setNRole] = useState('viewer');
  const [nPass, setNPass] = useState('');

  async function fetchAll(){
    setLoading(true); setErr('');
    try{
      const { data } = await api.get('/users');
      setRows(Array.isArray(data) ? data : []);
    }catch(e){
      setErr('No se pudo cargar la lista de usuarios');
    }finally{
      setLoading(false);
    }
  }

  useEffect(()=>{ fetchAll(); },[]);

  async function createUser(e){
    e.preventDefault();
    setErr('');
    try{
      // 1) crear usuario (name, email, role)
      const { data } = await api.post('/users', {
        name: nName.trim(), email: nEmail.trim(), role: nRole, is_active: 1
      });
      const id = data?.id;

      // 2) setear password si se envió
      if (id && nPass.trim()) {
        await api.post(`/users/${id}/set-password`, { new_password: nPass.trim() });
      }

      setOpenNew(false);
      setNName(''); setNEmail(''); setNRole('viewer'); setNPass('');
      await fetchAll();
    }catch(e){
      setErr(e?.response?.data?.error || 'No se pudo crear el usuario');
    }
  }

  async function toggleActive(u){
    try{
      await api.patch(`/users/${u.id}`, { is_active: u.is_active ? 0 : 1 });
      await fetchAll();
    }catch(e){
      alert('No se pudo cambiar el estado');
    }
  }

  async function changeRole(u, role){
    try{
      await api.patch(`/users/${u.id}`, { role });
      await fetchAll();
    }catch(e){
      alert('No se pudo cambiar el rol');
    }
  }

  async function resetPassword(u){
    const np = prompt(`Nuevo password para ${u.name}:`);
    if (!np) return;
    try{
      await api.post(`/users/${u.id}/set-password`, { new_password: np });
      alert('Password actualizado');
    }catch(e){
      alert('No se pudo actualizar el password');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Administración de usuarios</h2>
        <button
          className="px-3 py-2 rounded-lg bg-black text-white text-sm"
          onClick={()=>setOpenNew(true)}
        >
          ➕ Nuevo usuario
        </button>
      </div>

      {err && <div className="mb-3 text-sm text-red-600">{err}</div>}

      <div className="bg-white rounded-2xl shadow overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-2 text-left w-12">ID</th>
              <th className="p-2 text-left">Nombre</th>
              <th className="p-2 text-left">Email</th>
              <th className="p-2 text-left">Rol</th>
              <th className="p-2 text-left">Activo</th>
              <th className="p-2 text-left w-[220px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(u=>(
              <tr key={u.id} className="border-b last:border-0">
                <td className="p-2">{u.id}</td>
                <td className="p-2">{u.name}</td>
                <td className="p-2">{u.email}</td>
                <td className="p-2">
                  <select
                    className="border rounded px-2 py-1"
                    value={u.role}
                    onChange={(e)=>changeRole(u, e.target.value)}
                  >
                    {ROLES.map(r=> <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="p-2">
                  <button
                    className={`px-2 py-1 rounded text-xs ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}
                    onClick={()=>toggleActive(u)}
                  >
                    {u.is_active ? 'Activo' : 'Inactivo'}
                  </button>
                </td>
                <td className="p-2">
                  <button
                    className="px-2 py-1 border rounded mr-2 hover:bg-gray-50"
                    onClick={()=>resetPassword(u)}
                  >
                    Reset password
                  </button>
                  {/* Si querés agregar eliminar:
                  <button className="px-2 py-1 border rounded text-red-600 hover:bg-red-50">Eliminar</button>
                  */}
                </td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-500">Sin usuarios</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {openNew && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4">
          <form onSubmit={createUser} className="bg-white rounded-2xl p-4 w-full max-w-md space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Nuevo usuario</h3>
              <button type="button" onClick={()=>setOpenNew(false)} className="text-sm">✕</button>
            </div>

            <label className="block text-sm">Nombre
              <input className="w-full border rounded-lg px-3 py-2" value={nName} onChange={e=>setNName(e.target.value)} required />
            </label>

            <label className="block text-sm">Email
              <input className="w-full border rounded-lg px-3 py-2" type="email" value={nEmail} onChange={e=>setNEmail(e.target.value)} required />
            </label>

            <label className="block text-sm">Rol
              <select className="w-full border rounded-lg px-3 py-2" value={nRole} onChange={e=>setNRole(e.target.value)}>
                {ROLES.map(r=> <option key={r} value={r}>{r}</option>)}
              </select>
            </label>

            <label className="block text-sm">Password inicial (opcional)
              <input className="w-full border rounded-lg px-3 py-2" type="password" value={nPass} onChange={e=>setNPass(e.target.value)} />
            </label>

            <div className="pt-2 flex gap-2 justify-end">
              <button type="button" onClick={()=>setOpenNew(false)} className="px-3 py-2 border rounded-lg">Cancelar</button>
              <button className="px-3 py-2 rounded-lg bg-black text-white">Crear</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
