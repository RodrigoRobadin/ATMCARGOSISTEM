import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import {
  companyBankAccountLabel,
  companyBankAccountValue,
  filterCompanyBankAccounts,
  parseCompanyBankAccounts,
} from "../utils/companyBankAccounts";

function fmtMoney(value, currencyCode = "USD") {
  const currency = String(currencyCode || "USD").toUpperCase() === "GS" ? "PYG" : String(currencyCode || "USD").toUpperCase();
  const isPyg = currency === "PYG";
  return new Intl.NumberFormat("es-PY", {
    style: "currency",
    currency,
    minimumFractionDigits: isPyg ? 0 : 2,
    maximumFractionDigits: isPyg ? 0 : 2,
  }).format(Number(value || 0));
}

function invoiceBalance(invoice = {}) {
  const subtotal = Number(invoice.calcSubtotal ?? invoice.subtotal ?? 0);
  const tax = Number(invoice.calcTax ?? invoice.tax_amount ?? 0);
  const totalRaw = Number(invoice.calcTotal ?? invoice.total_amount ?? invoice.total ?? 0);
  const total = totalRaw > 0 ? totalRaw : Math.max(0, subtotal + tax);
  const credited = Number(invoice.credited_total ?? invoice.creditedCalc ?? 0);
  const paid = Number(invoice.paid_amount ?? invoice.paid ?? invoice.paidCalc ?? 0);
  const netTotal = Number(invoice.net_total_amount ?? invoice.calcNetTotal ?? 0) > 0
    ? Number(invoice.net_total_amount ?? invoice.calcNetTotal ?? 0)
    : Math.max(0, total - credited);
  let balance = invoice.calcPending ?? invoice.net_balance ?? invoice.balance;
  if (balance === null || balance === undefined || Number.isNaN(Number(balance))) {
    balance = Math.max(0, netTotal - paid);
  }
  if (Number(balance) <= 0 && total > 0 && paid < netTotal) {
    balance = Math.max(0, netTotal - paid);
  }
  return {
    total,
    credited,
    paid,
    netTotal,
    balance: Math.max(0, Number(balance || 0)),
  };
}

export default function CustomerReceiptModal({ invoice, onClose, onSuccess }) {
  const totals = useMemo(() => invoiceBalance(invoice), [invoice]);
  const [form, setForm] = useState({
    payment_date: new Date().toISOString().slice(0, 10),
    amount: totals.balance.toFixed(2),
    currency: invoice?.currency_code || invoice?.currency || "USD",
    payment_method: "transferencia",
    bank_account: "gs",
    reference_number: "",
    retention_pct: "0",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);
  const [companyAccounts, setCompanyAccounts] = useState([]);

  const currency = String(form.currency || invoice?.currency_code || "USD").toUpperCase();
  const grossAmount = Number(form.amount || 0) || 0;
  const retentionPct = Number(form.retention_pct || 0) || 0;
  const retentionAmount = Math.max(0, grossAmount * retentionPct / 100);
  const netAmount = Math.max(0, grossAmount - retentionAmount);
  const accountOptions = useMemo(
    () => filterCompanyBankAccounts(companyAccounts, currency),
    [companyAccounts, currency]
  );
  const hasCurrentAccount = accountOptions.some((account) => companyBankAccountValue(account) === form.bank_account);
  const receiptPoint = (invoice?.invoice_number || "").split("-").slice(0, 2).join("-");

  useEffect(() => {
    let live = true;
    api.get("/params", { params: { keys: "company_bank_account", only_active: 1 } })
      .then(({ data }) => {
        if (!live) return;
        const accounts = parseCompanyBankAccounts(data?.company_bank_account || []);
        setCompanyAccounts(accounts);
        const preferred = filterCompanyBankAccounts(accounts, currency)[0];
        if (preferred) {
          setForm((prev) => ({ ...prev, bank_account: companyBankAccountValue(preferred) }));
        }
      })
      .catch(() => {
        if (live) setCompanyAccounts([]);
      });
    return () => {
      live = false;
    };
  }, [currency]);

  function patchForm(patch) {
    setConfirmStep(false);
    setForm((prev) => ({ ...prev, ...patch }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!invoice?.id) {
      alert("No se encontro la factura.");
      return;
    }
    if (grossAmount <= 0 || netAmount <= 0) {
      alert("Ingresa un monto valido.");
      return;
    }
    if (netAmount > totals.balance + 0.01) {
      alert("El monto neto no puede superar el saldo pendiente.");
      return;
    }
    if (!confirmStep) {
      setConfirmStep(true);
      return;
    }

    setSaving(true);
    try {
      await api.post(`/invoices/${invoice.id}/receipts`, {
        amount: Number(grossAmount.toFixed(2)),
        payment_date: form.payment_date,
        currency,
        payment_method: form.payment_method,
        bank_account: form.bank_account,
        reference_number: form.reference_number,
        retention_pct: retentionPct,
        retention_amount: Number(retentionAmount.toFixed(2)),
        net_amount: Number(netAmount.toFixed(2)),
        notes: form.notes,
      });
      alert("Pago registrado correctamente.");
      onSuccess?.();
    } catch (error) {
      console.error("Error registering customer receipt", error);
      alert(error?.response?.data?.error || "No se pudo registrar el pago.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 md:p-6 z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Registrar pago</h3>
          <button onClick={onClose} className="text-2xl leading-none" type="button">
            x
          </button>
        </div>

        <div className="mb-4 p-3 bg-slate-50 rounded text-sm">
          <div className="font-medium">{invoice?.invoice_number || "Factura"}</div>
          <div className="text-slate-600">{invoice?.organization_name || "-"}</div>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-slate-700">
            <span>Total neto:</span>
            <span className="text-right font-medium">{fmtMoney(totals.netTotal, currency)}</span>
            <span>Pagado:</span>
            <span className="text-right font-medium">{fmtMoney(totals.paid, currency)}</span>
            <span>Saldo pendiente:</span>
            <span className="text-right font-bold text-orange-600">{fmtMoney(totals.balance, currency)}</span>
          </div>
          {receiptPoint ? (
            <div className="mt-2 text-xs text-slate-500">
              Punto de expedicion del recibo: <strong>{receiptPoint}</strong>
            </div>
          ) : null}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Fecha de pago</label>
            <input
              type="date"
              className="w-full border rounded-lg px-3 py-2"
              value={form.payment_date}
              onChange={(event) => patchForm({ payment_date: event.target.value })}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Moneda</label>
            <select
              className="w-full border rounded-lg px-3 py-2"
              value={currency}
              onChange={(event) => patchForm({ currency: event.target.value })}
            >
              <option value="USD">USD</option>
              <option value="PYG">PYG</option>
              <option value="EUR">EUR</option>
              <option value="BRL">BRL</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Monto bruto recibido</label>
            <input
              type="number"
              step="0.01"
              className="w-full border rounded-lg px-3 py-2"
              value={form.amount}
              onChange={(event) => patchForm({ amount: event.target.value })}
              placeholder="0.00"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Metodo de pago</label>
            <select
              className="w-full border rounded-lg px-3 py-2"
              value={form.payment_method}
              onChange={(event) => patchForm({ payment_method: event.target.value })}
            >
              <option value="transferencia">Transferencia</option>
              <option value="efectivo">Efectivo</option>
              <option value="cheque">Cheque</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="otro">Otro</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Cuenta destino de empresa</label>
            <select
              className="w-full border rounded-lg px-3 py-2"
              value={form.bank_account}
              onChange={(event) => patchForm({ bank_account: event.target.value })}
            >
              {!hasCurrentAccount && form.bank_account ? <option value={form.bank_account}>{form.bank_account}</option> : null}
              {accountOptions.length ? (
                accountOptions.map((account) => (
                  <option key={account.id || companyBankAccountValue(account)} value={companyBankAccountValue(account)}>
                    {companyBankAccountLabel(account)}
                  </option>
                ))
              ) : (
                <>
                  <option value="gs">ITAU</option>
                  <option value="usd">CONTINENTAL</option>
                </>
              )}
            </select>
            {!accountOptions.length ? (
              <div className="mt-1 text-xs text-amber-700">
                No hay cuenta activa cargada para {currency}; se muestran cuentas historicas.
              </div>
            ) : null}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Referencia</label>
            <input
              type="text"
              className="w-full border rounded-lg px-3 py-2"
              value={form.reference_number}
              onChange={(event) => patchForm({ reference_number: event.target.value })}
              placeholder="Ej: transferencia #12345"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Retencion IVA</label>
            <select
              className="w-full border rounded-lg px-3 py-2"
              value={form.retention_pct}
              onChange={(event) => patchForm({ retention_pct: event.target.value })}
            >
              <option value="0">Sin retencion</option>
              <option value="30">30%</option>
              <option value="70">70%</option>
              <option value="100">100%</option>
            </select>
            <div className="text-xs text-slate-600 mt-1 space-y-0.5">
              <div>Retencion: {fmtMoney(retentionAmount, currency)}</div>
              <div>Neto aplicado: {fmtMoney(netAmount, currency)}</div>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notas</label>
            <textarea
              className="w-full border rounded-lg px-3 py-2"
              rows="2"
              value={form.notes}
              onChange={(event) => patchForm({ notes: event.target.value })}
              placeholder="Notas adicionales..."
            />
          </div>

          {confirmStep ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <div className="font-semibold mb-1">Confirmar registro de pago</div>
              <div>Factura: {invoice?.invoice_number || "-"}</div>
              <div>Monto bruto: {fmtMoney(grossAmount, currency)}</div>
              <div>Retencion: {fmtMoney(retentionAmount, currency)}</div>
              <div>Neto aplicado: {fmtMoney(netAmount, currency)}</div>
              <div>Saldo despues del pago: {fmtMoney(Math.max(0, totals.balance - netAmount), currency)}</div>
            </div>
          ) : null}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={confirmStep ? () => setConfirmStep(false) : onClose}
              className="flex-1 px-4 py-2 border rounded-lg hover:bg-slate-50"
              disabled={saving}
            >
              {confirmStep ? "Volver" : "Cancelar"}
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:bg-slate-300"
              disabled={saving}
            >
              {saving ? "Guardando..." : confirmStep ? "Confirmar pago" : "Revisar pago"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
