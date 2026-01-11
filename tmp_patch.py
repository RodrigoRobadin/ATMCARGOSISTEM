from pathlib import Path
import sys
path=Path('server/src/routes/invoices.js')
t=path.read_bytes().decode('latin1')
before1='    const perc = Number(percentage || 100);'
repl1='    const perc = Number(percentage || 100);\n    const baseAmount = Number(req.body?.base_amount ?? deal.deal_value ?? 0) || 0;'
if before1 not in t:
    sys.exit('b1')
t=t.replace(before1,repl1,1)
before2='    const dealValue = Number(deal.deal_value || 0);\n    const subtotal = Number((dealValue * (perc / 100)).toFixed(2));'
repl2='    const subtotal = Number((baseAmount * (perc / 100)).toFixed(2));'
t=t.replace(before2,repl2,1)
before3="      `INSERT INTO invoices (\n        deal_id, organization_id, invoice_number, issue_date, due_date, payment_terms, notes,\n        payment_condition, timbrado_number, timbrado_start_date, timbrado_expires_at,\n        point_of_issue, establishment, customer_doc_type, customer_doc, customer_email, customer_address,\n        currency_code, exchange_rate, sales_rep, purchase_order_ref,\n        percentage, subtotal, tax_amount, total_amount, balance, status, created_by\n      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'borrador', ?)\n      `;"
repl3="      `INSERT INTO invoices (\n        deal_id, organization_id, invoice_number, issue_date, due_date, payment_terms, notes,\n        payment_condition, timbrado_number, timbrado_start_date, timbrado_expires_at,\n        point_of_issue, establishment, customer_doc_type, customer_doc, customer_email, customer_address,\n        currency_code, exchange_rate, sales_rep, purchase_order_ref,\n        percentage, base_amount, subtotal, tax_amount, total_amount, balance, status, created_by\n      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'borrador', ?)\n      `;"
if before3 not in t:
    sys.exit('b3')
t=t.replace(before3,repl3,1)
before4='        purchase_order_ref || null,\n        perc,\n        subtotal,\n        tax_amount,\n        total_amount,\n        total_amount,\n        req.user.id,'
repl4='        purchase_order_ref || null,\n        perc,\n        baseAmount,\n        subtotal,\n        tax_amount,\n        total_amount,\n        total_amount,\n        req.user.id,'
if before4 not in t:
    sys.exit('b4')
t=t.replace(before4,repl4,1)
path.write_bytes(t.encode('latin1'))
print('ok')
