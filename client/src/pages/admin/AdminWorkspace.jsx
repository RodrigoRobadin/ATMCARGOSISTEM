import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import PipelineView from "./sections/PipelineView.jsx";
import TableView from "./sections/TableView.jsx";
import DocsDrawer from "./sections/DocsDrawer.jsx";
import InvoiceCreateModal from "../../components/InvoiceCreateModal.jsx";

const STAGE_ANCHOR_NAME = "Conf a Coord";

export default function AdminWorkspace() {
  const [view, setView] = useState("pipeline");
  const [pipelineId, setPipelineId] = useState(1);
  const [moduleFilter, setModuleFilter] = useState("all");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [ops, setOps] = useState([]);
  const [stages, setStages] = useState([]);
  const [search, setSearch] = useState("");

  const [selectedOp, setSelectedOp] = useState(null);
  const [showDocs, setShowDocs] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [selectedDealId, setSelectedDealId] = useState(null);
  const [selectedServiceCaseId, setSelectedServiceCaseId] = useState(null);

  async function loadStages(pid) {
    const { data } = await api.get(`/admin/stages?pipeline_id=${pid}`);
    return Array.isArray(data) ? data : [];
  }

  async function loadOps(pid) {
    const ts = Date.now();
    const { data } = await api.get(
      `/admin/ops?pipeline_id=${pid}&from_stage=${encodeURIComponent(
        STAGE_ANCHOR_NAME
      )}&t=${ts}`
    );
    return Array.isArray(data) ? data : [];
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const [loadedStages, loadedOps] = await Promise.all([
          loadStages(pipelineId),
          loadOps(pipelineId),
        ]);
        setStages(loadedStages);
        setOps(loadedOps);
      } catch (error) {
        console.error("Error cargando /admin:", error);
        setErr(error?.message || "No se pudo cargar la informacion.");
        setStages([]);
        setOps([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [pipelineId]);

  const { stagesFromAnchor, anchorStageId } = useMemo(() => {
    const anchor =
      stages.find(
        (stage) =>
          String(stage.name || "").toLowerCase() ===
          STAGE_ANCHOR_NAME.toLowerCase()
      ) || stages[0];

    let sliced = stages;
    if (anchor) {
      const index = stages.findIndex((stage) => stage.id === anchor.id);
      if (index >= 0) sliced = stages.slice(index);
    }

    return { stagesFromAnchor: sliced, anchorStageId: anchor?.id || null };
  }, [stages]);

  const moduleOptions = useMemo(() => {
    const map = new Map();
    for (const op of ops) {
      const key =
        String(op.business_unit_key || "")
          .trim()
          .toLowerCase() || (op.op_type === "service" ? "services" : "sin-modulo");
      const label =
        String(op.business_unit_name || "").trim() ||
        (op.op_type === "service" ? "Servicios y mantenimiento" : "Sin modulo");
      if (!map.has(key)) map.set(key, label);
    }
    return [
      { key: "all", label: "Todos los modulos" },
      ...Array.from(map.entries())
        .sort((a, b) => a[1].localeCompare(b[1], "es"))
        .map(([key, label]) => ({ key, label })),
    ];
  }, [ops]);

  const filteredOps = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    return ops.filter((op) => {
      const opModuleKey =
        String(op.business_unit_key || "")
          .trim()
          .toLowerCase() || (op.op_type === "service" ? "services" : "sin-modulo");

      if (moduleFilter !== "all" && opModuleKey !== moduleFilter) return false;
      if (!q) return true;

      const haystack = [
        op.reference,
        op.org_name,
        op.contact_name,
        op.stage_name,
        op.status_ops,
        op.transport_type,
        op.invoice_numbers,
        op.invoice_statuses,
        op.business_unit_name,
      ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase())
        .join(" ");

      return haystack.includes(q);
    });
  }, [moduleFilter, ops, search]);

  const openDocs = (op) => {
    setSelectedOp(op);
    setShowDocs(true);
  };

  const closeDocs = () => {
    setShowDocs(false);
    setSelectedOp(null);
  };

  const openInvoice = (op) => {
    if (String(op?.op_type || "").toLowerCase() === "service") {
      setSelectedServiceCaseId(op.id);
      setSelectedDealId(null);
    } else {
      setSelectedDealId(op.id);
      setSelectedServiceCaseId(null);
    }
    setShowInvoiceModal(true);
  };

  async function changeStage(opId, newStageId, opType) {
    try {
      const { data } = await api.patch(`/admin/ops/${opId}/stage`, {
        stage_id: Number(newStageId),
        op_type: opType,
      });
      setOps((prev) =>
        prev.map((item) => (item.id === opId ? { ...item, ...data } : item))
      );
    } catch (error) {
      console.error("changeStage error", error);
      alert("No se pudo cambiar la etapa");
    }
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">
            Administracion (Operaciones)
          </h1>
          <p className="text-slate-500 text-sm">
            Gestion de operaciones confirmadas: documentos, compras y facturacion.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          <input
            className="border rounded-lg px-3 py-1 w-64"
            placeholder="Buscar operacion, cliente, referencia, estado, factura..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="border rounded-lg px-2 py-1"
            value={pipelineId}
            onChange={(e) => setPipelineId(Number(e.target.value))}
          >
            <option value={1}>Pipeline 1</option>
          </select>

          <div className="inline-flex rounded-lg border overflow-hidden">
            <button
              className={`px-3 py-1.5 text-sm ${
                view === "pipeline" ? "bg-slate-900 text-white" : "bg-white"
              }`}
              onClick={() => setView("pipeline")}
            >
              Pipeline
            </button>
            <button
              className={`px-3 py-1.5 text-sm ${
                view === "table" ? "bg-slate-900 text-white" : "bg-white"
              }`}
              onClick={() => setView("table")}
            >
              Tabla
            </button>
          </div>
        </div>
      </div>

      <div className="mb-4 -mx-1 px-1 overflow-x-auto">
        <div className="flex items-center gap-2 min-w-max">
          {moduleOptions.map((option) => {
            const active = moduleFilter === option.key;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setModuleFilter(option.key)}
                className={`px-3 py-1.5 text-sm rounded-full border whitespace-nowrap transition ${
                  active
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading && <div className="text-slate-500">Cargando...</div>}

      {!loading && err && (
        <div className="mb-3 text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">
          {err}
        </div>
      )}

      {!loading && !err && filteredOps.length === 0 && (
        <div className="text-slate-500 text-sm">
          No se encontraron operaciones desde <b>{STAGE_ANCHOR_NAME}</b> en
          adelante.
        </div>
      )}

      {!loading && !err && filteredOps.length > 0 && view === "pipeline" && (
        <PipelineView
          stages={stagesFromAnchor}
          items={filteredOps}
          anchorStageId={anchorStageId}
          stageOptions={stages.map((stage) => ({
            value: stage.id,
            label: stage.name,
          }))}
          onChangeStage={changeStage}
          onOpenDocs={openDocs}
        />
      )}

      {!loading && !err && filteredOps.length > 0 && view === "table" && (
        <TableView
          items={filteredOps}
          stageOptions={stages.map((stage) => ({
            value: stage.id,
            label: stage.name,
          }))}
          onChangeStage={changeStage}
          onOpenDocs={openDocs}
          onInvoice={openInvoice}
          showInTransit
        />
      )}

      <DocsDrawer open={showDocs} onClose={closeDocs} op={selectedOp} />

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
    </div>
  );
}
