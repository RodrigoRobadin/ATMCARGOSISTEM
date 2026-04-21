import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import InvoiceCreateModal from "../../../components/InvoiceCreateModal.jsx";
import { useAuth } from "../../../auth.jsx";

const msPerDay = 24 * 60 * 60 * 1000;

const diffDays = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / msPerDay));
};

const operationDetailUrl = (op) =>
  op.op_type === "service"
    ? `/service/cases/${op.id}?tab=administracion`
    : `/operations/${op.id}?tab=administracion`;

const reportUrl = (op) =>
  op.op_type === "service"
    ? `/api/service/cases/${op.id}/report`
    : `/api/reports/status/view/${op.id}`;

const stopCardClick = (event) => {
  event.stopPropagation();
};

export default function PipelineView({
  stages,
  items,
  stageOptions,
  onChangeStage,
  onOpenDocs,
}) {
  const { user } = useAuth();
  const isAdmin = String(user?.role || "").toLowerCase() === "admin";
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [selectedDealId, setSelectedDealId] = useState(null);
  const [selectedServiceCaseId, setSelectedServiceCaseId] = useState(null);

  const itemsByStage = useMemo(() => {
    const map = new Map(stages.map((stage) => [stage.id, []]));
    for (const item of items) {
      if (!map.has(item.stage_id)) continue;
      map.get(item.stage_id).push(item);
    }
    for (const [, list] of map) {
      list.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    }
    return map;
  }, [items, stages]);

  const openInvoice = (item) => {
    if (item.op_type === "service") {
      setSelectedServiceCaseId(item.id);
      setSelectedDealId(null);
    } else {
      setSelectedDealId(item.id);
      setSelectedServiceCaseId(null);
    }
    setShowInvoiceModal(true);
  };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
        {stages.map((stage) => {
          const stageItems = itemsByStage.get(stage.id) || [];

          return (
            <div
              key={stage.id}
              className="bg-white rounded-2xl shadow p-3 min-h-[240px]"
            >
              <div className="mb-3">
                <div className="font-medium flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-[15px] font-semibold text-slate-900 break-words">
                      {stage.name}
                    </span>
                  </div>
                  <span className="text-xs bg-slate-100 rounded px-2 py-0.5 shrink-0">
                    {stageItems.length}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {stageItems.length} abiertos
                </div>
              </div>

              <div className="space-y-3">
                {stageItems.map((item) => {
                  const updatedDays = diffDays(item.updated_at);
                  const reference = item.reference || item.title || `OP-${item.id}`;
                  const subtitleParts = [
                    item.org_name || "Sin cliente",
                    item.contact_name || null,
                  ].filter(Boolean);

                  return (
                    <div
                      key={`${item.op_type || "deal"}-${item.id}`}
                      className="relative block w-full border rounded-xl p-3 hover:shadow transition bg-white cursor-pointer"
                      onClick={() =>
                        window.open(
                          operationDetailUrl(item),
                          "_blank",
                          "noopener,noreferrer"
                        )
                      }
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          to={operationDetailUrl(item)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-semibold truncate hover:underline"
                          onClick={stopCardClick}
                        >
                          {reference}
                        </Link>
                        <span className="text-[11px] uppercase tracking-wide text-slate-500 shrink-0">
                          {item.transport_type || (item.op_type === "service" ? "Servicio" : "Operación")}
                        </span>
                      </div>

                      <div className="text-xs text-slate-600 truncate mt-1">
                        {subtitleParts.join(" • ") || "Sin datos"}
                      </div>

                      <div className="flex items-center gap-2 flex-wrap mt-2">
                        {typeof updatedDays === "number" && (
                          <span className="text-xs bg-slate-100 rounded px-2 py-0.5">
                            hace {updatedDays} d
                          </span>
                        )}
                        {item.invoice_numbers && (
                          <span className="text-xs bg-blue-50 text-blue-700 rounded px-2 py-0.5">
                            {item.invoice_numbers}
                          </span>
                        )}
                      </div>

                      <div className="mt-3">
                        <select
                          className="border rounded-lg px-2 py-1.5 w-full text-sm bg-white"
                          value={item.stage_id}
                          onClick={stopCardClick}
                          onChange={(e) =>
                            onChangeStage(item.id, e.target.value, item.op_type)
                          }
                        >
                          {stageOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex gap-2 pt-3 flex-wrap">
                        <Link
                          className="px-2.5 py-1.5 text-xs rounded-lg border hover:bg-slate-50"
                          to={reportUrl(item)}
                          target="_blank"
                          rel="noreferrer"
                          onClick={stopCardClick}
                        >
                          Informe
                        </Link>
                        {item.op_type !== "service" && (
                          <button
                            className="px-2.5 py-1.5 text-xs rounded-lg border hover:bg-slate-50"
                            onClick={(event) => {
                              stopCardClick(event);
                              onOpenDocs(item);
                            }}
                          >
                            Documentos
                          </button>
                        )}
                        {isAdmin ? (
                          <button
                            className="px-2.5 py-1.5 text-xs rounded-lg bg-black text-white hover:bg-slate-800"
                            onClick={(event) => {
                              stopCardClick(event);
                              openInvoice(item);
                            }}
                          >
                            Facturar
                          </button>
                        ) : (
                          <span className="px-2.5 py-1.5 text-xs rounded-lg bg-slate-50 text-slate-600 border border-slate-200 cursor-default">
                            Pendiente de administración
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {stageItems.length === 0 && (
                  <div className="text-sm text-slate-400 text-center py-6">
                    Sin operaciones
                  </div>
                )}
              </div>
            </div>
          );
        })}
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
