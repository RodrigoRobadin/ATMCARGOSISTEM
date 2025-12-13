// server/src/routes/purchaseInvoices.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

// =================== HELPERS ===================

// Calcular totales de factura
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
function canManageInvoice(user, invoice) {
    const role = String(user?.role || '').toLowerCase();
    if (role === 'admin') return true;

    // Usuario de finanzas puede gestionar todas
    if (role === 'finanzas') return true;

    // Ejecutivo solo puede ver/editar sus propias facturas en borrador
    if (role === 'ejecutivo' && invoice.status === 'borrador') {
        return Number(user.id) === Number(invoice.created_by);
    }

    return false;
}

// =================== ENDPOINTS ===================

// GET /api/purchase-invoices - Listar facturas de compra
router.get('/', requireAuth, async (req, res) => {
    try {
        const { status, supplier_id, from_date, to_date, search } = req.query;
        const userId = req.user.id;
        const userRole = String(req.user.role || '').toLowerCase();

        let query = `
      SELECT 
        pi.*,
        o.name as supplier_name,
        o.razon_social as supplier_razon_social,
        u.name as created_by_name,
        po.po_number
      FROM purchase_invoices pi
      LEFT JOIN organizations o ON o.id = pi.supplier_id
      LEFT JOIN users u ON u.id = pi.created_by
      LEFT JOIN purchase_orders po ON po.id = pi.po_id
      WHERE 1=1
    `;
        const params = [];

        // Filtrar por rol
        if (userRole === 'ejecutivo') {
            query += ' AND pi.created_by = ?';
            params.push(userId);
        }

        // Filtros
        if (status) {
            query += ' AND pi.status = ?';
            params.push(status);
        }

        if (supplier_id) {
            query += ' AND pi.supplier_id = ?';
            params.push(supplier_id);
        }

        if (from_date) {
            query += ' AND pi.invoice_date >= ?';
            params.push(from_date);
        }

        if (to_date) {
            query += ' AND pi.invoice_date <= ?';
            params.push(to_date);
        }

        if (search) {
            query += ' AND (pi.invoice_number LIKE ? OR pi.supplier_invoice_number LIKE ? OR o.name LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        query += ' ORDER BY pi.created_at DESC';

        const [invoices] = await pool.query(query, params);
        res.json(invoices);
    } catch (e) {
        console.error('[purchase-invoices] Error listing:', e);
        res.status(500).json({ error: 'Error al listar facturas de compra' });
    }
});

// GET /api/purchase-invoices/:id - Detalle de factura de compra
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        // Obtener factura
        const [[invoice]] = await pool.query(
            `SELECT 
        pi.*,
        o.name as supplier_name,
        o.razon_social as supplier_razon_social,
        o.ruc as supplier_ruc,
        o.address as supplier_address,
        o.city as supplier_city,
        o.phone as supplier_phone,
        o.email as supplier_email,
        po.po_number,
        u.name as created_by_name,
        u2.name as registered_by_name
      FROM purchase_invoices pi
      LEFT JOIN organizations o ON o.id = pi.supplier_id
      LEFT JOIN purchase_orders po ON po.id = pi.po_id
      LEFT JOIN users u ON u.id = pi.created_by
      LEFT JOIN users u2 ON u2.id = pi.registered_by
      WHERE pi.id = ?`,
            [id]
        );

        if (!invoice) {
            return res.status(404).json({ error: 'Factura de compra no encontrada' });
        }

        // Verificar permisos
        if (!canManageInvoice(req.user, invoice)) {
            return res.status(403).json({ error: 'No tienes permiso para ver esta factura' });
        }

        // Obtener ítems
        const [items] = await pool.query(
            'SELECT * FROM purchase_invoice_items WHERE invoice_id = ? ORDER BY item_order, id',
            [id]
        );

        // Obtener pagos
        const [payments] = await pool.query(
            `SELECT 
        p.*,
        u.name as registered_by_name
      FROM purchase_invoice_payments p
      LEFT JOIN users u ON u.id = p.registered_by
      WHERE p.invoice_id = ?
      ORDER BY p.payment_date DESC`,
            [id]
        );

        res.json({
            ...invoice,
            items,
            payments
        });
    } catch (e) {
        console.error('[purchase-invoices] Error getting detail:', e);
        res.status(500).json({ error: 'Error al obtener factura de compra' });
    }
});

// POST /api/purchase-invoices - Crear factura de compra
router.post('/', requireAuth, async (req, res) => {
    try {
        const {
            supplier_id,
            po_id,
            supplier_invoice_number,
            invoice_date,
            due_date,
            payment_terms,
            items,
            notes
        } = req.body;
        const userId = req.user.id;

        if (!supplier_id) {
            return res.status(400).json({ error: 'supplier_id es requerido' });
        }

        if (!invoice_date) {
            return res.status(400).json({ error: 'invoice_date es requerido' });
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

        // Si hay PO, verificar que existe y pertenece al mismo proveedor
        if (po_id) {
            const [[po]] = await pool.query(
                'SELECT id, supplier_id FROM purchase_orders WHERE id = ? LIMIT 1',
                [po_id]
            );

            if (!po) {
                return res.status(404).json({ error: 'Orden de compra no encontrada' });
            }

            if (Number(po.supplier_id) !== Number(supplier_id)) {
                return res.status(400).json({ error: 'La orden de compra no pertenece al proveedor seleccionado' });
            }
        }

        // Preparar ítems
        const invoiceItems = items.map(item => ({
            description: item.description || 'Sin descripción',
            quantity: parseFloat(item.quantity) || 1,
            unit_price: parseFloat(item.unit_price) || 0,
            subtotal: (parseFloat(item.quantity) || 1) * (parseFloat(item.unit_price) || 0)
        }));

        // Calcular totales
        const totals = calculateTotals(invoiceItems);

        // Generar número interno de factura (simple contador)
        const [[lastInvoice]] = await pool.query(
            'SELECT invoice_number FROM purchase_invoices ORDER BY id DESC LIMIT 1'
        );

        let invoiceNumber = 'FC-0001';
        if (lastInvoice && lastInvoice.invoice_number) {
            const match = lastInvoice.invoice_number.match(/FC-(\d+)/);
            if (match) {
                const nextNum = parseInt(match[1]) + 1;
                invoiceNumber = `FC-${String(nextNum).padStart(4, '0')}`;
            }
        }

        // Crear factura de compra
        const [result] = await pool.query(
            `INSERT INTO purchase_invoices 
       (invoice_number, supplier_invoice_number, supplier_id, po_id, status, 
        invoice_date, due_date, subtotal, tax_rate, tax_amount, total_amount, 
        balance, payment_terms, notes, created_by)
       VALUES (?, ?, ?, ?, 'borrador', ?, ?, ?, 10.00, ?, ?, ?, ?, ?, ?)`,
            [
                invoiceNumber,
                supplier_invoice_number || null,
                supplier_id,
                po_id || null,
                invoice_date,
                due_date || null,
                totals.subtotal,
                totals.tax_amount,
                totals.total_amount,
                totals.total_amount, // balance inicial = total
                payment_terms || null,
                notes || null,
                userId
            ]
        );

        const invoiceId = result.insertId;

        // Insertar ítems
        for (let i = 0; i < invoiceItems.length; i++) {
            const item = invoiceItems[i];
            await pool.query(
                `INSERT INTO purchase_invoice_items 
         (invoice_id, description, quantity, unit_price, subtotal, item_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
                [invoiceId, item.description, item.quantity, item.unit_price, item.subtotal, i]
            );
        }

        // Obtener factura creada
        const [[invoice]] = await pool.query(
            'SELECT * FROM purchase_invoices WHERE id = ?',
            [invoiceId]
        );

        res.status(201).json(invoice);
    } catch (e) {
        console.error('[purchase-invoices] Error creating:', e);
        res.status(500).json({ error: 'Error al crear factura de compra' });
    }
});

// PATCH /api/purchase-invoices/:id - Actualizar factura (solo borrador)
router.patch('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { supplier_invoice_number, due_date, payment_terms, notes, items } = req.body;

        // Obtener factura
        const [[invoice]] = await pool.query(
            'SELECT * FROM purchase_invoices WHERE id = ?',
            [id]
        );

        if (!invoice) {
            return res.status(404).json({ error: 'Factura de compra no encontrada' });
        }

        if (invoice.status !== 'borrador') {
            return res.status(400).json({ error: 'Solo se pueden editar facturas en borrador' });
        }

        if (!canManageInvoice(req.user, invoice)) {
            return res.status(403).json({ error: 'No tienes permiso para editar esta factura' });
        }

        // Actualizar ítems si se enviaron
        if (items && Array.isArray(items)) {
            // Eliminar ítems existentes
            await pool.query('DELETE FROM purchase_invoice_items WHERE invoice_id = ?', [id]);

            // Insertar nuevos ítems
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                await pool.query(
                    `INSERT INTO purchase_invoice_items 
           (invoice_id, description, quantity, unit_price, subtotal, item_order)
           VALUES (?, ?, ?, ?, ?, ?)`,
                    [id, item.description, item.quantity, item.unit_price, item.subtotal, i]
                );
            }

            // Recalcular totales
            const totals = calculateTotals(items);
            await pool.query(
                `UPDATE purchase_invoices 
         SET subtotal = ?, tax_amount = ?, total_amount = ?, balance = ?
         WHERE id = ?`,
                [totals.subtotal, totals.tax_amount, totals.total_amount, totals.total_amount, id]
            );
        }

        // Actualizar otros campos
        const updates = [];
        const params = [];

        if (supplier_invoice_number !== undefined) {
            updates.push('supplier_invoice_number = ?');
            params.push(supplier_invoice_number);
        }

        if (due_date !== undefined) {
            updates.push('due_date = ?');
            params.push(due_date);
        }

        if (payment_terms !== undefined) {
            updates.push('payment_terms = ?');
            params.push(payment_terms);
        }

        if (notes !== undefined) {
            updates.push('notes = ?');
            params.push(notes);
        }

        if (updates.length > 0) {
            params.push(id);
            await pool.query(
                `UPDATE purchase_invoices SET ${updates.join(', ')} WHERE id = ?`,
                params
            );
        }

        // Obtener factura actualizada
        const [[updated]] = await pool.query(
            'SELECT * FROM purchase_invoices WHERE id = ?',
            [id]
        );

        res.json(updated);
    } catch (e) {
        console.error('[purchase-invoices] Error updating:', e);
        res.status(500).json({ error: 'Error al actualizar factura de compra' });
    }
});

// DELETE /api/purchase-invoices/:id - Eliminar factura (solo borrador)
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const [[invoice]] = await pool.query(
            'SELECT * FROM purchase_invoices WHERE id = ?',
            [id]
        );

        if (!invoice) {
            return res.status(404).json({ error: 'Factura de compra no encontrada' });
        }

        if (invoice.status !== 'borrador') {
            return res.status(400).json({ error: 'Solo se pueden eliminar facturas en borrador' });
        }

        if (!canManageInvoice(req.user, invoice)) {
            return res.status(403).json({ error: 'No tienes permiso para eliminar esta factura' });
        }

        await pool.query('DELETE FROM purchase_invoices WHERE id = ?', [id]);

        res.json({ message: 'Factura de compra eliminada correctamente' });
    } catch (e) {
        console.error('[purchase-invoices] Error deleting:', e);
        res.status(500).json({ error: 'Error al eliminar factura de compra' });
    }
});

// POST /api/purchase-invoices/:id/register - Registrar factura
router.post('/:id/register', requireAuth, requireRole(['admin', 'finanzas']), async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const [[invoice]] = await pool.query(
            'SELECT * FROM purchase_invoices WHERE id = ?',
            [id]
        );

        if (!invoice) {
            return res.status(404).json({ error: 'Factura de compra no encontrada' });
        }

        if (invoice.status !== 'borrador') {
            return res.status(400).json({ error: 'Solo se pueden registrar facturas en borrador' });
        }

        // Verificar que tenga ítems
        const [[count]] = await pool.query(
            'SELECT COUNT(*) as total FROM purchase_invoice_items WHERE invoice_id = ?',
            [id]
        );

        if (count.total === 0) {
            return res.status(400).json({ error: 'La factura debe tener al menos un ítem' });
        }

        // Registrar factura
        await pool.query(
            `UPDATE purchase_invoices 
       SET status = 'registrada', registered_by = ?, registered_at = NOW()
       WHERE id = ?`,
            [userId, id]
        );

        const [[updated]] = await pool.query(
            'SELECT * FROM purchase_invoices WHERE id = ?',
            [id]
        );

        res.json(updated);
    } catch (e) {
        console.error('[purchase-invoices] Error registering:', e);
        res.status(500).json({ error: 'Error al registrar factura de compra' });
    }
});

// POST /api/purchase-invoices/:id/cancel - Anular factura
router.post('/:id/cancel', requireAuth, requireRole(['admin', 'finanzas']), async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({ error: 'Debe proporcionar un motivo de anulación' });
        }

        const [[invoice]] = await pool.query(
            'SELECT * FROM purchase_invoices WHERE id = ?',
            [id]
        );

        if (!invoice) {
            return res.status(404).json({ error: 'Factura de compra no encontrada' });
        }

        if (invoice.status === 'pagada') {
            return res.status(400).json({ error: 'No se puede anular una factura pagada completamente' });
        }

        if (invoice.status === 'anulada') {
            return res.status(400).json({ error: 'La factura ya está anulada' });
        }

        await pool.query(
            `UPDATE purchase_invoices 
       SET status = 'anulada', cancellation_reason = ?
       WHERE id = ?`,
            [reason, id]
        );

        const [[updated]] = await pool.query(
            'SELECT * FROM purchase_invoices WHERE id = ?',
            [id]
        );

        res.json(updated);
    } catch (e) {
        console.error('[purchase-invoices] Error canceling:', e);
        res.status(500).json({ error: 'Error al anular factura de compra' });
    }
});

// POST /api/purchase-invoices/:id/payments - Registrar pago
router.post('/:id/payments', requireAuth, requireRole(['admin', 'finanzas']), async (req, res) => {
    try {
        const { id } = req.params;
        const { payment_date, amount, payment_method, reference_number, notes } = req.body;
        const userId = req.user.id;

        if (!payment_date || !amount || !payment_method) {
            return res.status(400).json({ error: 'payment_date, amount y payment_method son requeridos' });
        }

        const [[invoice]] = await pool.query(
            'SELECT * FROM purchase_invoices WHERE id = ?',
            [id]
        );

        if (!invoice) {
            return res.status(404).json({ error: 'Factura de compra no encontrada' });
        }

        if (invoice.status !== 'registrada' && invoice.status !== 'pago_parcial') {
            return res.status(400).json({ error: 'Solo se pueden registrar pagos en facturas registradas o con pago parcial' });
        }

        const paymentAmount = parseFloat(amount);
        const currentBalance = parseFloat(invoice.balance);

        if (paymentAmount > currentBalance) {
            return res.status(400).json({ error: 'El monto del pago no puede ser mayor al saldo pendiente' });
        }

        // Registrar pago
        await pool.query(
            `INSERT INTO purchase_invoice_payments 
       (invoice_id, payment_date, amount, payment_method, reference_number, notes, registered_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, payment_date, paymentAmount, payment_method, reference_number, notes, userId]
        );

        // Actualizar factura
        const newPaidAmount = parseFloat(invoice.paid_amount) + paymentAmount;
        const newBalance = parseFloat(invoice.total_amount) - newPaidAmount;
        const newStatus = newBalance === 0 ? 'pagada' : 'pago_parcial';

        await pool.query(
            `UPDATE purchase_invoices 
       SET paid_amount = ?, balance = ?, status = ?, paid_date = IF(? = 0, CURDATE(), paid_date)
       WHERE id = ?`,
            [newPaidAmount, newBalance, newStatus, newBalance, id]
        );

        const [[updated]] = await pool.query(
            'SELECT * FROM purchase_invoices WHERE id = ?',
            [id]
        );

        res.json(updated);
    } catch (e) {
        console.error('[purchase-invoices] Error registering payment:', e);
        res.status(500).json({ error: 'Error al registrar pago' });
    }
});

// GET /api/purchase-invoices/:id/payments - Listar pagos
router.get('/:id/payments', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const [payments] = await pool.query(
            `SELECT 
        p.*,
        u.name as registered_by_name
      FROM purchase_invoice_payments p
      LEFT JOIN users u ON u.id = p.registered_by
      WHERE p.invoice_id = ?
      ORDER BY p.payment_date DESC`,
            [id]
        );

        res.json(payments);
    } catch (e) {
        console.error('[purchase-invoices] Error listing payments:', e);
        res.status(500).json({ error: 'Error al listar pagos' });
    }
});

export default router;
