// client/src/pages/QuoteEditor.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams, useLocation } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth.jsx";
import { RichTextDialogField } from "../components/RichTextEditor.jsx";

function quoteRevisionSelectionStorageKey({ dealId = null, serviceCaseId = null } = {}) {
  if (Number.isFinite(Number(serviceCaseId)) && Number(serviceCaseId) > 0) {
    return `industrial-quote-revision:service:${Number(serviceCaseId)}`;
  }
  if (Number.isFinite(Number(dealId)) && Number(dealId) > 0) {
    return `industrial-quote-revision:deal:${Number(dealId)}`;
  }
  return "";
}

const emptyItem = (n = 1) => ({
  line_no: n,
  description: "",
  observation: "",
  observation_html: "",
  qty: 1,
  door_value_usd: 0,
  additional_usd: 0, // ✅ adicional por item
  sale_mode: "auto", // auto | manual
  sale_price: "",
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

function formatLocaleNumber(value, decimals = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return num.toLocaleString("es-ES", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function parseLocaleNumber(raw) {
  if (raw == null) return 0;
  const s = String(raw).trim();
  if (!s) return 0;
  const normalized = s.replace(/\./g, "").replace(",", ".");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

function NumericInput({ value, onChange, decimals = 2, className = "", placeholder = "", ...rest }) {
  const [text, setText] = useState(() =>
    value === null || value === undefined ? "" : formatLocaleNumber(value, decimals)
  );
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (editing) return;
    setText(value === null || value === undefined ? "" : formatLocaleNumber(value, decimals));
  }, [value, decimals, editing]);

  return (
    <input
      className={className}
      inputMode="decimal"
      placeholder={placeholder}
      value={text}
      {...rest}
      onFocus={() => {
        setEditing(true);
        setText(value === null || value === undefined ? "" : String(value));
      }}
      onBlur={(e) => {
        const num = parseLocaleNumber(e.target.value);
        setEditing(false);
        onChange(num);
        setText(formatLocaleNumber(num, decimals));
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        onChange(parseLocaleNumber(raw));
      }}
    />
  );
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

export default function QuoteEditor({
  embedded = false,
  quoteId: quoteIdProp = null,
  dealId: dealIdProp = null,
  serviceCaseId: serviceCaseIdProp = null,
  quoteBaseOverride = null,
  caseQuoteEndpointOverride = null,
  ignoreInvoiceLock = false,
  enableRevisions = true,
}) {
  const params = useParams();
  const location = useLocation();
  const id = params.id;
  const caseIdParam = params.caseId || params.serviceCaseId;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const isEmbedded = Boolean(embedded || quoteIdProp || dealIdProp);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("oferta");

  const dealIdFromQuery = Number(searchParams.get("dealId") || "");
  const initialDealId = dealIdProp ?? (Number.isFinite(dealIdFromQuery) ? dealIdFromQuery : null);
  const [dealId, setDealId] = useState(initialDealId);

  const serviceCaseIdFromQuery = Number(searchParams.get("serviceCaseId") || searchParams.get("caseId") || "");
  const initialServiceCaseId =
    serviceCaseIdProp ??
    (Number.isFinite(Number(caseIdParam)) ? Number(caseIdParam) : Number.isFinite(serviceCaseIdFromQuery) ? serviceCaseIdFromQuery : null);
  const [serviceCaseId, setServiceCaseId] = useState(initialServiceCaseId);
  const isServicePath = location.pathname.startsWith("/service/");
  const isService = (Number.isFinite(serviceCaseId) && serviceCaseId > 0) || isServicePath;
  const isNew = !isEmbedded && !isService && (id === undefined || id === "new");
  const quoteBase = quoteBaseOverride || (isService ? "/service/quotes" : "/quotes");

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

    org_branch_id: null,
    operation_currency: "USD",
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
  const [branches, setBranches] = useState([]);
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchFormOpen, setBranchFormOpen] = useState(false);
  const [newBranch, setNewBranch] = useState({
    name: "",
    address: "",
    city: "",
    country: "",
  });
  const [budgetStatus, setBudgetStatus] = useState("borrador"); // borrador | confirmado
  const isAdmin = user?.role === "admin" || (Array.isArray(user?.roles) && user.roles.includes("admin"));
  const [invoiceLock, setInvoiceLock] = useState({ locked: false, count: 0 });
  const [invoiceLockLoading, setInvoiceLockLoading] = useState(false);
  const invoiceLocked = Boolean(invoiceLock?.locked);
  const isLocked = (!isService && budgetStatus === "confirmado") || (invoiceLocked && !ignoreInvoiceLock);
  const lockReason = invoiceLocked ? "facturada" : (!isService && budgetStatus === "confirmado" ? "confirmado" : null);

  const opCurrency = String(inputs.operation_currency || "USD").toUpperCase();
  const opRate = Number(inputs.exchange_rate_operation_sell_usd || 1) || 1;
  const isPyg = opCurrency === "PYG" || opCurrency === "GS";
  const currencyLabel = isPyg ? "Gs" : "USD";
  const installRate = Number(inputs.exchange_rate_install_gs_per_usd || 1) || 1;
  const toOp = (usd) => (isPyg ? Number(usd || 0) * opRate : Number(usd || 0));
  const toInstal = (usd) => (isPyg ? Number(usd || 0) * installRate : Number(usd || 0));
  const fmtOp = (usd) => {
    const val = toOp(usd);
    if (!Number.isFinite(val)) return "-";
    return isPyg ? Number(val).toLocaleString(undefined, { maximumFractionDigits: 0 }) : fmt2(val);
  };
  const fmtInstal = (usd) => {
    const val = toInstal(usd);
    if (!Number.isFinite(val)) return "-";
    return isPyg ? Number(val).toLocaleString(undefined, { maximumFractionDigits: 0 }) : fmt2(val);
  };
  const fmtTotalSales = (totalUsd, instalUsd) => {
    const total = Number(totalUsd || 0);
    const inst = Number(instalUsd || 0);
    if (!Number.isFinite(total)) return "-";
    if (!isPyg) return fmt2(total);
    const baseUsd = total - inst;
    const valGs = baseUsd * opRate + inst * installRate;
    return Number(valGs).toLocaleString(undefined, { maximumFractionDigits: 0 });
  };

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

  async function refreshInvoiceLock() {
    const idToUse = isService ? serviceCaseId : dealId;
    if (!idToUse) {
      setInvoiceLock({ locked: false, count: 0 });
      return;
    }
    setInvoiceLockLoading(true);
    try {
      const { data } = await api.get("/invoices/lock-status", {
        params: isService ? { service_case_id: idToUse } : { deal_id: idToUse },
      });
      setInvoiceLock({ locked: Boolean(data?.locked), count: Number(data?.count || 0) });
    } catch (_) {
      setInvoiceLock({ locked: false, count: 0 });
    } finally {
      setInvoiceLockLoading(false);
    }
  }

  useEffect(() => {
    let live = true;
    if (!orgId) {
      setBranches([]);
      return undefined;
    }
    (async () => {
      setBranchLoading(true);
      try {
        const { data } = await api.get(`/organizations/${orgId}/branches`);
        if (live) setBranches(Array.isArray(data) ? data : []);
      } catch (_) {
        if (live) setBranches([]);
      } finally {
        if (live) setBranchLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [orgId]);

  useEffect(() => {
    refreshInvoiceLock();
  }, [isService, dealId, serviceCaseId]);

  async function createBranch() {
    if (!orgId) return;
    const payload = {
      name: newBranch.name?.trim() || null,
      address: newBranch.address?.trim() || null,
      city: newBranch.city?.trim() || null,
      country: newBranch.country?.trim() || null,
    };
    if (!payload.name && !payload.address) return;
    try {
      const { data } = await api.post(`/organizations/${orgId}/branches`, payload);
      const branch = data || null;
      if (branch) {
        setBranches((prev) => [...prev, branch]);
        setField("org_branch_id", branch.id);
      }
      setBranchFormOpen(false);
      setNewBranch({ name: "", address: "", city: "", country: "" });
    } catch (e) {
      console.error("No se pudo crear sucursal", e);
    }
  }

  const fetchRevisions = async (qid) => {
    if (!enableRevisions) {
      setRevisions([]);
      return;
    }
    if (!qid) return;
    try {
      const { data } = await api.get(`${quoteBase}/${qid}/revisions`);
      setRevisions(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("No se pudieron cargar revisiones", e);
      setRevisions([]);
    }
  };

  function applyLoadedData(data, dealData = null, serviceCaseData = null) {
    setQuoteId(data?.id ?? null);
    if (data?.deal_id != null) setDealId(data.deal_id);
    if (data?.service_case_id != null) setServiceCaseId(data.service_case_id);

    const ctx = serviceCaseData || dealData || null;
    if (ctx?.org_id) setOrgId(ctx.org_id);
    if (ctx?.org_budget_status) setBudgetStatus(ctx.org_budget_status);
    const branchIdFromCtx = ctx?.org_branch_id ?? null;

    setInputs((prev) => ({
      ...prev,
      ...(data?.inputs || {}),
      org_branch_id:
        data?.inputs?.org_branch_id ??
        branchIdFromCtx ??
        prev.org_branch_id ??
        null,
      client_name:
        (data?.inputs?.client_name || "").trim() ||
        (serviceCaseData?.org_name || dealData?.org_name || "").trim() ||
        prev.client_name,
      ref_code:
        (data?.inputs?.ref_code || "").trim() ||
        (serviceCaseData?.reference || dealData?.reference || "").trim() ||
        prev.ref_code,
      items:
        Array.isArray(data?.inputs?.items) && data.inputs.items.length
          ? data.inputs.items.map((it) => ({
              ...it,
              sale_mode: it?.sale_mode || "auto",
              sale_price:
                it?.sale_price === null || it?.sale_price === undefined
                  ? ""
                  : it.sale_price,
            }))
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
    const { data } = await api.get(`${quoteBase}/${quoteIdToLoad}`, {
      params: revisionId ? { revision_id: revisionId } : {},
    });

    let dealData = null;
    let serviceCaseData = null;
    if (isService) {
      const caseId = data?.service_case_id;
      if (caseId) {
        try {
          const { data: caseRes } = await api.get(`/service/cases/${caseId}`);
          serviceCaseData = caseRes?.case || caseRes?.data || caseRes || null;
        } catch (_) {
          serviceCaseData = null;
        }
      }
    } else if (data?.deal_id) {
      try {
        const { data: dealRes } = await api.get(`/deals/${data.deal_id}`);
        dealData = dealRes?.deal || null;
      } catch (_) {
        dealData = null;
      }
    }

    applyLoadedData(data, dealData, serviceCaseData);
    const orgSource = serviceCaseData || dealData;
    if (orgSource?.org_id) {
      refreshBudgetStatus(orgSource.org_id);
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

    if (!isEmbedded && data?.id && String(id) !== String(data.id)) {
      navigate(`/quotes/${data.id}?dealId=${dealIdToLoad}`, { replace: true });
    }
    return data;
  }

  async function loadSmart() {
    setLoading(true);
    setError("");

    try {
      if (isService) {
        if (isEmbedded && Number.isFinite(quoteIdProp) && quoteIdProp > 0) {
          await loadQuoteById(quoteIdProp);
          return;
        }
        if (isEmbedded && Number.isFinite(serviceCaseIdProp) && serviceCaseIdProp > 0) {
          await loadOrCreateByCase(serviceCaseIdProp);
          return;
        }

        const rawQuoteId = Number(id);
        if (Number.isFinite(rawQuoteId) && rawQuoteId > 0) {
          await loadQuoteById(rawQuoteId);
          return;
        }
        if (Number.isFinite(serviceCaseId) && serviceCaseId > 0) {
          await loadOrCreateByCase(serviceCaseId);
          return;
        }

        setError("CaseId invalido");
        setLoading(false);
        return;
      }

      if (isNew) {
        setQuoteId(null);
        setComputed(null);
        setLoading(false);
        return;
      }
      if (isEmbedded && Number.isFinite(quoteIdProp) && quoteIdProp > 0) {
        await loadQuoteById(quoteIdProp);
        return;
      }

      if (isEmbedded && Number.isFinite(dealIdProp) && dealIdProp > 0) {
        await loadOrCreateByDeal(dealIdProp);
        return;
      }

      const raw = Number(id);
      if (!Number.isFinite(raw) || raw <= 0) {
        setError("ID inv?lido");
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
  
  async function loadOrCreateByCase(caseIdToLoad) {
    const [quoteRes, caseRes] = await Promise.all([
      api.get(caseQuoteEndpointOverride || `/service/cases/${caseIdToLoad}/quote`),
      api.get(`/service/cases/${caseIdToLoad}`).catch(() => ({ data: null })),
    ]);
    const data = quoteRes.data;
    const caseData = caseRes?.data?.case || caseRes?.data || caseRes || null;

    applyLoadedData(data, null, caseData);
    if (caseData?.org_id) {
      refreshBudgetStatus(caseData.org_id);
    }
    if (data?.id) fetchRevisions(data.id);

    if (!isEmbedded && data?.id && String(id) !== String(data.id)) {
      navigate(`/service/quotes/${data.id}?caseId=${caseIdToLoad}`, { replace: true });
    }
    return data;
  }
}

  async function createNewQuote() {
    setSaving(true);
    setError("");
    try {
      const payloadInputs = { ...inputs };
      if (Array.isArray(payloadInputs.items)) {
        payloadInputs.items = payloadInputs.items.map((it) => ({
          ...it,
          sale_mode: it.sale_mode || "auto",
          sale_price: it.sale_price === "" ? null : it.sale_price,
          tax_rate: Number(it.tax_rate ?? 10),
        }));
      }
      if (dealId) payloadInputs.deal_id = dealId;
      if (isService && serviceCaseId) payloadInputs.service_case_id = serviceCaseId;

      const { data } = await api.post(quoteBase, { inputs: payloadInputs });
      const newId = data?.id;
      if (!newId) throw new Error("No se recibió id");

      setQuoteId(newId);
      setComputed(data?.computed || null);
      fetchRevisions(newId);

      const qs = isService ? `?caseId=${serviceCaseId}` : dealId ? `?dealId=${dealId}` : "";
      const basePath = isService ? "/service/quotes" : "/quotes";
      navigate(`${basePath}/${newId}${qs}`, { replace: true });
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.error || "No se pudo crear la cotización");
    } finally {
      setSaving(false);
    }
  }

  async function createRevision() {
    if (!enableRevisions) return;
    if (isLocked) return;
    if (!quoteId) return;
    const nextSeq = String((revisions?.length || 0) + 1).padStart(2, "0");
    const now = new Date();
    const stamp = now.toLocaleString("es-PY", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const name = window.prompt("Nombre de la revisión:", `REV ${nextSeq} - ${stamp}`);
    if (!name) return;
    try {
      const { data } = await api.post(`${quoteBase}/${quoteId}/revisions`, { name });
      const list = data?.revisions || [];
      setRevisions(Array.isArray(list) ? list : []);
      setSelectedRevisionId(data?.id || null);
      await loadQuoteById(quoteId, data?.id || null);
      try {
        window.dispatchEvent(new CustomEvent("quote-revision-created", { detail: { quoteId } }));
      } catch (_) {}
    } catch (e) {
      alert("No se pudo crear la revisión.");
    }
  }

  async function confirmBudget() {
    if (invoiceLocked) return;
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
    if (isLocked) return;
    if (!quoteId) return createNewQuote();
    setSaving(true);
    setError("");
    try {
      const payloadInputs = { ...inputs };
      if (Array.isArray(payloadInputs.items)) {
        payloadInputs.items = payloadInputs.items.map((it) => ({
          ...it,
          sale_mode: it.sale_mode || "auto",
          sale_price: it.sale_price === "" ? null : it.sale_price,
          tax_rate: Number(it.tax_rate ?? 10),
        }));
      }
      if (dealId) payloadInputs.deal_id = dealId;
      if (isService && serviceCaseId) payloadInputs.service_case_id = serviceCaseId;

      const { data } = selectedRevisionId
        ? await api.put(`${quoteBase}/${quoteId}/revisions/${selectedRevisionId}`, { inputs: payloadInputs })
        : await api.put(`${quoteBase}/${quoteId}`, { inputs: payloadInputs });
      setComputed(data?.computed || null);
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.error || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function recalcQuote() {
    if (isLocked) return;
    if (!quoteId) return;
    setSaving(true);
    setError("");
    try {
      if (selectedRevisionId) {
        await saveQuote();
      } else {
        const { data } = await api.post(`${quoteBase}/${quoteId}/recalculate`);
        setComputed(data?.computed || null);
      }
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.error || "No se pudo recalcular");
    } finally {
      setSaving(false);
    }
  }

  async function duplicateQuote() {
    if (isLocked) return;
    if (!quoteId) return;
    setSaving(true);
    setError("");
    try {
      const { data } = await api.post(`${quoteBase}/${quoteId}/duplicate`);
      const newId = data?.id;
      if (!newId) throw new Error("No se recibió id");
      navigate(`${isService ? "/service/quotes" : "/quotes"}/${newId}`);
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.error || "No se pudo duplicar");
    } finally {
      setSaving(false);
    }
  }

  function exportXlsx() {
    if (!quoteId) return;
    window.open(`${api.defaults.baseURL}${quoteBase}/${quoteId}/export-xlsx`, "_blank");
  }

  useEffect(() => {
    loadSmart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, quoteIdProp, dealIdProp, serviceCaseId, serviceCaseIdProp]);

  useEffect(() => {
    const storageKey = quoteRevisionSelectionStorageKey({ dealId, serviceCaseId });
    if (!storageKey) return;

    try {
      if (selectedRevisionId) {
        window.sessionStorage.setItem(storageKey, String(selectedRevisionId));
      } else {
        window.sessionStorage.removeItem(storageKey);
      }
    } catch (_) {}

    try {
      window.dispatchEvent(
        new CustomEvent("quote-revision-selected", {
          detail: {
            quoteId,
            dealId,
            serviceCaseId,
            revisionId: selectedRevisionId || null,
          },
        })
      );
    } catch (_) {}
  }, [selectedRevisionId, quoteId, dealId, serviceCaseId]);

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
      const next = { ...items[i], [key]: value };
      if (key === "sale_mode" && value === "auto") {
        next.sale_price = "";
      }
      items[i] = next;
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
          Total ventas {currencyLabel}: <b>{summaryCards.totalSales != null ? fmtOp(summaryCards.totalSales) : "-"}</b>{" "}
          | Profit total {currencyLabel}: <b>{summaryCards.profitTotal != null ? fmtOp(summaryCards.profitTotal) : "-"}</b>
            {dealId ? (
              <>
                {" "} | Deal: <b>#{dealId}</b>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          {quoteId && enableRevisions && (
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
                disabled={isLocked}
              >
                + Nueva revisión
              </button>
            </>
          )}
          {selectedRevisionId && (
            <span className="text-xs text-slate-600">
              Estás editando la revisión seleccionada.
            </span>
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
            disabled={!quoteId || saving || isLocked}
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
            {quoteId ? (selectedRevisionId ? "Guardar revisión" : "Guardar") : "Crear"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-xs uppercase text-slate-600">Estado: {budgetStatus}</span>
        {!isLocked && !invoiceLocked && (
          <button
            className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
            type="button"
            onClick={confirmBudget}
          >
            Confirmar presupuesto
          </button>
        )}
        {isLocked && !invoiceLocked && isAdmin && (
          <button
            className="px-3 py-2 rounded bg-red-600 hover:bg-red-700 text-white text-sm"
            type="button"
            onClick={reopenBudget}
          >
            Reabrir presupuesto
          </button>
        )}
        {isLocked && !invoiceLocked && !isAdmin && (
          <span className="text-xs text-amber-600">Solo admin puede reabrir.</span>
        )}
        {invoiceLocked && (
          <span className="text-xs text-amber-700">
            Bloqueado por factura emitida ({invoiceLock?.count || 0}).
          </span>
        )}
        {invoiceLockLoading && (
          <span className="text-xs text-slate-500">Verificando facturas...</span>
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
              <label className="text-xs text-slate-500">Flete Intl (Venta {currencyLabel})</label>
              <NumericInput
                className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                value={inputs.freight_international_total_usd ?? 0}
                onChange={(v) => setField("freight_international_total_usd", v)}
              />
            </div>

            <div>
              <label className="text-xs text-slate-500">Flete compra {currencyLabel}</label>
              <NumericInput
                className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                value={inputs.freight_buy_usd ?? 0}
                onChange={(v) => setField("freight_buy_usd", v)}
              />
            </div>

            <div>
              <label className="text-xs text-slate-500">Seguro (Venta {currencyLabel})</label>
              <NumericInput
                className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                value={inputs.insurance_sale_total_usd ?? 0}
                onChange={(v) => setField("insurance_sale_total_usd", v)}
              />
            </div>

            <div>
              <label className="text-xs text-slate-500">Moneda de operación</label>
              <select
                className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                value={opCurrency}
                onChange={(e) => setField("operation_currency", e.target.value)}
              >
                <option value="USD">USD</option>
                <option value="PYG">PYG</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-slate-500">Seguro compra rate</label>
              <NumericInput
                className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                value={inputs.insurance_buy_rate ?? 0}
                onChange={(v) => setField("insurance_buy_rate", v)}
                decimals={4}
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="text-xs text-slate-500">Sucursal de facturación</label>
              <select
                className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                value={inputs.org_branch_id || ""}
                onChange={(e) =>
                  setField("org_branch_id", e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">— Dirección principal —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name || b.address || `Sucursal ${b.id}`}
                  </option>
                ))}
              </select>
              {!!inputs.org_branch_id && (
                <div className="text-xs text-slate-500 mt-1">
                  {branches.find((b) => b.id === Number(inputs.org_branch_id))?.address || ""}
                </div>
              )}
            </div>
            <div className="flex items-end">
              <button
                type="button"
                className="w-full px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm"
                onClick={() => setBranchFormOpen((v) => !v)}
                disabled={!orgId}
              >
                {branchFormOpen ? "Cerrar" : "Agregar sucursal"}
              </button>
            </div>
          </div>

          {branchFormOpen && (
            <div className="bg-slate-50 border rounded-xl p-3">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-slate-500">Nombre</label>
                  <input
                    className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                    value={newBranch.name}
                    onChange={(e) => setNewBranch((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs text-slate-500">Dirección</label>
                  <input
                    className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                    value={newBranch.address}
                    onChange={(e) => setNewBranch((prev) => ({ ...prev, address: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500">Ciudad</label>
                  <input
                    className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                    value={newBranch.city}
                    onChange={(e) => setNewBranch((prev) => ({ ...prev, city: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500">País</label>
                  <input
                    className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                    value={newBranch.country}
                    onChange={(e) => setNewBranch((prev) => ({ ...prev, country: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg bg-black text-white text-sm"
                  onClick={createBranch}
                  disabled={branchLoading}
                >
                  Guardar sucursal
                </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border bg-white text-sm"
                  onClick={() => setBranchFormOpen(false)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

<div className="overflow-auto rounded-xl border bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Descripción</th>
                  <th className="px-3 py-2">Observación</th>
                  <th className="px-3 py-2 text-right">Cant</th>
                  <th className="px-3 py-2 text-right">IVA</th>
                  <th className="px-3 py-2 text-right">Costo item ({currencyLabel})</th>
                  <th className="px-3 py-2 text-right">Adicional ({currencyLabel})</th>
                  <th className="px-3 py-2 text-right">Venta ({currencyLabel})</th>
                  <th className="px-3 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {(inputs.items || []).map((it, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="px-3 py-2 w-20">
                      <NumericInput
                        className="w-full border rounded-lg px-2 py-1"
                        value={it.line_no ?? idx + 1}
                        onChange={(v) => setItem(idx, "line_no", v)}
                        decimals={0}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className="w-full border rounded-lg px-2 py-1"
                        value={it.description || ""}
                        onChange={(e) => setItem(idx, "description", e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2 w-[240px]">
                      <RichTextDialogField
                        value={it.observation_html || it.observation || ""}
                        placeholder="Observación / detalle con formato"
                        dialogTitle={`Observación del item ${it.line_no ?? idx + 1}`}
                        minHeightClass="min-h-[220px]"
                        widthClass="w-[220px] max-w-[220px]"
                        onChange={({ html, text }) => {
                          setInputs((prev) => {
                            const items = [...(prev.items || [])];
                            items[idx] = {
                              ...items[idx],
                              observation_html: html,
                              observation: text,
                            };
                            return { ...prev, items };
                          });
                        }}
                      />
                    </td>
                    <td className="px-3 py-2 w-28">
                      <NumericInput
                        className="w-full border rounded-lg px-2 py-1 text-right"
                        value={it.qty ?? 0}
                        onChange={(v) => setItem(idx, "qty", v)}
                        decimals={2}
                      />
                    </td>
                    <td className="px-3 py-2 w-28">
                      <select
                        className="w-full border rounded-lg px-2 py-1"
                        value={it.tax_rate ?? 10}
                        onChange={(e) => setItem(idx, "tax_rate", n2(e.target.value))}
                      >
                        <option value={0}>Exenta</option>
                        <option value={5}>5%</option>
                        <option value={10}>10%</option>
                      </select>
                    </td>
                    <td className="px-3 py-2 w-40">
                      <NumericInput
                        className="w-full border rounded-lg px-2 py-1 text-right"
                        value={it.door_value_usd ?? 0}
                        onChange={(v) => setItem(idx, "door_value_usd", v)}
                      />
                    </td>
                    <td className="px-3 py-2 w-40">
                      <NumericInput
                        className="w-full border rounded-lg px-2 py-1 text-right"
                        value={it.additional_usd ?? 0}
                        onChange={(v) => setItem(idx, "additional_usd", v)}
                      />
                    </td>
                    <td className="px-3 py-2 w-44">
                      <div className="flex flex-col gap-1">
                        <select
                          className="w-full border rounded-lg px-2 py-1 text-xs"
                          value={it.sale_mode || "auto"}
                          onChange={(e) => setItem(idx, "sale_mode", e.target.value)}
                        >
                          <option value="auto">Automático</option>
                          <option value="manual">Manual</option>
                        </select>
                        <NumericInput
                          className="w-full border rounded-lg px-2 py-1 text-right"
                          value={it.sale_price ?? 0}
                          onChange={(v) => setItem(idx, "sale_price", v)}
                          placeholder={it.sale_mode === "manual" ? "Precio venta" : "Auto"}
                          disabled={it.sale_mode !== "manual"}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 w-28">
                      <button className="text-red-600 hover:underline" onClick={() => removeItem(idx)} type="button">
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="border-t">
                  <td className="px-3 py-2" colSpan={7}>
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
                      <td className="px-3 py-2 text-right">{fmtOp(r.flete)}</td>
                      <td className="px-3 py-2 text-right">{fmtOp(r.seguro)}</td>
                      <td className="px-3 py-2 text-right">{fmtOp(r.valor_imp)}</td>
                      <td className="px-3 py-2 text-right">{fmtOp(r.despacho)}</td>
                      <td className="px-3 py-2 text-right">{fmtOp(r.finan)}</td>
                      <td className="px-3 py-2 text-right">{fmtInstal(r.instal)}</td>
                      <td className="px-3 py-2 text-right">{fmtOp(r.rent)}</td>
                      <td className="px-3 py-2 text-right">{fmtOp(r.adicional)}</td>
                      <td className="px-3 py-2 text-right">{fmtTotalSales(r.total_sales, r.instal)}</td>
                      <td className="px-3 py-2 text-right">{r.unit_price != null ? fmtOp(r.unit_price) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
                
              </table>
              <div className="p-3 text-sm border-t bg-slate-50">
                <div>CIF total (Valor Imponible): <b>{cifUsd != null ? fmtOp(cifUsd) : "-"}</b></div>
                <div>
                  Total ventas {currencyLabel}:{" "}
                  <b>{fmtTotalSales(computed.oferta.totals.total_sales_usd, computed.oferta.totals.total_instal_usd)}</b>
                </div>
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
                onChange={(e) => setField("exchange_rate_customs_internal_gs_per_usd", n2(e.target.value))}
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
              <NumericInput
                className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                value={inputs.exchange_rate_install_gs_per_usd ?? 1}
                onChange={(v) => setField("exchange_rate_install_gs_per_usd", v || 1)}
                decimals={0}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">TC Operación compra (Gs/USD)</label>
              <NumericInput
                className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                value={inputs.exchange_rate_operation_buy_usd ?? 1}
                onChange={(v) => setField("exchange_rate_operation_buy_usd", v || 1)}
                decimals={0}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">TC Operación venta (Gs/USD)</label>
              <NumericInput
                className="w-full mt-1 border rounded-lg px-3 py-2 bg-white"
                value={inputs.exchange_rate_operation_sell_usd ?? 1}
                onChange={(v) => setField("exchange_rate_operation_sell_usd", v || 1)}
                decimals={0}
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
                      <NumericInput
                        className="w-full border rounded-lg px-2 py-1"
                        value={it.line_no ?? idx + 1}
                        onChange={(v) => setInstall(idx, "line_no", v)}
                        decimals={0}
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
                      <NumericInput
                        className="w-full border rounded-lg px-2 py-1 text-right"
                        value={it.qty ?? 0}
                        onChange={(v) => setInstall(idx, "qty", v)}
                        decimals={2}
                      />
                    </td>
                    <td className="px-3 py-2 w-40">
                      <NumericInput
                        className="w-full border rounded-lg px-2 py-1 text-right"
                        value={it.unit_cost_gs ?? 0}
                        onChange={(v) => setInstall(idx, "unit_cost_gs", v)}
                        decimals={0}
                      />
                    </td>
                    <td className="px-3 py-2 w-40">
                      <NumericInput
                        className="w-full border rounded-lg px-2 py-1 text-right"
                        value={it.unit_price_gs ?? 0}
                        onChange={(v) => setInstall(idx, "unit_price_gs", v)}
                        decimals={0}
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
                  <tfoot className="bg-slate-50">
                    <tr className="border-t">
                      <td className="px-3 py-2 font-semibold">Total</td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {Number(computed.instalacion.totals.installation_total_cost_gs || 0).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {Number(computed.instalacion.totals.installation_total_sale_gs || 0).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {Number(computed.instalacion.totals.installation_total_profit_gs || 0).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {fmt2(computed.instalacion.totals.installation_total_sale_usd)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {fmt2(computed.instalacion.totals.installation_total_profit_usd)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
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
                    <th className="px-3 py-2 text-right">Compra ({currencyLabel})</th>
                    <th className="px-3 py-2 text-right">Venta ({currencyLabel})</th>
                    <th className="px-3 py-2 text-right">Profit ({currencyLabel})</th>
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
                        <td className="px-3 py-2 text-right">{fmtOp(v.compra)}</td>
                        <td className="px-3 py-2 text-right">{fmtOp(v.venta)}</td>
                        <td className="px-3 py-2 text-right">{fmtOp(v.profit)}</td>
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
                  <select
                    className="border rounded px-2 py-1 w-28"
                    value={String(((inputs.vendor_profit_pct ?? 0) * 100).toFixed(0))}
                    onChange={(e) =>
                      setInputs((prev) => ({
                        ...prev,
                        vendor_profit_pct: Number(e.target.value || 0) / 100,
                      }))
                    }
                  >
                    <option value="30">30%</option>
                    <option value="25">25%</option>
                    <option value="20">20%</option>
                    <option value="15">15%</option>
                    <option value="10">10%</option>
                  </select>
                </div>
                <div>Total compra {currencyLabel}: <b>{fmtOp(computed.operacion.totals.total_buy_usd)}</b></div>
                <div>Total venta {currencyLabel}: <b>{fmtOp(computed.operacion.totals.total_sell_usd)}</b></div>
                <div>Profit total {currencyLabel}: <b>{fmtOp(computed.operacion.totals.profit_total_usd)}</b></div>
                <div className="mt-2">
                  Profit vendedor ({((inputs.vendor_profit_pct ?? 0) * 100).toFixed(2)}%): <b>{fmtOp(computed.operacion.distribution.vendor_profit_usd)}</b>{" "}
                  | Profit final: <b>{fmtOp(computed.operacion.distribution.final_profit_usd)}</b>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
