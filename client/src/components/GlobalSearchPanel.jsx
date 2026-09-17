import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import { useAuth } from "../auth.jsx";

const EMPTY_RESULTS = {
  people: [],
  organizations: [],
  activities: [],
  deals: [],
  files: [],
  prospects: [],
  products: [],
};

const CATEGORIES = [
  { key: "all", label: "Todas las categorías", symbol: "#" },
  { key: "people", label: "Personas", symbol: "P" },
  { key: "organizations", label: "Organizaciones", symbol: "O" },
  { key: "activities", label: "Actividades", symbol: "A" },
  { key: "deals", label: "Operaciones", symbol: "OP" },
  { key: "files", label: "Archivos", symbol: "AD" },
  { key: "prospects", label: "Prospectos", symbol: "PR" },
  { key: "products", label: "Productos", symbol: "PT" },
];

const RECENT_LIMIT = 8;

function compact(parts) {
  return parts.filter((value) => String(value || "").trim()).join(" · ");
}

function resultUrl(category, row) {
  if (category === "people") return `/contacts/${row.id}`;
  if (category === "organizations") return `/organizations/${row.id}`;
  if (category === "deals") {
    return row.operation_kind === "service" ? `/service/cases/${row.id}` : `/operations/${row.id}`;
  }
  if (category === "prospects") return `/operations/${row.id}`;
  if (category === "products") return `/catalog?item_id=${row.id}`;
  if (category === "activities") {
    if (row.deal_id) return `/operations/${row.deal_id}`;
    if (row.org_id) return `/organizations/${row.org_id}`;
    if (row.contact_id) return `/contacts/${row.contact_id}`;
    return "/followup-management?tab=agenda";
  }
  return row.url || (row.deal_id ? `/operations/${row.deal_id}` : "/");
}

function normalizeResult(category, row) {
  const base = {
    id: row.id,
    category,
    url: resultUrl(category, row),
    rawUrl: category === "files" ? row.url : null,
  };

  if (category === "people") {
    return {
      ...base,
      title: row.name || "Persona sin nombre",
      subtitle: row.org_name || "Sin organización",
      detail: compact([row.email, row.phone, row.title]),
    };
  }
  if (category === "organizations") {
    return {
      ...base,
      title: row.name || "Organización sin nombre",
      subtitle: row.razon_social || "",
      detail: compact([row.ruc ? `RUC ${row.ruc}` : "", row.city, row.email, row.phone]),
    };
  }
  if (category === "activities") {
    return {
      ...base,
      title: row.subject || row.type || "Actividad",
      subtitle: compact([row.deal_reference, row.org_name, row.contact_name]),
      detail: compact([
        row.type,
        row.due_date ? `Fecha ${String(row.due_date).slice(0, 16).replace("T", " ")}` : "",
        Number(row.done) ? "Completada" : "Pendiente",
      ]),
    };
  }
  if (category === "deals") {
    return {
      ...base,
      title: compact([row.reference, row.title]).replaceAll(" · ", " — ") || "Operación",
      subtitle: compact([row.org_name, row.contact_name]),
      detail: compact([
        row.business_unit_name,
        row.stage_name,
        row.mercaderia,
        row.origen_pto && row.destino_pto ? `${row.origen_pto} → ${row.destino_pto}` : "",
      ]),
    };
  }
  if (category === "files") {
    return {
      ...base,
      title: row.filename || "Archivo",
      subtitle: compact([row.deal_reference, row.deal_title]),
      detail: compact([row.org_name, row.type]),
    };
  }
  if (category === "prospects") {
    return {
      ...base,
      title: compact([row.reference, row.title || row.org_name]).replaceAll(" · ", " — ") || "Prospecto",
      subtitle: compact([row.org_name, row.contact_name]),
      detail: compact([row.business_unit_name, row.stage_name, row.contact_email, row.contact_phone]),
    };
  }
  return {
    ...base,
    title: row.name || "Producto sin nombre",
    subtitle: compact([row.sku, row.brand]),
    detail: compact([row.category, row.description]),
  };
}

function Highlight({ text, query }) {
  const value = String(text || "");
  const term = String(query || "").trim();
  if (!term) return value;

  const pieces = [];
  const lowerValue = value.toLocaleLowerCase("es");
  const lowerTerm = term.toLocaleLowerCase("es");
  let cursor = 0;
  let match = lowerValue.indexOf(lowerTerm);

  while (match >= 0) {
    if (match > cursor) pieces.push(value.slice(cursor, match));
    pieces.push(
      <mark key={`${match}-${cursor}`} className="bg-amber-200 px-0 text-inherit dark:bg-amber-500/50">
        {value.slice(match, match + term.length)}
      </mark>
    );
    cursor = match + term.length;
    match = lowerValue.indexOf(lowerTerm, cursor);
  }
  if (cursor < value.length) pieces.push(value.slice(cursor));
  return pieces.length ? pieces : value;
}

function CategoryBadge({ category, size = "normal" }) {
  const item = CATEGORIES.find((entry) => entry.key === category) || CATEGORIES[0];
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center border font-semibold ${
        size === "small" ? "h-8 w-8 text-[10px]" : "h-10 w-10 text-xs"
      } rounded-full border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200`}
    >
      {item.symbol}
    </span>
  );
}

export default function GlobalSearchPanel() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const overlayInputRef = useRef(null);
  const requestRef = useRef(0);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [results, setResults] = useState(EMPTY_RESULTS);
  const [recents, setRecents] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);

  const recentKey = `global-search-recents:${user?.id || "session"}`;

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(recentKey) || "[]");
      setRecents(Array.isArray(stored) ? stored.slice(0, RECENT_LIMIT) : []);
    } catch {
      setRecents([]);
    }
  }, [recentKey]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => overlayInputRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    const term = query.trim();
    setActiveIndex(-1);
    if (!term) {
      setResults(EMPTY_RESULTS);
      setLoading(false);
      setError("");
      return undefined;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const { data } = await api.get("/search", { params: { q: term } });
        if (requestRef.current !== requestId) return;
        setResults({ ...EMPTY_RESULTS, ...(data || {}) });
      } catch (requestError) {
        if (requestRef.current !== requestId) return;
        console.error("[global-search]", requestError);
        setResults(EMPTY_RESULTS);
        setError("No se pudo completar la búsqueda.");
      } finally {
        if (requestRef.current === requestId) setLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [query]);

  const normalized = useMemo(() => {
    const output = {};
    CATEGORIES.filter((category) => category.key !== "all").forEach((category) => {
      output[category.key] = (results[category.key] || []).map((row) => normalizeResult(category.key, row));
    });
    return output;
  }, [results]);

  const allResults = useMemo(
    () => CATEGORIES.filter((category) => category.key !== "all").flatMap((category) => normalized[category.key] || []),
    [normalized]
  );

  const visibleResults = activeCategory === "all" ? allResults : normalized[activeCategory] || [];

  const remember = (item) => {
    const stored = [{ ...item }, ...recents.filter((recent) => !(recent.category === item.category && String(recent.id) === String(item.id)))]
      .slice(0, RECENT_LIMIT);
    setRecents(stored);
    localStorage.setItem(recentKey, JSON.stringify(stored));
  };

  const openResult = (item) => {
    if (!item) return;
    remember(item);
    setOpen(false);
    setQuery("");
    setActiveCategory("all");
    if (item.category === "files" && item.rawUrl) {
      window.open(item.rawUrl, "_blank", "noopener,noreferrer");
      return;
    }
    navigate(item.url || "/");
  };

  const onKeyDown = (event) => {
    const rows = query.trim() ? visibleResults : recents;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, rows.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      openResult(rows[activeIndex]);
    }
  };

  const renderRow = (item, index, recent = false) => {
    const categoryLabel = CATEGORIES.find((entry) => entry.key === item.category)?.label || "Resultado";
    return (
      <button
        key={`${item.category}-${item.id}-${recent ? "recent" : "result"}`}
        type="button"
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => openResult(item)}
        className={`flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors last:border-b-0 dark:border-slate-700 ${
          activeIndex === index ? "bg-slate-100 dark:bg-slate-700" : "hover:bg-slate-50 dark:hover:bg-slate-800"
        }`}
      >
        <CategoryBadge category={item.category} size="small" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Highlight text={item.title} query={query} />
          </span>
          {item.subtitle ? (
            <span className="mt-0.5 block truncate text-xs text-slate-600 dark:text-slate-300">
              <Highlight text={item.subtitle} query={query} />
            </span>
          ) : null}
          {item.detail ? (
            <span className="mt-0.5 block truncate text-xs text-slate-400 dark:text-slate-400">
              <Highlight text={item.detail} query={query} />
            </span>
          ) : null}
        </span>
        <span className="shrink-0 pt-0.5 text-[10px] font-medium uppercase text-slate-400">{categoryLabel}</span>
      </button>
    );
  };

  return (
    <div className="relative flex-1 max-w-[720px]">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 w-full items-center gap-3 rounded-lg border border-slate-300 bg-white px-3 text-left text-sm text-slate-500 shadow-sm hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
        aria-label="Abrir búsqueda global"
      >
        <span aria-hidden="true" className="text-xl leading-none">⌕</span>
        <span className="min-w-0 flex-1 truncate">{query || "Buscar en ATM CargoSoft"}</span>
        <kbd className="hidden border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-400 sm:inline dark:border-slate-600 dark:bg-slate-700">Esc</kbd>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[90] bg-slate-950/40 px-3 pt-3 backdrop-blur-[1px] sm:pt-2" onMouseDown={() => setOpen(false)}>
          <div
            className={`mx-auto w-full transition-[max-width] ${query.trim() ? "max-w-[950px]" : "max-w-[520px]"}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="relative mx-auto mb-2 max-w-[520px]">
              <span aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-2xl text-slate-500">⌕</span>
              <input
                ref={overlayInputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveCategory("all");
                }}
                onKeyDown={onKeyDown}
                placeholder="Buscar en ATM CargoSoft"
                className="h-12 w-full rounded-lg border border-slate-300 bg-white pl-12 pr-12 text-base text-slate-900 shadow-xl outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-2xl text-slate-500 hover:text-slate-900 dark:hover:text-white"
                  aria-label="Limpiar búsqueda"
                >
                  ×
                </button>
              ) : null}
            </div>

            {!query.trim() ? (
              <section className="max-h-[calc(100vh-90px)] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                <div className="px-5 pb-2 pt-5 text-sm font-semibold text-slate-700 dark:text-slate-200">Visto por última vez</div>
                {recents.length ? (
                  <div>{recents.map((item, index) => renderRow(item, index, true))}</div>
                ) : (
                  <div className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                    Los elementos que abras desde el buscador aparecerán aquí.
                  </div>
                )}
              </section>
            ) : (
              <section className="grid max-h-[calc(100vh-90px)] grid-cols-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:grid-cols-[230px_minmax(0,1fr)]">
                <nav className="flex overflow-x-auto border-b border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-950 sm:block sm:overflow-y-auto sm:border-b-0 sm:border-r">
                  {CATEGORIES.map((category) => {
                    const count = category.key === "all" ? allResults.length : (normalized[category.key] || []).length;
                    const selected = activeCategory === category.key;
                    return (
                      <button
                        key={category.key}
                        type="button"
                        onClick={() => {
                          setActiveCategory(category.key);
                          setActiveIndex(-1);
                        }}
                        className={`flex min-w-max items-center gap-3 rounded-md px-3 py-2 text-left text-sm sm:w-full ${
                          selected
                            ? "bg-blue-100 font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                            : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                        }`}
                      >
                        <span aria-hidden="true" className="inline-flex h-7 w-7 items-center justify-center text-[10px] font-bold">{category.symbol}</span>
                        <span className="flex-1">{category.label}</span>
                        <span className="text-xs tabular-nums text-slate-400">{count}</span>
                      </button>
                    );
                  })}
                </nav>

                <div className="min-h-[280px] overflow-y-auto sm:min-h-[460px]">
                  <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 px-5 py-3 text-sm font-semibold text-slate-700 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200">
                    {activeCategory === "all"
                      ? "Todos los resultados de la búsqueda"
                      : CATEGORIES.find((category) => category.key === activeCategory)?.label}
                  </div>
                  {loading ? <div className="px-5 py-8 text-sm text-slate-500">Buscando...</div> : null}
                  {!loading && error ? <div className="px-5 py-8 text-sm text-red-600">{error}</div> : null}
                  {!loading && !error && visibleResults.length ? (
                    <div>{visibleResults.map((item, index) => renderRow(item, index))}</div>
                  ) : null}
                  {!loading && !error && !visibleResults.length ? (
                    <div className="px-5 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                      No encontramos resultados en esta categoría.
                    </div>
                  ) : null}
                </div>
              </section>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
