// client/src/pages/admin/sections/PipelineView.jsx
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../api";
import InvoiceCreateModal from "../../../components/InvoiceCreateModal.jsx";

const fmtDateTime = (v) => {
  if (!v) return "—";
  try {
    const d = new Date(v);
    return d.toLocaleString();
  } catch {
    return v;
  }
};

export default function PipelineView({
  stages,
  items,
  anchorStageId,
  stageOptions,
  onChangeStage,
  onOpenDocs,
}) {
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [selectedDealId, setSelectedDealId] = useState(null);
  const [selectedServiceCaseId, setSelectedServiceCaseId] = useState(null);

  // agrupar por stage_id
  const itemsByStage = useMemo(() => {
    const map = new Map(stages.map((s) => [s.id, []]));
    for (const it of items) {
      if (map.has(it.stage_id)) map.get(it.stage_id).push(it);
    }
    // orden por actualizado desc
    for (const [k, arr] of map) {
      arr.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    }
    return map;
  }, [stages, items]);

  function stageProfit(stageId) {
    const list = itemsByStage.get(stageId) || [];
    return list.reduce((sum, op) => {
      const v = Number(op.profit_total_usd ?? op.profit_usd ?? op.profit ?? 0);
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0);
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {stages.map((stage) => (
          <div key={stage.id} className="bg-white border rounded-lg overflow-hidden">
            <div
              className={`px-3 py-2 border-b font-semibold ${
                stage.id === anchorStageId ? "bg-slate-900 text-white" : "bg-slate-50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span>{stage.name}</span>
                <span className="text-xs bg-emerald-50 text-emerald-700 rounded px-2 py-0.5">
                  Profit $ {stageProfit(stage.id).toLocaleString()}
                </span>
              </div>
            </div>
            <div className="p-3 space-y-3">
              {(itemsByStage.get(stage.id) || []).map((op) => (
                <div key={op.id} className="border rounded p-3 space-y-2">
                  <div className="flex justify-between">
                    <Link
                      to={op.op_type === "service" ? `/service/cases/${op.id}` : `/operations/${op.id}`}
                      className="font-medium hover:underline"
                    >
                      {op.reference}
                    </Link>
                    <span className="text-xs text-slate-500">{op.transport_type}</span>
                  </div>

                  <div className="text-sm">
                    <div className="text-slate-600">{op.org_name || "—"}</div>
                    <div className="text-slate-500">Act: {fmtDateTime(op.updated_at)}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs">En tránsito:</span>
                    <span
                      className={`px-2 py-0.5 text-xs rounded ${
                        op.in_transit ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {op.in_transit ? "Sí" : "No"}
                    </span>
                  </div>

                  <div>
                    <label className="text-xs text-slate-500">Mover a etapa:</label>
                    <select
                      className="border rounded px-2 py-1 w-full"
                      value={op.stage_id}
                      onChange={(e) => onChangeStage(op.id, e.target.value, op.op_type)}
                    >
                      {stageOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <Link
                      className="btn"
                      to={
                        op.op_type === "service"
                          ? `/api/service/cases/${op.id}/report`
                          : `/api/reports/status/view/${op.id}`
                      }
                      target="_blank"
                    >
                      Informe
                    </Link>
                    {op.op_type !== "service" && (
                      <button className="btn" onClick={() => onOpenDocs(op)}>
                        Documentos
                      </button>
                    )}
                    <button
                      className="btn bg-green-600 text-white hover:bg-green-700"
                      onClick={() => {
                        if (op.op_type === "service") {
                          setSelectedServiceCaseId(op.id);
                          setSelectedDealId(null);
                        } else {
                          setSelectedDealId(op.id);
                          setSelectedServiceCaseId(null);
                        }
                        setShowInvoiceModal(true);
                      }}
                    >
                      Facturar
                    </button>
                  </div>
                </div>
              ))}
              {(itemsByStage.get(stage.id) || []).length === 0 && (
                <div className="text-sm text-slate-400 text-center py-4">Sin operaciones</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {showInvoiceModal && (
        <InvoiceCreateModal
          defaultDealId={selectedDealId}
          defaultServiceCaseId={selectedServiceCaseId}
          onClose={() => {
            setShowInvoiceModal(false);
            setSelectedDealId(null);
            setSelectedServiceCaseId(null);
          }}
          onSuccess={(invoiceId) => {
            setShowInvoiceModal(false);
            setSelectedDealId(null);
            setSelectedServiceCaseId(null);
            if (invoiceId) window.open(`/invoices/${invoiceId}`, "_blank");
          }}
        />
      )}
    </>
  );
}
