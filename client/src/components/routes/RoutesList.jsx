import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import RouteCoverage from './RouteCoverage';
import RouteDetail from './RouteDetail';
import RouteForm from './RouteForm';
import RouteLocationsAdmin from './RouteLocationsAdmin';

const statusLabels = {
  borrador: 'Borrador',
  planificado: 'Planificado',
  en_curso: 'En curso',
  completado: 'Completado',
  cancelado: 'Cancelado',
};

const statusStyles = {
  borrador: 'bg-gray-100 text-gray-700',
  planificado: 'bg-blue-100 text-blue-800',
  en_curso: 'bg-amber-100 text-amber-800',
  completado: 'bg-emerald-100 text-emerald-800',
  cancelado: 'bg-red-100 text-red-700',
};

function formatDate(value) {
  if (!value) return '-';
  return new Date(String(value).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-PY');
}

export default function RoutesList({ userId = '' }) {
  const { user } = useAuth();
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const [view, setView] = useState('routes');
  const [routes, setRoutes] = useState([]);
  const [cities, setCities] = useState([]);
  const [filters, setFilters] = useState({ city_id: '', status: '' });
  const [loading, setLoading] = useState(true);
  const [showPlanner, setShowPlanner] = useState(false);
  const [plannerSeed, setPlannerSeed] = useState(null);
  const [selectedRouteId, setSelectedRouteId] = useState(null);

  async function loadData() {
    setLoading(true);
    try {
      const params = {};
      if (filters.city_id) params.city_id = filters.city_id;
      if (filters.status) params.status = filters.status;
      if (userId) params.user_id = userId;
      const [routesResponse, citiesResponse] = await Promise.all([
        api.get('/routes', { params }),
        api.get('/cities'),
      ]);
      setRoutes(routesResponse.data || []);
      setCities(citiesResponse.data || []);
    } catch (error) {
      alert(error.response?.data?.error || 'No se pudieron cargar los recorridos.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [filters.city_id, filters.status, userId]);

  function planLocation(location) {
    setPlannerSeed(location);
    setShowPlanner(true);
  }

  const tabs = [
    ['routes', 'Recorridos'],
    ['coverage', 'Mapa de cobertura'],
    ...(isAdmin ? [['locations', 'Ubicaciones']] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
          <div><h2 className="text-xl font-semibold">Recorridos comerciales</h2>
            <p className="text-sm text-gray-600">Planifica visitas por ciudad y controla la cobertura del equipo.</p></div>
          <button type="button" className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white"
            onClick={() => { setPlannerSeed(null); setShowPlanner(true); }}>+ Nuevo recorrido</button>
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map(([key, label]) => <button key={key} type="button"
            className={"whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium " + (view === key ? 'border-emerald-700 text-emerald-800' : 'border-transparent text-gray-600')}
            onClick={() => setView(key)}>{label}</button>)}
        </div>
      </div>

      {view === 'routes' && <>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[220px] text-sm"><span className="mb-1 block text-gray-600">Ciudad</span>
            <select className="w-full rounded border px-3 py-2" value={filters.city_id} onChange={(e) => setFilters((v) => ({ ...v, city_id: e.target.value }))}>
              <option value="">Todas las ciudades</option>{cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
            </select>
          </label>
          <label className="min-w-[180px] text-sm"><span className="mb-1 block text-gray-600">Estado</span>
            <select className="w-full rounded border px-3 py-2" value={filters.status} onChange={(e) => setFilters((v) => ({ ...v, status: e.target.value }))}>
              <option value="">Todos</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <span className="pb-2 text-sm text-gray-500">{routes.length} recorridos</span>
        </div>

        {loading ? <div className="py-16 text-center text-gray-500">Cargando recorridos...</div> : !routes.length ?
          <div className="rounded border border-dashed py-16 text-center"><div className="font-medium">No hay recorridos con estos filtros</div><div className="mt-1 text-sm text-gray-500">Crea un borrador para empezar a ordenar las visitas.</div></div> :
          <div className="overflow-x-auto rounded border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-100"><tr><th className="p-3">Recorrido</th><th className="p-3">Ciudades</th><th className="p-3">Ejecutivo</th><th className="p-3">Fechas</th><th className="p-3">Paradas</th><th className="p-3">Estado</th><th className="p-3"></th></tr></thead>
              <tbody>{routes.map((route) => <tr key={route.id} className="border-t hover:bg-gray-50">
                <td className="p-3"><strong>{route.name}</strong>{route.notes && <div className="max-w-[300px] truncate text-xs text-gray-500">{route.notes}</div>}</td>
                <td className="p-3">{route.city_names || route.legacy_zone_name || 'Dato historico sin ciudad'}</td>
                <td className="p-3">{route.user_name || 'Sin asignar'}</td>
                <td className="whitespace-nowrap p-3">{formatDate(route.start_date)} - {formatDate(route.end_date)}</td>
                <td className="p-3">{route.completed_stops || 0} / {route.stops_count || 0}</td>
                <td className="p-3"><span className={"rounded px-2 py-1 text-xs font-medium " + (statusStyles[route.status] || statusStyles.borrador)}>{statusLabels[route.status] || route.status}</span></td>
                <td className="p-3 text-right"><button type="button" className="rounded border px-3 py-1.5 font-medium hover:bg-white" onClick={() => setSelectedRouteId(route.id)}>Ver</button></td>
              </tr>)}</tbody>
            </table>
          </div>}
      </>}

      {view === 'coverage' && <RouteCoverage userId={userId} onPlanLocation={planLocation} />}
      {view === 'locations' && isAdmin && <RouteLocationsAdmin />}

      {showPlanner && <div className="fixed inset-0 z-[1000] bg-black/45 p-2 sm:p-5">
        <div className="mx-auto max-w-7xl overflow-hidden rounded bg-white shadow-xl">
          <RouteForm initialLocation={plannerSeed} onCancel={() => { setShowPlanner(false); setPlannerSeed(null); }}
            onSuccess={(created) => { setShowPlanner(false); setPlannerSeed(null); loadData(); if (created?.id) setSelectedRouteId(created.id); }} />
        </div>
      </div>}

      {selectedRouteId && <div className="fixed inset-0 z-[1000] overflow-y-auto bg-black/45 p-2 sm:p-5">
        <div className="mx-auto max-w-6xl"><RouteDetail routeId={selectedRouteId} onClose={() => setSelectedRouteId(null)} onUpdate={loadData} /></div>
      </div>}
    </div>
  );
}
