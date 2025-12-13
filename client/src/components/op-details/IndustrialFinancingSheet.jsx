// client/src/components/op-details/IndustrialFinancingSheet.jsx
// Vista tipo Excel para financiamiento (compra y venta), con cálculos básicos según las fórmulas provistas
import React, { useMemo, useState, forwardRef, useImperativeHandle } from "react";

const BASE_ROWS = ["50 % INICIAL", "50 % RETIRO", "FLETE+ SEGURO", "DESPACHO", "INSTALACION"];

function toNumber(v) {
  if (v === "" || v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function fmtPct(n) {
  return `${(n ?? 0).toFixed(2)}%`;
}

function buildPeriods(baseAnnualRate) {
  const r30 = baseAnnualRate / 12;
  return [
    { key: "p30", label: "30 DIAS", rate: r30 },
    { key: "p60", label: "60 DIAS", rate: r30 * 2 },
    { key: "p90", label: "90 DIAS", rate: r30 * 3 },
    { key: "p120", label: "120 dias", rate: r30 * 4 },
    { key: "p150", label: "150 dias", rate: r30 * 5 },
    { key: "p180", label: "180 dias", rate: r30 * 6 },
  ];
}

function computeRowTotals(row, periods) {
  const monto = toNumber(row.monto);
  const adicional =
    monto * ((periods.find((p) => p.key === "p180")?.rate || 0) / 100);
  const sumPeriods = periods.reduce((acc, p) => acc + toNumber(row[p.key]), 0);
  const total = monto + sumPeriods + adicional;
  return { adicional, total };
}

function computeTotals(rows, periods) {
  const totals = {
    monto: 0,
    adicional: 0,
    total: 0,
  };
  for (const p of periods) totals[p.key] = 0;

  rows.forEach((r) => {
    totals.monto += toNumber(r.monto);
    for (const p of periods) totals[p.key] += toNumber(r[p.key]);
    const { adicional, total } = computeRowTotals(r, periods);
    totals.adicional += adicional;
    totals.total += total;
  });

  return totals;
}

const IndustrialFinancingSheet = forwardRef(function IndustrialFinancingSheet({ readOnly }, ref) {
  const [baseRateCompra, setBaseRateCompra] = useState(15.2); // anual
  const [baseRateVenta, setBaseRateVenta] = useState(18.2); // anual
  const compraPeriods = useMemo(() => buildPeriods(baseRateCompra), [baseRateCompra]);
  const ventaPeriods = useMemo(() => buildPeriods(baseRateVenta), [baseRateVenta]);

  const [compraRows, setCompraRows] = useState(BASE_ROWS.map((l) => ({ label: l, monto: "" })));
  const [ventaRows, setVentaRows] = useState(BASE_ROWS.map((l) => ({ label: l, monto: "" })));

  const [tcCompra, setTcCompra] = useState("7150");
  const [tcVenta, setTcVenta] = useState("7400");
  const [fechaCompra, setFechaCompra] = useState("");
  const [fechaVenta, setFechaVenta] = useState("");

  const compraTotals = computeTotals(compraRows, compraPeriods);
  const ventaTotals = computeTotals(ventaRows, ventaPeriods);

  const compraAdic10 = compraTotals.total * 0.1;
  const compraTotalMas10 = compraTotals.total + compraAdic10;
  const compraGs = compraTotalMas10 * toNumber(tcCompra);

  const ventaAdic10 = ventaTotals.total * 0.1;
  const ventaTotalMas10 = ventaTotals.total + ventaAdic10;
  const ventaGs = ventaTotalMas10 * toNumber(tcVenta);

  useImperativeHandle(ref, () => ({
    getData: () => ({
      baseRateCompra,
      baseRateVenta,
      compraRows,
      ventaRows,
      tcCompra,
      tcVenta,
      fechaCompra,
      fechaVenta,
    }),
    setData: (d = {}) => {
      if (d.baseRateCompra != null) setBaseRateCompra(Number(d.baseRateCompra) || 0);
      if (d.baseRateVenta != null) setBaseRateVenta(Number(d.baseRateVenta) || 0);
      if (Array.isArray(d.compraRows)) setCompraRows(d.compraRows);
      if (Array.isArray(d.ventaRows)) setVentaRows(d.ventaRows);
      if (d.tcCompra != null) setTcCompra(d.tcCompra);
      if (d.tcVenta != null) setTcVenta(d.tcVenta);
      if (d.fechaCompra != null) setFechaCompra(d.fechaCompra);
      if (d.fechaVenta != null) setFechaVenta(d.fechaVenta);
    },
  }));

  const renderTable = (
    title,
    rows,
    setRows,
    periods,
    totals,
    baseRate,
    setBaseRate,
    tc,
    setTc,
    fecha,
    setFecha
  ) => (
    <div className="border rounded-lg p-3 bg-white shadow-sm">
      <div className="flex items-center justify-between mb-2 text-sm font-semibold">
        <span>{title}</span>
        <div className="flex items-center gap-2 text-xs">
          <span>Tasa anual:</span>
          <input
            className="border rounded px-2 py-1 w-20"
            value={baseRate}
            onChange={(e) => setBaseRate(Number(e.target.value) || 0)}
            disabled={readOnly}
          />
          <span>%</span>
          <span>Fecha:</span>
          <input
            type="date"
            className="border rounded px-2 py-1"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            disabled={readOnly}
          />
          <span>TC:</span>
          <input
            className="border rounded px-2 py-1 w-20"
            value={tc}
            onChange={(e) => setTc(e.target.value)}
            disabled={readOnly}
          />
        </div>
      </div>

      <div className="overflow-auto">
        <table className="min-w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="border px-2 py-1 bg-slate-100">DETALLE</th>
              <th className="border px-2 py-1 bg-slate-100">MONTO USD</th>
              {periods.map((p) => (
                <th key={p.key} className="border px-2 py-1 bg-slate-100 text-center">
                  {fmtPct(p.rate)}
                  <div className="text-[10px] text-slate-600">{p.label}</div>
                </th>
              ))}
              <th className="border px-2 py-1 bg-slate-100">ADICIONAL</th>
              <th className="border px-2 py-1 bg-slate-100">TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const rowTotals = computeRowTotals(r, periods);
              return (
                <tr key={idx}>
                  <td className="border px-2 py-1">
                    <input
                      className="w-full border rounded px-1 py-0.5"
                      value={r.label}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, label: e.target.value } : row))
                        )
                      }
                      disabled={readOnly}
                    />
                  </td>
                  <td className="border px-2 py-1">
                    <input
                      className="w-full border rounded px-1 py-0.5"
                      value={r.monto}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, monto: e.target.value } : row))
                        )
                      }
                      disabled={readOnly}
                    />
                  </td>
                  {periods.map((p) => (
                    <td key={p.key} className="border px-2 py-1">
                      <input
                        className="w-full border rounded px-1 py-0.5"
                        value={r[p.key] || ""}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((row, i) =>
                              i === idx ? { ...row, [p.key]: e.target.value } : row
                            )
                          )
                        }
                        disabled={readOnly}
                      />
                    </td>
                  ))}
                  <td className="border px-2 py-1 text-right">
                    {rowTotals.adicional.toFixed(2)}
                  </td>
                  <td className="border px-2 py-1 text-right font-semibold">
                    {rowTotals.total.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-yellow-100 font-semibold">
              <td className="border px-2 py-1">TOTAL</td>
              <td className="border px-2 py-1">
                {compraTotals.monto.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
              {periods.map((p) => (
                <td key={p.key} className="border px-2 py-1">
                  {compraTotals[p.key].toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              ))}
              <td className="border px-2 py-1">
                {compraTotals.adicional.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
              <td className="border px-2 py-1">
                {compraTotals.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {renderTable(
        "COMPRA INTERESES",
        compraRows,
        setCompraRows,
        compraPeriods,
        compraTotals,
        baseRateCompra,
        setBaseRateCompra,
        tcCompra,
        setTcCompra,
        fechaCompra,
        setFechaCompra
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        <div className="border rounded p-2 bg-slate-50">Adicional 10% compra: {compraAdic10.toFixed(2)}</div>
        <div className="border rounded p-2 bg-slate-50">Total + 10% compra: {compraTotalMas10.toFixed(2)}</div>
        <div className="border rounded p-2 bg-slate-50">Compra en Gs: {compraGs.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
      </div>

      {renderTable(
        "VENTA INTERESES",
        ventaRows,
        setVentaRows,
        ventaPeriods,
        ventaTotals,
        baseRateVenta,
        setBaseRateVenta,
        tcVenta,
        setTcVenta,
        fechaVenta,
        setFechaVenta
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        <div className="border rounded p-2 bg-slate-50">Adicional 10% venta: {ventaAdic10.toFixed(2)}</div>
        <div className="border rounded p-2 bg-slate-50">Total + 10% venta: {ventaTotalMas10.toFixed(2)}</div>
        <div className="border rounded p-2 bg-slate-50">Venta en Gs: {ventaGs.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
      </div>
      <div className="border rounded p-2 bg-yellow-50 text-xs font-semibold">
        Diferencia venta - compra: {(ventaTotalMas10 - compraTotalMas10).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
    </div>
  );
});

export default IndustrialFinancingSheet;
