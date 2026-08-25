import React, { useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import { api } from '../../api';
import 'leaflet/dist/leaflet.css';

const today = new Date().toISOString().slice(0, 10);
const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

export default function RouteCoverage({ userId = '', onPlanLocation }) {
  const [cities, setCities] = useState([]);
  const [data, setData] = useState({ summary: {}, cities: [], locations: [] });
  const [filters, setFilters] = useState({ from: ninetyDaysAgo, to: today, city_id: '', never: false });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/cities').then(({ data: rows }) => setCities(rows || [])).catch(() => setCities([]));
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = { from: filters.from, to: filters.to };
    if (filters.city_id) params.city_ids = filters.city_id;
    if (userId) params.user_id = userId;
    api.get('/routes/coverage', { params })
      .then(({ data: result }) => active && setData(result || { summary: {}, cities: [], locations: [] }))
      .catch((error) => alert(error.response?.data?.error || 'No se pudo cargar la cobertura.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [filters.from, filters.to, filters.city_id, userId]);

  const locations = useMemo(
    () => (data.locations || []).filter((row) => !filters.never || row.is_never_visited),
    [data.locations, filters.never]
  );
  const located = locations.filter((row) => Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude)));
  const unassigned = locations.filter((row) => !Number(row.city_id));
  const center = data.cities?.length
    ? [Number(data.cities[0].latitude || -25.3), Number(data.cities[0].longitude || -57.57)]
    : [-25.3, -57.57];
  const summaryItems = [
    ['Ubicaciones', data.summary?.locations || 0],
    ['Visitadas', data.summary?.visited || 0],
    ['Nunca visitadas', data.summary?.never_visited || 0],
    ['Atrasadas', data.summary?.stale || 0],
    ['Planificadas', data.summary?.planned || 0],
    ['Completadas', data.summary?.completed || 0],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 border-b pb-4">
        <label className="text-sm"><span className="mb-1 block text-gray-600">Desde</span>
          <input type="date" className="rounded border px-3 py-2" value={filters.from} onChange={(e) => setFilters((v) => ({ ...v, from: e.target.value }))} />
        </label>
        <label className="text-sm"><span className="mb-1 block text-gray-600">Hasta</span>
          <input type="date" className="rounded border px-3 py-2" value={filters.to} onChange={(e) => setFilters((v) => ({ ...v, to: e.target.value }))} />
        </label>
        <label className="min-w-[220px] text-sm"><span className="mb-1 block text-gray-600">Ciudad</span>
          <select className="w-full rounded border px-3 py-2" value={filters.city_id} onChange={(e) => setFilters((v) => ({ ...v, city_id: e.target.value }))}>
            <option value="">Todas las ciudades</option>
            {cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
          <input type="checkbox" checked={filters.never} onChange={(e) => setFilters((v) => ({ ...v, never: e.target.checked }))} />
          Solo nunca visitadas
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {summaryItems.map(([label, value]) => <div key={label} className="rounded border bg-white p-3">
          <div className="text-xs text-gray-500">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div>
        </div>)}
      </div>

      {loading ? <div className="py-16 text-center text-gray-500">Cargando cobertura...</div> : <div className="overflow-hidden rounded border bg-white">
        <MapContainer center={center} zoom={7} style={{ height: 520, width: '100%' }} scrollWheelZoom>
          <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {(data.cities || []).filter((city) => Number.isFinite(Number(city.latitude)) && Number.isFinite(Number(city.longitude))).map((city) => {
            const urgency = Number(city.never_visited || 0) + Number(city.stale || 0);
            const color = urgency ? '#dc2626' : Number(city.completed || 0) ? '#047857' : '#64748b';
            return <CircleMarker key={city.city_id} center={[Number(city.latitude), Number(city.longitude)]}
              radius={Math.min(28, 8 + Math.sqrt(Number(city.locations || 0)) * 4)} pathOptions={{ color, fillColor: color, fillOpacity: 0.38, weight: 2 }}>
              <Popup><div className="min-w-[190px]"><strong>{city.city_name}</strong><div>{city.locations} ubicaciones</div>
                <div>{city.never_visited} nunca visitadas</div><div>{city.stale} atrasadas</div>
                <button type="button" className="mt-2 text-emerald-700 underline" onClick={() => setFilters((v) => ({ ...v, city_id: String(city.city_id) }))}>Ver esta ciudad</button>
              </div></Popup>
            </CircleMarker>;
          })}
          {located.map((location) => <Marker key={location.location_key} position={[Number(location.latitude), Number(location.longitude)]}>
            <Popup><div className="min-w-[220px]"><strong>{location.organization_name}</strong><div>{location.branch_name || 'Casa matriz'}</div>
              <div className="text-gray-600">{location.address || location.city_name || 'Sin direccion'}</div>
              <div className="mt-2">Ultima visita: {location.last_visit_at ? new Date(location.last_visit_at).toLocaleDateString('es-PY') : 'Nunca'}</div>
              <div>Operaciones abiertas: {location.open_deals || 0}</div>
              <button type="button" className="mt-2 rounded bg-emerald-700 px-3 py-1.5 text-white" onClick={() => onPlanLocation?.(location)}>Agregar a recorrido</button>
            </div></Popup>
          </Marker>)}
        </MapContainer>
        {!located.length && <div className="border-t p-3 text-sm text-amber-700">No hay ubicaciones con coordenadas en este filtro. Las burbujas de ciudad siguen mostrando la cobertura disponible.</div>}
      </div>}

      {!filters.city_id && unassigned.length > 0 && <div className="rounded border bg-white">
        <div className="border-b p-3"><strong>Sin ubicacion normalizada</strong><span className="ml-2 text-sm text-gray-500">{unassigned.length} casas matrices o sucursales</span></div>
        <div className="max-h-72 overflow-auto"><table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 bg-gray-100"><tr><th className="p-2">Empresa</th><th className="p-2">Ubicacion</th><th className="p-2">Ciudad</th><th className="p-2">Direccion</th></tr></thead>
          <tbody>{unassigned.map((row) => <tr key={row.location_key} className="border-t"><td className="p-2 font-medium">{row.organization_name}</td><td className="p-2">{row.location_name}</td><td className="p-2">{row.city_name || 'Sin ciudad'}</td><td className="p-2">{row.address || '-'}</td></tr>)}</tbody>
        </table></div>
      </div>}
    </div>
  );
}

