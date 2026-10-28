import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth.jsx';

const base = '/bank-reconciliation';
const fields = [
  ['date', 'Fecha'], ['description', 'Descripción'], ['reference', 'Referencia'],
  ['debit', 'Débito'], ['credit', 'Crédito'], ['amount', 'Importe con signo'],
];
const dateText = (value) => String(value || '').slice(0, 10);
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Asuncion' }).format(new Date());
const money = (value, currency) => `${currency === 'PYG' ? 'Gs' : currency} ${Number(value || 0).toLocaleString('es-PY', { minimumFractionDigits: currency === 'PYG' ? 0 : 2, maximumFractionDigits: 2 })}`;
const sourceLabel = { receipt: 'Cobro', payment_order: 'Orden de pago', operation_expense: 'Gasto operativo', admin_expense: 'Gasto administrativo', purchase_invoice: 'Factura de compra', manual: 'Manual', transfer: 'Transferencia interna' };

function DocumentReference({ row, onOpenPdf }) {
  const pdfPath = row.source_type === 'receipt'
    ? `/invoices/receipts/${row.source_id}/pdf`
    : row.source_type === 'payment_order'
      ? `/accounts-payable/unified-payment-orders/${row.order_id}/pdf` : '';
  const documentHref = row.source_type === 'purchase_invoice' && row.purchase_invoice_id
    ? `/purchase-invoices/${row.purchase_invoice_id}`
    : row.source_type === 'operation_expense' && row.operation_links?.length === 1
      ? (row.operation_links[0].type === 'service'
        ? `/service/cases/${row.operation_links[0].id}` : `/operations/${row.operation_links[0].id}`)
      : '';
  return <div className="min-w-32">
    {row.document_number && <div className="font-medium">
      {pdfPath ? <button type="button" className="text-blue-700 hover:underline" onClick={() => onOpenPdf(pdfPath)}>{row.document_number}</button>
        : documentHref ? <a className="text-blue-700 hover:underline" href={documentHref} target="_blank" rel="noreferrer">{row.document_number}</a>
          : row.document_number}
    </div>}
    {row.operation_links?.length > 0 && <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs">
      {row.operation_links.map((link) => <a key={`${link.type}-${link.id}`} className="text-blue-700 hover:underline" href={link.type === 'service' ? `/service/cases/${link.id}` : `/operations/${link.id}`} target="_blank" rel="noreferrer">{link.reference}</a>)}
    </div>}
    {row.reference_number && <div className="text-xs text-slate-500">Ref. bancaria: {row.reference_number}</div>}
    {!row.document_number && !row.reference_number && !row.operation_links?.length && '-'}
  </div>;
}

export default function BankReconciliation() {
  const { user } = useAuth();
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({ date: 0, description: 1, reference: 2, debit: 3, credit: 4, amount: -1 });
  const [movements, setMovements] = useState([]);
  const [payments, setPayments] = useState([]);
  const [balance, setBalance] = useState(null);
  const [openingDate, setOpeningDate] = useState('');
  const [openingAmount, setOpeningAmount] = useState('');
  const [period, setPeriod] = useState(today().slice(0, 7));
  const [reconciliation, setReconciliation] = useState(null);
  const [bankClosingBalance, setBankClosingBalance] = useState('');
  const [periodNotes, setPeriodNotes] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [manualEntry, setManualEntry] = useState({ movement_date: today(), direction: 'debit', amount: '', description: '', reference_number: '' });
  const manualRequestId = useRef(null);
  const [transfer, setTransfer] = useState({ to_account_param_id: '', movement_date: today(), amount: '', reference_number: '', observations: '' });
  const transferRequestId = useRef(null);
  const [selectedPayment, setSelectedPayment] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const accountIdRef = useRef(accountId);
  accountIdRef.current = accountId;
  const periodRef = useRef(period);
  periodRef.current = period;
  const account = accounts.find((row) => String(row.id) === String(accountId));

  function patchManualEntry(key, value) {
    manualRequestId.current = null;
    setManualEntry((old) => ({ ...old, [key]: value }));
  }

  function patchTransfer(key, value) {
    transferRequestId.current = null;
    setTransfer((old) => ({ ...old, [key]: value }));
  }

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
      if (String(id) !== String(accountIdRef.current)) return;
      setMovements(mov.data.rows || []);
      setPayments(pay.data.rows || []);
    } catch (e) { setError(e.response?.data?.error || 'No se pudieron cargar los movimientos.'); }
  }
  async function loadBalance(id = accountId) {
    if (!id) return;
    try {
      const { data } = await api.get(`${base}/balance`, { params: { account_param_id: id } });
      if (String(id) !== String(accountIdRef.current)) return;
      setBalance(data);
      setOpeningDate(dateText(data.opening?.balance_date));
      setOpeningAmount(data.opening?.amount == null ? '' : String(data.opening.amount));
    } catch (e) { setError(e.response?.data?.error || 'No se pudo cargar el saldo de la cuenta.'); }
  }
  async function loadPeriod(id = accountId, month = period) {
    if (!id || !balance?.opening) return;
    try {
      const { data } = await api.get(`${base}/period`, { params: { account_param_id: id, period: month } });
      if (String(id) !== String(accountIdRef.current) || month !== periodRef.current) return;
      setReconciliation(data);
      setBankClosingBalance(data.saved?.bank_balance == null ? '' : String(data.saved.bank_balance));
      setPeriodNotes(data.saved?.notes || '');
    } catch (e) { setError(e.response?.data?.error || 'No se pudo cargar la conciliación del mes.'); }
  }
  useEffect(() => { loadAccounts(); }, []);
  useEffect(() => {
    manualRequestId.current = null;
    transferRequestId.current = null;
    setManualEntry({ movement_date: today(), direction: 'debit', amount: '', description: '', reference_number: '' });
    setTransfer({ to_account_param_id: '', movement_date: today(), amount: '', reference_number: '', observations: '' });
    setMovements([]); setPayments([]); setBalance(null); setOpeningDate(''); setOpeningAmount('');
    setReconciliation(null); setBankClosingBalance(''); setPeriodNotes('');
    loadMovements(accountId); loadBalance(accountId);
  }, [accountId]);
  useEffect(() => {
    setReconciliation(null);
    setBankClosingBalance('');
    if (balance?.opening) loadPeriod(accountId, period);
  }, [accountId, period, balance?.opening?.balance_date, balance?.opening?.amount]);

  async function saveBankBalance() {
    setBusy(true); setError(''); setNotice('');
    try {
      await api.put(`${base}/period`, { account_param_id: Number(accountId), period,
        bank_balance: bankClosingBalance, notes: periodNotes });
      await loadPeriod();
      setNotice('Saldo bancario del mes guardado.');
    } catch (e) { setError(e.response?.data?.error || 'No se pudo guardar el saldo bancario.'); }
    finally { setBusy(false); }
  }

  async function toggleClearance(row) {
    setBusy(true); setError('');
    try {
      await api.put(`${base}/period/clearance`, { account_param_id: Number(accountId), period,
        source_type: row.source_type, source_id: row.source_id, cleared: !row.cleared });
      await loadPeriod();
    } catch (e) { setError(e.response?.data?.error || 'No se pudo actualizar el movimiento.'); }
    finally { setBusy(false); }
  }

  async function closePeriod() {
    if (!window.confirm(`¿Cerrar la conciliación de ${period}?`)) return;
    setBusy(true); setError('');
    try {
      await api.post(`${base}/period/close`, { account_param_id: Number(accountId), period });
      await loadPeriod();
      setNotice('Mes conciliado y cerrado.');
    } catch (e) { setError(e.response?.data?.error || 'No se pudo cerrar el mes.'); }
    finally { setBusy(false); }
  }

  async function reopenPeriod() {
    const reason = window.prompt('Motivo para reabrir el mes');
    if (!reason?.trim()) return;
    setBusy(true); setError('');
    try {
      await api.post(`${base}/period/reopen`, { account_param_id: Number(accountId), period, reason: reason.trim() });
      await loadPeriod();
      setNotice('Mes reabierto.');
    } catch (e) { setError(e.response?.data?.error || 'No se pudo reabrir el mes.'); }
    finally { setBusy(false); }
  }

  async function saveBalance() {
    setError(''); setNotice('');
    if (!accountId || !openingDate || openingAmount === '') {
      return setError('Seleccione una cuenta, fecha y saldo inicial.');
    }
    setBusy(true);
    try {
      await api.put(`${base}/balance`, {
        account_param_id: Number(accountId), balance_date: openingDate, amount: openingAmount,
      });
      await loadBalance();
      setNotice('Saldo inicial guardado.');
    } catch (e) { setError(e.response?.data?.error || 'No se pudo guardar el saldo inicial.'); }
    finally { setBusy(false); }
  }

  async function saveManualEntry() {
    setError(''); setNotice('');
    if (!balance?.opening || !manualEntry.description.trim() || !(Number(manualEntry.amount) > 0)) {
      return setError('Complete fecha, concepto e importe del movimiento.');
    }
    manualRequestId.current ||= crypto.randomUUID();
    setBusy(true);
    try {
      await api.post(`${base}/book-entries`, { ...manualEntry,
        account_param_id: Number(accountId), request_id: manualRequestId.current });
      manualRequestId.current = null;
      setManualEntry({ movement_date: today(), direction: 'debit', amount: '', description: '', reference_number: '' });
      await loadBalance();
      await loadPeriod();
      setNotice('Movimiento registrado en el Libro banco.');
    } catch (e) { setError(e.response?.data?.error || 'No se pudo registrar el movimiento.'); }
    finally { setBusy(false); }
  }

  async function saveTransfer() {
    setError(''); setNotice('');
    if (!accountId || !transfer.to_account_param_id || !transfer.movement_date || !(Number(transfer.amount) > 0)) {
      return setError('Seleccione ambas cuentas, fecha e importe.');
    }
    transferRequestId.current ||= crypto.randomUUID();
    setBusy(true);
    try {
      await api.post(`${base}/transfers`, { ...transfer,
        from_account_param_id: Number(accountId), to_account_param_id: Number(transfer.to_account_param_id),
        request_id: transferRequestId.current });
      transferRequestId.current = null;
      setTransfer({ to_account_param_id: '', movement_date: today(), amount: '', reference_number: '', observations: '' });
      await loadBalance();
      await loadPeriod();
      setNotice('Transferencia registrada en ambas cuentas.');
    } catch (e) { setError(e.response?.data?.error || 'No se pudo registrar la transferencia.'); }
    finally { setBusy(false); }
  }

  async function reverseTransfer(id) {
    const reason = window.prompt('Motivo de la reversión');
    if (!reason?.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.post(`${base}/transfers/${id}/reverse`, { reason: reason.trim() });
      await loadBalance();
      await loadPeriod();
      setNotice('Reversión registrada en ambas cuentas.');
    } catch (e) { setError(e.response?.data?.error || 'No se pudo revertir la transferencia.'); }
    finally { setBusy(false); }
  }

  async function openBankDocument(path) {
    try {
      const { data } = await api.get(path, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { setError(e.response?.data?.error || 'No se pudo abrir el documento.'); }
  }

  async function reverseManualEntry(id) {
    const reason = window.prompt('Motivo de la reversión');
    if (!reason?.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.post(`${base}/book-entries/${id}/reverse`, { reason: reason.trim() });
      await loadBalance();
      await loadPeriod();
      setNotice('Reversión registrada.');
    } catch (e) { setError(e.response?.data?.error || 'No se pudo revertir el movimiento.'); }
    finally { setBusy(false); }
  }

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
      await loadBalance();
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
  const reversedEntries = new Set((balance?.rows || []).map((row) => Number(row.reverses_entry_id)).filter(Boolean));
  const transferDestinations = accounts.filter((row) => String(row.id) !== String(accountId) && row.currency_code === account?.currency_code);
  const periodRows = (reconciliation?.rows || []).filter((row) => !pendingOnly || !row.cleared);
  const outstandingRows = (reconciliation?.rows || []).filter((row) => !row.cleared);
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
      <div><h1 className="text-xl font-semibold">Libro banco y conciliación</h1></div>
      <label className="text-sm font-medium">Cuenta de la empresa
        <select disabled={busy} className="mt-1 block min-w-72 rounded border px-3 py-2 disabled:opacity-50" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Seleccionar cuenta</option>
          {accounts.map((row) => <option key={row.id} value={row.id}>{row.alias} · {row.bank_name} · {row.currency_code} · {row.account_number}</option>)}
        </select>
      </label>
    </div>
    {error && <p role="alert" className="mb-3 border-l-4 border-red-500 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="mb-3 border-l-4 border-emerald-500 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {account && <section className="mb-6 border-b pb-6">
      <h2 className="mb-3 font-semibold">Libro banco</h2>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label>Saldo al inicio del día
          <input type="date" className="mt-1 block rounded border px-3 py-2" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
        </label>
        <label>Saldo inicial ({account.currency_code})
          <input type="number" step="0.01" className="mt-1 block w-44 rounded border px-3 py-2" value={openingAmount} onChange={(e) => setOpeningAmount(e.target.value)} placeholder="0.00" />
        </label>
        <button disabled={busy || !openingDate || openingAmount === ''} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50" onClick={saveBalance}>Guardar saldo</button>
      </div>
      {balance?.opening && <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <span>Inicial: <strong>{money(balance.opening.amount, account.currency_code)}</strong></span>
        <span>Créditos: <strong>{money(balance.credits, account.currency_code)}</strong></span>
        <span>Débitos: <strong>{money(balance.debits, account.currency_code)}</strong></span>
        <span>Saldo calculado: <strong>{money(balance.calculated_balance, account.currency_code)}</strong></span>
        <span className="text-slate-500">{balance.movement_count} movimientos desde {dateText(balance.opening.balance_date)}</span>
      </div>}
      {balance?.unassigned_count > 0 && <p role="alert" className="mt-3 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900">
        {balance.unassigned_count} cobro(s) o pago(s) de {account.currency_code} tienen una cuenta no reconocida desde la fecha inicial. No están incluidos en este saldo.
      </p>}
      {balance?.opening && <>
        <div className="mt-5 flex flex-wrap items-end gap-3 text-sm">
          <label>Fecha<input type="date" className="mt-1 block rounded border px-2 py-2" value={manualEntry.movement_date} onChange={(e) => patchManualEntry('movement_date', e.target.value)} /></label>
          <label>Movimiento<select className="mt-1 block rounded border px-2 py-2" value={manualEntry.direction} onChange={(e) => patchManualEntry('direction', e.target.value)}><option value="credit">Entrada</option><option value="debit">Salida</option></select></label>
          <label>Importe ({account.currency_code})<input type="number" min="0.01" step="0.01" className="mt-1 block w-36 rounded border px-2 py-2" value={manualEntry.amount} onChange={(e) => patchManualEntry('amount', e.target.value)} /></label>
          <label>Concepto<input className="mt-1 block w-52 rounded border px-2 py-2" value={manualEntry.description} onChange={(e) => patchManualEntry('description', e.target.value)} /></label>
          <label>Referencia<input className="mt-1 block w-36 rounded border px-2 py-2" value={manualEntry.reference_number} onChange={(e) => patchManualEntry('reference_number', e.target.value)} /></label>
          <button disabled={busy || !manualEntry.movement_date || !manualEntry.description.trim() || !(Number(manualEntry.amount) > 0)} className="rounded border px-3 py-2 disabled:opacity-50" onClick={saveManualEntry}>Registrar movimiento</button>
        </div>
        <div className="mt-5 border-t pt-4">
          <h3 className="mb-3 text-sm font-semibold">Transferencia entre cuentas</h3>
          <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <label>Desde<input readOnly value={`${account.alias} · ${account.currency_code}`} className="mt-1 block w-full rounded border bg-slate-50 px-3 py-2" /></label>
            <label>Hacia<select value={transfer.to_account_param_id} onChange={(e) => patchTransfer('to_account_param_id', e.target.value)} className="mt-1 block w-full rounded border px-3 py-2"><option value="">Seleccionar cuenta</option>{transferDestinations.map((row) => <option key={row.id} value={row.id}>{row.alias} · {row.bank_name} · {row.account_number}</option>)}</select></label>
            <label>Fecha<input type="date" value={transfer.movement_date} onChange={(e) => patchTransfer('movement_date', e.target.value)} className="mt-1 block w-full rounded border px-3 py-2" /></label>
            <label>Importe ({account.currency_code})<input type="number" min="0.01" step="0.01" value={transfer.amount} onChange={(e) => patchTransfer('amount', e.target.value)} className="mt-1 block w-full rounded border px-3 py-2" /></label>
            <label>Referencia<input maxLength={160} value={transfer.reference_number} onChange={(e) => patchTransfer('reference_number', e.target.value)} className="mt-1 block w-full rounded border px-3 py-2" /></label>
            <label>Observaciones<input maxLength={500} value={transfer.observations} onChange={(e) => patchTransfer('observations', e.target.value)} className="mt-1 block w-full rounded border px-3 py-2" /></label>
          </div>
          <div className="mt-3 flex justify-end"><button disabled={busy || !transfer.to_account_param_id || !transfer.movement_date || !(Number(transfer.amount) > 0)} onClick={saveTransfer} className="rounded bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-50">Registrar transferencia</button></div>
        </div>
        <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead className="border-b bg-slate-100 text-xs uppercase text-slate-600"><tr><th className="p-2">Fecha</th><th className="p-2">Origen</th><th className="p-2">Concepto</th><th className="p-2">Documento / referencia</th><th className="p-2 text-right">Entrada</th><th className="p-2 text-right">Salida</th><th className="p-2 text-right">Saldo</th><th className="p-2"></th></tr></thead><tbody>
          {(balance.rows || []).map((row) => <tr key={`${row.source_type}-${row.source_id}`} className="border-b"><td className="p-2 whitespace-nowrap">{dateText(row.movement_date)}</td><td className="p-2">{sourceLabel[row.source_type] || row.source_type}</td><td className="p-2">{row.description}{row.observations && <span className="block text-xs text-slate-500">{row.observations}</span>}</td><td className="p-2"><DocumentReference row={row} onOpenPdf={openBankDocument} /></td><td className="p-2 text-right whitespace-nowrap">{Number(row.credit) ? money(row.credit, account.currency_code) : '-'}</td><td className="p-2 text-right whitespace-nowrap">{Number(row.debit) ? money(row.debit, account.currency_code) : '-'}</td><td className="p-2 text-right whitespace-nowrap font-medium">{money(row.balance, account.currency_code)}</td><td className="p-2">{row.source_type === 'manual' && !row.reverses_entry_id && !reversedEntries.has(Number(row.source_id)) && <button disabled={busy} className="text-blue-700 underline disabled:opacity-50" onClick={() => reverseManualEntry(row.source_id)}>Revertir</button>}{row.source_type === 'transfer' && !row.reverses_transfer_id && !row.reversed_by && <button disabled={busy} className="text-blue-700 underline disabled:opacity-50" onClick={() => reverseTransfer(row.source_id)}>Revertir</button>}</td></tr>)}
          {!balance.rows?.length && <tr><td colSpan={8} className="p-5 text-center text-slate-500">Sin movimientos registrados desde esta fecha.</td></tr>}
        </tbody></table></div>
      </>}
      {!!balance?.events?.length && <details className="mt-3 text-xs text-slate-600"><summary className="cursor-pointer">Historial de saldos iniciales</summary>
        <ul className="mt-2 space-y-1">{balance.events.map((event, index) => <li key={index}>{new Date(event.created_at).toLocaleString('es-PY')} · Usuario #{event.actor_user_id} · {dateText(event.balance_date)} · {money(event.amount, account.currency_code)}</li>)}</ul>
      </details>}
    </section>}
    {account && balance?.opening && <section className="mb-6 border-b pb-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-semibold">Conciliación mensual</h2>
        <label className="text-sm">Mes<input type="month" className="mt-1 block rounded border px-3 py-2" value={period} onChange={(e) => setPeriod(e.target.value)} /></label>
      </div>
      {reconciliation && <>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label>Saldo según banco ({account.currency_code})<input type="number" step="0.01" className="mt-1 block w-48 rounded border px-3 py-2" disabled={busy || reconciliation.saved?.status === 'closed'} value={bankClosingBalance} onChange={(e) => setBankClosingBalance(e.target.value)} /></label>
          <label>Observación<input className="mt-1 block w-64 rounded border px-3 py-2" disabled={busy || reconciliation.saved?.status === 'closed'} value={periodNotes} onChange={(e) => setPeriodNotes(e.target.value)} /></label>
          {reconciliation.saved?.status !== 'closed' && <button disabled={busy || bankClosingBalance === ''} className="rounded border px-3 py-2 disabled:opacity-50" onClick={saveBankBalance}>Guardar saldo bancario</button>}
          {reconciliation.saved?.status === 'closed' && <strong className="text-emerald-700">Mes cerrado</strong>}
        </div>
        {reconciliation.saved?.bank_balance != null && <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <span>Libro banco: <strong>{money(reconciliation.calculated_balance, account.currency_code)}</strong></span>
          <span>Banco: <strong>{money(reconciliation.saved.bank_balance, account.currency_code)}</strong></span>
          <span>Pendientes: <strong>{reconciliation.outstanding_count}</strong></span>
          <span>Entradas pendientes: <strong>{money(reconciliation.outstanding_credits, account.currency_code)}</strong></span>
          <span>Salidas pendientes: <strong>{money(reconciliation.outstanding_debits, account.currency_code)}</strong></span>
          <span>Banco ajustado: <strong>{money(reconciliation.adjusted_bank_balance, account.currency_code)}</strong></span>
          <span className={reconciliation.difference === '0.00' ? 'text-emerald-700' : 'text-red-700'}>Diferencia: <strong>{money(reconciliation.difference, account.currency_code)}</strong></span>
        </div>}
        {reconciliation.saved?.bank_balance != null && <details className="mt-4 border-t pt-4" defaultOpen={reconciliation.difference !== '0.00'}>
          <summary className="cursor-pointer text-sm font-semibold">Detalle de la diferencia</summary>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><span className="text-slate-600">Saldo del Libro banco</span><div className="font-semibold">{money(reconciliation.calculated_balance, account.currency_code)}</div></div>
            <div><span className="text-slate-600">Menos entradas aún no vistas en banco</span><div className="font-semibold">− {money(reconciliation.outstanding_credits, account.currency_code)}</div></div>
            <div><span className="text-slate-600">Más salidas aún no vistas en banco</span><div className="font-semibold">+ {money(reconciliation.outstanding_debits, account.currency_code)}</div></div>
            <div><span className="text-slate-600">Saldo esperado en el banco</span><div className="font-semibold">{money(reconciliation.expected_bank_balance, account.currency_code)}</div></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-8 gap-y-1 border-t pt-3 text-sm">
            <span>Saldo informado por el banco: <strong>{money(reconciliation.saved.bank_balance, account.currency_code)}</strong></span>
            <span className={reconciliation.difference === '0.00' ? 'text-emerald-700' : 'text-red-700'}>Diferencia sin explicar: <strong>{money(reconciliation.difference, account.currency_code)}</strong></span>
          </div>
          <h4 className="mt-4 text-sm font-semibold">Movimientos pendientes que explican el ajuste</h4>
          <div className="mt-2 max-h-72 overflow-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="sticky top-0 border-b bg-slate-100 text-xs uppercase text-slate-600"><tr><th className="p-2">Fecha</th><th className="p-2">Origen</th><th className="p-2">Concepto / referencia</th><th className="p-2 text-right">Movimiento</th><th className="p-2 text-right">Efecto en saldo esperado</th></tr></thead><tbody>
            {outstandingRows.map((row) => <tr key={`${row.source_type}-${row.source_id}`} className="border-b"><td className="p-2 whitespace-nowrap">{dateText(row.movement_date)}</td><td className="p-2">{sourceLabel[row.source_type] || row.source_type}</td><td className="p-2">{row.description}{row.observations && <span className="block text-xs text-slate-500">{row.observations}</span>}<DocumentReference row={row} onOpenPdf={openBankDocument} /></td><td className="p-2 text-right whitespace-nowrap">{Number(row.credit) ? `Entrada ${money(row.credit, account.currency_code)}` : `Salida ${money(row.debit, account.currency_code)}`}</td><td className="p-2 text-right whitespace-nowrap">{Number(row.credit) ? `− ${money(row.credit, account.currency_code)}` : `+ ${money(row.debit, account.currency_code)}`}</td></tr>)}
            {!outstandingRows.length && <tr><td colSpan={5} className="p-3 text-slate-500">No hay movimientos pendientes en el Libro banco.</td></tr>}
          </tbody></table></div>
          {reconciliation.difference !== '0.00' && <p className="mt-3 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900">El saldo residual no identifica por sí solo una operación. Revisá comisiones, movimientos bancarios no registrados, importes, fechas y cuenta asignada. Para ubicarlo con certeza, contrastá los movimientos con el banco o importá el extracto opcional.</p>}
        </details>}
        {reconciliation.stale && <p role="alert" className="mt-3 border-l-4 border-red-500 bg-red-50 p-3 text-sm text-red-800">El Libro banco cambió después del cierre. Reabra y revise este mes.</p>}
        {reconciliation.unassigned_count > 0 && <p role="alert" className="mt-3 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900">{reconciliation.unassigned_count} movimiento(s) sin cuenta reconocida impiden cerrar este mes.</p>}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Movimientos del Libro banco hasta {dateText(reconciliation.end_date)}</h3>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} />Solo pendientes</label>
        </div>
        <div className="mt-2 max-h-96 overflow-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="sticky top-0 border-b bg-slate-100 text-xs uppercase text-slate-600"><tr><th className="p-2">Banco</th><th className="p-2">Fecha</th><th className="p-2">Origen</th><th className="p-2">Concepto</th><th className="p-2">Documento / referencia</th><th className="p-2 text-right">Entrada</th><th className="p-2 text-right">Salida</th></tr></thead><tbody>
          {periodRows.map((row) => <tr key={`${row.source_type}-${row.source_id}`} className="border-b"><td className="p-2"><input type="checkbox" aria-label={`Conciliar ${row.description}`} checked={row.cleared} disabled={busy || reconciliation.saved?.status === 'closed' || Boolean(row.cleared_period && row.cleared_period !== period)} onChange={() => toggleClearance(row)} /></td><td className="p-2 whitespace-nowrap">{dateText(row.movement_date)}</td><td className="p-2">{sourceLabel[row.source_type] || row.source_type}</td><td className="p-2">{row.description}{row.observations && <span className="block text-xs text-slate-500">{row.observations}</span>}</td><td className="p-2"><DocumentReference row={row} onOpenPdf={openBankDocument} /></td><td className="p-2 text-right whitespace-nowrap">{Number(row.credit) ? money(row.credit, account.currency_code) : '-'}</td><td className="p-2 text-right whitespace-nowrap">{Number(row.debit) ? money(row.debit, account.currency_code) : '-'}</td></tr>)}
          {!periodRows.length && <tr><td colSpan={7} className="p-5 text-center text-slate-500">Sin movimientos para este filtro.</td></tr>}
        </tbody></table></div>
        <div className="mt-4 flex justify-end gap-2">
          {isAdmin && reconciliation.saved?.status === 'closed' && <button disabled={busy} className="rounded border px-3 py-2 text-sm disabled:opacity-50" onClick={reopenPeriod}>Reabrir mes</button>}
          {isAdmin && reconciliation.saved?.status !== 'closed' && <button disabled={busy || reconciliation.difference !== '0.00' || reconciliation.unassigned_count > 0 || period >= today().slice(0, 7)} className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50" onClick={closePeriod}>Cerrar mes</button>}
        </div>
        {!!reconciliation.events?.length && <details className="mt-3 text-xs text-slate-600"><summary className="cursor-pointer">Historial de conciliación</summary><ul className="mt-2 space-y-1">{reconciliation.events.map((event, index) => <li key={index}>{new Date(event.created_at).toLocaleString('es-PY')} · {event.event_type} · Usuario #{event.actor_user_id}</li>)}</ul></details>}
      </>}
    </section>}
    <details className="mb-6 border-b pb-6"><summary className="cursor-pointer font-semibold">Conciliación con extracto (opcional)</summary>
    <section className="mt-4 mb-6 border-b pb-6">
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
    </details>
  </main>;
}
