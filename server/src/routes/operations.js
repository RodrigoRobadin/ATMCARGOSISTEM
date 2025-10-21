// server/src/routes/operations.js
import { Router } from 'express';
import db from '../services/db.js'; // mysql2/promise pool

const router = Router();

/* ================== helpers ================== */
async function fetchDealHeader(id) {
  const tries = [
    `SELECT d.*,
            o.name AS organization_name,
            c.name AS contact_name,
            u.name AS owner_name
       FROM deals d
  LEFT JOIN organizations o ON o.id = d.organization_id
  LEFT JOIN contacts      c ON c.id = d.contact_id
  LEFT JOIN users         u ON u.id = d.owner_id
      WHERE d.id = ?`,
    `SELECT d.*,
            o.name AS organization_name,
            c.name AS contact_name,
            u.name AS owner_name
       FROM deals d
  LEFT JOIN organizations o ON o.id = d.organization_id
  LEFT JOIN contacts      c ON c.id = d.contact_id
  LEFT JOIN users         u ON u.id = d.user_id
      WHERE d.id = ?`,
    `SELECT d.*,
            o.name AS organization_name,
            c.name AS contact_name,
            u.name AS owner_name
       FROM deals d
  LEFT JOIN organizations o ON o.id = d.org_id
  LEFT JOIN contacts      c ON c.id = d.contact_id
  LEFT JOIN users         u ON u.id = d.owner_id
      WHERE d.id = ?`,
    `SELECT d.*,
            o.name AS organization_name,
            c.name AS contact_name,
            u.name AS owner_name
       FROM deals d
  LEFT JOIN organizations o ON o.id = d.org_id
  LEFT JOIN contacts      c ON c.id = d.contact_id
  LEFT JOIN users         u ON u.id = d.user_id
      WHERE d.id = ?`,
    `SELECT d.*,
            o.name AS organization_name,
            c.name AS contact_name
       FROM deals d
  LEFT JOIN organizations o ON o.id = d.organization_id
  LEFT JOIN contacts      c ON c.id = d.contact_id
      WHERE d.id = ?`,
    `SELECT d.* FROM deals d WHERE d.id = ?`,
  ];

  for (const sql of tries) {
    try {
      const [[row]] = await db.query(sql, [id]);
      if (row) {
        return {
          ...row,
          organization_name: row.organization_name ?? null,
          contact_name:      row.contact_name ?? null,
          owner_name:        row.owner_name ?? null,
        };
      }
    } catch (e) {
      if (e?.code !== 'ER_BAD_FIELD_ERROR') throw e;
    }
  }
  return null;
}

// última fila por deal de forma determinista (usa created_at/id si existen)
async function latestRow(table, dealId) {
  try {
    const [rows] = await db.query(
      `SELECT * FROM ${table} WHERE deal_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      [dealId]
    );
    if (rows?.[0]) return rows[0];
  } catch (e) {
    if (e?.code !== 'ER_BAD_FIELD_ERROR') throw e;
  }
  const [fallback] = await db.query(`SELECT * FROM ${table} WHERE deal_id = ? LIMIT 1`, [dealId]);
  return fallback?.[0] || null;
}

async function getDealWithDetail(id) {
  const deal = await fetchDealHeader(id);
  if (!deal) return null;

  let detail = null;
  const tt = String(deal.transport_type || '').toUpperCase();

  if (tt === 'AIR') {
    const d = await latestRow('operation_air', id);
    detail = { type: 'AIR', data: d || null };
  } else if (tt === 'OCEAN') {
    const d = await latestRow('operation_ocean', id);
    detail = { type: 'OCEAN', data: d || null };
  } else if (tt === 'ROAD') {
    const d = await latestRow('operation_road', id);
    detail = { type: 'ROAD', data: d || null };
  } else if (tt === 'MULTIMODAL') {
    const d = await latestRow('operation_multimodal', id);
    const [legs] = await db.query(`SELECT * FROM operation_legs WHERE deal_id = ? ORDER BY leg_no`, [id]);
    detail = { type: 'MULTIMODAL', data: { ...(d || {}), legs } };
  } else {
    detail = { type: deal.transport_type || 'UNKNOWN', data: null };
  }

  return { ...deal, detail };
}

/* ===================== RUTAS ===================== */

// GET detalle unificado (con anti-cache y con claves por modalidad para el front)
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const data = await getDealWithDetail(id);
    if (!data) return res.status(404).json({ error: 'Not found' });

    // desnormalizamos para el front (OperationDetail) que espera .air/.ocean/.road/.multimodal
    const payload = {
      ...data,
      air:        null,
      ocean:      null,
      road:       null,
      multimodal: null,
    };

    switch (data.detail?.type) {
      case 'AIR':        payload.air        = data.detail.data; break;
      case 'OCEAN':      payload.ocean      = data.detail.data; break;
      case 'ROAD':       payload.road       = data.detail.data; break;
      case 'MULTIMODAL': payload.multimodal = data.detail.data; break;
    }

    // anti-cache fuerte
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.json(payload);
  } catch (e) {
    console.error('[operations:get]', e);
    res.status(500).json({ error: 'GET failed' });
  }
});

// POST crear operación (sin cambios)
router.post('/', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { common = {}, type, specific = {} } = req.body || {};
    if (!type) return res.status(400).json({ error: 'type requerido' });

    await conn.beginTransaction();

    const [r] = await conn.query(
      `INSERT INTO deals
       (reference, title, value, organization_id, contact_id, owner_id,
        pipeline_id, stage_id, description, transport_type, status_ops,
        date_start, date_quote, date_confirm, incoterm, customs_broker_org_id,
        insurance, insurance_type, service_condition, invoice_no, invoice_value,
        send_report, bill_fact_shpr, bill_fact_ag, bill_trf_ag, bill_fact_prov,
        bill_rec_prov, bill_fact_atm, bill_rec_atm, payterm_doc_master,
        payterm_doc_house, payterm_freight, payterm_locals)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        common.reference || null,
        common.title || common.description || null,
        common.approx_value || 0,
        common.organization_id || null,
        common.contact_id || null,
        common.owner_id || null,
        common.pipeline_id || null,
        common.stage_id || null,
        common.description || null,
        type,
        common.status || 'A CONFIRMAR',
        common.date_start || null,
        common.date_quote || null,
        common.date_confirm || null,
        common.incoterm || null,
        common.customs_broker_org_id || null,
        common.insurance ? 1 : 0,
        common.insurance_type || null,
        common.service_condition || null,
        common.invoice_no || null,
        common.invoice_value || null,
        common.send_report ? 1 : 0,
        common.bill_fact_shpr ? 1 : 0,
        common.bill_fact_ag ? 1 : 0,
        common.bill_trf_ag ? 1 : 0,
        common.bill_fact_prov ? 1 : 0,
        common.bill_rec_prov ? 1 : 0,
        common.bill_fact_atm ? 1 : 0,
        common.bill_rec_atm ? 1 : 0,
        common.payterm_doc_master || null,
        common.payterm_doc_house || null,
        common.payterm_freight || null,
        common.payterm_locals || null
      ]
    );
    const dealId = r.insertId;

    if (type === 'AIR') {
      const origin_airport      = specific.origin_airport || specific.origin_iata || specific.origin || null;
      const destination_airport = specific.destination_airport || specific.destination_iata || specific.destination || null;
      const packages            = (specific.packages ?? specific.pieces) ?? null;

      await conn.query(
        `INSERT INTO operation_air
         (deal_id, doc_master, doc_house, shpr_cnee,
          shipper_org_id, agent_org_id, airline, provider_org_id, load_type,
          origin_airport, transshipment_airport, destination_airport, commodity, packages,
          weight_gross_kg, volume_m3, weight_chargeable_kg, dimensions_text, observations,
          etd, trans_arrival, trans_depart, eta, transit_days)
         VALUES (?,?,?,?, ?,?,?,?,?,
                 ?,?,?,
                 ?,?, ?,?,?,?,?,
                 ?,?,?,?,?)`,
        [
          dealId,
          specific.doc_master || null,
          specific.doc_house || null,
          specific.shpr_cnee || null,
          specific.shipper_org_id || null,
          specific.agent_org_id || null,
          specific.airline || null,
          specific.provider_org_id || null,
          specific.load_type || null,
          origin_airport,
          specific.transshipment_airport || null,
          destination_airport,
          specific.commodity || null,
          packages,
          specific.weight_gross_kg || null,
          specific.volume_m3 || null,
          specific.weight_chargeable_kg || null,
          specific.dimensions_text || null,
          specific.observations || null,
          specific.etd || null,
          specific.trans_arrival || null,
          specific.trans_depart || null,
          specific.eta || null,
          specific.transit_days || null
        ]
      );
    } else if (type === 'OCEAN') {
      await conn.query(
        `INSERT INTO operation_ocean
         (deal_id, mbl, hbl, shipper_org_id, agent_org_id, shipping_line, provider_org_id, load_type,
          pol, transshipment_port, pod, commodity, packages, weight_kg, volume_m3, chargeable_kg,
          transit_time_days, free_days, itinerary, doc_nav_delivery, doc_client_delivery, free_start, free_end,
          containers_json, etd, trans_arrival, trans_depart, eta, observations)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          dealId,
          specific.mbl || null,
          specific.hbl || null,
          specific.shipper_org_id || null,
          specific.agent_org_id || null,
          specific.shipping_line || null,
          specific.provider_org_id || null,
          specific.load_type || null,
          specific.pol || null,
          specific.transshipment_port || null,
          specific.pod || null,
          specific.commodity || null,
          specific.packages || null,
          specific.weight_kg || null,
          specific.volume_m3 || null,
          specific.chargeable_kg || null,
          specific.transit_time_days || null,
          specific.free_days || null,
          specific.itinerary || null,
          specific.doc_nav_delivery || null,
          specific.doc_client_delivery || null,
          specific.free_start || null,
          specific.free_end || null,
          specific.containers_json ? JSON.stringify(specific.containers_json) : null,
          specific.etd || null,
          specific.trans_arrival || null,
          specific.trans_depart || null,
          specific.eta || null,
          specific.observations || null
        ]
      );
    } else if (type === 'ROAD') {
      await conn.query(
        `INSERT INTO operation_road
         (deal_id, cmr_crt_number, provider_org_id, truck_plate, trailer_plate, driver_name, driver_phone,
          border_crossing, origin_city, destination_city, route_itinerary, cargo_class, commodity, packages,
          weight_kg, volume_m3, hazmat, temp_control, temp_c, seal_no, observations, etd, eta, transit_days)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          dealId,
          specific.cmr_crt_number || null,
          specific.provider_org_id || null,
          specific.truck_plate || null,
          specific.trailer_plate || null,
          specific.driver_name || null,
          specific.driver_phone || null,
          specific.border_crossing || null,
          specific.origin_city || null,
          specific.destination_city || null,
          specific.route_itinerary || null,
          specific.cargo_class || null,
          specific.commodity || null,
          specific.packages || null,
          specific.weight_kg || null,
          specific.volume_m3 || null,
          specific.hazmat ? 1 : 0,
          specific.temp_control ? 1 : 0,
          specific.temp_c || null,
          specific.seal_no || null,
          specific.observations || null,
          specific.etd || null,
          specific.eta || null,
          specific.transit_days || null
        ]
      );
    } else if (type === 'MULTIMODAL') {
      await conn.query(
        `INSERT INTO operation_multimodal
         (deal_id, doc_master, doc_house, crt_number, shipping_line, provider_org_id, itinerary, free_days,
          containers_json, truck_plates_json, observations)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          dealId,
          specific.doc_master || null,
          specific.doc_house || null,
          specific.crt_number || null,
          specific.shipping_line || null,
          specific.provider_org_id || null,
          specific.itinerary || null,
          specific.free_days || null,
          specific.containers_json ? JSON.stringify(specific.containers_json) : null,
          specific.truck_plates_json ? JSON.stringify(specific.truck_plates_json) : null,
          specific.observations || null
        ]
      );
      if (Array.isArray(specific.legs)) {
        for (const L of specific.legs) {
          await conn.query(
            `INSERT INTO operation_legs
             (deal_id, leg_no, mode, carrier, origin, destination, ref_doc, etd, eta, weight_kg, volume_m3, packages, details_json)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              dealId,
              L.leg_no,
              L.mode,
              L.carrier || null,
              L.origin || null,
              L.destination || null,
              L.ref_doc || null,
              L.etd || null,
              L.eta || null,
              L.weight_kg || null,
              L.volume_m3 || null,
              L.packages || null,
              L.details_json ? JSON.stringify(L.details_json) : null
            ]
          );
        }
      }
    }

    await conn.commit();
    res.status(201).json({ id: dealId });
  } catch (e) {
    await conn.rollback();
    console.error('[operations:post]', e);
    res.status(400).json({ error: 'Create failed' });
  } finally {
    conn.release();
  }
});

// PUT AÉREO (delete-then-insert para 1 sola fila por deal)
router.put('/:id/air', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const id = Number(req.params.id);
    const b  = req.body || {};

    await conn.beginTransaction();
    await conn.query(`DELETE FROM operation_air WHERE deal_id = ?`, [id]);

    await conn.query(
      `INSERT INTO operation_air
       (deal_id,
        doc_master, doc_house, shpr_cnee,
        airline,
        origin_airport, transshipment_airport, destination_airport,
        commodity, packages, weight_gross_kg, volume_m3, weight_chargeable_kg,
        dimensions_text, observations,
        etd, trans_arrival, trans_depart, eta,
        shipper_org_id, agent_org_id, provider_org_id, load_type, transit_days)
       VALUES (?,
               ?,?,?,?,
               ?,?,?,
               ?,?, ?,?,?,
               ?,?,
               ?,?,?,?,
               ?,?,?,?,?)`,
      [
        id,
        b.doc_master || null,
        b.doc_house  || null,
        b.shpr_cnee  || null,
        b.airline || null,
        b.origin_airport        || b.origin_iata        || null,
        b.transshipment_airport || null,
        b.destination_airport   || b.destination_iata   || null,
        b.commodity || null,
        b.packages === "" ? null : (b.packages ?? b.pieces ?? null),
        b.weight_gross_kg === "" ? null : (b.weight_gross_kg ?? null),
        b.volume_m3       === "" ? null : (b.volume_m3 ?? null),
        b.weight_chargeable_kg === "" ? null : (b.weight_chargeable_kg ?? null),
        b.dimensions_text || null,
        b.observations    || null,
        b.etd || null,
        b.trans_arrival || null,
        b.trans_depart  || null,
        b.eta || null,
        b.shipper_org_id  || null,
        b.agent_org_id    || null,
        b.provider_org_id || null,
        b.load_type       || null,
        b.transit_days    || null,
      ]
    );

    await conn.commit();

    const [[row]] = await conn.query(`SELECT * FROM operation_air WHERE deal_id = ? LIMIT 1`, [id]);

    // anti-cache
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.json(row || null);
  } catch (e) {
    await conn.rollback();
    console.error('[operations:put air]', e);
    res.status(400).json({ error: 'PUT air failed' });
  } finally {
    conn.release();
  }
});

// PUT OCEAN (igual que tu versión)
router.put('/:id/ocean', async (req, res) => {
  try {
    const id = Number(req.params.id), b = req.body || {};
    await db.query(
      `INSERT INTO operation_ocean
       (deal_id, mbl, hbl, shipper_org_id, agent_org_id, shipping_line, provider_org_id, load_type, pol, transshipment_port, pod,
        commodity, packages, weight_kg, volume_m3, chargeable_kg, transit_time_days, free_days, itinerary,
        doc_nav_delivery, doc_client_delivery, free_start, free_end, containers_json, etd, trans_arrival, trans_depart, eta, observations)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
        mbl=VALUES(mbl), hbl=VALUES(hbl), shipper_org_id=VALUES(shipper_org_id), agent_org_id=VALUES(agent_org_id),
        shipping_line=VALUES(shipping_line), provider_org_id=VALUES(provider_org_id), load_type=VALUES(load_type),
        pol=VALUES(pol), transshipment_port=VALUES(transshipment_port), pod=VALUES(pod), commodity=VALUES(commodity),
        packages=VALUES(packages), weight_kg=VALUES(weight_kg), volume_m3=VALUES(volume_m3),
        chargeable_kg=VALUES(chargeable_kg), transit_time_days=VALUES(transit_time_days), free_days=VALUES(free_days),
        itinerary=VALUES(itinerary), doc_nav_delivery=VALUES(doc_nav_delivery), doc_client_delivery=VALUES(doc_client_delivery),
        free_start=VALUES(free_start), free_end=VALUES(free_end), containers_json=VALUES(containers_json),
        etd=VALUES(etd), trans_arrival=VALUES(trans_arrival), trans_depart=VALUES(trans_depart), eta=VALUES(eta),
        observations=VALUES(observations)`,
      [
        id,
        b.mbl || null, b.hbl || null, b.shipper_org_id || null, b.agent_org_id || null, b.shipping_line || null,
        b.provider_org_id || null, b.load_type || null, b.pol || null, b.transshipment_port || null, b.pod || null,
        b.commodity || null, b.packages || null, b.weight_kg || null, b.volume_m3 || null, b.chargeable_kg || null,
        b.transit_time_days || null, b.free_days || null, b.itinerary || null,
        b.doc_nav_delivery || null, b.doc_client_delivery || null, b.free_start || null, b.free_end || null,
        b.containers_json ? JSON.stringify(b.containers_json) : null,
        b.etd || null, b.trans_arrival || null, b.trans_depart || null, b.eta || null, b.observations || null
      ]
    );
    const row = await latestRow('operation_ocean', id);

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.json(row || null);
  } catch (e) {
    console.error('[operations:put ocean]', e);
    res.status(400).json({ error: 'PUT ocean failed' });
  }
});

// PUT ROAD (igual que tu versión)
router.put('/:id/road', async (req, res) => {
  try {
    const id = Number(req.params.id), b = req.body || {};
    await db.query(
      `INSERT INTO operation_road
       (deal_id, cmr_crt_number, provider_org_id, truck_plate, trailer_plate, driver_name, driver_phone, border_crossing,
        origin_city, destination_city, route_itinerary, cargo_class, commodity, packages, weight_kg, volume_m3, hazmat,
        temp_control, temp_c, seal_no, observations, etd, eta, transit_days)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
        cmr_crt_number=VALUES(cmr_crt_number), provider_org_id=VALUES(provider_org_id),
        truck_plate=VALUES(truck_plate), trailer_plate=VALUES(trailer_plate), driver_name=VALUES(driver_name),
        driver_phone=VALUES(driver_phone), border_crossing=VALUES(border_crossing), origin_city=VALUES(origin_city),
        destination_city=VALUES(destination_city), route_itinerary=VALUES(route_itinerary), cargo_class=VALUES(cargo_class),
        commodity=VALUES(commodity), packages=VALUES(packages), weight_kg=VALUES(weight_kg), volume_m3=VALUES(volume_m3),
        hazmat=VALUES(hazmat), temp_control=VALUES(temp_control), temp_c=VALUES(temp_c), seal_no=VALUES(seal_no),
        observations=VALUES(observations), etd=VALUES(etd), eta=VALUES(eta), transit_days=VALUES(transit_days)`,
      [
        id,
        b.cmr_crt_number || null, b.provider_org_id || null, b.truck_plate || null, b.trailer_plate || null,
        b.driver_name || null, b.driver_phone || null, b.border_crossing || null,
        b.origin_city || null, b.destination_city || null, b.route_itinerary || null, b.cargo_class || null,
        b.commodity || null, b.packages || null, b.weight_kg || null, b.volume_m3 || null,
        b.hazmat ? 1 : 0, b.temp_control ? 1 : 0, b.temp_c || null, b.seal_no || null,
        b.observations || null, b.etd || null, b.eta || null, b.transit_days || null
      ]
    );
    const row = await latestRow('operation_road', id);

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.json(row || null);
  } catch (e) {
    console.error('[operations:put road]', e);
    res.status(400).json({ error: 'PUT road failed' });
  }
});

// PUT MULTIMODAL (igual que tu versión)
router.put('/:id/multimodal', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const id = Number(req.params.id), b = req.body || {};
    await conn.beginTransaction();

    await conn.query(
      `INSERT INTO operation_multimodal
       (deal_id, doc_master, doc_house, crt_number, shipping_line, provider_org_id, itinerary, free_days,
        containers_json, truck_plates_json, observations)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
        doc_master=VALUES(doc_master), doc_house=VALUES(doc_house), crt_number=VALUES(crt_number),
        shipping_line=VALUES(shipping_line), provider_org_id=VALUES(provider_org_id), itinerary=VALUES(itinerary),
        free_days=VALUES(free_days), containers_json=VALUES(containers_json), truck_plates_json=VALUES(truck_plates_json),
        observations=VALUES(observations)`,
      [
        id,
        b.doc_master || null, b.doc_house || null, b.crt_number || null, b.shipping_line || null,
        b.provider_org_id || null, b.itinerary || null, b.free_days || null,
        b.containers_json ? JSON.stringify(b.containers_json) : null,
        b.truck_plates_json ? JSON.stringify(b.truck_plates_json) : null,
        b.observations || null
      ]
    );

    if (Array.isArray(b.legs)) {
      await conn.query(`DELETE FROM operation_legs WHERE deal_id = ?`, [id]);
      for (const L of b.legs) {
        await conn.query(
          `INSERT INTO operation_legs
           (deal_id, leg_no, mode, carrier, origin, destination, ref_doc, etd, eta, weight_kg, volume_m3, packages, details_json)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            id,
            L.leg_no,
            L.mode,
            L.carrier || null,
            L.origin || null,
            L.destination || null,
            L.ref_doc || null,
            L.etd || null,
            L.eta || null,
            L.weight_kg || null,
            L.volume_m3 || null,
            L.packages || null,
            L.details_json ? JSON.stringify(L.details_json) : null
          ]
        );
      }
    }

    await conn.commit();

    const data = await getDealWithDetail(id);

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.json(data.detail?.data || null);
  } catch (e) {
    await conn.rollback();
    console.error('[operations:put multimodal]', e);
    res.status(400).json({ error: 'PUT multimodal failed' });
  } finally {
    conn.release();
  }
});

export default router;
