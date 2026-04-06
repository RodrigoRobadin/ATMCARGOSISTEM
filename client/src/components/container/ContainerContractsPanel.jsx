import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../api";

const CONTRACT_STATUSES = [
  "borrador",
  "emitido",
  "vigente",
  "vencido",
  "renovado",
  "cerrado",
  "anulado",
];

const CURRENCIES = ["PYG", "USD"];

function emptyRep() {
  return {
    id: `rep-${Math.random().toString(36).slice(2)}`,
    name: "",
    doc: "",
    role: "",
  };
}

function fmtMoney(amount, currency) {
  const num = Number(amount || 0);
  const locale = String(currency || "PYG").toUpperCase() === "USD" ? "en-US" : "es-PY";
  const decimals = String(currency || "PYG").toUpperCase() === "USD" ? 2 : 0;
  return `${String(currency || "PYG").toUpperCase()} ${num.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function statusPill(status) {
  const key = String(status || "").toLowerCase();
  if (["vigente", "renovado"].includes(key)) return "bg-emerald-100 text-emerald-700";
  if (["vencido", "anulado"].includes(key)) return "bg-red-100 text-red-700";
  if (["emitido"].includes(key)) return "bg-blue-100 text-blue-700";
  return "bg-slate-100 text-slate-700";
}

function operationalStatus(contract) {
  const status = String(contract?.status || "").toLowerCase();
  if (["anulado", "cerrado", "renovado"].includes(status)) return status;
  const now = new Date();
  const from = contract?.effective_from ? new Date(`${contract.effective_from}T00:00:00`) : null;
  const to = contract?.effective_to ? new Date(`${contract.effective_to}T00:00:00`) : null;
  if (to && to < now) return "vencido";
  if (from && from > now) return "programado";
  return status || "borrador";
}

function emptyLine(currency = "PYG", lineType = "alquiler", description = "Alquiler") {
  return {
    id: `tmp-${Math.random().toString(36).slice(2)}`,
    line_type: lineType,
    description,
    amount: 0,
    currency_code: currency,
  };
}

function buildDraftContract(dealId, units = [], payload = {}) {
  const contract = payload.contract || payload;
  const currency = contract.currency_code || "PYG";
  const lessorLegalReps = Array.isArray(contract.lessor_legal_reps) && contract.lessor_legal_reps.length
    ? contract.lessor_legal_reps.map((row) => ({ id: row.id || `rep-${Math.random().toString(36).slice(2)}`, name: row.name || "", doc: row.doc || "", role: row.role || "" }))
    : contract.lessor_legal_rep_name || contract.lessor_legal_rep_doc
      ? [{ id: `rep-${Math.random().toString(36).slice(2)}`, name: contract.lessor_legal_rep_name || "", doc: contract.lessor_legal_rep_doc || "", role: "" }]
      : [emptyRep()];
  const lesseeLegalReps = Array.isArray(contract.lessee_legal_reps) && contract.lessee_legal_reps.length
    ? contract.lessee_legal_reps.map((row) => ({ id: row.id || `rep-${Math.random().toString(36).slice(2)}`, name: row.name || "", doc: row.doc || "", role: row.role || "" }))
    : contract.lessee_legal_rep_name || contract.lessee_legal_rep_doc
      ? [{ id: `rep-${Math.random().toString(36).slice(2)}`, name: contract.lessee_legal_rep_name || "", doc: contract.lessee_legal_rep_doc || "", role: "" }]
      : [emptyRep()];
  return {
    contract: {
      id: contract.id || null,
      deal_id: dealId,
      contract_no: contract.contract_no || "",
      revision_no: contract.revision_no || 1,
      status: contract.status || "borrador",
      lessor_org_id: contract.lessor_org_id || null,
      lessee_org_id: contract.lessee_org_id || null,
      lessor_name: contract.lessor_name || "",
      lessee_name: contract.lessee_name || "",
      lessor_legal_rep_name: lessorLegalReps[0]?.name || "",
      lessor_legal_rep_doc: lessorLegalReps[0]?.doc || "",
      lessor_legal_reps: lessorLegalReps,
      lessee_legal_rep_name: lesseeLegalReps[0]?.name || "",
      lessee_legal_rep_doc: lesseeLegalReps[0]?.doc || "",
      lessee_legal_reps: lesseeLegalReps,
      renewed_from_contract_id: contract.renewed_from_contract_id || null,
      renewed_from_contract_no: contract.renewed_from_contract_no || "",
      renewal_no: contract.renewal_no ?? 0,
      effective_from: contract.effective_from || "",
      effective_to: contract.effective_to || "",
      minimum_term_months: contract.minimum_term_months ?? 3,
      payment_due_day: contract.payment_due_day ?? 5,
      preventive_notice_hours: contract.preventive_notice_hours ?? 48,
      payment_intimation_days: contract.payment_intimation_days ?? 8,
      review_after_months: contract.review_after_months ?? 3,
      review_notice_days: contract.review_notice_days ?? 15,
      replacement_value_usd: contract.replacement_value_usd ?? 21000,
      inspection_notice_hours: contract.inspection_notice_hours ?? 24,
      insurance_required: contract.insurance_required ?? 1,
      jurisdiction_text: contract.jurisdiction_text || "Tribunales del Departamento Central",
      late_fee_daily_pct: contract.late_fee_daily_pct ?? 0.233,
      late_fee_monthly_pct: contract.late_fee_monthly_pct ?? 7,
      late_fee_annual_pct: contract.late_fee_annual_pct ?? 27.07,
      currency_code: currency,
      title: contract.title || "",
      notes: contract.notes || "",
      deal_reference: contract.deal_reference || "",
    },
    units: Array.isArray(payload.units)
      ? payload.units
      : units.map((row, index) => ({
          container_unit_id: row.id,
          container_no: row.container_no,
          container_type: row.container_type,
          line_order: index + 1,
        })),
    lines: Array.isArray(payload.lines) && payload.lines.length
      ? payload.lines
      : [
          emptyLine(currency, "alquiler", "Alquiler"),
          emptyLine(currency, "flete", "Flete"),
          emptyLine(currency, "garantia", "Garantia"),
        ],
    revision: payload.revision || null,
  };
}

export default function ContainerContractsPanel({ dealId, dealReference, dealOrgName, units }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [contracts, setContracts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [contractData, setContractData] = useState(() => buildDraftContract(dealId, units));
  const [revisions, setRevisions] = useState([]);

  async function loadList(keepSelection = true) {
    setLoading(true);
    try {
      const { data } = await api.get(`/container/deals/${dealId}/contracts`);
      const rows = Array.isArray(data) ? data : [];
      setContracts(rows);
      if (!keepSelection) {
        setSelectedId(rows[0]?.id || null);
      } else if (selectedId && !rows.some((row) => row.id === selectedId)) {
        setSelectedId(rows[0]?.id || null);
      } else if (!selectedId && rows[0]?.id) {
        setSelectedId(rows[0].id);
      }
      if (!rows.length) {
        setContractData(buildDraftContract(dealId, units, { title: `Contrato ${dealReference || ""}`.trim() }));
      }
    } catch (err) {
      console.error("load container contracts", err);
      setContracts([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadList(false);
  }, [dealId]);

  useEffect(() => {
    if (!selectedId) {
      setRevisions([]);
      if (!contracts.length) {
        setContractData(buildDraftContract(dealId, units, { title: `Contrato ${dealReference || ""}`.trim() }));
      }
      return;
    }
    let live = true;
    (async () => {
      try {
        const [{ data: contract }, { data: revisionRows }] = await Promise.all([
          api.get(`/container/contracts/${selectedId}`),
          api.get(`/container/contracts/${selectedId}/revisions`),
        ]);
        if (!live) return;
        setContractData(buildDraftContract(dealId, units, contract));
        setRevisions(Array.isArray(revisionRows) ? revisionRows : []);
      } catch (err) {
        console.error("load container contract", err);
      }
    })();
    return () => {
      live = false;
    };
  }, [selectedId, contracts.length, dealId, dealReference]);

  useEffect(() => {
    setContractData((prev) => {
      const selected = new Set((prev.units || []).map((row) => Number(row.container_unit_id)));
      const normalizedUnits = (units || [])
        .filter((row) => selected.has(Number(row.id)))
        .map((row, index) => ({
          container_unit_id: row.id,
          container_no: row.container_no,
          container_type: row.container_type,
          line_order: index + 1,
        }));
      return { ...prev, units: normalizedUnits };
    });
  }, [units]);

  const total = useMemo(
    () => (contractData.lines || []).reduce((acc, row) => acc + Number(row.amount || 0), 0),
    [contractData.lines]
  );

  function patchContract(field, value) {
    setContractData((prev) => ({ ...prev, contract: { ...prev.contract, [field]: value } }));
  }

  function patchRep(side, index, field, value) {
    setContractData((prev) => {
      const key = side === "lessor" ? "lessor_legal_reps" : "lessee_legal_reps";
      const next = [...(prev.contract[key] || [emptyRep()])];
      next[index] = { ...next[index], [field]: value };
      return {
        ...prev,
        contract: {
          ...prev.contract,
          [key]: next,
          [side === "lessor" ? "lessor_legal_rep_name" : "lessee_legal_rep_name"]: next[0]?.name || "",
          [side === "lessor" ? "lessor_legal_rep_doc" : "lessee_legal_rep_doc"]: next[0]?.doc || "",
        },
      };
    });
  }

  function addRep(side) {
    setContractData((prev) => {
      const key = side === "lessor" ? "lessor_legal_reps" : "lessee_legal_reps";
      return {
        ...prev,
        contract: {
          ...prev.contract,
          [key]: [...(prev.contract[key] || []), emptyRep()],
        },
      };
    });
  }

  function removeRep(side, index) {
    setContractData((prev) => {
      const key = side === "lessor" ? "lessor_legal_reps" : "lessee_legal_reps";
      const filtered = (prev.contract[key] || []).filter((_, rowIndex) => rowIndex !== index);
      const next = filtered.length ? filtered : [emptyRep()];
      return {
        ...prev,
        contract: {
          ...prev.contract,
          [key]: next,
          [side === "lessor" ? "lessor_legal_rep_name" : "lessee_legal_rep_name"]: next[0]?.name || "",
          [side === "lessor" ? "lessor_legal_rep_doc" : "lessee_legal_rep_doc"]: next[0]?.doc || "",
        },
      };
    });
  }

  function toggleUnit(unit) {
    setContractData((prev) => {
      const exists = (prev.units || []).some((row) => Number(row.container_unit_id) === Number(unit.id));
      const nextUnits = exists
        ? prev.units.filter((row) => Number(row.container_unit_id) !== Number(unit.id))
        : [
            ...(prev.units || []),
            {
              container_unit_id: unit.id,
              container_no: unit.container_no,
              container_type: unit.container_type,
              line_order: (prev.units || []).length + 1,
            },
          ];
      return { ...prev, units: nextUnits.map((row, index) => ({ ...row, line_order: index + 1 })) };
    });
  }

  function addLine() {
    setContractData((prev) => ({
      ...prev,
      lines: [...(prev.lines || []), emptyLine(prev.contract.currency_code || "PYG", "otro", "Otro concepto")],
    }));
  }

  async function createContract() {
    try {
      setSaving(true);
      const { data } = await api.post(`/container/deals/${dealId}/contracts`, {
        title: `Contrato ${dealReference || ""}`.trim(),
        currency_code: "PYG",
        unit_ids: (units || []).map((row) => row.id),
      });
      await loadList(false);
      setSelectedId(data?.contract?.id || null);
    } catch (err) {
      console.error("create container contract", err);
      alert(err?.response?.data?.error || "No se pudo crear el contrato.");
    } finally {
      setSaving(false);
    }
  }

  async function saveContract() {
    if (!contractData?.contract?.id) return;
    try {
      setSaving(true);
      const payload = {
        contract: contractData.contract,
        units: (contractData.units || []).map((row, index) => ({
          container_unit_id: row.container_unit_id,
          line_order: index + 1,
        })),
        lines: (contractData.lines || []).map((row, index) => ({
          line_type: row.line_type,
          description: row.description,
          amount: Number(row.amount || 0),
          currency_code: row.currency_code || contractData.contract.currency_code || "PYG",
          line_order: index + 1,
        })),
      };
      const { data } = await api.put(`/container/contracts/${contractData.contract.id}`, payload);
      setContractData(buildDraftContract(dealId, units, data));
      await loadList();
    } catch (err) {
      console.error("save container contract", err);
      alert(err?.response?.data?.error || "No se pudo guardar el contrato.");
    } finally {
      setSaving(false);
    }
  }

  async function createRevision() {
    if (!contractData?.contract?.id) return;
    try {
      setSaving(true);
      await saveContract();
      await api.post(`/container/contracts/${contractData.contract.id}/revisions`, {});
      const { data: revisionRows } = await api.get(`/container/contracts/${contractData.contract.id}/revisions`);
      setRevisions(Array.isArray(revisionRows) ? revisionRows : []);
      await loadList();
    } catch (err) {
      console.error("create container revision", err);
      alert(err?.response?.data?.error || "No se pudo generar la revision.");
    } finally {
      setSaving(false);
    }
  }

  async function createRenewal() {
    if (!contractData?.contract?.id) return;
    try {
      setSaving(true);
      const { data } = await api.post(`/container/contracts/${contractData.contract.id}/renewals`, {});
      const nextId = data?.contract?.id;
      await loadList(true);
      if (nextId) {
        setSelectedId(nextId);
      }
    } catch (err) {
      console.error("create container renewal", err);
      alert(err?.response?.data?.error || "No se pudo generar la renovacion.");
    } finally {
      setSaving(false);
    }
  }

  async function quickStatus(nextStatus) {
    if (!contractData?.contract?.id) return;
    try {
      setSaving(true);
      const { data } = await api.patch(`/container/contracts/${contractData.contract.id}/status`, {
        status: nextStatus,
      });
      setContractData(buildDraftContract(dealId, units, data));
      await loadList(true);
    } catch (err) {
      console.error("quick contract status", err);
      alert(err?.response?.data?.error || "No se pudo actualizar el estado.");
    } finally {
      setSaving(false);
    }
  }

  async function openPdf(download = false) {
    if (!contractData?.contract?.id) return;
    try {
      const response = await api.get(`/container/contracts/${contractData.contract.id}/pdf`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: "application/pdf" }));
      if (download) {
        const a = document.createElement("a");
        a.href = url;
        a.download = `contrato-container-${contractData.contract.contract_no || contractData.contract.id}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        window.open(url, "_blank", "noopener");
      }
      setTimeout(() => window.URL.revokeObjectURL(url), 15000);
    } catch (err) {
      console.error("open container contract pdf", err);
      alert(err?.response?.data?.error || "No se pudo abrir el PDF.");
    }
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-4">
      <div className="rounded-2xl border bg-white overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div>
            <div className="font-semibold">Contratos</div>
            <div className="text-xs text-slate-500">Revisiones y control juridico</div>
          </div>
          <button type="button" className="px-3 py-2 rounded-lg border text-sm" onClick={createContract} disabled={saving}>
            + Nuevo
          </button>
        </div>
        <div className="divide-y">
          {loading && <div className="px-4 py-6 text-sm text-slate-500">Cargando...</div>}
          {!loading && !contracts.length && (
            <div className="px-4 py-6 text-sm text-slate-500">Todavia no hay contratos.</div>
          )}
          {contracts.map((row) => (
            <button
              key={row.id}
              type="button"
              className={`w-full text-left px-4 py-3 ${selectedId === row.id ? "bg-slate-50" : "bg-white hover:bg-slate-50"}`}
              onClick={() => setSelectedId(row.id)}
            >
              <div className="font-medium">{row.contract_no || `Contrato #${row.id}`}</div>
              <div className="text-xs text-slate-500 mt-1">{row.title || "Sin titulo"} - {row.unit_count || 0} cont.</div>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-medium ${statusPill(row.status)}`}>
                  {row.status}
                </span>
                <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-medium ${statusPill(operationalStatus(row))}`}>
                  {operationalStatus(row)}
                </span>
              </div>
              {!!row.renewal_no && Number(row.renewal_no) > 0 && (
                <div className="text-xs text-slate-500 mt-1">
                  Renovacion {row.renewal_no}{row.renewed_from_contract_no ? ` de ${row.renewed_from_contract_no}` : ""}
                </div>
              )}
              <div className="text-xs text-slate-600 mt-1">{fmtMoney(row.total_amount, row.currency_code)}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold">Editor de contrato</div>
            <div className="text-sm text-slate-500">
              Locatario: {dealOrgName || "Sin cliente"} - Operacion {dealReference || "-"}
            </div>
          </div>
          {!!contractData?.contract?.id && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="px-3 py-2 rounded-lg border text-sm" onClick={() => openPdf(false)}>
                Ver PDF
              </button>
              <button type="button" className="px-3 py-2 rounded-lg border text-sm" onClick={() => openPdf(true)}>
                Descargar
              </button>
              <button type="button" className="px-3 py-2 rounded-lg border text-sm" onClick={createRevision} disabled={saving}>
                Nueva revision
              </button>
              <button type="button" className="px-3 py-2 rounded-lg border text-sm" onClick={createRenewal} disabled={saving}>
                Renovar
              </button>
              <button type="button" className="px-3 py-2 rounded-lg border text-sm" onClick={() => quickStatus("emitido")} disabled={saving}>
                Emitir
              </button>
              <button type="button" className="px-3 py-2 rounded-lg border text-sm" onClick={() => quickStatus("vigente")} disabled={saving}>
                Vigente
              </button>
              <button type="button" className="px-3 py-2 rounded-lg border text-sm" onClick={() => quickStatus("cerrado")} disabled={saving}>
                Cerrar
              </button>
              <button type="button" className="px-3 py-2 rounded-lg border text-sm text-red-700" onClick={() => quickStatus("anulado")} disabled={saving}>
                Anular
              </button>
              <button type="button" className="px-3 py-2 rounded-lg bg-black text-white text-sm" onClick={saveContract} disabled={saving || !contractData?.contract?.id}>
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          )}
        </div>

        {!contractData?.contract?.id ? (
          <div className="rounded-xl border border-dashed p-6 text-sm text-slate-500">
            Crea un contrato para empezar.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <label className="text-sm">
                <div className="text-xs text-slate-600 mb-1">Nro contrato</div>
                <input className="w-full border rounded-lg px-3 py-2" value={contractData.contract.contract_no || ""} onChange={(e) => patchContract("contract_no", e.target.value)} />
              </label>
              <label className="text-sm">
                <div className="text-xs text-slate-600 mb-1">Titulo</div>
                <input className="w-full border rounded-lg px-3 py-2" value={contractData.contract.title || ""} onChange={(e) => patchContract("title", e.target.value)} />
              </label>
              <label className="text-sm">
                <div className="text-xs text-slate-600 mb-1">Estado</div>
                <select className="w-full border rounded-lg px-3 py-2 bg-white" value={contractData.contract.status || "borrador"} onChange={(e) => patchContract("status", e.target.value)}>
                  {CONTRACT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <div className="text-xs text-slate-600 mb-1">Moneda</div>
                <select className="w-full border rounded-lg px-3 py-2 bg-white" value={contractData.contract.currency_code || "PYG"} onChange={(e) => {
                  const nextCurrency = e.target.value;
                  patchContract("currency_code", nextCurrency);
                  setContractData((prev) => ({
                    ...prev,
                    lines: (prev.lines || []).map((line) => ({ ...line, currency_code: nextCurrency })),
                  }));
                }}>
                  {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                </select>
              </label>
            </div>

            <div className="rounded-xl border p-4">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <div>
                  Estado guardado:{" "}
                  <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${statusPill(contractData.contract.status)}`}>
                    {contractData.contract.status || "borrador"}
                  </span>
                </div>
                <div>
                  Estado operativo:{" "}
                  <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${statusPill(operationalStatus(contractData.contract))}`}>
                    {operationalStatus(contractData.contract)}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border p-4 space-y-3">
              <div className="font-medium">Vigencia operativa</div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <label className="text-sm">
                  <div className="text-xs text-slate-600 mb-1">Renovacion Nro</div>
                  <input className="w-full border rounded-lg px-3 py-2 bg-slate-50" value={contractData.contract.renewal_no ?? 0} readOnly />
                </label>
                <label className="text-sm">
                  <div className="text-xs text-slate-600 mb-1">Renueva a</div>
                  <input className="w-full border rounded-lg px-3 py-2 bg-slate-50" value={contractData.contract.renewed_from_contract_no || "-"} readOnly />
                </label>
                <label className="text-sm">
                  <div className="text-xs text-slate-600 mb-1">Vigencia desde</div>
                  <input className="w-full border rounded-lg px-3 py-2" type="date" value={contractData.contract.effective_from || ""} onChange={(e) => patchContract("effective_from", e.target.value)} />
                </label>
                <label className="text-sm">
                  <div className="text-xs text-slate-600 mb-1">Vigencia hasta</div>
                  <input className="w-full border rounded-lg px-3 py-2" type="date" value={contractData.contract.effective_to || ""} onChange={(e) => patchContract("effective_to", e.target.value)} />
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="rounded-xl border p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">Representacion legal</div>
                  <button type="button" className="px-3 py-2 rounded-lg border text-sm" onClick={() => addRep("lessor")}>
                    + Rep. locador
                  </button>
                </div>
                <div className="text-xs text-slate-500">Locador: {contractData.contract.lessor_name || "-"}</div>
                {(contractData.contract.lessor_legal_reps || [emptyRep()]).map((rep, index) => (
                  <div key={rep.id || index} className="grid grid-cols-1 md:grid-cols-[1fr_180px_180px_auto] gap-2">
                    <input
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      placeholder="Representante legal locador"
                      value={rep.name || ""}
                      onChange={(e) => patchRep("lessor", index, "name", e.target.value)}
                    />
                    <input
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      placeholder="Cargo"
                      value={rep.role || ""}
                      onChange={(e) => patchRep("lessor", index, "role", e.target.value)}
                    />
                    <input
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      placeholder="Documento"
                      value={rep.doc || ""}
                      onChange={(e) => patchRep("lessor", index, "doc", e.target.value)}
                    />
                    <button type="button" className="px-3 py-2 rounded-lg border text-sm" onClick={() => removeRep("lessor", index)}>
                      Eliminar
                    </button>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">Representacion locatario</div>
                  <button type="button" className="px-3 py-2 rounded-lg border text-sm" onClick={() => addRep("lessee")}>
                    + Rep. locatario
                  </button>
                </div>
                <div className="text-xs text-slate-500">Locatario: {contractData.contract.lessee_name || dealOrgName || "-"}</div>
                {(contractData.contract.lessee_legal_reps || [emptyRep()]).map((rep, index) => (
                  <div key={rep.id || index} className="grid grid-cols-1 md:grid-cols-[1fr_180px_180px_auto] gap-2">
                    <input
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      placeholder="Representante legal locatario"
                      value={rep.name || ""}
                      onChange={(e) => patchRep("lessee", index, "name", e.target.value)}
                    />
                    <input
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      placeholder="Cargo"
                      value={rep.role || ""}
                      onChange={(e) => patchRep("lessee", index, "role", e.target.value)}
                    />
                    <input
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      placeholder="Documento"
                      value={rep.doc || ""}
                      onChange={(e) => patchRep("lessee", index, "doc", e.target.value)}
                    />
                    <button type="button" className="px-3 py-2 rounded-lg border text-sm" onClick={() => removeRep("lessee", index)}>
                      Eliminar
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border p-4 space-y-3">
                <div className="font-medium">Condiciones juridicas</div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                  <label className="text-sm">
                    <div className="text-xs text-slate-600 mb-1">Plazo minimo (meses)</div>
                    <input className="w-full border rounded-lg px-3 py-2" type="number" min="1" value={contractData.contract.minimum_term_months ?? 3} onChange={(e) => patchContract("minimum_term_months", e.target.value)} />
                  </label>
                  <label className="text-sm">
                    <div className="text-xs text-slate-600 mb-1">Dia de pago</div>
                    <input className="w-full border rounded-lg px-3 py-2" type="number" min="1" max="31" value={contractData.contract.payment_due_day ?? 5} onChange={(e) => patchContract("payment_due_day", e.target.value)} />
                  </label>
                  <label className="text-sm">
                    <div className="text-xs text-slate-600 mb-1">Aviso preventivo (horas)</div>
                    <input className="w-full border rounded-lg px-3 py-2" type="number" min="0" value={contractData.contract.preventive_notice_hours ?? 48} onChange={(e) => patchContract("preventive_notice_hours", e.target.value)} />
                  </label>
                  <label className="text-sm">
                    <div className="text-xs text-slate-600 mb-1">Intimacion previa retiro (dias)</div>
                    <input className="w-full border rounded-lg px-3 py-2" type="number" min="0" value={contractData.contract.payment_intimation_days ?? 8} onChange={(e) => patchContract("payment_intimation_days", e.target.value)} />
                  </label>
                  <label className="text-sm">
                    <div className="text-xs text-slate-600 mb-1">Revision desde mes</div>
                    <input className="w-full border rounded-lg px-3 py-2" type="number" min="1" value={contractData.contract.review_after_months ?? 3} onChange={(e) => patchContract("review_after_months", e.target.value)} />
                  </label>
                  <label className="text-sm">
                    <div className="text-xs text-slate-600 mb-1">Aviso revision (dias)</div>
                    <input className="w-full border rounded-lg px-3 py-2" type="number" min="0" value={contractData.contract.review_notice_days ?? 15} onChange={(e) => patchContract("review_notice_days", e.target.value)} />
                  </label>
                  <label className="text-sm">
                    <div className="text-xs text-slate-600 mb-1">Valor reposicion USD</div>
                    <input className="w-full border rounded-lg px-3 py-2" type="number" min="0" step="0.01" value={contractData.contract.replacement_value_usd ?? 21000} onChange={(e) => patchContract("replacement_value_usd", e.target.value)} />
                  </label>
                  <label className="text-sm">
                    <div className="text-xs text-slate-600 mb-1">Inspeccion previa (horas)</div>
                    <input className="w-full border rounded-lg px-3 py-2" type="number" min="0" value={contractData.contract.inspection_notice_hours ?? 24} onChange={(e) => patchContract("inspection_notice_hours", e.target.value)} />
                  </label>
                  <label className="text-sm flex items-end">
                    <span className="inline-flex items-center gap-2 border rounded-lg px-3 py-2 w-full">
                      <input type="checkbox" checked={Boolean(Number(contractData.contract.insurance_required ?? 1))} onChange={(e) => patchContract("insurance_required", e.target.checked ? 1 : 0)} />
                      <span>Seguro obligatorio</span>
                    </span>
                  </label>
                </div>
                <label className="text-sm block">
                  <div className="text-xs text-slate-600 mb-1">Jurisdiccion</div>
                  <input className="w-full border rounded-lg px-3 py-2" value={contractData.contract.jurisdiction_text || ""} onChange={(e) => patchContract("jurisdiction_text", e.target.value)} placeholder="Tribunales del Departamento Central" />
                </label>
              </div>

            <div className="rounded-xl border p-4 space-y-3">
                <div className="font-medium">Mora</div>
                <div className="grid grid-cols-3 gap-3">
                  <label className="text-sm">
                    <div className="text-xs text-slate-600 mb-1">% diario</div>
                    <input className="w-full border rounded-lg px-3 py-2" type="number" step="0.001" value={contractData.contract.late_fee_daily_pct ?? 0} onChange={(e) => patchContract("late_fee_daily_pct", e.target.value)} />
                  </label>
                  <label className="text-sm">
                    <div className="text-xs text-slate-600 mb-1">% mensual</div>
                    <input className="w-full border rounded-lg px-3 py-2" type="number" step="0.001" value={contractData.contract.late_fee_monthly_pct ?? 0} onChange={(e) => patchContract("late_fee_monthly_pct", e.target.value)} />
                  </label>
                  <label className="text-sm">
                    <div className="text-xs text-slate-600 mb-1">% anual</div>
                    <input className="w-full border rounded-lg px-3 py-2" type="number" step="0.001" value={contractData.contract.late_fee_annual_pct ?? 0} onChange={(e) => patchContract("late_fee_annual_pct", e.target.value)} />
                  </label>
                </div>
                <textarea className="w-full min-h-[120px] border rounded-xl px-3 py-2 text-sm" placeholder="Observaciones contractuales" value={contractData.contract.notes || ""} onChange={(e) => patchContract("notes", e.target.value)} />
              </div>

            <div className="rounded-xl border p-4 space-y-3">
              <div className="font-medium">Contenedores incluidos</div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {(units || []).map((unit) => {
                  const checked = (contractData.units || []).some((row) => Number(row.container_unit_id) === Number(unit.id));
                  return (
                    <label key={unit.id} className="border rounded-xl px-3 py-3 text-sm flex items-start gap-3">
                      <input type="checkbox" checked={checked} onChange={() => toggleUnit(unit)} />
                      <div>
                        <div className="font-medium">{unit.container_no || `Contenedor #${unit.id}`}</div>
                        <div className="text-xs text-slate-500">{unit.container_type || "Sin tipo"} - {unit.status || "sin estado"}</div>
                      </div>
                    </label>
                  );
                })}
                {!units.length && <div className="text-sm text-slate-500">No hay contenedores cargados.</div>}
              </div>
            </div>

            <div className="rounded-xl border p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">Lineas economicas</div>
                <button type="button" className="px-3 py-2 rounded-lg border text-sm" onClick={addLine}>
                  + Linea
                </button>
              </div>
              <div className="space-y-3">
                {(contractData.lines || []).map((line, index) => (
                  <div key={line.id || `${line.description}-${index}`} className="grid grid-cols-1 xl:grid-cols-[180px_minmax(0,1fr)_180px_120px_auto] gap-3">
                    <input className="border rounded-lg px-3 py-2 text-sm" value={line.line_type || ""} onChange={(e) => setContractData((prev) => ({
                      ...prev,
                      lines: prev.lines.map((row, rowIndex) => rowIndex === index ? { ...row, line_type: e.target.value } : row),
                    }))} placeholder="Tipo" />
                    <input className="border rounded-lg px-3 py-2 text-sm" value={line.description || ""} onChange={(e) => setContractData((prev) => ({
                      ...prev,
                      lines: prev.lines.map((row, rowIndex) => rowIndex === index ? { ...row, description: e.target.value } : row),
                    }))} placeholder="Descripcion" />
                    <input className="border rounded-lg px-3 py-2 text-sm" type="number" step="0.01" value={line.amount ?? 0} onChange={(e) => setContractData((prev) => ({
                      ...prev,
                      lines: prev.lines.map((row, rowIndex) => rowIndex === index ? { ...row, amount: e.target.value } : row),
                    }))} placeholder="Monto" />
                    <select className="border rounded-lg px-3 py-2 text-sm bg-white" value={line.currency_code || contractData.contract.currency_code || "PYG"} onChange={(e) => setContractData((prev) => ({
                      ...prev,
                      lines: prev.lines.map((row, rowIndex) => rowIndex === index ? { ...row, currency_code: e.target.value } : row),
                    }))}>
                      {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                    </select>
                    <button type="button" className="px-3 py-2 rounded-lg border text-sm" onClick={() => setContractData((prev) => ({
                      ...prev,
                      lines: prev.lines.filter((_, rowIndex) => rowIndex !== index),
                    }))}>
                      Eliminar
                    </button>
                  </div>
                ))}
              </div>
              <div className="text-right font-semibold">
                Total: {fmtMoney(total, contractData.contract.currency_code)}
              </div>
            </div>

            <div className="rounded-xl border p-4">
              <div className="font-medium mb-2">Revisiones</div>
              {!revisions.length ? (
                <div className="text-sm text-slate-500">Sin revisiones generadas.</div>
              ) : (
                <div className="space-y-2">
                  {revisions.map((revision) => (
                    <div key={revision.id} className="flex items-center justify-between gap-3 text-sm border rounded-lg px-3 py-2">
                      <div>
                        <div className="font-medium">{revision.name}</div>
                        <div className="text-xs text-slate-500">Revision {revision.revision_no}</div>
                      </div>
                      <button
                        type="button"
                        className="px-3 py-2 rounded-lg border text-sm"
                        onClick={async () => {
                          try {
                            const { data } = await api.get(`/container/contracts/${contractData.contract.id}`, {
                              params: { revision_id: revision.id },
                            });
                            setContractData(buildDraftContract(dealId, units, data));
                          } catch (err) {
                            console.error("load contract revision", err);
                          }
                        }}
                      >
                        Ver revision
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
