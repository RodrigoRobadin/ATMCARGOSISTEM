import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../api';
import { companyBankAccountLabel, companyBankAccountValue, filterCompanyBankAccounts, parseCompanyBankAccounts } from '../utils/companyBankAccounts';

const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Asuncion' }).format(new Date());
const money = (value, currency) => new Intl.NumberFormat('es-PY', {
  style: 'currency', currency, minimumFractionDigits: currency === 'PYG' ? 0 : 2,
}).format(Number(value || 0));

export default function CustomerBatchReceiptModal({ invoices, onClose, onSaved }) {
  const currency = String(invoices[0]?.currency_code || 'USD').toUpperCase();
  const [amounts, setAmounts] = useState(() => Object.fromEntries(invoices.map((row) =>
    [row.id, Number(row.balance || 0).toFixed(2)])));
  const [form, setForm] = useState({ payment_date: today(), payment_method: 'transferencia',
    bank_account: '', reference_number: '', retention_pct: '0' });
  const [accounts, setAccounts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(crypto.randomUUID());
  const options = useMemo(() => filterCompanyBankAccounts(accounts, currency), [accounts, currency]);
  const total = invoices.reduce((sum, row) => sum + Math.round(Number(amounts[row.id] || 0) * 100), 0) / 100;

  useEffect(() => {
    let active = true;
    api.get('/params', { params: { keys: 'company_bank_account', only_active: 1 } })
      .then(({ data }) => {
        if (!active) return;
        const parsed = parseCompanyBankAccounts(data?.company_bank_account || []);
        setAccounts(parsed);
        const first = filterCompanyBankAccounts(parsed, currency)[0];
        setForm((old) => ({ ...old, bank_account: first ? companyBankAccountValue(first) : '' }));
      }).catch(() => { if (active) setError('No se pudieron cargar las cuentas bancarias.'); });
    return () => { active = false; };
  }, [currency]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    const applications = invoices.map((row) => ({ invoice_id: row.id, amount: Number(amounts[row.id] || 0) }));
    if (applications.some((item) => !(item.amount > 0)) ||
        applications.some((item) => item.amount > Number(invoices.find((row) => row.id === item.invoice_id)?.balance || 0) + 0.001)) {
      setError('Cada factura debe tener un importe positivo que no supere su saldo.');
      return;
    }
    if (form.payment_method !== 'efectivo' && !form.bank_account) {
      setError('Seleccione una cuenta de la empresa para este cobro.');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post('/invoices/receipts/batch', {
        ...form, request_id: requestId.current, applications,
      });
      onSaved(data);
    } catch (err) {
      setError(err?.response?.data?.error || 'No se pudo registrar el recibo.');
    } finally { setSaving(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" role="presentation">
    <form onSubmit={submit} role="dialog" aria-modal="true" aria-label="Nuevo recibo" className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
      <header className="flex items-center justify-between border-b px-5 py-4">
        <div><h2 className="text-lg font-semibold">Nuevo recibo</h2><p className="text-sm text-slate-600">{invoices[0]?.customer_name} · {currency}</p></div>
        <button type="button" onClick={onClose} disabled={saving} aria-label="Cerrar" className="rounded border px-2 py-1">×</button>
      </header>
      <div className="min-h-0 overflow-y-auto p-5">
        <div className="overflow-x-auto"><table className="w-full min-w-[550px] text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase text-slate-600"><tr><th className="p-2">Factura</th><th className="p-2">Operación</th><th className="p-2 text-right">Disponible</th><th className="p-2 text-right">A aplicar</th></tr></thead>
          <tbody>{invoices.map((row) => <tr key={row.id} className="border-b">
            <td className="p-2 font-medium">{row.invoice_number}</td><td className="p-2">{row.operation_reference || '-'}</td>
            <td className="p-2 text-right">{money(row.balance, currency)}</td>
            <td className="p-2"><div className="flex justify-end gap-1"><input type="number" min="0.01" max={row.balance} step="0.01" required className="w-32 rounded border px-2 py-1 text-right" aria-label={`A aplicar a ${row.invoice_number}`} value={amounts[row.id] ?? ''} onChange={(e) => setAmounts((old) => ({ ...old, [row.id]: e.target.value }))} /><button type="button" className="rounded border px-2 text-xs" title="Aplicar el saldo completo" onClick={() => setAmounts((old) => ({ ...old, [row.id]: Number(row.balance).toFixed(2) }))}>Total</button></div></td>
          </tr>)}</tbody>
        </table></div>
        <div className="mt-3 text-right font-semibold">Total del recibo: {money(total, currency)}</div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Fecha de cobro<input type="date" required value={form.payment_date} onChange={(e) => setForm((old) => ({ ...old, payment_date: e.target.value }))} className="mt-1 block w-full rounded border px-3 py-2" /></label>
          <label className="text-sm">Método de pago<select value={form.payment_method} onChange={(e) => setForm((old) => ({ ...old, payment_method: e.target.value }))} className="mt-1 block w-full rounded border px-3 py-2"><option value="transferencia">Transferencia</option><option value="cheque">Cheque</option><option value="tarjeta">Tarjeta</option><option value="efectivo">Efectivo</option><option value="otro">Otro</option></select></label>
          <label className="text-sm">Cuenta destino<select disabled={form.payment_method === 'efectivo'} required={form.payment_method !== 'efectivo'} value={form.bank_account} onChange={(e) => setForm((old) => ({ ...old, bank_account: e.target.value }))} className="mt-1 block w-full rounded border px-3 py-2 disabled:opacity-50"><option value="">Seleccionar</option>{options.map((account) => <option key={account.id} value={companyBankAccountValue(account)}>{companyBankAccountLabel(account)}</option>)}</select></label>
          <label className="text-sm">Referencia bancaria<input value={form.reference_number} maxLength={128} onChange={(e) => setForm((old) => ({ ...old, reference_number: e.target.value }))} className="mt-1 block w-full rounded border px-3 py-2" /></label>
          <label className="text-sm">Retención IVA (%)<input type="number" min="0" max="100" step="0.01" value={form.retention_pct} onChange={(e) => setForm((old) => ({ ...old, retention_pct: e.target.value }))} className="mt-1 block w-full rounded border px-3 py-2" /></label>
        </div>
        {error && <p role="alert" className="mt-4 border-l-4 border-red-500 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </div>
      <footer className="flex justify-end gap-2 border-t px-5 py-4"><button type="button" onClick={onClose} disabled={saving} className="rounded border px-4 py-2">Cancelar</button><button disabled={saving || !(total > 0)} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">{saving ? 'Registrando...' : 'Registrar recibo'}</button></footer>
    </form>
  </div>;
}
