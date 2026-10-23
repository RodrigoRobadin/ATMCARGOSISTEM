// client/src/pages/Organizations.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { fetchUsersByRole } from '../api';
import { useAuth } from '../auth.jsx';

function normalizeUrl(u) {
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : `http://${u}`;
}

/* =============== Selector interno de ejecutivos (usuarios) =============== */
function ExecSelect({
  value,
  onChange,
  disabled = false,
  label = 'Ejecutivo de cuenta (opcional)',
}) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        // Primero intentamos traer solo ejecutivos
        let list = await fetchUsersByRole('ejecutivo');
        // Fallback: lista completa activa
        if (!list || list.length === 0) {
          const { data } = await api.get('/users/select', { params: { active: 1 } });
          list = Array.isArray(data)
            ? data
            : Array.isArray(data?.items)
            ? data.items
            : [];
        }
        const mapped = (list || [])
          .map((u) => {
            const id = u.id ?? u.user_id ?? null;
            const name =
              u.name ??
              ([u.first_name, u.last_name].filter(Boolean).join(' ') ||
                u.username ||
                u.email ||
                null);
            if (!id || !name) return null;
            return { id, name: String(name), email: u.email || '' };
          })
          .filter(Boolean);
        if (live) setUsers(mapped);
      } catch (e) {
        if (live) {
          setErr('No se pudo cargar usuarios.');
        }
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  return (
    <label className="block text-sm">
      {label}
      <select
        className="w-full border rounded-lg px-3 py-2 mt-1"
        value={value ?? ''}
        onChange={(e) =>
          onChange?.(e.target.value ? Number(e.target.value) : null)
        }
        disabled={disabled || loading}
      >
        <option value="">— Sin asignar —</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} {u.email ? `· ${u.email}` : ''}
          </option>
        ))}
      </select>
      {!!err && <div className="text-xs text-red-600 mt-1">{err}</div>}
    </label>
  );
}

export default function Organizations() {
  const { user } = useAuth();
  const canManage = String(user?.role || '').toLowerCase() === 'admin';
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [ownerFilter, setOwnerFilter] = useState('');
  const [archived, setArchived] = useState(false);
  const [changingId, setChangingId] = useState(null);
  const [actionError, setActionError] = useState('');
  const pageSize = 15;

  // Se mantienen para futuro
  const [owners, setOwners] = useState([]);
  const [labelOptions, setLabelOptions] = useState([]);

  // Parametría local
  const [paramOpts, setParamOpts] = useState({
    org_tipo: [],
    org_rubro: ['Seguro'],
    org_operacion: [],
    tipo_operacion: [],
  });

  const totalProfit = useMemo(
    () =>
      rows.reduce(
        (a, r) =>
          a +
          (r.budget_status === 'confirmado'
            ? Number(r.budget_profit_value || 0)
            : 0),
        0
      ),
    [rows]
  );

  async function fetchOrgs() {
    try {
      setLoadingRows(true);
      const offset = page * pageSize;
      const res = await api.get('/organizations', {
        params: {
          limit: pageSize,
          offset,
          include_total: 1,
          ...(archived ? { archived: 1 } : {}),
          ...(ownerFilter ? { owner_user_id: ownerFilter } : {}),
        },
      });
      const data = res?.data;
      const items = Array.isArray(data)
        ? data
        : Array.isArray(data?.items)
        ? data.items
        : [];
      setRows(items);
      const totalFromBody = Number(data?.total);
      if (Number.isFinite(totalFromBody) && totalFromBody >= 0) {
        setTotalCount(totalFromBody);
      } else {
        setTotalCount(offset + items.length);
      }
    } catch {
      setRows([]);
      setTotalCount(0);
    } finally {
      setLoadingRows(false);
    }
  }

  useEffect(() => {
    fetchOrgs();
  }, [page, ownerFilter, archived]);

  async function changeArchived(org) {
    const name = org.razon_social || org.name;
    const message = archived
      ? `¿Restaurar ${name} para que vuelva a estar disponible?`
      : `¿Dar de baja ${name}? Dejará de aparecer en las búsquedas y selecciones, pero conservará sus operaciones, contactos e historial.`;
    if (!window.confirm(message)) return;
    setChangingId(org.id);
    setActionError('');
    try {
      if (archived) await api.post(`/organizations/${org.id}/restore`);
      else await api.delete(`/organizations/${org.id}`);
      await fetchOrgs();
    } catch (error) {
      setActionError(error?.response?.data?.error || 'No se pudo actualizar la organización.');
    } finally {
      setChangingId(null);
    }
  }

  useEffect(() => {
    // ✅ Igual que en el VPS: cargamos sin mirar auth

    (async () => {
      try {
        const [usersLiteRes, labelsRes, paramsRes] = await Promise.allSettled([
          api.get('/users/select', { params: { active: 1 } }),
          api.get('/labels', { params: { scope: 'organization' } }),
          api.get('/params', {
            params: {
              keys: 'org_tipo,org_rubro,org_operacion,tipo_operacion',
            },
          }),
        ]);

        // Owners
        if (usersLiteRes.status === 'fulfilled') {
          const data = usersLiteRes.value?.data;
          const mappedOwners = (Array.isArray(data) ? data : []).map((u) => ({
            id: u.id,
            name: u.name || u.email || `Usuario ${u.id}`,
            email: u.email || '',
          }));
          setOwners(mappedOwners);
        } else {
          setOwners([]);
        }

        // Labels
        if (labelsRes.status === 'fulfilled') {
          const data = labelsRes.value?.data;
          setLabelOptions(Array.isArray(data) ? data : []);
        } else {
          setLabelOptions([]);
        }

        // Params → arrays simples
        if (paramsRes.status === 'fulfilled') {
          const raw = paramsRes.value?.data || {};
          const toArr = (x) =>
            Array.isArray(x)
              ? x
                  .map((v) =>
                    typeof v === 'string'
                      ? v
                      : v?.value ?? v?.key ?? v?.code ?? ''
                  )
                  .filter(Boolean)
              : [];
          const next = {
            org_tipo: toArr(raw.org_tipo),
            org_rubro: toArr(raw.org_rubro),
            org_operacion: toArr(raw.org_operacion),
            tipo_operacion: toArr(raw.tipo_operacion),
          };
          if (!next.org_rubro?.length) next.org_rubro = ['Seguro'];
          setParamOpts(next);
        }
      } catch {
        // silencioso
      }
    })();
  }, []);

  const totalPages = useMemo(() => {
    const count = Math.max(totalCount, 0);
    return Math.max(1, Math.ceil(count / pageSize));
  }, [totalCount, pageSize]);

  useEffect(() => {
    if (page > totalPages - 1) {
      setPage(Math.max(0, totalPages - 1));
    }
  }, [page, totalPages]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Organizaciones</h2>
        <div className="text-sm">
          <span className="text-slate-500 mr-1">
            Acumulado Valor Profit:
          </span>
          <span className="font-bold">
            $
            {Number(totalProfit).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="px-3 py-2 rounded-lg bg-black text-white text-sm md:self-start"
        >
          + Nueva organizacion
        </button>

        <div className="flex flex-wrap items-end gap-3">
          {canManage && (
            <div className="inline-flex rounded-md border text-sm" aria-label="Estado de organizaciones">
              <button type="button" aria-pressed={!archived}
                className={`px-3 py-2 ${!archived ? 'bg-slate-900 text-white' : 'hover:bg-slate-50'}`}
                onClick={() => { setArchived(false); setPage(0); setActionError(''); }}>Activas</button>
              <button type="button" aria-pressed={archived}
                className={`border-l px-3 py-2 ${archived ? 'bg-slate-900 text-white' : 'hover:bg-slate-50'}`}
                onClick={() => { setArchived(true); setPage(0); setActionError(''); }}>Dadas de baja</button>
            </div>
          )}
          <label className="text-sm md:w-80">
            Ejecutivo de cuenta
            <select
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={ownerFilter}
              onChange={(e) => {
                setOwnerFilter(e.target.value);
                setPage(0);
              }}
            >
              <option value="">Todos los ejecutivos</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}{owner.email ? ` - ${owner.email}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {actionError && <p role="alert" className="mb-3 text-sm text-red-700">{actionError}</p>}

      <div className="bg-white rounded-2xl shadow overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-2 text-left">Razón Social</th>
              <th className="p-2 text-left">RUC</th>
              <th className="p-2 text-left">Dirección</th>
              <th className="p-2 text-left">Email</th>
              <th className="p-2 text-left">Ciudad</th>
              <th className="p-2 text-left">País</th>
              <th className="p-2 text-left">Teléfono</th>
              <th className="p-2 text-left">Rubro</th>
              <th className="p-2 text-left">Tipo org</th>
              <th className="p-2 text-left">Operación</th>
              {canManage && <th className="p-2 text-right">Acción</th>}
            </tr>
          </thead>
          <tbody>
            {loadingRows && (
              <tr>
                <td
                  colSpan={canManage ? 11 : 10}
                  className="p-6 text-center text-slate-500"
                >
                  Cargando organizaciones…
                </td>
              </tr>
            )}
            {!loadingRows &&
              rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="p-2">
                    <Link
                      to={`/organizations/${r.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {r.razon_social || r.name}
                    </Link>
                  </td>
                  <td className="p-2">{r.ruc || '—'}</td>
                  <td className="p-2">{r.address || '—'}</td>
                  <td className="p-2">{r.email || '—'}</td>
                  <td className="p-2">{r.city || '—'}</td>
                  <td className="p-2">{r.country || '—'}</td>
                  <td className="p-2">{r.phone || '—'}</td>
                  <td className="p-2">{r.rubro || '—'}</td>
                  <td className="p-2">{r.tipo_org || '—'}</td>
                  <td className="p-2">{r.operacion || '—'}</td>
                  {canManage && <td className="p-2 text-right">
                    <button type="button" disabled={changingId === r.id}
                      onClick={() => changeArchived(r)}
                      className="whitespace-nowrap rounded-md border px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50">
                      {changingId === r.id ? 'Guardando...' : archived ? 'Restaurar' : 'Dar de baja'}
                    </button>
                  </td>}
                </tr>
              ))}
            {!loadingRows && !rows.length && (
              <tr>
                <td
                  colSpan={canManage ? 11 : 10}
                  className="p-6 text-center text-slate-500"
                >
                  {archived ? 'No hay organizaciones dadas de baja' : 'Sin organizaciones'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between mt-3 text-sm gap-2">
        <div className="text-slate-600">
          Pagina {page + 1} de {totalPages} ({totalCount} organizaciones)
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="px-3 py-1 border rounded disabled:opacity-50"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            Anterior
          </button>
          {Array.from({ length: totalPages }, (_, i) => i).map((p) => (
            <button
              key={p}
              type="button"
              className={
                "px-3 py-1 border rounded " +
                (p === page ? "bg-black text-white border-black" : "")
              }
              onClick={() => setPage(p)}
            >
              {p + 1}
            </button>
          ))}
          <button
            type="button"
            className="px-3 py-1 border rounded disabled:opacity-50"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
          >
            Siguiente
          </button>
        </div>
      </div>

      {open && (
        <NewOrganizationModal
          onClose={() => setOpen(false)}
          onCreated={fetchOrgs}
          owners={owners}
          labelOptions={labelOptions}
          paramOpts={paramOpts}
        />
      )}
    </div>
  );
}

/* =====================  MODAL  ===================== */

export function NewOrganizationModal({
  onClose,
  onCreated,
  paramOpts /* owners, labelOptions */,
  initialExecutiveId = null,
}) {
  const [razonSocial, setRazonSocial] = useState('');
  const [ruc, setRuc] = useState('');
  const [contactName, setContactName] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [cityId, setCityId] = useState('');
  const [cities, setCities] = useState([]);
  const [country, setCountry] = useState('');
  const [phone, setPhone] = useState('');
  const [rubro, setRubro] = useState('Seguro'); // fallback
  const [tipoOrg, setTipoOrg] = useState('');
  const [operacion, setOperacion] = useState('');
  const [notes, setNotes] = useState('');
  const [branches, setBranches] = useState([
    { name: 'Casa matriz', address: '', city: '', city_id: '', country: '', is_default: 1 },
  ]);
  const [supplierBank, setSupplierBank] = useState({
    supplier_bank_name: '',
    supplier_bank_account: '',
    supplier_bank_currency: 'PYG',
    supplier_bank_account_type: '',
    supplier_bank_holder: '',
    supplier_bank_holder_ruc: '',
    supplier_bank_cci_iban: '',
    supplier_bank_swift: '',
    supplier_bank_notes: '',
  });

  // Hoja de ruta para flete
  const [hojaRuta, setHojaRuta] = useState('');

  // Ejecutivo de cuenta (opcional)
  const [accountExecutiveId, setAccountExecutiveId] = useState(initialExecutiveId);
  const [loadedParamOpts, setLoadedParamOpts] = useState(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/cities').then(({ data }) => setCities(data || [])).catch(() => setCities([]));
  }, []);
  useEffect(() => {
    if (paramOpts) return;
    api.get('/params', { params: { keys: 'org_tipo,org_rubro,org_operacion,tipo_operacion' } })
      .then(({ data }) => {
        const toArr = (values) => Array.isArray(values)
          ? values.map((value) => typeof value === 'string' ? value : value?.value ?? value?.key ?? value?.code ?? '').filter(Boolean)
          : [];
        setLoadedParamOpts({
          org_tipo: toArr(data?.org_tipo), org_rubro: toArr(data?.org_rubro),
          org_operacion: toArr(data?.org_operacion), tipo_operacion: toArr(data?.tipo_operacion),
        });
      }).catch(() => setLoadedParamOpts(null));
  }, [paramOpts]);

  // Parametría del modal desde props
  const options = paramOpts || loadedParamOpts;
  const tipoOrgOptions = options?.org_tipo || [];
  const rubroOptions = options?.org_rubro?.length ? options.org_rubro : ['Seguro'];
  const operacionOptions =
    options?.org_operacion || options?.tipo_operacion || [];

  const isFreightOrg =
    (tipoOrg || '').toLowerCase().includes('flete') ||
    (rubro || '').toLowerCase().includes('flete');
  const isSupplierOrg = (tipoOrg || '').toLowerCase().includes('proveedor');
  const setSupplierBankField = (key, value) =>
    setSupplierBank((prev) => ({ ...prev, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!razonSocial.trim()) {
      setError('La Razón Social es obligatoria.');
      return;
    }
    if (!ruc.trim()) {
      setError('El RUC es obligatorio.');
      return;
    }
    if (!contactName.trim()) {
      setError('El contacto principal es obligatorio.');
      return;
    }
    if (!email.trim()) {
      setError('El email de la organización es obligatorio.');
      return;
    }
    if (!cityId) {
      setError('La ciudad es obligatoria.');
      return;
    }
    const activeBranches = (branches || [])
      .filter((branch) => branch?.name || branch?.address)
      .map((branch) => ({
        ...branch,
        address: branch.address || address || '',
        city_id: branch.city_id || cityId || '',
        city: branch.city || city || '',
        country: branch.country || country || '',
      }));
    if (!activeBranches.length) {
      setError('Debe cargar una sucursal o casa matriz.');
      return;
    }
    if (activeBranches.some((branch) => !String(branch.name || '').trim())) {
      setError('Indica el nombre de cada sucursal o matriz.');
      return;
    }
    if (activeBranches.some((branch) => !branch.city_id)) {
      setError('Selecciona la ciudad de cada sucursal cargada.');
      return;
    }
    setSaving(true);
    try {
      const execId = accountExecutiveId ? Number(accountExecutiveId) : null;
      const { data: created } = await api.post('/organizations', {
        razon_social: razonSocial.trim(),
        name: razonSocial.trim(),
        ruc: ruc.trim(),
        contact_name: contactName.trim(),
        address: address || null,
        email: email.trim(),
        city: city || null,
        city_id: cityId ? Number(cityId) : null,
        country: country || null,
        phone: phone || null,
        rubro: rubro || null,
        tipo_org: tipoOrg || null,
        operacion: operacion || null,
        notes: notes || null,
        hoja_ruta: hojaRuta || null,
        ...(isSupplierOrg ? supplierBank : {}),
        branches: activeBranches.map((branch, index) => ({
          ...branch,
          is_default: activeBranches.some((item) => item.is_default)
            ? (branch.is_default ? 1 : 0)
            : (index === 0 ? 1 : 0),
        })),

        // Asignación comercial tolerante
        account_executive_id: execId,
        owner_id: execId,
        assigned_user_id: execId,
        owner_user_id: execId,
      });
      await onCreated?.(created);
      onClose?.();
    } catch (e) {
      setError(
        e?.response?.data
          ? typeof e.response.data === 'string'
            ? e.response.data
            : e.response.data?.error || 'No se pudo crear la organización.'
          : 'No se pudo crear la organización.'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-2 sm:items-center sm:p-4">
      <form
        onSubmit={submit}
        className="flex max-h-[calc(100dvh-1rem)] w-full min-w-0 max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl sm:max-h-[calc(100dvh-2rem)]"
      >
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
          <h3 className="text-lg font-semibold">Nueva organización</h3>
          <button type="button" onClick={onClose} className="text-sm">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
        {error && (
          <div className="text-sm text-red-600 break-words">{error}</div>
        )}

        {/* Fila 1: identificación */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <label className="block text-sm">
            Razón Social *
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={razonSocial}
              onChange={(e) => setRazonSocial(e.target.value.toUpperCase())}
              required
            />
          </label>
          <label className="block text-sm">
            RUC *
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={ruc}
              onChange={(e) => setRuc(e.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            Contacto principal *
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              required
            />
          </label>
        </div>

        {/* Fila 2: Dirección - Email */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block text-sm">
            Dirección
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Email *
            <input
              type="email"
              className="w-full border rounded-lg px-3 py-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
        </div>

        {/* Fila 3: Ciudad - País - Teléfono */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <label className="block text-sm">
            Ciudad *
            <select
              className="w-full border rounded-lg px-3 py-2"
              value={cityId}
              onChange={(e) => {
                const selected = cities.find((row) => Number(row.id) === Number(e.target.value));
                setCityId(e.target.value);
                setCity(selected?.name || '');
              }}
              required
            >
              <option value="">Seleccionar ciudad</option>
              {cities.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}{row.department ? ' - ' + row.department : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            País
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Teléfono
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
        </div>

        {/* Sucursales */}
        <div className="border rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">Sucursal / matriz *</div>
            <button
              type="button"
              className="px-2 py-1 text-xs rounded-lg border bg-white hover:bg-slate-50"
              onClick={() =>
                setBranches((prev) => [
                  ...prev,
                  { name: '', address: '', city: '', city_id: '', country: '', is_default: 0 },
                ])
              }
            >
              Agregar sucursal
            </button>
          </div>
          {branches.length === 0 && (
            <div className="text-xs text-slate-500">
              Debe cargar una sucursal o casa matriz.
            </div>
          )}
          {branches.map((b, idx) => (
            <div key={idx} className="grid min-w-0 grid-cols-1 gap-2 mb-2 sm:grid-cols-2 lg:grid-cols-6">
              <input
                className="min-w-0 w-full border rounded-lg px-2 py-1 text-sm"
                placeholder="Nombre"
                value={b.name || ''}
                required
                onChange={(e) =>
                  setBranches((prev) =>
                    prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x))
                  )
                }
              />
              <input
                className="min-w-0 w-full border rounded-lg px-2 py-1 text-sm lg:col-span-2"
                placeholder="Dirección"
                value={b.address || ''}
                onChange={(e) =>
                  setBranches((prev) =>
                    prev.map((x, i) => (i === idx ? { ...x, address: e.target.value } : x))
                  )
                }
              />
              <select
                className="min-w-0 w-full border rounded-lg px-2 py-1 text-sm"
                value={b.city_id || ''}
                onChange={(e) => {
                  const selected = cities.find((row) => Number(row.id) === Number(e.target.value));
                  setBranches((prev) =>
                    prev.map((x, i) => (i === idx ? { ...x, city_id: e.target.value, city: selected?.name || '' } : x))
                  );
                }}
              >
                <option value="">Ciudad *</option>
                {cities.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
              <input
                className="min-w-0 w-full border rounded-lg px-2 py-1 text-sm"
                placeholder="País"
                value={b.country || ''}
                onChange={(e) =>
                  setBranches((prev) =>
                    prev.map((x, i) => (i === idx ? { ...x, country: e.target.value } : x))
                  )
                }
              />
              <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-1">
                <label className="text-xs flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!b.is_default}
                    onChange={() =>
                      setBranches((prev) =>
                        prev.map((x, i) => ({ ...x, is_default: i === idx ? 1 : 0 }))
                      )
                    }
                  />
                  Principal
                </label>
                <button
                  type="button"
                  className="text-xs text-red-600 hover:underline"
                  onClick={() =>
                    setBranches((prev) => prev.filter((_, i) => i !== idx))
                  }
                >
                  Quitar
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Fila 4: Rubro - Tipo org */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block text-sm">
            Rubro
            <select
              className="w-full border rounded-lg px-3 py-2"
              value={rubro}
              onChange={(e) => setRubro(e.target.value)}
            >
              {rubroOptions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Tipo org
            <select
              className="w-full border rounded-lg px-3 py-2"
              value={tipoOrg}
              onChange={(e) => setTipoOrg(e.target.value)}
            >
              <option value="">(Seleccione)</option>
              {tipoOrgOptions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Operación */}
        <label className="block text-sm">
          Tipo de Operación
          <select
            className="w-full border rounded-lg px-3 py-2"
            value={operacion}
            onChange={(e) => setOperacion(e.target.value)}
          >
            <option value="">(Seleccione)</option>
            {operacionOptions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>

        {isSupplierOrg && (
          <div className="border rounded-xl p-3 bg-slate-50 space-y-3">
            <div>
              <div className="text-sm font-medium">Cuenta bancaria del proveedor</div>
              <div className="text-xs text-slate-500">
                Estos datos se usan como cuenta destino al registrar pagos a proveedores.
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block text-sm">
                Banco
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={supplierBank.supplier_bank_name}
                  onChange={(e) => setSupplierBankField('supplier_bank_name', e.target.value)}
                />
              </label>
              <label className="block text-sm">
                Nro. de cuenta
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={supplierBank.supplier_bank_account}
                  onChange={(e) => setSupplierBankField('supplier_bank_account', e.target.value)}
                />
              </label>
              <label className="block text-sm">
                Moneda
                <select
                  className="w-full border rounded-lg px-3 py-2"
                  value={supplierBank.supplier_bank_currency}
                  onChange={(e) => setSupplierBankField('supplier_bank_currency', e.target.value)}
                >
                  <option value="PYG">PYG</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </label>
              <label className="block text-sm">
                Tipo de cuenta
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="Corriente, ahorro, etc."
                  value={supplierBank.supplier_bank_account_type}
                  onChange={(e) => setSupplierBankField('supplier_bank_account_type', e.target.value)}
                />
              </label>
              <label className="block text-sm">
                Titular
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={supplierBank.supplier_bank_holder}
                  onChange={(e) => setSupplierBankField('supplier_bank_holder', e.target.value)}
                />
              </label>
              <label className="block text-sm">
                RUC titular
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={supplierBank.supplier_bank_holder_ruc}
                  onChange={(e) => setSupplierBankField('supplier_bank_holder_ruc', e.target.value)}
                />
              </label>
              <label className="block text-sm">
                CCI / IBAN
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={supplierBank.supplier_bank_cci_iban}
                  onChange={(e) => setSupplierBankField('supplier_bank_cci_iban', e.target.value)}
                />
              </label>
              <label className="block text-sm">
                SWIFT
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={supplierBank.supplier_bank_swift}
                  onChange={(e) => setSupplierBankField('supplier_bank_swift', e.target.value)}
                />
              </label>
              <label className="block text-sm md:col-span-2">
                Notas bancarias
                <textarea
                  className="w-full border rounded-lg px-3 py-2"
                  rows={2}
                  value={supplierBank.supplier_bank_notes}
                  onChange={(e) => setSupplierBankField('supplier_bank_notes', e.target.value)}
                />
              </label>
            </div>
          </div>
        )}

        {/* Ejecutivo de cuenta */}
        <ExecSelect
          value={accountExecutiveId}
          onChange={setAccountExecutiveId}
          label="Ejecutivo de cuenta (opcional)"
        />

        {/* Hoja de ruta solo si es Flete */}
        {isFreightOrg && (
          <label className="block text-sm">
            Hoja de ruta (cobertura de flete)
            <textarea
              className="w-full border rounded-lg px-3 py-2"
              rows={3}
              placeholder="Ej: Aéreo: AR–BR–CL / Marítimo: China–Latam vía Panamá..."
              value={hojaRuta}
              onChange={(e) => setHojaRuta(e.target.value)}
            />
          </label>
        )}

        {/* Notas */}
        <label className="block text-sm">
          Notas
          <textarea
            className="w-full border rounded-lg px-3 py-2"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t bg-white px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 border rounded-lg"
          >
            Cancelar
          </button>
          <button
            className="px-3 py-2 rounded-lg bg-black text-white disabled:opacity-60"
            disabled={saving}
          >
            {saving ? 'Creando…' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  );
}
