// client/src/pages/IndustrialQuoteGenerator.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth.jsx';
import useParamOptions from '../hooks/useParamOptions';

// 👉 Cabecera gráfica desde /public (no requiere import):
const HEADER_SRC = `${import.meta.env.BASE_URL}quote-header.png`;

// ====== Constantes PDF (tamaño industrial 320 x 541 mm) ======
const PDF_PAGE_W_MM = 320;
const PDF_PAGE_H_MM = 541;
const PDF_MARGIN = { top: 10, right: 8, bottom: 12, left: 8 };
const CONTENT_W_MM = PDF_PAGE_W_MM - PDF_MARGIN.left - PDF_MARGIN.right - 0.2;

const decimalsFrom = (raw) => {
  const m = String(raw ?? '').match(/[.,](\d+)/);
  return m ? m[1].length : 0;
};

const money = (n, decimalsHint) => {
  if (n === null || n === undefined || n === '') return '0';
  const numeric = Number(n);
  if (!Number.isFinite(numeric)) return String(n);

  const decs =
    typeof decimalsHint === 'number' && decimalsHint >= 0
      ? decimalsHint
      : decimalsFrom(n);

  const hasFraction = Math.abs(numeric - Math.trunc(numeric)) > 0;
  if (!hasFraction) {
    return String(Math.trunc(numeric));
  }

  const out = decs > 0 ? numeric.toFixed(decs) : String(numeric);
  return out.replace('.', ','); // usa coma si hay decimales
};

const num = (v) => {
  if (v === '' || v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  if (s.includes('.') && s.includes(',')) {
    const normalized = s.replace(/\./g, '').replace(',', '.');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
  }
  if (s.includes(',')) {
    const normalized = s.replace(/\./g, '').replace(',', '.');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
  }
  const normalized = s.replace(/,/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
};

// Paleta de branding
const BRAND_BLUE = '#c62828'; // rojo para barras y cabeceras

// =================== helpers de normalización y búsqueda ===================
const DEBUG_PREFILL = false;

const stripAccents = (s='') =>
  String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const normKey = (k='') =>
  stripAccents(String(k).toLowerCase())
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/__+/g, '_');

function buildNormalizedMap(obj = {}, prefix = '') {
  const out = {};
  Object.entries(obj || {}).forEach(([k, v]) => {
    const nk = (prefix ? `${prefix}:${normKey(k)}` : normKey(k));
    out[nk] = v;
  });
  return out;
}

// Busca el primer valor no vacío por lista de patrones (regex string o exact keys)
function pick(merged, patterns = [], label = '') {
  for (const p of patterns) {
    if (typeof p === 'string' && p.includes(':')) {
      if (merged[p] !== undefined && String(merged[p]).trim() !== '') {
        if (DEBUG_PREFILL) console.debug(`[prefill] ${label}: hit exact "${p}" ->`, merged[p]);
        return String(merged[p]);
      }
      continue;
    }
    const re = new RegExp(typeof p === 'string' ? p : p.source, 'i');
    for (const [k, val] of Object.entries(merged)) {
      const keyOnly = k.split(':', 2)[1] || k;
      if (re.test(keyOnly) && val !== undefined && String(val).trim() !== '') {
        if (DEBUG_PREFILL) console.debug(`[prefill] ${label}: hit pattern ${re} en "${k}" ->`, val);
        return String(val);
      }
    }
  }
  return '';
}

function splitCityCountry(raw = '') {
  const s = String(raw).trim();
  if (!s) return { city: '', country: '' };
  const parts = s.split(/\s*[,/|-]\s*/).map(t => t.trim()).filter(Boolean);
  if (parts.length >= 2) return { city: parts[0], country: parts[1] };
  return { city: s, country: '' };
}

// =================== helpers para NOMBRE DE ARCHIVO (códigos de ciudad) ===================
const sanitizePart = (s) =>
  String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/[\/\\:*?"<>|]+/g, '-') // inválidos en filenames
    .trim();

const ensureUnit = (val, unit, alt = []) => {
  const v = String(val || '').trim();
  if (!v) return '';
  const lower = v.toLowerCase();
  if (lower.includes(unit.toLowerCase()) || alt.some(a => lower.includes(a.toLowerCase()))) return v;
  return `${v} ${unit}`;
};

// 👉 Diccionario base de ciudades → código IATA (ampliable)
const CITY_IATA_MAP = {
  'asuncion': 'ASU', 'asunción': 'ASU',
  'miami': 'MIA',
  'buenos aires': 'EZE', 'ezeiza': 'EZE',
  'sao paulo': 'GRU', 'são paulo': 'GRU',
  'ciudad del este': 'AGT',
  'montevideo': 'MVD',
  'santiago': 'SCL',
  'madrid': 'MAD',
  'barcelona': 'BCN',
  'new york': 'NYC', 'nueva york': 'NYC',
  'panama': 'PTY', 'panamá': 'PTY',
  'bogota': 'BOG', 'bogotá': 'BOG',
  'lima': 'LIM',
  'los angeles': 'LAX',
};

function toKey(s) { return stripAccents(String(s||'').toLowerCase().trim()); }

function findIataIn(s) {
  if (!s) return '';
  const up = String(s).toUpperCase();
  const blacklist = new Set(['EXW','FOB','CIF','DAP','DDP','LCL','FCL']);
  const m = up.match(/\b([A-Z]{3})\b/);
  if (m && !blacklist.has(m[1])) return m[1];
  return '';
}

function cityToCode(...candidates) {
  for (const c of candidates) {
    const t = toKey(c);
    if (!t) continue;
    if (CITY_IATA_MAP[t]) return CITY_IATA_MAP[t];
    for (const [k, code] of Object.entries(CITY_IATA_MAP)) {
      if (t.includes(k)) return code;
    }
  }
  return '';
}

/* ===== Abreviador de "Tipo de Embarque" ===== */
function transportToAbbr(s) {
  const t = toKey(s);
  if (!t) return '';
  if (/^(air|aer|a[eé]reo)/.test(t)) return 'AER';
  if (/^(mar|mari|mar[ií]timo|ocean|sea)/.test(t)) return 'MAR';
  if (/^(fluv|river|hidro)/.test(t)) return 'FLU';
  if (/^(ter|road|camion|cam[ií]on|truck)/.test(t)) return 'TER';
  if (/^(fer|rail|tren)/.test(t)) return 'FER';
  if (/^(cour|express|paqueter)/.test(t)) return 'COU';
  if (/^(multi|combi|intermodal)/.test(t)) return 'MUL';
  return String(s).toUpperCase().slice(0, 3);
}

function buildQuoteFileName({ deal, cfMap, ui }) {
  const ref = sanitizePart(deal?.reference || 'PRESUPUESTO');

  // === Tipo de embarque ABREVIADO ===
  const tipoRaw = cfMap['modalidad_carga'] || ui.tipoTransporte || '';
  const tipoEmbarque = transportToAbbr(tipoRaw);

  // === Modalidad (FCL/LCL, etc.) tal como venga ===
  const modalidad = sanitizePart(cfMap['tipo_carga'] || ui.tipoEnvio || '');

  // ORIGEN
  const origenCode =
    findIataIn(cfMap['origen_pto']) ||
    cityToCode(cfMap['ciudad_origen'], ui.ciudadOrigen, cfMap['origen_pto'], ui.aeropuertoOrigen);
  const origen =
    origenCode ||
    sanitizePart(cfMap['origen_pto'] || ui.ciudadOrigen || ui.aeropuertoOrigen || '');

  // DESTINO
  const destinoCode =
    findIataIn(cfMap['destino_pto']) ||
    cityToCode(cfMap['ciudad_destino'], ui.ciudadDestino, cfMap['destino_pto'], ui.aeropuertoDestino);
  const destino =
    destinoCode ||
    sanitizePart(cfMap['destino_pto'] || ui.ciudadDestino || ui.aeropuertoDestino || '');

  // PESO / VOLUMEN
  const pesoRaw = cfMap['peso_bruto'] || cfMap['peso_bruto_kg'] || ui.pesoBrutoKg || '';
  const volRaw  = cfMap['vol_m3'] || cfMap['p_vol'] || ui.volumenM3 || '';
  const peso    = sanitizePart(ensureUnit(pesoRaw, 'kg', ['kgs', 'kilogramo', 'kilogramos']));
  const volumen = sanitizePart(ensureUnit(volRaw, 'm3', ['m³', 'm^3']));

  // MERCADERÍA
  const mercaderia = sanitizePart(cfMap['mercaderia'] || ui.mercaderia || '');

  const parts = [ref, tipoEmbarque, modalidad, origen, destino, peso, volumen, mercaderia]
    .map(sanitizePart)
    .filter(Boolean);

  let name = parts.join(' - ').replace(/\s{2,}/g, ' ').trim();
  const MAX = 180;
  if (name.length > MAX) name = name.slice(0, MAX);
  return `${name}.pdf`;
}

// =================== esquema CF para guardar ===================
const CF_SCHEMA = {
  tipo_operacion:     { label: 'Tipo de Operación', type: 'text' },
  tipo_transporte:    { label: 'Tipo de Transporte', type: 'text' },
  tipo_envio:         { label: 'Tipo de Envío', type: 'text' },
  incoterms:          { label: 'Incoterms', type: 'text' },

  pais_origen:        { label: 'País Origen', type: 'text' },
  pais_destino:       { label: 'País Destino', type: 'text' },
  ciudad_origen:      { label: 'Ciudad Origen', type: 'text' },
  ciudad_destino:     { label: 'Ciudad Destino', type: 'text' },
  aeropuerto_origen:  { label: 'Aeropuerto Origen', type: 'text' },
  aeropuerto_destino: { label: 'Aeropuerto Destino', type: 'text' },

  volumen_m3:         { label: 'Volumen (m³)', type: 'number' },
  peso_bruto_kg:      { label: 'Peso bruto (kg)', type: 'number' },
  mercaderia:         { label: 'Mercadería', type: 'text' },

  seguro_tipo:        { label: 'Tipo de seguro', type: 'text' },
  seguro_monto_usd:   { label: 'Monto asegurado (USD)', type: 'number' },
  aseguradora:        { label: 'Aseguradora', type: 'text' },

  observaciones:      { label: 'Observaciones', type: 'text' },

  validez_oferta:     { label: 'Validez de la oferta', type: 'text' },
  condicion_venta:    { label: 'Condición de venta', type: 'text' },
  plazo_credito:      { label: 'Plazo de crédito', type: 'text' },
  forma_pago:         { label: 'Forma de pago', type: 'text' },

  // ✨ NUEVOS CF:
  que_incluye:        { label: 'Qué incluye', type: 'text' },
  que_no_incluye:     { label: 'Qué no incluye', type: 'text' },
  quote_template:     { label: 'Plantilla seleccionada', type: 'text' },
  responsabilidad_cliente: { label: 'Responsabilidad del cliente', type: 'text' },
  plazos_entrega:     { label: 'Plazos de entrega', type: 'text' },
  condicion_pago:     { label: 'Condicion de pago', type: 'text' },
  tipo_instalacion:   { label: 'Tipo de instalacion', type: 'text' },
  garantia:           { label: 'Garantia', type: 'text' },
  observaciones_producto: { label: 'Observaciones de producto', type: 'text' },
  industrial_items_json: { label: 'Items industrial (JSON)', type: 'text' },
};

// ===== Utilidades de Tags =====
function parseTags(raw='') {
  // separa por líneas, coma, punto y coma, bullets •, guión al inicio, etc.
  return String(raw)
    .split(/\r?\n|,|;|•/g)
    .map(s => s.replace(/^\s*[-–•]\s*/, '').trim())
    .filter(Boolean);
}
const tagsToText = (tags=[]) => tags.map(t => t.trim()).filter(Boolean).join('\n');

function normalizeTemplateSection(val) {
  if (Array.isArray(val)) return val.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof val === 'string') return parseTags(val);
  return [];
}

function parseTemplateValue(raw) {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    const name = String(data.name || data.titulo || data.title || '').trim();
    return { name: name || 'Plantilla', data };
  } catch (e) {
    return null;
  }
}

export default function QuoteGenerator(){
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const revisionId = searchParams.get('revision_id');
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [deal, setDeal] = useState(null);
  const [cf, setCf] = useState({});

  // Cabecera
  const [cliente, setCliente] = useState('');
  const [contacto, setContacto] = useState('');
  const [fecha, setFecha] = useState(() => new Date().toLocaleDateString());
  const [ref, setRef] = useState('');
  const [incoterm, setIncoterm] = useState('EXW');

  // Operación
  const [tipoOperacion, setTipoOperacion] = useState('IMPORTACION');
  const [tipoTransporte, setTipoTransporte] = useState('AEREO');
  const [tipoEnvio, setTipoEnvio] = useState('LCL');

  const [paisOrigen, setPaisOrigen] = useState('');
  const [paisDestino, setPaisDestino] = useState('');
  const [ciudadOrigen, setCiudadOrigen] = useState('');
  const [ciudadDestino, setCiudadDestino] = useState('');
  const [aeropuertoOrigen, setAeropuertoOrigen] = useState('');
  const [aeropuertoDestino, setAeropuertoDestino] = useState('');

  const [volumenM3, setVolumenM3] = useState('');
  const [pesoBrutoKg, setPesoBrutoKg] = useState('');
  const [mercaderia, setMercaderia] = useState('');

  const [seguroTipo, setSeguroTipo] = useState('CONTRA TODO RIESGO');
  const [montoAsegurado, setMontoAsegurado] = useState('');
  const [aseguradora, setAseguradora] = useState('');

  const [observaciones, setObservaciones] = useState('');
  const [terminos, setTerminos] = useState({
    validez: '7 DIAS',
    condicionVenta: 'CREDITO',
    plazoCredito: '30 DIAS',
    formaPago: 'TRANSFERENCIA',
  });

  // ✨ NUEVOS estados como TAGS
  const [incluyeTags, setIncluyeTags] = useState([]);     // string[]
  const [noIncluyeTags, setNoIncluyeTags] = useState([]); // string[]
  const [responsabilidadClienteTags, setResponsabilidadClienteTags] = useState([]);
  const [plazosEntregaTags, setPlazosEntregaTags] = useState([]);
  const [condicionPagoTags, setCondicionPagoTags] = useState([]);
  const [tipoInstalacionTags, setTipoInstalacionTags] = useState([]);
  const [garantiaTags, setGarantiaTags] = useState([]);
  const [observacionesProductoTags, setObservacionesProductoTags] = useState([]);

  const [templateOptions, setTemplateOptions] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedTemplateName, setSelectedTemplateName] = useState('');

  // Ítems
  const [items, setItems] = useState([]);

  // ======= Opciones administrables (incluye NUEVAS llaves) =======
  const { options: termOpts } = useParamOptions(
    [
      'quote_validez',
      'quote_condicion_venta',
      'quote_plazo_credito',
      'quote_forma_pago',
      // ✨ nuevos:
      'quote_incluye',
      'quote_no_incluye',
    ],
    { onlyActive: true, asValues: true }
  );

  const selectedTemplate = useMemo(
    () => templateOptions.find((t) => String(t.id) === String(selectedTemplateId)),
    [templateOptions, selectedTemplateId]
  );

  const applyTemplate = (template) => {
    if (!template) return;
    setIncluyeTags(normalizeTemplateSection(template.incluye ?? template.que_incluye));
    setNoIncluyeTags(normalizeTemplateSection(template.no_incluye ?? template.que_no_incluye));
    setResponsabilidadClienteTags(normalizeTemplateSection(template.responsabilidad_cliente));
    setPlazosEntregaTags(normalizeTemplateSection(template.plazos_entrega ?? template.plazo_entrega));
    setCondicionPagoTags(normalizeTemplateSection(template.condicion_pago));
    setTipoInstalacionTags(normalizeTemplateSection(template.tipo_instalacion));
    setGarantiaTags(normalizeTemplateSection(template.garantia));
    setObservacionesProductoTags(normalizeTemplateSection(template.observaciones_producto || template.observaciones));
  };



  
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/params', {
          params: { keys: 'quote_template', only_active: 1 },
        });
        const rows = Array.isArray(data?.quote_template) ? data.quote_template : [];
        const parsed = rows
          .map((row) => {
            const parsedValue = parseTemplateValue(row.value);
            if (!parsedValue) return null;
            const name = parsedValue.name || `Plantilla ${row.id}`;
            return { id: row.id, name, data: parsedValue.data };
          })
          .filter(Boolean);
        setTemplateOptions(parsed);
      } catch (e) {
        console.error('No se pudieron cargar plantillas:', e);
        setTemplateOptions([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedTemplateId && selectedTemplateName && templateOptions.length) {
      const found = templateOptions.find((t) => t.name === selectedTemplateName);
      if (found) setSelectedTemplateId(String(found.id));
    }
  }, [selectedTemplateId, selectedTemplateName, templateOptions]);

// =================== Carga + PREFILL robusto ===================
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [{ data: detail }, cfRes, quoteRes] = await Promise.all([
          api.get(`/deals/${id}`),
          api.get(`/deals/${id}/custom-fields`).catch(() => ({ data: [] })),
          api.get(`/deals/${id}/quote`, { params: revisionId ? { revision_id: revisionId } : {} }).catch(() => ({ data: null })),
        ]);
        setDeal(detail.deal);

        const cfMap = {};
        (cfRes.data || []).forEach((r) => (cfMap[r.key] = r.value ?? ''));
        setCf(cfMap);

        const header = {};

        const merged = {
          ...buildNormalizedMap(cfMap, 'cf'),
          ...buildNormalizedMap(header, 'hdr'),
        };

        // Cabecera simple
        setCliente(detail.deal?.org_name || '');
        setContacto(detail.deal?.contact_name || '');
        setRef(detail.deal?.reference || '');

        // ---- Incoterms
        setIncoterm(
          pick(merged, ['cf:incoterms', 'cf:incoterm', /incoterm/], 'incoterms') || 'EXW'
        );

        // ---- Tipo de Operación / Transporte / Envío
        setTipoOperacion(
          pick(merged, [
            'cf:tipo_operacion', 'cf:operacion_tipo',
            /tipo.*operac/, /operation.*type/, /op.*type/
          ], 'tipoOperacion') || 'IMPORTACION'
        );

        setTipoTransporte(
          pick(merged, [
            'cf:tipo_transporte', 'cf:transporte_tipo', 'cf:modalidad_carga',
            /tipo.*trans/, /transport.*type/, /modalidad|medio|via.*trans/
          ], 'tipoTransporte') || 'AEREO'
        );

        const envioDetect =
          pick(merged, ['cf:tipo_envio', 'cf:envio_tipo', 'cf:tipo_carga', /tipo.*envio/, /envio/, /container|fcl|lcl/], 'tipoEnvio') || '';
        setTipoEnvio(envioDetect || 'LCL');

        // ---- Origen/Destino (ciudad/país)
        const origenTexto =
          pick(merged, ['cf:ciudad_origen', 'cf:origen_ciudad', 'cf:origen', /ciudad.*origen/, /origin.*city/], 'ciudad_origen')
          || pick(merged, [/origen/], 'origen_raw');

        const destinoTexto =
          pick(merged, ['cf:ciudad_destino', 'cf:destino_ciudad', 'cf:destino', /ciudad.*destino/, /destin.*city/], 'ciudad_destino')
          || pick(merged, [/destino/], 'destino_raw');

        const { city: cityO_fallback, country: countryO_fallback } = splitCityCountry(origenTexto);
        const { city: cityD_fallback, country: countryD_fallback } = splitCityCountry(destinoTexto);

        setCiudadOrigen(
          pick(merged, ['cf:ciudad_origen', 'cf:origen_ciudad', /ciudad.*origen/, /origin.*city/], 'Ciudad Origen')
          || cityO_fallback || ''
        );
        setCiudadDestino(
          pick(merged, ['cf:ciudad_destino', 'cf:destino_ciudad', /ciudad.*destino/, /destin.*city/], 'Ciudad Destino')
          || cityD_fallback || ''
        );

        setPaisOrigen(
          pick(merged, ['cf:pais_origen', 'cf:origen_pais', /pais.*origen/, /origin.*country|country.*origin/], 'País Origen')
          || countryO_fallback || ''
        );
        setPaisDestino(
          pick(merged, ['cf:pais_destino', 'cf:destino_pais', /pais.*destino/, /destin.*country|country.*dest/], 'País Destino')
          || countryD_fallback || ''
        );

        // ---- Aeropuertos / Puertos
        setAeropuertoOrigen(
          pick(merged, [
            'cf:aeropuerto_origen', 'cf:origen_aeropuerto', 'cf:origen_pto',
            /aerop.*origen/, /origin.*airport/, /puerto.*origen|port.*origin/
          ], 'Aeropuerto Origen') || ''
        );
        setAeropuertoDestino(
          pick(merged, [
            'cf:aeropuerto_destino', 'cf:destino_aeropuerto', 'cf:destino_pto',
            /aerop.*destino/, /destin.*airport/, /puerto.*destino|port.*dest/
          ], 'Aeropuerto Destino') || ''
        );

        // ---- Medidas / Mercadería
        setVolumenM3(
          pick(merged, ['cf:volumen_m3', 'cf:vol_m3', /vol.*m3|cbm|m3|volumen/], 'Volumen m3') || ''
        );
        setPesoBrutoKg(
          pick(merged, ['cf:peso_bruto_kg', 'cf:peso_bruto', /peso.*kg|peso.*bruto|weight.*kg/], 'Peso bruto') || ''
        );
        setMercaderia(
          pick(merged, ['cf:mercaderia', 'cf:mercaderia_desc', 'cf:producto', /mercader|commodity|goods|Observacion/], 'Mercadería') || ''
        );

        // ---- Seguro
        setSeguroTipo(
          pick(merged, ['cf:seguro_tipo', /seguro.*tipo|insurance.*type/], 'Seguro tipo') || 'CONTRA TODO RIESGO'
        );
        setMontoAsegurado(
          pick(merged, ['cf:seguro_monto_usd', 'cf:monto_asegurado', 'cf:seguro_monto', /monto.*asegur|insured.*amount|insurance.*amount/], 'Monto asegurado') || ''
        );
        setAseguradora(
          pick(merged, ['cf:aseguradora', /aseguradora|insurer|insurance.*company/], 'Aseguradora') || ''
        );

        // ---- Observaciones
        setObservaciones(
          pick(
            merged,
            ['cf:observaciones', 'cf:observacion', 'cf:obs', /observaci|remarks|notes/],
            'Observaciones'
          ) || ''
        );
        setTerminos({
          validez:
            pick(merged, ['cf:validez_oferta', /validez|validity/], 'Validez') || '7 DIAS',
          condicionVenta:
            pick(merged, ['cf:condicion_venta', /condici.*venta/], 'Condición de venta') || 'CREDITO',
          plazoCredito:
            pick(merged, ['cf:plazo_credito', /plazo.*credit|credit.*term/], 'Plazo de crédito') || '30 DIAS',
          formaPago:
            pick(merged, ['cf:forma_pago', /forma.*pago|payment.*method/], 'Forma de pago') || 'TRANSFERENCIA',
        });

        // Prefill de "Que incluye" / "Que no incluye" como tags
        setIncluyeTags(parseTags(
          pick(merged, ['cf:que_incluye', 'cf:incluye', /que.*incluye|incluye/], 'Que incluye') || ''
        ));
        setNoIncluyeTags(parseTags(
          pick(merged, ['cf:que_no_incluye', 'cf:no_incluye', /no.*incluye|excluye|exclusiones/], 'Que no incluye') || ''
        ));
        setSelectedTemplateName(
          pick(merged, ['cf:quote_template', /quote.*template|plantilla/], 'Plantilla') || ''
        );
        setResponsabilidadClienteTags(parseTags(
          pick(merged, ['cf:responsabilidad_cliente', /responsabilidad.*cliente/], 'Responsabilidad del cliente') || ''
        ));
        setPlazosEntregaTags(parseTags(
          pick(merged, ['cf:plazos_entrega', /plazos?.*entrega/], 'Plazos de entrega') || ''
        ));
        setCondicionPagoTags(parseTags(
          pick(merged, ['cf:condicion_pago', /condicion.*pago/], 'Condicion de pago') || ''
        ));
        setTipoInstalacionTags(parseTags(
          pick(merged, ['cf:tipo_instalacion', /tipo.*instalacion/], 'Tipo de instalacion') || ''
        ));
        setGarantiaTags(parseTags(
          pick(merged, ['cf:garantia', /garantia/], 'Garantia') || ''
        ));
        setObservacionesProductoTags(parseTags(
          pick(merged, ['cf:observaciones_producto', /observaciones.*producto/], 'Observaciones de producto') || ''
        ));

        // ======= Items desde cotizacion industrial =======
        // Ítems: si hay guardados en CF, usarlos; si no, usar los de la cotización
        const savedItemsRaw = cf['industrial_items_json'];
        let mapped = [];
        if (savedItemsRaw) {
          try {
            const parsed = JSON.parse(savedItemsRaw);
            if (Array.isArray(parsed)) {
              mapped = parsed.map((it) => ({
                cantidad: it.cantidad || 1,
                servicio: it.servicio || it.description || 'Item',
                observacion: it.observacion || it.Observacion || '',
                moneda: it.moneda || 'USD',
                precio: it.precio ?? it.unit_price ?? 0,
                impuesto: it.impuesto || 'EXENTA',
                include: it.include !== false,
              }));
            }
          } catch (e) {
            console.warn('No se pudo parsear items guardados', e);
          }
        }
        if (!mapped.length) {
          // Preferimos los ítems crudos guardados en la cotización (inputs) para traer observación
          const rawItems =
            quoteRes?.data?.quote?.inputs?.items ||
            quoteRes?.data?.inputs?.items ||
            [];
          const computedItems = quoteRes?.data?.computed?.oferta?.items || [];
          const sourceItems = rawItems.length ? rawItems : computedItems;

          mapped = sourceItems
            .filter((it) => Number(it.qty || 0) > 0 || String(it.description || it.servicio || "").trim())
            .map((it, idx) => {
              const qty = Number(it.qty || 0) || 1;
              const door = Number(it.door_value_usd || 0);
              const extra = Number(it.additional_usd || 0);
              const unit =
                it.unit_price ??
                it.precio ??
                (door + extra) ??
                (qty ? Number(it.total_sales || 0) / qty : Number(it.total_sales || 0));
              return {
                cantidad: qty,
                servicio: it.servicio || it.description || `Item ${idx + 1}`,
                observacion: it.observacion || it.observation || "",
                moneda: it.moneda || "USD",
                precio: unit,
                impuesto: it.impuesto || "EXENTA",
                include: it.include !== false,
              };
            });
        }
        setItems(mapped);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const displayItems = useMemo(
    () => items.filter((it) => it.include !== false),
    [items]
  );
  const totalUSD = useMemo(
    () =>
      items.reduce(
        (acc, it) =>
          it.include === false
            ? acc
            : acc +
              (it.moneda === 'USD' ? num(it.precio) * (num(it.cantidad) || 1) : 0),
        0
      ),
    [items]
  );
  const totalUsdDecimals = useMemo(
    () =>
      items.reduce(
        (acc, it) =>
          it.include === false
            ? acc
            : Math.max(acc, decimalsFrom(it.precio), decimalsFrom(it.cantidad)),
        0
      ),
    [items]
  );

  // =================== Guardar en CF ===================
  const [saving, setSaving] = useState(false);
  async function saveToCustomFields() {
    try {
      setSaving(true);
      const entries = [
        ['tipo_operacion',   tipoOperacion],
        ['tipo_transporte',  tipoTransporte],
        ['tipo_envio',       tipoEnvio],
        ['incoterms',        incoterm],

        ['pais_origen',      paisOrigen],
        ['pais_destino',     paisDestino],
        ['ciudad_origen',    ciudadOrigen],
        ['ciudad_destino',   ciudadDestino],
        ['aeropuerto_origen',aeropuertoOrigen],
        ['aeropuerto_destino',aeropuertoDestino],

        ['volumen_m3',       volumenM3],
        ['peso_bruto_kg',    pesoBrutoKg],
        ['mercaderia',       mercaderia],

        ['seguro_tipo',      seguroTipo],
        ['seguro_monto_usd', montoAsegurado],
        ['aseguradora',      aseguradora],

        ['observaciones',    observaciones],
        ['observacion',      observaciones], // alias por si otras vistas usan singular

        ['validez_oferta',   terminos.validez],
        ['condicion_venta',  terminos.condicionVenta],
        ['plazo_credito',    terminos.plazoCredito],
        ['forma_pago',       terminos.formaPago],

        // nuevos como lista (lineas)
        ['que_incluye',      tagsToText(incluyeTags)],
        ['que_no_incluye',   tagsToText(noIncluyeTags)],
        ['quote_template',   selectedTemplate?.name || selectedTemplateName || ''],
        ['responsabilidad_cliente', tagsToText(responsabilidadClienteTags)],
        ['plazos_entrega',   tagsToText(plazosEntregaTags)],
        ['condicion_pago',   tagsToText(condicionPagoTags)],
        ['tipo_instalacion', tagsToText(tipoInstalacionTags)],
        ['garantia',         tagsToText(garantiaTags)],
        ['observaciones_producto', tagsToText(observacionesProductoTags)],
        ['industrial_items_json', JSON.stringify(items)],
      ];

      await Promise.all(entries.map(async ([key, value]) => {
        const def = CF_SCHEMA[key] || { label: key, type: 'text' };
        await api.post(`/deals/${id}/custom-fields`, {
          key,
          label: def.label,
          type: def.type === 'number' ? 'number' : 'text',
          value: value === '' ? null : value,
        });
      }));

      const { data: cfs } = await api.get(`/deals/${id}/custom-fields`).catch(() => ({ data: [] }));
      const map = {};
      (cfs || []).forEach((r) => (map[r.key] = r.value ?? ''));
      setCf(map);

      alert('Datos guardados en la operación ✔');
    } catch (e) {
      console.error('No se pudieron guardar los custom fields:', e);
      alert('No se pudo guardar. Revisá la consola para más detalles.');
    } finally {
      setSaving(false);
    }
  }

  // ============ Descargar PDF (con nombre armado con códigos + abreviación) ============
  let html2pdfLoader = null;
  function ensureHtml2Pdf() {
    if (window.html2pdf) return Promise.resolve(window.html2pdf);
    if (html2pdfLoader) return html2pdfLoader;
    html2pdfLoader = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js';
      s.async = true;
      s.onload = () => resolve(window.html2pdf);
      s.onerror = () => reject(new Error('No se pudo cargar html2pdf.js'));
      document.head.appendChild(s);
    });
    return html2pdfLoader;
  }

  async function downloadPdf() {
    const el = document.getElementById('quote-print');
    if (!el) return;
    try {
      const html2pdf = await ensureHtml2Pdf();

      const fileName = buildQuoteFileName({
        deal,
        cfMap: {
          modalidad_carga: cf['modalidad_carga'] || '',
          tipo_carga:      cf['tipo_carga'] || '',
          origen_pto:      cf['origen_pto'] || '',
          destino_pto:     cf['destino_pto'] || '',
          ciudad_origen:   cf['ciudad_origen'] || '',
          ciudad_destino:  cf['ciudad_destino'] || '',
          peso_bruto:      cf['peso_bruto'] || cf['peso_bruto_kg'] || '',
          vol_m3:          cf['vol_m3'] || cf['volumen_m3'] || '',
          p_vol:           cf['p_vol'] || '',
          mercaderia:      cf['mercaderia'] || '',
        },
        ui: {
          tipoTransporte, tipoEnvio,
          ciudadOrigen, paisOrigen, aeropuertoOrigen,
          ciudadDestino, paisDestino, aeropuertoDestino,
          pesoBrutoKg, volumenM3, mercaderia,
        },
      });

      const opt = {
        margin: [PDF_MARGIN.top, PDF_MARGIN.right, PDF_MARGIN.bottom, PDF_MARGIN.left],
        filename: fileName,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: [PDF_PAGE_W_MM, PDF_PAGE_H_MM], orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      };
      html2pdf().from(el).set(opt).save();
    } catch {
      alert('No se pudo generar el PDF.');
    }
  }

  if (loading) return <div className="p-4 text-sm text-slate-600">Cargando…</div>;
  if (!deal) return <div className="p-4 text-sm text-slate-600">Operación no encontrada.</div>;

  return (
    <div className="p-4 space-y-4">
      <style>{`
        .avoid-break{
          break-inside: avoid;
          page-break-inside: avoid;
        }
        .html2pdf__page-break{
          break-after: page;
          page-break-after: always;
          height: 0;
        }
        /* tabla de especificaciones: columna 1 = etiqueta+":" , columna 2 = valor */
        .kv-grid{
          display: grid;
          grid-template-columns: 210px 1fr; /* 👈 valores alineados */
          column-gap: 8px;
          row-gap: 4px;
        }
        .kv-label{
          text-transform: uppercase;
          font-weight: 600;
          letter-spacing: .02em;
          color: #334155; /* slate-700 */
        }
        .quote-header{
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px 8px 12px;
          column-gap: 16px;
        }
        .quote-logo{
          display: inline-flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
          font-family: "Georgia", "Times New Roman", serif;
          font-size: 26px;
          letter-spacing: .6px;
          line-height: 1.05;
          font-weight: 600;
        }
        .quote-logo-text{
          display: inline-flex;
          align-items: flex-end;
          gap: 2px;
          text-transform: uppercase;
        }
        .quote-logo-grupo{
          color: #0f172a; /* slate-900 */
          font-weight: 600;
        }
        .quote-logo-atm{
          color: #ef4444;
          font-weight: 600;
          letter-spacing: .2px;
        }
        .quote-logo-swoosh{
          position: relative;
          width: 150px;
          height: 12px;
          margin-top: 6px;
        }
        .quote-logo-swoosh::before{
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          top: 3px;
          height: 9px;
          background: #ef4444;
          border-radius: 0 0 90px 90px;
          transform: skewX(-12deg);
        }
        .quote-logo-swoosh::after{
          content: "";
          position: absolute;
          left: 20px;
          top: 1px;
          width: 86px;
          height: 6px;
          background: #ffffff;
          border-radius: 0 0 40px 40px;
          transform: skewX(-12deg);
          opacity: .9;
        }
        .quote-banner{
          position: relative;
          height: 48px;
          width: 420px;
        }
        .quote-banner-orange{
          position: absolute;
          left: 0;
          top: 0;
          height: 48px;
          width: 140px;
          background: #c62828;
          border-top-right-radius: 40px;
          border-bottom-right-radius: 40px;
        }
        .quote-banner-blue{
          position: absolute;
          right: 0;
          top: 0;
          height: 48px;
          width: 320px;
          background: #b71c1c;
          border-top-left-radius: 40px;
          border-bottom-left-radius: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
          font-weight: 700;
          letter-spacing: .08em;
        }
      `}</style>

      {/* Header actions */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Generar Presupuesto — REF {deal.reference}</h1>
        <div className="space-x-2 flex items-center">
          <button
            onClick={saveToCustomFields}
            disabled={saving}
            className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-60"
          >
            {saving ? 'Guardando…' : 'Guardar en Operación'}
          </button>
          <button onClick={downloadPdf} className="px-3 py-2 rounded bg-black text-white">
            Descargar PDF
          </button>
          <Link to={`/operations/${id}`} className="px-3 py-2 rounded bg-slate-200 hover:bg-slate-300">
            ← Volver a la operación
          </Link>
        </div>
      </div>

      {/* Panel editable */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Cabecera */}
        <div className="bg-white rounded-xl border p-3 space-y-2">
          <div className="text-sm font-semibold">Cabecera</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="block">Cliente
              <input value={cliente} onChange={e=>setCliente(e.target.value)} className="w-full border rounded px-2 py-1" />
            </label>
            <label className="block">Contacto
              <input value={contacto} onChange={e=>setContacto(e.target.value)} className="w-full border rounded px-2 py-1" />
            </label>
            <label className="block">Fecha
              <input value={fecha} onChange={e=>setFecha(e.target.value)} className="w-full border rounded px-2 py-1" />
            </label>
            <label className="block">Referencia
              <input value={ref} onChange={e=>setRef(e.target.value)} className="w-full border rounded px-2 py-1" />
            </label>
            <label className="block">Incoterms
              <input value={incoterm} onChange={e=>setIncoterm(e.target.value)} className="w-full border rounded px-2 py-1" />
            </label>
          </div>
        </div>

        {/* Operación */}
        <div className="bg-white rounded-xl border p-3 space-y-2">
          <div className="text-sm font-semibold">Operación</div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <label className="block">Tipo de Operación
              <input value={tipoOperacion} onChange={e=>setTipoOperacion(e.target.value)} className="w-full border rounded px-2 py-1" />
            </label>
            <label className="block">Tipo de Transporte
              <input value={tipoTransporte} onChange={e=>setTipoTransporte(e.target.value)} className="w-full border rounded px-2 py-1" />
            </label>
            <label className="block">Tipo de Envío
              <input value={tipoEnvio} onChange={e=>setTipoEnvio(e.target.value)} className="w-full border rounded px-2 py-1" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="block">País Origen
              <input value={paisOrigen} onChange={e=>setPaisOrigen(e.target.value)} className="w-full border rounded px-2 py-1" />
            </label>
            <label className="block">País Destino
              <input value={paisDestino} onChange={e=>setPaisDestino(e.target.value)} className="w-full border rounded px-2 py-1" />
            </label>
            <label className="block">Ciudad Origen
              <input value={ciudadOrigen} onChange={e=>setCiudadOrigen(e.target.value)} className="w-full border rounded px-2 py-1" />
            </label>
            <label className="block">Ciudad Destino
              <input value={ciudadDestino} onChange={e=>setCiudadDestino(e.target.value)} className="w-full border rounded px-2 py-1" />
            </label>
            <label className="block">Aeropuerto Origen
              <input value={aeropuertoOrigen} onChange={e=>setAeropuertoOrigen(e.target.value)} className="w-full border rounded px-2 py-1" />
            </label>
            <label className="block">Aeropuerto Destino
              <input value={aeropuertoDestino} onChange={e=>setAeropuertoDestino(e.target.value)} className="w-full border rounded px-2 py-1" />
            </label>
          </div>
        </div>

        {/* Medidas */}
        <div className="bg-white rounded-xl border p-3 space-y-2">
          <div className="text-sm font-semibold">Medidas y mercancía</div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <label className="block">Volumen (m³)
              <input value={volumenM3} onChange={e=>setVolumenM3(e.target.value)} className="w-full border rounded px-2 py-1" />
            </label>
            <label className="block">Peso bruto (kg)
              <input value={pesoBrutoKg} onChange={e=>setPesoBrutoKg(e.target.value)} className="w-full border rounded px-2 py-1" />
            </label>
            <label className="block">Mercadería
              <input value={mercaderia} onChange={e=>setMercaderia(e.target.value)} className="w-full border rounded px-2 py-1" />
            </label>
          </div>
        </div>

        {/* Seguro */}
        <div className="bg-white rounded-xl border p-3 space-y-2">
          <div className="text-sm font-semibold">Seguro</div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <label className="block">Tipo de seguro
              <input value={seguroTipo} onChange={e=>setSeguroTipo(e.target.value)} className="w-full border rounded px-2 py-1" />
            </label>
            <label className="block">Monto asegurado (USD)
              <input value={montoAsegurado} onChange={e=>setMontoAsegurado(e.target.value)} className="w-full border rounded px-2 py-1" />
            </label>
            <label className="block">Aseguradora
              <input value={aseguradora} onChange={e=>setAseguradora(e.target.value)} className="w-full border rounded px-2 py-1" />
            </label>
          </div>
        </div>

        {/* Ítems */}
        <div className="bg-white rounded-xl border p-3 space-y-2">
          <div className="text-sm font-semibold">Ítems del presupuesto</div>
          <ItemsTable items={items} setItems={setItems} totalUSD={totalUSD} totalDecimals={totalUsdDecimals} />
        </div>

        {/* Observaciones */}
        <div className="bg-white rounded-xl border p-3 space-y-2">
          <div className="text-sm font-semibold">Observaciones</div>
          <textarea
            rows={4}
            className="w-full border rounded px-2 py-1 text-sm"
            placeholder="Observaciones..."
            value={observaciones}
            onChange={(e)=>setObservaciones(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-2 text-sm">
            <ParamWithInput
              label="Validez de la oferta"
              value={terminos.validez}
              onChange={(v)=>setTerminos(s=>({...s, validez: v}))}
              options={termOpts.quote_validez}
            />
            <ParamWithInput
              label="Condición de venta"
              value={terminos.condicionVenta}
              onChange={(v)=>setTerminos(s=>({...s, condicionVenta: v}))}
              options={termOpts.quote_condicion_venta}
            />
            <ParamWithInput
              label="Plazo de crédito"
              value={terminos.plazoCredito}
              onChange={(v)=>setTerminos(s=>({...s, plazoCredito: v}))}
              options={termOpts.quote_plazo_credito}
            />
            <ParamWithInput
              label="Forma de pago"
              value={terminos.formaPago}
              onChange={(v)=>setTerminos(s=>({...s, formaPago: v}))}
              options={termOpts.quote_forma_pago}
            />
          </div>
        </div>

        {/* Plantilla de condiciones */}
        <div className="bg-white rounded-xl border p-3 space-y-2">
          <div className="text-sm font-semibold">Plantilla de condiciones</div>
          <label className="block text-sm">
            Seleccionar plantilla
            <select
              className="mt-1 w-full border rounded px-2 py-1"
              value={selectedTemplateId}
              onChange={(e) => {
                const nextId = e.target.value;
                setSelectedTemplateId(nextId);
                const next = templateOptions.find((t) => String(t.id) === String(nextId));
                if (next) {
                  setSelectedTemplateName(next.name);
                  applyTemplate(next.data);
                } else {
                  setSelectedTemplateName('');
                }
              }}
            >
              <option value="">-- Seleccionar --</option>
              {templateOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </select>
          </label>
          {selectedTemplate?.name && (
            <div className="text-xs text-slate-500">Origen: Parametros</div>
          )}
        </div>

        <div className="bg-white rounded-xl border p-3 space-y-3">
          <div className="text-sm font-semibold">Alcances del servicio</div>

          <TagMultiInput
            label="Qué incluye"
            tags={incluyeTags}
            setTags={setIncluyeTags}
            options={termOpts.quote_incluye || []}
            placeholder="Escribí y presioná Enter…"
          />

          <TagMultiInput
            label="Qué no incluye"
            tags={noIncluyeTags}
            setTags={setNoIncluyeTags}
            options={termOpts.quote_no_incluye || []}
            placeholder="Escribí y presioná Enter…"
          />
        </div>
      </div>

              {/* Condiciones industriales */}
        <div className="bg-white rounded-xl border p-3 space-y-3">
          <div className="text-sm font-semibold">Condiciones industriales</div>

          <TagMultiInput
            label="Responsabilidad del cliente"
            tags={responsabilidadClienteTags}
            setTags={setResponsabilidadClienteTags}
            placeholder="Escribi y presiona Enter..."
          />

          <TagMultiInput
            label="Plazos de entrega"
            tags={plazosEntregaTags}
            setTags={setPlazosEntregaTags}
            placeholder="Escribi y presiona Enter..."
          />

          <TagMultiInput
            label="Condicion de pago"
            tags={condicionPagoTags}
            setTags={setCondicionPagoTags}
            placeholder="Escribi y presiona Enter..."
          />

          <TagMultiInput
            label="Tipo de instalacion"
            tags={tipoInstalacionTags}
            setTags={setTipoInstalacionTags}
            placeholder="Escribi y presiona Enter..."
          />

          <TagMultiInput
            label="Garantia"
            tags={garantiaTags}
            setTags={setGarantiaTags}
            placeholder="Escribi y presiona Enter..."
          />

          <TagMultiInput
            label="Observaciones de producto"
            tags={observacionesProductoTags}
            setTags={setObservacionesProductoTags}
            placeholder="Escribí y presioná Enter..."
          />
        </div>


      {/* ================= PREVIEW / PDF (A4) ================= */}
      <div id="quote-print" className="bg-white border rounded-xl p-0">
        <div className="mx-auto text-[12px] leading-5" style={{ width: `${CONTENT_W_MM}mm` }}>
          <div className="quote-header">
            <div className="quote-logo">
              <div className="quote-logo-text">
                <span className="quote-logo-grupo">grupo</span>
                <span className="quote-logo-atm">atm</span>
              </div>
              <div className="quote-logo-swoosh" aria-hidden="true"></div>
            </div>
            <div className="quote-banner">
              <div className="quote-banner-orange"></div>
              <div className="quote-banner-blue">COTIZACION</div>
            </div>
          </div>

          <div className="flex justify-between items-start px-4 mt-3 avoid-break">
            <div className="text-[14px]">
              <div className="font-semibold">{cliente || deal.org_name}</div>
              <div className="text-slate-600">Atn. {contacto || deal.contact_name || '—'}</div>
            </div>
            <div className="text-right text-[12px] text-slate-700">
              <div>Asunción {fecha}</div>
              <div className="font-semibold">REF. N° {ref || deal.reference}</div>
            </div>
          </div>

          {/* COTIZACION */}
          <div className="px-4 mt-3 avoid-break">
            <div className="text-center font-bold underline">COTIZACION</div>
            <div className="mt-3 text-[11px] text-slate-800">
              <div>
                CON GUSTO LE PRESENTAMOS NUESTRO PRESUPUESTO PARA LOS PRODUCTOS QUE ESTA
                CONSIDERANDO ADQUIRIR. NOS COMPLACE
              </div>
              <div>OFRECERLE SOLUCIONES QUE SE ADAPTEN PERFECTAMENTE A SUS NECESIDADES.</div>
              <div>
                A CONTINUACION, DETALLAMOS LOS PRODUCTOS Y LOS COSTOS SEGUN LOS DETALLES
                DE SU PEDIDO.
              </div>
            </div>

            <div className="mt-3 border rounded" style={{ borderColor: '#9ca3af' }}>
              <div className="grid grid-cols-2 gap-x-8 p-3 text-[11px]">
                <div className="space-y-1">
                  <div>
                    <span className="font-semibold">CONDICION DE VENTA:</span>{' '}
                    {terminos.condicionVenta || '-'}
                  </div>
                  <div>
                    <span className="font-semibold">FORMA DE PAGO:</span>{' '}
                    {terminos.formaPago || '-'}
                  </div>
                  <div>
                    <span className="font-semibold">COMENTARIO:</span>{' '}
                    {observaciones || '-'}
                  </div>
                </div>
                <div className="space-y-1">
                  <div>
                    <span className="font-semibold">PLAZO DE CREDITO:</span>{' '}
                    {terminos.plazoCredito || '-'}
                  </div>
                  <div>
                    <span className="font-semibold">VALIDEZ DE LA OFERTA:</span>{' '}
                    {terminos.validez || '-'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* DETALLE DE COSTOS */}
          <div className="px-4 mt-4 avoid-break">
            <div className="uppercase font-bold text-white px-3 py-2 rounded-t" style={{ backgroundColor: BRAND_BLUE }}>
              Detalle de Costos
            </div>
            <table className="w-full border-collapse border-x border-b rounded-b" style={{ borderColor: '#d1d5db' }}>
              <thead>
                <tr className="text-white uppercase" style={{ backgroundColor: BRAND_BLUE }}>
                  <th className="text-left px-2 py-2">Cantidad</th>
                  <th className="text-left px-2 py-2">Servicio</th>
                  <th className="text-left px-2 py-2">Descripción</th>
                  <th className="text-left px-2 py-2">Moneda</th>
                  <th className="text-right px-2 py-2">Valor</th>
                </tr>
              </thead>
              <tbody>
                {displayItems.map((it, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: '#e5e7eb' }}>
                    <td className="px-2 py-1">{it.cantidad || 1}</td>
                    <td className="px-2 py-1">{it.servicio}</td>
                    <td className="px-2 py-1">{it.observacion}</td>
                    <td className="px-2 py-1">{it.moneda}</td>
                    <td className="px-2 py-1 text-right">
                      {money(
                        (num(it.cantidad) || 1) * num(it.precio),
                        Math.max(decimalsFrom(it.precio), decimalsFrom(it.cantidad))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t" style={{ borderColor: '#e5e7eb' }}>
                  <td colSpan={4} className="px-2 py-2 font-semibold text-right">TOTAL USD</td>
                  <td className="px-2 py-2 font-extrabold text-right">{money(totalUSD, totalUsdDecimals)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* ✨ Qué incluye */}
          {incluyeTags.length > 0 && (
            <div className="px-4 mt-4 avoid-break">
              <div className="uppercase font-bold text-white px-3 py-2 rounded-t" style={{ backgroundColor: BRAND_BLUE }}>
                Qué incluye
              </div>
              <div className="border-x border-b p-3 rounded-b" style={{ borderColor: '#d1d5db' }}>
                <ListFromText text={tagsToText(incluyeTags)} />
              </div>
            </div>
          )}

          {/* ✨ Qué no incluye */}
          {noIncluyeTags.length > 0 && (
            <div className="px-4 mt-4 avoid-break">
              <div className="uppercase font-bold text-white px-3 py-2 rounded-t" style={{ backgroundColor: BRAND_BLUE }}>
                Qué no incluye
              </div>
              <div className="border-x border-b p-3 rounded-b" style={{ borderColor: '#d1d5db' }}>
                <ListFromText text={tagsToText(noIncluyeTags)} />
              </div>
            </div>
          )}

          {responsabilidadClienteTags.length > 0 && (
            <div className="px-4 mt-4 avoid-break">
              <div className="uppercase font-bold text-white px-3 py-2 rounded-t" style={{ backgroundColor: BRAND_BLUE }}>
                Responsabilidad del cliente
              </div>
              <div className="border-x border-b p-3 rounded-b" style={{ borderColor: '#d1d5db' }}>
                <ListFromText text={tagsToText(responsabilidadClienteTags)} />
              </div>
            </div>
          )}

          {plazosEntregaTags.length > 0 && (
            <div className="px-4 mt-4 avoid-break">
              <div className="uppercase font-bold text-white px-3 py-2 rounded-t" style={{ backgroundColor: BRAND_BLUE }}>
                Plazos de entrega
              </div>
              <div className="border-x border-b p-3 rounded-b" style={{ borderColor: '#d1d5db' }}>
                <ListFromText text={tagsToText(plazosEntregaTags)} />
              </div>
            </div>
          )}

          {condicionPagoTags.length > 0 && (
            <div className="px-4 mt-4 avoid-break">
              <div className="uppercase font-bold text-white px-3 py-2 rounded-t" style={{ backgroundColor: BRAND_BLUE }}>
                Condicion de pago
              </div>
              <div className="border-x border-b p-3 rounded-b" style={{ borderColor: '#d1d5db' }}>
                <ListFromText text={tagsToText(condicionPagoTags)} />
              </div>
            </div>
          )}

          {tipoInstalacionTags.length > 0 && (
            <div className="px-4 mt-4 avoid-break">
              <div className="uppercase font-bold text-white px-3 py-2 rounded-t" style={{ backgroundColor: BRAND_BLUE }}>
                Tipo de instalacion
              </div>
              <div className="border-x border-b p-3 rounded-b" style={{ borderColor: '#d1d5db' }}>
                <ListFromText text={tagsToText(tipoInstalacionTags)} />
              </div>
            </div>
          )}

          {garantiaTags.length > 0 && (
            <div className="px-4 mt-4 avoid-break">
              <div className="uppercase font-bold text-white px-3 py-2 rounded-t" style={{ backgroundColor: BRAND_BLUE }}>
                Garantia
              </div>
              <div className="border-x border-b p-3 rounded-b" style={{ borderColor: '#d1d5db' }}>
                <ListFromText text={tagsToText(garantiaTags)} />
              </div>
            </div>
          )}

          {observacionesProductoTags.length > 0 && (
            <div className="px-4 mt-4 avoid-break">
              <div className="uppercase font-bold text-white px-3 py-2 rounded-t" style={{ backgroundColor: BRAND_BLUE }}>
                Observaciones de producto
              </div>
              <div className="border-x border-b p-3 rounded-b" style={{ borderColor: '#d1d5db' }}>
                <ListFromText text={tagsToText(observacionesProductoTags)} />
              </div>
            </div>
          )}


          {/* Observaciones */}
          {observaciones && (
            <div className="px-4 mt-4 avoid-break">
              <div className="uppercase font-bold text-white px-3 py-2 rounded-t" style={{ backgroundColor: BRAND_BLUE }}>
                Observaciones
              </div>
              <div className="border-x border-b p-3 rounded-b whitespace-pre-wrap" style={{ borderColor: '#d1d5db' }}>
                {observaciones}
              </div>
            </div>
          )}

          {/* TÉRMINOS Y CONDICIONES */}
          {(terminos?.validez || terminos?.condicionVenta || terminos?.plazoCredito || terminos?.formaPago) && (
            <div className="px-4 mt-4 avoid-break">
              <div
                className="uppercase font-bold text-white px-3 py-2 rounded-t"
                style={{ backgroundColor: BRAND_BLUE }}
              >
                Términos y condiciones
              </div>
              <div className="border-x border-b p-3 rounded-b" style={{ borderColor: '#d1d5db' }}>
                <ul className="list-disc ml-6">
                  {terminos?.validez && (
                    <li>
                      <b>Validez de la oferta:</b> {terminos.validez}
                    </li>
                  )}
                  {terminos?.condicionVenta && (
                    <li>
                      <b>Condición de venta:</b> {terminos.condicionVenta}
                    </li>
                  )}
                  {terminos?.plazoCredito && (
                    <li>
                      <b>Plazo de crédito:</b> {terminos.plazoCredito}
                    </li>
                  )}
                  {terminos?.formaPago && (
                    <li>
                      <b>Forma de pago:</b> {terminos.formaPago}
                    </li>
                  )}
                </ul>
              </div>
            </div>
          )}

          {/* FIRMA */}
          <div className="px-4 mt-8 mb-8 grid grid-cols-2 gap-6 avoid-break">
            <div></div>
            <div>
              <div className="uppercase">{(user?.name || 'LIDER GONZALEZ')}</div>
              <div className="text-slate-500">FIRMA DE ACEPTACIÓN</div>
              <div className="mt-6 border-t pt-2 text-slate-400 text-sm">DOCUMENTO NRO.: ___________________</div>
              <div className="text-slate-400 text-sm">NOMBRE: _____________________________</div>
              <div className="text-slate-400 text-sm">FECHA: ______________________________</div>
              <div className="text-slate-400 text-sm">SELLO: ______________________________</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Fila etiqueta-valor */
function Row({ label, value, className = '' }){
  return (
    <div className={className}>
      <span className="font-semibold uppercase text-[12px] tracking-wide text-slate-700">{label}:</span>{' '}
      <span className="text-slate-900">{value || '—'}</span>
    </div>
  );
}

/** Tabla de ítems separada (para mantener limpio el componente) */
function ItemsTable({ items, setItems, totalUSD, totalDecimals }) {
  const included = items.filter((it) => it.include !== false);
  const decimalsForTotal =
    typeof totalDecimals === 'number'
      ? totalDecimals
      : included.reduce(
          (acc, it) => Math.max(acc, decimalsFrom(it.precio), decimalsFrom(it.cantidad)),
          0
        );

  const updateItem = (idx, patch) => setItems(prev => prev.map((it,i)=> i===idx ? { ...it, ...patch } : it));
  const removeItem = (idx) => setItems(prev => prev.filter((_,i)=>i!==idx));
  const addItem = () =>
    setItems((prev) => [
      ...prev,
      {
        cantidad: 1,
        servicio: '',
        Observacion: '',
        moneda: 'USD',
        precio: '',
        impuesto: 'EXENTA',
        include: true,
      },
    ]);

  return (
    <>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-1 uppercase text-slate-600">Incluye</th>
            <th className="text-left py-1 uppercase text-slate-600">Cantidad</th>
            <th className="text-left py-1 uppercase text-slate-600">Servicio</th>
            <th className="text-left py-1 uppercase text-slate-600">Descripción</th>
            <th className="text-left py-1 uppercase text-slate-600">Moneda</th>
            <th className="text-right py-1 uppercase text-slate-600">Valor</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, idx) => (
            <tr key={idx} className="border-b">
              <td>
                <input
                  type="checkbox"
                  checked={it.include !== false}
                  onChange={(e) => updateItem(idx, { include: e.target.checked })}
                />
              </td>
              <td><input className="w-16 border rounded px-1" value={it.cantidad} onChange={e=>updateItem(idx, { cantidad: e.target.value })} /></td>
              <td><input className="w-full border rounded px-1" value={it.servicio} onChange={e=>updateItem(idx, { servicio: e.target.value })} /></td>
              <td><input className="w-full border rounded px-1" placeholder="Descripción / observación" value={it.observacion} onChange={e=>updateItem(idx, { observacion: e.target.value })} /></td>
              <td>
                <select className="border rounded px-1" value={it.moneda} onChange={e=>updateItem(idx, { moneda: e.target.value })}>
                  <option>USD</option>
                </select>
              </td>
              <td className="text-right">
                <input className="w-28 text-right border rounded px-1" value={it.precio} onChange={e=>updateItem(idx, { precio: e.target.value })} />
              </td>
              <td>
                <button className="text-red-600" onClick={()=>removeItem(idx)}>✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-between mt-2">
        <button className="px-3 py-1 rounded bg-blue-600 text-white" onClick={addItem}>+ Agregar ítem</button>
        <div className="text-sm font-bold">TOTAL USD {money(totalUSD, decimalsForTotal)}</div>
      </div>
    </>
  );
}

/** Selector de parámetro + input libre (patrón reutilizado) */
function ParamWithInput({ label, value, onChange, options = [] }) {
  return (
    <label className="block">
      {label}
      <div className="flex gap-2">
        <select className="border rounded px-2 py-1" onChange={(e)=>e.target.value && onChange(e.target.value)} value="">
          <option value="">— Elegir de parámetros —</option>
          {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
        <input value={value} onChange={e=>onChange(e.target.value)} className="flex-1 border rounded px-2 py-1" />
      </div>
    </label>
  );
}

/** Input de TAGS (chips) con select de parámetros + entrada libre */
function TagMultiInput({ label, tags, setTags, options = [], placeholder = '' }) {
  const [input, setInput] = useState('');

  const add = (val) => {
    const v = String(val || '').trim();
    if (!v) return;
    if (tags.some(t => t.toLowerCase() === v.toLowerCase())) return; // evita duplicados
    setTags([...tags, v]);
  };
  const addMany = (vals=[]) => vals.forEach(add);
  const remove = (idx) => setTags(tags.filter((_,i)=>i!==idx));

  const commitInput = () => {
    if (!input.trim()) return;
    addMany(parseTags(input));
    setInput('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === 'Tab') {
      e.preventDefault();
      commitInput();
    } else if (e.key === 'Backspace' && !input && tags.length) {
      // backspace sobre input vacío borra el último tag
      remove(tags.length - 1);
    }
  };

  const onBlur = () => commitInput();

  return (
    <div className="text-sm">
      <div className="mb-1 font-medium">{label}</div>
      <div className="flex gap-2 mb-2">
        <select
          className="border rounded px-2 py-1"
          onChange={(e)=>{ if(e.target.value){ add(e.target.value); e.target.value=''; } }}
          defaultValue=""
        >
          <option value="">— Elegir de parámetros —</option>
          {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
        <span className="text-xs text-slate-500 self-center">o escribir como tags</span>
      </div>

      {/* Contenedor tipo "chips" */}
      <div
        className="min-h-[42px] border rounded px-2 py-2 flex flex-wrap gap-2 focus-within:ring-2 focus-within:ring-black/10"
      >
        {tags.map((t, i) => (
          <span key={`${t}-${i}`} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
            {t}
            <button
              type="button"
              className="text-slate-500 hover:text-slate-700"
              onClick={()=>remove(i)}
              aria-label="Eliminar"
            >×</button>
          </span>
        ))}
        <input
          className="flex-1 min-w-[160px] outline-none"
          placeholder={placeholder}
          value={input}
          onChange={(e)=>setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
        />
      </div>
      <p className="text-xs text-slate-500 mt-1">
        Tips: presioná <b>Enter</b>, <b>,</b> o <b>;</b> para crear un tag. También podés pegar una lista y se separa automáticamente.
      </p>
    </div>
  );
}

/** Convierte texto multi-línea en lista <ul> si hay varias líneas */
function ListFromText({ text }) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    return <div className="whitespace-pre-wrap">{text}</div>;
  }
  return (
    <ul className="list-disc ml-6">
      {lines.map((l, i) => <li key={i}>{l}</li>)}
    </ul>
  );
}

/* Fila etiqueta ":" valor para la grilla de especificaciones (valores alineados) */
function KVRow({ label, value }) {
  const show = (v) => (String(v || '').trim() ? v : '—');
  return (
    <>
      <div className="kv-label">{label}:</div>
      <div className="text-slate-900">{show(value)}</div>
    </>
  );
}
