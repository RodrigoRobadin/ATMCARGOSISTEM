// client/src/components/InvoiceCreateModal.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { api, fetchUsersByRole } from '../api';

const PAYMENT_PLANS = [
  { key: 'total', label: '100% del monto', installments: [100] },
  { key: '60-40', label: '60% / 40%', installments: [60, 40] },
  { key: '60-30-10', label: '60% / 30% / 10%', installments: [60, 30, 10] },
];

function toPercentNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Number(num.toFixed(2));
}

export default function InvoiceCreateModal({
  defaultDealId,
  defaultServiceCaseId,
  defaultServiceQuoteAdditionId,
  defaultContainerBillingCycleId,
  defaultContainerBillingCycle,
  defaultCostSheetVersionNumber,
  defaultQuoteRevisionId,
  defaultSelectedQuoteItems = [],
  onClose,
  onSuccess
}) {
  const [quoteCurrencyInfo, setQuoteCurrencyInfo] = useState({ currency: 'USD', exchange_rate: 1 });
  const [form, setForm] = useState({
    deal_id: defaultDealId ? String(defaultDealId) : '',
    service_case_id: defaultServiceCaseId ? String(defaultServiceCaseId) : '',
    service_quote_addition_id: defaultServiceQuoteAdditionId ? String(defaultServiceQuoteAdditionId) : '',
    container_billing_cycle_id: defaultContainerBillingCycleId ? String(defaultContainerBillingCycleId) : '',
    due_date: '',
    payment_terms: '30 dias',
    notes: '',
    payment_condition: 'credito',
    timbrado_number: '',
    timbrado_start_date: '',
    timbrado_expires_at: '',
    point_of_issue: '',
    establishment: '',
    customer_doc_type: 'RUC',
    customer_doc: '',
    customer_email: '',
    customer_address: '',
    currency_code: 'USD',
    exchange_rate: 1,
    sales_rep: '',
    purchase_order_ref: '',
    amount_plan: 'total',
    mode: 'total',
    percentage: '100',
  });
  const [saving, setSaving] = useState(false);
  const [executives, setExecutives] = useState([]);
  const [ocDocs, setOcDocs] = useState([]);
  const [dealOrg, setDealOrg] = useState(null);
  const [containerBilling, setContainerBilling] = useState(defaultContainerBillingCycle || null);
  const [suggestedNumber, setSuggestedNumber] = useState("");
  const [timbreFetched, setTimbreFetched] = useState(false);
  const [businessUnitKey, setBusinessUnitKey] = useState("");
  const [dueDateTouched, setDueDateTouched] = useState(false);
  const [currencyTouched, setCurrencyTouched] = useState(false);
  const [invoiceProgress, setInvoiceProgress] = useState({ usedPercentages: [], usedTotal: 0 });
  const [invoicePreview, setInvoicePreview] = useState({ loading: false, items: [], totals: null, error: "" });
  const hasSelectedQuoteItems = Array.isArray(defaultSelectedQuoteItems) && defaultSelectedQuoteItems.length > 0;
  const isContainerBilling = Boolean(defaultContainerBillingCycleId || form.container_billing_cycle_id);
  const isContainerInitialInvoice = !isContainerBilling && String(businessUnitKey || "").toLowerCase() === "atm-container";
  const isCreditPayment = String(form.payment_condition || '').toLowerCase() === 'credito';
  const selectedPlan = useMemo(
    () => PAYMENT_PLANS.find((plan) => plan.key === form.amount_plan) || PAYMENT_PLANS[0],
    [form.amount_plan]
  );
  const usedTotalPercentage = Number(invoiceProgress.usedTotal || 0);
  const usedPercentageSet = useMemo(() => {
    return new Set(
      (invoiceProgress.usedPercentages || [])
        .map((pct) => toPercentNumber(pct))
        .filter((pct) => pct != null)
    );
  }, [invoiceProgress.usedPercentages]);
  const planOptions = useMemo(() => {
    if (hasSelectedQuoteItems) {
      return PAYMENT_PLANS.map((plan) => ({ ...plan, availableInstallments: plan.installments }));
    }
    return PAYMENT_PLANS.map((plan) => ({
      ...plan,
      availableInstallments: plan.installments.filter((pct) => {
        const roundedPct = toPercentNumber(pct);
        return !usedPercentageSet.has(roundedPct) && usedTotalPercentage + pct <= 100.0001;
      }),
    }));
  }, [hasSelectedQuoteItems, usedPercentageSet, usedTotalPercentage]);
  const availableInstallments = useMemo(() => {
    const option = planOptions.find((plan) => plan.key === selectedPlan.key);
    return option?.availableInstallments || [];
  }, [planOptions, selectedPlan.key]);
  const containerSourceLabel = useMemo(() => {
    if (!containerBilling) return "";
    return [
      containerBilling.contract_no ? `Contrato ${containerBilling.contract_no}` : null,
      containerBilling.cycle_label ? `Ciclo ${containerBilling.cycle_label}` : null,
      containerBilling.reference || null,
    ].filter(Boolean).join(" · ");
  }, [containerBilling]);

  const normalizeCurrencyCode = (value) => {
    const code = String(value || 'USD').toUpperCase();
    return code === 'GS' ? 'PYG' : code;
  };

  const formatMoney = (value, currency = form.currency_code) => {
    const code = normalizeCurrencyCode(currency);
    const decimals = code === "PYG" ? 0 : 2;
    return `${code} ${Number(value || 0).toLocaleString("es-PY", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}`;
  };

  const splitTaxFromGross = (grossValue, taxRateValue) => {
    const gross = Number(grossValue || 0) || 0;
    const rate = Number(taxRateValue || 0) || 0;
    if (rate >= 9) {
      const tax = gross / 11;
      return { base: gross - tax, tax };
    }
    if (rate >= 4) {
      const tax = gross / 21;
      return { base: gross - tax, tax };
    }
    return { base: gross, tax: 0 };
  };

  const convertPreviewAmount = (amount, fromCurrency, toCurrency) => {
    const from = normalizeCurrencyCode(fromCurrency);
    const to = normalizeCurrencyCode(toCurrency);
    const value = Number(amount || 0) || 0;
    if (from === to) return value;
    const rate = Number(form.exchange_rate || quoteCurrencyInfo.exchange_rate || 0) || 0;
    if (from === "USD" && to === "PYG") return value * (rate || 1);
    if (from === "PYG" && to === "USD") return rate > 0 ? value / rate : 0;
    return value;
  };

  const getSuggestedExchangeRate = (info, fallback = 1) => {
    const sourceCurrency = normalizeCurrencyCode(info?.currency);
    const sourceRate = Number(info?.exchange_rate || 0) || 0;
    const fallbackRate = Number(fallback || 0) || 0;
    if (sourceCurrency === 'PYG') {
      if (sourceRate > 1) return sourceRate;
      if (fallbackRate > 1) return fallbackRate;
      return '';
    }
    if (sourceRate > 1) return sourceRate;
    if (fallbackRate > 1) return fallbackRate;
    return 1;
  };

  const requiresExchangeRate = useMemo(() => {
    const sourceCurrency = normalizeCurrencyCode(quoteCurrencyInfo.currency);
    const targetCurrency = normalizeCurrencyCode(form.currency_code);
    const currencies = new Set(['USD', 'PYG']);
    return currencies.has(sourceCurrency) && currencies.has(targetCurrency) && sourceCurrency !== targetCurrency;
  }, [form.currency_code, quoteCurrencyInfo]);

  const toISO = (val) => {
    if (!val) return "";
    // Si ya viene en formato YYYY-MM-DD lo dejamos
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(val))) return String(val);
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  };

  useEffect(() => {
    loadExecutives();
    if (defaultContainerBillingCycleId) {
      preloadContainerBillingData(defaultContainerBillingCycleId, defaultContainerBillingCycle);
    }
    if (defaultDealId) {
      preloadDealData(defaultDealId);
    }
    if (defaultServiceCaseId) {
      preloadServiceCaseData(defaultServiceCaseId);
    }
    if (defaultServiceQuoteAdditionId) {
      setForm((prev) => ({ ...prev, service_quote_addition_id: String(defaultServiceQuoteAdditionId) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultDealId, defaultServiceCaseId, defaultServiceQuoteAdditionId, defaultContainerBillingCycleId]);

  useEffect(() => {
    const dealId = defaultDealId || defaultContainerBillingCycle?.deal_id || containerBilling?.deal_id || form.deal_id || undefined;
    const serviceCaseId = defaultServiceCaseId || form.service_case_id || undefined;
    loadDefaults(dealId, serviceCaseId, businessUnitKey);
    if (defaultContainerBillingCycleId || containerBilling?.id) {
      loadContainerBillingCurrency(defaultContainerBillingCycle || containerBilling);
    } else if (dealId) {
      if (defaultCostSheetVersionNumber) {
        loadCargoCostSheetCurrency(dealId, defaultCostSheetVersionNumber);
      } else {
        loadQuoteCurrency(dealId, defaultQuoteRevisionId || null);
      }
    }
    if (defaultServiceQuoteAdditionId) {
      loadServiceAdditionQuoteCurrency(defaultServiceQuoteAdditionId);
    } else if (serviceCaseId) {
      loadServiceQuoteCurrency(serviceCaseId, defaultQuoteRevisionId || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultDealId, defaultServiceCaseId, defaultServiceQuoteAdditionId, defaultContainerBillingCycleId, defaultContainerBillingCycle, defaultCostSheetVersionNumber, defaultQuoteRevisionId, containerBilling, form.deal_id, form.service_case_id, businessUnitKey, currencyTouched]);

  useEffect(() => {
    if (!isContainerInitialInvoice) return;
    setForm((prev) => ({
      ...prev,
      amount_plan: "total",
      mode: "total",
      percentage: "100",
      notes: prev.notes || "Factura inicial ATM CONTAINER. Incluye el primer mes de alquiler.",
    }));
  }, [isContainerInitialInvoice]);

  useEffect(() => {
    if (!defaultDealId && !defaultServiceCaseId) return;
    loadInvoiceProgress(defaultDealId, defaultServiceCaseId, defaultCostSheetVersionNumber, defaultQuoteRevisionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultDealId, defaultServiceCaseId, defaultCostSheetVersionNumber, defaultQuoteRevisionId]);

  useEffect(() => {
    if (isCreditPayment) return;
    setDueDateTouched(false);
    setForm((prev) => ({
      ...prev,
      due_date: '',
      payment_terms: '',
    }));
  }, [isCreditPayment]);

  useEffect(() => {
    if (isContainerBilling || isContainerInitialInvoice || hasSelectedQuoteItems) return;
    if (availableInstallments.length === 0) {
      const fallbackPlan = planOptions.find((plan) => plan.availableInstallments.length > 0);
      if (fallbackPlan && fallbackPlan.key !== form.amount_plan) {
        setForm((prev) => ({
          ...prev,
          amount_plan: fallbackPlan.key,
          mode: fallbackPlan.key === 'total' ? 'total' : 'percentage',
          percentage: String(fallbackPlan.availableInstallments[0]),
        }));
      }
      return;
    }
    const currentPct = toPercentNumber(form.percentage);
    if (!availableInstallments.some((pct) => toPercentNumber(pct) === currentPct)) {
      setForm((prev) => ({
        ...prev,
        mode: selectedPlan.key === 'total' ? 'total' : 'percentage',
        percentage: String(availableInstallments[0]),
      }));
    }
  }, [
    availableInstallments,
    form.percentage,
    isContainerBilling,
    isContainerInitialInvoice,
    planOptions,
    form.amount_plan,
    selectedPlan.key,
  ]);

  // Recalcula vencimiento según términos de pago (días) si no fue tocado manualmente
  useEffect(() => {
    if (!isCreditPayment) return;
    const match = String(form.payment_terms || "").match(/(\d+)/);
    const days = match ? parseInt(match[1], 10) : NaN;
    if (!Number.isFinite(days)) return;

    const today = new Date();
    today.setDate(today.getDate() + days);
    const nextDue = today.toISOString().slice(0, 10);

    setForm((prev) => {
      if (dueDateTouched) return prev;
      if (prev.due_date === nextDue) return prev;
      return { ...prev, due_date: nextDue };
    });
  }, [form.payment_terms, dueDateTouched, isCreditPayment]);

  async function loadExecutives() {
    try {
      const users = await fetchUsersByRole('ejecutivo');
      setExecutives(users);
    } catch (e) {
      console.error('No se pudo cargar ejecutivos', e);
    }
  }

  async function loadInvoiceProgress(dealId, serviceCaseId, costSheetVersionNumber = null, quoteRevisionId = null) {
    try {
      const params = dealId ? { deal_id: dealId } : { service_case_id: serviceCaseId };
      const { data } = await api.get('/invoices/operation-docs', { params });
      const activeInvoices = (Array.isArray(data) ? data : []).filter(
        (doc) => doc.kind === 'invoice' && String(doc.status || '').toLowerCase() !== 'anulada'
      ).filter((doc) => {
        if (dealId && costSheetVersionNumber) {
          return Number(doc.cost_sheet_version_number || 0) === Number(costSheetVersionNumber);
        }
        if (dealId && quoteRevisionId) {
          return Number(doc.quote_revision_id || 0) === Number(quoteRevisionId);
        }
        return true;
      });
      const usedPercentages = activeInvoices
        .map((doc) => toPercentNumber(doc.percentage))
        .filter((pct) => pct != null && pct > 0);
      const usedTotal = usedPercentages.reduce((sum, pct) => sum + pct, 0);
      setInvoiceProgress({ usedPercentages, usedTotal });
    } catch (err) {
      console.warn('No se pudo cargar avance de facturacion', err?.message);
      setInvoiceProgress({ usedPercentages: [], usedTotal: 0 });
    }
  }

  function handleAmountPlanChange(planKey) {
    const plan = PAYMENT_PLANS.find((p) => p.key === planKey) || PAYMENT_PLANS[0];
    const nextAvailable = hasSelectedQuoteItems
      ? plan.installments
      : plan.installments.filter((pct) => {
          const roundedPct = toPercentNumber(pct);
          return !usedPercentageSet.has(roundedPct) && usedTotalPercentage + pct <= 100.0001;
        });
    const nextPct = nextAvailable[0] || plan.installments[0] || 100;
    setForm((prev) => ({
      ...prev,
      amount_plan: plan.key,
      mode: plan.key === 'total' ? 'total' : 'percentage',
      percentage: String(nextPct),
    }));
  }

  async function preloadDealData(dealId) {
    try {
      const { data } = await api.get(`/deals/${dealId}`);
      if (data && data.organization) {
        setDealOrg(data.organization);
        setBusinessUnitKey(data.business_unit_key || "");
        setForm((prev) => ({
          ...prev,
          customer_doc: prev.customer_doc || data.organization.ruc || '',
          customer_doc_type: prev.customer_doc_type || 'RUC',
          customer_email: prev.customer_email || data.organization.email || '',
          customer_address:
            prev.customer_address ||
            data.organization.branch?.address ||
            data.organization.address ||
            '',
        }));
      }
      // cargar documentos OC de la operación
      try {
        const { data: docs } = await api.get(`/deals/${dealId}/documents`, { params: { type: 'OC' } });
        setOcDocs(docs || []);
        if (docs && docs.length > 0) {
          setForm((prev) => ({ ...prev, purchase_order_ref: prev.purchase_order_ref || docs[0].name || '' }));
        }
      } catch (err) {
        console.warn('No se pudieron cargar documentos OC', err?.message);
      }
    } catch (err) {
      console.error('No se pudo precargar datos del deal', err);
    }
  }

  async function preloadContainerBillingData(billingCycleId, seed = null) {
    try {
      const row = seed || (await api.get(`/container/billing/${billingCycleId}`)).data;
      if (!row) return;
      setContainerBilling(row);
      setBusinessUnitKey(row.business_unit_key || "atm-container");
      setForm((prev) => ({
        ...prev,
        deal_id: prev.deal_id || String(row.deal_id || ''),
        container_billing_cycle_id: String(row.id || billingCycleId),
        due_date: prev.due_date || row.due_date || '',
        payment_terms: prev.payment_terms || 'mensual',
        notes: prev.notes || `Mensualidad ${row.cycle_label || ''}`.trim(),
        payment_condition: prev.payment_condition || 'credito',
        currency_code: prev.currency_code || row.currency_code || 'PYG',
        exchange_rate: prev.exchange_rate || 1,
        customer_doc: prev.customer_doc || row.client_ruc || '',
        customer_doc_type: prev.customer_doc_type || 'RUC',
        customer_email: prev.customer_email || row.client_email || '',
        customer_address: prev.customer_address || row.client_address || '',
        purchase_order_ref: prev.purchase_order_ref || row.contract_no || '',
      }));
    } catch (err) {
      console.error('No se pudo precargar mensualidad container', err);
    }
  }

  async function preloadServiceCaseData(serviceCaseId) {
    try {
      const { data } = await api.get(`/service/cases/${serviceCaseId}`);
      const sc = data?.case || data || null;
      if (sc?.org_id) {
        setBusinessUnitKey("atm-industrial");
        let org = null;
        try {
          const { data: orgRes } = await api.get(`/organizations/${sc.org_id}`);
          org = orgRes || null;
        } catch (_) {
          org = null;
        }
        let branchAddress = "";
        if (sc.org_branch_id) {
          try {
            const { data: branches } = await api.get(`/organizations/${sc.org_id}/branches`);
            const b = (branches || []).find((x) => String(x.id) === String(sc.org_branch_id));
            branchAddress = b?.address || "";
          } catch (_) {}
        }
        setForm((prev) => ({
          ...prev,
          customer_doc: prev.customer_doc || org?.ruc || sc.org_ruc || '',
          customer_doc_type: prev.customer_doc_type || 'RUC',
          customer_email: prev.customer_email || org?.email || '',
          customer_address: prev.customer_address || branchAddress || org?.address || '',
        }));
      }
    } catch (err) {
      console.error('No se pudo precargar datos del service case', err);
    }
  }

  async function loadQuoteCurrency(dealId, revisionId = null) {
    try {
      const { data } = await api.get(`/deals/${dealId}/quote`, {
        params: revisionId ? { revision_id: revisionId } : {},
      });
      const inputs = data?.quote?.inputs || data?.inputs || {};
      const curr = String(inputs.operation_currency || 'USD').toUpperCase();
      const rate = Number(
        inputs.exchange_rate_atm_gs_per_usd ||
        inputs.exchange_rate_operation_sell_usd ||
        inputs.exchange_rate_customs_internal_gs_per_usd ||
        inputs.exchange_rate_install_gs_per_usd ||
        1
      ) || 1;
      setQuoteCurrencyInfo({ currency: curr || 'USD', exchange_rate: rate || 1 });
      setForm((prev) => {
        if (currencyTouched) return prev;
        const suggestedRate = getSuggestedExchangeRate({ currency: curr, exchange_rate: rate }, prev.exchange_rate);
        return {
          ...prev,
          currency_code: curr || prev.currency_code,
          exchange_rate: suggestedRate === '' ? prev.exchange_rate : suggestedRate,
        };
      });
    } catch (err) {
      console.warn('No se pudo cargar moneda desde cotizacion', err?.message);
    }
  }

  async function loadCargoCostSheetCurrency(dealId, versionNumber) {
    try {
      const { data } = await api.get(`/deals/${dealId}/cost-sheet/versions/${versionNumber}`);
      const header = data?.data?.header || {};
      const curr = String(header.operationCurrency || header.currency || 'USD').toUpperCase();
      const rate = curr === 'PYG' || curr === 'GS' ? Number(header.gsRate || 1) || 1 : 1;
      setQuoteCurrencyInfo({ currency: curr || 'USD', exchange_rate: rate || 1 });
      setForm((prev) => {
        if (currencyTouched) return prev;
        const suggestedRate = getSuggestedExchangeRate({ currency: curr, exchange_rate: rate }, prev.exchange_rate);
        return {
          ...prev,
          currency_code: curr || prev.currency_code,
          exchange_rate: suggestedRate === '' ? prev.exchange_rate : suggestedRate,
        };
      });
    } catch (err) {
      console.warn('No se pudo cargar moneda desde revision de planilla', err?.message);
      loadQuoteCurrency(dealId);
    }
  }

  async function loadServiceQuoteCurrency(serviceCaseId, revisionId = null) {
    try {
      if (revisionId) {
        const { data: items } = await api.get('/invoices/billable-items', {
          params: { service_case_id: serviceCaseId, quote_revision_id: revisionId },
        });
        const firstCurrency = Array.isArray(items) ? items.find((item) => item?.currency_code)?.currency_code : null;
        if (firstCurrency) {
          const curr = normalizeCurrencyCode(firstCurrency);
          setQuoteCurrencyInfo({ currency: curr, exchange_rate: Number(form.exchange_rate || 1) || 1 });
          setForm((prev) => {
            if (currencyTouched) return prev;
            return { ...prev, currency_code: curr, exchange_rate: prev.exchange_rate || 1 };
          });
          return;
        }
      }
      const { data } = await api.get(`/service/cases/${serviceCaseId}/quote`);
      const inputs = data?.inputs || {};
      const curr = String(inputs.operation_currency || 'USD').toUpperCase();
      const rate = Number(
        inputs.exchange_rate_atm_gs_per_usd ||
        inputs.exchange_rate_operation_sell_usd ||
        inputs.exchange_rate_customs_internal_gs_per_usd ||
        inputs.exchange_rate_install_gs_per_usd ||
        1
      ) || 1;
      setQuoteCurrencyInfo({ currency: curr || 'USD', exchange_rate: rate || 1 });
      setForm((prev) => {
        if (currencyTouched) return prev;
        const suggestedRate = getSuggestedExchangeRate({ currency: curr, exchange_rate: rate }, prev.exchange_rate);
        return {
          ...prev,
          currency_code: curr || prev.currency_code,
          exchange_rate: suggestedRate === '' ? prev.exchange_rate : suggestedRate,
        };
      });
    } catch (err) {
      console.warn('No se pudo cargar moneda desde service quote', err?.message);
    }
  }

  async function loadServiceAdditionQuoteCurrency(additionId) {
    try {
      const { data } = await api.get(`/service/additional-quotes/${additionId}`);
      const inputs = data?.inputs || {};
      let curr = String(inputs.operation_currency || '').toUpperCase();
      let rate = Number(
        inputs.exchange_rate_atm_gs_per_usd ||
        inputs.exchange_rate_operation_sell_usd ||
        inputs.exchange_rate_customs_internal_gs_per_usd ||
        inputs.exchange_rate_install_gs_per_usd ||
        0
      ) || 0;
      if (!curr || !rate) {
        const caseId = data?.service_case_id;
        if (caseId) {
          const base = await api.get(`/service/cases/${caseId}/quote`).catch(() => null);
          const baseInputs = base?.data?.inputs || {};
          curr = String(baseInputs.operation_currency || 'USD').toUpperCase();
          rate = Number(
            baseInputs.exchange_rate_atm_gs_per_usd ||
            baseInputs.exchange_rate_operation_sell_usd ||
            baseInputs.exchange_rate_customs_internal_gs_per_usd ||
            baseInputs.exchange_rate_install_gs_per_usd ||
            1
          ) || 1;
        }
      }
      setQuoteCurrencyInfo({ currency: curr || 'USD', exchange_rate: rate || 1 });
      setForm((prev) => {
        if (currencyTouched) return prev;
        const suggestedRate = getSuggestedExchangeRate({ currency: curr, exchange_rate: rate }, prev.exchange_rate);
        return {
          ...prev,
          currency_code: curr || prev.currency_code,
          exchange_rate: suggestedRate === '' ? prev.exchange_rate : suggestedRate,
        };
      });
      setCurrencyTouched(true);
    } catch (err) {
      console.warn('No se pudo cargar moneda desde adicional', err?.message);
    }
  }

  async function loadContainerBillingCurrency(seed = null) {
    const row = seed || containerBilling;
    if (!row) return;
    setQuoteCurrencyInfo({
      currency: String(row.currency_code || 'PYG').toUpperCase(),
      exchange_rate: Number(row.exchange_rate || row.contract_exchange_rate || 0) || 0,
    });
    setForm((prev) => {
      if (currencyTouched) return prev;
      const suggestedRate = getSuggestedExchangeRate(
        {
          currency: String(row.currency_code || 'PYG').toUpperCase(),
          exchange_rate: Number(row.exchange_rate || row.contract_exchange_rate || 0) || 0,
        },
        prev.exchange_rate
      );
      return {
        ...prev,
        currency_code: String(row.currency_code || 'PYG').toUpperCase(),
        exchange_rate: suggestedRate === '' ? prev.exchange_rate : suggestedRate,
      };
    });
  }

  async function loadDefaults(dealId, serviceCaseId, buKeyHint = "") {
    try {
      const { data } = await api.get('/invoices/defaults', {
        params: dealId
          ? { deal_id: dealId }
          : serviceCaseId
          ? { service_case_id: serviceCaseId }
          : {},
      });
      const effectiveBU =
        String(data?.business_unit_key || buKeyHint || businessUnitKey || "").toLowerCase();
      const isIndustrial =
        effectiveBU === "atm-industrial" ||
        effectiveBU === "industrial-rayflex" ||
        effectiveBU === "industrial-boplan" ||
        effectiveBU.includes("industrial");
      const fallbackExp = isIndustrial ? "001-005" : "001-004";
      const [defPoint, defEst] = fallbackExp.split("-").concat(["", ""]);

      const point = data?.point_of_issue || defPoint || "001";
      const est = data?.establishment || defEst || "000";
      const fallbackNumber = `${point}-${est}-${String(1).padStart(7, "0")}`;
      setSuggestedNumber((data && data.invoice_number) || fallbackNumber);
      setForm((prev) => ({
        ...prev,
        timbrado_number: prev.timbrado_number || data?.timbrado_number || "",
        timbrado_start_date: prev.timbrado_start_date || toISO(data?.timbrado_start_date) || "",
        timbrado_expires_at: prev.timbrado_expires_at || toISO(data?.timbrado_expires_at) || "",
        // Siempre forzamos el punto/establecimiento según la BU detectada
        point_of_issue: point,
        establishment: est,
      }));
      setTimbreFetched(Boolean(data?.timbrado_number));
    } catch (err) {
      console.warn('No se pudieron cargar defaults de factura', err?.message);
      // fallback básico por si falla la API
      const fallbackNumber = `001-004-${String(1).padStart(7, "0")}`;
      setSuggestedNumber((prev) => prev || fallbackNumber);
      setForm((prev) => ({
        ...prev,
        point_of_issue: prev.point_of_issue || "001",
        establishment: prev.establishment || "004",
      }));
    }
  }

  // Si el timbrado llegó vacío, intentamos leerlo directamente de /params
  useEffect(() => {
    if (timbreFetched) return;
    (async () => {
      try {
        const { data } = await api.get('/params', {
          params: { keys: 'invoice_timbre_number,invoice_timbre_valid_from,invoice_timbre_valid_to' },
        });
        const tnum = data?.invoice_timbre_number?.[0]?.value || "";
        const tFrom = data?.invoice_timbre_valid_from?.[0]?.value || "";
        const tTo = data?.invoice_timbre_valid_to?.[0]?.value || "";
        if (tnum || tFrom || tTo) {
          setForm((prev) => ({
            ...prev,
            timbrado_number: prev.timbrado_number || tnum,
            timbrado_start_date: prev.timbrado_start_date || toISO(tFrom),
            timbrado_expires_at: prev.timbrado_expires_at || toISO(tTo),
          }));
          setTimbreFetched(true);
        }
      } catch (err) {
        console.warn('No se pudo leer timbrado desde parametros', err?.message);
      }
    })();
  }, [timbreFetched]);

  const buildBillableItemsParams = () => {
    const dealId = form.deal_id ? Number(form.deal_id) : null;
    const serviceCaseId = form.service_case_id ? Number(form.service_case_id) : null;
    if (!dealId && !serviceCaseId) return null;
    return dealId
      ? {
          deal_id: dealId,
          cost_sheet_version_number: defaultCostSheetVersionNumber || undefined,
          quote_revision_id: defaultQuoteRevisionId || undefined,
        }
      : { service_case_id: serviceCaseId, quote_revision_id: defaultQuoteRevisionId || undefined };
  };

  const buildPreview = (items, pct) => {
    const selectedKeys = new Set(defaultSelectedQuoteItems.map((key) => String(key || '')));
    const sourceItems = hasSelectedQuoteItems
      ? items.filter((item) => selectedKeys.has(String(item.source_item_key || '')))
      : items.filter((item) => item.pending);
    const factor = Number(pct || 100) / 100;
    const rows = sourceItems.map((item, idx) => {
      const sourceCurrency = normalizeCurrencyCode(item.currency_code || quoteCurrencyInfo.currency || form.currency_code);
      const targetCurrency = normalizeCurrencyCode(form.currency_code || sourceCurrency);
      const sourceTotal = Number(item.total || 0) || 0;
      const gross = convertPreviewAmount(sourceTotal, sourceCurrency, targetCurrency) * factor;
      const taxRate = Number(item.tax_rate ?? 0) || 0;
      const split = splitTaxFromGross(gross, taxRate);
      return {
        key: item.source_item_key || `${idx}`,
        description: item.description || 'Item',
        quantity: Number(item.quantity || 1) || 1,
        tax_rate: taxRate,
        gross,
        base: split.base,
        tax: split.tax,
        currency_code: targetCurrency,
      };
    });
    const totals = rows.reduce((acc, row) => {
      acc.gross += row.gross;
      acc.tax += row.tax;
      if (row.tax_rate >= 9) acc.vat10 += row.gross;
      else if (row.tax_rate >= 4) acc.vat5 += row.gross;
      else acc.exempt += row.gross;
      return acc;
    }, { gross: 0, tax: 0, vat10: 0, vat5: 0, exempt: 0 });
    return { rows, totals };
  };

  useEffect(() => {
    let live = true;
    const pct = form.mode === 'percentage' ? Number(form.percentage || 100) : 100;

    if (isContainerBilling) {
      const amount = Number(containerBilling?.amount ?? containerBilling?.total_amount ?? containerBilling?.monthly_amount ?? containerBilling?.billing_amount ?? 0) || 0;
      const currency = normalizeCurrencyCode(containerBilling?.currency_code || form.currency_code || 'PYG');
      const split = splitTaxFromGross(amount, 10);
      setInvoicePreview({
        loading: false,
        error: '',
        items: [{ key: 'container', description: containerSourceLabel || 'Mensualidad ATM CONTAINER', quantity: 1, tax_rate: 10, gross: amount, base: split.base, tax: split.tax, currency_code: currency }],
        totals: { gross: amount, tax: split.tax, vat10: amount, vat5: 0, exempt: 0 },
      });
      return undefined;
    }

    const params = buildBillableItemsParams();
    if (!params) {
      setInvoicePreview({ loading: false, items: [], totals: null, error: '' });
      return undefined;
    }

    setInvoicePreview((prev) => ({ ...prev, loading: true, error: '' }));
    api.get('/invoices/billable-items', { params })
      .then(({ data }) => {
        if (!live) return;
        const items = Array.isArray(data) ? data : [];
        const preview = buildPreview(items, pct);
        setInvoicePreview({ loading: false, error: '', items: preview.rows, totals: preview.totals });
      })
      .catch((err) => {
        if (!live) return;
        setInvoicePreview({ loading: false, items: [], totals: null, error: err?.response?.data?.error || 'No se pudo cargar la vista previa.' });
      });

    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.deal_id, form.service_case_id, form.currency_code, form.exchange_rate, form.mode, form.percentage, defaultCostSheetVersionNumber, defaultQuoteRevisionId, defaultSelectedQuoteItems.join('|'), containerBilling?.id]);
  async function validateInvoiceHasAmount(pct) {
    if (isContainerBilling) {
      const amount = Number(
        containerBilling?.amount ??
        containerBilling?.total_amount ??
        containerBilling?.monthly_amount ??
        containerBilling?.billing_amount ??
        0
      );
      return !Number.isFinite(amount) || amount > 0;
    }

    const dealId = form.deal_id ? Number(form.deal_id) : null;
    const serviceCaseId = form.service_case_id ? Number(form.service_case_id) : null;
    if (!dealId && !serviceCaseId) return true;

    const params = dealId
      ? {
          deal_id: dealId,
          cost_sheet_version_number: defaultCostSheetVersionNumber || undefined,
          quote_revision_id: defaultQuoteRevisionId || undefined,
        }
      : { service_case_id: serviceCaseId, quote_revision_id: defaultQuoteRevisionId || undefined };

    try {
      const { data } = await api.get('/invoices/billable-items', { params });
      const items = Array.isArray(data) ? data : [];
      if (!items.length) return true;
      const selectedKeys = new Set(defaultSelectedQuoteItems.map((key) => String(key || '')));
      const sourceItems = hasSelectedQuoteItems
        ? items.filter((item) => selectedKeys.has(String(item.source_item_key || '')))
        : items.filter((item) => item.pending);
      if (!sourceItems.length) return true;
      const baseAmount = sourceItems.reduce((sum, item) => sum + (Number(item.total || 0) || 0), 0);
      const estimatedTotal = isContainerBilling ? baseAmount : baseAmount * (Number(pct || 100) / 100);
      return Number.isFinite(estimatedTotal) && estimatedTotal > 0.0001;
    } catch (err) {
      console.warn('No se pudo validar monto facturable antes de crear factura', err?.message);
      return true;
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.deal_id && !form.service_case_id && !form.container_billing_cycle_id) {
      alert('Ingresa el ID de la operación, del servicio o una mensualidad container');
      return;
    }

    const pct = form.mode === 'percentage' ? Number(form.percentage) : 100;
    if (!hasSelectedQuoteItems && (Number.isNaN(pct) || pct <= 0 || pct > 100)) {
      alert('Ingresa un porcentaje valido entre 1 y 100');
      return;
    }
    if (!hasSelectedQuoteItems && !isContainerBilling && !isContainerInitialInvoice) {
      const roundedPct = toPercentNumber(pct);
      if (usedPercentageSet.has(roundedPct)) {
        alert(`El ${roundedPct}% ya fue facturado para esta operacion.`);
        return;
      }
      if ((Number(invoiceProgress.usedTotal || 0) + pct) > 100.0001) {
        alert(`El porcentaje supera el 100%. Ya facturado: ${Number(invoiceProgress.usedTotal || 0).toFixed(2)}%.`);
        return;
      }
    }

    const fxValue = Number(form.exchange_rate || 0) || 0;
    if (requiresExchangeRate && fxValue <= 1) {
      alert('Carga un tipo de cambio valido mayor a 1 para convertir entre PYG y USD.');
      return;
    }

    const hasAmountToInvoice = await validateInvoiceHasAmount(pct);
    if (!hasAmountToInvoice) {
      alert('No hay monto para facturar. Revisa que el presupuesto o los items seleccionados tengan precio de venta mayor a cero.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        deal_id: form.deal_id ? Number(form.deal_id) : null,
        service_case_id: form.service_case_id ? Number(form.service_case_id) : null,
        service_quote_addition_id: form.service_quote_addition_id ? Number(form.service_quote_addition_id) : null,
        container_billing_cycle_id: form.container_billing_cycle_id ? Number(form.container_billing_cycle_id) : null,
        percentage: isContainerBilling ? null : pct,
        payment_terms: isCreditPayment ? form.payment_terms : '',
        due_date: isCreditPayment ? form.due_date : '',
        exchange_rate: fxValue || 1,
        cost_sheet_version_number: defaultCostSheetVersionNumber || undefined,
        quote_revision_id: defaultQuoteRevisionId || undefined,
        selected_quote_items: hasSelectedQuoteItems ? defaultSelectedQuoteItems : undefined,
      };
      const { data } = await api.post('/invoices', payload);
      alert('Factura creada correctamente');
      onSuccess?.(data.id);
    } catch (e) {
      console.error('Error creating invoice:', e);
      alert(e.response?.data?.error || 'Error al crear factura');
    } finally {
      setSaving(false);
    }
  }

  const InvoicePreviewPanel = () => (
    <aside className="w-full max-w-5xl xl:w-[430px] xl:max-w-[430px] xl:sticky xl:top-6 max-h-[90vh] overflow-y-auto rounded-lg border bg-white p-4 shadow-xl">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">Vista previa de factura</h4>
          <p className="text-xs text-slate-500">Items, impuestos y montos antes de crear.</p>
        </div>
        {invoicePreview.loading && <span className="text-xs text-slate-500">Cargando...</span>}
      </div>

      {invoicePreview.error ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {invoicePreview.error}
        </div>
      ) : invoicePreview.items.length === 0 ? (
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
          Selecciona una operacion, servicio o items para ver la vista previa.
        </div>
      ) : (
        <>
          <div className="overflow-auto rounded border bg-white">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-800 text-white">
                <tr>
                  <th className="px-2 py-2 text-center">Cant.</th>
                  <th className="px-2 py-2 text-left">Descripcion</th>
                  <th className="px-2 py-2 text-right">Precio unit.</th>
                  <th className="px-2 py-2 text-right">IVA</th>
                  <th className="px-2 py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoicePreview.items.map((item, index) => {
                  const quantity = Number(item.quantity || 1) || 1;
                  const gross = Number(item.gross || 0) || 0;
                  const unitPrice = quantity ? gross / quantity : gross;
                  return (
                    <tr key={`${item.key || item.source_item_key || item.description || 'item'}-${index}`}>
                      <td className="px-2 py-2 align-top text-center text-slate-700">{quantity.toLocaleString('es-PY')}</td>
                      <td className="px-2 py-2 align-top text-slate-800">
                        <div className="font-medium">{item.description || 'Item'}</div>
                        {item.source_label && <div className="text-[11px] text-slate-500">{item.source_label}</div>}
                      </td>
                      <td className="px-2 py-2 align-top text-right text-slate-700">{formatMoney(unitPrice, item.currency_code || form.currency_code)}</td>
                      <td className="px-2 py-2 align-top text-right text-slate-700">
                        {Number(item.tax_rate || 0) > 0 ? `${Number(item.tax_rate)}%` : 'Exenta'}
                      </td>
                      <td className="px-2 py-2 align-top text-right font-semibold text-slate-900">
                        {formatMoney(gross, item.currency_code || form.currency_code)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {invoicePreview.totals && (
            <div className="mt-3 rounded border bg-slate-50 p-3 text-sm">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                <span className="text-slate-600">Exentas</span>
                <span className="text-right font-medium">{formatMoney(invoicePreview.totals.exempt, form.currency_code)}</span>
                <span className="text-slate-600">Gravadas 5%</span>
                <span className="text-right font-medium">{formatMoney(invoicePreview.totals.vat5, form.currency_code)}</span>
                <span className="text-slate-600">Gravadas 10%</span>
                <span className="text-right font-medium">{formatMoney(invoicePreview.totals.vat10, form.currency_code)}</span>
                <span className="text-slate-600">IVA incluido</span>
                <span className="text-right font-medium">{formatMoney(invoicePreview.totals.tax, form.currency_code)}</span>
                <span className="border-t pt-2 font-semibold text-slate-900">Total</span>
                <span className="border-t pt-2 text-right font-bold text-slate-900">{formatMoney(invoicePreview.totals.gross, form.currency_code)}</span>
              </div>
              {requiresExchangeRate && (
                <p className="pt-2 text-[11px] text-slate-500">
                  Convertido desde {quoteCurrencyInfo.currency || 'la moneda del presupuesto'} con TC {form.exchange_rate || '-'}.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  );
  return (
    <div className="fixed inset-0 bg-black/30 z-50 overflow-y-auto">
      <div className="flex min-h-full w-full flex-col xl:flex-row items-start justify-center gap-4 p-4 md:p-6">
      <div className="bg-white rounded-lg p-6 w-full max-w-5xl shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Nueva factura</h3>
          <button onClick={onClose} className="text-2xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {isContainerBilling && (
            <div className="rounded-lg border bg-slate-50 px-4 py-3 text-sm">
              <div className="font-medium text-slate-800">Origen de facturación</div>
              <div className="text-slate-600 mt-1">{containerSourceLabel || "Mensualidad ATM CONTAINER"}</div>
            </div>
          )}
          {isContainerInitialInvoice && (
            <div className="rounded-lg border bg-amber-50 px-4 py-3 text-sm">
              <div className="font-medium text-amber-900">Factura inicial ATM CONTAINER</div>
              <div className="text-amber-800 mt-1">
                Esta factura sale desde Administracion sobre la operacion aprobada y cubre el primer mes de alquiler.
              </div>
            </div>
          )}
          {hasSelectedQuoteItems && (
            <div className="rounded-lg border bg-blue-50 px-4 py-3 text-sm">
              <div className="font-medium text-blue-900">Facturaci?n por ?tems seleccionados</div>
              <div className="text-blue-800 mt-1">
                Se facturar?n ?nicamente los ?tems pendientes que seleccionaste en Administraci?n.
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {isContainerBilling ? (
              <>
                <div className="md:col-span-1">
                  <label className="block text-sm font-medium mb-1">ID de mensualidad</label>
                  <input
                    type="number"
                    className="w-full border rounded-lg px-3 py-2 disabled:bg-slate-100"
                    value={form.container_billing_cycle_id}
                    disabled
                  />
                  <p className="text-xs text-slate-500 mt-1">Se genera desde ATM CONTAINER.</p>
                </div>
                <div className="md:col-span-1">
                  <label className="block text-sm font-medium mb-1">ID de operacion (deal)</label>
                  <input
                    type="number"
                    className="w-full border rounded-lg px-3 py-2 disabled:bg-slate-100"
                    value={form.deal_id}
                    disabled
                  />
                  <p className="text-xs text-slate-500 mt-1">Operación vinculada a la mensualidad.</p>
                </div>
              </>
            ) : defaultServiceCaseId ? (
              <div className="md:col-span-1">
                <label className="block text-sm font-medium mb-1">ID de servicio (mantenimiento)</label>
                <input
                  type="number"
                  className="w-full border rounded-lg px-3 py-2 disabled:bg-slate-100"
                  value={form.service_case_id}
                  onChange={(e) => setForm({ ...form, service_case_id: e.target.value })}
                  placeholder="Ej: 123"
                  required
                  disabled={Boolean(defaultServiceCaseId)}
                />
                <p className="text-xs text-slate-500 mt-1">Usa el presupuesto del servicio.</p>
              </div>
            ) : (
              <>
                <div className="md:col-span-1">
                  <label className="block text-sm font-medium mb-1">ID de operacion (deal)</label>
                  <input
                    type="number"
                    className="w-full border rounded-lg px-3 py-2 disabled:bg-slate-100"
                    value={form.deal_id}
                    onChange={(e) => setForm({ ...form, deal_id: e.target.value })}
                    placeholder="Ej: 123"
                    disabled={Boolean(defaultDealId)}
                  />
                  <p className="text-xs text-slate-500 mt-1">Usa el presupuesto del deal.</p>
                </div>
                <div className="md:col-span-1">
                  <label className="block text-sm font-medium mb-1">ID de servicio (mantenimiento)</label>
                  <input
                    type="number"
                    className="w-full border rounded-lg px-3 py-2 disabled:bg-slate-100"
                    value={form.service_case_id}
                    onChange={(e) => setForm({ ...form, service_case_id: e.target.value })}
                    placeholder="Ej: 12"
                    disabled={Boolean(defaultServiceCaseId)}
                  />
                  <p className="text-xs text-slate-500 mt-1">Usa el presupuesto del servicio.</p>
                </div>
              </>
            )}
            {defaultServiceQuoteAdditionId && (
              <div className="md:col-span-1">
                <label className="block text-sm font-medium mb-1">ID de adicional</label>
                <input
                  type="number"
                  className="w-full border rounded-lg px-3 py-2 disabled:bg-slate-100"
                  value={form.service_quote_addition_id}
                  disabled
                />
                <p className="text-xs text-slate-500 mt-1">Factura sobre presupuesto adicional.</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Condicion de pago</label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={form.payment_condition}
                onChange={(e) => {
                  const nextCondition = e.target.value;
                  setDueDateTouched(false);
                  setForm((prev) => ({
                    ...prev,
                    payment_condition: nextCondition,
                    payment_terms: nextCondition === 'credito' ? (prev.payment_terms || '30 dias') : '',
                    due_date: nextCondition === 'credito' ? prev.due_date : '',
                  }));
                }}
              >
                <option value="credito">Credito</option>
                <option value="contado">Contado</option>
              </select>
            </div>
            {isCreditPayment && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">Terminos de pago</label>
                  <input
                    type="text"
                    className="w-full border rounded-lg px-3 py-2"
                    value={form.payment_terms}
                    onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
                    placeholder="Ej: 30 dias"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Vencimiento</label>
                  <input
                    type="date"
                    className="w-full border rounded-lg px-3 py-2"
                    value={form.due_date}
                    onChange={(e) => {
                      setDueDateTouched(true);
                      setForm({ ...form, due_date: e.target.value });
                    }}
                  />
                </div>
              </>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Tipo de monto</label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={form.amount_plan}
                disabled={isContainerBilling || isContainerInitialInvoice}
                onChange={(e) => handleAmountPlanChange(e.target.value)}
                >
                  {isContainerBilling ? (
                    <option value="total">Monto de mensualidad</option>
                  ) : (
                    planOptions.map((plan) => (
                      <option key={plan.key} value={plan.key} disabled={!plan.availableInstallments.length}>
                        {plan.label}{!plan.availableInstallments.length ? " - sin saldo" : ""}
                      </option>
                    ))
                  )}
                </select>
                {!isContainerBilling && !isContainerInitialInvoice && (
                  <p className="text-xs text-slate-500 mt-1">
                    Facturado: {Number(invoiceProgress.usedTotal || 0).toFixed(2)}%
                  </p>
                )}
              </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                {isContainerBilling ? "Monto mensual" : isContainerInitialInvoice ? "Factura inicial" : "Porcentaje a facturar"}
              </label>
              {isContainerBilling ? (
                <input
                  type="text"
                  className="w-full border rounded-lg px-3 py-2 bg-slate-100"
                  value={containerBilling ? `${containerBilling.currency_code || "PYG"} ${Number(containerBilling.amount || 0).toLocaleString(String(containerBilling.currency_code || "PYG").toUpperCase() === "USD" ? "en-US" : "es-PY", {
                    minimumFractionDigits: String(containerBilling.currency_code || "PYG").toUpperCase() === "USD" ? 2 : 0,
                    maximumFractionDigits: String(containerBilling.currency_code || "PYG").toUpperCase() === "USD" ? 2 : 0,
                  })}` : ""}
                  readOnly
                />
              ) : form.mode === "percentage" && !isContainerInitialInvoice ? (
                <select
                  className="w-full border rounded-lg px-3 py-2"
                  value={form.percentage}
                  onChange={(e) => setForm({ ...form, percentage: e.target.value })}
                  required
                >
                  {selectedPlan.installments.map((pct) => {
                    const used = !hasSelectedQuoteItems && usedPercentageSet.has(toPercentNumber(pct));
                    const exceedsBalance = !hasSelectedQuoteItems && usedTotalPercentage + pct > 100.0001;
                    return (
                      <option key={pct} value={pct} disabled={used || exceedsBalance}>
                        {pct}%{used ? " - ya facturado" : exceedsBalance ? " - excede saldo" : ""}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <input
                  type="number"
                  className="w-full border rounded-lg px-3 py-2 bg-slate-100"
                  value="100"
                  readOnly
                />
              )}
              {hasSelectedQuoteItems && (
                <p className="text-xs text-slate-500 mt-1">{defaultSelectedQuoteItems.length} item(s) seleccionado(s)</p>
              )}
              {!hasSelectedQuoteItems && !isContainerBilling && !isContainerInitialInvoice && availableInstallments.length === 0 && (
                <p className="text-xs text-red-600 mt-1">No quedan porcentajes disponibles en este esquema.</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Timbrado</label>
              <input
                type="text"
                className="w-full border rounded-lg px-3 py-2 bg-slate-100"
                value={form.timbrado_number}
                readOnly
                placeholder="Numero de timbrado"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Vigencia desde</label>
              <input
                type="date"
                className="w-full border rounded-lg px-3 py-2 bg-slate-100"
                value={form.timbrado_start_date}
                readOnly
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Vigencia hasta</label>
              <input
                type="date"
                className="w-full border rounded-lg px-3 py-2 bg-slate-100"
                value={form.timbrado_expires_at}
                readOnly
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Punto de expedicion</label>
              <input
                type="text"
                className="w-full border rounded-lg px-3 py-2 bg-slate-100"
                value={form.point_of_issue}
                readOnly
                placeholder="Ej: 001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Establecimiento</label>
              <input
                type="text"
                className="w-full border rounded-lg px-3 py-2 bg-slate-100"
                value={form.establishment}
                readOnly
                placeholder="Ej: 001"
              />
            </div>
            <div className="md:col-span-4">
              <label className="block text-sm font-medium mb-1">Número factura</label>
              <div className="w-full border rounded-lg px-3 py-2 bg-slate-100 text-slate-700">
                {suggestedNumber || '-'}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Moneda</label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={form.currency_code}
                onChange={(e) => {
                  setCurrencyTouched(true);
                  const nextCurrency = e.target.value;
                  const currentRate = Number(form.exchange_rate || 0) || 0;
                  const suggestedRate = getSuggestedExchangeRate(quoteCurrencyInfo, currentRate);
                  setForm({
                    ...form,
                    currency_code: nextCurrency,
                    exchange_rate:
                      currentRate > 1
                        ? currentRate
                        : suggestedRate === ''
                        ? ''
                        : suggestedRate,
                  });
                }}
              >
                <option value="USD">USD</option>
                <option value="PYG">PYG</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tipo de cambio</label>
              <input
                type="number"
                step="0.0001"
                className="w-full border rounded-lg px-3 py-2"
                value={form.exchange_rate}
                onChange={(e) => {
                  setCurrencyTouched(true);
                  setForm({ ...form, exchange_rate: e.target.value });
                }}
              />
              <p className="text-xs text-slate-500 mt-1">
                {requiresExchangeRate
                  ? 'Se usa para convertir entre PYG y USD.'
                  : 'Referencia cambiaria de la factura.'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Doc. cliente</label>
              <div className="flex gap-2">
                <select
                  className="border rounded-lg px-2 py-2"
                  value={form.customer_doc_type}
                  onChange={(e) => setForm({ ...form, customer_doc_type: e.target.value })}
                >
                  <option value="RUC">RUC</option>
                  <option value="CI">CI</option>
                  <option value="PAS">PAS</option>
                </select>
                <input
                  type="text"
                  className="flex-1 border rounded-lg px-3 py-2"
                  value={form.customer_doc}
                  onChange={(e) => setForm({ ...form, customer_doc: e.target.value })}
                  placeholder="Ej: 80012345-6"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Email cliente</label>
              <input
                type="email"
                className="w-full border rounded-lg px-3 py-2"
                value={form.customer_email}
                onChange={(e) => setForm({ ...form, customer_email: e.target.value })}
                placeholder="cliente@correo.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Direccion cliente</label>
              <input
                type="text"
                className="w-full border rounded-lg px-3 py-2"
                value={form.customer_address}
                onChange={(e) => setForm({ ...form, customer_address: e.target.value })}
                placeholder="Calle, ciudad"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Vendedor / Ejecutivo</label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={form.sales_rep_id || ''}
                onChange={(e) => {
                  const selected = executives.find((u) => String(u.id) === e.target.value);
                  setForm({ ...form, sales_rep_id: e.target.value, sales_rep: selected?.name || '' });
                }}
              >
                <option value="">Seleccionar</option>
                {executives.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">OC / Referencia</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  className="flex-1 border rounded-lg px-3 py-2"
                  value={form.purchase_order_ref}
                  onChange={(e) => setForm({ ...form, purchase_order_ref: e.target.value })}
                  placeholder="Orden de compra"
                />
                {ocDocs.length > 0 && (
                  <a
                    href={ocDocs[0].url || '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs px-3 py-2 bg-slate-600 text-white rounded hover:bg-slate-700"
                  >
                    Ver OC
                  </a>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notas</label>
            <textarea
              className="w-full border rounded-lg px-3 py-2"
              rows="3"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Notas adicionales..."
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border rounded-lg hover:bg-slate-50"
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              disabled={saving}
            >
              {saving ? 'Creando...' : 'Crear factura'}
            </button>
          </div>
        </form>
      </div>
      <InvoicePreviewPanel />
    </div>
  </div>
  );
}