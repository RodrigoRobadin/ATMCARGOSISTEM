// server/src/routes/params.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

/* ===== import “tolerante” del auditor ===== */
let logAudit = async () => {};
try {
  const mod = await import('../middlewares/audit.js');
  if (mod?.logAudit) logAudit = mod.logAudit;
} catch (e) {
  console.warn('[params] audit.js no encontrado. Continúo sin auditoría.');
}

/* ========= Asegurar tabla (con try/catch para no romper arranque) ========== */
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS param_values (
        id INT AUTO_INCREMENT PRIMARY KEY,
        \`key\`   VARCHAR(100) NOT NULL,
        \`value\` VARCHAR(255) NOT NULL,
        \`ord\`   INT NOT NULL DEFAULT 0,
        \`active\` TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_key(\`key\`, \`ord\`),
        INDEX idx_active(\`active\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Ampliar columna value para plantillas largas (TEXT)
    try {
      const [[col]] = await pool.query(
        `
        SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
          FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'param_values'
           AND COLUMN_NAME = 'value'
        `
      );
      const dataType = String(col?.DATA_TYPE || '').toLowerCase();
      const maxLen = Number(col?.CHARACTER_MAXIMUM_LENGTH || 0);
      if (dataType !== 'text' || maxLen < 1000) {
        await pool.query(`ALTER TABLE param_values MODIFY COLUMN \`value\` TEXT NOT NULL`);
      }
    } catch (e) {
      console.error('[params] no se pudo ajustar columna value:', e?.message || e);
    }

    // Seed: plantilla PRODUCTOS RAYFLEX si no existe
    try {
      const [[found]] = await pool.query(
        `SELECT id FROM param_values WHERE \`key\` = 'quote_template' AND \`value\` LIKE '%PRODUCTOS RAYFLEX%' LIMIT 1`
      );
      if (!found?.id) {
        const template = {
          name: "PRODUCTOS RAYFLEX",
          incluye: [
            "INSTALACION DE LOS EQUIPOS, LAS MISMAS SE CONFIRMAN Y RECOTIZACION SEGUN CONDICIONES DE CADA LUGAR AL MOMENTO DE LA INSTALACION.",
            "EN CASO DE RETRASOS EN LA INSTALACION POR FALTA DE CUMPLIMIENTO EN REQUISITOS Y O SUMINISTROS DE ENERGIA ELECTRICA Y O DETALLES AJENOS A NUESTROS SERVICIOS, LOS SERVICIOS TENDRAN COSTOS EXTRAS QUE COMUNICAREMOS AL MOMENTO."
          ],
          no_incluye: [
            "TODO EL DETALLE QUE NO SE HAN MENCIONADO EN LA PRESENTE COTIZACION.",
            "NO REALIZAMOS PROYECTOS DE OBRAS CIVILES.",
            "DESMONTAJE DE PUERTAS ANTERIORES NI ADECUACION DEL VANO.",
            "MAQUINARIAS PESADAS COMO ELEVADORES, MONTACARGAS.",
            "TRABAJOS EN HORARIOS NOCTURNOS, FIN DE SEMANA O FERIADOS. (TODOS ESTOS PUNTOS SE RECOTIZAN SEGUN NECESIDAD DEL CLIENTE).",
            "COBERTURAS SEGURIDAD INDUSTRIAL Y EVALUACIONES DE RIESGOS POR TRABAJO.",
            "EN CASO DE ADQUIRIR RAMPAS ELECTROHIDRAULICAS, LA CONSTRUCCION DEL FOSO Y LA INSTALACION DE LA CANTONERA QUEDAN A CARGO DEL CLIENTE.",
            "EN CASO DE ADQUIRIR RAMPAS MANUALES, LA INSTALACION DE LA CANTONERA QUEDA A CARGO DEL CLIENTE.",
            "ES RESPONSABILIDAD DE ATM REALIZAR LA ENTREGA DEL PRODUCTO SOBRE CAMION EN EL PUNTO DE DESTINO (PLANTA O LOCAL DEL CLIENTE)."
          ],
          responsabilidad_cliente: [
            "TRANSPORTE HORIZONTAL Y VERTICAL EN LA OBRA PARA DESCARGAR EL MATERIAL Y LOCOMOCION HASTA EL PUNTO DE INSTALACION.",
            "SUMINISTRO DE PUNTO DE ENERGIA PARA HERRAMIENTAS ELECTRICAS.",
            "LOCAL PARA GUARDAR MATERIALES / HERRAMIENTAS.",
            "RETIRADA DE INTERFERENCIAS INFORMADAS EN LA FICHA DE VISITA TECNICA.",
            "TODO Y CUALQUIER SERVICIO DE ALBANILERIA / HORMIGON.",
            "DEMOLICIONES O RETIRADA DE OBJETOS / MAQUINAS Y OTROS QUE SE ENCUENTRAN EN EL LOCAL DE MONTAJE.",
            "SUMINISTRO DE PUNTO DE ENERGIA PARA EL PRODUCTO, EN LOS LOCALES Y EN LAS POTENCIAS INDICADAS POR NOSOTROS.",
            "QUEDA A CARGO DE LA PARTE CONTRATANTE LA DISPONIBILIDAD DE UN TECNICO DE SEGURIDAD EN JORNADA."
          ],
          plazos_entrega: [
            "EN 8/10 (OCHO/DIEZ) SEMANAS APROXIMADAMENTE, TRAS RECIBIR EL PRESUPUESTO CONFIRMADO, CON LA INSPECCION TECNICA IN SITU (CHECK LIST/FICHA TECNICA), PARA LA FABRICACION, APROBACION TECNICA Y COMERCIAL DE LAS MISMAS, ASI COMO EL PAGO."
          ],
          condicion_pago: [
            "PRODUCTOS RAYFLEX (60,30,10)."
          ],
          tipo_instalacion: [
            "LA PREPARACION DEL LOCAL ES DE RESPONSABILIDAD DEL CLIENTE, SIENDO QUE RAYFLEX/GRUPO ATM PROVEERA LOS DISENOS TECNICOS Y LAS ORIENTACIONES PARA LA PREPARACION DEL LOCAL.",
            "ASI COMO TAMBIEN LA ALIMENTACION ELECTRICA A MANO DE LA PUERTA A SER INSTALADA COMO LAS LLAVES TERMO MAGNETICAS EN EL TABLERO QUE SE ESPECIFICARAN DURANTE LA INSPECCION FINAL PARA COLOCACION DE LOS EQUIPOS."
          ],
          garantia: [
            "LOS PRODUCTOS RAYFLEX TIENEN GARANTIA DE CONDICIONES NORMALES DE USO, DESDE EL MOMENTO QUE SON INSTALADOS POR EL EQUIPO TECNICO AUTORIZADO, DURANTE UN PERIODO DE:",
            "PUERTAS AUTOMATICAS: PARTES MECANICAS: 12 (DOCE) MESES DESDE LA RECEPCION EN PLANTA O 15.000 CICLOS (LO QUE TENGA LUGAR PRIMERO).",
            "PUERTAS AUTOMATICAS: PARTES ELECTRONICAS Y LONA VINILICA: 06 (SEIS) MESES DESDE LA RECEPCION EN PLANTA O 15.000 CICLOS (LO QUE TENGA LUGAR PRIMERO).",
            "PUERTAS SECCIONALES: PARTES MECANICAS: 06 (SEIS) MESES DESDE LA RECEPCION EN PLANTA O 15.000 CICLOS (LO QUE TENGA LUGAR PRIMERO).",
            "ABRIGO: 12 (DOCE) MESES DESDE LA RECEPCION EN PLANTA.",
            "NIVELADORES Y MINI RAMPA: 12 (DOCE) MESES DESDE LA RECEPCION EN PLANTA.",
            "LA GARANTIA SE APLICA A LOS ITEM(S) DANADO(S).",
            "NO NOS RESPONSABILIZAMOS POR LAS CONSECUENCIAS RESULTANTES DEL USO INDEBIDO, POR MOTIVO E FUERZA MAYOR O CASO FORTUITO. EN ESTE CASO, SE COBRAN LOS GASTOS DE TRANSPORTES DE NUESTROS TECNICOS (VIAJES, ALOJAMIENTO, ALIMENTACION Y/O ENVIO DE MATERIAL).",
            "SE SUGIEREN MANTENIMIENTOS PREVENTIVOS CADA 6 (SEIS) MESES CON COSTOS A CARGO DEL CLIENTE. (NO INCLUYEN CAMBIO DE PIEZAS DANADAS POR MAL USO O CASO FORTUITO).",
            "USO O CASO FORTUITO."
          ],
          observaciones: [
            "LOS PRECIOS SON IVA INCLUIDO."
          ]
        };
        await pool.query(
          `INSERT INTO param_values (\`key\`, \`value\`, \`ord\`, \`active\`) VALUES ('quote_template', ?, 10, 1)`,
          [JSON.stringify(template)]
        );
      }
    } catch (e) {
      console.error('[params] no se pudo seedear plantilla:', e?.message || e);
    }
  } catch (e) {
    console.error('[params] no se pudo asegurar tabla param_values:', e?.message || e);
  }
})();

/* ====== Fallbacks útiles para selects (cuando la tabla aún no tiene data) ====== */
const FALLBACK_OPTIONS = {
  operation_type: [
    { value: 'IMPORT',   label: 'Importación' },
    { value: 'EXPORT',   label: 'Exportación' },
    { value: 'EXTERIOR', label: 'Exterior' },
  ],
};

/**
 * Util: mapea filas crudas a opciones {value,label}
 * Si hubiera en el futuro una columna "label", acá se usaría.
 */
function mapRowsToOptions(rows = []) {
  return rows.map(r => ({
    value: r.value,
    label: r.value, // hoy no hay columna "label" en la tabla; usamos el value como label
  }));
}

/**
 * GET /api/params?keys=a,b,c&only_active=1
 * Respuesta: { key1: [{id,value,ord,active}], key2: [...] }
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const keys = String(req.query.keys || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const onlyActive = String(req.query.only_active || '').trim() === '1';

    const where = [];
    const params = [];

    if (keys.length) {
      where.push(`\`key\` IN (${keys.map(() => '?').join(',')})`);
      params.push(...keys);
    }
    if (onlyActive) {
      where.push('`active` = 1');
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.query(
      `
        SELECT id, \`key\`, \`value\`, \`ord\`, \`active\`
          FROM param_values
        ${whereSql}
        ORDER BY \`key\`, \`ord\`, \`value\`
      `,
      params
    );

    const out = {};
    rows.forEach(r => {
      if (!out[r.key]) out[r.key] = [];
      out[r.key].push(r);
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/params/:key
 * Devuelve filas crudas SOLO para esa clave.
 * Query opcional: ?only_active=1
 */
router.get('/:key', requireAuth, async (req, res, next) => {
  try {
    const key = String(req.params.key || '').trim();
    if (!key) return res.status(400).json({ error: 'key requerida' });

    const onlyActive = String(req.query.only_active || '').trim() === '1';

    const where = ['`key` = ?'];
    const params = [key];
    if (onlyActive) where.push('`active` = 1');

    const [rows] = await pool.query(
      `
        SELECT id, \`key\`, \`value\`, \`ord\`, \`active\`
          FROM param_values
         WHERE ${where.join(' AND ')}
         ORDER BY \`ord\`, \`value\`
      `,
      params
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/params/:key/options
 * Devuelve opciones normalizadas para selects: [{value,label}]
 * Fallback automático para "operation_type" si no hay datos en la tabla.
 */
router.get('/:key/options', requireAuth, async (req, res, next) => {
  try {
    const key = String(req.params.key || '').trim();
    if (!key) return res.status(400).json({ error: 'key requerida' });

    const onlyActive = String(req.query.only_active || '').trim() === '1';

    const where = ['`key` = ?'];
    const params = [key];
    if (onlyActive) where.push('`active` = 1');

    const [rows] = await pool.query(
      `
        SELECT id, \`key\`, \`value\`, \`ord\`, \`active\`
          FROM param_values
         WHERE ${where.join(' AND ')}
         ORDER BY \`ord\`, \`value\`
      `,
      params
    );

    let options = mapRowsToOptions(rows);
    if (!options.length && FALLBACK_OPTIONS[key]) {
      options = FALLBACK_OPTIONS[key];
    }
    res.json(options);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/params
 * Body: { key, value, ord?, active? }
 * Solo admin.
 */
router.post('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { key, value } = req.body || {};
    let { ord, active } = req.body || {};
    if (!key || !value) return res.status(400).json({ error: 'key y value son requeridos' });

    if (ord === undefined || ord === null || ord === '') {
      const [[m]] = await pool.query(
        `SELECT COALESCE(MAX(\`ord\`), -1) AS maxord FROM param_values WHERE \`key\` = ?`,
        [key]
      );
      ord = Number(m?.maxord ?? -1) + 1;
    }

    const [ins] = await pool.query(
      `INSERT INTO param_values (\`key\`, \`value\`, \`ord\`, \`active\`) VALUES (?, ?, ?, ?)`,
      [key, value, Number(ord) || 0, active ? 1 : 0]
    );
    const [[row]] = await pool.query(
      `SELECT id, \`key\`, \`value\`, \`ord\`, \`active\` FROM param_values WHERE id=?`,
      [ins.insertId]
    );

    await logAudit(req, {
      action: 'create',
      entity: 'param_value',
      entityId: ins.insertId,
      message: `Creado parámetro ${key}=${value}`,
      payload: { key, value, ord, active: active ? 1 : 0 }
    });

    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/params/:id
 * Body: { value?, ord?, active? }
 * Solo admin
 */
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const sets = [];
    const params = [];

    if (Object.prototype.hasOwnProperty.call(req.body, 'value')) {
      sets.push('`value` = ?'); params.push(req.body.value);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'ord')) {
      sets.push('`ord` = ?'); params.push(Number(req.body.ord) || 0);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'active')) {
      sets.push('`active` = ?'); params.push(req.body.active ? 1 : 0);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada para actualizar' });

    params.push(id);
    const [r] = await pool.query(`UPDATE param_values SET ${sets.join(', ')} WHERE id = ?`, params);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });

    const [[row]] = await pool.query(
      `SELECT id, \`key\`, \`value\`, \`ord\`, \`active\` FROM param_values WHERE id=?`,
      [id]
    );

    await logAudit(req, {
      action: 'update',
      entity: 'param_value',
      entityId: Number(id),
      message: `Actualizado parámetro id=${id}`,
      payload: req.body
    });

    res.json(row);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/params/:id
 * Solo admin
 */
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const [[prev]] = await pool.query(
      `SELECT id, \`key\`, \`value\`, \`ord\`, \`active\` FROM param_values WHERE id=?`,
      [id]
    );

    const [r] = await pool.query(`DELETE FROM param_values WHERE id = ?`, [id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });

    await logAudit(req, {
      action: 'delete',
      entity: 'param_value',
      entityId: Number(id),
      message: `Eliminado parámetro id=${id}`,
      payload: prev || null
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
