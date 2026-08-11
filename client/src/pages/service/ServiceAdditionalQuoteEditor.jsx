import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import AdminOpsPanel from "../../components/op-details/AdminOpsPanel.jsx";
import OperationExpenseInvoices from "../../components/OperationExpenseInvoices.jsx";
import QuoteEditor from "../QuoteEditor";

export default function ServiceAdditionalQuoteEditor() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const caseIdFromQuery = Number(searchParams.get("caseId") || 0) || null;
  const [tab, setTab] = useState("oferta");
  const [additional, setAdditional] = useState(null);
  const [caseData, setCaseData] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data: additionData } = await api.get(`/service/additional-quotes/${id}`);
        if (!active) return;
        setAdditional(additionData || null);
        const resolvedCaseId = caseIdFromQuery || Number(additionData?.service_case_id || 0) || null;
        if (resolvedCaseId) {
          const { data: detail } = await api.get(`/service/cases/${resolvedCaseId}`).catch(() => ({ data: null }));
          if (active) setCaseData(detail?.case || detail?.data || detail || null);
        }
      } catch (error) {
        console.error("No se pudo cargar el contexto del presupuesto adicional", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [caseIdFromQuery, id]);

  const resolvedCaseId = caseIdFromQuery || Number(additional?.service_case_id || 0) || null;
  const budgetPath = resolvedCaseId
    ? `/service/cases/${resolvedCaseId}/industrial-quote?serviceCaseId=${resolvedCaseId}&additionId=${id}`
    : null;
  const adminDeal = useMemo(() => ({
    reference: additional?.inputs?.ref_code || caseData?.reference || `Adicional #${id}`,
    org_name: caseData?.org_name || caseData?.organization_name || "-",
    operation_currency: additional?.inputs?.operation_currency || "USD",
    status_ops: additional?.meta?.status || "Presupuesto adicional",
  }), [additional, caseData, id]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{adminDeal.reference}</div>
          <div className="text-xs text-slate-500">Presupuesto adicional de Servicio y Mantenimiento</div>
        </div>
        {budgetPath && (
          <Link
            to={budgetPath}
            className="shrink-0 rounded border border-blue-300 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
          >
            Ver presupuesto
          </Link>
        )}
      </div>

      <div className="flex gap-2 border-b bg-white px-4 pt-3">
        <button
          type="button"
          onClick={() => setTab("oferta")}
          className={`rounded-t px-4 py-2 text-sm font-medium ${tab === "oferta" ? "bg-black text-white" : "border border-b-0 bg-white text-slate-700"}`}
        >
          Detalle de oferta
        </button>
        <button
          type="button"
          onClick={() => setTab("gastos")}
          className={`rounded-t px-4 py-2 text-sm font-medium ${tab === "gastos" ? "bg-black text-white" : "border border-b-0 bg-white text-slate-700"}`}
        >
          Gastos
        </button>
        <button
          type="button"
          onClick={() => setTab("administracion")}
          className={`rounded-t px-4 py-2 text-sm font-medium ${tab === "administracion" ? "bg-black text-white" : "border border-b-0 bg-white text-slate-700"}`}
        >
          Administracion
        </button>
      </div>

      {tab === "oferta" ? (
        <QuoteEditor
          quoteBaseOverride="/service/additional-quotes"
          ignoreInvoiceLock
          enableRevisions={false}
        />
      ) : tab === "gastos" ? (
        <div className="p-4">
          {resolvedCaseId ? (
            <OperationExpenseInvoices
              operationId={resolvedCaseId}
              operationType="service"
              serviceQuoteAdditionId={Number(id)}
              showList
              title="Gastos del presupuesto adicional"
              subtitle="Facturas de compra vinculadas exclusivamente a este adicional."
            />
          ) : (
            <div className="text-sm text-slate-500">Cargando servicio...</div>
          )}
        </div>
      ) : (
        <div className="p-4">
          <AdminOpsPanel
            serviceCaseId={resolvedCaseId || undefined}
            serviceQuoteAdditionId={Number(id)}
            deal={adminDeal}
          />
        </div>
      )}
    </div>
  );
}
