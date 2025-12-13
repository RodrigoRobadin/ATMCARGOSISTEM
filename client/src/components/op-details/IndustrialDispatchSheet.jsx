// client/src/components/op-details/IndustrialDispatchSheet.jsx
// Tabla tipo "Proforma de despacho" con cálculos básicos (USD y Gs)
import React, { useMemo, useState, forwardRef, useImperativeHandle } from "react";

const ROWS = [
  { key: "derecho", label: "Derecho Aduanero", pct: 0 },
  { key: "valoracion", label: "Servicio de Valoración", pct: 0.5 },
  { key: "consular", label: "Arancel Consular", pct: null, fixed: 55 },
  { key: "indi", label: "I.N.D.I.", pct: 7, base: "consular" }, // usa arancel consular
  { key: "selectivo", label: "Impuesto Selectivo al Consumo", pct: 0, base: "selectivo" },
  { key: "iva", label: "I.V.A.", pct: 10, base: "iva" },
  { key: "ivaCasual", label: "I.V.A. Casual", pct: 0, base: "iva" },
  { key: "dinac", label: "Tasa Portuaria DINAC (1er periodo)", pct: 2 },
  { key: "decreto", label: "Decreto 13087", pct: null, fixed: 0 },
  { key: "terminales", label: "Gastos Terminales ATM", pct: null, fixed: 0 },
  { key: "fotocopias", label: "Fotocopias AEDA", pct: null, fixed: 10 },
  { key: "ire", label: "Anticipo IRE", pct: 0.4 },
  { key: "sofia", label: "Canon Informático SOFIA", pct: null, fixed: 30 },
  { key: "flete", label: "Flete hasta depósito Importador", pct: null, fixed: 0 },
  { key: "personal", label: "Personal p/ Verificación, Estiba", pct: null, fixed: 0 },
  { key: "tramite", label: "Gastos de Trámite Despacho", pct: null, fixed: 100 },
  { key: "honorarios", label: "Honorarios Profesionales", pct: 2 },
  { key: "ivaHonor", label: "I.V.A. S/ Honorarios", pct: 10, dependsOn: "honorarios_tramite" },
];

function toNumber(v) {
  if (v === "" || v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const IndustrialDispatchSheet = forwardRef(function IndustrialDispatchSheet({ deal, readOnly }, ref) {
  const [valorImponible, setValorImponible] = useState(0);
  const [tc, setTc] = useState(7800);
  const [notes, setNotes] = useState("");

  const rows = useMemo(() => {
    const out = [];
    const vals = {}; // acumular resultados USD por key

    const getBase = (r) => {
      if (r.base === "consular") return vals.consular ?? 0;
      if (r.base === "selectivo") {
        return (vals.valorImponible ?? 0) + (vals.derecho ?? 0) + (vals.valoracion ?? 0) + (vals.consular ?? 0);
      }
      if (r.base === "iva") {
        return (
          (vals.valorImponible ?? 0) +
          (vals.derecho ?? 0) +
          (vals.valoracion ?? 0) +
          (vals.consular ?? 0) +
          (vals.indi ?? 0) +
          (vals.selectivo ?? 0)
        );
      }
      if (r.dependsOn === "honorarios_tramite") {
        return (vals.honorarios ?? 0) + (vals.tramite ?? 0);
      }
      return vals.valorImponible ?? valorImponible;
    };

    // valor imponible como pseudo-row
    vals.valorImponible = valorImponible;

    for (const r of ROWS) {
      let usd = 0;
      if (r.pct != null) {
        const base = getBase(r);
        usd = base * ((r.pct || 0) / 100);
      } else if (r.fixed != null) {
        usd = r.fixed;
      }
      vals[r.key] = usd;
      const gs = usd * tc;
      out.push({ ...r, usd, gs });
    }
    return out;
  }, [valorImponible, tc]);

  const totalUsd = rows.reduce((a, r) => a + r.usd, 0);
  const totalGs = rows.reduce((a, r) => a + r.gs, 0);

  useImperativeHandle(ref, () => ({
    getData: () => ({ valorImponible, tc, notes }),
    setData: (d = {}) => {
      if (d.valorImponible != null) setValorImponible(d.valorImponible);
      if (d.tc != null) setTc(d.tc);
      if (d.notes != null) setNotes(d.notes);
    },
  }));

  return (
    <div className="bg-white rounded-2xl shadow p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-medium">Proforma de despacho</h3>
          <p className="text-xs text-slate-500">
            Ref: {deal?.reference || "-"} • Cliente: {deal?.org_name || "-"}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1">
            <span>Valor Imponible USD:</span>
            <input
              className="border rounded px-2 py-1 w-28"
              value={valorImponible}
            onChange={(e) => setValorImponible(toNumber(e.target.value))}
            disabled={readOnly}
          />
          </div>
          <div className="flex items-center gap-1">
            <span>TC:</span>
            <input
              className="border rounded px-2 py-1 w-20"
              value={tc}
            onChange={(e) => setTc(toNumber(e.target.value))}
            disabled={readOnly}
          />
          </div>
        </div>
      </div>

      <div className="overflow-auto border rounded-lg">
        <table className="min-w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-100">
              <th className="border px-2 py-1 text-left">DESCRIPCIÓN</th>
              <th className="border px-2 py-1 text-right">%</th>
              <th className="border px-2 py-1 text-right">Total USD</th>
              <th className="border px-2 py-1 text-right">Total Gs.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="odd:bg-white even:bg-slate-50">
                <td className="border px-2 py-1">{r.label}</td>
                <td className="border px-2 py-1 text-right">
                  {r.pct != null ? `${(r.pct || 0).toFixed(2)}%` : ""}
                </td>
                <td className="border px-2 py-1 text-right">
                  {r.usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="border px-2 py-1 text-right">
                  {r.gs.toLocaleString(undefined, { minimumFractionDigits: 0 })}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-yellow-100 font-semibold">
              <td className="border px-2 py-1 text-right" colSpan={2}>Total Despacho a Pagar</td>
              <td className="border px-2 py-1 text-right">
                {totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
              <td className="border px-2 py-1 text-right">
                {totalGs.toLocaleString(undefined, { minimumFractionDigits: 0 })}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-3 text-xs">
        <label className="font-semibold block mb-1">Observaciones:</label>
        <textarea
          className={`w-full border rounded px-2 py-1 ${readOnly ? "bg-slate-50" : ""}`}
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notas u observaciones de despacho"
          disabled={readOnly}
        />
      </div>
    </div>
  );
});

export default IndustrialDispatchSheet;
