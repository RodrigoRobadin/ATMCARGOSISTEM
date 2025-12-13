// client/src/components/op-details/IndustrialInstallSheet.jsx
// Tabla de instalación tipo Excel, con cálculos básicos
import React, { useMemo, useState, forwardRef, useImperativeHandle } from "react";

const COLS = [
  { key: "item", label: "ITEM", width: 50 },
  { key: "cant", label: "CANT", width: 60 },
  { key: "tipo_puerta", label: "TIPO PUERTA", width: 180 },
  { key: "servicio", label: "SERVICIO", width: 220 },
  { key: "c_unit", label: "C UNIT", width: 100 },
  { key: "c_total", label: "C. TOTAL", width: 110, derived: true },
  { key: "v_unit", label: "V. UNIT", width: 100 },
  { key: "v_total", label: "V TOTAL", width: 110, derived: true },
  { key: "profit_gs", label: "PROFFIT GS", width: 110, derived: true },
  { key: "vta_usd", label: "VTA USD", width: 100, derived: true },
  { key: "profit_usd", label: "PROFFIT USD", width: 100, derived: true },
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
    servicio: "",
    c_unit: "",
    v_unit: "",
  };
}

const IndustrialInstallSheet = forwardRef(function IndustrialInstallSheet({ deal, readOnly }, ref) {
  const [rows, setRows] = useState(
    Array.from({ length: 10 }, (_, i) => emptyRow(i + 1))
  );
  const [tc, setTc] = useState(7200);
  const [fecha, setFecha] = useState("");

  const derivedRows = useMemo(() => {
    return rows.map((r) => {
      const cant = toNumber(r.cant) || 1;
      const cTotal = toNumber(r.c_unit) * cant;
      const vTotal = toNumber(r.v_unit) * cant;
      const profitGs = vTotal - cTotal;
      const vtaUsd = tc ? vTotal / tc : 0;
      const profitUsd = tc ? profitGs / tc : 0;
      return {
        ...r,
        c_total: cTotal,
        v_total: vTotal,
        profit_gs: profitGs,
        vta_usd: vtaUsd,
        profit_usd: profitUsd,
      };
    });
  }, [rows, tc]);

  const totals = useMemo(() => {
    const acc = {};
    for (const c of COLS) {
      acc[c.key] = derivedRows.reduce((sum, r) => sum + toNumber(r[c.key]), 0);
    }
    return acc;
  }, [derivedRows]);

  const updateRow = (idx, key, value) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  };

  useImperativeHandle(ref, () => ({
    getData: () => ({ rows, tc, fecha }),
    setData: (d = {}) => {
      if (Array.isArray(d.rows)) setRows(d.rows.length ? d.rows : rows);
      if (d.tc != null) setTc(d.tc);
      if (d.fecha != null) setFecha(d.fecha);
    },
  }));

  return (
    <div className="bg-white rounded-2xl shadow p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-medium">Instalación puertas</h3>
          <p className="text-xs text-slate-500">
            Cliente: {deal?.org_name || "-"} • Ref: {deal?.reference || "-"}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
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
            onChange={(e) => setTc(toNumber(e.target.value))}
            disabled={readOnly}
          />
        </div>
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
                          {toNumber(val).toLocaleString(undefined, {
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
                  {["item", "cant", "tipo_puerta", "servicio"].includes(c.key)
                    ? ""
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
    </div>
  );
});

export default IndustrialInstallSheet;
