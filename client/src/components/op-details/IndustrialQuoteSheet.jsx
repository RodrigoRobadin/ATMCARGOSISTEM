// client/src/components/op-details/IndustrialQuoteSheet.jsx
import React, {
  useMemo,
  useState,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";

const COLS = [
  { key: "item", label: "ITEM", width: 50 },
  { key: "cant", label: "CANT", width: 70 },
  { key: "tipo_puerta", label: "TIPO PUERTA", width: 200 },
  { key: "cbm", label: "CBM", width: 80 },
  { key: "peso", label: "PESO", width: 80 },
  { key: "sector", label: "SECTOR", width: 120 },
  { key: "dimens", label: "DIMENS", width: 140 },
  { key: "percent", label: "%", width: 70, derived: true },
  { key: "v_puerta", label: "V. PUERTA", width: 110 },
  { key: "flete_intl", label: "FLETE INTL", width: 110, derived: true },
  { key: "seguro", label: "SEGURO", width: 100, derived: true },
  { key: "valor_imp", label: "VALOR IMP", width: 110, derived: true },
  { key: "desp_imp", label: "DESP. IMP.", width: 110, derived: true },
  { key: "finan", label: "FINAN.", width: 100, derived: true },
  { key: "instalac", label: "INSTALAC", width: 110, derived: true },
  { key: "sub_total", label: "SUB TOTAL", width: 120, derived: true },
  { key: "rent", label: "RENT", width: 100, derived: true },
  { key: "adicional", label: "ADICIONAL", width: 100, derived: true },
  { key: "total_ventas", label: "TOTAL VENTAS", width: 130, derived: true },
  { key: "pv_unit", label: "PV UNIT", width: 110, derived: true },
];

function toNumber(v) {
  if (v === "" || v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function emptyRow(n) {
  return {
    item: n,
    cant: "",
    tipo_puerta: "",
    cbm: "",
    peso: "",
    sector: "",
    dimens: "",
    v_puerta: "",
    adicional: "",
  };
}

function hasRowContent(r = {}) {
  return Object.entries(r).some(
    ([k, v]) =>
      ![
        "item",
        "percent",
        "flete_intl",
        "seguro",
        "valor_imp",
        "desp_imp",
        "finan",
        "instalac",
        "sub_total",
        "rent",
        "total_ventas",
        "pv_unit",
      ].includes(k) && String(v ?? "").trim() !== ""
  );
}

const IndustrialQuoteSheet = forwardRef(function IndustrialQuoteSheet(
  { deal, readOnly, externalFleteTotal },
  ref
) {
  const [rows, setRows] = useState([emptyRow(1), emptyRow(2), emptyRow(3)]);
  const rowsRef = useRef(rows);
  const [header, setHeader] = useState({
    rentRate: 30,
    adicional: 500,
    fleteTotal: "",
    seguroTotal: 0,
    despTotal: 0,
    finanTotal: 0,
    instalacTotal: 0,
    tc: 7200,
    fecha: "",
  });

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const totalVPuerta = useMemo(
    () => rows.reduce((acc, r) => acc + toNumber(r.v_puerta), 0),
    [rows]
  );

  const derivedRows = useMemo(() => {
    const activeCount =
      rows.filter((r) => hasRowContent(r)).length || rows.length || 1;
    return rows.map((r) => {
      const vpuerta = toNumber(r.v_puerta);
      const cant = toNumber(r.cant) || 1;
      const percent = totalVPuerta
        ? (vpuerta / totalVPuerta) * 100
        : header.fleteTotal
        ? 100 / activeCount
        : 0;
      const flete = header.fleteTotal * (percent / 100);
      const seguro = header.seguroTotal * (percent / 100);
      const valorImp = vpuerta + flete + seguro;
      const desp = header.despTotal * (percent / 100);
      const finan = header.finanTotal * (percent / 100);
      const inst = header.instalacTotal * (percent / 100);
      const subTotal = valorImp + desp + finan + inst;
      const rent = vpuerta * (header.rentRate / 100);
      const adicional = toNumber(r.adicional);
      const totalVentas = subTotal + rent + adicional;
      const pvUnit = totalVentas / cant;
      return {
        ...r,
        percent,
        flete_intl: flete,
        seguro,
        valor_imp: valorImp,
        desp_imp: desp,
        finan,
        instalac: inst,
        sub_total: subTotal,
        rent,
        adicional,
        total_ventas: totalVentas,
        pv_unit: pvUnit,
      };
    });
  }, [rows, header, totalVPuerta]);

  const totals = useMemo(() => {
    const acc = {};
    for (const col of COLS) {
      acc[col.key] = derivedRows.reduce((s, r) => s + toNumber(r[col.key]), 0);
    }
    return acc;
  }, [derivedRows]);

  const setHeaderField = (k, v) => {
    setHeader((prev) => ({ ...prev, [k]: v }));
  };

  const updateRow = (idx, key, value) => {
    setRows((prev) => {
      const next = prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r));
      rowsRef.current = next;
      return next;
    });
  };

  const addRow = () =>
    setRows((prev) => {
      const n = prev.length + 1;
      const next = [...prev, emptyRow(n)];
      rowsRef.current = next;
      return next;
    });

  useImperativeHandle(ref, () => ({
    getData: () => ({
      header,
      rows: rowsRef.current || rows,
    }),
    commitDomRows: () => rowsRef.current || rows,
    setData: (data = {}) => {
      const incoming = { ...(data.header || {}) };
      if (
        incoming.fleteTotal !== undefined &&
        incoming.fleteTotal !== null &&
        String(incoming.fleteTotal).trim() !== ""
      ) {
        incoming.fleteTotal = toNumber(incoming.fleteTotal);
      }
      setHeader((prev) => ({ ...prev, ...incoming }));

      if (!Array.isArray(data.rows) || !data.rows.length) return;
      const candidate = data.rows.map((r, i) => ({ ...r, item: r.item ?? i + 1 }));
      if (!candidate.some(hasRowContent)) return;
      rowsRef.current = candidate;
      setRows(candidate);
    },
  }));

  // Sincronizar flete externo
  useEffect(() => {
    if (externalFleteTotal === null || externalFleteTotal === undefined) return;
    const n = toNumber(externalFleteTotal);
    setHeader((prev) => ({ ...prev, fleteTotal: n }));
  }, [externalFleteTotal]);

  return (
    <div className="bg-white rounded-2xl shadow p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-medium">Detalle de oferta (puertas)</h3>
          <p className="text-xs text-slate-500">
            Cliente: {deal?.org_name || "-"} • Ref: {deal?.reference || "-"}
          </p>
        </div>
        <div className="flex gap-2 text-xs items-center">
          <span>Fecha:</span>
          <input
            type="date"
            className="border rounded px-2 py-1"
            value={header.fecha}
            onChange={(e) => setHeaderField("fecha", e.target.value)}
          />
          <span>TC:</span>
          <input
            className="border rounded px-2 py-1 w-20"
            value={header.tc}
            onChange={(e) => setHeaderField("tc", e.target.value)}
          />
          <button
            className="px-3 py-1.5 text-xs rounded-lg border hover:bg-slate-50"
            onClick={addRow}
            disabled={readOnly}
          >
            + Fila
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-3">
        <label className="flex items-center gap-1">
          <span>Flete total:</span>
          <input
            className="border rounded px-2 py-1 w-24 bg-slate-100 cursor-not-allowed"
            value={header.fleteTotal}
            readOnly
            title="Se completa automáticamente desde 'Precio flete'"
          />
        </label>
        <label className="flex items-center gap-1">
          <span>Seguro total:</span>
          <input
            className="border rounded px-2 py-1 w-24"
            value={header.seguroTotal}
            onChange={(e) => setHeaderField("seguroTotal", toNumber(e.target.value))}
            disabled={readOnly}
          />
        </label>
        <label className="flex items-center gap-1">
          <span>Desp. imp total:</span>
          <input
            className="border rounded px-2 py-1 w-24"
            value={header.despTotal}
            onChange={(e) => setHeaderField("despTotal", toNumber(e.target.value))}
            disabled={readOnly}
          />
        </label>
        <label className="flex items-center gap-1">
          <span>Finan. total:</span>
          <input
            className="border rounded px-2 py-1 w-24"
            value={header.finanTotal}
            onChange={(e) => setHeaderField("finanTotal", toNumber(e.target.value))}
            disabled={readOnly}
          />
        </label>
        <label className="flex items-center gap-1">
          <span>Instalac total:</span>
          <input
            className="border rounded px-2 py-1 w-24"
            value={header.instalacTotal}
            onChange={(e) => setHeaderField("instalacTotal", toNumber(e.target.value))}
            disabled={readOnly}
          />
        </label>
        <label className="flex items-center gap-1">
          <span>Rent %:</span>
          <input
            className="border rounded px-2 py-1 w-16"
            value={header.rentRate}
            onChange={(e) => setHeaderField("rentRate", toNumber(e.target.value))}
            disabled={readOnly}
          />
        </label>
      </div>

      <div className="overflow-auto border rounded-lg">
        <table className="min-w-full text-xs border-collapse">
          <thead>
            <tr className="bg-yellow-300 text-black">
              {COLS.map((c) => (
                <th
                  key={c.key}
                  className="border border-slate-500 font-semibold px-2 py-1 text-left"
                  style={{ minWidth: c.width }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {derivedRows.map((row, idx) => (
              <tr key={idx} className="odd:bg-white even:bg-slate-50">
                {COLS.map((c) => {
                  const isInput = !c.derived;
                  const val = row[c.key] ?? "";
                  return (
                    <td
                      key={c.key}
                      className="border border-slate-300 px-1 py-1"
                      style={{ minWidth: c.width }}
                    >
                      {isInput ? (
                        <input
                          className="w-full text-xs px-1 py-0.5 border rounded"
                          value={val}
                          onChange={(e) => updateRow(idx, c.key, e.target.value)}
                          disabled={readOnly}
                        />
                      ) : (
                        <div className="text-right font-semibold px-1">
                          {c.key === "percent"
                            ? `${row.percent.toFixed(2)}%`
                            : toNumber(val).toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-yellow-100 font-semibold">
              {COLS.map((c) => (
                <td
                  key={c.key}
                  className="border border-slate-500 px-2 py-1"
                  style={{ minWidth: c.width }}
                >
                  {["item", "cant", "tipo_puerta", "cbm", "peso", "sector", "dimens"].includes(c.key)
                    ? ""
                    : c.key === "percent"
                    ? totals.percent.toFixed(2) + "%"
                    : totals[c.key]?.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-2 text-[11px] text-slate-500">
        Debug filas: {rows.length} • fila0: {JSON.stringify(rows[0])}
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <div className="border rounded-lg p-2 bg-yellow-50">
          <div className="font-semibold mb-1">DIM / CAJA / KG</div>
          <textarea
            className="w-full border rounded px-2 py-1"
            rows={3}
            placeholder="Ej: 1 caja de 4500x750x760 • CAJA: 1 • KG: 450"
          />
        </div>
        <div className="border rounded-lg p-2 bg-slate-50">
          <div className="font-semibold mb-1">Resumen rápido</div>
          <div className="grid grid-cols-2 gap-1">
            <span className="text-slate-600">Total ventas:</span>
            <span>
              {totals.total_ventas.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span className="text-slate-600">PV unit promedio:</span>
            <span>
              {rows.length
                ? (
                    totals.total_ventas /
                    Math.max(toNumber(totals.cant), 1)
                  ).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : "0.00"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});

export default IndustrialQuoteSheet;
