import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";

function fmtMoney(value = 0, currency = "USD") {
  const code = String(currency || "USD").toUpperCase() === "GS" ? "PYG" : String(currency || "USD").toUpperCase();
  const isPyg = code === "PYG";
  return new Intl.NumberFormat("es-PY", {
    style: "currency",
    currency: code,
    minimumFractionDigits: isPyg ? 0 : 2,
    maximumFractionDigits: isPyg ? 0 : 2,
  }).format(Number(value || 0));
}

function fmtDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("es-PY");
}

function currencyEntries(values = {}) {
  return Object.entries(values || {}).filter(([, amount]) => Math.abs(Number(amount || 0)) > 0.0001);
}

function MoneyStack({ values, emptyCurrency = "USD", tone = "slate" }) {
  const entries = currencyEntries(values);
  const toneClass = tone === "red" ? "text-red-700" : tone === "emerald" ? "text-emerald-700" : "text-slate-900";
  if (!entries.length) return <span className={toneClass}>{fmtMoney(0, emptyCurrency)}</span>;
  return (
    <div className={`space-y-0.5 ${toneClass}`}>
      {entries.map(([currency, amount]) => (
        <div key={currency}>{fmtMoney(amount, currency)}</div>
      ))}
    </div>
  );
}

function SummaryCard({ label, children, tone = "slate", footer }) {
  const toneClass = tone === "red" ? "text-red-700" : tone === "emerald" ? "text-emerald-700" : "text-slate-900";
  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-2 text-lg font-semibold ${toneClass}`}>{children}</div>
      {footer && <div className="mt-1 text-xs text-slate-500">{footer}</div>}
    </div>
  );
}

function ConvertedAmount({ value }) {
  if (!value) return <span>-</span>;
  return (
    <div>
      <span>{fmtMoney(value.amount, value.currency_code)}</span>
      {!value.complete && (
        <div className="text-xs font-normal text-amber-700">
          Falta TC para: {value.missing_currencies?.join(", ") || "moneda distinta"}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ value }) {
  const meta = {
    mejor_o_igual: ["En margen", "bg-emerald-50 text-emerald-700"],
    menor_profit: ["Menor profit", "bg-red-50 text-red-700"],
    sin_comparacion: ["Sin comparacion", "bg-amber-50 text-amber-700"],
  }[value] || [value || "-", "bg-slate-100 text-slate-700"];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta[1]}`}>{meta[0]}</span>;
}

function operationPath(operationId, operationType = "deal", tab = "") {
  const base = String(operationType || "deal") === "industrial"
    ? `/operations/${operationId}/industrial`
    : `/operations/${operationId}`;
  return tab ? `${base}?tab=${encodeURIComponent(tab)}` : base;
}

function documentLinkForMovement(row, operationId, operationType) {
  const id = row?.source_id;
  if (!id) return null;
  switch (row.source_type) {
    case "invoice":
      return { kind: "pdf", url: `/invoices/${id}/pdf` };
    case "receipt":
      return { kind: "pdf", url: `/invoices/receipts/${id}/pdf` };
    case "credit_note":
      return { kind: "pdf", url: `/invoices/credit-notes/${id}/pdf` };
    case "operation_expense_invoice":
    case "operation_expense_payment":
      return { kind: "link", url: operationPath(operationId, operationType, "gastos") };
    default:
      return null;
  }
}

function DocumentLink({ row, operationId, operationType, children }) {
  const target = documentLinkForMovement(row, operationId, operationType);
  if (!target?.url) return <span>{children || "-"}</span>;
  const title = row.source_type === "operation_expense_invoice" || row.source_type === "operation_expense_payment"
    ? "Abrir gastos de la operacion"
    : "Ver documento";
  if (target.kind === "pdf") {
    return (
      <button
        type="button"
        className="font-medium text-blue-600 hover:underline"
        title={title}
        onClick={async () => {
          try {
            const res = await api.get(target.url, { responseType: "blob" });
            const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
            window.open(url, "_blank", "noopener,noreferrer");
            setTimeout(() => URL.revokeObjectURL(url), 60000);
          } catch (err) {
            console.error("operation statement pdf error", err);
            alert(err?.response?.data?.error || "No se pudo abrir el PDF.");
          }
        }}
      >
        {children || "Ver documento"}
      </button>
    );
  }
  return (
    <a className="font-medium text-blue-600 hover:underline" href={target.url} target="_blank" rel="noreferrer" title={title}>
      {children || "Ver documento"}
    </a>
  );
}

export default function OperationFinancialStatement({
  operationId,
  operationType = "deal",
  costSheetVersionNumber = null,
  quoteRevisionId = null,
  quoteId = null,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const params = useMemo(
    () => ({
      op_type: operationType || "deal",
      cost_sheet_version_number: costSheetVersionNumber || undefined,
      quote_revision_id: quoteRevisionId || undefined,
      quote_id: quoteId || undefined,
    }),
    [operationType, costSheetVersionNumber, quoteRevisionId, quoteId]
  );

  async function load() {
    if (!operationId) return;
    setLoading(true);
    setError("");
    try {
      const { data: response } = await api.get(`/operations/${operationId}/financial-statement`, { params });
      setData(response || null);
    } catch (err) {
      console.error("operation financial statement error", err);
      setError(err?.response?.data?.error || "No se pudo cargar el estado de cuenta.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationId, operationType, costSheetVersionNumber, quoteRevisionId, quoteId]);

  const budgetCurrency = data?.result?.currency_code || data?.budget?.currency_code || "USD";
  const routeOperationType = quoteId || quoteRevisionId ? "industrial" : operationType;
  const profitTone = data?.result?.real_profit == null
    ? "slate"
    : Number(data.result.profit_difference || 0) < -0.009
    ? "red"
    : "emerald";

  if (loading) {
    return <div className="rounded-2xl bg-white p-4 text-sm text-slate-500 shadow">Cargando estado de cuenta...</div>;
  }

  if (error) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }

  if (!data) {
    return <div className="rounded-2xl bg-white p-4 text-sm text-slate-500 shadow">Sin datos financieros.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-4 shadow">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Estado de cuenta por operacion</h3>
            <div className="text-sm text-slate-500">
              {data.operation_meta?.reference ? `Ref. ${data.operation_meta.reference}` : `Operacion #${operationId}`}
              {data.budget?.revision_label ? ` · Presupuesto: ${data.budget.revision_label}` : ""}
            </div>
            {data.exchange_rate ? (
              <div className="mt-1 text-xs text-slate-500">TC control: {Number(data.exchange_rate).toLocaleString("es-PY")}</div>
            ) : (
              <div className="mt-1 text-xs text-amber-700">Sin TC de control para monedas distintas.</div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge value={data.result?.status} />
            <button type="button" className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50" onClick={load}>
              Actualizar
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-4">
        <SummaryCard label="Venta presupuestada">
          {fmtMoney(data.result?.budgeted_sell, budgetCurrency)}
        </SummaryCard>
        <SummaryCard label="Compra presupuestada">
          {fmtMoney(data.result?.budgeted_buy, budgetCurrency)}
        </SummaryCard>
        <SummaryCard label="Profit presupuestado">
          {fmtMoney(data.result?.budgeted_profit, budgetCurrency)}
        </SummaryCard>
        <SummaryCard label="Profit real" tone={profitTone} footer={data.result?.profit_difference != null ? `Dif: ${fmtMoney(data.result.profit_difference, budgetCurrency)}` : "Pendiente de comparacion"}>
          {data.result?.real_profit == null ? "Sin comparacion" : fmtMoney(data.result.real_profit, budgetCurrency)}
        </SummaryCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-4">
        <SummaryCard label="Facturado neto">
          <MoneyStack values={data.sales?.totals?.net_sales_by_currency} emptyCurrency={budgetCurrency} />
        </SummaryCard>
        <SummaryCard label="Cobrado" tone="emerald">
          <MoneyStack values={data.sales?.totals?.collected_by_currency} emptyCurrency={budgetCurrency} tone="emerald" />
        </SummaryCard>
        <SummaryCard label="Compra real">
          <MoneyStack values={data.purchases?.totals?.actual_by_currency} emptyCurrency={budgetCurrency} />
        </SummaryCard>
        <SummaryCard label="Pagado proveedores" tone="emerald">
          <MoneyStack values={data.purchases?.totals?.paid_by_currency} emptyCurrency={budgetCurrency} tone="emerald" />
        </SummaryCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <SummaryCard label={`Facturado neto convertido a ${budgetCurrency}`}>
          <ConvertedAmount value={data.result?.actual_net_sales} />
        </SummaryCard>
        <SummaryCard label={`Compra real convertida a ${budgetCurrency}`}>
          <ConvertedAmount value={data.result?.actual_buy} />
        </SummaryCard>
        <SummaryCard label="Saldos vivos">
          <div className="grid gap-2 text-sm">
            <div>
              <span className="text-slate-500">Por cobrar: </span>
              <ConvertedAmount value={data.result?.receivable} />
            </div>
            <div>
              <span className="text-slate-500">Por pagar: </span>
              <ConvertedAmount value={data.result?.payable} />
            </div>
          </div>
        </SummaryCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl bg-white shadow">
          <div className="border-b px-4 py-3">
            <div className="font-semibold">Cliente</div>
            <div className="text-xs text-slate-500">Facturas, cobros y notas de credito</div>
          </div>
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">Factura</th>
                  <th className="px-3 py-2 text-left">Fecha</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">NC</th>
                  <th className="px-3 py-2 text-right">Cobrado</th>
                  <th className="px-3 py-2 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {(data.sales?.invoices || []).length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-500">Sin facturas de venta.</td></tr>
                ) : (
                  data.sales.invoices.map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="px-3 py-2">
                        <a className="font-medium text-blue-600 hover:underline" href={`/invoices/${row.id}`} target="_blank" rel="noreferrer">
                          {row.invoice_number || row.id}
                        </a>
                        <div className="text-xs text-slate-500">{row.status || "-"}</div>
                      </td>
                      <td className="px-3 py-2">{fmtDate(row.issue_date)}</td>
                      <td className="px-3 py-2 text-right">{fmtMoney(row.total_amount, row.currency_code)}</td>
                      <td className="px-3 py-2 text-right text-amber-700">{fmtMoney(row.credited_total, row.currency_code)}</td>
                      <td className="px-3 py-2 text-right text-emerald-700">{fmtMoney(row.paid_amount, row.currency_code)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{fmtMoney(row.balance, row.currency_code)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl bg-white shadow">
          <div className="border-b px-4 py-3">
            <div className="font-semibold">Proveedores</div>
            <div className="text-xs text-slate-500">Facturas de compra y pagos registrados</div>
          </div>
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">Comprobante</th>
                  <th className="px-3 py-2 text-left">Proveedor</th>
                  <th className="px-3 py-2 text-left">Rubro</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Pagado</th>
                  <th className="px-3 py-2 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {(data.purchases?.invoices || []).length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-500">Sin facturas de compra.</td></tr>
                ) : (
                  data.purchases.invoices.map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="px-3 py-2">
                        <div className="font-medium">{row.receipt_number || row.id}</div>
                        <div className="text-xs text-slate-500">{fmtDate(row.invoice_date)}</div>
                      </td>
                      <td className="px-3 py-2">{row.supplier_org_name || row.supplier_name || "-"}</td>
                      <td className="px-3 py-2">{row.expense_rubros || row.expense_rubro || "-"}</td>
                      <td className="px-3 py-2 text-right">{fmtMoney(row.amount_total, row.currency_code)}</td>
                      <td className="px-3 py-2 text-right text-emerald-700">{fmtMoney(row.paid_amount, row.currency_code)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{fmtMoney(row.balance, row.currency_code)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="rounded-2xl bg-white shadow">
        <div className="border-b px-4 py-3">
          <div className="font-semibold">Movimientos</div>
          <div className="text-xs text-slate-500">Linea de tiempo financiera de la operacion</div>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-left">Documento</th>
                <th className="px-3 py-2 text-left">Tercero</th>
                <th className="px-3 py-2 text-right">Entrada</th>
                <th className="px-3 py-2 text-right">Salida/Ajuste</th>
              </tr>
            </thead>
            <tbody>
              {(data.movements || []).length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-500">Sin movimientos.</td></tr>
              ) : (
                data.movements.map((row, idx) => (
                  <tr key={`${row.source_type}-${row.source_id}-${idx}`} className="border-t">
                    <td className="px-3 py-2">{fmtDate(row.date)}</td>
                    <td className="px-3 py-2">{row.label}</td>
                    <td className="px-3 py-2">
                      <DocumentLink row={row} operationId={operationId} operationType={routeOperationType}>
                        {row.document_number || "-"}
                      </DocumentLink>
                    </td>
                    <td className="px-3 py-2">
                      <div>{row.third_party || "-"}</div>
                      {row.description ? (
                        <div className="mt-0.5 text-xs text-slate-500">{row.description}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right text-emerald-700">
                      {Number(row.debit || 0) ? fmtMoney(row.debit, row.currency_code) : "-"}
                    </td>
                    <td className="px-3 py-2 text-right text-red-700">
                      {Number(row.credit || 0) ? fmtMoney(row.credit, row.currency_code) : "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
