import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';

function isoDate(value) {
  return String(value || '').slice(0, 10);
}

export default function RouteForm({ onSuccess, onCancel, editRoute = null, initialLocation = null }) {
  const { user } = useAuth();
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const today = new Date().toISOString().slice(0, 10);
  const [cities, setCities] = useState([]);
  const [users, setUsers] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [selectedStops, setSelectedStops] = useState([]);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [citySearch, setCitySearch] = useState('');
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [form, setForm] = useState({
    name: '',
    city_ids: [],
    user_id: '',
    start_date: today,
    end_date: today,
    workday_start: '08:00',
    workday_end: '17:00',
    default_visit_minutes: 60,
    travel_buffer_minutes: 20,
    notes: '',
  });

  useEffect(() => {
    Promise.all([
      api.get('/cities'),
      isAdmin ? api.get('/users/select', { params: { active: 1 } }).catch(() => api.get('/users')) : Promise.resolve({ data: [] }),
    ]).then(([cityResponse, userResponse]) => {
      setCities(cityResponse.data || []);
      setUsers(userResponse.data || []);
    }).catch((error) => alert(error.response?.data?.error || 'No se pudieron cargar los datos del planificador.'));
  }, [isAdmin]);

  useEffect(() => {
    if (!editRoute) return;
    setForm({
      name: editRoute.name || '',
      city_ids: (editRoute.cities || []).map((city) => Number(city.id)),
      user_id: editRoute.user_id || '',
      start_date: isoDate(editRoute.start_date),
      end_date: isoDate(editRoute.end_date),
      workday_start: String(editRoute.workday_start || '08:00').slice(0, 5),
      workday_end: String(editRoute.workday_end || '17:00').slice(0, 5),
      default_visit_minutes: Number(editRoute.default_visit_minutes || 60),
      travel_buffer_minutes: Number(editRoute.travel_buffer_minutes || 20),
      notes: editRoute.notes || '',
    });
  }, [editRoute]);

  useEffect(() => {
    if (!initialLocation?.city_id || editRoute) return;
    setForm((current) => ({
      ...current,
      city_ids: current.city_ids.includes(Number(initialLocation.city_id))
        ? current.city_ids
        : [...current.city_ids, Number(initialLocation.city_id)],
    }));
  }, [initialLocation, editRoute]);

  useEffect(() => {
    if (editRoute || !form.city_ids.length) {
      setCandidates([]);
      return;
    }
    let active = true;
    setLoadingCandidates(true);
    api.get('/routes/candidates', { params: { city_ids: form.city_ids.join(',') } })
      .then(({ data }) => {
        if (!active) return;
        const rows = data || [];
        setCandidates(rows);
        if (initialLocation) {
          const match = rows.find((row) => row.location_key === initialLocation.location_key);
          if (match) setSelectedStops((current) => current.some((row) => row.location_key === match.location_key) ? current : [...current, match]);
        }
      })
      .catch((error) => alert(error.response?.data?.error || 'No se pudieron buscar empresas.'))
      .finally(() => active && setLoadingCandidates(false));
    return () => { active = false; };
  }, [form.city_ids.join(','), editRoute, initialLocation]);

  const visibleCities = useMemo(() => {
    const text = citySearch.trim().toLowerCase();
    return cities.filter((city) => !text || (city.name + ' ' + (city.department || '')).toLowerCase().includes(text));
  }, [cities, citySearch]);

  const visibleCandidates = useMemo(() => {
    const text = candidateSearch.trim().toLowerCase();
    return candidates.filter((row) => !text || [
      row.organization_name, row.location_name, row.address, row.city_name,
      ...(row.contacts || []).map((contact) => contact.name),
    ].filter(Boolean).join(' ').toLowerCase().includes(text));
  }, [candidates, candidateSearch]);

  function toggleCity(cityId) {
    setForm((current) => ({
      ...current,
      city_ids: current.city_ids.includes(cityId)
        ? current.city_ids.filter((id) => id !== cityId)
        : [...current.city_ids, cityId],
    }));
    setSelectedStops([]);
    setPreviewReady(false);
  }

  function toggleCandidate(candidate) {
    setSelectedStops((current) => current.some((row) => row.location_key === candidate.location_key)
      ? current.filter((row) => row.location_key !== candidate.location_key)
      : [...current, candidate]);
    setPreviewReady(false);
  }

  function updateStop(key, changes) {
    setSelectedStops((current) => current.map((row) => row.location_key === key ? { ...row, ...changes } : row));
    setPreviewReady(false);
  }

  function moveStop(index, direction) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= selectedStops.length) return;
    setSelectedStops((current) => {
      const rows = [...current];
      [rows[index], rows[nextIndex]] = [rows[nextIndex], rows[index]];
      return rows;
    });
  }

  async function buildPreview() {
    if (!form.city_ids.length || !selectedStops.length || !form.start_date || !form.end_date) {
      alert('Selecciona ciudades, fechas y al menos una empresa.');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/routes/plan-preview', {
        ...form,
        auto_order: true,
        stops: selectedStops,
      });
      setSelectedStops(data.stops || []);
      setPreviewReady(true);
      if (data.warnings?.length) alert(data.warnings.join('\n'));
    } catch (error) {
      alert(error.response?.data?.error || 'No se pudo generar la agenda.');
    } finally {
      setBusy(false);
    }
  }

  async function saveRoute(event) {
    event.preventDefault();
    if (!form.name.trim() || !form.city_ids.length || !form.start_date || !form.end_date) {
      alert('Completa el nombre, las ciudades y el rango de fechas.');
      return;
    }
    if (!editRoute && (!selectedStops.length || !previewReady)) {
      alert('Selecciona empresas y genera la agenda antes de guardar.');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        user_id: form.user_id || undefined,
        auto_order: false,
        stops: selectedStops,
      };
      const response = editRoute
        ? await api.put('/routes/' + editRoute.id, payload)
        : await api.post('/routes', payload);
      onSuccess?.(response.data);
    } catch (error) {
      alert(error.response?.data?.error || 'No se pudo guardar el recorrido.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={saveRoute} className="max-h-[92vh] overflow-y-auto bg-white">
      <div className="sticky top-0 z-20 flex items-center justify-between border-b bg-white px-5 py-4">
        <div><h2 className="text-xl font-semibold">{editRoute ? 'Editar recorrido' : 'Planificar recorrido'}</h2>
          <p className="text-sm text-gray-500">Ciudades, empresas y agenda en un solo flujo.</p></div>
        <button type="button" className="h-9 w-9 rounded border text-xl" onClick={onCancel} title="Cerrar">x</button>
      </div>

      <div className="space-y-6 p-5">
        <section className="grid gap-4 lg:grid-cols-12">
          <label className="lg:col-span-5"><span className="mb-1 block text-sm font-medium">Nombre *</span>
            <input className="w-full rounded border px-3 py-2" value={form.name} onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))} placeholder="Ej. Recorrido Central - semana 1" />
          </label>
          {isAdmin && <label className="lg:col-span-3"><span className="mb-1 block text-sm font-medium">Ejecutivo</span>
            <select className="w-full rounded border px-3 py-2" value={form.user_id} onChange={(e) => setForm((v) => ({ ...v, user_id: e.target.value }))}>
              <option value="">Mi usuario</option>{users.map((row) => <option key={row.id} value={row.id}>{row.name || row.email}</option>)}
            </select>
          </label>}
          <label className="lg:col-span-2"><span className="mb-1 block text-sm font-medium">Desde *</span>
            <input type="date" className="w-full rounded border px-3 py-2" value={form.start_date} onChange={(e) => { setForm((v) => ({ ...v, start_date: e.target.value, end_date: v.end_date < e.target.value ? e.target.value : v.end_date })); setPreviewReady(false); }} />
          </label>
          <label className="lg:col-span-2"><span className="mb-1 block text-sm font-medium">Hasta *</span>
            <input type="date" min={form.start_date} className="w-full rounded border px-3 py-2" value={form.end_date} onChange={(e) => { setForm((v) => ({ ...v, end_date: e.target.value })); setPreviewReady(false); }} />
          </label>
        </section>

        <section className="grid gap-4 border-y py-5 lg:grid-cols-[300px_1fr]">
          <div>
            <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">1. Ciudades *</h3><span className="text-xs text-gray-500">{form.city_ids.length} elegidas</span></div>
            <input className="mb-2 w-full rounded border px-3 py-2 text-sm" value={citySearch} onChange={(e) => setCitySearch(e.target.value)} placeholder="Buscar ciudad" />
            <div className="max-h-64 overflow-auto rounded border">
              {visibleCities.map((city) => <label key={city.id} className="flex cursor-pointer items-start gap-2 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-gray-50">
                <input type="checkbox" className="mt-1" checked={form.city_ids.includes(Number(city.id))} onChange={() => toggleCity(Number(city.id))} />
                <span><strong>{city.name}</strong><span className="block text-xs text-gray-500">{city.department || 'Sin departamento'} · {city.locations_count || 0} ubicaciones</span></span>
              </label>)}
            </div>
          </div>

          {!editRoute && <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">2. Empresas sugeridas</h3>
              <input className="w-full rounded border px-3 py-2 text-sm sm:w-72" value={candidateSearch} onChange={(e) => setCandidateSearch(e.target.value)} placeholder="Empresa, sucursal o contacto" />
            </div>
            <div className="max-h-[430px] overflow-auto rounded border">
              {loadingCandidates ? <div className="p-8 text-center text-gray-500">Buscando empresas...</div> : !form.city_ids.length ? <div className="p-8 text-center text-gray-500">Selecciona una o mas ciudades.</div> :
                !visibleCandidates.length ? <div className="p-8 text-center text-gray-500">No hay ubicaciones asociadas a esas ciudades.</div> :
                visibleCandidates.map((row) => {
                  const selected = selectedStops.some((stop) => stop.location_key === row.location_key);
                  return <div key={row.location_key} className={"border-b p-3 last:border-b-0 " + (selected ? 'bg-emerald-50' : 'bg-white')}>
                    <div className="flex items-start gap-3">
                      <input type="checkbox" className="mt-1" checked={selected} onChange={() => toggleCandidate(row)} />
                      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong>{row.organization_name}</strong>
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">Prioridad {row.suggestion_score}</span></div>
                        <div className="text-sm text-gray-600">{row.location_name} · {row.city_name}</div>
                        <div className="truncate text-xs text-gray-500">{row.address || 'Sin direccion exacta'}</div>
                        <div className="mt-1 flex flex-wrap gap-1">{(row.suggestion_reasons || []).map((reason) => <span key={reason} className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-800">{reason}</span>)}</div>
                        <div className="mt-1 text-xs text-gray-500">{row.contacts?.length || 0} contactos · {row.open_deals || 0} operaciones abiertas · ultima visita: {row.last_visit_at ? new Date(row.last_visit_at).toLocaleDateString('es-PY') : 'nunca'}</div>
                      </div>
                    </div>
                    {selected && <div className="mt-2 grid gap-2 pl-6 sm:grid-cols-2">
                      <select className="rounded border px-2 py-1.5 text-sm" value={selectedStops.find((stop) => stop.location_key === row.location_key)?.contact_id || ''} onChange={(e) => updateStop(row.location_key, { contact_id: e.target.value || null })}>
                        <option value="">Contacto sin definir</option>{(row.contacts || []).map((contact) => <option key={contact.id} value={contact.id}>{contact.name}{contact.phone ? ' - ' + contact.phone : ''}</option>)}
                      </select>
                      <input className="rounded border px-2 py-1.5 text-sm" placeholder="Nota para la visita" value={selectedStops.find((stop) => stop.location_key === row.location_key)?.notes || ''} onChange={(e) => updateStop(row.location_key, { notes: e.target.value })} />
                    </div>}
                  </div>;
                })}
            </div>
          </div>}
        </section>

        {!editRoute && <section>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <h3 className="mr-auto font-semibold">3. Agenda del recorrido</h3>
            <label className="text-xs">Inicio<input type="time" className="ml-1 rounded border px-2 py-1.5" value={form.workday_start} onChange={(e) => { setForm((v) => ({ ...v, workday_start: e.target.value })); setPreviewReady(false); }} /></label>
            <label className="text-xs">Fin<input type="time" className="ml-1 rounded border px-2 py-1.5" value={form.workday_end} onChange={(e) => { setForm((v) => ({ ...v, workday_end: e.target.value })); setPreviewReady(false); }} /></label>
            <label className="text-xs">Visita min<input type="number" min="15" className="ml-1 w-20 rounded border px-2 py-1.5" value={form.default_visit_minutes} onChange={(e) => { setForm((v) => ({ ...v, default_visit_minutes: Number(e.target.value) })); setPreviewReady(false); }} /></label>
            <label className="text-xs">Traslado min<input type="number" min="0" className="ml-1 w-20 rounded border px-2 py-1.5" value={form.travel_buffer_minutes} onChange={(e) => { setForm((v) => ({ ...v, travel_buffer_minutes: Number(e.target.value) })); setPreviewReady(false); }} /></label>
            <button type="button" className="rounded border border-emerald-700 px-3 py-2 text-sm font-medium text-emerald-800 disabled:opacity-50" onClick={buildPreview} disabled={busy || !selectedStops.length}>Generar agenda</button>
          </div>
          <div className="overflow-x-auto rounded border">
            <table className="min-w-full text-left text-sm"><thead className="bg-gray-100"><tr><th className="p-2">Orden</th><th className="p-2">Empresa / ubicacion</th><th className="p-2">Fecha</th><th className="p-2">Hora</th><th className="p-2">Duracion</th><th className="p-2">Ubicacion</th></tr></thead>
              <tbody>{selectedStops.map((row, index) => <tr key={row.location_key} className="border-t">
                <td className="whitespace-nowrap p-2"><button type="button" className="h-7 w-7 rounded border" onClick={() => moveStop(index, -1)} disabled={!index}>↑</button><button type="button" className="ml-1 h-7 w-7 rounded border" onClick={() => moveStop(index, 1)} disabled={index === selectedStops.length - 1}>↓</button></td>
                <td className="p-2"><strong>{row.organization_name}</strong><div className="text-xs text-gray-500">{row.location_name}</div></td>
                <td className="p-2">{row.planned_date ? isoDate(row.planned_date) : '-'}</td><td className="p-2">{row.planned_time ? String(row.planned_time).slice(0, 5) : '-'}</td>
                <td className="p-2">{row.duration_minutes || form.default_visit_minutes} min</td><td className="p-2">{Number.isFinite(Number(row.latitude)) ? 'Coordenadas listas' : 'Sin coordenadas'}</td>
              </tr>)}</tbody>
            </table>
            {!selectedStops.length && <div className="p-6 text-center text-sm text-gray-500">Todavia no seleccionaste empresas.</div>}
          </div>
        </section>}

        <label><span className="mb-1 block text-sm font-medium">Notas generales</span><textarea rows="2" className="w-full rounded border px-3 py-2" value={form.notes} onChange={(e) => setForm((v) => ({ ...v, notes: e.target.value }))} /></label>
      </div>

      <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-white px-5 py-4">
        <button type="button" className="rounded border px-4 py-2" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button type="submit" className="rounded bg-emerald-700 px-5 py-2 font-medium text-white disabled:opacity-50" disabled={busy}>{busy ? 'Guardando...' : editRoute ? 'Guardar cambios' : 'Crear borrador'}</button>
      </div>
    </form>
  );
}
