// server/src/routes/invoices.js
import { Router } from 'express';
import { pool } from '../services/db.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

// =================== HELPERS ===================

// Generar número de factura
async function generateInvoiceNumber() {
    const [[seq]] = await pool.query(
        'SELECT last_number, prefix, year FROM invoice_sequence WHERE id = 1'
    );

    const currentYear = new Date().getFullYear();
    let nextNumber = seq.last_number + 1;

    // Reiniciar contador si cambió el año
    if (currentYear !== seq.year) {
        nextNumber = 1;
        await pool.query(
            'UPDATE invoice_sequence SET year = ?, last_number = 0 WHERE id = 1',
            [currentYear]
        );
    }

    // Actualizar secuencia
    await pool.query(
        'UPDATE invoice_sequence SET last_number = ? WHERE id = 1',
        [nextNumber]
    );

    // Formato: FAC-2024-0001
    const invoiceNumber = `${seq.prefix}-${currentYear}-${String(nextNumber).padStart(4, '0')}`;
    return invoiceNumber;
}

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

// GET /api/invoices - Listar facturas
router.get('/', requireAuth, async (req, res) => {
    try {
        const { status, organization_id, from_date, to_date, search } = req.query;
        const userId = req.user.id;
        const userRole = String(req.user.role || '').toLowerCase();

        let query = `
      SELECT 
        i.*,
        o.name as organization_name,
        u.name as created_by_name
      FROM invoices i
      LEFT JOIN organizations o ON o.id = i.organization_id
      LEFT JOIN users u ON u.id = i.created_by
      WHERE 1=1
    `;
        const params = [];

        // Filtrar por rol
        if (userRole === 'ejecutivo') {
            query += ' AND i.created_by = ?';
            params.push(userId);
        }

        // Filtros
        if (status) {
            query += ' AND i.status = ?';
            params.push(status);
        }

        if (organization_id) {
            query += ' AND i.organization_id = ?';
            params.push(organization_id);
        }

        if (from_date) {
            query += ' AND i.issue_date >= ?';
            params.push(from_date);
        }

        if (to_date) {
            query += ' AND i.issue_date <= ?';
            params.push(to_date);
        }

        if (search) {
            query += ' AND (i.invoice_number LIKE ? OR o.name LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }

        query += ' ORDER BY i.created_at DESC';

        const [invoices] = await pool.query(query, params);
        res.json(invoices);
    } catch (e) {
        console.error('[invoices] Error listing:', e);
        res.status(500).json({ error: 'Error al listar facturas' });
    }
});

// GET /api/invoices/:id - Detalle de factura
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        // Obtener factura
        const [[invoice]] = await pool.query(
            `SELECT 
        i.*,
        o.name as organization_name,
        o.ruc as organization_ruc,
        o.address as organization_address,
        o.city as organization_city,
        d.id as deal_id,
        d.title as deal_title,
        u.name as created_by_name,
        u2.name as issued_by_name
      FROM invoices i
      LEFT JOIN organizations o ON o.id = i.organization_id
      LEFT JOIN deals d ON d.id = i.deal_id
      LEFT JOIN users u ON u.id = i.created_by
      LEFT JOIN users u2 ON u2.id = i.issued_by
      WHERE i.id = ?`,
            [id]
        );

        if (!invoice) {
            return res.status(404).json({ error: 'Factura no encontrada' });
        }

        // Verificar permisos
        if (!canManageInvoice(req.user, invoice)) {
            return res.status(403).json({ error: 'No tienes permiso para ver esta factura' });
        }

        // Obtener ítems
        const [items] = await pool.query(
            'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY item_order, id',
            [id]
        );

        // Obtener pagos
        const [payments] = await pool.query(
            `SELECT 
        p.*,
        u.name as registered_by_name
      FROM invoice_payments p
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
        console.error('[invoices] Error getting detail:', e);
        res.status(500).json({ error: 'Error al obtener factura' });
    }
});

// POST /api/invoices - Crear factura desde deal
router.post('/', requireAuth, async (req, res) => {
    try {
        const { deal_id, due_date, payment_terms, notes } = req.body;
        const userId = req.user.id;

        if (!deal_id) {
            return res.status(400).json({ error: 'deal_id es requerido' });
        }

        // Verificar que el deal existe y está cerrado
        const [[deal]] = await pool.query(
            'SELECT * FROM deals WHERE id = ? LIMIT 1',
            [deal_id]
        );

        if (!deal) {
            return res.status(404).json({ error: 'Deal no encontrado' });
        }

        if (deal.status !== 'won') {
            return res.status(400).json({ error: 'El deal debe estar cerrado (won) para generar factura' });
        }

        // Verificar que no tenga factura ya generada
        const [[existing]] = await pool.query(
            'SELECT id FROM invoices WHERE deal_id = ? LIMIT 1',
            [deal_id]
        );

        if (existing) {
            return res.status(400).json({ error: 'Este deal ya tiene una factura generada' });
        }

        // Obtener ítems del cost sheet
        const [costSheetItems] = await pool.query(
            `SELECT * FROM deal_cost_sheet_items 
       WHERE deal_id = ? AND is_active = 1
       ORDER BY item_order, id`,
            [deal_id]
        );

        if (costSheetItems.length === 0) {
            return res.status(400).json({ error: 'El deal no tiene ítems en el presupuesto' });
        }

        // Generar número de factura
        const invoiceNumber = await generateInvoiceNumber();

        // Preparar ítems para factura
        const invoiceItems = costSheetItems.map(item => ({
            description: item.description,
            quantity: item.quantity || 1,
            unit_price: item.unit_price,
            subtotal: (item.quantity || 1) * item.unit_price,
            cost_sheet_item_id: item.id
        }));

        // Calcular totales
        const totals = calculateTotals(invoiceItems);

        // Crear factura
        const [result] = await pool.query(
            `INSERT INTO invoices 
       (invoice_number, deal_id, organization_id, subtotal, tax_rate, tax_amount, 
        total_amount, balance, due_date, payment_terms, notes, created_by)
       VALUES (?, ?, ?, ?, 10.00, ?, ?, ?, ?, ?, ?, ?)`,
            [
                invoiceNumber,
                deal_id,
                deal.organization_id,
                totals.subtotal,
                totals.tax_amount,
                totals.total_amount,
                totals.total_amount, // balance inicial = total
                due_date || null,
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
                `INSERT INTO invoice_items 
         (invoice_id, description, quantity, unit_price, subtotal, cost_sheet_item_id, item_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [invoiceId, item.description, item.quantity, item.unit_price, item.subtotal, item.cost_sheet_item_id, i]
            );
        }

        // Obtener factura creada
        const [[invoice]] = await pool.query(
            'SELECT * FROM invoices WHERE id = ?',
            [invoiceId]
        );

        res.status(201).json(invoice);
    } catch (e) {
        console.error('[invoices] Error creating:', e);
        res.status(500).json({ error: 'Error al crear factura' });
    }
});

// PATCH /api/invoices/:id - Actualizar factura (solo borrador)
router.patch('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { due_date, payment_terms, notes, items } = req.body;

        // Obtener factura
        const [[invoice]] = await pool.query(
            'SELECT * FROM invoices WHERE id = ?',
            [id]
        );

        if (!invoice) {
            return res.status(404).json({ error: 'Factura no encontrada' });
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
            await pool.query('DELETE FROM invoice_items WHERE invoice_id = ?', [id]);

            // Insertar nuevos ítems
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                await pool.query(
                    `INSERT INTO invoice_items 
           (invoice_id, description, quantity, unit_price, subtotal, item_order)
           VALUES (?, ?, ?, ?, ?, ?)`,
                    [id, item.description, item.quantity, item.unit_price, item.subtotal, i]
                );
            }

            // Recalcular totales
            const totals = calculateTotals(items);
            await pool.query(
                `UPDATE invoices 
         SET subtotal = ?, tax_amount = ?, total_amount = ?, balance = ?
         WHERE id = ?`,
                [totals.subtotal, totals.tax_amount, totals.total_amount, totals.total_amount, id]
            );
        }

        // Actualizar otros campos
        const updates = [];
        const params = [];

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
                `UPDATE invoices SET ${updates.join(', ')} WHERE id = ?`,
                params
            );
        }

        // Obtener factura actualizada
        const [[updated]] = await pool.query(
            'SELECT * FROM invoices WHERE id = ?',
            [id]
        );

        res.json(updated);
    } catch (e) {
        console.error('[invoices] Error updating:', e);
        res.status(500).json({ error: 'Error al actualizar factura' });
    }
});

// DELETE /api/invoices/:id - Eliminar factura (solo borrador)
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const [[invoice]] = await pool.query(
            'SELECT * FROM invoices WHERE id = ?',
            [id]
        );

        if (!invoice) {
            return res.status(404).json({ error: 'Factura no encontrada' });
        }

        if (invoice.status !== 'borrador') {
            return res.status(400).json({ error: 'Solo se pueden eliminar facturas en borrador' });
        }

        if (!canManageInvoice(req.user, invoice)) {
            return res.status(403).json({ error: 'No tienes permiso para eliminar esta factura' });
        }

        await pool.query('DELETE FROM invoices WHERE id = ?', [id]);

        res.json({ message: 'Factura eliminada correctamente' });
    } catch (e) {
        console.error('[invoices] Error deleting:', e);
        res.status(500).json({ error: 'Error al eliminar factura' });
    }
});

// POST /api/invoices/:id/issue - Emitir factura
router.post('/:id/issue', requireAuth, requireRole(['admin', 'finanzas']), async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const [[invoice]] = await pool.query(
            'SELECT * FROM invoices WHERE id = ?',
            [id]
        );

        if (!invoice) {
            return res.status(404).json({ error: 'Factura no encontrada' });
        }

        if (invoice.status !== 'borrador') {
            return res.status(400).json({ error: 'Solo se pueden emitir facturas en borrador' });
        }

        // Verificar que tenga ítems
        const [[count]] = await pool.query(
            'SELECT COUNT(*) as total FROM invoice_items WHERE invoice_id = ?',
            [id]
        );

        if (count.total === 0) {
            return res.status(400).json({ error: 'La factura debe tener al menos un ítem' });
        }

        // Emitir factura
        await pool.query(
            `UPDATE invoices 
       SET status = 'emitida', issue_date = CURDATE(), issued_by = ?
       WHERE id = ?`,
            [userId, id]
        );

        const [[updated]] = await pool.query(
            'SELECT * FROM invoices WHERE id = ?',
            [id]
        );

        res.json(updated);
    } catch (e) {
        console.error('[invoices] Error issuing:', e);
        res.status(500).json({ error: 'Error al emitir factura' });
    }
});

// POST /api/invoices/:id/cancel - Anular factura
router.post('/:id/cancel', requireAuth, requireRole(['admin', 'finanzas']), async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({ error: 'Debe proporcionar un motivo de anulación' });
        }

        const [[invoice]] = await pool.query(
            'SELECT * FROM invoices WHERE id = ?',
            [id]
        );

        if (!invoice) {
            return res.status(404).json({ error: 'Factura no encontrada' });
        }

        if (invoice.status === 'pagada') {
            return res.status(400).json({ error: 'No se puede anular una factura pagada completamente' });
        }

        if (invoice.status === 'anulada') {
            return res.status(400).json({ error: 'La factura ya está anulada' });
        }

        await pool.query(
            `UPDATE invoices 
       SET status = 'anulada', cancellation_reason = ?
       WHERE id = ?`,
            [reason, id]
        );

        const [[updated]] = await pool.query(
            'SELECT * FROM invoices WHERE id = ?',
            [id]
        );

        res.json(updated);
    } catch (e) {
        console.error('[invoices] Error canceling:', e);
        res.status(500).json({ error: 'Error al anular factura' });
    }
});

// POST /api/invoices/:id/payments - Registrar pago
router.post('/:id/payments', requireAuth, requireRole(['admin', 'finanzas']), async (req, res) => {
    try {
        const { id } = req.params;
        const { payment_date, amount, payment_method, reference_number, notes } = req.body;
        const userId = req.user.id;

        if (!payment_date || !amount || !payment_method) {
            return res.status(400).json({ error: 'payment_date, amount y payment_method son requeridos' });
        }

        const [[invoice]] = await pool.query(
            'SELECT * FROM invoices WHERE id = ?',
            [id]
        );

        if (!invoice) {
            return res.status(404).json({ error: 'Factura no encontrada' });
        }

        if (invoice.status !== 'emitida' && invoice.status !== 'pago_parcial') {
            return res.status(400).json({ error: 'Solo se pueden registrar pagos en facturas emitidas o con pago parcial' });
        }

        const paymentAmount = parseFloat(amount);
        const currentBalance = parseFloat(invoice.balance);

        if (paymentAmount > currentBalance) {
            return res.status(400).json({ error: 'El monto del pago no puede ser mayor al saldo pendiente' });
        }

        // Registrar pago
        await pool.query(
            `INSERT INTO invoice_payments 
       (invoice_id, payment_date, amount, payment_method, reference_number, notes, registered_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, payment_date, paymentAmount, payment_method, reference_number, notes, userId]
        );

        // Actualizar factura
        const newPaidAmount = parseFloat(invoice.paid_amount) + paymentAmount;
        const newBalance = parseFloat(invoice.total_amount) - newPaidAmount;
        const newStatus = newBalance === 0 ? 'pagada' : 'pago_parcial';

        await pool.query(
            `UPDATE invoices 
       SET paid_amount = ?, balance = ?, status = ?, paid_date = IF(? = 0, CURDATE(), paid_date)
       WHERE id = ?`,
            [newPaidAmount, newBalance, newStatus, newBalance, id]
        );

        const [[updated]] = await pool.query(
            'SELECT * FROM invoices WHERE id = ?',
            [id]
        );

        res.json(updated);
    } catch (e) {
        console.error('[invoices] Error registering payment:', e);
        res.status(500).json({ error: 'Error al registrar pago' });
    }
});

// GET /api/invoices/:id/payments - Listar pagos
router.get('/:id/payments', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const [payments] = await pool.query(
            `SELECT 
        p.*,
        u.name as registered_by_name
      FROM invoice_payments p
      LEFT JOIN users u ON u.id = p.registered_by
      WHERE p.invoice_id = ?
      ORDER BY p.payment_date DESC`,
            [id]
        );

        res.json(payments);
    } catch (e) {
        console.error('[invoices] Error listing payments:', e);
        res.status(500).json({ error: 'Error al listar pagos' });
    }
});

export default router;
