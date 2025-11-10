// client/src/pages/RequestFreight.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function RequestFreight() {
  const { id } = useParams(); // deal / operación id
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [deal, setDeal] = useState(null);
  const [cfMap, setCfMap] = useState({});

  const [modalidadEnum, setModalidadEnum] = useState(null); // aereo/maritimo/terrestre
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [originCountry, setOriginCountry] = useState('');
  const [destinationCountry, setDestinationCountry] = useState('');

  const [providers, setProviders] = useState([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [selectedOrgIds, setSelectedOrgIds] = useState([]);

  // Nuevo proveedor
  const [newProvName, setNewProvName] = useState('');
  const [newProvEmail, setNewProvEmail] = useState('');
  const [newProvPhone, setNewProvPhone] = useState('');
  const [newRouteNotes, setNewRouteNotes] = useState('');
  const [creatingProvider, setCreatingProvider] = useState(false);

  // Email
  const [manualEmails, setManualEmails] = useState('');
  const [subject, setSubject] = useState('');
  const [htmlBody, setHtmlBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  async function loadContext() {
    setLoading(true);
    try {
      const [detailRes, cfRes] = await Promise.all([
        api.get(`/deals/${id}`),
        api.get(`/deals/${id}/custom-fields`).catch(() => ({ data: [] })),
      ]);

      const dealData = detailRes.data?.deal || detailRes.data || null;
      setDeal(dealData);

      const cfLocal = {};
      const cfList = Array.isArray(cfRes.data) ? cfRes.data : [];
      cfList.forEach((row) => {
        cfLocal[row.key] = row.value ?? '';
      });
      setCfMap(cfLocal);

      const modalidadRaw = String(cfLocal.modalidad_carga || '').toUpperCase();
      let mEnum = null;
      if (modalidadRaw === 'AEREO') mEnum = 'aereo';
      else if (modalidadRaw === 'MARITIMO') mEnum = 'maritimo';
      else if (modalidadRaw === 'TERRESTRE') mEnum = 'terrestre';

      const orig = cfLocal.origen_pto || '';
      const dest = cfLocal.destino_pto || '';
      const origC = cfLocal.origen_pais || cfLocal.country_origen || '';
      const destC = cfLocal.destino_pais || cfLocal.country_destino || '';

      setModalidadEnum(mEnum);
      setOrigin(orig);
      setDestination(dest);
      setOriginCountry(origC);
      setDestinationCountry(destC);

      buildDefaultEmail(dealData, cfLocal, { modalidadEnum: mEnum, origin: orig, destination: dest });
      if (mEnum) {
        await searchProviders({ modalidadEnum: mEnum, origin: orig, destination: dest, originCountry: origC, destinationCountry: destC });
      }
    } catch (e) {
      console.error('[RequestFreight:loadContext]', e);
      setError('No se pudo cargar la operación.');
    } finally {
      setLoading(false);
    }
  }

  async function searchProviders(paramsOverride = {}) {
    const mEnum = paramsOverride.modalidadEnum ?? modalidadEnum;
    const o = paramsOverride.origin ?? origin;
    const d = paramsOverride.destination ?? destination;
    const oc = paramsOverride.originCountry ?? originCountry;
    const dc = paramsOverride.destinationCountry ?? destinationCountry;

    if (!mEnum) return;

    setProvidersLoading(true);
    try {
      const { data } = await api.get('/organizations/search-flete-providers', {
        params: {
          modalidad: mEnum,
          origin: o || undefined,
          destination: d || undefined,
          origin_country: oc || undefined,
          destination_country: dc || undefined,
        },
      });
      const list = Array.isArray(data) ? data : [];
      setProviders(list);
      setSelectedOrgIds(list.map((p) => p.org_id)); // por defecto todos seleccionados
    } catch (e) {
      console.error('[RequestFreight:searchProviders]', e);
      setProviders([]);
    } finally {
      setProvidersLoading(false);
    }
  }

  function buildDefaultEmail(dealData, cfLocal, ctx) {
    const cliente = dealData?.org_name || '';
    const contacto = dealData?.contact_name || '';
    const contactoEmail = dealData?.contact_email || '';
    const modalidadRaw = cfLocal.modalidad_carga || '';
    const tipoOp = cfLocal.tipo_operacion || '';
    const incoterm = cfLocal.incoterm || '';
    const merca = cfLocal.mercaderia || '';
    const peso = cfLocal.peso_bruto || '';
    const volumen = cfLocal.vol_m3 || '';
    const bultos = cfLocal.cant_bultos || '';
    const origenTxt = ctx.origin || cfLocal.origen_pto || '';
    const destinoTxt = ctx.destination || cfLocal.destino_pto || '';

    const subj = `Solicitud de tarifa de flete ${modalidadRaw || ''} ${origenTxt || ''} → ${destinoTxt || ''}`.trim();
    setSubject(subj);

    const html = `
      <p>Estimados,</p>
      <p>Solicitamos cotización de flete para la siguiente operación:</p>
      <ul>
        <li><strong>Cliente:</strong> ${cliente || '-'}</li>
        <li><strong>Contacto:</strong> ${contacto || '-'} ${contactoEmail ? `(${contactoEmail})` : ''}</li>
        <li><strong>Tipo de operación:</strong> ${tipoOp || '-'}</li>
        <li><strong>Modalidad:</strong> ${modalidadRaw || '-'}</li>
        <li><strong>Incoterm:</strong> ${incoterm || '-'}</li>
        <li><strong>Origen:</strong> ${origenTxt || '-'}</li>
        <li><strong>Destino:</strong> ${destinoTxt || '-'}</li>
        <li><strong>Mercadería:</strong> ${merca || '-'}</li>
        <li><strong>Peso bruto (kg):</strong> ${peso || '-'}</li>
        <li><strong>Volumen (m³):</strong> ${volumen || '-'}</li>
        <li><strong>Cantidad de bultos:</strong> ${bultos || '-'}</li>
      </ul>
      <p>Agradecemos indicar:</p>
      <ul>
        <li>Tarifa de flete (detalle de conceptos)</li>
        <li>Tiempo de tránsito estimado</li>
        <li>Validez de la cotización</li>
        <li>Condiciones especiales (free days, recargos, etc.)</li>
      </ul>
      <p>Quedamos atentos a sus comentarios.</p>
      <p>Saludos cordiales,</p>
    `;
    setHtmlBody(html.trim());
  }

  useEffect(() => {
    loadContext();
  }, [id]);

  const emailsFromProviders = useMemo(() => {
    const set = new Set();
    providers.forEach((p) => {
      if (!selectedOrgIds.includes(p.org_id)) return;
      if (p.email) set.add(p.email);
    });
    return Array.from(set);
  }, [providers, selectedOrgIds]);

  const allToEmails = useMemo(() => {
    const list = [...emailsFromProviders];
    if (manualEmails) {
      manualEmails
        .split(/[;,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((e) => list.push(e));
    }
    return Array.from(new Set(list));
  }, [emailsFromProviders, manualEmails]);

  async function handleCreateProvider(e) {
    e.preventDefault();
    setError('');
    if (!newProvName.trim() || !newProvEmail.trim()) {
      setError('Completá al menos nombre y email del proveedor.');
      return;
    }
    if (!modalidadEnum) {
      setError('No se pudo determinar la modalidad (aéreo/marítimo/terrestre).');
      return;
    }
    setCreatingProvider(true);
    try {
      const { data: org } = await api.post('/organizations', {
        razon_social: newProvName.trim(),
        name: newProvName.trim(),
        email: newProvEmail.trim(),
        phone: newProvPhone || null,
        rubro: 'flete',
        tipo_org: 'flete',
        operacion: 'flete',
        is_agent: 0,
      });

      await api.post(`/organizations/${org.id}/flete-routes`, {
        modality: modalidadEnum,
        origin: origin || null,
        destination: destination || null,
        origin_country: originCountry || null,
        destination_country: destinationCountry || null,
        notes: newRouteNotes || null,
      });

      setNewProvName('');
      setNewProvEmail('');
      setNewProvPhone('');
      setNewRouteNotes('');

      await searchProviders({
        modalidadEnum,
        origin,
        destination,
        originCountry,
        destinationCountry,
      });
    } catch (e) {
      console.error('[RequestFreight:createProvider]', e);
      setError('No se pudo crear el proveedor/ruta.');
    } finally {
      setCreatingProvider(false);
    }
  }

  async function handleSend(e) {
    e.preventDefault();
    setError('');
    if (!allToEmails.length) {
      setError('Indicá al menos un email de destino.');
      return;
    }
    if (!subject.trim()) {
      setError('El asunto no puede estar vacío.');
      return;
    }
    if (!htmlBody.trim()) {
      setError('El cuerpo del mensaje no puede estar vacío.');
      return;
    }

    setSending(true);
    try {
      await api.post('/freight-requests', {
        deal_id: Number(id),
        to_emails: allToEmails,
        subject,
        html: htmlBody,
        provider_org_ids: selectedOrgIds,
      });
      alert('Solicitud de flete enviada.');
      nav(`/operations/${id}`);
    } catch (e) {
      console.error('[RequestFreight:send]', e);
      setError('No se pudo enviar la solicitud.');
    } finally {
      setSending(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-600">Cargando solicitud de flete…</p>;
  if (!deal) return <p className="text-sm text-slate-600">Operación no encontrada.</p>;

  const modalidadLabel = cfMap.modalidad_carga || '';
  const tipoOp = cfMap.tipo_operacion || '';
  const merca = cfMap.mercaderia || '';
  const peso = cfMap.peso_bruto || '';
  const volumen = cfMap.vol_m3 || '';
  const bultos = cfMap.cant_bultos || '';
  const incoterm = cfMap.incoterm || '';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Solicitar flete</h2>
          <p className="text-xs text-slate-500">
            Operación: <span className="font-medium">{deal.reference}</span> — {deal.org_name || 'Sin cliente'}
          </p>
        </div>
        <Link to={`/operations/${id}`} className="text-sm text-blue-600 hover:underline">
          ← Volver a la operación
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-3 py-2">
          {error}
        </div>
      )}

      {/* Datos de la operación */}
      <div className="bg-white rounded-2xl shadow p-4">
        <h3 className="font-medium mb-3">Datos de la operación para el flete</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-xs text-slate-500">Tipo de operación</div>
            <div className="font-medium">{tipoOp || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Modalidad</div>
            <div className="font-medium">{modalidadLabel || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Incoterm</div>
            <div className="font-medium">{incoterm || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Origen</div>
            <div className="font-medium">{origin || cfMap.origen_pto || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Destino</div>
            <div className="font-medium">{destination || cfMap.destino_pto || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Mercadería</div>
            <div className="font-medium">{merca || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Peso bruto (kg)</div>
            <div className="font-medium">{peso || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Volumen (m³)</div>
            <div className="font-medium">{volumen || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Bultos</div>
            <div className="font-medium">{bultos || '—'}</div>
          </div>
        </div>
      </div>

      {/* Proveedores encontrados */}
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-medium">Proveedores que coinciden</h3>
          <button
            type="button"
            onClick={() => searchProviders()}
            className="px-3 py-1.5 text-xs rounded-lg border"
          >
            🔄 Buscar de nuevo
          </button>
        </div>
        {providersLoading ? (
          <div className="text-sm text-slate-600">Buscando proveedores…</div>
        ) : providers.length ? (
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-2 text-left">Seleccionar</th>
                  <th className="p-2 text-left">Proveedor</th>
                  <th className="p-2 text-left">Ruta</th>
                  <th className="p-2 text-left">Países</th>
                  <th className="p-2 text-left">Email</th>
                  <th className="p-2 text-left">Teléfono</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p, i) => {
                  const checked = selectedOrgIds.includes(p.org_id);
                  return (
                    <tr key={`${p.org_id}-${p.route_id}-${i}`} className="border-b last:border-0">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setSelectedOrgIds((prev) => {
                              const set = new Set(prev);
                              if (e.target.checked) set.add(p.org_id);
                              else set.delete(p.org_id);
                              return Array.from(set);
                            });
                          }}
                        />
                      </td>
                      <td className="p-2">
                        <div className="font-medium text-xs">{p.razon_social || p.name}</div>
                      </td>
                      <td className="p-2">
                        {(p.origin || 'Cualquier origen')} → {(p.destination || 'Cualquier destino')}
                      </td>
                      <td className="p-2">
                        {(p.origin_country || '?')} → {(p.destination_country || '?')}
                      </td>
                      <td className="p-2">{p.email || '—'}</td>
                      <td className="p-2">{p.phone || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-sm text-slate-600">
            No hay proveedores que coincidan con esta ruta y modalidad. Podés agregar uno abajo.
          </div>
        )}
      </div>

      {/* Agregar proveedor y ruta */}
      <div className="bg-white rounded-2xl shadow p-4">
        <h3 className="font-medium mb-2">Agregar proveedor de flete y ruta</h3>
        <p className="text-xs text-slate-500 mb-3">
          Usá este formulario si tenés un proveedor a mano que aún no está en el sistema.
        </p>
        <form className="space-y-3" onSubmit={handleCreateProvider}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <label className="block">
              Nombre / Razón Social *
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={newProvName}
                onChange={(e) => setNewProvName(e.target.value)}
              />
            </label>
            <label className="block">
              Email *
              <input
                type="email"
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={newProvEmail}
                onChange={(e) => setNewProvEmail(e.target.value)}
              />
            </label>
            <label className="block">
              Teléfono
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={newProvPhone}
                onChange={(e) => setNewProvPhone(e.target.value)}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-xs text-slate-500 mb-1">Modalidad</div>
              <div className="px-3 py-2 border rounded-lg text-xs bg-slate-50">
                {modalidadLabel || modalidadEnum || '—'}
              </div>
            </div>
            <label className="block">
              Origen
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
              />
            </label>
            <label className="block">
              Destino
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              />
            </label>
            <label className="block">
              Notas ruta
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={newRouteNotes}
                onChange={(e) => setNewRouteNotes(e.target.value)}
              />
            </label>
          </div>

          <div className="pt-2 flex gap-2 justify-end">
            <button
              type="submit"
              disabled={creatingProvider}
              className="px-3 py-2 text-sm rounded-lg bg-black text-white disabled:opacity-60"
            >
              {creatingProvider ? 'Guardando…' : 'Crear proveedor y ruta'}
            </button>
          </div>
        </form>
      </div>

      {/* Email */}
      <div className="bg-white rounded-2xl shadow p-4">
        <h3 className="font-medium mb-3">Solicitud de tarifa por email</h3>
        <form className="space-y-3" onSubmit={handleSend}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <label className="block">
              Destinatarios desde proveedores seleccionados
              <div className="mt-1 border rounded-lg px-3 py-2 bg-slate-50 text-xs min-h-[40px]">
                {emailsFromProviders.length
                  ? emailsFromProviders.join(', ')
                  : 'No hay emails de proveedores seleccionados'}
              </div>
            </label>
            <label className="block">
              Otros destinatarios (separados por coma o punto y coma)
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="ej: proveedor@correo.com; otro@correo.com"
                value={manualEmails}
                onChange={(e) => setManualEmails(e.target.value)}
              />
            </label>
          </div>

          <label className="block text-sm">
            Asunto
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block text-sm">
              Cuerpo (HTML)
              <textarea
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                rows={10}
                value={htmlBody}
                onChange={(e) => setHtmlBody(e.target.value)}
              />
              <div className="text-[11px] text-slate-500 mt-1">
                Podés editar el HTML libremente. Debajo ves una vista previa.
              </div>
            </label>
            <div className="text-sm">
              <div className="text-xs text-slate-500 mb-1">Vista previa</div>
              <div
                className="border rounded-lg px-3 py-2 min-h-[180px] bg-slate-50 prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{
                  __html: htmlBody || '<p class="text-slate-400">Escribí el mensaje en el panel izquierdo…</p>',
                }}
              />
            </div>
          </div>

          <div className="pt-2 flex gap-2 justify-end">
            <button
              type="submit"
              disabled={sending}
              className="px-4 py-2 text-sm rounded-lg bg-green-600 text-white disabled:opacity-60"
            >
              {sending ? 'Enviando…' : 'Enviar solicitud de flete'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
