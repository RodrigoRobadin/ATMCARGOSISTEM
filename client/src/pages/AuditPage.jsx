import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { AuditEventList } from '../components/AuditHistory.jsx';

const INITIAL = { entity: '', action: '', user_id: '', from: '', to: '', q: '' };

export default function AuditPage() {
  const [filters, setFilters] = useState(INITIAL);
  const [applied, setApplied] = useState(INITIAL);
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load(cursor = null, selected = applied) {
    setLoading(true); setError('');
    try {
      const params = Object.fromEntries(Object.entries(selected).filter(([, value]) => value));
      const { data } = await api.get('/audit/history', { params: { ...params, limit: 50, ...(cursor ? { before_id: cursor } : {}) } });
      setRows((current) => cursor ? [...current, ...(data.rows || [])] : (data.rows || []));
      setNextCursor(data.nextCursor || null);
    } catch {
      setError('No se pudo cargar la auditoría.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(null, INITIAL);
    api.get('/users/select')
      .then(({ data }) => setUsers(Array.isArray(data) ? data : []))
      .catch(() => setUsers([]));
  }, []);

  function apply(event) {
    event.preventDefault();
    setApplied({ ...filters });
    load(null, filters);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <h1 className="text-xl font-semibold">Auditoría</h1>
      <form onSubmit={apply} className="grid gap-2 border-y border-slate-200 py-3 sm:grid-cols-2 lg:grid-cols-[170px_160px_1fr_110px_140px_140px_auto] dark:border-slate-700">
        <select aria-label="Tipo de registro" className="min-w-0 rounded border px-2 py-1.5 text-sm dark:bg-slate-900" value={filters.entity} onChange={(e) => setFilters({ ...filters, entity: e.target.value })}>
          <option value="">Todos los registros</option><option value="deal">Operaciones</option><option value="service_case">Servicios</option><option value="organization">Organizaciones</option><option value="contact">Contactos</option>
        </select>
        <select aria-label="Acción" className="min-w-0 rounded border px-2 py-1.5 text-sm dark:bg-slate-900" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })}>
          <option value="">Todas las acciones</option><option value="create">Creación</option><option value="update">Edición</option><option value="delete">Eliminación</option><option value="restore">Restauración</option><option value="merge">Fusión</option><option value="convert">Conversión</option>
        </select>
        <input aria-label="Referencia, nombre o ID" placeholder="Referencia, nombre o ID" className="min-w-0 rounded border px-2 py-1.5 text-sm dark:bg-slate-900" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <select aria-label="Responsable" className="min-w-0 rounded border px-2 py-1.5 text-sm dark:bg-slate-900" value={filters.user_id} onChange={(e) => setFilters({ ...filters, user_id: e.target.value })}>
          <option value="">Todos</option>
          {users.map((user) => <option key={user.id} value={user.id}>{user.name || user.email || `#${user.id}`}</option>)}
        </select>
        <input aria-label="Desde" type="date" className="min-w-0 rounded border px-2 py-1.5 text-sm dark:bg-slate-900" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        <input aria-label="Hasta" type="date" className="min-w-0 rounded border px-2 py-1.5 text-sm dark:bg-slate-900" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        <button className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white dark:bg-slate-200 dark:text-slate-900">Filtrar</button>
      </form>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <AuditEventList rows={rows} />
      {nextCursor ? <button type="button" disabled={loading} onClick={() => load(nextCursor)} className="rounded border px-3 py-1.5 text-sm disabled:opacity-50">{loading ? 'Cargando…' : 'Ver más'}</button> : null}
    </div>
  );
}
