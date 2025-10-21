// client/src/pages/Admin.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth.jsx';

function Row({ label, children }) {
  return (
    <label className="grid grid-cols-[140px_1fr] gap-2 items-center">
      <span className="text-xs text-slate-600">{label}</span>
      <div>{children}</div>
    </label>
  );
}

export default function Admin() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState({ byUser: [], byAction: [], byEntity: [] });

  // filtros
  const [limit, setLimit] = useState(50);
  const [fUserId, setFUserId] = useState('');
  const [fAction, setFAction] = useState('');
  const [fEntity, setFEntity] = useState('');
  const [fSince, setFSince] = useState('');

  const isAdmin = (user?.role || '').toLowerCase() === 'admin';

  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (limit) params.limit = limit;
      if (fUserId) params.user_id = fUserId;
      if (fAction) params.action = fAction;
      if (fEntity) params.entity = fEntity;
      if (fSince) params.since = fSince;

      const [{ data: rows }, { data: st }] = await Promise.all([
        api.get('/audit', { params }),
        api.get('/audit/stats')
      ]);
      setLogs(Array.isArray(rows) ? rows : []);
      setStats(st || { byUser: [], byAction: [], byEntity: [] });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  if (!isAdmin) {
    return (
      <div className="p-4">
        <h2 className="text-lg font-semibold">Admin</h2>
        <p className="text-sm text-slate-600">No tenés permisos para ver esta página (requiere rol admin).</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500">Panel</div>
            <div className="text-2xl font-bold">Administración</div>
          </div>
          <button
            className="px-3 py-2 text-sm rounded-lg border hover:bg-slate-50"
            onClick={load}
          >
            Recargar
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-2xl shadow p-4">
        <h3 className="font-medium mb-3">Auditoría — filtros</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          <Row label="Límite">
            <input
              className="border rounded-lg px-2 py-1 text-sm w-28"
              type="number" min="1" max="500"
              value={limit}
              onChange={e => setLimit(Number(e.target.value || 50))}
            />
          </Row>
          <Row label="Usuario (ID)">
            <input
              className="border rounded-lg px-2 py-1 text-sm"
              value={fUserId}
              onChange={e => setFUserId(e.target.value)}
              placeholder="ej: 1"
            />
          </Row>
          <Row label="Acción">
            <input
              className="border rounded-lg px-2 py-1 text-sm"
              value={fAction}
              onChange={e => setFAction(e.target.value)}
              placeholder="create / update / delete / assign ..."
            />
          </Row>
          <Row label="Entidad">
            <input
              className="border rounded-lg px-2 py-1 text-sm"
              value={fEntity}
              onChange={e => setFEntity(e.target.value)}
              placeholder="deal / contact / organization / param_value ..."
            />
          </Row>
          <Row label="Desde (fecha)">
            <input
              className="border rounded-lg px-2 py-1 text-sm"
              type="date"
              value={fSince}
              onChange={e => setFSince(e.target.value)}
            />
          </Row>

          <div className="flex gap-2">
            <button className="px-3 py-2 text-sm rounded-lg bg-black text-white" onClick={load}>
              Aplicar filtros
            </button>
            {(fUserId || fAction || fEntity || fSince) && (
              <button
                className="px-3 py-2 text-sm rounded-lg border"
                onClick={() => { setFUserId(''); setFAction(''); setFEntity(''); setFSince(''); }}
              >
                Limpiar
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow p-4">
          <h4 className="font-medium mb-2">Top usuarios</h4>
          <ul className="text-sm space-y-1">
            {(stats.byUser || []).map(r => (
              <li key={String(r.user_id)+'-'+r.user_name} className="flex justify-between">
                <span>{r.user_name} <span className="text-slate-400">(id {r.user_id ?? '—'})</span></span>
                <b>{r.cnt}</b>
              </li>
            ))}
            {!(stats.byUser || []).length && <li className="text-slate-500">Sin datos</li>}
          </ul>
        </div>
        <div className="bg-white rounded-2xl shadow p-4">
          <h4 className="font-medium mb-2">Acciones</h4>
          <ul className="text-sm space-y-1">
            {(stats.byAction || []).map(r => (
              <li key={r.action} className="flex justify-between">
                <span>{r.action}</span>
                <b>{r.cnt}</b>
              </li>
            ))}
            {!(stats.byAction || []).length && <li className="text-slate-500">Sin datos</li>}
          </ul>
        </div>
        <div className="bg-white rounded-2xl shadow p-4">
          <h4 className="font-medium mb-2">Entidades</h4>
          <ul className="text-sm space-y-1">
            {(stats.byEntity || []).map(r => (
              <li key={r.entity} className="flex justify-between">
                <span>{r.entity}</span>
                <b>{r.cnt}</b>
              </li>
            ))}
            {!(stats.byEntity || []).length && <li className="text-slate-500">Sin datos</li>}
          </ul>
        </div>
      </div>

      {/* Tabla de logs */}
      <div className="bg-white rounded-2xl shadow p-4">
        <h3 className="font-medium mb-3">Eventos recientes</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-2 py-2 border-b">Fecha</th>
                <th className="px-2 py-2 border-b">Usuario</th>
                <th className="px-2 py-2 border-b">Acción</th>
                <th className="px-2 py-2 border-b">Entidad</th>
                <th className="px-2 py-2 border-b">ID entidad</th>
                <th className="px-2 py-2 border-b">Mensaje</th>
                <th className="px-2 py-2 border-b">Payload</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(l => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="px-2 py-2 border-b">{l.created_at ? new Date(l.created_at).toLocaleString() : '—'}</td>
                  <td className="px-2 py-2 border-b">{l.user_name || `(id ${l.user_id ?? '—'})`}</td>
                  <td className="px-2 py-2 border-b">{l.action}</td>
                  <td className="px-2 py-2 border-b">{l.entity}</td>
                  <td className="px-2 py-2 border-b">{l.entity_id ?? '—'}</td>
                  <td className="px-2 py-2 border-b">{l.message || '—'}</td>
                  <td className="px-2 py-2 border-b">
                    {l.payload
                      ? <details><summary className="cursor-pointer underline">ver</summary><pre className="text-xs whitespace-pre-wrap">{l.payload}</pre></details>
                      : '—'}
                  </td>
                </tr>
              ))}
              {!logs.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                    No hay eventos aún.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
