import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';

const emptyCity = { name: '', department: '', country_code: 'PY' };

export default function RouteLocationsAdmin() {
  const [cities, setCities] = useState([]);
  const [citySearch, setCitySearch] = useState('');
  const [cityForm, setCityForm] = useState(emptyCity);
  const [staleDays, setStaleDays] = useState(60);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const filteredCities = useMemo(() => {
    const query = citySearch.trim().toLocaleLowerCase('es');
    if (!query) return cities;
    return cities.filter((city) => `${city.name} ${city.department || ''}`.toLocaleLowerCase('es').includes(query));
  }, [cities, citySearch]);

  async function loadConfiguration() {
    const [citiesResponse, settingsResponse] = await Promise.all([
      api.get('/cities', { params: { include_inactive: 1 } }),
      api.get('/cities/settings/current'),
    ]);
    setCities(citiesResponse.data || []);
    setStaleDays(Number(settingsResponse.data?.stale_visit_days || 60));
  }

  useEffect(() => {
    loadConfiguration().catch((error) => alert(error.response?.data?.error || 'No se pudo cargar la configuracion de recorridos.'));
  }, []);

  async function createCity(event) {
    event.preventDefault();
    if (!cityForm.name.trim()) return;
    setBusy(true);
    try {
      await api.post('/cities', cityForm);
      setCityForm(emptyCity);
      await loadConfiguration();
    } catch (error) { alert(error.response?.data?.error || 'No se pudo agregar la ciudad.'); }
    finally { setBusy(false); }
  }

  async function editCity(city) {
    const name = window.prompt('Nombre de la ciudad', city.name);
    if (name === null || !name.trim()) return;
    const department = window.prompt('Departamento', city.department || '');
    if (department === null) return;
    setBusy(true);
    try {
      await api.patch(`/cities/${city.id}`, { name: name.trim(), department: department.trim() });
      await loadConfiguration();
    } catch (error) { alert(error.response?.data?.error || 'No se pudo editar la ciudad.'); }
    finally { setBusy(false); }
  }

  async function toggleCity(city) {
    setBusy(true);
    try {
      await api.patch(`/cities/${city.id}`, { active: !Number(city.active) });
      await loadConfiguration();
    } catch (error) { alert(error.response?.data?.error || 'No se pudo cambiar el estado de la ciudad.'); }
    finally { setBusy(false); }
  }

  async function saveSettings() {
    setBusy(true);
    try {
      const { data } = await api.patch('/cities/settings/current', { stale_visit_days: staleDays });
      setStaleDays(Number(data.stale_visit_days || 60));
    } catch (error) { alert(error.response?.data?.error || 'No se pudo guardar la configuracion.'); }
    finally { setBusy(false); }
  }

  async function exportWorkbook() {
    setBusy(true);
    try {
      const response = await api.get('/cities/locations/export', { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'ubicaciones_recorridos.xlsx';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) { alert(error.response?.data?.error || 'No se pudo exportar la planilla.'); }
    finally { setBusy(false); }
  }

  async function validateWorkbook() {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post('/cities/locations/import-preview', form);
      setPreview(data);
    } catch (error) { alert(error.response?.data?.error || 'No se pudo validar la planilla.'); }
    finally { setBusy(false); }
  }

  async function applyWorkbook() {
    if (!preview?.valid || !window.confirm(`Se actualizaran ${preview.valid} ubicaciones. Continuar?`)) return;
    setBusy(true);
    try {
      const { data } = await api.post('/cities/locations/import-apply', { rows: preview.rows });
      alert(`${data.updated || 0} ubicaciones actualizadas.`);
      setPreview(null);
      setFile(null);
      await loadConfiguration();
    } catch (error) { alert(error.response?.data?.error || 'No se pudieron aplicar los cambios.'); }
    finally { setBusy(false); }
  }

  return <div className="space-y-6">
    <section className="border-b pb-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Catalogo de ciudades</h3>
          <p className="mt-1 text-sm text-gray-600">Estas ciudades organizan candidatos, recorridos y cobertura comercial.</p>
        </div>
        <label className="text-sm font-medium">Visita atrasada despues de
          <span className="ml-2 inline-flex items-center gap-2">
            <input type="number" min="1" max="3650" className="w-24 rounded border px-3 py-2" value={staleDays} onChange={(event) => setStaleDays(event.target.value)} /> dias
            <button type="button" className="rounded bg-gray-900 px-3 py-2 text-white disabled:opacity-50" onClick={saveSettings} disabled={busy}>Guardar</button>
          </span>
        </label>
      </div>

      <form className="mt-4 grid gap-2 md:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_110px]" onSubmit={createCity}>
        <input className="rounded border px-3 py-2" placeholder="Nueva ciudad" value={cityForm.name} onChange={(event) => setCityForm((current) => ({ ...current, name: event.target.value }))} />
        <input className="rounded border px-3 py-2" placeholder="Departamento" value={cityForm.department} onChange={(event) => setCityForm((current) => ({ ...current, department: event.target.value }))} />
        <button type="submit" className="rounded bg-emerald-700 px-4 py-2 font-medium text-white disabled:opacity-50" disabled={busy || !cityForm.name.trim()}>Agregar</button>
      </form>

      <input className="mt-4 w-full rounded border px-3 py-2 md:max-w-md" placeholder="Buscar ciudad o departamento" value={citySearch} onChange={(event) => setCitySearch(event.target.value)} />
      <div className="mt-3 max-h-80 overflow-auto rounded border">
        <table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 bg-gray-100"><tr><th className="p-2">Ciudad</th><th className="p-2">Departamento</th><th className="p-2 text-right">Ubicaciones</th><th className="p-2">Estado</th><th className="p-2 text-right">Acciones</th></tr></thead>
          <tbody>{filteredCities.map((city) => <tr key={city.id} className="border-t">
            <td className="p-2 font-medium">{city.name}</td><td className="p-2 text-gray-600">{city.department || '-'}</td><td className="p-2 text-right">{Number(city.locations_count || 0)}</td>
            <td className="p-2"><span className={`inline-flex rounded px-2 py-1 text-xs ${Number(city.active) ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-700'}`}>{Number(city.active) ? 'Activa' : 'Inactiva'}</span></td>
            <td className="p-2 text-right"><button type="button" className="mr-2 text-emerald-800 hover:underline" onClick={() => editCity(city)} disabled={busy}>Editar</button><button type="button" className="text-gray-700 hover:underline" onClick={() => toggleCity(city)} disabled={busy}>{Number(city.active) ? 'Desactivar' : 'Activar'}</button></td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>

    <section>
      <h3 className="text-lg font-semibold">Carga masiva de ubicaciones</h3>
      <p className="mt-1 text-sm text-gray-600">La planilla identifica cada casa matriz y sucursal por ID. Primero se valida y luego se aplican solamente las filas correctas.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="rounded border px-4 py-2 text-sm font-medium hover:bg-gray-50" onClick={exportWorkbook} disabled={busy}>Descargar Excel</button>
        <label className="cursor-pointer rounded border px-4 py-2 text-sm font-medium hover:bg-gray-50">Seleccionar Excel
          <input type="file" accept=".xlsx" className="hidden" onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); }} />
        </label>
        <button type="button" className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" onClick={validateWorkbook} disabled={!file || busy}>Validar</button>
        {file && <span className="self-center text-sm text-gray-600">{file.name}</span>}
      </div>
      {preview && <div className="mt-4 rounded border">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
          <div className="text-sm"><strong>{preview.valid}</strong> validas · <strong className="text-red-700">{preview.errors}</strong> con errores</div>
          <button type="button" className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={!preview.valid || busy} onClick={applyWorkbook}>Aplicar filas validas</button>
        </div>
        <div className="max-h-[420px] overflow-auto"><table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 bg-gray-100"><tr><th className="p-2">Fila</th><th className="p-2">Empresa</th><th className="p-2">Ubicacion</th><th className="p-2">Ciudad</th><th className="p-2">Estado</th></tr></thead>
          <tbody>{preview.rows.map((row) => <tr key={row.row_number} className="border-t"><td className="p-2">{row.row_number}</td><td className="p-2">{row.organization_name || `Organizacion #${row.organization_id}`}</td>
            <td className="p-2">{row.location_name || (row.branch_id ? `Sucursal #${row.branch_id}` : 'Casa matriz')}</td><td className="p-2">{row.city_name || '-'}</td><td className={`p-2 ${row.status === 'ok' ? 'text-emerald-700' : 'text-red-700'}`}>{row.status === 'ok' ? 'Lista' : (row.errors || []).join(', ')}</td></tr>)}</tbody>
        </table></div>
      </div>}
    </section>
  </div>;
}

