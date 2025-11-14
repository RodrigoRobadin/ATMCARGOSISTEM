// client/src/pages/AdminActivity.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';

// =============== Utilidades ===============
const fmt = (n) =>
  Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const fmt2 = (n) =>
  Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const toISO = (d) => new Date(d).toISOString();
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const it of arr) {
    const k = keyFn(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return m;
}
const safeNum = (x) => (Number.isFinite(+x) ? +x : 0);

// =============== Gráficos (SVG puros) ===============
function PieChart({ value = 0, total = 1, size = 180, stroke = 22, labels = [] }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(total, value));
  const p = total ? v / total : 0;
  const dash = `${c * p} ${c * (1 - p)}`;
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#E5E7EB"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#3B2CCB"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={dash}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="space-y-2 text-sm">
        {labels?.length
          ? labels.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <span
                  className="inline-block w-3 h-3 rounded-full"
                  style={{ background: i === 0 ? '#3B2CCB' : '#C026D3' }}
                />
                <span className="text-slate-700">{l}</span>
              </div>
            ))
          : null}
      </div>
    </div>
  );
}

function Bars({ items = [], max = 1, w = 520, h = 220 }) {
  const padX = 24,
    padY = 24;
  const bw = (w - padX * 2) / (items.length || 1);
  const scaleY = (v) =>
    h - padY - (max ? (v / max) * (h - padY * 2) : 0);
  return (
    <svg width={w} height={h}>
      {/* eje */}
      <line
        x1={padX}
        y1={h - padY}
        x2={w - padX / 2}
        y2={h - padY}
        stroke="#CBD5E1"
      />
      {items.map((it, i) => {
        const x = padX + i * bw + 6;
        const y = scaleY(it.value);
        const barH = h - padY - y;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={bw - 12}
              height={barH}
              rx="6"
              fill="#3B82F6"
            />
            <text
              x={x + (bw - 12) / 2}
              y={h - 6}
              textAnchor="middle"
              fontSize="11"
              fill="#475569"
            >
              {it.label.length > 10
                ? it.label.slice(0, 10) + '…'
                : it.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// =============== Tarjetas ===============
function Card({ title, children, className = '' }) {
  return (
    <div className={`bg-white rounded-2xl shadow p-4 ${className}`}>
      {title && (
        <div className="text-slate-700 font-semibold mb-2">{title}</div>
      )}
      {children}
    </div>
  );
}
function Delta({ value = 0 }) {
  const up = value >= 0;
  return (
    <div
      className={`text-sm font-semibold ${
        up ? 'text-emerald-600' : 'text-rose-600'
      } flex items-center gap-1`}
    >
      <span className="inline-block">{up ? '↑' : '↓'}</span>
      {fmt2(Math.abs(value))}%
    </div>
  );
}
const initials = (name = '?') =>
  name
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

// =============== Página ===============
export default function AdminActivity() {
  const { authReady, user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [activities, setActivities] = useState([]);
  const [deals, setDeals] = useState([]);
  const [error, setError] = useState('');

  const [days, setDays] = useState(30); // ventana de análisis

  useEffect(() => {
    // ⛔ No hacer llamadas si aún no se resolvió el auth
    if (!authReady) return;
    // ⛔ No hacer llamadas si NO es admin
    if (!user || user.role !== 'admin') return;

    (async () => {
      setLoading(true);
      setError('');
      try {
        // 1) Intentamos un endpoint agregado de overview (si existe)
        let overview = null;
        try {
          const { data } = await api.get('/admin/activity/overview', {
            params: { days },
          });
          overview = data;
        } catch {
          /* caemos a construir en el cliente */
        }

        if (overview?.users && overview?.activities && overview?.deals) {
          setUsers(overview.users);
          setActivities(overview.activities);
          setDeals(overview.deals);
        } else {
          // 2) Fallback: traemos colecciones crudas y calculamos
          const [{ data: u }, { data: a }, { data: d }] = await Promise.all([
            api.get('/users'),
            api.get('/activities'),
            api.get('/deals'),
          ]);
          setUsers(Array.isArray(u) ? u : []);
          setActivities(Array.isArray(a) ? a : []);
          setDeals(Array.isArray(d) ? d : []);
        }
      } catch (e) {
        console.error(e);
        setError('No se pudieron cargar los datos');
      } finally {
        setLoading(false);
      }
    })();
  }, [authReady, user?.id, user?.role, days]);

  const now = new Date();
  const from = daysAgo(days);
  const prevFrom = daysAgo(days * 2);

  const actsNow = useMemo(
    () =>
      activities.filter(
        (a) => new Date(a.created_at || a.date || 0) >= from
      ),
    [activities, days]
  );
  const actsPrev = useMemo(
    () =>
      activities.filter((a) => {
        const d = new Date(a.created_at || a.date || 0);
        return d >= prevFrom && d < from;
      }),
    [activities, days]
  );

  // Usuarios activos: con al menos 1 actividad en el período
  const activeUserIds = useMemo(
    () => Array.from(new Set(actsNow.map((a) => a.user_id).filter(Boolean))),
    [actsNow]
  );
  const totalActive = activeUserIds.length;

  const usersById = useMemo(() => {
    const m = new Map();
    for (const u of users) m.set(u.id, u);
    return m;
  }, [users]);

  // Ranking por acciones
  const actionsByUser = useMemo(() => {
    const g = groupBy(actsNow, (a) => a.user_id || 'desconocido');
    const rows = [];
    for (const [uid, list] of g.entries()) {
      const done = list.filter(
        (a) => a.is_done || a.done || a.status === 'done'
      ).length;
      // Operaciones: preferimos deals por advisor_user_id; si no, únicos por deal_id en actividades
      const ownDeals = deals.filter((d) => d.advisor_user_id === uid);
      const ops =
        ownDeals.length ||
        new Set(list.map((a) => a.deal_id).filter(Boolean)).size;
      const u = usersById.get(uid) || { name: 'Desconocido', id: uid };
      rows.push({
        id: uid,
        name: u.name || u.email || '#' + uid,
        actions: list.length,
        done,
        ops,
      });
    }
    rows.sort((a, b) => b.actions - a.actions);
    return rows;
  }, [actsNow, deals, usersById]);

  const mostActive = actionsByUser[0] || null;

  // Tendencia (acciones período vs período previo)
  const trendPct = useMemo(() => {
    const nowCount = actsNow.length;
    const prevCount = actsPrev.length;
    if (!prevCount) return nowCount ? 100 : 0;
    return ((nowCount - prevCount) / prevCount) * 100;
  }, [actsNow, actsPrev]);

  // Pastel: activos vs inactivos (sobre total de usuarios)
  const totalUsers = users.length;
  const inactive = Math.max(0, totalUsers - totalActive);

  // Nuevas operaciones por organización (últimos N días)
  const newDeals = useMemo(
    () => deals.filter((d) => new Date(d.created_at || 0) >= from),
    [deals, days]
  );
  const byOrg = useMemo(() => {
    const g = groupBy(newDeals, (d) => d.org_name || '—');
    const arr = Array.from(g.entries()).map(([label, list]) => ({
      label,
      value: list.length,
    }));
    arr.sort((a, b) => b.value - a.value);
    return arr.slice(0, 6);
  }, [newDeals]);

  // Tabla ordenable
  const [sort, setSort] = useState({ key: 'actions', dir: 'desc' });
  const tableRows = useMemo(() => {
    const r = [...actionsByUser];
    r.sort((a, b) => {
      const s = sort.dir === 'asc' ? 1 : -1;
      if (sort.key === 'name') return s * a.name.localeCompare(b.name);
      return s * (a[sort.key] - b[sort.key]);
    });
    return r;
  }, [actionsByUser, sort]);
  const toggleSort = (key) => {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'desc' }
    );
  };

  // ============ GUARDIAS DE ACCESO ============
  if (!authReady) {
    return (
      <div className="p-4 text-sm text-slate-600">Cargando sesión…</div>
    );
  }

  if (!user || user.role !== 'admin') {
    return (
      <div className="p-4 text-sm text-slate-600">
        No tienes permisos para ver esta sección.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 text-sm text-slate-600">Cargando datos…</div>
    );
  }
  if (error) {
    return <div className="p-4 text-sm text-rose-600">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Estadísticas y análisis</h1>
        <label className="text-sm flex items-center gap-2">
          <span className="text-slate-600">Ventana:</span>
          <select
            className="border rounded-lg px-2 py-1"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>Últimos 7 días</option>
            <option value={14}>Últimos 14 días</option>
            <option value={30}>Últimos 30 días</option>
            <option value={60}>Últimos 60 días</option>
            <option value={90}>Últimos 90 días</option>
          </select>
        </label>
      </div>

      {/* Primera fila: total activos + pastel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Usuarios activos totales">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-6xl font-semibold leading-none">
                {fmt(totalActive)}
              </div>
              <div className="mt-2">
                <Delta value={trendPct} />
              </div>
            </div>
            <div className="text-xs text-slate-500">
              <div>
                Del {toISO(from).slice(0, 10)} al{' '}
                {toISO(now).slice(0, 10)}
              </div>
            </div>
          </div>
        </Card>

        <Card title="Usuarios activos vs. inactivos">
          <div className="flex items-center justify-between">
            <PieChart
              value={totalActive}
              total={totalUsers || 1}
              labels={[
                `Usuarios activos: ${fmt(totalActive)}`,
                `Usuarios inactivos: ${fmt(inactive)}`,
              ]}
            />
            <div className="text-right">
              <div className="text-slate-500 text-sm">Total usuarios</div>
              <div className="text-3xl font-semibold">
                {fmt(totalUsers)}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Segunda fila: responsable + barras */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Responsable más activo">
          {mostActive ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-indigo-600 text-white grid place-items-center font-semibold">
                  {initials(mostActive.name)}
                </div>
                <div>
                  <div className="text-2xl font-semibold">
                    {mostActive.name}
                  </div>
                  <div className="text-slate-500 text-sm">
                    Acciones: {fmt(mostActive.actions)} · Finalizadas:{' '}
                    {fmt(mostActive.done)}
                  </div>
                </div>
              </div>
              <Delta value={trendPct} />
            </div>
          ) : (
            <div className="text-slate-500 text-sm">
              Sin actividades en el período.
            </div>
          )}
        </Card>

        <Card title="Nuevas operaciones por organización">
          <Bars
            items={byOrg}
            max={Math.max(1, ...byOrg.map((x) => x.value))}
          />
        </Card>
      </div>

      {/* Tabla */}
      <Card title="Vista (tabla editable)">
        <div className="overflow-auto">
          <table className="min-w-[680px] w-full text-sm">
            <thead>
              <tr className="border-b">
                <Th
                  onClick={() => toggleSort('name')}
                  active={sort.key === 'name'}
                  dir={sort.dir}
                >
                  Usuario
                </Th>
                <Th
                  onClick={() => toggleSort('actions')}
                  active={sort.key === 'actions'}
                  dir={sort.dir}
                  right
                >
                  Acciones
                </Th>
                <Th
                  onClick={() => toggleSort('done')}
                  active={sort.key === 'done'}
                  dir={sort.dir}
                  right
                >
                  Acciones finalizadas
                </Th>
                <Th
                  onClick={() => toggleSort('ops')}
                  active={sort.key === 'ops'}
                  dir={sort.dir}
                  right
                >
                  Operaciones
                </Th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b hover:bg-slate-50"
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-full bg-indigo-600 text-white grid place-items-center text-xs">
                        {initials(r.name)}
                      </span>
                      <span>{r.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {fmt(r.actions)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {fmt(r.done)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {fmt(r.ops)}
                  </td>
                </tr>
              ))}
              {!tableRows.length && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-6 text-center text-slate-500"
                  >
                    Sin datos
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Th({ children, onClick, active = false, dir = 'desc', right = false }) {
  return (
    <th
      className={`px-3 py-2 text-left ${
        right ? 'text-right' : ''
      } uppercase text-[12px] text-slate-600 cursor-pointer`}
      onClick={onClick}
      title="Ordenar"
    >
      <span
        className={`inline-flex items-center gap-1 ${
          active ? 'text-slate-900' : ''
        }`}
      >
        {children}
        {active && (
          <span className="text-slate-400">
            {dir === 'asc' ? '▲' : '▼'}
          </span>
        )}
      </span>
    </th>
  );
}