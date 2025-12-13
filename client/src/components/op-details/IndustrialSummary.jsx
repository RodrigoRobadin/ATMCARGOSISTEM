// client/src/components/op-details/IndustrialSummary.jsx
import React from "react";

const fmt = (n) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function IndustrialSummary({ summary }) {
  if (!summary) return null;
  const {
    purchase,
    sale,
    locals,
    seguro,
    totals,
  } = summary;

  const rowsCompra = [
    { label: "PUERTAS COSTO", usd: purchase.puertas },
    { label: "FLETE TERRESTRE", usd: purchase.flete },
    { label: "DESPACHO ADUANERO", usd: purchase.despacho },
    { label: "ADICIONAL RETENCION", usd: purchase.adicional },
    { label: "FINANCIACION", usd: purchase.financiacion },
  ];

  const rowsVenta = [
    { label: "PUERTAS VENTA", usd: sale.puertas, profit: sale.puertas - purchase.puertas },
    { label: "FLETE TERRESTRE", usd: sale.flete, profit: sale.flete - purchase.flete },
    { label: "DESPACHO ADUANERO", usd: sale.despacho, profit: sale.despacho - purchase.despacho },
    { label: "ADICIONAL RETENCION", usd: sale.adicional, profit: sale.adicional - purchase.adicional },
    { label: "FINANCIACION", usd: sale.financiacion, profit: sale.financiacion - purchase.financiacion },
  ];

  return (
    <div className="bg-white rounded-2xl shadow p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium">Resumen compra / venta</h3>
        <span className="text-xs text-slate-500">Ref: {summary.reference || "-"}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="border rounded-lg">
          <div className="bg-slate-200 px-3 py-2 text-sm font-semibold">Compra del agente</div>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100">
                <th className="border px-2 py-1 text-left">CARGOS</th>
                <th className="border px-2 py-1 text-right">TOTAL USD</th>
              </tr>
            </thead>
            <tbody>
              {rowsCompra.map((r) => (
                <tr key={r.label} className="odd:bg-white even:bg-slate-50">
                  <td className="border px-2 py-1">{r.label}</td>
                  <td className="border px-2 py-1 text-right">{fmt(r.usd)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-yellow-100 font-semibold">
                <td className="border px-2 py-1 text-right">TOTAL</td>
                <td className="border px-2 py-1 text-right">{fmt(purchase.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="border rounded-lg">
          <div className="bg-slate-200 px-3 py-2 text-sm font-semibold">Venta al cliente</div>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100">
                <th className="border px-2 py-1 text-left">CARGOS</th>
                <th className="border px-2 py-1 text-right">TOTAL USD</th>
                <th className="border px-2 py-1 text-right">PROFIT</th>
              </tr>
            </thead>
            <tbody>
              {rowsVenta.map((r) => (
                <tr key={r.label} className="odd:bg-white even:bg-slate-50">
                  <td className="border px-2 py-1">{r.label}</td>
                  <td className="border px-2 py-1 text-right">{fmt(r.usd)}</td>
                  <td className="border px-2 py-1 text-right text-emerald-700">{fmt(r.profit || 0)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-yellow-100 font-semibold">
                <td className="border px-2 py-1 text-right">TOTAL</td>
                <td className="border px-2 py-1 text-right">{fmt(sale.total)}</td>
                <td className="border px-2 py-1 text-right text-emerald-700">{fmt(sale.total - purchase.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
        <div className="border rounded-lg">
          <div className="bg-slate-200 px-3 py-2 text-sm font-semibold">Costos locales (Gs)</div>
          <table className="w-full text-xs border-collapse">
            <tbody>
              <tr>
                <td className="border px-2 py-1">INSTALACION (Gs)</td>
                <td className="border px-2 py-1 text-right">{locals.costGs.toLocaleString()}</td>
              </tr>
              <tr>
                <td className="border px-2 py-1">TOTAL USD</td>
                <td className="border px-2 py-1 text-right">{fmt(locals.costUsd)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="border rounded-lg">
          <div className="bg-slate-200 px-3 py-2 text-sm font-semibold">Gastos locales al cliente</div>
          <table className="w-full text-xs border-collapse">
            <tbody>
              <tr>
                <td className="border px-2 py-1">INSTALACION (Gs)</td>
                <td className="border px-2 py-1 text-right">{locals.saleGs.toLocaleString()}</td>
              </tr>
              <tr>
                <td className="border px-2 py-1">TOTAL USD</td>
                <td className="border px-2 py-1 text-right">{fmt(locals.saleUsd)}</td>
              </tr>
              <tr>
                <td className="border px-2 py-1">PROFIT USD</td>
                <td className="border px-2 py-1 text-right text-emerald-700">{fmt(locals.profitUsd)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
        <div className="border rounded-lg">
          <div className="bg-slate-200 px-3 py-2 text-sm font-semibold">Seguro de carga</div>
          <table className="w-full text-xs border-collapse">
            <tbody>
              <tr>
                <td className="border px-2 py-1">A pagar</td>
                <td className="border px-2 py-1 text-right">{fmt(seguro.compra)}</td>
              </tr>
              <tr>
                <td className="border px-2 py-1">Total</td>
                <td className="border px-2 py-1 text-right">{fmt(seguro.venta)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="border rounded-lg">
          <div className="bg-slate-200 px-3 py-2 text-sm font-semibold">Resumen general</div>
          <table className="w-full text-xs border-collapse">
            <tbody>
              <tr>
                <td className="border px-2 py-1">TOTAL GENERAL COMPRAS</td>
                <td className="border px-2 py-1 text-right">{fmt(totals.compraGeneral)}</td>
              </tr>
              <tr>
                <td className="border px-2 py-1">TOTAL GENERAL VENTAS USD</td>
                <td className="border px-2 py-1 text-right">{fmt(totals.ventaGeneral)}</td>
              </tr>
              <tr>
                <td className="border px-2 py-1 font-semibold">PROFFIT GENERAL ATM</td>
                <td className="border px-2 py-1 text-right text-emerald-700 font-semibold">{fmt(totals.profitGeneral)}</td>
              </tr>
              <tr>
                <td className="border px-2 py-1">PROFFIT VENDEDOR (15%)</td>
                <td className="border px-2 py-1 text-right">{fmt(totals.profitVendedor)}</td>
              </tr>
              <tr>
                <td className="border px-2 py-1">PROFFIT FINAL ATM</td>
                <td className="border px-2 py-1 text-right text-emerald-700">{fmt(totals.profitFinal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
