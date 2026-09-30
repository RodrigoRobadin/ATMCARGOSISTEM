import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const ENTITY_LABELS = {
  deal: 'Operación', service_case: 'Servicio', organization: 'Organización', contact: 'Contacto',
  branch: 'Sucursal', deal_custom_field: 'Campo de operación',
  contact_custom_field: 'Campo de contacto', deal_file: 'Archivo',
  mobile_attachment: 'Archivo',
  service_case_custom_field: 'Campo de servicio',
  service_file: 'Archivo de servicio',
};

const ROOT_PATHS = {
  deal: '/operations', service_case: '/service/cases', organization: '/organizations', contact: '/contacts',
};

function parseMeta(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

const USER_FIELDS = new Set([
  'assigned_to', 'lead_technician_id', 'technician_id',
  'created_by', 'updated_by', 'deleted_by', 'validated_by', 'reviewed_by', 'approved_by',
]);
const FIELD_LABELS = {
  advisor_user_id: 'Ejecutivo de cuenta',
  owner_user_id: 'Responsable',
  assigned_to: 'Técnico asignado',
};

function displayValue(value, field, userNames = {}) {
  if (value == null || value === '') return '—';
  if (field.endsWith('_user_id') || USER_FIELDS.has(field)) {
    const name = userNames[value];
    if (name) return name;
    if (Number.isInteger(Number(value)) && Number(value) > 0) return `Usuario #${value}`;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function AuditEventList({ rows }) {
  if (!rows.length) return <p className="py-6 text-sm text-slate-500">Sin cambios registrados.</p>;
  return (
    <div className="divide-y divide-slate-200 dark:divide-slate-700">
      {rows.map((row) => {
        const meta = parseMeta(row.meta);
        const changes = Object.entries(meta.changes || {});
        const root = row.root_entity || row.entity;
        const rootId = row.root_entity_id || row.entity_id;
        return (
          <article key={row.id} className="py-4 first:pt-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium">{row.actor_name || row.user_name || 'Sistema'}</span>
              <span className="text-slate-500">{row.action}</span>
              <span>{ENTITY_LABELS[row.entity] || row.entity}</span>
              {ROOT_PATHS[root] && rootId ? (
                <Link className="text-blue-700 hover:underline dark:text-blue-300" to={`${ROOT_PATHS[root]}/${rootId}`}>
                  {row.record_name || `#${rootId}`}
                </Link>
              ) : null}
              <time className="ml-auto whitespace-nowrap text-xs text-slate-500">
                {new Date(row.created_at).toLocaleString('es-PY')}
              </time>
            </div>
            {row.description ? <p className="mt-1 text-xs text-slate-500">{row.description}</p> : null}
            {changes.length ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[540px] text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800">
                    <tr><th className="px-2 py-1.5">Campo</th><th className="px-2 py-1.5">Antes</th><th className="px-2 py-1.5">Después</th></tr>
                  </thead>
                  <tbody>{changes.map(([field, change]) => (
                    <tr key={field} className="border-t border-slate-100 align-top dark:border-slate-800">
                      <th className="px-2 py-1.5 font-medium">{FIELD_LABELS[field] || field.replaceAll('_', ' ')}</th>
                      <td className="max-w-[320px] break-words px-2 py-1.5 text-slate-600 dark:text-slate-300">{displayValue(change.before, field, row.user_names)}</td>
                      <td className="max-w-[320px] break-words px-2 py-1.5">{displayValue(change.after, field, row.user_names)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="mt-2 text-xs text-slate-500">Este evento anterior no conserva valores antes y después.</p>}
          </article>
        );
      })}
    </div>
  );
}

export default function AuditHistory({ entity, id }) {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || !id) return;
    let active = true;
    setLoading(true);
    api.get(`/audit/record/${entity}/${id}`).then(({ data }) => {
      if (active) { setRows(Array.isArray(data) ? data : []); setError(''); }
    }).catch(() => { if (active) setError('No se pudo cargar el historial.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [entity, id, open]);
  return (
    <section className="border-t border-slate-200 py-4 dark:border-slate-700">
      <button type="button" className="text-sm font-semibold text-blue-700 hover:underline dark:text-blue-300" onClick={() => setOpen(!open)}>
        {open ? 'Ocultar historial de cambios' : 'Ver historial de cambios'}
      </button>
      {open ? (
        <div className="mt-3">
          {loading ? <p className="text-sm text-slate-500">Cargando…</p> : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {!loading && !error ? <AuditEventList rows={rows} /> : null}
        </div>
      ) : null}
    </section>
  );
}
