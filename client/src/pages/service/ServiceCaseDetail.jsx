// client/src/pages/service/ServiceCaseDetail.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { useAuth } from "../../auth.jsx";
import QuoteEditor from "../QuoteEditor.jsx";
import InvoiceCreateModal from "../../components/InvoiceCreateModal.jsx";
import OperationExpenseInvoices from "../../components/OperationExpenseInvoices.jsx";
import AdminOpsPanel from "../../components/op-details/AdminOpsPanel.jsx";

function safeJsonArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-4 py-2 text-sm rounded-lg border transition " +
        (active
          ? "bg-black text-white border-black shadow-sm"
          : "bg-white border-slate-200 hover:bg-slate-50")
      }
    >
      {children}
    </button>
  );
}

function OperationDocViewer({ doc }) {
  const [pdfUrl, setPdfUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!doc) return;
    let active = true;
    let objectUrl = "";
    setLoading(true);
    setError("");
    setPdfUrl("");

    const endpoint =
      doc.kind === "credit_note"
        ? `/invoices/credit-notes/${doc.id}/pdf`
        : `/invoices/${doc.id}/pdf`;

    api
      .get(endpoint, { responseType: "blob" })
      .then((res) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
        setPdfUrl(objectUrl);
      })
      .catch(() => {
        if (active) setError("No se pudo cargar el PDF.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doc?.id, doc?.kind]);

  if (!doc) return null;

  return (
    <div className="bg-white border rounded-lg p-3">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm">
          <b>{doc.kind === "credit_note" ? "Nota de crédito" : "Factura"}</b>
          {doc.number ? ` — ${doc.number}` : ""}
        </div>
        {pdfUrl && (
          <button
            type="button"
            className="text-sm underline"
            onClick={() => window.open(pdfUrl, "_blank")}
          >
            Abrir en pestaña nueva
          </button>
        )}
      </div>
      {loading && <div className="text-sm text-slate-500">Cargando PDF…</div>}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && pdfUrl && (
        <div className="h-[70vh]">
          <iframe src={pdfUrl} title={`${doc.kind}-${doc.id}`} className="w-full h-full border rounded" />
        </div>
      )}
    </div>
  );
}

export default function ServiceCaseDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const caseId = Number(id || 0);
  const [tab, setTab] = useState("detalle");
  const [expenseOpenKey, setExpenseOpenKey] = useState(0);
  const [serviceQuoteId, setServiceQuoteId] = useState(null);
  const [serviceQuoteRevisions, setServiceQuoteRevisions] = useState([]);
  const [opDocs, setOpDocs] = useState([]);
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [doorHistory, setDoorHistory] = useState([]);
  const [doorPartsByDoor, setDoorPartsByDoor] = useState({});
  const [loadingDoorParts, setLoadingDoorParts] = useState(false);
  const [orderFields, setOrderFields] = useState({ calcomania: "", tecnicos_responsables: "" });
  const [users, setUsers] = useState([]);
  const [salePrice, setSalePrice] = useState("");
  const salePriceDisplay = (() => {
    const n = Number(salePrice);
    if (Number.isFinite(n)) return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return salePrice || "-";
  })();
  const [doorData, setDoorData] = useState(null);
  const [caseDoors, setCaseDoors] = useState([]);
  const [selectedDoorId, setSelectedDoorId] = useState(null);
  const [doorWorkDraft, setDoorWorkDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [invoiceLock, setInvoiceLock] = useState({ locked: false, count: 0 });
  const [invoiceLockLoading, setInvoiceLockLoading] = useState(false);
  const [quoteReloadKey, setQuoteReloadKey] = useState(0);
  const syncTimerRef = useRef(null);
  const syncingRef = useRef(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [invoiceAdditionId, setInvoiceAdditionId] = useState(null);
  const [additionalQuotes, setAdditionalQuotes] = useState([]);
  const [additionalLoading, setAdditionalLoading] = useState(false);
  const [branches, setBranches] = useState([]);
  const [branchFormOpen, setBranchFormOpen] = useState(false);
  const [newBranch, setNewBranch] = useState({
    name: "",
    address: "",
    city: "",
    country: "",
  });
  const [allDoors, setAllDoors] = useState([]);
  const [doorsPickerOpen, setDoorsPickerOpen] = useState(false);
  const [doorSearch, setDoorSearch] = useState("");
  const [doorSelection, setDoorSelection] = useState([]);
  const isAdmin = String(user?.role || "").toLowerCase() === "admin";
  const requestedTab = String(searchParams.get("tab") || "").toLowerCase();

  const isLocked = Boolean(invoiceLock?.locked);
  const lockClass = isLocked ? "pointer-events-none opacity-60" : "";

  const defaultDoorWork = useMemo(
    () => ({
      work_type: [],
      maintenance_detail: "",
      repair_detail: "",
      parts_components: [],
      parts_actuators: [],
      work_done: "",
      parts_used: "",
      cost: "",
    }),
    []
  );

  const currentDoorDraft = useMemo(() => {
    if (!selectedDoorId) return defaultDoorWork;
    return doorWorkDraft[selectedDoorId] || defaultDoorWork;
  }, [selectedDoorId, doorWorkDraft, defaultDoorWork]);

  const filteredOrgDoors = useMemo(() => {
    const orgId = data?.org_id;
    let list = allDoors;
    if (orgId) list = list.filter((d) => String(d.org_id) === String(orgId));
    const q = String(doorSearch || "").toLowerCase().trim();
    if (!q) return list;
    return list.filter((d) => {
      return (
        String(d.nombre || "").toLowerCase().includes(q) ||
        String(d.placa_id || "").toLowerCase().includes(q) ||
        String(d.modelo || "").toLowerCase().includes(q) ||
        String(d.marca || "").toLowerCase().includes(q) ||
        String(d.ref_int || "").toLowerCase().includes(q)
      );
    });
  }, [allDoors, data?.org_id, doorSearch]);

  function setCurrentDoorDraft(updater) {
    if (!selectedDoorId) return;
    setDoorWorkDraft((prev) => {
      const cur = prev[selectedDoorId] || defaultDoorWork;
      const next = typeof updater === "function" ? updater(cur) : updater;
      return { ...prev, [selectedDoorId]: next };
    });
  }

  const form = useMemo(() => {
    if (!data) return null;
    return {
      status: data.status || "abierto",
      assigned_to: data.assigned_to || "",
      scheduled_date: data.scheduled_date || "",
      closed_date: data.closed_date || "",
      work_done: data.work_done || "",
      parts_used: data.parts_used || "",
      cost: data.cost || "",
      org_branch_id: data.org_branch_id || "",
      work_type: data.work_type || "",
      maintenance_detail: data.maintenance_detail || "",
      repair_detail: data.repair_detail || "",
      parts_components: safeJsonArray(data.parts_components),
      parts_actuators: safeJsonArray(data.parts_actuators),
    };
  }, [data]);

  const [draft, setDraft] = useState(null);

  useEffect(() => {
    if (form) setDraft(form);
  }, [form]);

  useEffect(() => {
    if (!isAdmin) return;
    if (requestedTab === "administracion") {
      setTab("administracion");
    }
  }, [isAdmin, requestedTab, caseId]);

  function handleTabChange(nextTab) {
    setTab(nextTab);
    const nextParams = new URLSearchParams(searchParams);
    if (isAdmin && nextTab === "administracion") nextParams.set("tab", "administracion");
    else nextParams.delete("tab");
    setSearchParams(nextParams, { replace: true });
  }

  useEffect(() => {
    if (!caseId) return;
    (async () => {
      try {
        const [{ data: caseRes }, { data: histRes }, { data: usersRes }, { data: doorHistRes }, { data: customRes }, { data: addRes }] = await Promise.all([
          api.get(`/service/cases/${caseId}`),
          api.get(`/service/cases/${caseId}/history`).catch(() => ({ data: [] })),
          api.get("/users/select?active=1").catch(() => ({ data: [] })),
          api.get(`/service/cases/${caseId}/door-history`).catch(() => ({ data: [] })),
          api.get(`/service/cases/${caseId}/custom-fields`).catch(() => ({ data: [] })),
          api.get(`/service/cases/${caseId}/additional-quotes`).catch(() => ({ data: [] })),
        ]);
        setData(caseRes?.case || caseRes);
        const doorsArr = Array.isArray(caseRes?.doors) ? caseRes.doors : [];
        setCaseDoors(doorsArr);
        setHistory(Array.isArray(histRes) ? histRes : []);
        setUsers(Array.isArray(usersRes) ? usersRes : []);
        setDoorHistory(Array.isArray(doorHistRes) ? doorHistRes : []);
        setAdditionalQuotes(Array.isArray(addRes) ? addRes : []);
        const cfList = Array.isArray(customRes) ? customRes : [];
        const cfMap = cfList.reduce((acc, row) => {
          if (row?.key) acc[row.key] = row.value ?? "";
          return acc;
        }, {});
        setOrderFields({
          calcomania: cfMap.calcomania || "",
          tecnicos_responsables: cfMap.tecnicos_responsables || "",
        });
        const caseData = caseRes?.case || caseRes;
        const doorId = caseData?.door_id;
        try {
          const quoteRes = await api.get(`/service/cases/${caseId}/quote`).catch(() => null);
          const computed = quoteRes?.data?.computed;
          const total = computed?.oferta?.totals?.total_sales_usd;
          setSalePrice(typeof total === 'number' ? total : (total || ''));
          const qid = quoteRes?.data?.id || null;
          setServiceQuoteId(qid);
          if (qid) {
            const { data: revs } = await api
              .get(`/service/quotes/${qid}/revisions`)
              .catch(() => ({ data: [] }));
            setServiceQuoteRevisions(Array.isArray(revs) ? revs : []);
          } else {
            setServiceQuoteRevisions([]);
          }
        } catch (_) {
          setServiceQuoteRevisions([]);
        }
        if (!selectedDoorId && doorsArr.length) {
          setSelectedDoorId(doorsArr[0].id);
        }
        setDoorSelection(doorsArr.map((d) => d.id));
        const normalizeWorkType = (val) => {
          if (!val) return [];
          if (Array.isArray(val)) return val;
          try {
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed)) return parsed;
          } catch (_) {}
          return [String(val)];
        };

        setDoorWorkDraft((prev) => {
          const next = { ...prev };
          for (const d of doorsArr) {
            next[d.id] = {
              work_type: normalizeWorkType(d.work_type),
              maintenance_detail: d.maintenance_detail || "",
              repair_detail: d.repair_detail || "",
              revision_detail: d.revision_detail || "",
              parts_components: safeJsonArray(d.parts_components),
              parts_actuators: safeJsonArray(d.parts_actuators),
              work_done: d.work_done || "",
              parts_used: d.parts_used || "",
              cost: d.cost || "",
            };
          }
          return next;
        });
      } catch (e) {
        setError("No se pudo cargar el servicio");
      }
    })();
  }, [caseId]);

  useEffect(() => {
    if (!caseId || !selectedDoorId) return;
    let mounted = true;
    (async () => {
      setLoadingDoorParts(true);
      try {
        const { data } = await api.get(`/service/cases/${caseId}/doors/${selectedDoorId}/parts`);
        if (!mounted) return;
        setDoorPartsByDoor((prev) => ({
          ...prev,
          [selectedDoorId]: Array.isArray(data) ? data : [],
        }));
      } catch (_) {
        if (!mounted) return;
        setDoorPartsByDoor((prev) => ({ ...prev, [selectedDoorId]: [] }));
      } finally {
        if (mounted) setLoadingDoorParts(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [caseId, selectedDoorId]);

  const baseTabs = [
    { id: "detalle", label: "Detalle" },
    { id: "oferta", label: "Detalle de oferta" },
    { id: "presupuesto", label: "Presupuesto" },
    { id: "informes", label: "Informes" },
    { id: "gastos", label: "Gastos" },
    ...(isAdmin ? [{ id: "administracion", label: "Administración" }] : []),
  ];

  useEffect(() => {
    if (!caseId) return;
    let live = true;
    api
      .get("/invoices/operation-docs", { params: { service_case_id: caseId } })
      .then(({ data }) => {
        if (!live) return;
        setOpDocs(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!live) return;
        setOpDocs([]);
      });
    return () => {
      live = false;
    };
  }, [caseId]);

  const docTabs = opDocs.map((d) => ({
    id: `doc-${d.kind}-${d.id}`,
    label: `${d.kind === "credit_note" ? "NC" : "Factura"} ${d.number || d.id}`,
  }));

  const revisionTabs = serviceQuoteRevisions.map((r) => ({
    id: `rev-${r.id}`,
    label: r.name || `Rev ${r.id}`,
    revisionId: r.id,
  }));

  const allTabs = [...baseTabs, ...revisionTabs, ...docTabs];

  const isRevisionTab = (id) => String(id).startsWith("rev-");
  const getRevisionIdFromTab = (id) => {
    const sid = String(id);
    if (!sid.startsWith("rev-")) return null;
    const revId = Number(sid.slice(4));
    return Number.isFinite(revId) ? revId : null;
  };
  const getStoredIndustrialRevisionId = () => {
    try {
      const raw = window.sessionStorage.getItem(`industrial-quote-revision:service:${Number(caseId)}`);
      const parsed = Number(raw || 0);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    } catch (_) {
      return null;
    }
  };
  const [selectedQuoteRevisionId, setSelectedQuoteRevisionId] = useState(() => getStoredIndustrialRevisionId());

  useEffect(() => {
    setSelectedQuoteRevisionId(getStoredIndustrialRevisionId());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  useEffect(() => {
    function handleQuoteRevisionSelected(e) {
      if (Number(e?.detail?.serviceCaseId || 0) !== Number(caseId)) return;
      setSelectedQuoteRevisionId(e?.detail?.revisionId || null);
    }
    window.addEventListener("quote-revision-selected", handleQuoteRevisionSelected);
    return () => window.removeEventListener("quote-revision-selected", handleQuoteRevisionSelected);
  }, [caseId]);
  const currentIndustrialRevisionId = isRevisionTab(tab)
    ? getRevisionIdFromTab(tab)
    : selectedQuoteRevisionId;
  const serviceIndustrialQuoteHref = currentIndustrialRevisionId
    ? `/service/cases/${caseId}/industrial-quote?serviceCaseId=${caseId}&revision_id=${currentIndustrialRevisionId}`
    : `/service/cases/${caseId}/industrial-quote?serviceCaseId=${caseId}`;

  const isDocTab = (id) => String(id).startsWith("doc-");
  const getDocFromTab = (id) => {
    const sid = String(id);
    if (!sid.startsWith("doc-")) return null;
    const parts = sid.split("-");
    const kind = parts[1];
    const docId = parts.slice(2).join("-");
    return opDocs.find((d) => String(d.id) === String(docId) && d.kind === kind) || null;
  };

  useEffect(() => {
    if (!serviceQuoteId) return;
    function handleRevisionCreated(e) {
      if (e?.detail?.quoteId && Number(e.detail.quoteId) === Number(serviceQuoteId)) {
        api
          .get(`/service/quotes/${serviceQuoteId}/revisions`)
          .then(({ data }) => setServiceQuoteRevisions(Array.isArray(data) ? data : []))
          .catch(() => setServiceQuoteRevisions([]));
      }
    }
    window.addEventListener("quote-revision-created", handleRevisionCreated);
    return () => window.removeEventListener("quote-revision-created", handleRevisionCreated);
  }, [serviceQuoteId]);

  useEffect(() => {
    if (!caseId) {
      setInvoiceLock({ locked: false, count: 0 });
      return;
    }
    let live = true;
    (async () => {
      setInvoiceLockLoading(true);
      try {
        const { data: lockRes } = await api.get("/invoices/lock-status", {
          params: { service_case_id: caseId },
        });
        if (live) {
          setInvoiceLock({
            locked: Boolean(lockRes?.locked),
            count: Number(lockRes?.count || 0),
          });
        }
      } catch (_) {
        if (live) setInvoiceLock({ locked: false, count: 0 });
      } finally {
        if (live) setInvoiceLockLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [caseId]);

  useEffect(() => {
    let live = true;
    const orgId = data?.org_id;
    if (!orgId) {
      setBranches([]);
      return undefined;
    }
    (async () => {
      try {
        const { data: branchRes } = await api.get(`/organizations/${orgId}/branches`);
        if (live) setBranches(Array.isArray(branchRes) ? branchRes : []);
      } catch (_) {
        if (live) setBranches([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [data?.org_id]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data: doorsRes } = await api.get("/service/doors");
        if (!live) return;
        setAllDoors(Array.isArray(doorsRes) ? doorsRes : []);
      } catch (_) {
        if (live) setAllDoors([]);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    if (!selectedDoorId) {
      setDoorData(null);
      return undefined;
    }
    (async () => {
      try {
        const doorRes = await api.get(`/service/doors/${selectedDoorId}`);
        if (live) setDoorData(doorRes?.data || null);
      } catch (_) {
        if (live) setDoorData(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [selectedDoorId]);

  async function createBranch() {
    if (!data?.org_id) return;
    const payload = {
      name: newBranch.name?.trim() || null,
      address: newBranch.address?.trim() || null,
      city: newBranch.city?.trim() || null,
      country: newBranch.country?.trim() || null,
    };
    if (!payload.name && !payload.address) return;
    try {
      const { data: created } = await api.post(`/organizations/${data.org_id}/branches`, payload);
      const branch = created || null;
      if (branch) {
        setBranches((prev) => [...prev, branch]);
        setDraft((d) => (d ? { ...d, org_branch_id: branch.id } : d));
      }
      setBranchFormOpen(false);
      setNewBranch({ name: "", address: "", city: "", country: "" });
    } catch (e) {
      console.error("No se pudo crear sucursal", e);
    }
  }

  async function saveCase() {
    if (!draft) return;
    if (isLocked) {
      setError("Servicio facturado. No se puede modificar.");
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/service/cases/${caseId}`, {
        status: draft.status || null,
        assigned_to: draft.assigned_to || null,
        scheduled_date: draft.scheduled_date || null,
        closed_date: draft.closed_date || null,
        work_done: draft.work_done || null,
        parts_used: draft.parts_used || null,
        cost: draft.cost || null,
        org_branch_id: draft.org_branch_id || null,
      });
      if (selectedDoorId) {
        await api.patch(`/service/cases/${caseId}/doors/${selectedDoorId}`, {
          work_type: JSON.stringify(currentDoorDraft.work_type || []),
          maintenance_detail: currentDoorDraft.maintenance_detail || null,
          repair_detail: currentDoorDraft.repair_detail || null,
          revision_detail: currentDoorDraft.revision_detail || null,
          parts_components: JSON.stringify(currentDoorDraft.parts_components || []),
          parts_actuators: JSON.stringify(currentDoorDraft.parts_actuators || []),
          work_done: currentDoorDraft.work_done || null,
          parts_used: currentDoorDraft.parts_used || null,
          cost: currentDoorDraft.cost || null,
        });
        const parts = doorPartsByDoor[selectedDoorId] || [];
        await api.put(`/service/cases/${caseId}/doors/${selectedDoorId}/parts`, {
          parts,
        });
      }
      await api.post(`/service/cases/${caseId}/custom-fields`, {
        key: "calcomania",
        value: orderFields.calcomania || null,
      });
      await api.post(`/service/cases/${caseId}/custom-fields`, {
        key: "tecnicos_responsables",
        value: orderFields.tecnicos_responsables || null,
      });
      if (serviceQuoteId) {
        try {
          await api.post(`/service/quotes/${serviceQuoteId}/recalculate`);
          const quoteRes = await api.get(`/service/cases/${caseId}/quote`).catch(() => null);
          const computed = quoteRes?.data?.computed;
          const total = computed?.oferta?.totals?.total_sales_usd;
          setSalePrice(typeof total === 'number' ? total : (total || ''));
        } catch (_) {}
      }
      const { data: caseRes } = await api.get(`/service/cases/${caseId}`);
      setData(caseRes?.case || caseRes);
      const doorsArr = Array.isArray(caseRes?.doors) ? caseRes.doors : [];
      setCaseDoors(doorsArr);
      setQuoteReloadKey((k) => k + 1);
    } catch (e) {
      setError("No se pudo guardar el servicio");
    } finally {
      setSaving(false);
    }
  }

  async function openWorkOrderHtml() {
    try {
      const res = await api.get(`/service/cases/${caseId}/work-order`, { responseType: "text" });
      const html = typeof res.data === "string" ? res.data : String(res.data || "");
      const win = window.open("", "_blank");
      if (win) {
        win.document.open();
        win.document.write(html);
        win.document.close();
      }
    } catch (e) {
      alert(e.response?.data?.error || "No se pudo abrir la orden de servicio");
    }
  }

  async function openWorkOrderPdf() {
    try {
      const res = await api.get(`/service/cases/${caseId}/work-order/pdf`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      window.open(url, "_blank");
      setTimeout(() => window.URL.revokeObjectURL(url), 10000);
    } catch (e) {
      alert(e.response?.data?.error || "No se pudo abrir el PDF");
    }
  }

  async function createAdditionalQuote() {
    if (!caseId) return;
    try {
      setAdditionalLoading(true);
      const { data } = await api.post(`/service/cases/${caseId}/additional-quotes`);
      const createdId = data?.id;
      const { data: list } = await api.get(`/service/cases/${caseId}/additional-quotes`).catch(() => ({ data: [] }));
      setAdditionalQuotes(Array.isArray(list) ? list : []);
      if (createdId) {
        window.open(`/service/additional-quotes/${createdId}?caseId=${caseId}`, "_blank");
      }
    } catch (e) {
      alert(e.response?.data?.error || "No se pudo crear adicional");
    } finally {
      setAdditionalLoading(false);
    }
  }

  function openAdditionalQuote(id) {
    window.open(`/service/additional-quotes/${id}?caseId=${caseId}`, "_blank");
  }

  function openAdditionalInvoice(additionId) {
    setInvoiceAdditionId(additionId);
    setShowInvoiceModal(true);
  }

  async function saveDoorSelection() {
    try {
      const ids = Array.from(new Set(doorSelection.map((x) => Number(x)).filter(Boolean)));
      if (!ids.length) return;
      await api.patch(`/service/cases/${caseId}`, { door_ids: ids });
      const { data: caseRes } = await api.get(`/service/cases/${caseId}`);
      const doorsArr = Array.isArray(caseRes?.doors) ? caseRes.doors : [];
      setCaseDoors(doorsArr);
      if (!selectedDoorId && doorsArr.length) setSelectedDoorId(doorsArr[0].id);
      setDoorSelection(doorsArr.map((d) => d.id));
      setDoorsPickerOpen(false);
    } catch (_) {
      setError("No se pudo actualizar las puertas");
    }
  }

  const currentDoorParts = useMemo(() => {
    if (!selectedDoorId) return [];
    return doorPartsByDoor[selectedDoorId] || [];
  }, [doorPartsByDoor, selectedDoorId]);

  const currentDoorPartsTotals = useMemo(() => {
    return (currentDoorParts || []).reduce(
      (acc, p) => {
        const curr = String(p.currency || "PYG").toUpperCase();
        const qty = Number(p.quantity || 0);
        const unit = Number(p.unit_cost || 0);
        if (!acc[curr]) acc[curr] = 0;
        acc[curr] += qty * unit;
        return acc;
      },
      {}
    );
  }, [currentDoorParts]);

  function updateDoorPart(idx, field, value) {
    if (!selectedDoorId) return;
    setDoorPartsByDoor((prev) => {
      const list = Array.isArray(prev[selectedDoorId]) ? [...prev[selectedDoorId]] : [];
      if (!list[idx]) return prev;
      list[idx] = { ...list[idx], [field]: value };
      return { ...prev, [selectedDoorId]: list };
    });
  }

  function addDoorPart() {
    if (!selectedDoorId) return;
    setDoorPartsByDoor((prev) => {
      const list = Array.isArray(prev[selectedDoorId]) ? [...prev[selectedDoorId]] : [];
      list.push({
        part_name: "",
        quantity: 1,
        unit_cost: "",
        currency: "PYG",
        notes: "",
      });
      return { ...prev, [selectedDoorId]: list };
    });
  }

  function removeDoorPart(idx) {
    if (!selectedDoorId) return;
    setDoorPartsByDoor((prev) => {
      const list = Array.isArray(prev[selectedDoorId]) ? [...prev[selectedDoorId]] : [];
      list.splice(idx, 1);
      return { ...prev, [selectedDoorId]: list };
    });
  }


  // La carga de items se hace al guardar el servicio (backend).

  if (error) return <div className="text-red-600">{error}</div>;
  if (!data || !draft) return <div className="text-slate-500">Cargando...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Servicio {data.reference || `#${data.id}`}</h1>
          <div className="text-sm text-slate-500">
            {data.org_name || ""} {data.org_ruc ? `? ${data.org_ruc}` : ""}
          </div>
        </div>
        <div className="flex gap-2">
          <Link className="text-blue-600 underline" to="/service">
            Volver
          </Link>
        </div>
      </div>

      <div className="bg-white border rounded-2xl p-2 flex flex-wrap gap-2 shadow-sm">
        {allTabs.map((t) => (
          <TabButton key={t.id} active={tab === t.id} onClick={() => handleTabChange(t.id)}>
            {t.label}
          </TabButton>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6">
        <div className="lg:col-span-1">
          {tab === "detalle" && (
            <div className="space-y-4">
              {isLocked && (
                <div className="p-3 rounded border border-amber-200 bg-amber-50 text-amber-800 text-sm">
                  Servicio facturado. No se puede modificar el detalle.
                </div>
              )}
              <fieldset disabled={isLocked} className={lockClass}>
              <div className="bg-white border rounded-lg p-4">
                <div className="text-sm font-semibold mb-3">Datos generales</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-slate-500">Cliente</div>
                    <div>{data.org_name || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">RUC</div>
                    <div>{data.org_ruc || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Sucursal (facturación)</div>
                    <select
                      className="border rounded px-2 py-1 w-full mt-1"
                      value={draft?.org_branch_id || ""}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, org_branch_id: e.target.value }))
                      }
                    >
                      <option value="">— Dirección principal —</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name || b.address || `Sucursal ${b.id}`}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="text-xs text-blue-600 hover:underline mt-1"
                      onClick={() => setBranchFormOpen((v) => !v)}
                    >
                      {branchFormOpen ? "Cerrar" : "Agregar sucursal"}
                    </button>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Dirección sucursal</div>
                    <div>
                      {branches.find((b) => b.id === Number(draft?.org_branch_id))?.address ||
                        "-"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Puerta principal</div>
                    <div>
                      {data.nombre || data.placa_id || "-"}
                      {data.sector ? ` · ${data.sector}` : ""}
                      {data.modelo ? ` (${data.modelo})` : ""}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Dimensiones</div>
                    <div>{data.dimensiones || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Instalacion</div>
                    <div>{(data.fecha_instalacion || "").slice(0,10) || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Ult. mantenimiento puerta</div>
                    <div>{(data.fecha_ultimo_mantenimiento || "").slice(0,10) || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Etapa</div>
                    <div>{data.stage_name || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Ultima cotizacion</div>
                    <div>{(data.last_quote_at || "").slice(0,10) || "-"}</div>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs text-slate-500">
                      Puertas del servicio ({caseDoors.length})
                    </div>
                    <button
                      type="button"
                      className="text-xs text-blue-600 hover:underline"
                      onClick={() => setDoorsPickerOpen((v) => !v)}
                    >
                      {doorsPickerOpen ? "Cerrar" : "Agregar puertas"}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {caseDoors.length === 0 && (
                      <div className="text-xs text-slate-400">Sin puertas asociadas</div>
                    )}
                    {caseDoors.map((d) => (
                      <Link
                        key={d.id}
                        to={`/service/doors/${d.id}`}
                        className="px-2 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200"
                      >
                        {(d.nombre || d.placa_id || `Puerta ${d.id}`)}
                        {d.sector ? ` · ${d.sector}` : ""}
                        {d.modelo ? ` (${d.modelo})` : ""}
                      </Link>
                    ))}
                  </div>
                  {doorsPickerOpen && (
                    <div className="mt-3 border rounded-lg p-3">
                      <div className="text-xs text-slate-500 mb-2">Seleccionar puertas</div>
                      <input
                        className="w-full border rounded px-2 py-1 text-sm mb-2"
                        placeholder="Buscar por placa, modelo, marca o ref int"
                        value={doorSearch}
                        onChange={(e) => setDoorSearch(e.target.value)}
                      />
                      <div className="max-h-40 overflow-auto space-y-1">
                        {filteredOrgDoors.map((d) => {
                          const checked = doorSelection.includes(d.id);
                          return (
                            <label key={d.id} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  const next = checked
                                    ? doorSelection.filter((id) => id !== d.id)
                                    : [...doorSelection, d.id];
                                  setDoorSelection(next);
                                }}
                              />
                              <span className="truncate">
                                {(d.nombre || d.placa_id || `Puerta ${d.id}`)}
                                {d.sector ? ` · ${d.sector}` : ""}
                                {d.modelo ? ` (${d.modelo})` : ""}
                              </span>
                            </label>
                          );
                        })}
                        {filteredOrgDoors.length === 0 && (
                          <div className="text-xs text-slate-400">Sin puertas para mostrar</div>
                        )}
                      </div>
                      <div className="mt-3 flex justify-end gap-2">
                        <button
                          type="button"
                          className="px-3 py-2 rounded border text-sm"
                          onClick={() => setDoorsPickerOpen(false)}
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          className="px-3 py-2 rounded bg-black text-white text-sm"
                          onClick={saveDoorSelection}
                        >
                          Guardar puertas
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {branchFormOpen && (
                <div className="bg-white border rounded-lg p-4">
                  <div className="text-sm font-semibold mb-3">Nueva sucursal</div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div>
                      <label className="text-xs text-slate-500">Nombre</label>
                      <input
                        className="border rounded px-2 py-1 w-full mt-1"
                        value={newBranch.name}
                        onChange={(e) => setNewBranch((prev) => ({ ...prev, name: e.target.value }))}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-xs text-slate-500">Dirección</label>
                      <input
                        className="border rounded px-2 py-1 w-full mt-1"
                        value={newBranch.address}
                        onChange={(e) => setNewBranch((prev) => ({ ...prev, address: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">Ciudad</label>
                      <input
                        className="border rounded px-2 py-1 w-full mt-1"
                        value={newBranch.city}
                        onChange={(e) => setNewBranch((prev) => ({ ...prev, city: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">País</label>
                      <input
                        className="border rounded px-2 py-1 w-full mt-1"
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

              <div className="bg-white border rounded-lg p-4">
                <div className="text-sm font-semibold mb-3">Detalle del servicio</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Estado</label>
                    <select
                      className="border rounded px-2 py-1 w-full"
                      value={draft.status}
                      onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
                    >
                      <option value="abierto">Abierto</option>
                      <option value="en_proceso">En proceso</option>
                      <option value="cerrado">Cerrado</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Asignado a</label>
                    <select
                      className="border rounded px-2 py-1 w-full"
                      value={draft.assigned_to}
                      onChange={(e) => setDraft((d) => ({ ...d, assigned_to: e.target.value }))}
                    >
                      <option value="">Sin asignar</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Programado</label>
                    <input
                      type="date"
                      className="border rounded px-2 py-1 w-full"
                      value={(draft.scheduled_date || "").slice(0,10)}
                      onChange={(e) => setDraft((d) => ({ ...d, scheduled_date: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Cierre</label>
                    <input
                      type="date"
                      className="border rounded px-2 py-1 w-full"
                      value={(draft.closed_date || "").slice(0,10)}
                      onChange={(e) => setDraft((d) => ({ ...d, closed_date: e.target.value }))}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-xs text-slate-500 mb-2">Puertas del servicio</div>
                    <div className="flex flex-wrap gap-2">
                      {caseDoors.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          className={
                            "px-2 py-1 rounded text-xs border " +
                            (String(selectedDoorId) === String(d.id)
                              ? "bg-black text-white border-black"
                              : "bg-white hover:bg-slate-50")
                          }
                          onClick={() => setSelectedDoorId(d.id)}
                        >
                          {d.placa_id || `Puerta ${d.id}`}
                        </button>
                      ))}
                      {caseDoors.length === 0 && (
                        <span className="text-xs text-slate-400">Sin puertas</span>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-slate-500">Trabajo a realizar</label>
                    <div className="border rounded px-2 py-2 space-y-2">
                      {[
                        { key: "mantenimiento", label: "Mantenimiento" },
                        { key: "reparacion", label: "Reparacion" },
                        { key: "cambio_piezas", label: "Cambio de piezas" },
                        { key: "revision", label: "Revision" },
                      ].map((opt) => {
                        const list = Array.isArray(currentDoorDraft.work_type)
                          ? currentDoorDraft.work_type
                          : [];
                        const checked = list.includes(opt.key);
                        return (
                          <label key={opt.key} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const next = checked ? [] : [opt.key];
                                setCurrentDoorDraft((d) => {
                                  const base = {
                                    ...d,
                                    work_type: next,
                                  };
                                  if (next.includes("mantenimiento")) {
                                    return {
                                      ...base,
                                      repair_detail: "",
                                      parts_components: [],
                                      parts_actuators: [],
                                    };
                                  }
                                  if (next.includes("reparacion")) {
                                    return {
                                      ...base,
                                      maintenance_detail: "",
                                      parts_components: [],
                                      parts_actuators: [],
                                    };
                                  }
                                  if (next.includes("cambio_piezas")) {
                                    return {
                                      ...base,
                                      maintenance_detail: "",
                                      repair_detail: "",
                                    };
                                  }
                                  if (next.includes("revision")) {
                                    return {
                                      ...base,
                                      maintenance_detail: "",
                                      repair_detail: "",
                                      parts_components: [],
                                      parts_actuators: [],
                                    };
                                  }
                                  // ninguno seleccionado
                                  return {
                                    ...base,
                                    maintenance_detail: "",
                                    repair_detail: "",
                                    parts_components: [],
                                    parts_actuators: [],
                                  };
                                });
                              }}
                            />
                            <span>{opt.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {(currentDoorDraft.work_type || []).includes("mantenimiento") && (
                    <div className="md:col-span-2">
                      <label className="text-xs text-slate-500">Detalle del mantenimiento</label>
                      <textarea
                        className="border rounded px-2 py-1 w-full"
                        rows={3}
                        value={currentDoorDraft.maintenance_detail}
                        onChange={(e) =>
                          setCurrentDoorDraft((d) => ({ ...d, maintenance_detail: e.target.value }))
                        }
                      />
                    </div>
                  )}

                  {(currentDoorDraft.work_type || []).includes("reparacion") && (
                    <div className="md:col-span-2">
                      <label className="text-xs text-slate-500">Detalle de reparacion</label>
                      <textarea
                        className="border rounded px-2 py-1 w-full"
                        rows={3}
                        value={currentDoorDraft.repair_detail}
                        onChange={(e) =>
                          setCurrentDoorDraft((d) => ({ ...d, repair_detail: e.target.value }))
                        }
                      />
                    </div>
                  )}

                  {(currentDoorDraft.work_type || []).includes("revision") && (
                    <div className="md:col-span-2">
                      <label className="text-xs text-slate-500">Detalle de revision</label>
                      <textarea
                        className="border rounded px-2 py-1 w-full"
                        rows={3}
                        value={currentDoorDraft.revision_detail}
                        onChange={(e) =>
                          setCurrentDoorDraft((d) => ({ ...d, revision_detail: e.target.value }))
                        }
                      />
                    </div>
                  )}

                  {(currentDoorDraft.work_type || []).includes("cambio_piezas") && (
                    <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Componentes</div>
                        <div className="border rounded p-2 max-h-40 overflow-auto space-y-1">
                          {(doorData?.components || []).map((c) => (
                            <label key={c.id} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={(currentDoorDraft.parts_components || []).includes(c.name)}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setCurrentDoorDraft((d) => {
                                    const cur = new Set(d.parts_components || []);
                                    if (checked) cur.add(c.name); else cur.delete(c.name);
                                    return { ...d, parts_components: Array.from(cur) };
                                  });
                                }}
                              />
                              <span>{c.name}</span>
                            </label>
                          ))}
                          {(!doorData?.components || doorData.components.length === 0) && (
                            <div className="text-xs text-slate-500">Sin componentes</div>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Accionadores</div>
                        <div className="border rounded p-2 max-h-40 overflow-auto space-y-1">
                          {(doorData?.actuators || []).map((a) => (
                            <label key={a.id} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={(currentDoorDraft.parts_actuators || []).includes(a.name)}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setCurrentDoorDraft((d) => {
                                    const cur = new Set(d.parts_actuators || []);
                                    if (checked) cur.add(a.name); else cur.delete(a.name);
                                    return { ...d, parts_actuators: Array.from(cur) };
                                  });
                                }}
                              />
                              <span>{a.name}</span>
                            </label>
                          ))}
                          {(!doorData?.actuators || doorData.actuators.length === 0) && (
                            <div className="text-xs text-slate-500">Sin accionadores</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="md:col-span-2">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs text-slate-500">Piezas cambiadas (detalle)</div>
                      <button
                        type="button"
                        className="px-2 py-1 text-xs rounded bg-slate-900 text-white"
                        onClick={addDoorPart}
                      >
                        + Agregar pieza
                      </button>
                    </div>
                    {loadingDoorParts ? (
                      <div className="text-xs text-slate-500">Cargando piezas...</div>
                    ) : (
                      <div className="overflow-auto border rounded">
                        <table className="min-w-full text-sm">
                          <thead className="bg-slate-100 text-slate-600">
                            <tr>
                              <th className="text-left px-2 py-2">Pieza</th>
                              <th className="text-left px-2 py-2">Cantidad</th>
                              <th className="text-left px-2 py-2">Costo unit.</th>
                              <th className="text-left px-2 py-2">Moneda</th>
                              <th className="text-left px-2 py-2">Notas</th>
                              <th className="text-left px-2 py-2">Accion</th>
                            </tr>
                          </thead>
                          <tbody>
                            {currentDoorParts.length ? (
                              currentDoorParts.map((p, idx) => (
                                <tr key={`${idx}-${p.id || "new"}`} className="border-t">
                                  <td className="px-2 py-1">
                                    <input
                                      className="w-full border rounded px-2 py-1"
                                      value={p.part_name || ""}
                                      onChange={(e) => updateDoorPart(idx, "part_name", e.target.value)}
                                    />
                                  </td>
                                  <td className="px-2 py-1">
                                    <input
                                      type="number"
                                      className="w-24 border rounded px-2 py-1"
                                      value={p.quantity ?? 1}
                                      onChange={(e) => updateDoorPart(idx, "quantity", e.target.value)}
                                    />
                                  </td>
                                  <td className="px-2 py-1">
                                    <input
                                      type="number"
                                      className="w-28 border rounded px-2 py-1"
                                      value={p.unit_cost ?? ""}
                                      onChange={(e) => updateDoorPart(idx, "unit_cost", e.target.value)}
                                    />
                                  </td>
                                  <td className="px-2 py-1">
                                    <select
                                      className="border rounded px-2 py-1"
                                      value={p.currency || "PYG"}
                                      onChange={(e) => updateDoorPart(idx, "currency", e.target.value)}
                                    >
                                      <option value="PYG">PYG</option>
                                      <option value="USD">USD</option>
                                    </select>
                                  </td>
                                  <td className="px-2 py-1">
                                    <input
                                      className="w-full border rounded px-2 py-1"
                                      value={p.notes || ""}
                                      onChange={(e) => updateDoorPart(idx, "notes", e.target.value)}
                                    />
                                  </td>
                                  <td className="px-2 py-1">
                                    <button
                                      type="button"
                                      className="text-xs text-red-600 hover:underline"
                                      onClick={() => removeDoorPart(idx)}
                                    >
                                      Quitar
                                    </button>
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={6} className="px-2 py-3 text-center text-xs text-slate-500">
                                  Sin piezas cargadas.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {Object.keys(currentDoorPartsTotals).length > 0 && (
                      <div className="mt-2 text-xs text-slate-600 flex flex-wrap gap-2">
                        {Object.entries(currentDoorPartsTotals).map(([curr, total]) => (
                          <span key={curr} className="px-2 py-1 rounded bg-slate-100">
                            Total piezas {curr}: {Number(total).toLocaleString()}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="text-xs text-slate-500 mb-1">Precio de venta (detalle oferta)</div>
                    <span className="inline-flex items-center px-2 py-1 rounded bg-emerald-100 text-emerald-700 text-sm">
                      USD {salePriceDisplay}
                    </span>
                  </div>

                  <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-500">Dato de calcomania</label>
                      <input
                        className="border rounded px-2 py-1 w-full"
                        value={orderFields.calcomania}
                        onChange={(e) => setOrderFields((f) => ({ ...f, calcomania: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">Tecnicos responsables</label>
                      <input
                        className="border rounded px-2 py-1 w-full"
                        value={orderFields.tecnicos_responsables}
                        onChange={(e) =>
                          setOrderFields((f) => ({ ...f, tecnicos_responsables: e.target.value }))
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <button
                  className="px-3 py-2 rounded bg-blue-600 text-white hover:opacity-90"
                  onClick={saveCase}
                  disabled={saving}
                >
                  Guardar
                </button>
              </div>
              </fieldset>
            </div>
          )}

          {isRevisionTab(tab) && (
            <div className="bg-white border rounded-lg p-3">
              <iframe
                title="Presupuesto revision"
                className="w-full h-[900px] border rounded-lg"
                src={`/service/cases/${caseId}/industrial-quote-embed?serviceCaseId=${caseId}&revision_id=${getRevisionIdFromTab(
                  tab
                )}&embed=1`}
              />
            </div>
          )}

          {isDocTab(tab) && (
            <OperationDocViewer doc={getDocFromTab(tab)} />
          )}

          {tab === "oferta" && (
            <div className="bg-white border rounded-lg p-3">
              <QuoteEditor key={quoteReloadKey} embedded serviceCaseId={caseId} />
            </div>
          )}

          {tab === "presupuesto" && (
            <div className="bg-white border rounded-lg p-3">
              <div className="text-sm text-slate-600 mb-2">Generador de presupuesto</div>
              <button
                className="px-3 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => window.open(serviceIndustrialQuoteHref, "_blank")}
              >
                Abrir PDF de cotizacion
              </button>
            </div>
          )}

          {tab === "informes" && (
            <div className="space-y-3">
              <div className="bg-white border rounded-lg p-3 flex items-center gap-2">
                <button
                  className="px-3 py-2 rounded bg-slate-900 text-white hover:opacity-90"
                  onClick={() => window.open(`/api/service/cases/${caseId}/report`, "_blank")}
                >
                  Ver informe
                </button>
                <button
                  className="px-3 py-2 rounded bg-indigo-600 text-white hover:opacity-90"
                  onClick={() => window.open(`/api/service/cases/${caseId}/report/pdf`, "_blank")}
                >
                  Descargar PDF
                </button>
                <button
                  className="px-3 py-2 rounded bg-amber-600 text-white hover:opacity-90"
                  onClick={openWorkOrderHtml}
                >
                  Ver orden de servicio
                </button>
                <button
                  className="px-3 py-2 rounded bg-orange-600 text-white hover:opacity-90"
                  onClick={openWorkOrderPdf}
                >
                  PDF orden de servicio
                </button>
              </div>

              <div className="bg-white border rounded-lg p-3">
                <div className="text-sm font-semibold mb-2">Historial confirmado por puerta</div>
                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-100 text-slate-600">
                      <tr>
                        <th className="text-left px-3 py-2">Fecha</th>
                        <th className="text-left px-3 py-2">Puerta</th>
                        <th className="text-left px-3 py-2">Trabajo</th>
                        <th className="text-left px-3 py-2">Detalle</th>
                        <th className="text-left px-3 py-2">Usuario</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doorHistory.length ? doorHistory.map((h) => {
                        const workType = Array.isArray(h.work_type)
                          ? h.work_type.join(", ")
                          : (() => {
                              try {
                                const parsed = JSON.parse(h.work_type);
                                if (Array.isArray(parsed)) return parsed.join(", ");
                              } catch (_) {}
                              return h.work_type || "-";
                            })();
                        const detail =
                          h.maintenance_detail ||
                          h.repair_detail ||
                          h.revision_detail ||
                          [h.parts_components, h.parts_actuators].filter(Boolean).join(" | ") ||
                          "";
                        return (
                          <tr key={h.id} className="border-t">
                            <td className="px-3 py-2">{String(h.created_at || "").slice(0,19).replace("T"," ")}</td>
                            <td className="px-3 py-2">{h.placa_id || `Puerta ${h.door_id}`}</td>
                            <td className="px-3 py-2">{workType}</td>
                            <td className="px-3 py-2">{detail || "-"}</td>
                            <td className="px-3 py-2">{h.user_name || "-"}</td>
                          </tr>
                        );
                      }) : (
                        <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-500">Sin historial confirmado.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white border rounded-lg p-3">
                <div className="text-sm font-semibold mb-2">Historial</div>
                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-100 text-slate-600">
                      <tr>
                        <th className="text-left px-3 py-2">Fecha</th>
                        <th className="text-left px-3 py-2">Accion</th>
                        <th className="text-left px-3 py-2">Usuario</th>
                        <th className="text-left px-3 py-2">Detalle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.length ? history.map((h) => (
                        <tr key={h.id} className="border-t">
                          <td className="px-3 py-2">{String(h.created_at || "").slice(0,19).replace("T"," ")}</td>
                          <td className="px-3 py-2">{h.action || "-"}</td>
                          <td className="px-3 py-2">{h.user_name || "-"}</td>
                          <td className="px-3 py-2">{h.notes || "-"}</td>
                        </tr>
                      )) : (
                        <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-500">Sin historial</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab === "gastos" && (
            <OperationExpenseInvoices
              operationId={caseId}
              operationType="service"
              showList
              openNewKey={expenseOpenKey}
            />
          )}

          {tab === "administracion" && (
            <AdminOpsPanel
              serviceCaseId={caseId}
              deal={{
                reference: data.reference || `#${data.id}`,
                org_name: data.org_name || "-",
                stage_name: data.stage_name || "-",
                operation_currency: "USD",
              }}
              onDocsRefresh={() => {
                api
                  .get("/invoices/operation-docs", { params: { service_case_id: caseId } })
                  .then(({ data: docs }) => setOpDocs(Array.isArray(docs) ? docs : []))
                  .catch(() => setOpDocs([]));
              }}
            />
          )}
        </div>

        <aside className="space-y-4 justify-self-end lg:sticky lg:top-4 self-start">
          <div className="bg-white border rounded-lg p-3">
            <div className="text-sm font-semibold mb-2">Resumen</div>
            <div className="text-sm text-slate-600">Referencia: <span className="text-slate-900">{data.reference || `#${data.id}`}</span></div>
            <div className="text-sm text-slate-600">Cliente: <span className="text-slate-900">{data.org_name || "-"}</span></div>
            <div className="text-sm text-slate-600">
              Puertas: <span className="text-slate-900">{caseDoors.length || (data.door_id ? 1 : 0)}</span>
            </div>
            <div className="text-sm text-slate-600">Ultima cotizacion: <span className="text-slate-900">{(data.last_quote_at || "").slice(0,10) || "-"}</span></div>
          </div>
          <div className="bg-white border rounded-lg p-3">
            <div className="text-sm font-semibold mb-2">Acciones</div>
            <div className="space-y-2">
              <button
                className="w-full px-3 py-2 rounded border bg-white hover:bg-slate-50 text-sm"
                onClick={() => window.open(`/api/service/cases/${caseId}/report`, "_blank")}
              >
                Informe de estado (vista previa)
              </button>
              <button
                className="w-full px-3 py-2 rounded bg-indigo-600 text-white hover:opacity-90 text-sm"
                onClick={() => window.open(`/api/service/cases/${caseId}/report/pdf`, "_blank")}
              >
                Descargar informe PDF
              </button>
              <button
                className="w-full px-3 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700 text-sm"
                onClick={() => window.open(serviceIndustrialQuoteHref, "_blank")}
              >
                Presupuesto (Mantenimiento)
              </button>
              <button
                className="w-full px-3 py-2 rounded bg-slate-900 text-white hover:opacity-90 text-sm"
                onClick={() => {
                  setTab("gastos");
                  setExpenseOpenKey((k) => k + 1);
                }}
              >
                Agregar factura de compra
              </button>
              <button
                className="w-full px-3 py-2 rounded bg-orange-600 text-white hover:opacity-90 text-sm"
                onClick={openWorkOrderPdf}
              >
                Ver PDF Orden de trabajo
              </button>
              <button
                className="w-full px-3 py-2 rounded bg-blue-700 text-white hover:opacity-90 text-sm disabled:opacity-60"
                onClick={createAdditionalQuote}
                disabled={additionalLoading}
              >
                {additionalLoading ? "Creando adicional..." : "Nuevo presupuesto adicional"}
              </button>
              {additionalQuotes.length > 0 && (
                <div className="border rounded p-2">
                  <div className="text-xs text-slate-500 mb-2">Adicionales</div>
                  <div className="space-y-2">
                    {additionalQuotes.map((q) => (
                      <div key={q.id} className="flex items-center justify-between gap-2 text-sm">
                        <div className="truncate">{q.name || `Adicional #${q.id}`}</div>
                        <div className="flex gap-2">
                          <button
                            className="px-2 py-1 text-xs rounded border"
                            onClick={() => openAdditionalQuote(q.id)}
                          >
                            Ver
                          </button>
                          <button
                            className="px-2 py-1 text-xs rounded bg-slate-900 text-white"
                            onClick={() => openAdditionalInvoice(q.id)}
                          >
                            Facturar adicional
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
      {showInvoiceModal && (
        <InvoiceCreateModal
          defaultServiceCaseId={caseId}
          defaultServiceQuoteAdditionId={invoiceAdditionId}
          onClose={() => {
            setShowInvoiceModal(false);
            setInvoiceAdditionId(null);
          }}
          onSuccess={() => {
            setShowInvoiceModal(false);
            setInvoiceAdditionId(null);
          }}
        />
      )}
    </div>
  );
}

