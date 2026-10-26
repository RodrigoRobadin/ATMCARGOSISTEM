import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';

const base = '/bank-reconciliation';
const fields = [
  ['date', 'Fecha'], ['description', 'Descripción'], ['reference', 'Referencia'],
  ['debit', 'Débito'], ['credit', 'Crédito'], ['amount', 'Importe con signo'],
];
const dateText = (value) => String(value || '').slice(0, 10);
const money = (value, currency) => `${currency === 'PYG' ? 'Gs' : currency} ${Number(value || 0).toLocaleString('es-PY', { minimumFractionDigits: currency === 'PYG' ? 0 : 2, maximumFractionDigits: 2 })}`;

export default function BankReconciliation() {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({ date: 0, description: 1, reference: 2, debit: 3, credit: 4, amount: -1 });
  const [movements, setMovements] = useState([]);
  const [payments, setPayments] = useState([]);
  const [selectedPayment, setSelectedPayment] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const account = accounts.find((row) => String(row.id) === String(accountId));

  async function loadAccounts() {
    try {
      const { data } = await api.get(`${base}/accounts`);
      setAccounts(data.rows || []);
      setAccountId((current) => current || String(data.rows?.[0]?.id || ''));
    } catch (e) { setError(e.response?.data?.error || 'No se pudieron cargar las cuentas.'); }
  }
  async function loadMovements(id = accountId) {
    if (!id) return;
    try {
      const [mov, pay] = await Promise.all([
        api.get(`${base}/movements`, { params: { account_param_id: id } }),
        api.get(`${base}/payments`, { params: { account_param_id: id } }),
      ]);
      setMovements(mov.data.rows || []);
      setPayments(pay.data.rows || []);
    } catch (e) { setError(e.response?.data?.error || 'No se pudieron cargar los movimientos.'); }
  }
  useEffect(() => { loadAccounts(); }, []);
  useEffect(() => { setMovements([]); setPayments([]); loadMovements(accountId); }, [accountId]);

  async function inspectFile(nextFile) {
    setFile(nextFile);
    setPreview(null);
    setError('');
    if (!nextFile) return;
    const body = new FormData();
    body.append('file', nextFile);
    setBusy(true);
    try {
      const { data } = await api.post(`${base}/preview`, body);
      setPreview(data);
      const names = (data.headers || []).map((header) => String(header).toLowerCase());
      const find = (pattern) => names.findIndex((name) => pattern.test(name));
      setMapping({
        date: find(/fecha|date/), description: find(/concepto|descrip|detalle|movimiento/),
        reference: find(/referencia|comprobante|nro|número/), debit: find(/débito|debito|cargo/),
        credit: find(/crédito|credito|abono/), amount: find(/importe|monto|amount/),
      });
    } catch (e) { setError(e.response?.data?.error || 'No se pudo leer el archivo.'); }
    finally { setBusy(false); }
  }

  async function importFile() {
    setError(''); setNotice('');
    if (!file || !accountId) return setError('Seleccione una cuenta y un archivo.');
    if (mapping.date < 0 || mapping.description < 0 || !(mapping.debit >= 0 && mapping.credit >= 0) && mapping.amount < 0) {
      return setError('Seleccione fecha, descripción y débito/crédito o importe con signo.');
    }
    const body = new FormData();
    body.append('file', file);
    body.append('account_param_id', accountId);
    body.append('mapping', JSON.stringify(mapping));
    setBusy(true);
    try {
      const { data } = await api.post(`${base}/imports`, body);
      setNotice(`${data.inserted} movimientos importados.${data.skipped ? ` ${data.skipped} posibles duplicados omitidos: revisá el extracto antes de cerrar el período.` : ''}`);
      setPreview(null); setFile(null);
      await loadMovements();
    } catch (e) { setError(e.response?.data?.error || 'No se pudo importar el extracto.'); }
    finally { setBusy(false); }
  }

  async function match(movementId) {
    const paymentId = Number(selectedPayment[movementId]);
    if (!paymentId) return;
    setBusy(true); setError('');
    try {
      await api.post(`${base}/matches`, { movement_id: movementId, payment_id: paymentId });
      await loadMovements();
    } catch (e) { setError(e.response?.data?.error || 'No se pudo conciliar.'); }
    finally { setBusy(false); }
  }

  async function unmatch(movementId) {
    const reason = window.prompt('Motivo para quitar la conciliación');
    if (!reason?.trim()) return;
    setBusy(true); setError('');
    try {
      await api.delete(`${base}/matches/${movementId}`, { data: { reason: reason.trim() } });
      await loadMovements();
    } catch (e) { setError(e.response?.data?.error || 'No se pudo quitar la conciliación.'); }
    finally { setBusy(false); }
  }

  const totals = useMemo(() => ({
    debits: movements.filter((row) => Number(row.debit_amount) > 0).length,
    matched: movements.filter((row) => row.payment_id).length,
    unmatchedPayments: payments.length,
  }), [movements, payments]);
  const matchingPayments = (movement) => payments.filter((payment) =>
    Math.round(Number(payment.amount) * 100) === Math.round(Number(movement.debit_amount) * 100))
    .sort((a, b) => {
      const reference = String(movement.reference_number || '').trim().toLowerCase();
      const aRef = reference && String(a.reference_number || '').trim().toLowerCase() === reference ? 1 : 0;
      const bRef = reference && String(b.reference_number || '').trim().toLowerCase() === reference ? 1 : 0;
      if (aRef !== bRef) return bRef - aRef;
      return Math.abs(new Date(a.payment_date) - new Date(movement.movement_date)) - Math.abs(new Date(b.payment_date) - new Date(movement.movement_date));
    });

  return <main className="mx-auto max-w-7xl px-4 py-6 text-slate-900">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b pb-4">
      <div><h1 className="text-xl font-semibold">Conciliación bancaria</h1><p className="text-sm text-slate-600">Movimientos de Itaú y Continental frente a pagos registrados.</p></div>
      <label className="text-sm font-medium">Cuenta de la empresa
        <select className="mt-1 block min-w-72 rounded border px-3 py-2" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Seleccionar cuenta</option>
          {accounts.map((row) => <option key={row.id} value={row.id}>{row.alias} · {row.bank_name} · {row.currency_code} · {row.account_number}</option>)}
        </select>
      </label>
    </div>
    {error && <p role="alert" className="mb-3 border-l-4 border-red-500 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="mb-3 border-l-4 border-emerald-500 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <section className="mb-6 border-b pb-6">
      <h2 className="mb-3 font-semibold">Importar extracto</h2>
      <div className="flex flex-wrap items-center gap-3 text-sm"><input type="file" accept=".csv,.xlsx" onChange={(e) => inspectFile(e.target.files?.[0] || null)} /><span>CSV o Excel, hasta 5 MB y 5.000 movimientos.</span></div>
      {preview && <div className="mt-4 space-y-4">
        <p className="text-sm">{preview.row_count} filas detectadas. Verificá las columnas antes de importar.</p>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{fields.map(([key, label]) => <label key={key} className="text-xs font-medium">{label}<select className="mt-1 w-full rounded border px-2 py-2 text-sm" value={mapping[key] ?? -1} onChange={(e) => setMapping((old) => ({ ...old, [key]: Number(e.target.value) }))}><option value={-1}>Sin columna</option>{preview.headers.map((name, index) => <option key={index} value={index}>{name || `Columna ${index + 1}`}</option>)}</select></label>)}</div>
        <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-xs"><thead className="bg-slate-100"><tr>{preview.headers.map((head, index) => <th key={index} className="border-b p-2">{head || `Columna ${index + 1}`}</th>)}</tr></thead><tbody>{preview.sample.map((row, index) => <tr key={index}>{preview.headers.map((_, column) => <td key={column} className="border-b p-2">{row[column] || ''}</td>)}</tr>)}</tbody></table></div>
        <button disabled={busy || !accountId} className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50" onClick={importFile}>Importar movimientos</button>
      </div>}
    </section>
    <div className="mb-3 flex flex-wrap gap-6 text-sm"><span>Débitos: <strong>{totals.debits}</strong></span><span>Conciliados: <strong>{totals.matched}</strong></span><span>Pagos sin movimiento: <strong>{totals.unmatchedPayments}</strong></span></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-100 text-xs uppercase text-slate-600"><tr><th className="p-2">Fecha</th><th className="p-2">Movimiento</th><th className="p-2">Referencia</th><th className="p-2 text-right">Débito</th><th className="p-2 text-right">Crédito</th><th className="p-2">Conciliación</th></tr></thead><tbody>
      {movements.map((row) => <tr key={row.id} className="border-b align-top"><td className="p-2 whitespace-nowrap">{dateText(row.movement_date)}</td><td className="p-2 max-w-72"><div className="break-words font-medium">{row.description}</div><div className="text-xs text-slate-500">{row.file_name}</div></td><td className="p-2">{row.reference_number || '-'}</td><td className="p-2 text-right whitespace-nowrap">{Number(row.debit_amount) ? money(row.debit_amount, account?.currency_code) : '-'}</td><td className="p-2 text-right whitespace-nowrap">{Number(row.credit_amount) ? money(row.credit_amount, account?.currency_code) : '-'}</td><td className="p-2">{row.payment_id ? <div className="flex items-center gap-3"><span className="text-emerald-700">{row.order_number} · pago #{row.payment_id}</span><button disabled={busy} className="text-blue-700 underline disabled:opacity-50" onClick={() => unmatch(row.id)}>Desvincular</button></div> : Number(row.debit_amount) ? <div className="flex flex-wrap gap-2"><select className="min-w-56 rounded border px-2 py-1" value={selectedPayment[row.id] || ''} onChange={(e) => setSelectedPayment((old) => ({ ...old, [row.id]: e.target.value }))}><option value="">Seleccionar pago</option>{matchingPayments(row).map((payment) => <option key={payment.id} value={payment.id}>{payment.order_number} · {payment.supplier_name} · {dateText(payment.payment_date)} · {payment.reference_number || 'sin referencia'}</option>)}</select><button disabled={busy || !selectedPayment[row.id]} className="rounded border px-2 py-1 disabled:opacity-50" onClick={() => match(row.id)}>Conciliar</button>{!matchingPayments(row).length && <span className="text-xs text-amber-700">Sin pago del mismo importe</span>}</div> : <span className="text-slate-500">Crédito sin pago asociado</span>}</td></tr>)}
      {!movements.length && <tr><td colSpan={6} className="p-8 text-center text-slate-500">No hay movimientos importados para esta cuenta.</td></tr>}
    </tbody></table></div>
    {!!payments.length && <section className="mt-8 border-t pt-4"><h2 className="mb-2 font-semibold">Pagos aún sin movimiento bancario</h2><div className="space-y-1 text-sm">{payments.map((row) => <div key={row.id} className="flex flex-wrap justify-between gap-2 border-b py-2"><span>{dateText(row.payment_date)} · {row.order_number} · {row.supplier_name} · {row.reference_number || 'sin referencia'}</span><strong>{money(row.amount, account?.currency_code)}</strong></div>)}</div></section>}
  </main>;
}
