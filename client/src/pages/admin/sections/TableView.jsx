// client/src/pages/admin/sections/TableView.jsx
import React from "react";
import { Link } from "react-router-dom";

const fmtDateTime = (v) => {
  if (!v) return "—";
  try {
    const d = new Date(v);
    return d.toLocaleString();
  } catch {
    return v;
  }
};

export default function TableView({
  items,
  stageOptions,
  onChangeStage,
  onOpenDocs,
  showInTransit = false,
}) {
  return (
    <div className="bg-white border rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b font-semibold bg-slate-50">Operaciones</div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <Th>Ref</Th>
              <Th>Cliente</Th>
              <Th>Modalidad</Th>
              <Th>Etapa</Th>
              {showInTransit && <Th>En tránsito</Th>}
              <Th>Valor</Th>
              <Th>Actualizado</Th>
              <Th>Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-t">
                <Td>
                  <Link to={`/operations/${r.id}`} className="font-medium hover:underline">
                    {r.reference}
                  </Link>
                </Td>
                <Td>{r.org_name || "—"}</Td>
                <Td>{r.transport_type}</Td>
                <Td>
                  <select
                    className="border rounded px-2 py-1"
                    value={r.stage_id}
                    onChange={(e) => onChangeStage(r.id, e.target.value)}
                  >
                    {stageOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </Td>
                {showInTransit && (
                  <Td>
                    <span
                      className={`px-2 py-0.5 text-xs rounded ${
                        r.in_transit ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {r.in_transit ? "Sí" : "No"}
                    </span>
                  </Td>
                )}
                <Td>{r.value != null ? Number(r.value).toLocaleString() : "—"}</Td>
                <Td>{fmtDateTime(r.updated_at)}</Td>
                <Td className="space-x-2">
                  <Link className="btn" to={`/api/reports/status/view/${r.id}`} target="_blank">
                    Informe
                  </Link>
                  <button className="btn" onClick={() => onOpenDocs(r)}>
                    Docs
                  </button>
                  <button className="btn" onClick={() => alert("Emitir factura (pendiente)")}>
                    Facturar
                  </button>
                </Td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <Td colSpan={showInTransit ? 8 : 7} className="text-center text-slate-400 py-6">
                  Sin operaciones
                </Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }) {
  return <th className="text-left px-3 py-2 text-xs font-semibold text-slate-600">{children}</th>;
}
function Td({ children, colSpan }) {
  return (
    <td className="px-3 py-2 align-top" colSpan={colSpan}>
      {children}
    </td>
  );
}
