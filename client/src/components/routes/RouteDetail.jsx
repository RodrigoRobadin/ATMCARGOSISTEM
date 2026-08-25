import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import RouteForm from './RouteForm';
import RouteMap from './RouteMap';

const labels = { borrador: 'Borrador', planificado: 'Planificado', en_curso: 'En curso', completado: 'Completado', cancelado: 'Cancelado' };
const colors = { borrador: 'bg-gray-100 text-gray-700', planificado: 'bg-blue-100 text-blue-800', en_curso: 'bg-amber-100 text-amber-800', completado: 'bg-emerald-100 text-emerald-800', cancelado: 'bg-red-100 text-red-700' };

function dateOnly(value) {
  return String(value || '').slice(0, 10);
}

export default function RouteDetail({ routeId, onClose, onUpdate }) {
  const { user } = useAuth();
  const [route, setRoute] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [candidateKey, setCandidateKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  async function loadRoute() {
    setLoading(true);
    try {
      const { data } = await api.get('/routes/' + routeId);
      setRoute(data);
      if (data.status === 'borrador' && data.cities?.length) {
        const candidateResponse = await api.get('/routes/candidates', { params: { city_ids: data.cities.map((city) => city.id).join(',') } });
        setCandidates(candidateResponse.data || []);
      } else {
        setCandidates([]);
      }
    } catch (error) {
      alert(error.response?.data?.error || 'No se pudo cargar el recorrido.');
      onClose?.();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadRoute(); }, [routeId]);

  const canEdit = route && (String(user?.role || '').toLowerCase() === 'admin' || Number(user?.id) === Number(route.user_id));
  const availableCandidates = useMemo(() => candidates.filter((candidate) => !(route?.stops || []).some((stop) =>
    Number(stop.organization_id) === Number(candidate.organization_id) &&
    Number(stop.org_branch_id || 0) === Number(candidate.org_branch_id || 0)
  )), [candidates, route?.stops]);

  const mapsUrl = useMemo(() => {
    const points = (route?.stops || []).map((stop) => {
      const lat = Number(stop.latitude_snapshot);
      const lng = Number(stop.longitude_snapshot);
      return Number.isFinite(lat) && Number.isFinite(lng) ? lat + ',' + lng : null;
    }).filter(Boolean);
    if (!points.length) return '';
    const destination = points[points.length - 1];
    const waypoints = points.slice(0, -1).join('|');
    return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(destination) + (waypoints ? '&waypoints=' + encodeURIComponent(waypoints) : '');
  }, [route?.stops]);

  async function addStop() {
    const candidate = availableCandidates.find((row) => row.location_key === candidateKey);
    if (!candidate) return;
    setBusy(true);
    try {
      await api.post('/routes/' + route.id + '/stops', {
        organization_id: candidate.organization_id,
        org_branch_id: candidate.org_branch_id,
        city_id: candidate.city_id,
      });
      setCandidateKey('');
      await loadRoute();
      onUpdate?.();
    } catch (error) {
      alert(error.response?.data?.error || 'No se pudo agregar la parada.');
    } finally {
      setBusy(false);
    }
  }

  async function removeStop(stopId) {
    if (!confirm('Quitar esta parada del borrador?')) return;
    try {
      await api.delete('/routes/' + route.id + '/stops/' + stopId);
      await loadRoute();
      onUpdate?.();
    } catch (error) {
      alert(error.response?.data?.error || 'No se pudo quitar la parada.');
    }
  }

  async function moveStop(stop, direction) {
    const newOrder = Number(stop.stop_order) + direction;
    if (newOrder < 1 || newOrder > route.stops.length) return;
    try {
      await api.patch('/routes/' + route.id + '/stops/' + stop.id + '/order', { new_order: newOrder });
      await loadRoute();
    } catch (error) {
      alert(error.response?.data?.error || 'No se pudo reordenar.');
    }
  }

  async function confirmRoute() {
    if (!confirm('Esto creara una visita programada por cada parada. Continuar?')) return;
    setBusy(true);
    try {
      await api.post('/routes/' + route.id + '/confirm');
      await loadRoute();
      onUpdate?.();
    } catch (error) {
      alert(error.response?.data?.error || 'No se pudo confirmar el recorrido.');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status) {
    setBusy(true);
    try {
      await api.patch('/routes/' + route.id + '/status', { status });
      await loadRoute();
      onUpdate?.();
    } catch (error) {
      alert(error.response?.data?.error || 'No se pudo cambiar el estado.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteRoute() {
    if (!confirm('Eliminar este borrador?')) return;
    try {
      await api.delete('/routes/' + route.id);
      onUpdate?.();
      onClose?.();
    } catch (error) {
      alert(error.response?.data?.error || 'No se pudo eliminar.');
    }
  }

  if (loading) return <div className="rounded bg-white p-16 text-center text-gray-500">Cargando recorrido...</div>;
  if (!route) return null;
  if (showEdit) return <div className="overflow-hidden rounded bg-white"><RouteForm editRoute={route} onCancel={() => setShowEdit(false)}
    onSuccess={() => { setShowEdit(false); loadRoute(); onUpdate?.(); }} /></div>;

  return (
    <div className="overflow-hidden rounded bg-white shadow-xl">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-5">
        <div><div className="mb-1 flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold">{route.name}</h2>
          <span className={"rounded px-2 py-1 text-xs font-medium " + (colors[route.status] || colors.borrador)}>{labels[route.status] || route.status}</span></div>
          <div className="text-sm text-gray-600">{(route.cities || []).map((city) => city.name).join(', ') || route.legacy_zone_name || 'Recorrido historico'}</div>
          <div className="mt-1 text-sm text-gray-500">{dateOnly(route.start_date)} a {dateOnly(route.end_date)} · {route.workday_start?.slice(0, 5)} a {route.workday_end?.slice(0, 5)} · {route.user_name || 'Sin ejecutivo'}</div>
        </div>
        <button type="button" className="h-9 w-9 rounded border text-xl" onClick={onClose} title="Cerrar">x</button>
      </div>

      {canEdit && <div className="flex flex-wrap gap-2 border-b bg-gray-50 p-3">
        <button type="button" className="rounded border bg-white px-3 py-2 text-sm" onClick={() => setShowEdit(true)}>Editar datos</button>
        {route.status === 'borrador' && <button type="button" className="rounded bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" onClick={confirmRoute} disabled={busy}>Confirmar y crear visitas</button>}
        {route.status === 'planificado' && <button type="button" className="rounded bg-amber-600 px-3 py-2 text-sm font-medium text-white" onClick={() => setStatus('en_curso')}>Iniciar</button>}
        {route.status === 'en_curso' && <button type="button" className="rounded bg-emerald-700 px-3 py-2 text-sm font-medium text-white" onClick={() => setStatus('completado')}>Completar recorrido</button>}
        {!['completado', 'cancelado'].includes(route.status) && <button type="button" className="rounded border border-red-300 bg-white px-3 py-2 text-sm text-red-700" onClick={() => setStatus('cancelado')}>Cancelar</button>}
        {route.status === 'borrador' && <button type="button" className="ml-auto rounded border border-red-300 bg-white px-3 py-2 text-sm text-red-700" onClick={deleteRoute}>Eliminar borrador</button>}
        {mapsUrl && <a className="rounded border bg-white px-3 py-2 text-sm font-medium text-emerald-800" href={mapsUrl} target="_blank" rel="noreferrer">Abrir en Google Maps</a>}
      </div>}

      <div className="space-y-5 p-5">
        {route.notes && <div className="border-l-4 border-gray-300 pl-3 text-sm text-gray-700">{route.notes}</div>}

        {route.status === 'borrador' && canEdit && <div className="flex flex-wrap gap-2 rounded border bg-gray-50 p-3">
          <select className="min-w-[280px] flex-1 rounded border bg-white px-3 py-2 text-sm" value={candidateKey} onChange={(e) => setCandidateKey(e.target.value)}>
            <option value="">Agregar empresa o sucursal...</option>
            {availableCandidates.map((row) => <option key={row.location_key} value={row.location_key}>{row.organization_name} - {row.location_name} ({row.city_name})</option>)}
          </select>
          <button type="button" className="rounded border bg-white px-4 py-2 text-sm font-medium disabled:opacity-50" onClick={addStop} disabled={!candidateKey || busy}>+ Agregar</button>
        </div>}

        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-100"><tr><th className="p-2">Orden</th><th className="p-2">Empresa / ubicacion</th><th className="p-2">Contacto</th><th className="p-2">Agenda</th><th className="p-2">Estado</th><th className="p-2"></th></tr></thead>
            <tbody>{(route.stops || []).map((stop, index) => <tr key={stop.id} className="border-t">
              <td className="whitespace-nowrap p-2">{route.status === 'borrador' && canEdit ? <><button type="button" className="h-7 w-7 rounded border" disabled={!index} onClick={() => moveStop(stop, -1)}>↑</button><button type="button" className="ml-1 h-7 w-7 rounded border" disabled={index === route.stops.length - 1} onClick={() => moveStop(stop, 1)}>↓</button></> : stop.stop_order}</td>
              <td className="p-2"><strong>{stop.organization_name}</strong><div className="text-xs text-gray-500">{stop.branch_name || stop.location_name || 'Casa matriz'} · {stop.city_name || 'Sin ciudad'}</div><div className="max-w-[340px] truncate text-xs text-gray-500">{stop.address_snapshot || '-'}</div></td>
              <td className="p-2">{stop.contact_name || 'Sin definir'}{stop.contact_phone && <div className="text-xs text-gray-500">{stop.contact_phone}</div>}</td>
              <td className="whitespace-nowrap p-2">{dateOnly(stop.planned_date)} {String(stop.planned_time || '').slice(0, 5)}<div className="text-xs text-gray-500">{stop.duration_minutes || 60} min</div></td>
              <td className="p-2">{stop.visit_status ? labels[stop.visit_status] || stop.visit_status : stop.status || 'Pendiente'}</td>
              <td className="p-2 text-right">{route.status === 'borrador' && canEdit && <button type="button" className="rounded border px-2 py-1 text-red-700" onClick={() => removeStop(stop.id)}>Quitar</button>}</td>
            </tr>)}</tbody>
          </table>
          {!route.stops?.length && <div className="p-8 text-center text-gray-500">Este recorrido todavia no tiene paradas.</div>}
        </div>

        <div><h3 className="mb-2 font-semibold">Mapa del recorrido</h3><RouteMap stops={route.stops || []} /></div>
      </div>
    </div>
  );
}
