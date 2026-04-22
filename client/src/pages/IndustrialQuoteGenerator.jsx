// client/src/pages/IndustrialQuoteGenerator.jsx

import React, { useEffect, useMemo, useState } from 'react';

import { Link, useParams, useSearchParams, useLocation } from 'react-router-dom';

import { API_BASE, api } from '../api';

import { useAuth } from '../auth.jsx';
import { RichTextContent, RichTextDialogField } from '../components/RichTextEditor.jsx';
import { htmlToPlainText, sanitizeRichTextHtml } from '../utils/richText';

import useParamOptions from '../hooks/useParamOptions';



// 👉 Cabecera gráfica desde /public (no requiere import):

const HEADER_SRC = `${import.meta.env.BASE_URL}quote-header.png`;



// ====== Constantes PDF (tamaño industrial 340 x 541 mm) ======

const PDF_PAGE_W_MM = 340;

const PDF_PAGE_H_MM = 541;

const FORMAL_PAGE_W_MM = 291;

const FORMAL_PAGE_H_MM = 406;

const PDF_MARGIN = { top: 0, right: 0, bottom: 0, left: 0 };

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



  return new Intl.NumberFormat('es-PY', {

    minimumFractionDigits: decs,

    maximumFractionDigits: decs,

  }).format(numeric);

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

const PUBLIC_BASE = String(API_BASE || '').replace(/\/api$/, '');

const resolvePublicAssetUrl = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(data:|https?:\/\/)/i.test(raw)) return raw;
  if (raw.startsWith('/')) return `${PUBLIC_BASE}${raw}`;
  return raw;
};

const FORMAL_MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

function parseLooseDate(raw) {
  if (!raw) return new Date();
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  const text = String(raw).trim();
  if (!text) return new Date();

  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) return direct;

  const match = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]) - 1;
    const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
    const parsed = new Date(year, month, day);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return new Date();
}

function formatFormalDate(raw, city = 'Asuncion') {
  const date = parseLooseDate(raw);
  const day = date.getDate();
  const month = FORMAL_MONTHS[date.getMonth()] || '';
  const year = date.getFullYear();
  return `${city} ${day} de ${month} de ${year}`;
}



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

  // separa solo por líneas / bullets para no cortar textos largos (plantillas)

  return String(raw)

    .split(/\r?\n+/g)

    .map(s => s.replace(/^\s*[-–•]\s*/, '').trim())

    .filter(Boolean);

}

const tagsToText = (tags=[]) => tags.map(t => t.trim()).filter(Boolean).join('\n');

const tagsToTextareaValue = (tags = []) =>
  Array.isArray(tags) ? tags.map((t) => String(t ?? '')).join('\n') : String(tags ?? '');



function normalizeTemplateSection(val) {

  if (Array.isArray(val)) return val.map(String).map(s => s.trim()).filter(Boolean);

  if (typeof val === 'string') return parseTags(val);

  return [];

}

function pickFirstFilledValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') {
      if (value.trim() === '') continue;
      return value;
    }
    return value;
  }
  return '';
}

function normalizeIndustrialItem(item = {}, idx = 0, fallbackCurrency = 'USD') {
  const servicio =
    String(
      item?.servicio ??
      item?.description ??
      item?.descripcion ??
      ''
    ).trim() || `Item ${idx + 1}`;

  const rawObservacionHtml = pickFirstFilledValue(
    item?.observacion_html,
    item?.ObservacionHtml,
    item?.observation_html,
    item?.description_html
  );

  const rawObservacion = pickFirstFilledValue(
    item?.observacion,
    item?.Observacion,
    item?.observation,
    item?.observations
  );

  const observacionHtml = sanitizeRichTextHtml(rawObservacionHtml || rawObservacion || '');
  const observacion = String(rawObservacion || htmlToPlainText(observacionHtml) || '').trim();

  return {
    ...item,
    cantidad: item?.cantidad ?? item?.quantity ?? item?.qty ?? 1,
    servicio,
    observacion,
    observacion_html: observacionHtml,
    moneda: item?.moneda ?? item?.currency_code ?? item?.currency ?? fallbackCurrency,
    precio: item?.precio ?? item?.unit_price ?? item?.sale_price ?? 0,
    impuesto: item?.impuesto || 'EXENTA',
    include: item?.include !== false,
  };
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

  const params = useParams();
  const location = useLocation();
  const id = params.id;
  const serviceCaseIdParam = params.serviceCaseId || params.caseId || params.id;

  const [searchParams] = useSearchParams();

  const revisionId = searchParams.get('revision_id');
  const isEmbed = searchParams.get('embed') === '1';
  const serviceCaseIdFromQuery = Number(searchParams.get('serviceCaseId') || searchParams.get('caseId') || '');
  const serviceCaseId = Number.isFinite(serviceCaseIdFromQuery) ? serviceCaseIdFromQuery : Number(serviceCaseIdParam || 0);
  const isServicePath = location.pathname.startsWith('/service/');
  const isService = isServicePath || (Number.isFinite(serviceCaseId) && serviceCaseId > 0);
  const baseId = isService ? serviceCaseId : id;

  const { user } = useAuth();



  const [loading, setLoading] = useState(true);

  const [deal, setDeal] = useState(null);

  const [cf, setCf] = useState({});
  const [opCurrency, setOpCurrency] = useState('USD');
  const [opRate, setOpRate] = useState(1);
  const currencyLabel = (opCurrency === 'PYG' || opCurrency === 'GS') ? 'Gs' : 'USD';



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

  const [quoteBranding, setQuoteBranding] = useState({
    logoUrl: '',
    city: 'Asuncion',
    footerWeb: 'www.atmcargo.com.py',
    footerAddress: 'Cptan. Urbieta 175 e/ Av. Mcal. Lopez y Rio de Janeiro Asuncion - Paraguay',
    footerPhone: 'Tel. +595 21 490382 / 444706',
  });



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

    setGarantiaTags(normalizeTemplateSection(template.garantia ?? template.asistencia_garantia));

    setObservacionesProductoTags(normalizeTemplateSection(template.observaciones_producto));

    if (template.observaciones) setObservaciones(template.observaciones);

  };







  

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/params', {
          params: {
            keys: [
              'quote_template',
              'quote_brand_logo_url',
              'quote_brand_city',
              'quote_brand_footer_web',
              'quote_brand_footer_address',
              'quote_brand_footer_phone',
            ].join(','),
            only_active: 1,
          },
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

        const firstValue = (key) => {
          const entries = Array.isArray(data?.[key]) ? data[key] : [];
          const match = entries.find((row) => String(row?.value || '').trim() !== '');
          return match?.value || '';
        };

        setQuoteBranding((prev) => ({
          ...prev,
          logoUrl: resolvePublicAssetUrl(firstValue('quote_brand_logo_url')),
          city: firstValue('quote_brand_city') || prev.city,
          footerWeb: firstValue('quote_brand_footer_web') || prev.footerWeb,
          footerAddress: firstValue('quote_brand_footer_address') || prev.footerAddress,
          footerPhone: firstValue('quote_brand_footer_phone') || prev.footerPhone,
        }));

        // Plantilla fija Rayflex si no existe en params
        const rayflexTemplate = {
          name: 'PRODUCTOS RAYFLEX',
          data: {
            observaciones: `OBSERVACIONES
LOS PRECIOS INDICADOS YA INCLUYEN EL IMPUESTO AL VALOR AGREGADO (IVA)
ESTA COTIZACION CONTEMPLA UNICAMENTE LOS ITEMS DESCRIPTOS EN EL DOCUMENTO
TIPO DE INSTALACION- LA PREPARACIÓN DEL LOCAL ES DE RESPONSABILIDAD DEL CLIENTE, SIENDO QUE RAYFLEX/GRUPO ATM PROVEERÁ LOS DISEÑOS TÉCNICOS
Y LAS ORIENTACIONES PARA LA PREPARACIÓN DEL LOCAL.- ASÍ COMO TAMBIÉN LA ALIMENTACIÓN ELÉCTRICA A MANO DE LA PUERTA A SER INSTALADA COMO LAS LLAVES TERMO MAGNÉTICAS EN EL
TABLERO QUE SE ESPECIFICARAN DURANTE LA INSPECCIÓN FINAL PARA COLOCACIÓN DE LOS EQUIPOS.
CONDICION DE PAGO- 60 % A LA CONFIRMACION DEL PRESUPUESTO- 30 % AL MOMENTO DE LA RECEPCIÓN DE LA PUERTA EN PLANTA, PREVIO A LA COORDINACIÓN DE LA INSTALACIÓN.- 10 % A LA FINALIZACIÓN DE LA INSTALACIÓN, INCLUYENDO PRUEBAS DE FUNCIONAMIENTO Y PUESTA EN MARCHA.
OBSERVACIÓN:
EL PLAZO MÁXIMO PARA LA INSTALACIÓN SERÁ DE 30 DÍAS CALENDARIO CONTADOS A PARTIR DE LA ENTREGA DE LAS PUERTAS
EN PLANTA. EN CASO DE QUE DICHA INSTALACIÓN NO SE PUEDA EJECUTAR DENTRO DE ESTE PLAZO POR CAUSAS AJENAS A
GRUPO ATM, EL PAGO DEL SALDO RESTANTE (10%) DEBERÁ SER IGUALMENTE PROCESADO AL CUMPLIRSE DICHO PLAZO.
TIPO DE ENTREGA
DDP   DEPOSITO O INSTALACIONES DEL CLIENTE.`,
            plazo_entrega: `PLAZO DE ENTREGA
EN 8/10 (OCHO/DIEZ) SEMANAS APROXIMADAMENTE, TRAS RECIBIR EL PRESUPUESTO CONFIRMADO,
CON LA INSPECCION TECNICA "IN SITU" (CHECK LIST/FICHA TECNICA), PARA LA FABRICACION, APROBACION TECNICA
Y COMERCIAL DE LAS MISMAS, ASI COMO EL PAGO`,
            asistencia_garantia: `ASISTENCIA Y GARANTIA- LOS PRODUCTOS RAYFLEX TIENEN GARANTÍA DE CONDICIONES NORMALES DE USO, DESDE EL MOMENTO QUE SON
INSTALADOS POR EL EQUIPO TÉCNICO AUTORIZADO, DURANTE UN PERIODO DE:
1. PUERTAS AUTOMÁTICAS:
1.1 PARTES MECÁNICAS: 12 (DOCE) MESES DESE LA RECEPCION EN PLANTA 0 15.000 CICLOS (LO QUE TENGA LUGAR PRIMERO).
1.2 PARTES ELECTRÓNICAS Y LONA VINÍLICA: 06 (SEIS) MESES DESDE LA RECEPCION EN PLANTA O 15.000 CICLOS (LO QUE TENGA LUGAR PRIMERO)
2 PUERTAS SECCIONALES:
2.1 PARTES MECÁNICAS: 06 (SEIS) MESES DESDE LA RECEPCION EN PLANTA O 15.000 CICLOS (LO QUE TENGA LUGAR PRIMERO)
3. ABRIGO: 12 (DOCE) MESES DESDE LA RECEPCION EN PLANTA
4. NIVELADORES Y MINI RAMPA: 12 (DOCE) MESES DESDE LA RECEPCION EN PLANTA.- LA GARANTÍA SE APLICA A LOS ÍTEM(S) DAÑADO(S)- NO NOS RESPONSABILIZAMOS POR LAS CONSECUENCIAS RESULTANTES DEL USO INDEBIDO, POR MOTIVO E FUERZA MAYOR O CASO FORTUITO- EN ESTE CASO, SE COBRAN LOS GASTOS DE TRANSPORTES DE NUESTROS TÉCNICOS (VIAJES, ALOJAMIENTO, ALIMENTACIÓN Y/O ENVÍO DE MATERIAL.)- SE SUGIEREN MANTENIMIENTOS PREVENTIVOS CADA 6 (SEIS) MESES CON COSTOS A CARGO DEL CLIENTE. (NO INCLUYEN CAMBIO DE PIEZAS DAÑADAS POR MAL
USO O CASO FORTUITO)`,
            responsabilidad_cliente: `RESPONSABILIDAD DEL CLIENTE
1. TRANSPORTE HORIZONTAL Y VERTICAL EN LA OBRA PARA DESCARGAR EL MATERIAL Y LOCOMOCIÓN HASTA EL PUNTO DE INSTALACIÓN.
2. SUMINISTRO DE PUNTO DE ENERGÍA PARA HERRAMIENTAS ELÉCTRICAS.
3. LOCAL PARA GUARDAR MATERIALES / HERRAMIENTAS.
4. RETIRADA DE INTERFERENCIAS INFORMADAS EN LA FICHA DE VISITA TÉCNICA.
5. TODO Y CUALQUIER SERVICIO DE ALBAÑILERÍA / HORMIGÓN.
6. DEMOLICIONES O RETIRADA DE OBJETOS / MÁQUINAS Y OTROS QUE SE ENCUENTRAN EN EL LOCAL DE MONTAJE.
7. SUMINISTRO DE PUNTO DE ENERGÍA PARA EL PRODUCTO, EN LOS LOCALES Y EN LAS POTENCIAS INDICADAS POR NOSOTROS
8. QUEDA A CARGO DE LA PARTE CONTRATANTE LA DISPONIBILIDAD DE UN TÉCNICO DE SEGURIDAD EN JORNADA`,
            que_incluye: `EL PRESUPUESTO INCLUYE
1. INSTALACIÓN DE LOS EQUIPOS, LAS MISMAS SE CONFIRMAN Y RECOTIZACIÓN SEGÚN CONDICIONES DE CADA LUGAR AL MOMENTO DE LA
INSTALACIÓN.
2. EN CASO DE RETRASOS EN LA INSTALACIÓN POR FALTA DE CUMPLIMIENTO EN REQUISITOS Y O SUMINISTROS DE ENERGÍA ELÉCTRICA Y
O DETALLES AJENOS A NUESTROS SERVICIOS, LOS SERVICIOS TENDRÁN COSTOS EXTRAS QUE COMUNICAREMOS AL MOMENTO.`,
            que_no_incluye: `EL PRESUPUESTO NO INCLUYE
1. TODO EL DETALLE QUE NO SE HAN MENCIONADO EN LA PRESENTE COTIZACIÓN.
2. NO REALIZAMOS PROYECTOS DE OBRAS CIVILES.
3. DESMONTAJE DE PUERTAS  ANTERIORES NI ADECUACIÓN DEL VANO
4. MAQUINARIAS PESADAS COMO ELEVADORES, MONTACARGAS.
5. TRABAJOS EN HORARIOS NOCTURNOS, FIN DE SEMANA O FERIADOS. (TODOS ESTOS PUNTOS SE RECOTIZAN SEGUN NECESIDAD
DEL CLIENTE)
6. COBERTURAS SEGURIDAD INDUSTRIAL Y EVALUACIONES DE RIESGOS POR TRABAJO
7. EN CASO DE ADQUIRIR RAMPAS ELECTROHIDRÁULICAS, LA CONSTRUCCIÓN DEL FOSO Y LA INSTALACIÓN DE LA CANTONERA QUEDAN A CARGO DEL CLIENTE.
8. EN CASO DE ADQUIRIR RAMPAS MANUALES, LA INSTALACIÓN DE LA CANTONERA QUEDA A CARGO DEL CLIENTE
9. ES RESPONSABILIDAD DE ATM REALIZAR LA ENTREGA DEL PRODUCTO SOBRE CAMIÓN EN EL PUNTO DE DESTINO (PLANTA O LOCAL DEL CLIENTE).
LA DESCARGA DEL CAMIÓN, ASÍ COMO CUALQUIER MOVIMIENTO INTERNO, MANIPULACIÓN O REUBICACIÓN DEL PRODUCTO DENTRO DE LAS INSTALACIONES,
NO SON RESPONSABILIDAD DE ATM Y QUEDARÁN A CARGO EXCLUSIVO DEL CLIENTE.
ANTE CONSULTAS O DETALLES QUEDAMOS A VUESTRA ENTERA DISPOSICIÓN.
CORDIALES SALUDOS`,
          },
        };
        const hasRayflex = parsed.some((p) => p.name === rayflexTemplate.name);
        const mergedTemplates = hasRayflex ? parsed : [...parsed, rayflexTemplate];
        setTemplateOptions(mergedTemplates);
      } catch (e) {
        console.error('No se pudieron cargar plantillas:', e);
        setTemplateOptions([]);
      }
    })();
  }, []);

// =================== Carga + PREFILL robusto ===================

  useEffect(() => {

    (async () => {

      setLoading(true);

      try {

        const [{ data: detail }, cfRes, quoteRes] = await Promise.all([

          api.get(isService ? `/service/cases/${baseId}` : `/deals/${baseId}`),

          api.get(isService ? `/service/cases/${baseId}/custom-fields` : `/deals/${baseId}/custom-fields`).catch(() => ({ data: [] })),

          api.get(isService ? `/service/cases/${baseId}/quote` : `/deals/${baseId}/quote`, { params: revisionId ? { revision_id: revisionId } : {} }).catch(() => ({ data: null })),

        ]);

        if (isService) {
          const caseData = detail?.case || detail?.data || detail;
          setDeal({
            id: caseData?.id,
            reference: caseData?.reference,
            org_name: caseData?.org_name,
            contact_name: caseData?.contact_name || "",
          });
        } else {
          setDeal(detail.deal);
        }

        const qInputs = quoteRes?.data?.quote?.inputs || quoteRes?.data?.inputs || {};
        const cur = String(qInputs.operation_currency || 'USD').toUpperCase();
        const rate = Number(qInputs.exchange_rate_operation_sell_usd || 1) || 1;
        setOpCurrency(cur);
        setOpRate(rate);



        const cfMap = {};

        (cfRes.data || []).forEach((r) => (cfMap[r.key] = r.value ?? ''));

        setCf(cfMap);



        const header = {};



        const merged = {

          ...buildNormalizedMap(cfMap, 'cf'),

          ...buildNormalizedMap(header, 'hdr'),

        };



        // Cabecera simple
        if (isService) {
          const caseData = detail?.case || detail?.data || detail;
          setCliente(caseData?.org_name || '');
          setContacto(caseData?.contact_name || '');
          setRef(caseData?.reference || '');
        } else {
          setCliente(detail.deal?.org_name || '');
          setContacto(detail.deal?.contact_name || '');
          setRef(detail.deal?.reference || '');
        }



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

        const savedItemsRaw = cfMap['industrial_items_json'];

        let mapped = [];
        let savedItems = [];

        if (savedItemsRaw) {

          try {

            const parsed = JSON.parse(savedItemsRaw);

            if (Array.isArray(parsed)) {

              savedItems = parsed.map((it, idx) => normalizeIndustrialItem(it, idx, cur || 'USD'));

            }

          } catch (e) {

            console.warn('No se pudo parsear items guardados', e);

          }

        }

        // Preferimos los ítems crudos guardados en la cotización (inputs) para traer descripción + observación actuales
        const rawItems =
          quoteRes?.data?.quote?.inputs?.items ||
          quoteRes?.data?.inputs?.items ||
          [];
        const ofertaItems = quoteRes?.data?.computed?.oferta?.items || [];
        const resultadoItems = quoteRes?.data?.computed?.resultado?.items || [];
        const pricingItems = ofertaItems.length ? ofertaItems : resultadoItems;
        const pricingByLine = new Map(
          pricingItems.map((it, idx) => [String(it?.line_no ?? idx + 1), it])
        );
        const sourceItems = rawItems.length
          ? rawItems
          : (pricingItems.length ? pricingItems : resultadoItems);
        const hasSourceItems = sourceItems.some(
          (it) => Number(it.qty || 0) > 0 || String(it.description || it.servicio || it.descripcion || "").trim()
        );
        const isPyg = cur === 'PYG' || cur === 'GS';
        const rateValue = Number(rate || 1) || 1;
        const conv = (v) => (isPyg ? Number(v || 0) * rateValue : Number(v || 0));

        if (hasSourceItems) {

          const savedByLine = new Map(
            savedItems.map((it, idx) => [String(it.line_no ?? idx), it])
          );

          mapped = sourceItems

            .filter((it) => Number(it.qty || 0) > 0 || String(it.description || it.servicio || it.descripcion || "").trim())

            .map((it, idx) => {
              const pricingItem =
                pricingByLine.get(String(it.line_no ?? idx + 1)) ||
                pricingItems[idx] ||
                null;

              const qty = Number(
                it.qty ??
                it.quantity ??
                it.cantidad ??
                pricingItem?.qty ??
                pricingItem?.quantity ??
                pricingItem?.cantidad ??
                0
              ) || 1;
              const totalSales = Number(
                pricingItem?.total_sales ??
                pricingItem?.total_ventas ??
                pricingItem?.total_sales_usd ??
                pricingItem?.total_venta ??
                it.total_sales ??
                it.total_ventas ??
                it.total_sales_usd ??
                it.total_venta ??
                0
              );
              const pvUnit = Number(
                pricingItem?.pv_unit ??
                pricingItem?.pv_unit_usd ??
                pricingItem?.pv ??
                pricingItem?.precio_venta_unit ??
                pricingItem?.unit_price ??
                it.pv_unit ??
                it.pv_unit_usd ??
                it.pv ??
                it.precio_venta_unit ??
                0
              );
              const manualSale = Number(
                it.sale_price ??
                pricingItem?.sale_price ??
                pricingItem?.sale_price_input ??
                0
              );
              const door = Number(it.door_value_usd ?? pricingItem?.door_value_usd ?? 0);
              const extra = Number(it.additional_usd ?? pricingItem?.additional_usd ?? 0);
              const unitBase =
                pvUnit ||
                (totalSales && qty ? totalSales / qty : 0) ||
                (manualSale && qty ? manualSale / qty : 0) ||
                pricingItem?.unit_price ||
                it.unit_price ||
                (totalSales && qty ? totalSales / qty : 0) ||
                it.precio ||
                (door + extra) ||
                (qty ? Number(it.total_sales || 0) / qty : Number(it.total_sales || 0));
              const unit = conv(unitBase);
              const saved =
                savedByLine.get(String(it.line_no ?? idx)) ||
                savedItems[idx] ||
                null;

              const savedInclude =
                saved && saved.include !== undefined ? saved.include !== false : undefined;

              return normalizeIndustrialItem({
                ...(saved || {}),
                ...it,
                line_no: saved?.line_no ?? it.line_no ?? idx + 1,
                cantidad: saved?.cantidad ?? saved?.quantity ?? saved?.qty ?? qty,
                servicio: pickFirstFilledValue(
                  saved?.servicio,
                  saved?.description,
                  saved?.descripcion,
                  it?.servicio,
                  it?.description,
                  it?.descripcion,
                  `Item ${idx + 1}`
                ),
                observacion_html: pickFirstFilledValue(
                  saved?.observacion_html,
                  saved?.ObservacionHtml,
                  saved?.observation_html,
                  saved?.description_html,
                  it?.observacion_html,
                  it?.ObservacionHtml,
                  it?.observation_html,
                  it?.description_html,
                ),
                observacion: pickFirstFilledValue(
                  saved?.observacion,
                  saved?.Observacion,
                  saved?.observation,
                  saved?.observations,
                  it?.observacion,
                  it?.Observacion,
                  it?.observation,
                  it?.observations,
                  ""
                ),
                moneda: saved?.moneda || cur || it.moneda || "USD",
                precio: saved?.precio ?? unit,
                impuesto: saved?.impuesto || it.impuesto || "EXENTA",
                include: savedInclude ?? (it.include !== false),
              }, idx, cur || 'USD');

            });

        } else {

          mapped = savedItems;

        }

        setItems(mapped);

      } finally {

        setLoading(false);

      }

    })();

  }, [baseId, isService, revisionId]);



  const normalizedItems = useMemo(

    () => items.map((it, idx) => normalizeIndustrialItem(it, idx, opCurrency || 'USD')),

    [items, opCurrency]

  );

  const displayItems = useMemo(

    () => normalizedItems.filter((it) => it.include !== false),

    [normalizedItems]

  );

  const totalCurrency = useMemo(

    () =>

      normalizedItems.reduce(

        (acc, it) =>

          it.include === false

            ? acc

            : acc +

              (num(it.precio) * (num(it.cantidad) || 1)),

        0

      ),

    [normalizedItems]

  );

  const totalCurrencyDecimals = useMemo(

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

  const customFieldEntries = useMemo(
    () => [
      ['tipo_operacion', tipoOperacion],
      ['tipo_transporte', tipoTransporte],
      ['tipo_envio', tipoEnvio],
      ['incoterms', incoterm],
      ['pais_origen', paisOrigen],
      ['pais_destino', paisDestino],
      ['ciudad_origen', ciudadOrigen],
      ['ciudad_destino', ciudadDestino],
      ['aeropuerto_origen', aeropuertoOrigen],
      ['aeropuerto_destino', aeropuertoDestino],
      ['volumen_m3', volumenM3],
      ['peso_bruto_kg', pesoBrutoKg],
      ['mercaderia', mercaderia],
      ['seguro_tipo', seguroTipo],
      ['seguro_monto_usd', montoAsegurado],
      ['aseguradora', aseguradora],
      ['observaciones', observaciones],
      ['observacion', observaciones],
      ['validez_oferta', terminos.validez],
      ['condicion_venta', terminos.condicionVenta],
      ['plazo_credito', terminos.plazoCredito],
      ['forma_pago', terminos.formaPago],
      ['que_incluye', tagsToText(incluyeTags)],
      ['que_no_incluye', tagsToText(noIncluyeTags)],
      ['quote_template', selectedTemplate?.name || selectedTemplateName || ''],
      ['responsabilidad_cliente', tagsToText(responsabilidadClienteTags)],
      ['plazos_entrega', tagsToText(plazosEntregaTags)],
      ['condicion_pago', tagsToText(condicionPagoTags)],
      ['tipo_instalacion', tagsToText(tipoInstalacionTags)],
      ['garantia', tagsToText(garantiaTags)],
      ['observaciones_producto', tagsToText(observacionesProductoTags)],
      ['industrial_items_json', JSON.stringify(normalizedItems)],
    ],
    [
      tipoOperacion,
      tipoTransporte,
      tipoEnvio,
      incoterm,
      paisOrigen,
      paisDestino,
      ciudadOrigen,
      ciudadDestino,
      aeropuertoOrigen,
      aeropuertoDestino,
      volumenM3,
      pesoBrutoKg,
      mercaderia,
      seguroTipo,
      montoAsegurado,
      aseguradora,
      observaciones,
      terminos,
      incluyeTags,
      noIncluyeTags,
      selectedTemplate?.name,
      selectedTemplateName,
      responsabilidadClienteTags,
      plazosEntregaTags,
      condicionPagoTags,
      tipoInstalacionTags,
      garantiaTags,
      observacionesProductoTags,
      normalizedItems,
    ]
  );

  const currentSaveSignature = useMemo(
    () => JSON.stringify(customFieldEntries),
    [customFieldEntries]
  );



  // =================== Guardar en CF ===================

  const [saving, setSaving] = useState(false);
  const [lastSavedSignature, setLastSavedSignature] = useState('');
  const [signatureKeyReady, setSignatureKeyReady] = useState('');
  const signatureKey = `${baseId || 'na'}:${revisionId || 'base'}:${isService ? 'service' : 'deal'}`;

  useEffect(() => {
    setLastSavedSignature('');
    setSignatureKeyReady('');
  }, [signatureKey]);

  useEffect(() => {
    if (loading) return;
    if (signatureKeyReady === signatureKey) return;
    setLastSavedSignature(currentSaveSignature);
    setSignatureKeyReady(signatureKey);
  }, [loading, signatureKeyReady, signatureKey, currentSaveSignature]);

  const hasUnsavedChanges =
    signatureKeyReady === signatureKey && currentSaveSignature !== lastSavedSignature;

  async function saveToCustomFields() {

    try {

      setSaving(true);

      await Promise.all(customFieldEntries.map(async ([key, value]) => {

        const def = CF_SCHEMA[key] || { label: key, type: 'text' };

        await api.post(isService ? `/service/cases/${baseId}/custom-fields` : `/deals/${baseId}/custom-fields`, {

          key,

          label: def.label,

          type: def.type === 'number' ? 'number' : 'text',

          value: value === '' ? null : value,

        });

      }));



      const { data: cfs } = await api.get(isService ? `/service/cases/${baseId}/custom-fields` : `/deals/${baseId}/custom-fields`).catch(() => ({ data: [] }));

      const map = {};

      (cfs || []).forEach((r) => (map[r.key] = r.value ?? ''));

      setCf(map);
      setLastSavedSignature(currentSaveSignature);
      setSignatureKeyReady(signatureKey);



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

        html2canvas: { scale: 2.5, useCORS: true, backgroundColor: '#ffffff' },

        jsPDF: { unit: 'mm', format: [PDF_PAGE_W_MM, PDF_PAGE_H_MM], orientation: 'portrait' },

        pagebreak: { mode: ['css', 'legacy'] },

      };

      html2pdf().from(el).set(opt).save();

    } catch {

      alert('No se pudo generar el PDF.');

    }

  }



  function buildFormalSubject() {
    const summary = displayItems
      .slice(0, 3)
      .map((item) => {
        const qty = Number(item?.cantidad || 0);
        const name = String(item?.servicio || '').trim();
        if (!name) return '';
        return qty > 0 ? `${qty} ${name}` : name;
      })
      .filter(Boolean)
      .join(' + ');
    if (summary) return `REF. N° ${ref || deal?.reference || ''} / ${summary}`;
    return `REF. N° ${ref || deal?.reference || ''}`;
  }

  async function exportFormalPdf(mode = 'download') {
    const source = document.getElementById('quote-formal-print');
    if (!source) return;

    const mount = document.createElement('div');
    mount.style.position = 'fixed';
    mount.style.left = '0';
    mount.style.top = '0';
    mount.style.width = `${FORMAL_PAGE_W_MM}mm`;
    mount.style.background = '#ffffff';
    mount.style.visibility = 'hidden';
    mount.style.pointerEvents = 'none';
    mount.style.zIndex = '999999';
    mount.style.overflow = 'hidden';

    const el = source.cloneNode(true);
    el.id = 'quote-formal-print-export';
    mount.appendChild(el);
    document.body.appendChild(mount);

    try {
      const html2pdf = await ensureHtml2Pdf();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.all(
        Array.from(el.querySelectorAll('img')).map(
          (img) =>
            new Promise((resolve) => {
              if (img.complete) return resolve();
              img.onload = () => resolve();
              img.onerror = () => resolve();
            })
        )
      );
      const exportWidth = Math.ceil(el.getBoundingClientRect().width || el.scrollWidth || 794);

      const filename = `${(ref || deal?.reference || 'cotizacion').replace(/[^\w.-]+/g, '_')}-formal.pdf`;
      const opt = {
        margin: [0, 0, 0, 0],
        filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2.4,
          useCORS: true,
          backgroundColor: '#ffffff',
          width: exportWidth,
          windowWidth: exportWidth,
          scrollX: 0,
          scrollY: 0,
          x: 0,
          y: 0,
        },
        jsPDF: { unit: 'mm', format: [FORMAL_PAGE_W_MM, FORMAL_PAGE_H_MM], orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      };

      const worker = html2pdf().from(el).set(opt);
      if (mode === 'download') {
        await worker.save();
        return;
      }

      await worker.toPdf();
      const pdf = await worker.get('pdf');
      pdf.output('dataurlnewwindow');
    } catch (e) {
      console.error('No se pudo generar el PDF formal:', e);
      alert('No se pudo generar el PDF formal.');
    } finally {
      document.body.removeChild(mount);
    }
  }
  const formalLogoUrl = quoteBranding.logoUrl;
  const formalDateLabel = formatFormalDate(fecha, quoteBranding.city);
  const formalCustomerName = cliente || deal?.org_name || 'CLIENTE';
  const formalContactName = contacto || deal?.contact_name || '';
  const formalSubject = buildFormalSubject();
  const formalDeliveryAddress = [ciudadDestino, paisDestino].filter(Boolean).join(', ');
  const formalComment = tagsToText(observacionesProductoTags);
  const formalDeliveryType = incoterm || 'DDP';
  const formalFooterWeb = quoteBranding.footerWeb || 'www.atmcargo.com.py';
  const formalFooterAddress = quoteBranding.footerAddress || '';
  const formalFooterPhone = quoteBranding.footerPhone || '';
  const formalDocProps = {
    logoUrl: formalLogoUrl,
    dateLabel: formalDateLabel,
    customerName: formalCustomerName,
    contactName: formalContactName,
    subject: formalSubject,
    saleCondition: terminos.condicionVenta || '-',
    creditTerm: terminos.plazoCredito || '-',
    paymentMethod: terminos.formaPago || '-',
    offerValidity: terminos.validez || '-',
    comment: formalComment || '-',
    items: displayItems,
    currencyCode: opCurrency || 'USD',
    currencyLabel,
    totalCurrency,
    totalCurrencyDecimals,
    observations: observaciones,
    installationType: tagsToText(tipoInstalacionTags),
    paymentCondition: tagsToText(condicionPagoTags),
    deliveryType: formalDeliveryType,
    deliveryAddress: formalDeliveryAddress,
    deliveryTerm: tagsToText(plazosEntregaTags),
    footerWeb: formalFooterWeb,
    footerAddress: formalFooterAddress,
    footerPhone: formalFooterPhone,
    warrantyText: tagsToText(garantiaTags),
    customerResponsibility: tagsToText(responsabilidadClienteTags),
    includesText: tagsToText(incluyeTags),
    excludesText: tagsToText(noIncluyeTags),
  };

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

        .formal-print-shell{
          display: none;
        }

        .formal-page{
          width: ${FORMAL_PAGE_W_MM}mm;
          min-height: 0;
          padding: 6mm 8mm 8mm;
          box-sizing: border-box;
          background: #fff;
          color: #111827;
          font-family: Arial, Helvetica, sans-serif;
          position: relative;
          overflow: visible;
          break-after: auto;
          page-break-after: auto;
        }

        .formal-header{
          display: flex;
          align-items: stretch;
          justify-content: space-between;
          gap: 10mm;
          margin-bottom: 3mm;
        }

        .formal-logo-box{
          width: 58mm;
          display: flex;
          align-items: center;
          justify-content: center;
          padding-top: 1mm;
        }

        .formal-logo-box img{
          max-width: 100%;
          max-height: 24mm;
          object-fit: contain;
        }

        .formal-logo-fallback{
          font-size: 18pt;
          font-weight: 700;
          letter-spacing: .3px;
        }

        .formal-logo-fallback .grupo{ color: #111827; }
        .formal-logo-fallback .atm{ color: #ef5a2f; margin-left: 4px; }

        .formal-title-box{
          flex: 1;
          position: relative;
          height: 26mm;
          overflow: hidden;
          margin-top: 0;
        }

        .formal-title-orange{
          position: absolute;
          left: 0;
          top: 0;
          width: 30%;
          height: 100%;
          background: #ef5a2f;
          border-top-right-radius: 32mm;
          border-bottom-right-radius: 32mm;
        }

        .formal-title-blue{
          position: absolute;
          right: 0;
          top: 0;
          width: 84%;
          height: 100%;
          background: #445f84;
          border-top-left-radius: 32mm;
          border-bottom-left-radius: 32mm;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-style: italic;
          font-weight: 700;
          font-size: 14pt;
          letter-spacing: .4px;
        }

        .formal-date-line{
          text-align: right;
          font-size: 8.5pt;
          margin-bottom: 8mm;
        }

        .formal-customer{
          font-size: 9.5pt;
          margin-bottom: 1mm;
        }

        .formal-customer strong{
          display: block;
          font-size: 11.5pt;
          text-transform: uppercase;
        }

        .formal-ref-title{
          text-align: center;
          font-weight: 700;
          font-size: 6.2mm;
          margin: 0 0 1mm;
          text-transform: uppercase;
          line-height: 1.12;
        }

        .formal-main-title{
          text-align: center;
          font-size: 5.6mm;
          font-weight: 700;
          text-decoration: underline;
          margin-bottom: 5mm;
          text-transform: uppercase;
        }

        .formal-intro{
          font-size: 8.5pt;
          line-height: 1.28;
          margin-bottom: 4mm;
          text-transform: uppercase;
        }

        .formal-conditions{
          border: 1px solid #9ea6af;
          padding: 2.2mm 3mm 2mm;
          margin-bottom: 3mm;
        }

        .formal-conditions-grid{
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.2mm 8mm;
          font-size: 8.7pt;
        }

        .formal-conditions-row{
          display: grid;
          grid-template-columns: 34mm 1fr;
          gap: 2mm;
          min-height: 5mm;
        }

        .formal-conditions-label{
          font-weight: 700;
          text-transform: uppercase;
        }

        .formal-section-title{
          text-align: center;
          font-size: 10pt;
          font-weight: 700;
          text-decoration: underline;
          margin: 1.5mm 0;
          text-transform: uppercase;
        }

        .formal-products{
          width: 100%;
          border-collapse: collapse;
        }

        .formal-products th{
          background: #445f84;
          color: #fff;
          font-size: 7.7pt;
          padding: 1.4mm 1.4mm;
          text-transform: uppercase;
          border: 1px solid #7a8796;
        }

        .formal-products td{
          border-bottom: 1px solid #c7cdd4;
          font-size: 7.8pt;
          padding: 1.2mm 1.4mm;
          vertical-align: top;
        }

        .formal-products .small{
          font-size: 7.2pt;
          line-height: 1.16;
        }

        .rich-text-content{
          white-space: normal;
        }

        .rich-text-content p,
        .rich-text-content div{
          margin: 0 0 1mm;
        }

        .rich-text-content p:last-child,
        .rich-text-content div:last-child{
          margin-bottom: 0;
        }

        .rich-text-content ul,
        .rich-text-content ol{
          margin: 0 0 1mm 4mm;
          padding: 0;
        }

        .formal-center{ text-align: center; }
        .formal-right{ text-align: right; }

        .formal-total-box{
          border: 1px solid #9ea6af;
          display: grid;
          grid-template-columns: 1fr 32mm 34mm;
          margin-top: 2.2mm;
        }

        .formal-total-box div{
          padding: 1.6mm 2.2mm;
          font-size: 9pt;
          font-weight: 700;
          text-transform: uppercase;
        }

        .formal-total-label{ text-align: center; }

        .formal-block{
          margin-bottom: 2mm;
          page-break-inside: avoid;
        }

        .formal-block h3{
          margin: 0 0 0.8mm;
          font-size: 9pt;
          font-weight: 700;
          text-transform: uppercase;
          text-decoration: underline;
          font-style: italic;
        }

        .formal-lines p{
          margin: 0 0 0.7mm;
          font-size: 8.4pt;
          line-height: 1.22;
          text-transform: uppercase;
        }

        .formal-footer{
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 5mm;
          width: 100%;
        }

        .formal-footer-web{
          font-size: 10pt;
          font-weight: 700;
          color: #111827;
        }

        .formal-footer-bar{
          flex: 1;
          position: relative;
          height: 13mm;
          overflow: hidden;
        }

        .formal-footer-orange{
          position: absolute;
          left: 0;
          top: 0;
          width: 26%;
          height: 100%;
          background: #ef5a2f;
          border-top-right-radius: 22mm;
          border-bottom-right-radius: 22mm;
        }

        .formal-footer-blue{
          position: absolute;
          right: 0;
          top: 0;
          width: 76%;
          height: 100%;
          background: #445f84;
          border-top-left-radius: 22mm;
          border-bottom-left-radius: 22mm;
          color: #fff;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 0 6mm;
          font-size: 7.8pt;
          text-align: center;
        }

        .formal-acceptance{
          margin-top: 8mm;
          padding-left: 2mm;
        }

        .formal-acceptance h2{
          font-size: 11pt;
          font-weight: 700;
          text-transform: uppercase;
          text-decoration: underline;
          margin-bottom: 6mm;
        }

        .formal-acceptance-row{
          display: flex;
          align-items: center;
          gap: 4mm;
          margin: 6mm 0;
          font-size: 9.5pt;
          text-transform: uppercase;
        }

        .formal-acceptance-row strong{
          min-width: 28mm;
        }

        .formal-acceptance-line{
          flex: 1;
          border-bottom: 1px dotted #333;
          height: 0;
        }

        /* tabla de especificaciones: columna 1 = etiqueta+":" , columna 2 = valor */

        .kv-grid{

          display: grid;

          grid-template-columns: 230px 1fr; /* 👈 valores alineados (más ancho para tipografía grande) */

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

          padding: 10px 8px 8px 8px;

          column-gap: 16px;
          flex-wrap: nowrap;

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
          flex: 0 0 auto;

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

          width: 520px;
          max-width: none;
          flex: 0 0 auto;

        }

        .quote-banner-orange{

          position: absolute;

          left: 0;

          top: 0;

          height: 48px;

          width: 160px;

          background: #c62828;

          border-top-right-radius: 40px;

          border-bottom-right-radius: 40px;

        }

        .quote-banner-blue{

          position: absolute;

          right: 0;

          top: 0;

          height: 48px;

          width: 360px;

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
      <div className={"flex items-center justify-between " + (isEmbed ? "hidden" : "")}>
        <h1 className="text-xl font-semibold">Generar Presupuesto - REF {deal.reference}</h1>
        <div className="space-x-2 flex items-center">
          <div
            className={
              "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs " +
              (hasUnsavedChanges
                ? "border-amber-300 bg-amber-50 text-amber-800"
                : "border-emerald-300 bg-emerald-50 text-emerald-700")
            }
            title={hasUnsavedChanges ? "Hay cambios pendientes de guardar en la operación" : "Todos los cambios ya están guardados"}
          >
            <span
              className={
                "inline-block h-2 w-2 rounded-full " +
                (hasUnsavedChanges ? "bg-amber-500" : "bg-emerald-500")
              }
            />
            {hasUnsavedChanges ? "Cambios sin guardar" : "Guardado"}
          </div>
          <button
            onClick={saveToCustomFields}
            disabled={saving}
            className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-60"
          >
            {saving ? 'Guardando...' : 'Guardar en Operacion'}
          </button>
          <button onClick={downloadPdf} className="px-3 py-2 rounded bg-black text-white">
            Descargar PDF
          </button>
          <button onClick={() => exportFormalPdf('open')} className="px-3 py-2 rounded bg-slate-800 text-white">
            Ver PDF formal
          </button>
          <button onClick={() => exportFormalPdf('download')} className="px-3 py-2 rounded border border-slate-300 bg-white text-slate-800">
            Descargar PDF formal
          </button>
          <Link to={`/operations/${id}`} className="px-3 py-2 rounded bg-slate-200 hover:bg-slate-300">
            ← Volver a la operacion
          </Link>
        </div>
      </div>

      {/* Panel editable */}
      <div className={"grid grid-cols-1 lg:grid-cols-2 gap-4 " + (isEmbed ? "hidden" : "")}>

        {/* Cabecera */}

        <div className="bg-white rounded-xl border p-3 space-y-2">

          <div className="text-sm font-semibold">Cabecera</div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">

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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">

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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">

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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">

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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">

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

          <ItemsTable
            items={items}
            setItems={setItems}
            totalCurrency={totalCurrency}
            totalDecimals={totalCurrencyDecimals}
            currencyCode={opCurrency}
            currencyLabel={currencyLabel}
          />

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

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2 text-sm">

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



          <label className="text-sm block">
            Condición de pago
            <textarea
              className="w-full mt-1 border rounded px-2 py-1"
              rows={3}
              placeholder="Ej: 60% anticipo / 30% entrega / 10% puesta en marcha"
              value={tagsToTextareaValue(condicionPagoTags)}
              onChange={(e)=>setCondicionPagoTags([e.target.value])}
            />
          </label>



          <label className="text-sm block">
            Tipo de instalación
            <textarea
              className="w-full mt-1 border rounded px-2 py-1"
              rows={3}
              placeholder="Describe el tipo de instalación..."
              value={tagsToTextareaValue(tipoInstalacionTags)}
              onChange={(e)=>setTipoInstalacionTags([e.target.value])}
            />
          </label>



          <label className="text-sm block">
            Garantía
            <textarea
              className="w-full mt-1 border rounded px-2 py-1"
              rows={3}
              placeholder="Condiciones de garantía..."
              value={tagsToTextareaValue(garantiaTags)}
              onChange={(e)=>setGarantiaTags([e.target.value])}
            />
          </label>



          <TagMultiInput

            label="Observaciones de producto"

            tags={observacionesProductoTags}

            setTags={setObservacionesProductoTags}

            placeholder="Escribí y presioná Enter..."

          />

        </div>

        </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-4 py-3 border-b bg-slate-50 text-sm font-semibold">
          Vista previa formato formal
        </div>
        <div className="overflow-auto bg-slate-100 p-4">
          <FormalQuoteDocument {...formalDocProps} />
        </div>
      </div>

      {/* ================= PREVIEW / PDF (A4) ================= */}

      <div id="quote-print" className="bg-white p-0">

        <div className="mx-auto text-[14px] leading-6" style={{ width: `${CONTENT_W_MM}mm`, paddingRight: '3mm', boxSizing: 'border-box' }}>

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



          <div className="flex justify-between items-start px-1 mt-3 avoid-break">

            <div className="text-[16px]">

              <div className="font-semibold">{cliente || deal.org_name}</div>

              <div className="text-slate-600">Atn. {contacto || deal.contact_name || '—'}</div>

            </div>

            <div className="text-right text-[13px] text-slate-700">

              <div>Asunción {fecha}</div>

              <div className="font-semibold">REF. N° {ref || deal.reference}</div>

            </div>

          </div>



          {/* COTIZACION */}

          <div className="px-1 mt-3 avoid-break">

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

          <div className="px-1 mt-4 avoid-break">

            <div className="uppercase font-bold text-white px-3 py-2 rounded-t" style={{ backgroundColor: BRAND_BLUE }}>

              Detalle de Costos

            </div>

            <table className="w-full border-collapse border-x border-b rounded-b" style={{ borderColor: '#d1d5db' }}>

              <thead>

                <tr className="text-white uppercase" style={{ backgroundColor: BRAND_BLUE }}>

                  <th className="text-left px-2 py-2">Item</th>

                  <th className="text-left px-2 py-2">Cantidad</th>

                  <th className="text-left px-2 py-2">Servicio</th>

                  <th className="text-left px-2 py-2">Descripción</th>

                  <th className="text-left px-2 py-2">Moneda</th>

                  <th className="text-right px-2 py-2">Precio unit</th>

                  <th className="text-right px-2 py-2">Valor</th>

                </tr>

              </thead>

              <tbody>

                {displayItems.map((it, i) => (

                  <tr key={i} className="border-t" style={{ borderColor: '#e5e7eb' }}>

                    <td className="px-2 py-1">{i + 1}</td>

                    <td className="px-2 py-1">{it.cantidad || 1}</td>

                    <td className="px-2 py-1">{it.servicio}</td>

                    <td className="px-2 py-1">
                      <RichTextContent html={it.observacion_html || it.observacion} />
                    </td>

                    <td className="px-2 py-1">{it.moneda}</td>

                    <td className="px-2 py-1 text-right">

                      {money(num(it.precio), decimalsFrom(it.precio))}

                    </td>

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

                  <td colSpan={5} className="px-2 py-2 font-semibold text-right">TOTAL {currencyLabel}</td>

                  <td className="px-2 py-2 font-extrabold text-right">{money(totalCurrency, totalCurrencyDecimals)}</td>

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

              <div className="border-x border-b p-3 rounded-b whitespace-pre-wrap" style={{ borderColor: '#d1d5db' }}>
                {tagsToText(condicionPagoTags)}
              </div>

            </div>

          )}



          {tipoInstalacionTags.length > 0 && (

            <div className="px-4 mt-4 avoid-break">

              <div className="uppercase font-bold text-white px-3 py-2 rounded-t" style={{ backgroundColor: BRAND_BLUE }}>

                Tipo de instalacion

              </div>

              <div className="border-x border-b p-3 rounded-b whitespace-pre-wrap" style={{ borderColor: '#d1d5db' }}>
                {tagsToText(tipoInstalacionTags)}

              </div>

            </div>

          )}



          {garantiaTags.length > 0 && (

            <div className="px-4 mt-4 avoid-break">

              <div className="uppercase font-bold text-white px-3 py-2 rounded-t" style={{ backgroundColor: BRAND_BLUE }}>

                Garantia

              </div>

              <div className="border-x border-b p-3 rounded-b whitespace-pre-wrap" style={{ borderColor: '#d1d5db' }}>
                {tagsToText(garantiaTags)}

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
            <div className="text-[12px] text-slate-900">
              <div className="font-semibold uppercase underline">Firma de aceptacion</div>
              <div className="mt-2 uppercase">{(user?.name || 'LIDER GONZALEZ')}</div>
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="min-w-[90px] font-semibold uppercase">Nombre:</div>
                  <div className="flex-1 border-b border-dotted border-slate-700"></div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="min-w-[90px] font-semibold uppercase">Documento nro.:</div>
                  <div className="flex-1 border-b border-dotted border-slate-700"></div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="min-w-[90px] font-semibold uppercase">Fecha:</div>
                  <div className="flex-1 border-b border-dotted border-slate-700"></div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="min-w-[90px] font-semibold uppercase">Sello:</div>
                  <div className="flex-1 border-b border-dotted border-slate-700"></div>
                </div>
              </div>
            </div>
            <div></div>
          </div>

        </div>

      </div>

      <div className="formal-print-shell">
        <FormalQuoteDocument {...formalDocProps} containerId="quote-formal-print" />
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

function ItemsTable({ items, setItems, totalCurrency, totalDecimals, currencyCode = 'USD', currencyLabel = 'USD' }) {

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

        observacion: '',

        observacion_html: '',

        moneda: currencyCode,

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

              <td className="w-[240px]">
                <RichTextDialogField
                  value={it.observacion_html || it.observacion || it.Observacion || it.observation || ''}
                  placeholder="Descripción / observación con formato"
                  dialogTitle={`Descripción del item ${idx + 1}`}
                  minHeightClass="min-h-[220px]"
                  widthClass="w-[220px] max-w-[220px]"
                  onChange={({ html, text }) => updateItem(idx, { observacion_html: html, observacion: text })}
                />
              </td>

              <td>

                <select className="border rounded px-1" value={currencyCode} disabled>

                  <option value="USD">USD</option>
                  <option value="PYG">PYG</option>

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

        <div className="text-sm font-bold">TOTAL {currencyLabel} {money(totalCurrency, decimalsForTotal)}</div>

      </div>

    </>

  );

}



/** Selector de parámetro + input libre (patrón reutilizado) */

function ParamWithInput({ label, value, onChange, options = [] }) {

  return (

    <label className="block min-w-0">

      {label}

      <div className="mt-1 flex flex-col xl:flex-row gap-2 min-w-0">

        <select
          className="w-full xl:w-[240px] border rounded px-2 py-1 min-w-0"
          onChange={(e)=>e.target.value && onChange(e.target.value)}
          value=""
        >

          <option value="">— Elegir de parámetros —</option>

          {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}

        </select>

        <input
          value={value}
          onChange={e=>onChange(e.target.value)}
          className="w-full min-w-0 flex-1 border rounded px-2 py-1"
        />

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

function FormalLines({ text }) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return (
      <div className="formal-lines">
        <p>-</p>
      </div>
    );
  }

  return (
    <div className="formal-lines">
      {lines.map((line, index) => (
        <p key={`formal-line-${index}`}>{line}</p>
      ))}
    </div>
  );
}

function getFormalLines(text = '') {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function estimateFormalLineUnits(line = '') {
  return Math.max(1, Math.ceil(String(line || '').length / 115));
}

function splitFormalSection(title, text, maxUnits = 24) {
  const lines = getFormalLines(text);
  if (!lines.length) return [];

  const chunks = [];
  let current = [];
  let units = 0;

  for (const line of lines) {
    const lineUnits = estimateFormalLineUnits(line);
    if (current.length && units + lineUnits > maxUnits) {
      chunks.push(current);
      current = [line];
      units = lineUnits;
    } else {
      current.push(line);
      units += lineUnits;
    }
  }

  if (current.length) chunks.push(current);

  return chunks.map((chunk, index) => ({
    type: 'section',
    title: index === 0 ? title : `${title} (cont.)`,
    text: chunk.join('\n'),
    units: 2 + chunk.reduce((sum, line) => sum + estimateFormalLineUnits(line), 0),
  }));
}

function buildFormalFlowPages(sectionDefs = []) {
  const blocks = sectionDefs.flatMap((section) => splitFormalSection(section.title, section.text));
  blocks.push({ type: 'acceptance', units: 14 });

  const pages = [];
  const capacity = 42;
  let current = [];
  let used = 0;

  for (const block of blocks) {
    if (current.length && used + block.units > capacity) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(block);
    used += block.units;
  }

  if (current.length) pages.push(current);
  return pages;
}

function FormalHeader({ logoUrl }) {
  return (
    <div className="formal-header">
      <div className="formal-logo-box">
        {logoUrl ? (
          <img src={logoUrl} alt="Logo" />
        ) : (
          <div className="formal-logo-fallback">
            <span className="grupo">grupo</span>
            <span className="atm">atm</span>
          </div>
        )}
      </div>
      <div className="formal-title-box">
        <div className="formal-title-orange"></div>
        <div className="formal-title-blue">COTIZACION</div>
      </div>
    </div>
  );
}

function FormalFooter({ footerWeb, footerAddress, footerPhone }) {
  return (
    <div className="formal-footer">
      <div className="formal-footer-web">{footerWeb}</div>
      <div className="formal-footer-bar">
        <div className="formal-footer-orange"></div>
        <div className="formal-footer-blue">
          <div>{footerAddress}</div>
          <div>{footerPhone}</div>
        </div>
      </div>
    </div>
  );
}

function FormalAcceptanceBlock() {
  return (
    <div className="formal-acceptance">
      <h2>Firma de aceptacion</h2>
      <div className="formal-acceptance-row">
        <strong>Nombre:</strong>
        <div className="formal-acceptance-line"></div>
      </div>
      <div className="formal-acceptance-row">
        <strong>Documento nro.:</strong>
        <div className="formal-acceptance-line"></div>
      </div>
      <div className="formal-acceptance-row">
        <strong>Fecha:</strong>
        <div className="formal-acceptance-line"></div>
      </div>
      <div className="formal-acceptance-row">
        <strong>Sello:</strong>
        <div className="formal-acceptance-line"></div>
      </div>
    </div>
  );
}

function FormalQuoteDocument({
  containerId,
  logoUrl,
  dateLabel,
  customerName,
  contactName,
  subject,
  saleCondition,
  creditTerm,
  paymentMethod,
  offerValidity,
  comment,
  items = [],
  currencyCode = 'USD',
  currencyLabel = 'USD',
  totalCurrency = 0,
  totalCurrencyDecimals = 0,
  observations,
  installationType,
  paymentCondition,
  deliveryType,
  deliveryAddress,
  deliveryTerm,
  footerWeb,
  footerAddress,
  footerPhone,
  warrantyText,
  customerResponsibility,
  includesText,
  excludesText,
}) {
  return (
    <div id={containerId}>
      <div className="formal-page">
        <FormalHeader logoUrl={logoUrl} />

        <div className="formal-date-line">{dateLabel}</div>
        <div className="formal-customer">
          <strong>{customerName}</strong>
          {contactName ? <div>Atn. {contactName}</div> : null}
        </div>
        <div className="formal-ref-title">{subject}</div>
        <div className="formal-main-title">COTIZACION</div>

        <div className="formal-intro">
          CON GUSTO LE PRESENTAMOS NUESTRO PRESUPUESTO PARA LOS PRODUCTOS QUE ESTA CONSIDERANDO ADQUIRIR. NOS COMPLACE
          OFRECERLE SOLUCIONES QUE SE ADAPTEN PERFECTAMENTE A SUS NECESIDADES. A CONTINUACION, DETALLAMOS LOS PRODUCTOS
          Y LOS COSTOS SEGUN LOS DETALLES DE SU PEDIDO.
        </div>

        <div className="formal-conditions">
          <div className="formal-conditions-grid">
            <div className="formal-conditions-row">
              <div className="formal-conditions-label">Condicion de venta:</div>
              <div>{saleCondition}</div>
            </div>
            <div className="formal-conditions-row">
              <div className="formal-conditions-label">Plazo de credito:</div>
              <div>{creditTerm}</div>
            </div>
            <div className="formal-conditions-row">
              <div className="formal-conditions-label">Forma de pago:</div>
              <div>{paymentMethod}</div>
            </div>
            <div className="formal-conditions-row">
              <div className="formal-conditions-label">Validez de la oferta:</div>
              <div>{offerValidity}</div>
            </div>
            <div className="formal-conditions-row" style={{ gridColumn: '1 / span 2' }}>
              <div className="formal-conditions-label">Comentario:</div>
              <div>{comment}</div>
            </div>
          </div>
        </div>

        <div className="formal-section-title">Productos y servicios</div>
        <table className="formal-products">
          <thead>
            <tr>
              <th style={{ width: '12mm' }}>Item</th>
              <th style={{ width: '25mm' }}>Producto</th>
              <th style={{ width: '15mm' }}>Cantidad</th>
              <th style={{ width: '22mm' }}>Unidad de medida</th>
              <th>Descripcion</th>
              <th style={{ width: '18mm' }}>Moneda</th>
              <th style={{ width: '24mm' }}>Precio unitario</th>
              <th style={{ width: '24mm' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {items.length ? items.map((it, index) => {
              const qty = Number(it?.cantidad || 0) || 1;
              const unitPrice = num(it?.precio);
              const total = qty * unitPrice;
              return (
                <tr key={`formal-item-${index}`}>
                  <td className="formal-center">{index + 1}</td>
                  <td>{it?.servicio || '-'}</td>
                  <td className="formal-center">{qty}</td>
                  <td className="formal-center">UNIDAD</td>
                  <td className="small">
                    <RichTextContent html={it?.observacion_html || it?.observacion} />
                  </td>
                  <td className="formal-center">{it?.moneda || currencyCode}</td>
                  <td className="formal-right">{money(unitPrice, decimalsFrom(it?.precio))}</td>
                  <td className="formal-right">{money(total, Math.max(decimalsFrom(it?.precio), decimalsFrom(it?.cantidad)))}</td>
                </tr>
              );
            }) : (
              <tr>
                <td colSpan={8} className="formal-center">Sin items</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="formal-total-box">
          <div className="formal-total-label">Total</div>
          <div className="formal-center">{currencyLabel}</div>
          <div className="formal-right">{money(totalCurrency, totalCurrencyDecimals)}</div>
        </div>

        {String(observations || '').trim() ? (
          <div className="formal-block" style={{ marginTop: '4mm' }}>
            <h3>Observaciones</h3>
            <FormalLines text={observations} />
          </div>
        ) : null}

        {String(installationType || '').trim() ? (
          <div className="formal-block">
            <h3>Tipo de instalacion</h3>
            <FormalLines text={installationType} />
          </div>
        ) : null}

        {String(paymentCondition || '').trim() ? (
          <div className="formal-block">
            <h3>Condicion de pago</h3>
            <FormalLines text={paymentCondition} />
          </div>
        ) : null}

        {String(deliveryType || '').trim() ? (
          <div className="formal-block">
            <h3>Tipo de entrega</h3>
            <FormalLines text={deliveryType} />
          </div>
        ) : null}

        {String(deliveryAddress || '').trim() ? (
          <div className="formal-block">
            <h3>Direccion</h3>
            <FormalLines text={deliveryAddress} />
          </div>
        ) : null}

        {String(deliveryTerm || '').trim() ? (
          <div className="formal-block">
            <h3>Plazo de entrega</h3>
            <FormalLines text={deliveryTerm} />
          </div>
        ) : null}

        {String(warrantyText || '').trim() ? (
          <div className="formal-block">
            <h3>Asistencia y garantia</h3>
            <FormalLines text={warrantyText} />
          </div>
        ) : null}

        {String(customerResponsibility || '').trim() ? (
          <div className="formal-block">
            <h3>Responsabilidad del cliente</h3>
            <FormalLines text={customerResponsibility} />
          </div>
        ) : null}

        {String(includesText || '').trim() ? (
          <div className="formal-block">
            <h3>El presupuesto incluye</h3>
            <FormalLines text={includesText} />
          </div>
        ) : null}

        {String(excludesText || '').trim() ? (
          <div className="formal-block">
            <h3>El presupuesto no incluye</h3>
            <FormalLines text={excludesText} />
          </div>
        ) : null}

        {(footerWeb || footerAddress || footerPhone) ? (
          <div className="formal-block" style={{ marginTop: '5mm' }}>
            <FormalFooter
              footerWeb={footerWeb}
              footerAddress={footerAddress}
              footerPhone={footerPhone}
            />
          </div>
        ) : null}

        <FormalAcceptanceBlock />
      </div>
    </div>
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




