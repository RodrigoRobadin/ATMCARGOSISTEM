CREATE TABLE IF NOT EXISTS supplier_credit_notes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NULL,
  supplier_name VARCHAR(160) NULL,
  supplier_ruc VARCHAR(32) NULL,
  note_date DATE NOT NULL,
  receipt_number VARCHAR(64) NOT NULL,
  timbrado_number VARCHAR(64) NULL,
  currency_code VARCHAR(8) NOT NULL DEFAULT 'PYG',
  reason VARCHAR(255) NOT NULL,
  notes TEXT NULL,
  gravado_10 DECIMAL(15,2) NOT NULL DEFAULT 0,
  gravado_5 DECIMAL(15,2) NOT NULL DEFAULT 0,
  iva_10 DECIMAL(15,2) NOT NULL DEFAULT 0,
  iva_5 DECIMAL(15,2) NOT NULL DEFAULT 0,
  iva_exempt DECIMAL(15,2) NOT NULL DEFAULT 0,
  iva_no_taxed DECIMAL(15,2) NOT NULL DEFAULT 0,
  amount_total DECIMAL(15,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'registrada',
  created_by INT NULL,
  canceled_by INT NULL,
  canceled_at DATETIME NULL,
  cancel_reason VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_supplier_credit_supplier (supplier_id),
  INDEX idx_supplier_credit_date (note_date),
  INDEX idx_supplier_credit_status (status),
  INDEX idx_supplier_credit_document (receipt_number, timbrado_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS supplier_credit_note_applications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_note_id INT NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  source_id INT NOT NULL,
  applied_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_supplier_credit_application (credit_note_id, source_type, source_id),
  INDEX idx_supplier_credit_source (source_type, source_id),
  CONSTRAINT fk_supplier_credit_application_note
    FOREIGN KEY (credit_note_id) REFERENCES supplier_credit_notes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS supplier_credit_note_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_note_id INT NOT NULL,
  description VARCHAR(255) NOT NULL,
  quantity DECIMAL(15,3) NOT NULL DEFAULT 1,
  unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
  subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
  tax_rate INT NOT NULL DEFAULT 10,
  expense_rubro VARCHAR(32) NULL,
  source_item_id INT NULL,
  item_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_supplier_credit_item_note (credit_note_id),
  CONSTRAINT fk_supplier_credit_item_note
    FOREIGN KEY (credit_note_id) REFERENCES supplier_credit_notes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS supplier_credit_note_attachments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_note_id INT NOT NULL,
  file_url VARCHAR(255) NOT NULL,
  file_name VARCHAR(255) NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_supplier_credit_attachment_note (credit_note_id),
  CONSTRAINT fk_supplier_credit_attachment_note
    FOREIGN KEY (credit_note_id) REFERENCES supplier_credit_notes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS supplier_credit_note_audit (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_note_id INT NOT NULL,
  action VARCHAR(32) NOT NULL,
  previous_json LONGTEXT NULL,
  current_json LONGTEXT NULL,
  reason VARCHAR(255) NULL,
  user_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_supplier_credit_audit_note (credit_note_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE operation_expense_invoices
  ADD COLUMN IF NOT EXISTS credited_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount DECIMAL(15,2) NULL,
  ADD COLUMN IF NOT EXISTS supplier_credit_balance DECIMAL(15,2) NOT NULL DEFAULT 0;

ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS credited_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount DECIMAL(15,2) NULL,
  ADD COLUMN IF NOT EXISTS supplier_credit_balance DECIMAL(15,2) NOT NULL DEFAULT 0;

ALTER TABLE admin_expenses
  ADD COLUMN IF NOT EXISTS credited_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount DECIMAL(15,2) NULL,
  ADD COLUMN IF NOT EXISTS balance DECIMAL(15,2) NULL,
  ADD COLUMN IF NOT EXISTS supplier_credit_balance DECIMAL(15,2) NOT NULL DEFAULT 0;

UPDATE operation_expense_invoices
SET net_amount = COALESCE(amount_total, 0)
WHERE net_amount IS NULL;

UPDATE purchase_invoices
SET net_amount = COALESCE(total_amount, 0)
WHERE net_amount IS NULL;

UPDATE admin_expenses e
SET e.net_amount = COALESCE(e.amount, 0),
    e.balance = GREATEST(
      0,
      COALESCE(e.amount, 0) - (
        SELECT COALESCE(SUM(p.amount), 0)
        FROM admin_expense_payments p
        WHERE p.expense_id = e.id
          AND COALESCE(p.status, '') <> 'anulado'
      )
    )
WHERE e.net_amount IS NULL OR e.balance IS NULL;
