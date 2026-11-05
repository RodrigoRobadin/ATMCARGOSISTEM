import React, { useEffect, useRef, useState } from 'react';
import { FileSignature, PackageCheck, Plus, RefreshCw } from 'lucide-react';
import { api } from '../../api';

const statusLabels = {
  sending: 'Enviando', processing: 'Procesando', review: 'Requiere revisión',
  approved: 'Aprobada', rejected: 'Rechazada',
};

const inputClass = 'w-full rounded border border-slate-300 bg-white px-2.5 py-2 text-sm';
const labelClass = 'block text-xs font-medium text-slate-600 mb-1';

function today() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function field(label, value, onChange, props = {}) {
  return <label className="block min-w-0"><span className={labelClass}>{label}</span>
    <input className={inputClass} value={value ?? ''} onChange={(event) => onChange(event.target.value)} {...props} />
  </label>;
}

function select(label, value, options, onChange) {
  return <label className="block min-w-0"><span className={labelClass}>{label}</span>
    <select className={inputClass} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
    </select>
  </label>;
}

function geographySelect(label, value, options, onChange, disabled) {
  return <label className="block min-w-0"><span className={labelClass}>{label}</span>
    <select className={inputClass} value={value || ''} onChange={(event) => onChange(event.target.value)}
      required disabled={disabled}>
      <option value="">Seleccionar {label.toLowerCase()}</option>
      {options.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
    </select>
  </label>;
}

function LocationFields({ title, value, onChange, geography }) {
  const districts = geography?.districts.filter(([, department]) => String(department) === String(value.department)) || [];
  const cities = geography?.cities.filter(([, district]) => String(district) === String(value.district)) || [];
  return <fieldset className="border-t border-slate-200 pt-3">
    <legend className="text-sm font-semibold text-slate-800">{title}</legend>
    <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {field('Dirección', value.address, (v) => onChange('address', v))}
      {field('N.º de casa', value.house_number, (v) => onChange('house_number', v))}
      {field('Teléfono', value.phone, (v) => onChange('phone', v))}
      {geographySelect('Departamento', value.department, geography?.departments || [], (v) => onChange('department', v), !geography)}
      {geographySelect('Distrito', value.district, districts.map(([code, , name]) => [code, name]), (v) => onChange('district', v), !value.department || !geography)}
      {geographySelect('Ciudad', value.city, cities.map(([code, , name]) => [code, name]), (v) => onChange('city', v), !value.district || !geography)}
    </div>
  </fieldset>;
}

function editableLocation(location) {
  return { address: location.direccion || '', house_number: location.numCasa || '0',
    phone: location.telefono || '', department: location.departamento || '',
    district: location.distrito || '', city: location.ciudad || '' };
}

function editableDraft(draft, dealId, serviceCaseId) {
  const t = draft.transport;
  return { deal_id: dealId || null, service_case_id: serviceCaseId || null,
    invoice_id: draft.invoice_id || '', description: draft.description,
    reason_code: String(draft.reason_code), issuer_responsible_code: String(draft.issuer_responsible_code),
    estimated_km: String(draft.estimated_km), estimated_invoice_date: draft.estimated_invoice_date || today(),
    customer: { ...editableLocation(draft.customer), ruc: draft.customer.ruc,
      name: draft.customer.name, email: draft.customer.email || '' },
    items: draft.items.map((item) => ({ description: item.description, code: item.code,
      quantity: String(item.quantity), unit_code: String(item.unit_code) })),
    transport: { type: String(t.type), modality: String(t.modality), responsible: String(t.responsible),
      departure_date: t.departure_date, delivery_date: t.delivery_date,
      origin: editableLocation(t.origin), destination: editableLocation(t.destination),
      vehicle: { ...t.vehicle, type: String(t.vehicle.type), document_type: String(t.vehicle.document_type) },
      carrier: { ...t.carrier, type: String(t.carrier.type), document_type: String(t.carrier.document_type) } },
  };
}

function DraftModal({ dealId, serviceCaseId, invoices, operationItems, initialDraft, onClose, onCreated }) {
  const [form, setForm] = useState(() => initialDraft ? editableDraft(initialDraft, dealId, serviceCaseId) : ({
    deal_id: dealId || null, service_case_id: serviceCaseId || null,
    invoice_id: '', description: 'Entrega de mercadería', reason_code: '1',
    issuer_responsible_code: '1', estimated_km: '', estimated_invoice_date: today(),
    customer: { ruc: '', name: '', email: '', address: '', house_number: '0', phone: '', department: '', district: '', city: '' },
    items: [{ description: '', code: '', quantity: '1', unit_code: '77' }],
    transport: {
      type: '1', modality: '1', responsible: '1', departure_date: today(), delivery_date: today(),
      origin: { address: '', house_number: '0', phone: '', department: '', district: '', city: '' },
      destination: { address: '', house_number: '0', phone: '', department: '', district: '', city: '' },
      vehicle: { type: '1', make: '', document_type: '2', number: '' },
      carrier: { type: '2', name: '', document_type: '1', document_number: '', address: '',
        driver_name: '', driver_document: '', driver_address: '' },
    },
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [geography, setGeography] = useState(null);

  useEffect(() => {
    api.get('/remissions/geography')
      .then(({ data }) => setGeography(data))
      .catch(() => setError('No se pudo cargar el catálogo geográfico SIFEN'));
  }, []);

  useEffect(() => {
    if (initialDraft) return;
    api.get('/remissions/context', { params: { deal_id: dealId, service_case_id: serviceCaseId } })
      .then(({ data }) => setForm((old) => ({ ...old, customer: { ...old.customer,
        ruc: data.ruc || '', name: data.org_name || '', email: data.email || '', address: data.address || '' },
        transport: { ...old.transport, destination: { ...old.transport.destination, address: data.address || '' } } })))
      .catch((err) => setError(err.response?.data?.error || 'No se pudo cargar el cliente'));
  }, [dealId, serviceCaseId, initialDraft]);

  function setTop(key, value) { setForm((old) => ({ ...old, [key]: value })); }
  function setNested(section, key, value) { setForm((old) => ({ ...old, [section]: { ...old[section], [key]: value } })); }
  function setLocation(section, key, value) {
    setForm((old) => {
      const current = section === 'customer' ? old.customer : old.transport[section];
      const updated = { ...current, [key]: value };
      if (key === 'department') { updated.district = ''; updated.city = ''; }
      if (key === 'district') updated.city = '';
      return section === 'customer' ? { ...old, customer: updated } :
        { ...old, transport: { ...old.transport, [section]: updated } };
    });
  }
  function setTransport(section, key, value) {
    setForm((old) => ({ ...old, transport: { ...old.transport,
      [section]: { ...old.transport[section], [key]: value } } }));
  }
  async function save(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await api.post('/remissions', form);
      onCreated();
    } catch (err) { setError(err.response?.data?.error || 'No se pudo crear la remisión'); }
    finally { setBusy(false); }
  }

  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3" role="dialog" aria-modal="true" aria-label="Nueva nota de remisión">
    <div className="max-h-[95vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white p-4 shadow-xl md:p-6">
      <div className="flex items-center justify-between gap-3 border-b pb-3">
        <h3 className="text-lg font-semibold">{initialDraft ? 'Nueva nota corregida' : 'Nueva nota de remisión'}</h3>
        <button type="button" onClick={onClose} className="text-slate-600">Cerrar</button>
      </div>
      <form onSubmit={save} className="mt-4 space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {field('Descripción', form.description, (v) => setTop('description', v), { required: true })}
          {select('Motivo', form.reason_code, [['1', 'Traslado por venta'], ['2', 'Consignación'], ['3', 'Exportación'], ['4', 'Traslado por compra'], ['5', 'Importación'], ['6', 'Devolución'], ['7', 'Entre locales de la empresa'], ['9', 'Reparación'], ['11', 'Demostración'], ['99', 'Otro']], (v) => setTop('reason_code', v))}
          {field('Kilómetros estimados', form.estimated_km, (v) => setTop('estimated_km', v), { type: 'number', min: 0, required: true })}
          {select('Factura asociada', form.invoice_id, [['', 'Sin factura'], ...invoices.map((i) => [String(i.id), `${i.number} · ${i.fiscal_mode === 'electronic' ? 'Electrónica' : 'Autoimpresa'}`])], (v) => setTop('invoice_id', v))}
          {!form.invoice_id && field('Fecha estimada de factura', form.estimated_invoice_date, (v) => setTop('estimated_invoice_date', v), { type: 'date', required: true })}
          {select('Responsable de emisión', form.issuer_responsible_code, [['1', 'Emisor'], ['2', 'Poseedor'], ['3', 'Transportista'], ['4', 'Despachante'], ['5', 'Agente de transporte']], (v) => setTop('issuer_responsible_code', v))}
        </div>
        <fieldset className="border-t pt-3"><legend className="text-sm font-semibold">Mercadería que sale</legend>
          {operationItems.length > 0 && <label className="mt-2 block text-sm"><span className={labelClass}>Agregar desde la operación</span>
            <select className={inputClass} value="" onChange={(e) => {
              const source = operationItems.find((item) => String(item.source_item_key) === e.target.value);
              if (!source) return;
              const next = { description: source.description || '', code: String(source.source_item_key || '').slice(0, 50),
                quantity: String(source.quantity || 1), unit_code: '77' };
              setTop('items', form.items.length === 1 && !form.items[0].description ? [next] : [...form.items, next]);
            }}><option value="">Seleccionar artículo</option>{operationItems.map((item) =>
              <option key={item.source_item_key} value={item.source_item_key}>{item.description}</option>)}</select>
          </label>}
          <div className="space-y-2 mt-2">{form.items.map((item, index) => <div key={index} className="grid gap-2 sm:grid-cols-[2fr_1fr_90px_90px_auto]">
            {field('Descripción', item.description, (v) => setTop('items', form.items.map((i, n) => n === index ? { ...i, description: v } : i)), { required: true })}
            {field('Código', item.code, (v) => setTop('items', form.items.map((i, n) => n === index ? { ...i, code: v } : i)), { required: true })}
            {field('Cantidad', item.quantity, (v) => setTop('items', form.items.map((i, n) => n === index ? { ...i, quantity: v } : i)), { type: 'number', min: 0.001, step: 'any', required: true })}
            {field('Unidad SIFEN', item.unit_code, (v) => setTop('items', form.items.map((i, n) => n === index ? { ...i, unit_code: v } : i)), { type: 'number', required: true })}
            <button type="button" className="self-end py-2 text-sm text-red-600" disabled={form.items.length === 1} onClick={() => setTop('items', form.items.filter((_, n) => n !== index))}>Quitar</button>
          </div>)}</div>
          <button type="button" className="mt-2 text-sm text-emerald-700" onClick={() => setTop('items', [...form.items, { description: '', code: '', quantity: '1', unit_code: '77' }])}>+ Agregar artículo</button>
        </fieldset>
        <fieldset className="border-t pt-3"><legend className="text-sm font-semibold">Destinatario</legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {field('RUC', form.customer.ruc, (v) => setNested('customer', 'ruc', v), { required: true })}
            {field('Nombre', form.customer.name, (v) => setNested('customer', 'name', v), { required: true })}
            {field('Correo', form.customer.email, (v) => setNested('customer', 'email', v))}
          </div>
          <LocationFields title="Ubicación del destinatario" value={form.customer} geography={geography} onChange={(k, v) => setLocation('customer', k, v)} />
        </fieldset>
        <fieldset className="border-t pt-3"><legend className="text-sm font-semibold">Transporte</legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {select('Tipo', form.transport.type, [['1', 'Propio'], ['2', 'Tercero']], (v) => setNested('transport', 'type', v))}
            {select('Modalidad', form.transport.modality, [['1', 'Terrestre'], ['2', 'Fluvial'], ['3', 'Aéreo']], (v) => setNested('transport', 'modality', v))}
            {select('Costo a cargo de', form.transport.responsible, [['1', 'Emisor'], ['2', 'Receptor'], ['3', 'Tercero']], (v) => setNested('transport', 'responsible', v))}
            {field('Salida estimada', form.transport.departure_date, (v) => setNested('transport', 'departure_date', v), { type: 'date', required: true })}
            {field('Entrega estimada', form.transport.delivery_date, (v) => setNested('transport', 'delivery_date', v), { type: 'date', required: true })}
          </div>
        </fieldset>
        <LocationFields title="Lugar de salida" value={form.transport.origin} geography={geography} onChange={(k, v) => setLocation('origin', k, v)} />
        <LocationFields title="Lugar de entrega" value={form.transport.destination} geography={geography} onChange={(k, v) => setLocation('destination', k, v)} />
        <fieldset className="border-t pt-3"><legend className="text-sm font-semibold">Vehículo y transportista</legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {select('Vehículo', form.transport.vehicle.type, [['1', 'Vehículo'], ['2', 'Moto']], (v) => setTransport('vehicle', 'type', v))}
            {field('Marca', form.transport.vehicle.make, (v) => setTransport('vehicle', 'make', v), { required: true, maxLength: 10 })}
            {select('Identificación', form.transport.vehicle.document_type, [['1', 'N.º de identificación'], ['2', 'Matrícula']], (v) => setTransport('vehicle', 'document_type', v))}
            {field('N.º de identificación', form.transport.vehicle.number, (v) => setTransport('vehicle', 'number', v), { required: true })}
            {select('Tipo de transportista', form.transport.carrier.type, [['1', 'Contribuyente'], ['2', 'No contribuyente']], (v) => setTransport('carrier', 'type', v))}
            {field('Nombre del transportista', form.transport.carrier.name, (v) => setTransport('carrier', 'name', v), { required: true, minLength: 4, maxLength: 60 })}
            {select('Documento del transportista', form.transport.carrier.document_type, [['1', 'Cédula paraguaya'], ['2', 'Pasaporte'], ['3', 'Cédula extranjera'], ['4', 'Carnet de residencia']], (v) => setTransport('carrier', 'document_type', v))}
            {field('Documento del transportista', form.transport.carrier.document_number, (v) => setTransport('carrier', 'document_number', v), { required: true })}
            {field('Dirección del transportista', form.transport.carrier.address, (v) => setTransport('carrier', 'address', v), { required: true })}
            {field('Chofer', form.transport.carrier.driver_name, (v) => setTransport('carrier', 'driver_name', v), { required: true, minLength: 4, maxLength: 60 })}
            {field('Documento del chofer', form.transport.carrier.driver_document, (v) => setTransport('carrier', 'driver_document', v), { required: true })}
            {field('Dirección del chofer', form.transport.carrier.driver_address, (v) => setTransport('carrier', 'driver_address', v), { required: true })}
          </div>
        </fieldset>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t pt-3"><button type="button" onClick={onClose} className="rounded border px-3 py-2 text-sm">Cancelar</button>
          <button type="submit" disabled={busy} className="rounded bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Guardando...' : 'Guardar borrador'}</button>
        </div>
      </form>
    </div>
  </div>;
}

function SignatureCanvas({ canvasRef, onDraw }) {
  const drawing = useRef(false);
  function point(event) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height };
  }
  function down(event) {
    const canvas = canvasRef.current;
    canvas.setPointerCapture(event.pointerId);
    const p = point(event);
    const ctx = canvas.getContext('2d');
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.1, p.y + 0.1); ctx.stroke();
    drawing.current = { x: p.x, y: p.y, distance: 0 };
  }
  function move(event) {
    if (!drawing.current) return;
    const p = point(event);
    const ctx = canvasRef.current.getContext('2d');
    ctx.lineTo(p.x, p.y); ctx.stroke();
    drawing.current.distance += Math.hypot(p.x - drawing.current.x, p.y - drawing.current.y);
    drawing.current.x = p.x; drawing.current.y = p.y;
    if (drawing.current.distance > 20) onDraw();
  }
  return <canvas ref={(node) => {
    canvasRef.current = node;
    if (node && !node.dataset.ready) {
      node.dataset.ready = '1';
      const ctx = node.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, node.width, node.height);
      ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    }
  }} width={640} height={180} className="w-full rounded border border-slate-300 bg-white touch-none"
    onPointerDown={down} onPointerMove={move} onPointerUp={() => { drawing.current = false; }}
    onPointerCancel={() => { drawing.current = false; }} aria-label="Área de firma del receptor" />;
}

async function imageFileToPng(file) {
  if (!file?.type.startsWith('image/') || file.size > 8 * 1024 * 1024) throw new Error('Elegí una imagen menor a 8 MB');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const result = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!result || result.size > 1048576) throw new Error('La imagen es demasiado grande; comprimila antes de adjuntar');
    return result;
  } finally { bitmap.close(); }
}

function DeliveryModal({ row, onClose, onSaved }) {
  const canvasRef = useRef(null);
  const [hasInk, setHasInk] = useState(false);
  const [paper, setPaper] = useState(null);
  const [form, setForm] = useState({ received_at: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16), receiver_name: '',
    receiver_document: '', outcome: 'conforme', notes: '',
    items: row.draft.items.map((item) => ({ quantity: item.quantity,
      condition_status: 'buen_estado', condition_description: 'Entregado en buen estado' })) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const body = new FormData();
      body.append('received_at', new Date(form.received_at).toISOString());
      body.append('receiver_name', form.receiver_name);
      body.append('receiver_document', form.receiver_document);
      body.append('outcome', form.outcome);
      body.append('notes', form.notes);
      body.append('items', JSON.stringify(form.items));
      if (hasInk) {
        const signature = await new Promise((resolve) => canvasRef.current.toBlob(resolve, 'image/png'));
        body.append('signature_png', signature, 'firma.png');
      }
      if (paper) body.append('paper_png', paper, 'nota-firmada.png');
      await api.post(`/remissions/${row.id}/delivery`, body);
      onSaved();
    } catch (err) { setError(err.response?.data?.error || 'No se pudo registrar la recepción'); }
    finally { setBusy(false); }
  }
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3" role="dialog" aria-modal="true" aria-label="Registrar recepción">
    <form onSubmit={save} className="max-h-[95vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-5 space-y-4 shadow-xl">
      <h3 className="text-lg font-semibold">Recepción de {row.document_number}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {field('Fecha y hora reales', form.received_at, (v) => setForm((f) => ({ ...f, received_at: v })), { type: 'datetime-local', required: true })}
        {select('Resultado', form.outcome, [['conforme', 'Recibida conforme'], ['con_observaciones', 'Con observaciones'], ['no_entregada', 'No entregada']], (v) => setForm((f) => ({ ...f, outcome: v })))}
        {field('Nombre de quien recibe', form.receiver_name, (v) => setForm((f) => ({ ...f, receiver_name: v })), { required: true })}
        {field('Documento de quien recibe', form.receiver_document, (v) => setForm((f) => ({ ...f, receiver_document: v })), { required: true })}
      </div>
      <div><div className="text-sm font-medium mb-2">Mercadería recibida</div>
        {row.draft.items.map((item, index) => <div key={index} className="grid gap-2 border-b border-slate-200 py-3 last:border-b-0 sm:grid-cols-[110px_1fr]">
          <div className="text-sm font-medium text-slate-800">{item.description}<div className="text-xs font-normal text-slate-500">Salió {item.quantity}</div></div>
          <div className="grid gap-2 sm:grid-cols-[88px_1fr]">
            {field('Recibido', form.items[index].quantity, (v) => setForm((f) => ({ ...f,
              items: f.items.map((i, n) => {
                if (n !== index) return i;
                const status = Number(v) === 0 ? 'no_recibido' : Number(v) < item.quantity ? 'con_observaciones' : i.condition_status === 'no_recibido' ? 'buen_estado' : i.condition_status;
                const defaults = { buen_estado: 'Entregado en buen estado', con_observaciones: 'Entregado con observaciones', no_recibido: 'No recibido' };
                const description = Object.values(defaults).includes(i.condition_description) ? defaults[status] : i.condition_description;
                return { ...i, quantity: v, condition_status: status, condition_description: description };
              }), outcome: Number(v) < item.quantity ? 'con_observaciones' : f.outcome,
            })), { type: 'number', min: 0, max: item.quantity, step: 'any', required: true })}
            {select('Estado', form.items[index].condition_status,
              [['buen_estado', 'Buen estado'], ['con_observaciones', 'Con observaciones'], ['no_recibido', 'No recibido']],
              (v) => setForm((f) => ({ ...f, outcome: v === 'buen_estado' ? f.outcome : 'con_observaciones',
                items: f.items.map((i, n) => n === index ? { ...i, condition_status: v,
                  condition_description: ['Entregado en buen estado', 'Entregado con observaciones', 'No recibido'].includes(i.condition_description)
                    ? ({ buen_estado: 'Entregado en buen estado', con_observaciones: 'Entregado con observaciones', no_recibido: 'No recibido' })[v] : i.condition_description,
                  quantity: v === 'no_recibido' ? 0 : i.quantity } : i) })))}
            <div className="sm:col-span-2">
              {field('Descripción del estado (editable)', form.items[index].condition_description,
                (v) => setForm((f) => ({ ...f, items: f.items.map((i, n) => n === index ? { ...i, condition_description: v } : i) })),
                { required: true, maxLength: 500 })}
            </div>
          </div>
        </div>)}
      </div>
      <label className="block"><span className={labelClass}>Observaciones y estado de la mercadería</span>
        <textarea className={inputClass} rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></label>
      <div><div className="text-sm font-medium mb-1">Firma en pantalla</div>
        <SignatureCanvas canvasRef={canvasRef} onDraw={() => setHasInk(true)} />
        <button type="button" className="mt-1 text-xs text-slate-600 underline" onClick={() => {
          const canvas = canvasRef.current; const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.strokeStyle = '#0f172a'; setHasInk(false);
        }}>Borrar firma</button>
      </div>
      <label className="block text-sm">O adjuntar foto de la nota firmada en papel
        <input className="mt-1 block w-full text-sm" type="file" accept="image/*" onChange={async (e) => {
          try { setPaper(e.target.files?.[0] ? await imageFileToPng(e.target.files[0]) : null); setError(''); }
          catch (err) { setPaper(null); setError(err.message); }
        }} />
      </label>
      {paper && <p className="text-xs text-emerald-700">Imagen adjunta</p>}
      <p className="text-xs text-slate-500">Al guardar, esta constancia no podrá modificarse.</p>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded border px-3 py-2 text-sm">Cancelar</button>
        <button disabled={busy || (!hasInk && !paper)} className="rounded bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Guardando...' : 'Guardar recepción'}</button></div>
    </form>
  </div>;
}

export default function RemissionsPanel({ dealId, serviceCaseId, invoices = [], operationItems = [] }) {
  const [enabled, setEnabled] = useState(false);
  const [rows, setRows] = useState([]);
  const [creating, setCreating] = useState(false);
  const [delivering, setDelivering] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [error, setError] = useState('');
  const params = { deal_id: dealId || undefined, service_case_id: serviceCaseId || undefined };
  async function reload() {
    const { data } = await api.get('/remissions', { params });
    setRows(data || []);
  }
  useEffect(() => {
    api.get('/invoices/electronic-config').then(({ data }) => {
      setEnabled(Boolean(data.enabled));
      if (data.enabled) reload().catch(() => setError('No se pudieron cargar las remisiones'));
    }).catch(() => {});
  }, [dealId, serviceCaseId]);

  async function action(row, verb) {
    if (verb === 'issue' && !window.confirm(`¿Enviar la remisión #${row.id} a FactPy de prueba? Se reservará un número fiscal.`)) return;
    if (verb === 'retry' && !window.confirm(`Se consultará primero si ${row.receipt_id} existe en FactPy Test. Solo si no existe, se reenviará el mismo documento ${row.document_number}. ¿Continuar?`)) return;
    setBusyId(row.id); setError('');
    try { await api.post(`/remissions/${row.id}/${verb}`, verb === 'retry' ? { confirm_same_document: true } : undefined); await reload(); }
    catch (err) { setError(err.response?.data?.error || 'No se pudo procesar la remisión'); }
    finally { setBusyId(null); }
  }
  async function openPdf(row) {
    try {
      const { data } = await api.get(`/remissions/${row.id}/delivery.pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) { setError(err.response?.data?.error || 'No se pudo abrir la constancia'); }
  }
  if (!enabled) return null;
  return <section className="border-t border-slate-200 pt-5">
    <div className="mb-3 flex items-center justify-between gap-3">
      <div><h4 className="font-semibold text-slate-900">Notas de remisión</h4>
        <p className="text-xs text-slate-500">Traslado fiscal y constancia de recepción de mercadería.</p></div>
      <button type="button" className="inline-flex items-center gap-1 rounded bg-emerald-700 px-3 py-2 text-sm text-white" onClick={() => setCreating(true)}><Plus size={16} /> Nueva nota</button>
    </div>
    {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
    {rows.length === 0 ? <p className="text-sm text-slate-500">Todavía no hay remisiones para esta operación.</p> :
      <div className="overflow-x-auto rounded border border-slate-200"><table className="min-w-full text-sm"><thead className="bg-slate-50"><tr>
        <th className="px-3 py-2 text-left">Número</th><th className="px-3 py-2 text-left">Mercadería</th>
        <th className="px-3 py-2 text-left">Estado fiscal</th><th className="px-3 py-2 text-left">Entrega</th><th className="px-3 py-2 text-left">Acciones</th>
      </tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t">
        <td className="px-3 py-2 font-medium">{row.document_number || `Borrador #${row.id}`}</td>
        <td className="px-3 py-2">{row.draft.items.length} artículo(s)</td>
        <td className="px-3 py-2">{statusLabels[row.fiscal_status] || 'Borrador'}{row.error_message && <div className="text-xs text-amber-700">{row.error_message}</div>}</td>
        <td className="px-3 py-2">{row.received_at ? row.delivery_status.replaceAll('_', ' ') : 'Pendiente'}</td>
        <td className="px-3 py-2"><div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setExpandedId(expandedId === row.id ? null : row.id)} className="text-slate-700 underline">{expandedId === row.id ? 'Ocultar' : 'Ver detalle'}</button>
          {!row.fiscal_status && <button type="button" disabled={busyId === row.id} onClick={() => action(row, 'issue')} className="text-emerald-700 underline">Enviar a FactPy</button>}
          {row.fiscal_status && !['approved', 'rejected'].includes(row.fiscal_status) && <button type="button" disabled={busyId === row.id} onClick={() => action(row, 'refresh')} className="inline-flex items-center gap-1 text-blue-700 underline"><RefreshCw size={14} /> Consultar</button>}
          {row.environment === 'test' && !row.has_cdc &&
            (row.fiscal_status === 'review' || (row.fiscal_status === 'rejected' && /^(?:ERROR - Falta certificado de firma|ERROR - No existe el recordID|JSON inválido: Syntax error)/i.test(row.error_message || ''))) &&
            <button type="button" disabled={busyId === row.id} onClick={() => action(row, 'retry')} className="text-amber-700 underline">Reintentar mismo envío</button>}
          {row.environment === 'test' && row.fiscal_status === 'rejected' &&
            <button type="button" onClick={() => setCreating(row)} className="text-amber-700 underline">Nueva nota corregida</button>}
          {row.kude_url && <a href={row.kude_url} target="_blank" rel="noreferrer" className="text-blue-700 underline">KuDE</a>}
          {row.xml_url && <a href={row.xml_url} target="_blank" rel="noreferrer" className="text-blue-700 underline">XML</a>}
          {row.fiscal_status === 'approved' && !row.received_at && <button type="button" onClick={() => setDelivering(row)} className="inline-flex items-center gap-1 text-emerald-700 underline"><FileSignature size={14} /> Registrar entrega</button>}
          {row.received_at && <button type="button" onClick={() => openPdf(row)} className="inline-flex items-center gap-1 text-blue-700 underline"><PackageCheck size={14} /> Constancia</button>}
        </div></td>
      </tr>)}</tbody></table>
      {rows.find((r) => r.id === expandedId) && (() => {
        const row = rows.find((r) => r.id === expandedId);
        return <div className="border-t bg-slate-50 p-3 text-sm text-slate-700">
          <div><strong>Destinatario:</strong> {row.draft.customer.name} · {row.draft.customer.ruc}</div>
          <div><strong>Entrega prevista:</strong> {row.draft.transport.delivery_date} · {row.draft.transport.destination.direccion}</div>
          <div><strong>Transportista:</strong> {row.draft.transport.carrier.name} · <strong>Chofer:</strong> {row.draft.transport.carrier.driver_name}</div>
          <ul className="mt-2 list-inside list-disc">{row.draft.items.map((item, index) => <li key={index}>{item.quantity} × {item.description} ({item.code})</li>)}</ul>
          {row.received_at && <p className="mt-2"><strong>Recibió:</strong> {row.receiver_name} · {row.receiver_document} · {row.delivery_notes || 'Sin observaciones'}</p>}
        </div>;
      })()}</div>}
    {creating && <DraftModal dealId={dealId} serviceCaseId={serviceCaseId}
      initialDraft={creating === true ? null : creating.draft}
      operationItems={operationItems}
      invoices={invoices.filter((i) => ['emitida', 'pago_parcial', 'pagada', 'vencida'].includes(String(i.status || '').toLowerCase()) &&
        (i.fiscal_mode !== 'electronic' || i.fiscal_status === 'approved'))}
      onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); }} />}
    {delivering && <DeliveryModal row={delivering} onClose={() => setDelivering(null)}
      onSaved={() => { setDelivering(null); reload(); }} />}
  </section>;
}
