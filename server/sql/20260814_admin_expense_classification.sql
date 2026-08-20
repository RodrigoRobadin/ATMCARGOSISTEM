-- Clasificación v2 de Gastos Administrativos.
-- Es seguro ejecutar este archivo más de una vez en MariaDB.

ALTER TABLE admin_expense_categories
  ADD COLUMN IF NOT EXISTS system_key VARCHAR(40) NULL;

ALTER TABLE admin_expense_subcategories
  ADD COLUMN IF NOT EXISTS system_key VARCHAR(40) NULL;

ALTER TABLE admin_expense_cost_centers
  ADD COLUMN IF NOT EXISTS ord INT NULL DEFAULT 0;

INSERT INTO admin_expense_categories (name, system_key, ord, active)
SELECT 'Administración', 'ADMINISTRACION', 10, 1
WHERE NOT EXISTS (
  SELECT 1 FROM admin_expense_categories WHERE system_key = 'ADMINISTRACION'
);

INSERT INTO admin_expense_categories (name, system_key, ord, active)
SELECT 'Operativo', 'OPERATIVO', 20, 1
WHERE NOT EXISTS (
  SELECT 1 FROM admin_expense_categories WHERE system_key = 'OPERATIVO'
);

SET @admin_category_id := (
  SELECT id FROM admin_expense_categories
  WHERE system_key = 'ADMINISTRACION' LIMIT 1
);
SET @operational_category_id := (
  SELECT id FROM admin_expense_categories
  WHERE system_key = 'OPERATIVO' LIMIT 1
);

INSERT INTO admin_expense_subcategories
(category_id, name, system_key, ord, active)
SELECT @admin_category_id, 'Fijos', 'FIJOS', 10, 1
WHERE NOT EXISTS (
  SELECT 1 FROM admin_expense_subcategories
  WHERE category_id = @admin_category_id AND system_key = 'FIJOS'
);

INSERT INTO admin_expense_subcategories
(category_id, name, system_key, ord, active)
SELECT @admin_category_id, 'Variables', 'VARIABLES', 20, 1
WHERE NOT EXISTS (
  SELECT 1 FROM admin_expense_subcategories
  WHERE category_id = @admin_category_id AND system_key = 'VARIABLES'
);

INSERT INTO admin_expense_subcategories
(category_id, name, system_key, ord, active)
SELECT @operational_category_id, 'Fijos', 'FIJOS', 10, 1
WHERE NOT EXISTS (
  SELECT 1 FROM admin_expense_subcategories
  WHERE category_id = @operational_category_id AND system_key = 'FIJOS'
);

INSERT INTO admin_expense_subcategories
(category_id, name, system_key, ord, active)
SELECT @operational_category_id, 'Variables', 'VARIABLES', 20, 1
WHERE NOT EXISTS (
  SELECT 1 FROM admin_expense_subcategories
  WHERE category_id = @operational_category_id AND system_key = 'VARIABLES'
);

DROP TEMPORARY TABLE IF EXISTS tmp_admin_expense_cost_centers;
CREATE TEMPORARY TABLE tmp_admin_expense_cost_centers (
  name VARCHAR(120) NOT NULL,
  ord INT NOT NULL
) ENGINE=Memory;

INSERT INTO tmp_admin_expense_cost_centers (name, ord) VALUES
('ALQUILER OFICINA', 10),
('ANDE', 20),
('ESSAP', 30),
('CLARO', 40),
('PERSONAL', 50),
('COPACO LINEAS TELEFONICAS', 60),
('MODICA', 70),
('VIATICO / HOTEL VIAJES ALEJO', 80),
('VIATICO / HOTEL VIAJES RODRIGO', 90),
('PATENTE', 100),
('CAJA CHICA RAYFLEX', 110),
('LIMPIEZA', 120),
('COMBUSTIBLE', 130),
('COMBUSTIBLE / FLOTA BR', 140),
('COMBUSTIBLE / FLOTA PETROBRAS', 150),
('GASTOS VARIOS', 160),
('UNIFORMES', 170),
('REGALOS NAVIDEÑOS', 180),
('UTILES DE OFICINA', 190),
('GASTOS FINANCIEROS CTA USD Y GS', 200),
('GESTIONES / MOTO TAXI', 210),
('SEGURO SAVEIRO ROJO DEBITO', 220),
('SEGURO NOAH DEBITO', 230),
('SEGURO GOLCITO DEBITO', 240),
('SEGURO SAVEIRO GRIS', 250),
('SEGURO AMAROK DEBITO', 260),
('SEGURO ADUANA', 270),
('ATOLPAR', 280),
('CLUB DE EJECUTIVO', 290),
('IPS', 300),
('SET', 310),
('SISTEMA', 320),
('MANTENIMIENTO Y EQUIPAMIENTOS', 330),
('TUPI', 340),
('TRAMITES JUDICIALES', 350),
('MONITAL', 360),
('GPS', 370),
('HONORARIOS CONTABILIDAD', 380),
('SUELDOS Y EXTRAS RAYFLEX', 390),
('SUELDOS ATM', 400),
('VACACIONES - AGUINALDOS - LIQUIDACION', 410),
('IMPRENTA', 420),
('HOSTIN', 430),
('HABILITACIONES', 440),
('EXPO LOGISTICA / PUBLICIDAD', 450),
('MANTENIMIENTO NOAH', 460),
('MANTENIMIENTO AMAROK', 470),
('MANTENIMIENTO SAVEIRO', 480),
('TARJETA DE CREDITO ITAU', 490),
('PRESTAMO ITAU / CAPITAL OPERATIVO', 500),
('INTERES PRESTAMO OPERATIVO', 510),
('PRESTAMO ITAU', 520),
('COMPRA AMAROK', 530),
('COMPRA SAVEIRO', 540),
('COMPRA GOLCITO', 550);

INSERT INTO admin_expense_cost_centers (name, ord, active)
SELECT seed.name, seed.ord, 1
FROM tmp_admin_expense_cost_centers seed
WHERE NOT EXISTS (
  SELECT 1
  FROM admin_expense_cost_centers current_center
  WHERE UPPER(TRIM(current_center.name)) = UPPER(TRIM(seed.name))
);

UPDATE admin_expenses expense
INNER JOIN admin_expense_subcategories old_subcategory
        ON old_subcategory.id = expense.subcategory_id
       AND old_subcategory.system_key IS NULL
INNER JOIN admin_expense_cost_centers center
        ON UPPER(TRIM(center.name)) = UPPER(TRIM(old_subcategory.name))
SET expense.cost_center_id = COALESCE(expense.cost_center_id, center.id);

UPDATE admin_expense_recurrences recurrence
INNER JOIN admin_expense_subcategories old_subcategory
        ON old_subcategory.id = recurrence.subcategory_id
       AND old_subcategory.system_key IS NULL
INNER JOIN admin_expense_cost_centers center
        ON UPPER(TRIM(center.name)) = UPPER(TRIM(old_subcategory.name))
SET recurrence.cost_center_id = COALESCE(recurrence.cost_center_id, center.id);

SET @admin_fixed_id := (
  SELECT id FROM admin_expense_subcategories
  WHERE category_id = @admin_category_id AND system_key = 'FIJOS'
  LIMIT 1
);

UPDATE admin_expenses expense
LEFT JOIN admin_expense_categories old_category
       ON old_category.id = expense.category_id
SET expense.category_id = @admin_category_id,
    expense.subcategory_id = NULL
WHERE expense.category_id IS NULL OR old_category.system_key IS NULL;

UPDATE admin_expense_recurrences recurrence
LEFT JOIN admin_expense_categories old_category
       ON old_category.id = recurrence.category_id
SET recurrence.category_id = @admin_category_id,
    recurrence.subcategory_id = @admin_fixed_id
WHERE recurrence.category_id IS NULL OR old_category.system_key IS NULL;

UPDATE admin_expense_categories SET active = 0 WHERE system_key IS NULL;
UPDATE admin_expense_subcategories SET active = 0 WHERE system_key IS NULL;

DROP TEMPORARY TABLE IF EXISTS tmp_admin_expense_cost_centers;
