// server/src/routes/purchaseOrders.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

// =================== HELPERS ===================

// Generar número de orden de compra
async function generatePONumber() {
    const [[seq]] = await pool.query(
        'SELECT last_number, prefix, year FROM purchase_order_sequence WHERE id = 1'
    );

    const currentYear = new Date().getFullYear();
    let nextNumber = seq.last_number + 1;

    // Reiniciar contador si cambió el año
    if (currentYear !== seq.year) {
        nextNumber = 1;
        await pool.query(
            'UPDATE purchase_order_sequence SET year = ?, last_number = 0 WHERE id = 1',
            [currentYear]
        );
    }

    // Actualizar secuencia
    await pool.query(
        'UPDATE purchase_order_sequence SET last_number = ? WHERE id = 1',
        [nextNumber]
    );

    // Formato: OC-2024-0001
    const poNumber = `${seq.prefix}-${currentYear}-${String(nextNumber).padStart(4, '0')}`;
    return poNumber;
}

// Calcular totales de orden de compra
function calculateTotals(items, taxRate = 10) {
    const subtotal = items.reduce((sum, item) => sum + parseFloat(item.subtotal || 0), 0);
    const taxAmount = (subtotal * taxRate) / 100;
    const total = subtotal + taxAmount;

    return {
        subtotal: subtotal.toFixed(2),
        tax_amount: taxAmount.toFixed(2),
        total_amount: total.toFixed(2)
    };
}

// Verificar permisos
function canManagePO(user, po) {
    const role = String(user?.role || '').toLowerCase();
    if (role === 'admin') return true;

    // Usuario de finanzas puede gestionar todas
    if (role === 'finanzas') return true;

    // Ejecutivo solo puede ver/editar sus propias órdenes en borrador
    if (role === 'ejecutivo' && po.status === 'borrador') {
        return Number(user.id) === Number(po.created_by);
    }

    return false;
}

// =================== ENDPOINTS ===================

// GET /api/purchase-orders - Listar órdenes de compra
router.get('/', requireAuth, async (req, res) => {
    try {
        const { status, supplier_id, from_date, to_date, search } = req.query;
        const userId = req.user.id;
        const userRole = String(req.user.role || '').toLowerCase();

        let query = `
      SELECT 
        po.*,
        o.name as supplier_name,
        o.razon_social as supplier_razon_social,
        u.name as created_by_name
      FROM purchase_orders po
      LEFT JOIN organizations o ON o.id = po.supplier_id
      LEFT JOIN users u ON u.id = po.created_by
      WHERE 1=1
    `;
        const params = [];

        // Filtrar por rol
        if (userRole === 'ejecutivo') {
            query += ' AND po.created_by = ?';
            params.push(userId);
        }

        // Filtros
        if (status) {
            query += ' AND po.status = ?';
            params.push(status);
        }

        if (supplier_id) {
            query += ' AND po.supplier_id = ?';
            params.push(supplier_id);
        }

        if (from_date) {
            query += ' AND po.order_date >= ?';
            params.push(from_date);
        }

        if (to_date) {
            query += ' AND po.order_date <= ?';
            params.push(to_date);
        }

        if (search) {
            query += ' AND (po.po_number LIKE ? OR o.name LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }

        query += ' ORDER BY po.created_at DESC';

        const [orders] = await pool.query(query, params);
        res.json(orders);
    } catch (e) {
        console.error('[purchase-orders] Error listing:', e);
        res.status(500).json({ error: 'Error al listar órdenes de compra' });
    }
});

// GET /api/purchase-orders/:id - Detalle de orden de compra
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        // Obtener orden
        const [[po]] = await pool.query(
            `SELECT 
        po.*,
        o.name as supplier_name,
        o.razon_social as supplier_razon_social,
        o.ruc as supplier_ruc,
        o.address as supplier_address,
        o.city as supplier_city,
        o.phone as supplier_phone,
        o.email as supplier_email,
        u.name as created_by_name,
        u2.name as approved_by_name,
        u3.name as received_by_name
      FROM purchase_orders po
      LEFT JOIN organizations o ON o.id = po.supplier_id
      LEFT JOIN users u ON u.id = po.created_by
      LEFT JOIN users u2 ON u2.id = po.approved_by
      LEFT JOIN users u3 ON u3.id = po.received_by
      WHERE po.id = ?`,
            [id]
        );

        if (!po) {
            return res.status(404).json({ error: 'Orden de compra no encontrada' });
        }

        // Verificar permisos
        if (!canManagePO(req.user, po)) {
            return res.status(403).json({ error: 'No tienes permiso para ver esta orden' });
        }

        // Obtener ítems
        const [items] = await pool.query(
            'SELECT * FROM purchase_order_items WHERE po_id = ? ORDER BY item_order, id',
            [id]
        );

        res.json({
            ...po,
            items
        });
    } catch (e) {
        console.error('[purchase-orders] Error getting detail:', e);
        res.status(500).json({ error: 'Error al obtener orden de compra' });
    }
});

// POST /api/purchase-orders - Crear orden de compra
router.post('/', requireAuth, async (req, res) => {
    try {
        const {
            supplier_id,
            order_date,
            expected_delivery_date,
            delivery_address,
            items,
            notes
        } = req.body;
        const userId = req.user.id;

        if (!supplier_id) {
            return res.status(400).json({ error: 'supplier_id es requerido' });
        }

        if (!order_date) {
            return res.status(400).json({ error: 'order_date es requerido' });
        }

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Debe incluir al menos un ítem' });
        }

        // Verificar que el proveedor existe
        const [[supplier]] = await pool.query(
            'SELECT id, name FROM organizations WHERE id = ? AND is_supplier = TRUE LIMIT 1',
            [supplier_id]
        );

        if (!supplier) {
            return res.status(404).json({ error: 'Proveedor no encontrado' });
        }

        // Preparar ítems
        const poItems = items.map(item => ({
            description: item.description || 'Sin descripción',
            quantity: parseFloat(item.quantity) || 1,
            unit_price: parseFloat(item.unit_price) || 0,
            subtotal: (parseFloat(item.quantity) || 1) * (parseFloat(item.unit_price) || 0),
            notes: item.notes || null
        }));

        // Generar número de orden
        const poNumber = await generatePONumber();

        // Calcular totales
        const totals = calculateTotals(poItems);

        // Crear orden de compra
        const [result] = await pool.query(
            `INSERT INTO purchase_orders 
       (po_number, supplier_id, status, order_date, expected_delivery_date, 
        delivery_address, subtotal, tax_rate, tax_amount, total_amount, notes, created_by)
       VALUES (?, ?, 'borrador', ?, ?, ?, ?, 10.00, ?, ?, ?, ?)`,
            [
                poNumber,
                supplier_id,
                order_date,
                expected_delivery_date || null,
                delivery_address || null,
                totals.subtotal,
                totals.tax_amount,
                totals.total_amount,
                notes || null,
                userId
            ]
        );

        const poId = result.insertId;

        // Insertar ítems
        for (let i = 0; i < poItems.length; i++) {
            const item = poItems[i];
            await pool.query(
                `INSERT INTO purchase_order_items 
         (po_id, description, quantity, unit_price, subtotal, item_order, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [poId, item.description, item.quantity, item.unit_price, item.subtotal, i, item.notes]
            );
        }

        // Obtener orden creada
        const [[po]] = await pool.query(
            'SELECT * FROM purchase_orders WHERE id = ?',
            [poId]
        );

        res.status(201).json(po);
    } catch (e) {
        console.error('[purchase-orders] Error creating:', e);
        res.status(500).json({ error: 'Error al crear orden de compra' });
    }
});

// PATCH /api/purchase-orders/:id - Actualizar orden (solo borrador)
router.patch('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { expected_delivery_date, delivery_address, notes, items } = req.body;

        // Obtener orden
        const [[po]] = await pool.query(
            'SELECT * FROM purchase_orders WHERE id = ?',
            [id]
        );

        if (!po) {
            return res.status(404).json({ error: 'Orden de compra no encontrada' });
        }

        if (po.status !== 'borrador') {
            return res.status(400).json({ error: 'Solo se pueden editar órdenes en borrador' });
        }

        if (!canManagePO(req.user, po)) {
            return res.status(403).json({ error: 'No tienes permiso para editar esta orden' });
        }

        // Actualizar ítems si se enviaron
        if (items && Array.isArray(items)) {
            // Eliminar ítems existentes
            await pool.query('DELETE FROM purchase_order_items WHERE po_id = ?', [id]);

            // Insertar nuevos ítems
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                await pool.query(
                    `INSERT INTO purchase_order_items 
           (po_id, description, quantity, unit_price, subtotal, item_order, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [id, item.description, item.quantity, item.unit_price, item.subtotal, i, item.notes || null]
                );
            }

            // Recalcular totales
            const totals = calculateTotals(items);
            await pool.query(
                `UPDATE purchase_orders 
         SET subtotal = ?, tax_amount = ?, total_amount = ?
         WHERE id = ?`,
                [totals.subtotal, totals.tax_amount, totals.total_amount, id]
            );
        }

        // Actualizar otros campos
        const updates = [];
        const params = [];

        if (expected_delivery_date !== undefined) {
            updates.push('expected_delivery_date = ?');
            params.push(expected_delivery_date);
        }

        if (delivery_address !== undefined) {
            updates.push('delivery_address = ?');
            params.push(delivery_address);
        }

        if (notes !== undefined) {
            updates.push('notes = ?');
            params.push(notes);
        }

        if (updates.length > 0) {
            params.push(id);
            await pool.query(
                `UPDATE purchase_orders SET ${updates.join(', ')} WHERE id = ?`,
                params
            );
        }

        // Obtener orden actualizada
        const [[updated]] = await pool.query(
            'SELECT * FROM purchase_orders WHERE id = ?',
            [id]
        );

        res.json(updated);
    } catch (e) {
        console.error('[purchase-orders] Error updating:', e);
        res.status(500).json({ error: 'Error al actualizar orden de compra' });
    }
});

// DELETE /api/purchase-orders/:id - Eliminar orden (solo borrador)
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const [[po]] = await pool.query(
            'SELECT * FROM purchase_orders WHERE id = ?',
            [id]
        );

        if (!po) {
            return res.status(404).json({ error: 'Orden de compra no encontrada' });
        }

        if (po.status !== 'borrador') {
            return res.status(400).json({ error: 'Solo se pueden eliminar órdenes en borrador' });
        }

        if (!canManagePO(req.user, po)) {
            return res.status(403).json({ error: 'No tienes permiso para eliminar esta orden' });
        }

        await pool.query('DELETE FROM purchase_orders WHERE id = ?', [id]);

        res.json({ message: 'Orden de compra eliminada correctamente' });
    } catch (e) {
        console.error('[purchase-orders] Error deleting:', e);
        res.status(500).json({ error: 'Error al eliminar orden de compra' });
    }
});

// POST /api/purchase-orders/:id/send - Enviar orden
router.post('/:id/send', requireAuth, requireRole(['admin', 'finanzas']), async (req, res) => {
    try {
        const { id } = req.params;

        const [[po]] = await pool.query(
            'SELECT * FROM purchase_orders WHERE id = ?',
            [id]
        );

        if (!po) {
            return res.status(404).json({ error: 'Orden de compra no encontrada' });
        }

        if (po.status !== 'borrador') {
            return res.status(400).json({ error: 'Solo se pueden enviar órdenes en borrador' });
        }

        // Cambiar estado a enviada
        await pool.query(
            `UPDATE purchase_orders SET status = 'enviada' WHERE id = ?`,
            [id]
        );

        const [[updated]] = await pool.query(
            'SELECT * FROM purchase_orders WHERE id = ?',
            [id]
        );

        res.json(updated);
    } catch (e) {
        console.error('[purchase-orders] Error sending:', e);
        res.status(500).json({ error: 'Error al enviar orden de compra' });
    }
});

// POST /api/purchase-orders/:id/confirm - Confirmar orden
router.post('/:id/confirm', requireAuth, requireRole(['admin', 'finanzas']), async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const [[po]] = await pool.query(
            'SELECT * FROM purchase_orders WHERE id = ?',
            [id]
        );

        if (!po) {
            return res.status(404).json({ error: 'Orden de compra no encontrada' });
        }

        if (po.status !== 'enviada') {
            return res.status(400).json({ error: 'Solo se pueden confirmar órdenes enviadas' });
        }

        // Cambiar estado a confirmada
        await pool.query(
            `UPDATE purchase_orders 
       SET status = 'confirmada', approved_by = ?, approved_at = NOW()
       WHERE id = ?`,
            [userId, id]
        );

        const [[updated]] = await pool.query(
            'SELECT * FROM purchase_orders WHERE id = ?',
            [id]
        );

        res.json(updated);
    } catch (e) {
        console.error('[purchase-orders] Error confirming:', e);
        res.status(500).json({ error: 'Error al confirmar orden de compra' });
    }
});

// POST /api/purchase-orders/:id/receive - Marcar como recibida
router.post('/:id/receive', requireAuth, requireRole(['admin', 'finanzas']), async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const [[po]] = await pool.query(
            'SELECT * FROM purchase_orders WHERE id = ?',
            [id]
        );

        if (!po) {
            return res.status(404).json({ error: 'Orden de compra no encontrada' });
        }

        if (po.status !== 'confirmada') {
            return res.status(400).json({ error: 'Solo se pueden recibir órdenes confirmadas' });
        }

        // Cambiar estado a recibida
        await pool.query(
            `UPDATE purchase_orders 
       SET status = 'recibida', received_by = ?, received_at = NOW()
       WHERE id = ?`,
            [userId, id]
        );

        const [[updated]] = await pool.query(
            'SELECT * FROM purchase_orders WHERE id = ?',
            [id]
        );

        res.json(updated);
    } catch (e) {
        console.error('[purchase-orders] Error receiving:', e);
        res.status(500).json({ error: 'Error al marcar orden como recibida' });
    }
});

// POST /api/purchase-orders/:id/cancel - Cancelar orden
router.post('/:id/cancel', requireAuth, requireRole(['admin', 'finanzas']), async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({ error: 'Debe proporcionar un motivo de cancelación' });
        }

        const [[po]] = await pool.query(
            'SELECT * FROM purchase_orders WHERE id = ?',
            [id]
        );

        if (!po) {
            return res.status(404).json({ error: 'Orden de compra no encontrada' });
        }

        if (po.status === 'recibida') {
            return res.status(400).json({ error: 'No se puede cancelar una orden ya recibida' });
        }

        if (po.status === 'cancelada') {
            return res.status(400).json({ error: 'La orden ya está cancelada' });
        }

        await pool.query(
            `UPDATE purchase_orders 
       SET status = 'cancelada', notes = CONCAT(COALESCE(notes, ''), '\nMotivo cancelación: ', ?)
       WHERE id = ?`,
            [reason, id]
        );

        const [[updated]] = await pool.query(
            'SELECT * FROM purchase_orders WHERE id = ?',
            [id]
        );

        res.json(updated);
    } catch (e) {
        console.error('[purchase-orders] Error canceling:', e);
        res.status(500).json({ error: 'Error al cancelar orden de compra' });
    }
});

export default router;
