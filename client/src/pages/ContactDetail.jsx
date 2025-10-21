// client/src/pages/ContactDetail.jsx
import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';

function FieldRow({ label, value, children }) {
  return (
    <div className="flex items-start justify-between py-2 border-b last:border-b-0">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="text-sm text-slate-900 text-right min-w-0">
        {children ?? (value || '—')}
      </div>
    </div>
  );
}

function InlineCFEditor({ cf, onSave }) {
  const [v, setV] = useState(cf.value ?? '');
  const [saving, setSaving] = useState(false);
  async function save(){
    setSaving(true);
    try { await onSave(v); } finally { setSaving(false); }
  }
  return (
    <div className="flex items-center gap-2">
      {cf.type === 'number' ? (
        <input type="number" className="border rounded-lg px-2 py-1 text-sm w-40" value={v} onChange={e=>setV(e.target.value)} />
      ) : cf.type === 'date' ? (
        <input type="date" className="border rounded-lg px-2 py-1 text-sm" value={v || ''} onChange={e=>setV(e.target.value)} />
      ) : (
        <input className="border rounded-lg px-2 py-1 text-sm w-48" value={v} onChange={e=>setV(e.target.value)} />
      )}
      <button className="px-2 py-1 text-xs rounded border" onClick={save} disabled={saving}>
        {saving ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  );
}

export default function ContactDetail() {
  const { id } = useParams();
  const [contact, setContact] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  // tabs
  const [tab, setTab] = useState('activity'); // activity | deals | info
  const [composer, setComposer] = useState('');

  // campos personalizados
  const [cfLoading, setCfLoading] = useState(false);
  const [customFields, setCustomFields] = useState([]);
  const [cfSupported, setCfSupported] = useState(true);
  const [openAddCF, setOpenAddCF] = useState(false);

  // modales
  const [openAct, setOpenAct] = useState(false);
  const [openDeal, setOpenDeal] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const [openOrgPicker, setOpenOrgPicker] = useState(false); // 👈 NUEVO

  async function load() {
    const { data } = await api.get(`/contacts/${id}`);
    setContact(data);
  }
  async function loadCFs() {
    setCfLoading(true);
    try {
      const { data } = await api.get(`/contacts/${id}/custom-fields`);
      setCustomFields(Array.isArray(data) ? data : []);
      setCfSupported(true);
    } catch {
      setCustomFields([]);
      setCfSupported(false);
    } finally {
      setCfLoading(false);
    }
  }

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        setLoading(true);
        await load();
        await loadCFs();
      } catch {
        if (!cancel) setErr('No se pudo cargar el contacto.');
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [id]);

  async function saveQuickActivity() {
    const subject = (composer || '').trim();
    if (!subject) return;
    try {
      await api.post('/activities', {
        type: 'task',
        subject,
        person_id: Number(id),
        done: 0,
      });
      setComposer('');
      if (tab !== 'activity') setTab('activity');
      await load();
    } catch {
      alert('No se pudo guardar la actividad.');
    }
  }

  // 👇 NUEVO: quitar vínculo de organización
  async function unlinkOrganization() {
    if (!contact?.org_id) return;
    try {
      await api.patch(`/contacts/${contact.id}`, { org_id: null });
      await load();
    } catch {
      alert('No se pudo quitar la organización.');
    }
  }

  if (loading) return <p className="text-sm text-slate-600">Cargando…</p>;
  if (err) return <p className="text-sm text-red-600">{err}</p>;
  if (!contact) return <p className="text-sm text-slate-600">Contacto no encontrado.</p>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">👤</div>
            <div className="min-w-0">
              <div className="text-xl font-semibold truncate">{contact.name || contact.email || `Contacto #${contact.id}`}</div>
              <div className="text-xs text-slate-600 truncate">
                {contact.title ? `${contact.title}` : ''}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-2 text-sm rounded-lg bg-emerald-600 text-white" onClick={()=>setOpenDeal(true)}>+ Trato</button>
            <button className="px-3 py-2 text-sm rounded-lg border" onClick={()=>setOpenAct(true)}>+ Actividad</button>
            <button className="px-3 py-2 text-sm rounded-lg border" onClick={()=>setOpenEdit(true)}>Editar</button>
          </div>
        </div>
      </div>

      {/* Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
        {/* ===== Sidebar ===== */}
        <aside className="space-y-4">

          {/* 👇 NUEVO: Bloque independiente de Organización */}
          <section className="bg-white rounded-2xl shadow">
            <header className="px-4 py-3 border-b font-medium flex items-center justify-between">
              <span>Organización</span>
              <div className="flex items-center gap-2">
                {contact.org_id && (
                  <button
                    className="text-sm text-slate-600 hover:underline"
                    onClick={unlinkOrganization}
                    title="Quitar vínculo"
                  >
                    Quitar
                  </button>
                )}
                <button
                  className="text-sm text-blue-600 hover:underline"
                  onClick={()=>setOpenOrgPicker(true)}
                >
                  {contact.org_id ? 'Cambiar' : '+ Añadir'}
                </button>
              </div>
            </header>
            <div className="p-4">
              {contact.org_id ? (
                <div className="flex items-center justify-between text-sm">
                  <Link to={`/organizations/${contact.org_id}`} className="text-blue-600 hover:underline">
                    {contact.org_name || `Org #${contact.org_id}`}
                  </Link>
                </div>
              ) : (
                <div className="text-sm text-slate-600">Sin organización vinculada.</div>
              )}
            </div>
          </section>

          {/* Detalles (ya SIN organización) */}
          <section className="bg-white rounded-2xl shadow">
            <header className="px-4 py-3 border-b font-medium flex items-center justify-between">
              <span>Detalles</span>
              <button className="text-sm text-blue-600 hover:underline" onClick={()=>setOpenEdit(true)}>Editar</button>
            </header>
            <div className="p-4 space-y-2">
              <FieldRow label="Email">
                {contact.email ? (
                  <a className="text-blue-600 hover:underline" href={`mailto:${contact.email}`}>{contact.email}</a>
                ) : '—'}
              </FieldRow>
              <FieldRow label="Teléfono" value={contact.phone} />
              <FieldRow label="Cargo" value={contact.title} />
              <FieldRow label="Etiqueta" value={contact.label} />
              <FieldRow label="Notas" value={contact.notes} />
              <FieldRow label="Creado">
                {contact.created_at ? new Date(contact.created_at).toLocaleDateString() : '—'}
              </FieldRow>
            </div>
          </section>

          {/* Campos personalizados */}
          <section className="bg-white rounded-2xl shadow">
            <header className="px-4 py-3 border-b font-medium flex items-center justify-between">
              <span>Campos personalizados</span>
              {cfSupported && (
                <button className="text-sm text-blue-600 hover:underline" onClick={()=>setOpenAddCF(true)}>
                  + Añadir campo
                </button>
              )}
            </header>
            <div className="p-4 space-y-2">
              {!cfSupported && (
                <div className="text-sm text-slate-600">
                  (Endpoint de campos personalizados no disponible).
                </div>
              )}
              {cfSupported && (cfLoading ? (
                <div className="text-sm text-slate-600">Cargando campos…</div>
              ) : customFields.length ? (
                <ul className="space-y-2">
                  {customFields.map(cf => (
                    <li key={cf.id} className="flex items-center justify-between gap-2">
                      <div className="text-sm">
                        <div className="font-medium">{cf.label || cf.key}</div>
                        <div className="text-slate-600 text-xs">{cf.type || 'text'} • {cf.key}</div>
                      </div>
                      <InlineCFEditor
                        cf={cf}
                        onSave={async (newValue)=>{
                          try {
                            await api.put(`/contacts/${id}/custom-fields/${cf.id}`, { value: newValue });
                            await loadCFs();
                          } catch {
                            alert('No se pudo guardar el campo.');
                          }
                        }}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-slate-600">No hay campos personalizados.</div>
              ))}
            </div>
          </section>
        </aside>

        {/* ===== Panel principal ===== */}
        <section className="space-y-4">
          <div className="bg-white rounded-2xl shadow">
            {/* Tabs */}
            <div className="px-4 pt-3 border-b">
              <div className="flex items-center gap-2">
                {[
                  { key: 'activity', label: 'Actividad', icon: '📅' },
                  { key: 'deals',    label: 'Tratos',    icon: '💼' },
                  { key: 'info',     label: 'Info',      icon: 'ℹ️' },
                ].map(t => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`px-3 py-2 rounded-t-lg text-sm ${tab === t.key ? 'bg-black text-white' : 'hover:bg-slate-100'}`}
                  >
                    <span className="mr-1">{t.icon}</span>{t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Composer actividad rápida */}
            {tab === 'activity' && (
              <div className="p-4 border-b">
                <textarea
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  rows={2}
                  placeholder="Añadir una actividad rápida…"
                  value={composer}
                  onChange={(e)=>setComposer(e.target.value)}
                />
                <div className="mt-2 flex items-center gap-2">
                  <button className="px-3 py-2 text-sm rounded-lg bg-black text-white" onClick={saveQuickActivity}>Guardar</button>
                  <button className="px-3 py-2 text-sm rounded-lg border" onClick={()=>setComposer('')}>Cancelar</button>
                </div>
              </div>
            )}

            {/* Contenido */}
            <div className="p-4">
              {tab === 'activity' && (
                <div className="space-y-3">
                  <button className="text-blue-600 hover:underline text-sm" onClick={()=>setOpenAct(true)}>
                    + Programar una actividad
                  </button>

                  <h4 className="mt-4 font-medium">Historial</h4>
                  {contact.activities?.length ? (
                    <ul className="space-y-2">
                      {contact.activities.map(a => (
                        <li key={a.id} className="border rounded-xl p-3">
                          <div className="text-sm font-medium">{a.type || 'actividad'} — {a.subject || 'sin asunto'}</div>
                          <div className="text-xs text-slate-600">
                            Vence: {a.due_date || '—'} • Creado: {a.created_at ? new Date(a.created_at).toLocaleDateString() : '—'}
                          </div>
                          {a.notes && <div className="text-sm mt-1">{a.notes}</div>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-sm text-slate-500">Sin actividades.</div>
                  )}
                </div>
              )}

              {tab === 'deals' && (
                <div className="space-y-2">
                  {contact.deals?.length ? (
                    <ul className="space-y-2">
                      {contact.deals.map(d => (
                        <li key={d.id} className="flex items-center justify-between border rounded-xl p-3 text-sm">
                          <div className="min-w-0">
                            <div className="font-medium truncate">{d.title}</div>
                            <div className="text-xs text-slate-600">
                              {d.org_name ? `Org: ${d.org_name}` : '—'}
                            </div>
                          </div>
                          <div className="text-slate-700">${Number(d.value || 0).toLocaleString()}</div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-sm text-slate-500">Sin tratos vinculados.</div>
                  )}
                </div>
              )}

              {tab === 'info' && (
                <div className="text-sm text-slate-600">
                  ID: {contact.id} • Visibilidad: {contact.visibility || 'company'} • Owner: {contact.owner_user_id || '—'}
                </div>
              )}
            </div>
          </div>

          <div>
            <Link to="/contacts" className="text-blue-600 hover:underline">← Volver a lista</Link>
          </div>
        </section>
      </div>

      {/* Modales */}
      {openAct && (
        <NewActivityModal
          personId={id}
          onClose={()=>setOpenAct(false)}
          onCreated={async ()=>{ await load(); }}
        />
      )}
      {openDeal && (
        <NewDealModal
          contact={contact}
          onClose={()=>setOpenDeal(false)}
          onCreated={async ()=>{ await load(); }}
        />
      )}
      {openEdit && (
        <EditContactModal
          contact={contact}
          onClose={()=>setOpenEdit(false)}
          onSaved={async ()=>{ await load(); }}
        />
      )}
      {openAddCF && (
        <AddCustomFieldModal
          personId={id}
          onClose={()=>setOpenAddCF(false)}
          onCreated={async ()=>{ await loadCFs(); }}
        />
      )}
      {openOrgPicker && (
        <PickOrganizationModal
          currentOrgId={contact.org_id}
          onClose={()=>setOpenOrgPicker(false)}
          onPicked={async (orgId)=> {
            await api.patch(`/contacts/${contact.id}`, { org_id: orgId });
            await load();
            setOpenOrgPicker(false);
          }}
        />
      )}
    </div>
  );
}

/* ===== Modal: Nueva actividad ===== */
function NewActivityModal({ personId, onClose, onCreated }) {
  const [type, setType] = useState('task');
  const [subject, setSubject] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e){
    e.preventDefault();
    setErr('');
    if (!subject.trim() && !notes.trim()) {
      setErr('Escribí al menos asunto o notas.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/activities', {
        type,
        subject: subject.trim(),
        due_date: dueDate || null,
        done: 0,
        person_id: Number(personId),
        notes: notes || null
      });
      onCreated?.();
      onClose?.();
    } catch {
      setErr('No se pudo crear la actividad.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <form onSubmit={submit} className="bg-white rounded-2xl p-4 w-full max-w-lg space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Nueva actividad</h3>
          <button type="button" onClick={onClose} className="text-sm">✕</button>
        </div>

        {err && <div className="text-sm text-red-600">{err}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block text-sm">Tipo
            <select className="w-full border rounded-lg px-3 py-2" value={type} onChange={e=>setType(e.target.value)}>
              <option value="task">Tarea</option>
              <option value="call">Llamada</option>
              <option value="meeting">Reunión</option>
              <option value="email">Email</option>
              <option value="note">Nota</option>
            </select>
          </label>
          <label className="block text-sm">Vence (YYYY-MM-DD)
            <input className="w-full border rounded-lg px-3 py-2" type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} />
          </label>
        </div>

        <label className="block text-sm">Asunto
          <input className="w-full border rounded-lg px-3 py-2" value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Ej: Llamar para propuesta" />
        </label>

        <label className="block text-sm">Notas
          <textarea className="w-full border rounded-lg px-3 py-2" rows={4} value={notes} onChange={e=>setNotes(e.target.value)} />
        </label>

        <div className="pt-2 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 border rounded-lg">Cancelar</button>
          <button className="px-3 py-2 rounded-lg bg-black text-white disabled:opacity-60" disabled={saving}>
            {saving ? 'Guardando…' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ===== Modal: Nuevo trato ===== */
function NewDealModal({ contact, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [stageId, setStageId] = useState('');
  const [pipelines, setPipelines] = useState([]);
  const [stages, setStages] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const { data: p } = await api.get('/pipelines');
        if (!cancel) {
          const list = Array.isArray(p) ? p : [];
          setPipelines(list);
          const pid = list?.[0]?.id ? String(list[0].id) : '';
          setPipelineId(pid);
        }
      } catch {}
    })();
    return () => { cancel = true; };
  }, []);

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!pipelineId) { setStages([]); setStageId(''); return; }
      try {
        const { data: s } = await api.get(`/pipelines/${pipelineId}/stages`);
        if (!cancel) {
          const list = Array.isArray(s) ? s : [];
          setStages(list);
          setStageId(list?.[0]?.id ? String(list[0].id) : '');
        }
      } catch {}
    })();
    return () => { cancel = true; };
  }, [pipelineId]);

  async function submit(e){
    e.preventDefault();
    setErr('');
    if (!title.trim() || !stageId || !pipelineId) {
      setErr('Completá título, pipeline y etapa.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/deals', {
        title: title.trim(),
        value: value ? Number(value) : 0,
        pipeline_id: Number(pipelineId),
        stage_id: Number(stageId),
        contact: { id: Number(contact.id) },
        organization: contact.org_id ? { id: Number(contact.org_id) } : undefined,
      });
      onCreated?.();
      onClose?.();
    } catch {
      setErr('No se pudo crear el trato.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <form onSubmit={submit} className="bg-white rounded-2xl p-4 w-full max-w-lg space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Nuevo trato</h3>
          <button type="button" onClick={onClose} className="text-sm">✕</button>
        </div>

        {err && <div className="text-sm text-red-600">{err}</div>}

        <label className="block text-sm">Título
          <input className="w-full border rounded-lg px-3 py-2" value={title} onChange={e=>setTitle(e.target.value)} />
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block text-sm">Valor
            <input className="w-full border rounded-lg px-3 py-2" type="number" min="0"
              value={value} onChange={e=>setValue(e.target.value)} />
          </label>

          <label className="block text-sm">Pipeline
            <select className="w-full border rounded-lg px-3 py-2"
              value={pipelineId} onChange={e=>setPipelineId(e.target.value)}>
              <option value="">Seleccionar…</option>
              {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>

        <label className="block text-sm">Etapa
          <select className="w-full border rounded-lg px-3 py-2"
            value={stageId} onChange={e=>setStageId(e.target.value)} disabled={!stages.length}>
            <option value="">Seleccionar…</option>
            {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>

        <div className="pt-2 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 border rounded-lg">Cancelar</button>
          <button className="px-3 py-2 rounded-lg bg-black text-white disabled:opacity-60" disabled={saving}>
            {saving ? 'Guardando…' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ===== Modal: Editar contacto ===== */
function EditContactModal({ contact, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: contact.name || '',
    email: contact.email || '',
    phone: contact.phone || '',
    title: contact.title || '',
    org_id: contact.org_id || '', // solo para visualizar; el cambio real se hace en el bloque Organización
    label: contact.label || '',
    owner_user_id: contact.owner_user_id || '',
    visibility: contact.visibility || 'company',
    notes: contact.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function upd(k, v){ setForm(prev=>({ ...prev, [k]: v })); }

  async function submit(e){
    e.preventDefault();
    setErr(''); setSaving(true);
    try {
      const payload = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, v === '' ? null : v])
      );
      if (payload?.owner_user_id != null) {
        const n = Number(payload.owner_user_id);
        payload.owner_user_id = Number.isFinite(n) && n > 0 ? n : null;
      }
      // ⚠️ org_id no se modifica aquí; se gestiona en el bloque Organización

      await api.patch(`/contacts/${contact.id}`, {
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        title: payload.title,
        label: payload.label,
        owner_user_id: payload.owner_user_id,
        visibility: payload.visibility,
        notes: payload.notes,
      });
      onSaved?.();
      onClose?.();
    } catch {
      setErr('No se pudo guardar los cambios.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <form onSubmit={submit} className="bg-white rounded-2xl p-4 w-full max-w-2xl space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Editar contacto</h3>
          <button type="button" onClick={onClose} className="text-sm">✕</button>
        </div>

        {err && <div className="text-sm text-red-600">{err}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block text-sm">Nombre
            <input className="w-full border rounded-lg px-3 py-2" value={form.name} onChange={e=>upd('name', e.target.value)} />
          </label>
          <label className="block text-sm">Email
            <input className="w-full border rounded-lg px-3 py-2" value={form.email} onChange={e=>upd('email', e.target.value)} />
          </label>

          <label className="block text-sm">Teléfono
            <input className="w-full border rounded-lg px-3 py-2" value={form.phone} onChange={e=>upd('phone', e.target.value)} />
          </label>
          <label className="block text-sm">Cargo
            <input className="w-full border rounded-lg px-3 py-2" value={form.title} onChange={e=>upd('title', e.target.value)} />
          </label>

          <label className="block text-sm">Etiqueta
            <input className="w-full border rounded-lg px-3 py-2" value={form.label} onChange={e=>upd('label', e.target.value)} />
          </label>

          <label className="block text-sm">Owner (ID de usuario)
            <input className="w-full border rounded-lg px-3 py-2" value={form.owner_user_id ?? ''} onChange={e=>upd('owner_user_id', e.target.value)} />
          </label>
          <label className="block text-sm">Visibilidad
            <select className="w-full border rounded-lg px-3 py-2" value={form.visibility} onChange={e=>upd('visibility', e.target.value)}>
              <option value="company">company</option>
              <option value="shared">shared</option>
              <option value="private">private</option>
            </select>
          </label>
        </div>

        <label className="block text-sm">Notas
          <textarea className="w-full border rounded-lg px-3 py-2" rows={4} value={form.notes ?? ''} onChange={e=>upd('notes', e.target.value)} />
        </label>

        <div className="pt-2 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 border rounded-lg">Cancelar</button>
          <button className="px-3 py-2 rounded-lg bg-black text-white disabled:opacity-60" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ===== Modal: Añadir campo personalizado ===== */
function AddCustomFieldModal({ personId, onClose, onCreated }) {
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [type, setType] = useState('text'); // text | number | date
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e){
    e.preventDefault();
    setErr('');
    if (!key.trim() || !label.trim()) {
      setErr('Completá clave y etiqueta.');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/contacts/${personId}/custom-fields`, {
        key: key.trim(),
        label: label.trim(),
        type,
        value: value ?? null
      });
      onCreated?.();
      onClose?.();
    } catch {
      setErr('No se pudo crear el campo (verifica que el endpoint exista).');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <form onSubmit={submit} className="bg-white rounded-2xl p-4 w-full max-w-lg space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Nuevo campo personalizado</h3>
          <button type="button" onClick={onClose} className="text-sm">✕</button>
        </div>

        {err && <div className="text-sm text-red-600">{err}</div>}

        <label className="block text-sm">Etiqueta visible
          <input className="w-full border rounded-lg px-3 py-2" value={label} onChange={e=>setLabel(e.target.value)} />
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block text-sm">Clave (sin espacios)
            <input className="w-full border rounded-lg px-3 py-2" value={key} onChange={e=>setKey(e.target.value)} placeholder="ej: secondary_email" />
          </label>
          <label className="block text-sm">Tipo
            <select className="w-full border rounded-lg px-3 py-2" value={type} onChange={e=>setType(e.target.value)}>
              <option value="text">Texto</option>
              <option value="number">Número</option>
              <option value="date">Fecha</option>
            </select>
          </label>
        </div>

        <label className="block text-sm">Valor inicial
          <input className="w-full border rounded-lg px-3 py-2" value={value} onChange={e=>setValue(e.target.value)} />
        </label>

        <div className="pt-2 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 border rounded-lg">Cancelar</button>
          <button className="px-3 py-2 rounded-lg bg-black text-white disabled:opacity-60" disabled={saving}>
            {saving ? 'Guardando…' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ===== Modal: Elegir/Cambiar organización (buscar o crear) ===== */
function PickOrganizationModal({ currentOrgId, onClose, onPicked }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!q.trim()) { setResults([]); return; }
      try {
        const { data } = await api.get('/organizations', { params: { q } });
        if (!cancel) setResults((Array.isArray(data) ? data : []).slice(0, 20));
      } catch {}
    })();
    return () => { cancel = true; };
  }, [q]);

  async function createAndPick(){
    if (!q.trim()) return;
    setCreating(true);
    try {
      const { data } = await api.post('/organizations', { name: q.trim() });
      await onPicked?.(data.id);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-4 w-full max-w-lg space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Seleccionar organización</h3>
          <button type="button" onClick={onClose} className="text-sm">✕</button>
        </div>

        <input
          className="w-full border rounded-lg px-3 py-2"
          placeholder="Buscar o escribir un nombre para crear…"
          value={q}
          onChange={(e)=>setQ(e.target.value)}
        />

        <div className="max-h-64 overflow-auto border rounded">
          {!results.length ? (
            <div className="p-3 text-sm text-slate-600">Sin resultados.</div>
          ) : results.map(o => (
            <div
              key={o.id}
              className={`px-3 py-2 text-sm cursor-pointer hover:bg-slate-100 ${currentOrgId === o.id ? 'bg-emerald-50' : ''}`}
              onClick={()=>onPicked?.(o.id)}
            >
              {o.name} <span className="text-slate-500">{o.industry || ''}</span>
            </div>
          ))}
        </div>

        <div className="pt-2 flex items-center justify-between">
          <button className="px-3 py-2 border rounded-lg" onClick={onClose}>Cancelar</button>
          <button className="px-3 py-2 rounded-lg bg-black text-white disabled:opacity-60"
                  onClick={createAndPick} disabled={creating || !q.trim()}>
            {creating ? 'Creando…' : 'Crear y vincular'}
          </button>
        </div>
      </div>
    </div>
  );
}
