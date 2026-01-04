// client/src/pages/QuoteEditor.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth.jsx";

const emptyItem = (n = 1) => ({
  line_no: n,
  description: "",
  observation: "",
  qty: 1,
  door_value_usd: 0,
  additional_usd: 0, // ✅ adicional por item
});

const emptyInstall = (n = 1) => ({
  line_no: n,
  description: "",
  qty: 1,
  unit_cost_gs: 0,
  unit_price_gs: 0,
});

// Paquetes de instalación (costos unitarios en Gs)
const INSTALL_PACKAGES = {
  basico: {
    label: "Paquete Instalación (básico)",
    items: [
      { description: "INSTALACION", unit_cost_gs: 1850000 },
      { description: "DESMONTAJE PTA EXISTENTE", unit_cost_gs: 2500000 },
      { description: "SERVICIO DE TECNICO DE SEGURIDAD", unit_cost_gs: 500000 },
      { description: "EVALUACION DE RIESGO SYSO", unit_cost_gs: 1500000 },
      { description: "FLETE ELEVADOR", unit_cost_gs: 800000 },
      { description: "ELEVADOR", unit_cost_gs: 7000000 },
      { description: "FERRETERIA", unit_cost_gs: 300000 },
      { description: "COMBUSTIBLE", unit_cost_gs: 1000000 },
      { description: "MO TECNICO DOMINGO", unit_cost_gs: 220000 },
      { description: "IPS 2 TECNICOS", unit_cost_gs: 750000 },
      { description: "FLETE DE PTO A DESTINO", unit_cost_gs: 1850000 },
    ],
  },
};

// ✅ TODOS los conceptos de despacho (editables)
// Nota: aunque el engine ya no usa "type" en UI, lo dejamos por compat/DB.
const defaultCustomsLines = () => [
  { enabled: true, name: "Derecho Aduanero", type: "PERCENT", rate_decimal: 0.0, amount_usd: 0 },
  { enabled: true, name: "Servicio de Valoración", type: "PERCENT", rate_decimal: 0.005, amount_usd: 0 },
  { enabled: true, name: "Arancel Consular", type: "FIXED_USD", rate_decimal: 0, amount_usd: 55 },

  { enabled: true, name: "I.N.D.I.", type: "PERCENT", rate_decimal: 0.07, amount_usd: 0 },
  { enabled: true, name: "Impuesto Selectivo al Consumo", type: "PERCENT", rate_decimal: 0.0, amount_usd: 0 },
  { enabled: true, name: "I.V.A.", type: "PERCENT", rate_decimal: 0.1, amount_usd: 0 },
  { enabled: true, name: "I.V.A. Casual", type: "PERCENT", rate_decimal: 0.0, amount_usd: 0 },
  { enabled: true, name: "Tasa Portuaria DINAC (1er periodo)", type: "PERCENT", rate_decimal: 0.02, amount_usd: 0 },

  { enabled: true, name: "Decreto 13087", type: "FIXED_USD", rate_decimal: 0, amount_usd: 0 },
  { enabled: true, name: "Gastos Terminales ATM", type: "FIXED_USD", rate_decimal: 0, amount_usd: 0 },
  { enabled: true, name: "Fotocopias AEDA", type: "FIXED_USD", rate_decimal: 0, amount_usd: 10 },
  { enabled: true, name: "Anticipo IRE", type: "PERCENT", rate_decimal: 0.004, amount_usd: 0 },
  { enabled: true, name: "Canon Informático SOFIA", type: "FIXED_USD", rate_decimal: 0, amount_usd: 30 },

  { enabled: true, name: "Flete hasta depósito Importador", type: "FIXED_USD", rate_decimal: 0, amount_usd: 0 },
  { enabled: true, name: "Personal p/ Verificación, Estiba", type: "FIXED_USD", rate_decimal: 0, amount_usd: 0 },
  { enabled: true, name: "Gastos de Trámite Despacho", type: "FIXED_USD", rate_decimal: 0, amount_usd: 100 },

  { enabled: true, name: "Honorarios Profesionales", type: "PERCENT", rate_decimal: 0.02, amount_usd: 0 },
  { enabled: true, name: "I.V.A. S/ Honorarios", type: "PERCENT", rate_decimal: 0.1, amount_usd: 0 },
];

function n2(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function fmt2(v) {
  const x = Number(v);
  if (!Number.isFinite(x)) return "-";
  return x.toFixed(2);
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-3 py-2 text-sm rounded-lg border transition " +
        (active ? "bg-black text-white border-black" : "bg-white hover:bg-slate-50")
      }
    >
      {children}
    </button>
  );
}

export default function QuoteEditor() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const isNew = id === undefined || id === "new";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("oferta");

  const dealIdFromQuery = Number(searchParams.get("dealId") || "");
  const [dealId, setDealId] = useState(Number.isFinite(dealIdFromQuery) ? dealIdFromQuery : null);

  const [quoteId, setQuoteId] = useState(null);

  const [inputs, setInputs] = useState(() => ({
    ref_code: "",
    revision: "",
    client_name: "",
    status: "draft",
    created_by: "",

    // params base
    vendor_profit_pct: 0.15, // % profit vendedor
    rent_rate: 0.3, // ✅ 30% sobre CIF
    freight_international_total_usd: 0,
    freight_buy_usd: 0,

    // ✅ adicional_global_usd ahora se usa como "default por item" si el item no tiene additional_usd
    additional_global_usd: 0,

    insurance_sale_total_usd: 0,
    insurance_buy_rate: 0,
    insurance_profit_mode: "CORRECTED",

    exchange_rate_customs_gs_per_usd: 0,
    exchange_rate_customs_internal_gs_per_usd: 7000,
    exchange_rate_install_gs_per_usd: 1,
    exchange_rate_operation_buy_usd: 1,
    exchange_rate_operation_sell_usd: 1,

    financing_buy_annual_rate: 0,
    financing_sell_annual_rate: 0,
    financing_term_months: 0,
    financing_surcharge_rate: 0.1,

    // tablas
    items: [emptyItem(1), emptyItem(2), emptyItem(3), emptyItem(4)],
    install_items: Array.from({ length: 10 }, (_, i) => emptyInstall(i + 1)),
    customs_lines: defaultCustomsLines(),
  }));

  const [computed, setComputed] = useState(null);
  const [error, setError] = useState("");
  const [revisions, setRevisions] = useState([]); // [{id,name,created_at}]
  const [selectedRevisionId, setSelectedRevisionId] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [budgetStatus, setBudgetStatus] = useState("borrador"); // borrador | confirmado
  const isAdmin = user?.role === "admin" || (Array.isArray(user?.roles) && user.roles.includes("admin"));
  const isLocked = budgetStatus === "confirmado";

  async function refreshBudgetStatus(orgIdToUse) {
    const oid = orgIdToUse || orgId;
    if (!oid) return;
    try {
      const { data } = await api.get(`/organizations/${oid}`);
      if (data?.budget_status) setBudgetStatus(data.budget_status);
    } catch (e) {
      console.warn("No se pudo obtener budget_status de la organización", e);
    }
  }

  const fetchRevisions = async (qid) => {
    if (!qid) return;
    try {
      const { data } = await api.get(`/quotes/${qid}/revisions`);
      setRevisions(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("No se pudieron cargar revisiones", e);
      setRevisions([]);
    }
  };

  function applyLoadedData(data, dealData = null) {
    setQuoteId(data?.id ?? null);
    if (data?.deal_id != null) setDealId(data.deal_id);
    if (dealData?.org_id) setOrgId(dealData.org_id);
    if (dealData?.org_budget_status) setBudgetStatus(dealData.org_budget_status);

    setInputs((prev) => ({
      ...prev,
      ...(data?.inputs || {}),
      client_name:
        (data?.inputs?.client_name || "").trim() ||
        (dealData?.org_name || "").trim() ||
        prev.client_name,
      ref_code:
        (data?.inputs?.ref_code || "").trim() ||
        (dealData?.reference || "").trim() ||
        prev.ref_code,
      items:
        Array.isArray(data?.inputs?.items) && data.inputs.items.length
          ? data.inputs.items
          : prev.items,
      install_items:
        Array.isArray(data?.inputs?.install_items) && data.inputs.install_items.length
          ? data.inputs.install_items
          : prev.install_items,
      customs_lines:
        Array.isArray(data?.inputs?.customs_lines) && data.inputs.customs_lines.length
          ? data.inputs.customs_lines
          : prev.customs_lines,
    }));

    setSelectedRevisionId(data?.meta?.revision_id || null);
    setComputed(data?.computed || null);
  }

  async function loadQuoteById(quoteIdToLoad, revisionId = null) {
    const { data } = await api.get(`/quotes/${quoteIdToLoad}`, {
      params: revisionId ? { revision_id: revisionId } : {},
    });

    let dealData = null;
    if (data?.deal_id) {
      try {
        const { data: dealRes } = await api.get(`/deals/${data.deal_id}`);
        dealData = dealRes?.deal || null;
      } catch (_) {
        dealData = null;
      }
    }

    applyLoadedData(data, dealData);
    if (dealData?.org_id) {
      refreshBudgetStatus(dealData.org_id);
    }
    if (data?.id) fetchRevisions(data.id);
    return data;
  }

  async function loadOrCreateByDeal(dealIdToLoad) {
    const [quoteRes, dealRes] = await Promise.all([
      api.get(`/deals/${dealIdToLoad}/quote`),
      api.get(`/deals/${dealIdToLoad}`).catch(() => ({ data: null })),
    ]);
    const data = quoteRes.data;
    const dealData = dealRes?.data?.deal || null;

    applyLoadedData(data, dealData);
    if (dealData?.org_id) {
      refreshBudgetStatus(dealData.org_id);
    }
    if (data?.id) fetchRevisions(data.id);

    if (data?.id && String(id) !== String(data.id)) {
      navigate(`/quotes/${data.id}?dealId=${dealIdToLoad}`, { replace: true });
    }
    return data;
  }

  async function loadSmart() {
    setLoading(true);
    setError("");

    try {
      if (isNew) {
        setQuoteId(null);
        setComputed(null);
        setLoading(false);
        return;
      }

      const raw = Number(id);
      if (!Number.isFinite(raw) || raw <= 0) {
        setError("ID inválido");
        setLoading(false);
        return;
      }

      if (Number.isFinite(dealIdFromQuery) && dealIdFromQuery > 0) {
        await loadOrCreateByDeal(dealIdFromQuery);
        return;
      }

      try {
        await loadQuoteById(raw);
        return;
      } catch (e) {
        const status = e?.response?.status;
        if (status === 404) {
          await loadOrCreateByDeal(raw);
          return;
        }
        throw e;
      }
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.error || "No se pudo cargar la cotización");
    } finally {
      setLoading(false);
    }
  }

  async function createNewQuote() {
    setSaving(true);
    setError("");
    try {
      const payloadInputs = { ...inputs };
      if (dealId) payloadInputs.deal_id = dealId;

      const { data } = await api.post("/quotes", { inputs: payloadInputs });
      const newId = data?.id;
      if (!newId) throw new Error("No se recibió id");

      setQuoteId(newId);
      setComputed(data?.computed || null);
      fetchRevisions(newId);

      const qs = dealId ? `?dealId=${dealId}` : "";
      navigate(`/quotes/${newId}${qs}`, { replace: true });
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.error || "No se pudo crear la cotización");
    } finally {
      setSaving(false);
    }
  }

  async function createRevision() {
    if (!quoteId) return;
    const name = window.prompt("Nombre de la revisión:", "Rev " + new Date().toLocaleDateString());
    if (!name) return;
    try {
      const { data } = await api.post(`/quotes/${quoteId}/revisions`, { name });
      const list = data?.revisions || [];
      setRevisions(Array.isArray(list) ? list : []);
      setSelectedRevisionId(data?.id || null);
      await loadQuoteById(quoteId, data?.id || null);
    } catch (e) {
      alert("No se pudo crear la revisión.");
    }
  }

  async function confirmBudget() {
    if (!orgId) return alert("Sin organización vinculada.");
    try {
      await api.post(`/organizations/${orgId}/budget/confirm`);
      setBudgetStatus("confirmado");
      alert("Presupuesto confirmado.");
      refreshBudgetStatus(orgId);
    } catch {
      alert("No se pudo confirmar.");
    }
  }

  async function reopenBudget() {
    if (!orgId) return alert("Sin organización vinculada.");
    try {
      await api.post(`/organizations/${orgId}/budget/reopen`);
      setBudgetStatus("borrador");
      alert("Presupuesto reabierto.");
      refreshBudgetStatus(orgId);
    } catch {
      alert("No se pudo reabrir (solo admin).");
    }
  }

  async function saveQuote() {
    if (!quoteId) return createNewQuote();
    setSaving(true);
    setError("");
    try {
      const payloadInputs = { ...inputs };
      if (dealId) payloadInputs.deal_id = dealId;

      const { data } = await api.put(`/quotes/${quoteId}`, { inputs: payloadInputs });
      setComputed(data?.computed || null);
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.error || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function recalcQuote() {
    if (!quoteId) return;
    setSaving(true);
    setError("");
    try {
      const { data } = await api.post(`/quotes/${quoteId}/recalculate`);
      setComputed(data?.computed || null);
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.error || "No se pudo recalcular");
    } finally {
      setSaving(false);
    }
  }

  async function duplicateQuote() {
    if (!quoteId) return;
    setSaving(true);
    setError("");
    try {
      const { data } = await api.post(`/quotes/${quoteId}/duplicate`);
      const newId = data?.id;
      if (!newId) throw new Error("No se recibió id");
      navigate(`/quotes/${newId}`);
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.error || "No se pudo duplicar");
    } finally {
      setSaving(false);
    }
  }

  function exportXlsx() {
    if (!quoteId) return;
    window.open(`${api.defaults.baseURL}/quotes/${quoteId}/export-xlsx`, "_blank");
  }

  useEffect(() => {
    loadSmart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const ofertaTotals = computed?.oferta?.totals || null;
  const opTotals = computed?.operacion?.totals || null;

  const summaryCards = useMemo(() => {
    const totalSales = ofertaTotals?.total_sales_usd;
    const profitTotal = opTotals?.profit_total_usd;
    return { totalSales, profitTotal };
  }, [ofertaTotals, opTotals]);

  function setField(key, value) {
    if (isLocked) return;
    setInputs((prev) => ({ ...prev, [key]: value }));
  }

  function setItem(i, key, value) {
    if (isLocked) return;
    setInputs((prev) => {
      const items = [...(prev.items || [])];
      items[i] = { ...items[i], [key]: value };
      return { ...prev, items };
    });
  }

  function addItem() {
    if (isLocked) return;
    setInputs((prev) => {
      const items = [...(prev.items || [])];
      items.push(emptyItem(items.length + 1));
      return { ...prev, items };
    });
  }

  function removeItem(i) {
    if (isLocked) return;
    setInputs((prev) => {
      const items = [...(prev.items || [])].filter((_, idx) => idx !== i);
      const normalized = items.map((it, idx) => ({ ...it, line_no: idx + 1 }));
      return { ...prev, items: normalized.length ? normalized : [emptyItem(1)] };
    });
  }

  function setInstall(i, key, value) {
    if (isLocked) return;
    setInputs((prev) => {
      const install_items = [...(prev.install_items || [])];
      install_items[i] = { ...install_items[i], [key]: value };
      return { ...prev, install_items };
    });
  }

  function addInstall() {
    if (isLocked) return;
    setInputs((prev) => {
      const install_items = [...(prev.install_items || [])];
      install_items.push(emptyInstall(install_items.length + 1));
      return { ...prev, install_items };
    });
  }
  function addInstallMany(lines = []) {
    if (isLocked) return;
    setInputs((prev) => {
      const base = [...(prev.install_items || [])];
      const start = base.length;
      const merged = [
        ...base,
        ...lines.map((line, idx) => ({
          line_no: start + idx + 1,
          description: line.description,
          qty: 1,
          unit_cost_gs: line.unit_cost_gs,
          unit_price_gs: 0,
        })),
      ];
      return { ...prev, install_items: merged };
    });
  }

  function removeInstall(i) {
    if (isLocked) return;
    setInputs((prev) => {
      const install_items = [...(prev.install_items || [])].filter((_, idx) => idx !== i);
      const normalized = install_items.map((it, idx) => ({ ...it, line_no: idx + 1 }));
      return { ...prev, install_items: normalized.length ? normalized : [emptyInstall(1)] };
    });
  }

  function setCustomLine(i, key, value) {
    if (isLocked) return;
    setInputs((prev) => {
      const customs_lines = [...(prev.customs_lines || [])];
      customs_lines[i] = { ...customs_lines[i], [key]: value };
      return { ...prev, customs_lines };
    });
  }

  // Render
  if (loading) return <div className="text-sm text-slate-500">Cargando...</div>;

  const cifUsd = computed?.despacho?.totals?.valor_imponible_usd ?? computed?.oferta?.cif?.cif_total_usd ?? null;
  const lockClass = isLocked ? "pointer-events-none opacity-60" : "";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xl font-semibold">
            {quoteId ? `Cotización #${quoteId}` : "Nueva cotización"}
          </div>
          <div className="text-xs text-slate-500">
            Total ventas: <b>{summaryCards.totalSales != null ? fmt2(summaryCards.totalSales) : "-"}</b>{" "}
            | Profit total: <b>{summaryCards.profitTotal != null ? fmt2(summaryCards.profitTotal) : "-"}</b>
            {dealId ? (
              <>
                {" "} | Deal: <b>#{dealId}</b>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          {quoteId && (
            <>
              <select
                className="px-3 py-2 rounded-lg border bg-white text-sm"
                value={selectedRevisionId || ""}
                onChange={(e) => {
                  const next = e.target.value ? Number(e.target.value) : null;
                  setSelectedRevisionId(next);
                  if (quoteId) loadQuoteById(quoteId, next || null);
                }}
              >
                <option value="">Revisión actual</option>
                {revisions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({new Date(r.created_at).toLocaleDateString()})
                  </option>
                ))}
              </select>
              <button
                className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm"
                type="button"
                onClick={createRevision}
              >
                + Nueva revisión
              </button>
            </>
          )}
          {dealId && (
            <button
              className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm"
              onClick={() => navigate(`/operations/${dealId}`)}
              type="button"
            >
              ← Volver a la operación
            </button>
          )}

          <button
            className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm"
            onClick={duplicateQuote}
            disabled={!quoteId || saving}
            type="button"
          >
            Duplicar
          </button>

          <button
            className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm"
            onClick={exportXlsx}
            disabled={!quoteId}
            type="button"
          >
            Exportar Excel
          </button>

          <button
            className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm"
            onClick={recalcQuote}
            disabled={!quoteId || saving}
            type="button"
          >
            Recalcular
          </button>

          <button
            className="px-3 py-2 rounded-lg bg-blue-600 text-white hover:opacity-90 text-sm"
            onClick={saveQuote}
            disabled={saving || isLocked}
            type="button"
          >
            {quoteId ? "Guardar" : "Crear"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-xs uppercase text-slate-600">Estado: {budgetStatus}</span>
        {!isLocked && (
          <button
            className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
            type="button"
            onClick={confirmBudget}
          >
            Confirmar presupuesto
          </button>
        )}
        {isLocked && isAdmin && (
          <button
            className="px-3 py-2 rounded bg-red-600 hover:bg-red-700 text-white text-sm"
            type="button"
            onClick={reopenBudget}
          >
            Reabrir presupuesto
          </button>
        )}
        {isLocked && !isAdmin && (
          <span className="text-xs text-amber-600">Solo admin puede reabrir.</span>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Meta / Inputs globales */}
      <div className="grid grid-cols-1 lg:grid-cols-6 gap-3">
        <div className="lg:col-span-2">
          <label className="text-xs text-slate-500">Cliente</label>
          <input
            className="w-full mt-1 border rounded-lg px-3 py-2 bg-slate-100 text-slate-500 cursor-not-allowed"
            value={inputs.client_name || ""}
            readOnly
          />
        </div>

        <div>
          <label className="text-xs text-slate-500">Ref</label>
          <input
            className="w-full mt-1 border rounded-lg px-3 py-2 bg-slate-100 text-slate-500 cursor-not-allowed"
            value={inputs.ref_code || ""}
            readOnly
          />
        </div>

        <div>
          <label className="text-xs text-slate-500">Revisión</label>
          <input
            className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
            value={inputs.revision || ""}
            onChange={(e) => setField("revision", e.target.value)}
          />
        </div>

        <div>
          <label className="text-xs text-slate-500">Estado</label>
          <select
            className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
            value={inputs.status || "draft"}
            onChange={(e) => setField("status", e.target.value)}
          >
            <option value="draft">draft</option>
            <option value="sent">sent</option>
            <option value="approved">approved</option>
            <option value="rejected">rejected</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-slate-500">Rent % (sobre CIF)</label>
          <input
            type="number"
            step="0.0001"
            className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
            value={inputs.rent_rate ?? 0}
            onChange={(e) => setField("rent_rate", n2(e.target.value))}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className={`flex flex-wrap gap-2 ${lockClass}`}>
        <TabButton active={activeTab === "oferta"} onClick={() => setActiveTab("oferta")}>
          Detalle Oferta
        </TabButton>
        <TabButton active={activeTab === "despacho"} onClick={() => setActiveTab("despacho")}>
          Despacho
        </TabButton>
        <TabButton active={activeTab === "financiacion"} onClick={() => setActiveTab("financiacion")}>
          Financiación
        </TabButton>
        <TabButton active={activeTab === "instalacion"} onClick={() => setActiveTab("instalacion")}>
          Instalación
        </TabButton>
        <TabButton active={activeTab === "operacion"} onClick={() => setActiveTab("operacion")}>
          Operación (Profit)
        </TabButton>
      </div>

      {/* ---------------- TAB: OFERTA ---------------- */}
      {activeTab === "oferta" && (
        <div className={`space-y-3 ${lockClass}`}>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
            <div>
              <label className="text-xs text-slate-500">Flete Intl (Venta USD)</label>
              <input
                type="number"
                step="0.01"
                className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                value={inputs.freight_international_total_usd ?? 0}
                onChange={(e) => setField("freight_international_total_usd", n2(e.target.value))}
              />
            </div>

            <div>
              <label className="text-xs text-slate-500">Flete compra USD</label>
              <input
                type="number"
                step="0.01"
                className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                value={inputs.freight_buy_usd ?? 0}
                onChange={(e) => setField("freight_buy_usd", n2(e.target.value))}
              />
            </div>

            <div>
              <label className="text-xs text-slate-500">Seguro (Venta USD)</label>
              <input
                type="number"
                step="0.01"
                className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                value={inputs.insurance_sale_total_usd ?? 0}
                onChange={(e) => setField("insurance_sale_total_usd", n2(e.target.value))}
              />
            </div>

            <div>
              <label className="text-xs text-slate-500">Seguro compra rate</label>
              <input
                type="number"
                step="0.0001"
                className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                value={inputs.insurance_buy_rate ?? 0}
                onChange={(e) => setField("insurance_buy_rate", n2(e.target.value))}
              />
            </div>

            <div>
              <label className="text-xs text-slate-500">Modo profit seguro</label>
              <select
                className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                value={inputs.insurance_profit_mode || "CORRECTED"}
                onChange={(e) => setField("insurance_profit_mode", e.target.value)}
              >
                <option value="CORRECTED">Corregido (venta - compra)</option>
                <option value="COMPAT_SIMPLE">Simple (venta)</option>
              </select>
            </div>
          </div>

<div className="overflow-auto rounded-xl border bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Descripción</th>
                  <th className="px-3 py-2">Observación</th>
                  <th className="px-3 py-2 text-right">Cant</th>
                  <th className="px-3 py-2 text-right">V. Puerta USD</th>
                  <th className="px-3 py-2 text-right">Adicional USD</th>
                  <th className="px-3 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {(inputs.items || []).map((it, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="px-3 py-2 w-20">
                      <input
                        className="w-full border rounded-lg px-2 py-1"
                        type="number"
                        value={it.line_no ?? idx + 1}
                        onChange={(e) => setItem(idx, "line_no", n2(e.target.value))}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className="w-full border rounded-lg px-2 py-1"
                        value={it.description || ""}
                        onChange={(e) => setItem(idx, "description", e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className="w-full border rounded-lg px-2 py-1"
                        placeholder="Observación / detalle"
                        value={it.observation || ""}
                        onChange={(e) => setItem(idx, "observation", e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2 w-28">
                      <input
                        className="w-full border rounded-lg px-2 py-1 text-right"
                        type="number"
                        step="0.01"
                        value={it.qty ?? 0}
                        onChange={(e) => setItem(idx, "qty", n2(e.target.value))}
                      />
                    </td>
                    <td className="px-3 py-2 w-40">
                      <input
                        className="w-full border rounded-lg px-2 py-1 text-right"
                        type="number"
                        step="0.01"
                        value={it.door_value_usd ?? 0}
                        onChange={(e) => setItem(idx, "door_value_usd", n2(e.target.value))}
                      />
                    </td>
                    <td className="px-3 py-2 w-40">
                      <input
                        className="w-full border rounded-lg px-2 py-1 text-right"
                        type="number"
                        step="0.01"
                        value={it.additional_usd ?? 0}
                        onChange={(e) => setItem(idx, "additional_usd", n2(e.target.value))}
                      />
                    </td>
                    <td className="px-3 py-2 w-28">
                      <button className="text-red-600 hover:underline" onClick={() => removeItem(idx)} type="button">
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="border-t">
                  <td className="px-3 py-2" colSpan={6}>
                    <button className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm" onClick={addItem} type="button">
                      + Agregar item
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {computed?.oferta?.items && (
            <div className="overflow-auto rounded-xl border bg-white">
              <div className="px-3 py-2 text-sm font-semibold border-b">Resultado (calculado)</div>
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-left">
                  <tr>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2">Descripción</th>
                    <th className="px-3 py-2 text-right">%Part</th>
                    <th className="px-3 py-2 text-right">Flete</th>
                    <th className="px-3 py-2 text-right">Seguro</th>
                    <th className="px-3 py-2 text-right">CIF</th>
                    <th className="px-3 py-2 text-right">Despacho</th>
                    <th className="px-3 py-2 text-right">Finan</th>
                    <th className="px-3 py-2 text-right">Instalación</th>
                    <th className="px-3 py-2 text-right">Rent</th>
                    <th className="px-3 py-2 text-right">Adicional</th>
                    <th className="px-3 py-2 text-right">Total ventas</th>
                    <th className="px-3 py-2 text-right">PV Unit</th>
                  </tr>
                </thead>


                  <tbody>
                  {computed.oferta.items.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2">{r.line_no}</td>
                      <td className="px-3 py-2">{r.description}</td>
                      <td className="px-3 py-2 text-right">{fmt2((r.participation || 0) * 100)}%</td>
                      <td className="px-3 py-2 text-right">{fmt2(r.flete)}</td>
                      <td className="px-3 py-2 text-right">{fmt2(r.seguro)}</td>
                      <td className="px-3 py-2 text-right">{fmt2(r.valor_imp)}</td>
                      <td className="px-3 py-2 text-right">{fmt2(r.despacho)}</td>
                      <td className="px-3 py-2 text-right">{fmt2(r.finan)}</td>
                      <td className="px-3 py-2 text-right">{fmt2(r.instal)}</td>
                      <td className="px-3 py-2 text-right">{fmt2(r.rent)}</td>
                      <td className="px-3 py-2 text-right">{fmt2(r.adicional)}</td>
                      <td className="px-3 py-2 text-right">{fmt2(r.total_sales)}</td>
                      <td className="px-3 py-2 text-right">{r.unit_price != null ? fmt2(r.unit_price) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
                
              </table>
              <div className="p-3 text-sm border-t bg-slate-50">
                <div>CIF total (Valor Imponible): <b>{cifUsd != null ? fmt2(cifUsd) : "-"}</b></div>
                <div>Total ventas USD: <b>{fmt2(computed.oferta.totals.total_sales_usd)}</b></div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------------- TAB: DESPACHO ---------------- */}
      {activeTab === "despacho" && (
        <div className={`space-y-3 ${lockClass}`}>
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-slate-500">TC Aduana (Gs/USD)</label>
              <input
                type="number"
                step="1"
                className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                value={inputs.exchange_rate_customs_gs_per_usd ?? 0}
                onChange={(e) => setField("exchange_rate_customs_gs_per_usd", n2(e.target.value))}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">TC Interno (Gs/USD)</label>
              <input
                type="number"
                step="1"
                className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                value={inputs.exchange_rate_customs_internal_gs_per_usd ?? 7000}
                onChange={(e) => setField("exchange_rate_customs_internal_gs_per_usd", n2(e.target.value) || 7000)}
              />
            </div>
            <div className="lg:col-span-2 text-xs text-slate-500 flex items-end">
              Valor Imponible (CIF): <b className="ml-2">{cifUsd != null ? fmt2(cifUsd) : "-"}</b>
            </div>
          </div>

<div className="overflow-auto rounded-xl border bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="px-3 py-2">On</th>
                  <th className="px-3 py-2">Concepto</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2 text-right">Monto USD</th>
                </tr>
              </thead>
              <tbody>
                {(inputs.customs_lines || []).map((l, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={l.enabled !== false}
                        onChange={(e) => setCustomLine(idx, "enabled", e.target.checked)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className="w-full border rounded-lg px-2 py-1"
                        value={l.name || ""}
                        onChange={(e) => setCustomLine(idx, "name", e.target.value)}
                        disabled // ⚠️ mejor no tocar nombres porque el engine calcula por nombre
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        className="w-28 border rounded-lg px-2 py-1 text-right"
                        type="number"
                        step="0.0001"
                        value={l.rate_decimal ?? 0}
                        onChange={(e) => setCustomLine(idx, "rate_decimal", n2(e.target.value))}
                        disabled={l.type !== "PERCENT"}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        className="w-28 border rounded-lg px-2 py-1 text-right"
                        type="number"
                        step="0.01"
                        value={l.amount_usd ?? 0}
                        onChange={(e) => setCustomLine(idx, "amount_usd", n2(e.target.value))}
                        disabled={l.type !== "FIXED_USD"}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="p-3 text-xs text-slate-500 border-t bg-slate-50">
              Nota: El cálculo del despacho sigue tus fórmulas (INDI sobre Arancel, IVA sobre base acumulada, IVA S/Honorarios sobre (Honorarios+Trámite), etc.)
            </div>
          </div>

          {computed?.despacho && (
            <div className="overflow-auto rounded-xl border bg-white">
              <div className="px-3 py-2 text-sm font-semibold border-b">Resultado (calculado)</div>
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-left">
                  <tr>
                    <th className="px-3 py-2">Concepto</th>
                    <th className="px-3 py-2 text-right">USD</th>
                    <th className="px-3 py-2 text-right">Gs</th>
                  </tr>
                </thead>
                <tbody>
                  {(computed.despacho.lines || []).map((l, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2">{l.name || "-"}</td>
                      <td className="px-3 py-2 text-right">{fmt2(l.usd)}</td>
                      <td className="px-3 py-2 text-right">{l.gs != null ? Number(l.gs).toLocaleString() : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="p-3 text-sm border-t bg-slate-50">
                <div>Valor Imponible (CIF) USD: <b>{fmt2(computed.despacho.totals.valor_imponible_usd)}</b></div>
                <div>USD teórico: <b>{fmt2(computed.despacho.totals.customs_total_usd_theoretical)}</b></div>
                <div>Venta despacho USD: <b>{fmt2(computed.despacho.totals.customs_total_sale_usd)}</b></div>
                <div>Diferencia TC: <b>{fmt2(computed.despacho.totals.customs_exchange_diff_usd)}</b></div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------------- TAB: FINANCIACION ---------------- */}
      {activeTab === "financiacion" && (
        <div className={`space-y-3 ${lockClass}`}>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
            <div>
              <label className="text-xs text-slate-500">Tasa compra anual</label>
              <input
                type="number"
                step="0.0001"
                className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                value={inputs.financing_buy_annual_rate ?? 0}
                onChange={(e) => setField("financing_buy_annual_rate", n2(e.target.value))}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">Tasa venta anual</label>
              <input
                type="number"
                step="0.0001"
                className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                value={inputs.financing_sell_annual_rate ?? 0}
                onChange={(e) => setField("financing_sell_annual_rate", n2(e.target.value))}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">Plazo (meses)</label>
              <input
                type="number"
                step="1"
                className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                value={inputs.financing_term_months ?? 0}
                onChange={(e) => setField("financing_term_months", n2(e.target.value))}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">Recargo (surcharge)</label>
              <input
                type="number"
                step="0.0001"
                className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                value={inputs.financing_surcharge_rate ?? 0}
                onChange={(e) => setField("financing_surcharge_rate", n2(e.target.value))}
              />
            </div>
            <div className="flex items-end text-xs text-slate-500">
              Tip: interés por plazo + recargo.
            </div>
          </div>

          {computed?.financiacion && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="rounded-xl border bg-white p-3">
                  <div className="text-sm font-semibold">Compra</div>
                  <div className="text-xs text-slate-500">Total compra USD</div>
                  <div className="text-lg font-bold">{fmt2(computed.financiacion.totals.financing_total_buy_usd)}</div>
                </div>

                <div className="rounded-xl border bg-white p-3">
                  <div className="text-sm font-semibold">Venta</div>
                  <div className="text-xs text-slate-500">Total venta USD</div>
                  <div className="text-lg font-bold">{fmt2(computed.financiacion.totals.financing_total_sale_usd)}</div>
                </div>

                <div className="rounded-xl border bg-white p-3">
                  <div className="text-sm font-semibold">Margen</div>
                  <div className="text-xs text-slate-500">Margen USD</div>
                  <div className="text-lg font-bold">{fmt2(computed.financiacion.totals.financing_margin_usd)}</div>
                </div>
              </div>

              <div className="overflow-auto rounded-xl border bg-white">
                <div className="px-3 py-2 text-sm font-semibold border-b">Detalle bases</div>
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-100 text-left">
                    <tr>
                      <th className="px-3 py-2">Base</th>
                      <th className="px-3 py-2 text-right">Monto</th>
                      <th className="px-3 py-2 text-right">Total compra</th>
                      <th className="px-3 py-2 text-right">Total venta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(computed.financiacion.bases || []).map((b, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-2">{b.key}</td>
                        <td className="px-3 py-2 text-right">{fmt2(b.base)}</td>
                        <td className="px-3 py-2 text-right">{fmt2(b.total_buy)}</td>
                        <td className="px-3 py-2 text-right">{fmt2(b.total_sell)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------------- TAB: INSTALACION ---------------- */}
      {activeTab === "instalacion" && (
        <div className={`space-y-3 ${lockClass}`}>
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-slate-500">TC Instalación (Gs/USD)</label>
              <input
                type="number"
                step="1"
                className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                value={inputs.exchange_rate_install_gs_per_usd ?? 1}
                onChange={(e) => setField("exchange_rate_install_gs_per_usd", n2(e.target.value) || 1)}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">TC Operación compra</label>
              <input
                type="number"
                step="1"
                className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                value={inputs.exchange_rate_operation_buy_usd ?? 1}
                onChange={(e) => setField("exchange_rate_operation_buy_usd", n2(e.target.value) || 1)}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">TC Operación venta</label>
              <input
                type="number"
                step="1"
                className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
              value={inputs.exchange_rate_operation_sell_usd ?? 1}
              onChange={(e) => setField("exchange_rate_operation_sell_usd", n2(e.target.value) || 1)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500">Elegir paquete de instalación</label>
            <select
              className="px-3 py-2 border rounded-lg bg-white text-sm"
              defaultValue=""
              onChange={(e) => {
                const key = e.target.value;
                if (!key) return;
                const pkg = INSTALL_PACKAGES[key];
                if (pkg?.items?.length) {
                  addInstallMany(pkg.items);
                  e.target.value = "";
                }
              }}
            >
              <option value="">-- Seleccionar --</option>
              {Object.entries(INSTALL_PACKAGES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>

          <div className="overflow-auto rounded-xl border bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Descripción</th>
                  <th className="px-3 py-2 text-right">Cant</th>
                  <th className="px-3 py-2 text-right">Costo unit Gs</th>
                  <th className="px-3 py-2 text-right">Venta unit Gs</th>
                  <th className="px-3 py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {(inputs.install_items || []).map((it, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="px-3 py-2 w-20">
                      <input
                        className="w-full border rounded-lg px-2 py-1"
                        type="number"
                        value={it.line_no ?? idx + 1}
                        onChange={(e) => setInstall(idx, "line_no", n2(e.target.value))}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className="w-full border rounded-lg px-2 py-1"
                        value={it.description || ""}
                        onChange={(e) => setInstall(idx, "description", e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2 w-28">
                      <input
                        className="w-full border rounded-lg px-2 py-1 text-right"
                        type="number"
                        step="0.01"
                        value={it.qty ?? 0}
                        onChange={(e) => setInstall(idx, "qty", n2(e.target.value))}
                      />
                    </td>
                    <td className="px-3 py-2 w-40">
                      <input
                        className="w-full border rounded-lg px-2 py-1 text-right"
                        type="number"
                        step="1"
                        value={it.unit_cost_gs ?? 0}
                        onChange={(e) => setInstall(idx, "unit_cost_gs", n2(e.target.value))}
                      />
                    </td>
                    <td className="px-3 py-2 w-40">
                      <input
                        className="w-full border rounded-lg px-2 py-1 text-right"
                        type="number"
                        step="1"
                        value={it.unit_price_gs ?? 0}
                        onChange={(e) => setInstall(idx, "unit_price_gs", n2(e.target.value))}
                      />
                    </td>
                    <td className="px-3 py-2 w-28">
                      <button className="text-red-600 hover:underline" onClick={() => removeInstall(idx)} type="button">
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="border-t">
                  <td className="px-3 py-2" colSpan={6}>
                    <button className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm" onClick={addInstall} type="button">
                      + Agregar línea
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {computed?.instalacion && (
            <div className="overflow-auto rounded-xl border bg-white">
              <div className="px-3 py-2 text-sm font-semibold border-b">Resultado (calculado)</div>
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-left">
                  <tr>
                    <th className="px-3 py-2">Descripción</th>
                    <th className="px-3 py-2 text-right">Costo Gs</th>
                    <th className="px-3 py-2 text-right">Venta Gs</th>
                    <th className="px-3 py-2 text-right">Profit Gs</th>
                    <th className="px-3 py-2 text-right">Venta USD</th>
                    <th className="px-3 py-2 text-right">Profit USD</th>
                  </tr>
                </thead>
                <tbody>
                  {(computed.instalacion.lines || []).map((l, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2">{l.description || "-"}</td>
                      <td className="px-3 py-2 text-right">{Number(l.total_cost_gs || 0).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">{Number(l.total_sale_gs || 0).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">{Number(l.profit_gs || 0).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">{fmt2(l.sale_usd)}</td>
                      <td className="px-3 py-2 text-right">{fmt2(l.profit_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="p-3 text-sm border-t bg-slate-50">
                <div>Venta USD: <b>{fmt2(computed.instalacion.totals.installation_total_sale_usd)}</b></div>
                <div>Profit USD: <b>{fmt2(computed.instalacion.totals.installation_total_profit_usd)}</b></div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------------- TAB: OPERACION ---------------- */}
      {activeTab === "operacion" && (
        <div className={`space-y-3 ${lockClass}`}>
          {computed?.operacion && (
            <div className="overflow-auto rounded-xl border bg-white">
              <div className="px-3 py-2 text-sm font-semibold border-b">Detalle operación (calculado)</div>
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-left">
                  <tr>
                    <th className="px-3 py-2">Rubro</th>
                    <th className="px-3 py-2 text-right">Compra (USD)</th>
                    <th className="px-3 py-2 text-right">Venta (USD)</th>
                    <th className="px-3 py-2 text-right">Profit (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(computed.operacion.rubros || {}).map(([k, v]) => {
                    const label =
                      String(k || "")
                        .trim()
                        .toUpperCase()
                        .replace(/^PUERTAS$/, "PRODUCTO");
                    return (
                      <tr key={k} className="border-t">
                        <td className="px-3 py-2">{label}</td>
                        <td className="px-3 py-2 text-right">{fmt2(v.compra)}</td>
                        <td className="px-3 py-2 text-right">{fmt2(v.venta)}</td>
                        <td className="px-3 py-2 text-right">{fmt2(v.profit)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="p-3 text-sm border-t bg-slate-50 space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-xs uppercase tracking-wide text-slate-600">
                    Profit vendedor (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    className="border rounded px-2 py-1 w-24 text-right"
                    value={((inputs.vendor_profit_pct ?? 0) * 100).toFixed(2)}
                    onChange={(e) =>
                      setInputs((prev) => ({
                        ...prev,
                        vendor_profit_pct: Number(e.target.value || 0) / 100,
                      }))
                    }
                  />
                </div>
                <div>Total compra: <b>{fmt2(computed.operacion.totals.total_buy_usd)}</b></div>
                <div>Total venta: <b>{fmt2(computed.operacion.totals.total_sell_usd)}</b></div>
                <div>Profit total: <b>{fmt2(computed.operacion.totals.profit_total_usd)}</b></div>
                <div className="mt-2">
                  Profit vendedor ({((inputs.vendor_profit_pct ?? 0) * 100).toFixed(2)}%): <b>{fmt2(computed.operacion.distribution.vendor_profit_usd)}</b>{" "}
                  | Profit final: <b>{fmt2(computed.operacion.distribution.final_profit_usd)}</b>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
