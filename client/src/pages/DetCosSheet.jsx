// client/src/pages/DetCosSheet.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

// === helpers de UI disabled/lock ===
const notAllowedCls = "cursor-not-allowed select-none";
const titleLock = "🚫 Presupuesto bloqueado";

/* ===================== helpers ===================== */
const formatMoney = (n, currency = "USD") => {
  if (n === null || n === undefined || n === "") return "0";
  const numVal = Number(n);
  if (!Number.isFinite(numVal)) return String(n);
  const curr = String(currency || "USD").toUpperCase();
  const isPyg = curr === "PYG" || curr === "GS";
  return numVal.toLocaleString(isPyg ? "es-PY" : "en-US", {
    minimumFractionDigits: isPyg ? 0 : 2,
    maximumFractionDigits: isPyg ? 0 : 2,
  });
};

const formatRevisionDateTime = (value) => {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString("es-PY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const fallbackRevisionName = (versionNumber, createdAt) => {
  const seq = String(Number(versionNumber || 0)).padStart(2, "0");
  const stamp = formatRevisionDateTime(createdAt);
  return stamp ? `REV ${seq} - ${stamp}` : `REV ${seq}`;
};

const getRevisionDisplayName = (version) => {
  if (!version) return "";
  return String(version.revision_name || "").trim() || fallbackRevisionName(version.version_number, version.created_at);
};

const num = (v) => {
  if (v === "" || v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  let normalized = s;
  if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    const decPos = Math.max(lastComma, lastDot);
    const intPart = s.slice(0, decPos).replace(/[.,\s]/g, "");
    const decPart = s.slice(decPos + 1).replace(/[.,\s]/g, "");
    normalized = intPart + "." + decPart;
  } else if (hasComma) {
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (hasDot) {
    normalized = s.replace(/,/g, "");
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
};

/* ===================== UI tipo "excel" ===================== */
const Box = ({ children, className = "" }) => (
  <div className={`border-2 border-gray-300 bg-white shadow-sm rounded-lg overflow-hidden ${className}`}>
    {children}
  </div>
);
const Cell = ({ children, className = "" }) => (
  <div className={`px-3 py-1 text-sm border-b border-gray-200 ${className}`}>{children}</div>
);
const HeadCell = ({ children, className = "" }) => (
  <div className={`px-3 py-2 text-[11px] font-bold uppercase tracking-wide bg-blue-50 border-b-2 border-gray-300 whitespace-nowrap ${className}`}>
    {children}
  </div>
);
const Input = (props) => (
  <input
    {...props}
    title={props.disabled ? titleLock : (props.title || "")}
    className={`w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm ${props.disabled ? "bg-gray-100 " + notAllowedCls : ""
      } ${props.className || ""}`}
  />
);
const NumInput = (props) => <Input inputMode="decimal" placeholder="0,00" {...props} />;

const TAX_OPTIONS = [
  { value: 10, label: 'IVA 10%' },
  { value: 5, label: 'IVA 5%' },
  { value: 0, label: 'Exento' },
];

const normalizeCatalogModalities = (value) => {
  if (Array.isArray(value)) return value.map((it) => String(it || "").trim().toUpperCase()).filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return normalizeCatalogModalities(parsed);
  } catch { }
  return String(value).split(",").map((it) => it.trim().toUpperCase()).filter(Boolean);
};

function buildCargoPresetGroups(items = [], currentMode = "") {
  const mode = String(currentMode || "").trim().toUpperCase();
  const unique = [];
  const seen = new Set();

  (items || []).forEach((item) => {
    const name = String(item.name || "").trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    const category = String(item.category || "").trim() || "Sin categoría";
    const modalities = normalizeCatalogModalities(item.applies_to_modalities);
    const matchesMode = !mode || modalities.length === 0 || modalities.includes(mode);
    unique.push({ name, category, matchesMode });
  });

  unique.sort((a, b) => {
    if (Number(b.matchesMode) !== Number(a.matchesMode)) return Number(b.matchesMode) - Number(a.matchesMode);
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.name.localeCompare(b.name);
  });

  const grouped = new Map();
  unique.forEach((item) => {
    const label = item.matchesMode ? `${item.category} · sugeridos` : item.category;
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label).push(item);
  });
  return Array.from(grouped.entries()).map(([label, options]) => ({ label, options }));
}

/* ===================== tablas ===================== */
function CargoTable({
  title,
  currency = "USD",
  showProfit,
  showTaxRate = false,
  isVenta = false,           // 👈 saber si es la tabla de venta
  allInEnabled = false,     // 👈 para mostrar la columna “Venta (interno)”
  rows,
  setRows,
  usedKg,
  compraRows = null,
  disabled = false,
  presetItems = [],
  currentMode = "",
}) {
  const ignoredLinksRef = useRef(new Set());
  const currencyLabel = String(currency || "USD").toUpperCase();
  const presetGroups = useMemo(() => buildCargoPresetGroups(presetItems, currentMode), [presetItems, currentMode]);
  const presetNames = useMemo(() => presetGroups.flatMap((group) => group.options.map((item) => item.name)), [presetGroups]);

  const addRow = (presetName) => {
    if (disabled) return;
    setRows((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        concepto: presetName || "",
        usdXKg: "",
        total: "",
        lockPerKg: false,
        tax_rate: 10,
        ventaInt: "",     // 👈 NUEVO: “venta interno”, solo aplica a VENTA
      },
    ]);
  };

  const removeRow = (row) => {
    if (disabled) return;
    if (row?.sourceId) ignoredLinksRef.current.add(row.sourceId);
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  };

  // Sync COMPRA → VENTA por id
  useEffect(() => {
    if (!isVenta || !Array.isArray(compraRows)) return;
    setRows((prev) => {
      const prevBySource = new Map();
      prev.forEach((r) => r.sourceId && prevBySource.set(r.sourceId, r));
      const next = [];
      compraRows.forEach((cr) => {
        if (!cr) return;
        if (ignoredLinksRef.current.has(cr.id)) return;
        const linked = prevBySource.get(cr.id);
        if (linked) next.push({ ...linked, concepto: cr.concepto || "" });
        else if ((cr.concepto || "").trim() !== "") {
          next.push({
            id: crypto.randomUUID(),
            sourceId: cr.id,
            concepto: cr.concepto || "",
            usdXKg: "",
            total: "",
            lockPerKg: false,
            tax_rate: Number(cr.tax_rate ?? 10),
            ventaInt: "",
          });
        }
      });
      prev.forEach((r) => !r.sourceId && next.push(r));
      return next;
    });
  }, [isVenta, compraRows, setRows]);

  // === helpers de línea según modo ===
  const lineTotalForRow = (r) => {
    // Si es VENTA y está All-in activo, el total “interno” viene de ventaInt
    if (isVenta && allInEnabled) {
      const manualInt = r.ventaInt !== "" ? num(r.ventaInt) : null;
      if (manualInt !== null) return manualInt;
      const perKg = num(r.usdXKg);
      return perKg * num(usedKg || 0);
    }
    // Modo normal (compra o venta sin all-in)
    const perKg = num(r.usdXKg);
    const manual = r.total !== "" && !r.lockPerKg ? num(r.total) : null;
    return manual !== null ? manual : perKg * num(usedKg || 0);
  };

  // Total de la tabla (para el recuadro TOTAL al pie)
  const tableTotal = useMemo(() => {
    return rows.reduce((acc, r) => acc + (isNaN(lineTotalForRow(r)) ? 0 : lineTotalForRow(r)), 0);
  }, [rows, usedKg, allInEnabled, isVenta]);

  // Definición de columnas (si es venta+allIn, agregamos 1)
  const gridCols = isVenta && allInEnabled
    ? (showTaxRate
        ? "grid auto-rows-min grid-cols-[minmax(220px,1fr)_120px_140px_110px_140px_140px]"
        : "grid auto-rows-min grid-cols-[minmax(220px,1fr)_120px_140px_140px_140px]")
    : (showTaxRate
        ? "grid auto-rows-min grid-cols-[minmax(220px,1fr)_120px_110px_140px_140px]"
        : "grid auto-rows-min grid-cols-[minmax(220px,1fr)_120px_140px_140px]");

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[820px]">
        <Box>
          <div className={`py-2 text-center font-bold text-base ${title.includes("COMPRA") ? "bg-blue-100" : "bg-green-100"}`}>
            {title}
          </div>

          <div className={gridCols}>
            <HeadCell className="bg-blue-100">CARGOS</HeadCell>
            <HeadCell className="bg-blue-100 text-right">{currencyLabel} X KG</HeadCell>

            {/* Cuando es venta + all-in: aparece columna de “VENTA (interno)” */}
            {isVenta && allInEnabled && (
              <HeadCell className="bg-blue-100 text-right">VENTA (interno)</HeadCell>
            )}

            {showTaxRate && (
              <HeadCell className="bg-blue-100 text-right">IVA</HeadCell>
            )}

            <HeadCell className="bg-blue-100 text-right">TOTAL</HeadCell>
            <HeadCell className="bg-blue-100 text-right">{showProfit ? "PROFIT / ACCIÓN" : "ACCIÓN"}</HeadCell>

            {rows.length === 0 && (
              <div className="col-span-full px-3 py-2 text-xs text-gray-500 border-b">Sin ítems aún.</div>
            )}

            {rows.map((r) => {
              const perKg = num(r.usdXKg);
              const computed = perKg * num(usedKg || 0);

              // PROFIT: si venta + all-in, usamos ventaInt para la parte de venta
              let profit = null;
              if (showProfit && compraRows) {
                const compraRow =
                  compraRows.find((cr) => cr.id === r.sourceId) ||
                  compraRows.find((cr) => cr.concepto === r.concepto);
                if (compraRow) {
                  const compraPerKg = num(compraRow.usdXKg);
                  const compraManual = compraRow.total !== "" && !compraRow.lockPerKg ? num(compraRow.total) : null;
                  const compraLine = compraManual !== null ? compraManual : compraPerKg * num(usedKg || 0);

                  let ventaLine;
                  if (isVenta && allInEnabled) {
                    const intManual = r.ventaInt !== "" ? num(r.ventaInt) : null;
                    ventaLine = intManual !== null ? intManual : num(r.total || 0);
                  } else {
                    const ventaPerKg = num(r.usdXKg);
                    const ventaManual = r.total !== "" && !r.lockPerKg ? num(r.total) : null;
                    ventaLine = ventaManual !== null ? ventaManual : ventaPerKg * num(usedKg || 0);
                  }
                  profit = ventaLine - compraLine;
                }
              }

              return (
                <React.Fragment key={r.id}>
                  <Cell className="bg-white">
                    <div className="flex items-center gap-2 min-w-0">
                      {/* presets desde catálogo */}
                      <select
                        disabled={disabled}
                        title={disabled ? titleLock : ""}
                        className={`border border-gray-300 rounded px-2 py-1 text-sm max-w-[180px] focus:outline-none focus:ring-1 focus:ring-blue-500 ${disabled ? notAllowedCls : ""
                          }`}
                        value={presetNames.includes(r.concepto) ? r.concepto : ""}
                        onChange={(e) => {
                          if (disabled) return;
                          const v = e.target.value;
                          setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, concepto: v || r.concepto } : x)));
                        }}
                      >
                        <option value="">preset…</option>
                        {presetGroups.map((group) => (
                          <optgroup key={group.label} label={group.label}>
                            {group.options.map((item) => (
                              <option key={`${group.label}-${item.name}`} value={item.name}>{item.name}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <Input
                        disabled={disabled}
                        value={r.concepto}
                        onChange={(e) => setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, concepto: e.target.value } : x)))}
                        className="w-[200px]"
                      />
                    </div>
                  </Cell>

                  <Cell className="bg-white text-right">
                    <NumInput
                      disabled={disabled}
                      value={r.usdXKg}
                      onChange={(e) => setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, usdXKg: e.target.value } : x)))}
                      className="text-right bg-yellow-50"
                    />
                  </Cell>

                  {/* Columna VENTA (interno) solo si venta + all-in */}
                  {isVenta && allInEnabled && (
                    <Cell className="bg-white text-right">
                      <NumInput
                        disabled={disabled}
                        value={r.ventaInt || ""}
                        onChange={(e) =>
                          setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, ventaInt: e.target.value } : x)))
                        }
                        className="text-right bg-yellow-50"
                      />
                    </Cell>
                  )}

                  {showTaxRate && (
                    <Cell className="bg-white text-right">
                      <select
                        disabled={disabled}
                        className={`border border-gray-300 rounded px-2 py-1 text-sm text-right ${disabled ? notAllowedCls : ""}`}
                        value={String(r.tax_rate ?? 10)}
                        onChange={(e) =>
                          setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, tax_rate: Number(e.target.value) } : x)))
                        }
                      >
                        {TAX_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </Cell>
                  )}

                  <Cell className="bg-white">
                    <div className="flex items-center justify-end gap-2">
                      <NumInput
                        disabled={disabled || r.lockPerKg}
                        value={r.lockPerKg ? "" : r.total}
                        onChange={(e) => setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, total: e.target.value } : x)))}
                        className={`text-right ${r.lockPerKg ? "bg-gray-100" : "bg-yellow-50"}`}
                      />
                      <label
                        className={`text-[11px] text-gray-600 flex items-center gap-1 whitespace-nowrap ${disabled ? notAllowedCls : ""
                          }`}
                        title={disabled ? titleLock : ""}
                      >
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={r.lockPerKg}
                          onChange={(e) =>
                            setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, lockPerKg: e.target.checked } : x)))
                          }
                        />
                        Auto
                      </label>
                    </div>
                    {r.lockPerKg && (
                      <div className="text-[11px] text-right text-gray-500 mt-0.5">
                        = {formatMoney(computed, currencyLabel)}
                      </div>
                    )}
                  </Cell>

                  <Cell className="bg-white">
                    <div className="flex items-center justify-end gap-2">
                      {showProfit ? (
                        <span className={profit >= 0 ? "text-green-600" : "text-red-600"}>
                          {profit === null ? "—" : formatMoney(profit, currencyLabel)}
                        </span>
                      ) : null}
                      <button
                        disabled={disabled}
                        className={`text-[11px] px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 ${disabled ? notAllowedCls : ""
                          }`}
                        title={disabled ? titleLock : ""}
                        onClick={() => removeRow(r)}
                      >
                        eliminar
                      </button>
                    </div>
                  </Cell>
                </React.Fragment>
              );
            })}

            <div className="col-span-full bg-gray-100 py-1 px-3 flex justify-between items-center border-t-2 border-gray-300">
              <div className="flex items-center gap-3">
                <button
                  disabled={disabled}
                  className={`px-3 py-1.5 text-sm text-white rounded transition-colors ${disabled ? "bg-gray-400 " + notAllowedCls : "bg-blue-500 hover:bg-blue-600"
                    }`}
                  title={disabled ? titleLock : ""}
                  onClick={() => addRow("")}
                >
                  + Agregar fila
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-600">con preset:</span>
                  <select
                    disabled={disabled}
                    title={disabled ? titleLock : ""}
                    className={`border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${disabled ? notAllowedCls : ""
                      }`}
                    onChange={(e) => {
                      if (e.target.value) addRow(e.target.value);
                      e.target.value = "";
                    }}
                  >
                    <option value="">—</option>
                    {presetGroups.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.options.map((item) => (
                          <option key={`${group.label}-${item.name}-footer`} value={item.name}>{item.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              </div>
              <div className="text-sm">
                <span className="font-bold">TOTAL:</span>
                <span className="ml-2 font-black">{currencyLabel} {formatMoney(tableTotal, currencyLabel)}</span>
              </div>
            </div>
          </div>
        </Box>
      </div>
    </div>
  );
}

function LocalesTable({ title, rows, setRows, gsToUsd, showProfit = false, costosRows = null, disabled = false }) {
  const ignoredLinksRef = useRef(new Set());
  const addRow = () => { if (!disabled) setRows((prev) => [...prev, { id: crypto.randomUUID(), concepto: "", gs: "", tax_rate: 10 }]); };
  const removeRow = (row) => {
    if (disabled) return;
    if (row?.sourceId) ignoredLinksRef.current.add(row.sourceId);
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  };

  useEffect(() => {
    if (title !== "GASTOS LOCALES AL CLIENTE (Gs)" || !Array.isArray(costosRows)) return;
    setRows((prev) => {
      const prevBySource = new Map();
      prev.forEach((r) => r.sourceId && prevBySource.set(r.sourceId, r));
      const next = [];
      costosRows.forEach((cr) => {
        if (ignoredLinksRef.current.has(cr.id)) return;
        const linked = prevBySource.get(cr.id);
        if (linked) next.push({ ...linked, concepto: cr.concepto || "" });
        else if ((cr.concepto || "").trim() !== "") {
          next.push({ id: crypto.randomUUID(), sourceId: cr.id, concepto: cr.concepto || "", gs: "", tax_rate: Number(cr.tax_rate ?? 10) });
        }
      });
      prev.forEach((r) => !r.sourceId && next.push(r));
      return next;
    });
  }, [title, costosRows, setRows]);

  const totalGs = useMemo(() => rows.reduce((a, r) => a + num(r.gs), 0), [rows]);
  const totalUsd = useMemo(() => (gsToUsd ? totalGs / gsToUsd : 0), [totalGs, gsToUsd]);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <Box>
          <div className={`py-2 text-center font-bold text-base ${title.includes("COSTOS") ? "bg-blue-100" : "bg-green-100"}`}>{title}</div>
          <div className="grid auto-rows-min grid-cols-[minmax(220px,1fr)_120px_120px_140px]">
            <HeadCell className="bg-blue-100">Concepto</HeadCell>
            <HeadCell className="bg-blue-100 text-right">Gs</HeadCell>
            <HeadCell className="bg-blue-100 text-right">IVA</HeadCell>
            <HeadCell className="bg-blue-100 text-right">{showProfit ? "PROFIT / ACCIÓN" : "ACCIÓN"}</HeadCell>

            {rows.length === 0 && <div className="col-span-full px-3 py-2 text-xs text-gray-500 border-b">Sin ítems aún.</div>}

            {rows.map((r) => {
              let profit = null;
              if (showProfit && costosRows) {
                const costosRow =
                  costosRows.find((cr) => r.sourceId ? cr.id === r.sourceId : cr.concepto === r.concepto);
                if (costosRow) {
                  const ventaGs = num(r.gs);
                  const costoGs = num(costosRow.gs);
                  profit = gsToUsd ? (ventaGs - costoGs) / gsToUsd : 0;
                }
              }

              return (
                <React.Fragment key={r.id}>
                  <Cell className="bg-white">
                    <Input
                      disabled={disabled}
                      value={r.concepto}
                      onChange={(e) => setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, concepto: e.target.value } : x)))}
                    />
                  </Cell>
                  <Cell className="bg-white text-right">
                    <NumInput
                      disabled={disabled}
                      value={r.gs}
                      onChange={(e) => setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, gs: e.target.value } : x)))}
                      className="text-right bg-yellow-50"
                    />
                  </Cell>
                  <Cell className="bg-white text-right">
                    <select
                      disabled={disabled}
                      className={`border border-gray-300 rounded px-2 py-1 text-sm text-right ${disabled ? notAllowedCls : ""}`}
                      value={String(r.tax_rate ?? 10)}
                      onChange={(e) => setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, tax_rate: Number(e.target.value) } : x)))}
                    >
                      {TAX_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </Cell>
                  <Cell className="bg-white">
                    <div className="flex items-center justify-end gap-2">
                      {showProfit ? (
                        <span className={profit >= 0 ? "text-green-600" : "text-red-600"}>
                          {profit === null ? "—" : formatMoney(profit, "USD")}
                        </span>
                      ) : null}
                      <button
                        disabled={disabled}
                        className={`text-[11px] px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 ${disabled ? notAllowedCls : ""}`}
                        title={disabled ? titleLock : ""}
                        onClick={() => removeRow(r)}
                      >
                        eliminar
                      </button>
                    </div>
                  </Cell>
                </React.Fragment>
              );
            })}

            <div className="col-span-full bg-gray-100 py-1 px-3 flex justify-between items-center border-t-2 border-gray-300">
              <button
                disabled={disabled}
                className={`px-3 py-1.5 text-sm text-white rounded transition-colors ${disabled ? "bg-gray-400 " + notAllowedCls : "bg-blue-500 hover:bg-blue-600"
                  }`}
                title={disabled ? titleLock : ""}
                onClick={addRow}
              >
                + Agregar fila
              </button>
              <div className="text-sm">
                <span className="font-bold">TOTAL:</span>{" "}
                <span className="font-black">Gs {String(totalGs)}</span>
                <span className="ml-2 text-gray-500">= USD {formatMoney(totalUsd, "USD")}</span>
              </div>
            </div>
          </div>
        </Box>
      </div>
    </div>
  );
}

function SeguroTable({ title, rows, setRows, showProfit = false, costosRows = null, disabled = false }) {
  const ignoredLinksRef = useRef(new Set());
  const addRow = () => { if (!disabled) setRows((prev) => [...prev, { id: crypto.randomUUID(), concepto: "", usd: "", tax_rate: 10 }]); };
  const removeRow = (row) => {
    if (disabled) return;
    if (row?.sourceId) ignoredLinksRef.current.add(row.sourceId);
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  };

  useEffect(() => {
    if (title !== "VENTAS SEGURO DE CARGA" || !Array.isArray(costosRows)) return;
    setRows((prev) => {
      const prevBySource = new Map();
      prev.forEach((r) => r.sourceId && prevBySource.set(r.sourceId, r));
      const next = [];
      costosRows.forEach((cr) => {
        if (ignoredLinksRef.current.has(cr.id)) return;
        const linked = prevBySource.get(cr.id);
        if (linked) next.push({ ...linked, concepto: cr.concepto || "" });
        else if ((cr.concepto || "").trim() !== "") {
          next.push({ id: crypto.randomUUID(), sourceId: cr.id, concepto: cr.concepto || "", usd: "", tax_rate: Number(cr.tax_rate ?? 10) });
        }
      });
      prev.forEach((r) => !r.sourceId && next.push(r));
      return next;
    });
  }, [title, costosRows, setRows]);

  const totalUsd = useMemo(() => rows.reduce((a, r) => a + num(r.usd), 0), [rows]);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[600px]">
        <Box>
          <div className={`py-2 text-center font-bold text-base ${title.includes("COSTOS") ? "bg-blue-800 text-white" : "bg-green-100"}`}>
            {title}
          </div>
          <div className="grid auto-rows-min grid-cols-[minmax(220px,1fr)_120px_120px_140px]">
            <HeadCell className="bg-blue-100">Concepto</HeadCell>
            <HeadCell className="bg-blue-100 text-right">USD</HeadCell>
            <HeadCell className="bg-blue-100 text-right">IVA</HeadCell>
            <HeadCell className="bg-blue-100 text-right">{showProfit ? "PROFIT / ACCIÓN" : "ACCIÓN"}</HeadCell>

            {rows.length === 0 && <div className="col-span-full px-3 py-2 text-xs text-gray-500 border-b">Sin ítems aún.</div>}

            {rows.map((r) => {
              let profit = null;
              if (showProfit && costosRows) {
                const costosRow =
                  costosRows.find((cr) => r.sourceId ? cr.id === r.sourceId : cr.concepto === r.concepto);
                if (costosRow) {
                  const costosUsd = num(costosRow.usd);
                  const ventaUsd = num(r.usd);
                  profit = ventaUsd - costosUsd;
                }
              }

              return (
                <React.Fragment key={r.id}>
                  <Cell className="bg-white">
                    <Input
                      disabled={disabled}
                      value={r.concepto || ""}
                      onChange={(e) => setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, concepto: e.target.value } : x)))}
                    />
                  </Cell>
                  <Cell className="bg-white text-right">
                    <NumInput
                      disabled={disabled}
                      value={r.usd || ""}
                      onChange={(e) => setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, usd: e.target.value } : x)))}
                      className="text-right bg-yellow-50"
                    />
                  </Cell>
                  <Cell className="bg-white text-right">
                    <select
                      disabled={disabled}
                      className={`border border-gray-300 rounded px-2 py-1 text-sm text-right ${disabled ? notAllowedCls : ""}`}
                      value={String(r.tax_rate ?? 10)}
                      onChange={(e) => setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, tax_rate: Number(e.target.value) } : x)))}
                    >
                      {TAX_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </Cell>
                  <Cell className="bg-white">
                    <div className="flex items-center justify-end gap-2">
                      {showProfit ? (
                        <span className={profit >= 0 ? "text-green-600" : "text-red-600"}>
                          {profit === null ? "—" : formatMoney(profit, "USD")}
                        </span>
                      ) : null}
                      <button
                        disabled={disabled}
                        className={`text-[11px] px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 ${disabled ? notAllowedCls : ""}`}
                        title={disabled ? titleLock : ""}
                        onClick={() => removeRow(r)}
                      >
                        eliminar
                      </button>
                    </div>
                  </Cell>
                </React.Fragment>
              );
            })}

            <div className="col-span-full bg-gray-100 py-1 px-3 flex justify-between items-center border-t-2 border-gray-300">
              <button
                disabled={disabled}
                className={`px-3 py-1 text-sm text-white rounded transition-colors ${disabled ? "bg-gray-400 " + notAllowedCls : "bg-blue-500 hover:bg-blue-600"
                  }`}
                title={disabled ? titleLock : ""}
                onClick={addRow}
              >
                + Agregar
              </button>
              <div className="font-bold">
                TOTAL: <span className="font-black">USD {formatMoney(totalUsd, "USD")}</span>
              </div>
            </div>
          </div>
        </Box>
      </div>
    </div>
  );
}

/* ===================== pagina ===================== */
export default function DetCosSheet({ onVersionSelectionChange } = {}) {
  const { id } = useParams();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [deal, setDeal] = useState(null);
  const [cf, setCf] = useState({});

  const [full, setFull] = useState(false);

  // === NUEVO: Estados para versionado ===
  const [versions, setVersions] = useState([]);
  const [currentVersion, setCurrentVersion] = useState(null);
  const [selectedVersionNum, setSelectedVersionNum] = useState(null);
  const [revisionNameDraft, setRevisionNameDraft] = useState("");

  const notifyVersionSelection = (versionNumber, versionRow = null) => {
    if (typeof onVersionSelectionChange === "function") {
      onVersionSelectionChange(versionNumber || null, versionRow || null);
    }
  };

  // cabecera / parametros
  const [modo, setModo] = useState("");
  const [clase, setClase] = useState("");
  const [pesoKg, setPesoKg] = useState("");
  const [awb, setAwb] = useState("");
  const [hbl, setHbl] = useState("");
  const [mercaderia, setMercaderia] = useState("");
  const [gsRate, setGsRate] = useState("5860");
  const [operationCurrency, setOperationCurrency] = useState("USD");

  // presets desde catálogo
  const [catalogServices, setCatalogServices] = useState([]);
  const [catalogItems, setCatalogItems] = useState([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);

  // All-in
  const [allInEnabled, setAllInEnabled] = useState(false);
  const [allInServiceName, setAllInServiceName] = useState("");

  // tablas
  const [compraRows, setCompraRows] = useState([]);
  const [ventaRows, setVentaRows] = useState([]);

  // locales y seguro
  const [locRows, setLocRows] = useState([]);
  const [locCliRows, setLocCliRows] = useState([]);
  const [segCostoRows, setSegCostoRows] = useState([]);
  const [segVentaRows, setSegVentaRows] = useState([]);

  // estado presupuesto (org)
  const [orgId, setOrgId] = useState(null);
  const [budgetStatus, setBudgetStatus] = useState("borrador"); // borrador | bloqueado | confirmado

  // permisos
  const role = String(user?.role || "").toLowerCase();
  const isAdmin = role === "admin";
  const isVentas = ["ventas", "vendedor", "venta", "seller", "sales", "commercial", "comercial"].includes(role);

  const isLocked = budgetStatus === "bloqueado" || budgetStatus === "confirmado";
  const canEdit = !(isLocked && !isAdmin); // admin puede editar siempre

  const opCurrency = String(operationCurrency || "USD").toUpperCase();
  const isPyg = opCurrency === "PYG" || opCurrency === "GS";
  const currencyLabel = isPyg ? "PYG" : "USD";

  // cargar deal + CF + planilla guardada + estado presupuesto + catálogo + versiones
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [{ data: detail }, cfRes] = await Promise.all([
          api.get(`/deals/${id}`),
          api.get(`/deals/${id}/custom-fields`).catch(() => ({ data: [] })),
        ]);
        setDeal(detail.deal);
        setOrgId(detail.deal?.org_id || null);

        const map = {};
        (cfRes.data || []).forEach((r) => (map[r.key] = r.value ?? ""));
        setCf(map);

        setModo(map["modalidad_carga"] || "");
        setClase(map["tipo_carga"] || "");
        setMercaderia(map["mercaderia"] || "");
        setPesoKg(map["peso_bruto"] || map["p_vol"] || map["peso_vol"] || "");
        setAwb(map["m_awb"] || "");
        setHbl(map["h_bl"] || "");

        // cargar planilla guardada (modo legacy)
        const cs = await api.get(`/deals/${id}/cost-sheet`).then(r => r.data).catch(() => null);
        if (cs?.data) {
          const d = cs.data;
          const h = d.header || {};
          setModo(h.modo ?? "");
          setClase(h.clase ?? "");
          setPesoKg(h.pesoKg ?? "");
          setAwb(h.awb ?? "");
          setHbl(h.hbl ?? "");
          setMercaderia(h.mercaderia ?? "");
          setGsRate(h.gsRate ?? "5860");
          setOperationCurrency((h.operationCurrency || h.currency || "USD").toUpperCase());

          setAllInEnabled(!!h.allInEnabled);
          setAllInServiceName(h.allInServiceName || "");

          setCompraRows(Array.isArray(d.compraRows) ? d.compraRows : []);
          setVentaRows(Array.isArray(d.ventaRows) ? d.ventaRows : []);
          setLocRows(Array.isArray(d.locRows) ? d.locRows : []);
          setLocCliRows(Array.isArray(d.locCliRows) ? d.locCliRows : []);
          setSegCostoRows(Array.isArray(d.segCostoRows) ? d.segCostoRows : []);
          setSegVentaRows(Array.isArray(d.segVentaRows) ? d.segVentaRows : []);
        }

        // cargar estado presupuesto
        if (detail.deal?.org_id) {
          const { data: b } = await api.get(`/organizations/${detail.deal.org_id}/budget`);
          setBudgetStatus(b.budget_status || "borrador");
        }

        // === NUEVO: Cargar versiones ===
        try {
          const { data: vers } = await api.get(`/deals/${id}/cost-sheet/versions`);
          setVersions(vers || []);
        } catch {
          setVersions([]);
        }
        try {
          const { data: curr } = await api.get(`/deals/${id}/cost-sheet/current-version`);
          setCurrentVersion(curr || null);
        } catch {
          setCurrentVersion(null);
        }

        // === Catálogo robusto (SERVICIOS/PRODUCTOS activos) – prueba varios endpoints
        async function loadCatalogServices() {
          const tryEndpoints = [
            "/catalog/items?active=1",
            "/catalog/items",
            "/items?active=1",
            "/items",
          ];

          let items = null;
          let lastErr = null;

          for (const ep of tryEndpoints) {
            const url = ep.includes("?") ? `${ep}&_=${Date.now()}` : `${ep}?_=${Date.now()}`;
            try {
              const { data } = await api.get(url);
              // normalizar posibles formas de respuesta
              const arr =
                Array.isArray(data) ? data :
                  Array.isArray(data?.items) ? data.items :
                    Array.isArray(data?.data) ? data.data :
                      null;
              if (arr) {
                items = arr;
                break;
              }
            } catch (e) {
              lastErr = e;
            }
          }

          if (!items) {
            console.warn("No se pudo cargar catálogo de productos/servicios.", lastErr?.message || lastErr);
            setCatalogServices([]);
            setCatalogLoaded(true);
            return;
          }

          const SERVICES = new Set(["SERVICE", "PRODUCT", "SERVICIO", "PRODUCTO"]);
          const normalizedItems = (items || [])
            .filter((it) => SERVICES.has(String(it.type || "").toUpperCase()))
            .map((it) => ({
              name: String(it.name || "").trim(),
              category: String(it.category || "").trim(),
              applies_to_modalities: normalizeCatalogModalities(it.applies_to_modalities),
            }))
            .filter((it) => it.name);

          const presetGroups = buildCargoPresetGroups(normalizedItems, map["modalidad_carga"] || "");
          const names = presetGroups.flatMap((group) => group.options.map((item) => item.name));

          setCatalogItems(normalizedItems);
          setCatalogServices([...new Set(names)]);
          setCatalogLoaded(true);
        }

        await loadCatalogServices();
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // 🔁 Polling liviano para estado presupuesto (cada 10s)
  useEffect(() => {
    if (!orgId) return;
    const timer = setInterval(async () => {
      try {
        const { data } = await api.get(`/organizations/${orgId}/budget`);
        setBudgetStatus((prev) => (data?.budget_status && data.budget_status !== prev ? data.budget_status : prev));
      } catch { }
    }, 10000);
    return () => clearInterval(timer);
  }, [orgId]);

  // Totales base de venta
  // Si All-in está activo, el total base viene de la suma de “ventaInt”;
  // si no, de la columna TOTAL/usdXKg como siempre.
  const ventaRowsBaseTotal = useMemo(() => {
    if (allInEnabled) {
      return (ventaRows || []).reduce((acc, r) => {
        const manualInt = r.ventaInt !== "" ? num(r.ventaInt) : null;
        const line = manualInt !== null ? manualInt : num(r.total || 0);
        return acc + (isNaN(line) ? 0 : line);
      }, 0);
    }
    // modo normal
    return (ventaRows || []).reduce((acc, r) => {
      const perKg = num(r.usdXKg);
      const manual = r.total !== "" && !r.lockPerKg ? num(r.total) : null;
      const line = manual !== null ? manual : perKg * num(pesoKg || 0);
      return acc + (isNaN(line) ? 0 : line);
    }, 0);
  }, [ventaRows, pesoKg, allInEnabled]);

  const totalCompra = useMemo(
    () =>
      compraRows.reduce((acc, r) => {
        const perKg = num(r.usdXKg);
        const manual = r.total !== "" && !r.lockPerKg ? num(r.total) : null;
        const line = manual !== null ? manual : perKg * num(pesoKg || 0);
        return acc + (isNaN(line) ? 0 : line);
      }, 0),
    [compraRows, pesoKg]
  );

  // Vista de venta con All-in (solo vista; se guarda el “crudo” con ventaInt)
  const ventaRowsView = useMemo(() => {
    if (!allInEnabled || !allInServiceName?.trim() || !catalogServices.includes(allInServiceName.trim())) {
      return ventaRows;
    }

    const total = ventaRowsBaseTotal;
    const target = allInServiceName.trim().toLowerCase();

    const hasTarget = (ventaRows || []).some(
      (r) => String(r.concepto || "").trim().toLowerCase() === target
    );

    const baseZeroed = (ventaRows || []).map((r) => ({
      ...r,
      usdXKg: "",
      total: "0",       // lo que ve el presupuesto por fila
      lockPerKg: false,
    }));

    if (hasTarget) {
      return baseZeroed.map((r) => {
        if (String(r.concepto || "").trim().toLowerCase() === target) {
          return { ...r, total: String(total), lockPerKg: false }; // fila concentrada
        }
        return r;
      });
    }

    return [
      ...baseZeroed,
      { id: crypto.randomUUID(), concepto: allInServiceName, usdXKg: "", total: String(total), lockPerKg: false, tax_rate: 10 },
    ];
  }, [allInEnabled, allInServiceName, ventaRows, ventaRowsBaseTotal, catalogServices]);

  const totalVenta = useMemo(
    () =>
    (allInEnabled ? ventaRowsBaseTotal : ventaRowsView.reduce((acc, r) => {
      const perKg = num(r.usdXKg);
      const manual = r.total !== "" && !r.lockPerKg ? num(r.total) : null;
      const line = manual !== null ? manual : perKg * num(pesoKg || 0);
      return acc + (isNaN(line) ? 0 : line);
    }, 0)),
    [ventaRowsView, pesoKg, allInEnabled, ventaRowsBaseTotal]
  );

  // Locales y seguro
  const gsToUsd = useMemo(() => num(gsRate) || 0, [gsRate]);
  const totalLocalesGs = useMemo(() => locRows.reduce((a, r) => a + num(r.gs), 0), [locRows]);
  const totalLocales = useMemo(
    () => (isPyg ? totalLocalesGs : (gsToUsd ? totalLocalesGs / gsToUsd : 0)),
    [totalLocalesGs, gsToUsd, isPyg]
  );
  const totalLocalesClienteGs = useMemo(() => locCliRows.reduce((a, r) => a + num(r.gs), 0), [locCliRows]);
  const totalLocalesCliente = useMemo(
    () => (isPyg ? totalLocalesClienteGs : (gsToUsd ? totalLocalesClienteGs / gsToUsd : 0)),
    [totalLocalesClienteGs, gsToUsd, isPyg]
  );
  const segCostoTotal = useMemo(() => segCostoRows.reduce((a, r) => a + num(r.usd || r.monto || 0), 0), [segCostoRows]);
  const segVentaTotal = useMemo(() => segVentaRows.reduce((a, r) => a + num(r.usd || r.monto || 0), 0), [segVentaRows]);
  const totalCostos = useMemo(() => totalCompra + totalLocales + segCostoTotal, [totalCompra, totalLocales, segCostoTotal]);
  const totalVentas = useMemo(() => totalVenta + totalLocalesCliente + segVentaTotal, [totalVenta, totalLocalesCliente, segVentaTotal]);
  const profitGeneral = useMemo(() => totalVentas - totalCostos, [totalVentas, totalCostos]);

  // === actualiza deal.value con el profit calculado
  async function updateDealValue(profit) {
    try {
      const v = Number(Number(profit).toFixed(2));
      await api.patch(`/deals/${id}`, { value: v });
    } catch (e) {
      console.warn("No se pudo actualizar deal.value con el profit:", e);
    }
  }

  const convertValue = (v, factor, mode) => {
    if (v === "" || v === null || v === undefined) return "";
    const n = num(v);
    if (!Number.isFinite(n)) return "";
    if (mode === "toUSD") return (n / factor).toFixed(2);
    if (mode === "toPYG") return String(Math.round(n * factor));
    return String(n);
  };

  // === NUEVO: Cargar versiones ===
  async function loadVersions() {
    try {
      const { data } = await api.get(`/deals/${id}/cost-sheet/versions`);
      setVersions(data || []);
    } catch (err) {
      console.error("Error al cargar versiones:", err);
      setVersions([]);
    }
  }

  // === NUEVO: Cargar versión actual ===
  async function loadCurrentVersion() {
    try {
      const { data } = await api.get(`/deals/${id}/cost-sheet/current-version`);
      setCurrentVersion(data || null);
      setRevisionNameDraft(getRevisionDisplayName(data));
      notifyVersionSelection(data?.version_number || null, data || null);
    } catch (err) {
      console.error("Error al cargar versión actual:", err);
      setCurrentVersion(null);
      setRevisionNameDraft("");
      notifyVersionSelection(null, null);
    }
  }

  // === NUEVO: Cargar versión específica ===
  async function loadVersion(versionNum) {
    try {
      const { data: v } = await api.get(`/deals/${id}/cost-sheet/versions/${versionNum}`);
      if (!v?.data) return;
      const d = v.data;
      const h = d.header || {};
      setModo(h.modo ?? "");
      setClase(h.clase ?? "");
      setPesoKg(h.pesoKg ?? "");
      setAwb(h.awb ?? "");
      setHbl(h.hbl ?? "");
      setMercaderia(h.mercaderia ?? "");
      setGsRate(h.gsRate ?? "5860");
      setOperationCurrency((h.operationCurrency || h.currency || "USD").toUpperCase());
      setAllInEnabled(!!h.allInEnabled);
      setAllInServiceName(h.allInServiceName || "");
      setCompraRows(Array.isArray(d.compraRows) ? d.compraRows : []);
      setVentaRows(Array.isArray(d.ventaRows) ? d.ventaRows : []);
      setLocRows(Array.isArray(d.locRows) ? d.locRows : []);
      setLocCliRows(Array.isArray(d.locCliRows) ? d.locCliRows : []);
      setSegCostoRows(Array.isArray(d.segCostoRows) ? d.segCostoRows : []);
      setSegVentaRows(Array.isArray(d.segVentaRows) ? d.segVentaRows : []);
      setSelectedVersionNum(versionNum);
      setRevisionNameDraft(getRevisionDisplayName(v));
      notifyVersionSelection(versionNum, v || null);
    } catch (err) {
      console.error("Error al cargar versión:", err);
      alert("No se pudo cargar la versión");
    }
  }

    async function saveRevisionName() {
    const targetVersion = selectedVersionNum
      ? versions.find((v) => Number(v.version_number) === Number(selectedVersionNum))
      : currentVersion;
    if (!targetVersion?.id) return;

    const cleanedName = String(revisionNameDraft || "").trim();
    if (!cleanedName) {
      alert("El nombre de la revisi?n no puede quedar vac?o.");
      return;
    }

    try {
      await api.put(`/deals/${id}/cost-sheet/versions/${targetVersion.id}`, {
        revision_name: cleanedName,
        change_reason: targetVersion.change_reason || null,
      });
      await loadVersions();
      if (selectedVersionNum) await loadVersion(selectedVersionNum);
      else await loadCurrentVersion();
      alert("Nombre de revisi?n actualizado.");
    } catch (err) {
      console.error("Error al actualizar nombre de revisi?n:", err);
      alert("No se pudo actualizar el nombre de la revisi?n");
    }
  }

  // === Guardado: cada vez crea una nueva revisi?n autom?ticamente ===
  async function saveCostSheet() {
    const payload = {
      header: {
        modo,
        clase,
        pesoKg,
        awb,
        hbl,
        mercaderia,
        gsRate,
        allInEnabled,
        allInServiceName,
        operationCurrency,
      },
      compraRows,
      ventaRows,
      locRows,
      locCliRows,
      segCostoRows,
      segVentaRows,
      totals: { totalCostos, totalVentas, profitGeneral },
    };

    try {
      await api.post(`/deals/${id}/cost-sheet/versions`, {
        data: payload,
        change_reason: "Guardado autom?tico de revisi?n",
      });
      await updateDealValue(profitGeneral);
      await loadVersions();
      await loadCurrentVersion();
      setSelectedVersionNum(null);
      alert("Nueva revisi?n creada.");
    } catch (err) {
      console.error("Error al guardar:", err);
      alert("Error al guardar presupuesto");
    }
  }

  async function confirmBudget() {
    if (!orgId) return;
    await updateDealValue(profitGeneral);
    await api.post(`/organizations/${orgId}/budget/confirm`, { profit_value: profitGeneral });
    setBudgetStatus("confirmado");
  }
  async function lockBudget() {
    if (!orgId) return;
    await updateDealValue(profitGeneral);
    await api.post(`/organizations/${orgId}/budget/lock`);
    setBudgetStatus("bloqueado");
  }
  async function reopenBudget() {
    if (!orgId) return;
    await api.post(`/organizations/${orgId}/budget/reopen`);
    setBudgetStatus("borrador");
  }

  if (loading) return <p className="text-sm text-gray-600 p-4">Cargando…</p>;
  if (!deal) return <p className="text-sm text-gray-600 p-4">Operación no encontrada.</p>;

  return (
    <div className={`${full ? "fixed inset-0 z-50 bg-white" : ""} flex flex-col max-w-full bg-gray-50`}>
      {/* barra superior */}
      <div className="flex items-center justify-between p-4 border-b bg-white shadow-sm sticky top-0 z-10">
        <div className="text-lg font-semibold text-gray-800">
          <span className="text-gray-500 mr-2">Planilla de costos</span>
          <span>{deal.reference}</span>{" "}
          <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
            Estado: {budgetStatus}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="px-4 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            onClick={() => setFull((v) => !v)}
            title="Alternar pantalla completa"
          >
            {full ? "Salir de pantalla completa" : "Pantalla completa"}
          </button>

          {/* === NUEVO: Selector de versiones === */}
          {versions.length > 0 && (
            <select
              className="border rounded px-3 py-2 text-sm"
              value={selectedVersionNum || ""}
              onChange={(e) => {
                const numV = Number(e.target.value);
                if (numV) {
                  loadVersion(numV);
                } else {
                  setSelectedVersionNum(null);
                  notifyVersionSelection(currentVersion?.version_number || null, currentVersion || null);
                  if (currentVersion?.version_number) {
                    loadVersion(currentVersion.version_number);
                  } else {
                    window.location.reload();
                  }
                }
              }}
            >
              <option value="">Versión actual</option>
              {versions.map((v) => (
                <option key={v.id} value={v.version_number}>
                  {getRevisionDisplayName(v)} - {v.status}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-2">
            <input
              className="w-[260px] border rounded px-3 py-2 text-sm"
              value={revisionNameDraft}
              onChange={(e) => setRevisionNameDraft(e.target.value)}
              placeholder="Nombre de la revisi?n"
            />
            {canEdit && (selectedVersionNum || currentVersion?.id) ? (
              <button
                onClick={saveRevisionName}
                className="px-3 py-2 text-sm bg-white border rounded hover:bg-slate-50"
              >
                Guardar nombre
              </button>
            ) : null}
          </div>

          <Link
            to={`/operations/${id}/quote${selectedVersionNum || currentVersion?.version_number ? `?cost_sheet_version=${selectedVersionNum || currentVersion?.version_number}` : ''}`}
            className="px-3 py-2 text-sm bg-slate-700 text-white rounded hover:bg-slate-800"
          >
            Ver presupuesto de esta revisi?n
          </Link>

          <Link to={-1} className="px-4 py-2 text-sm bg-gray-200 rounded hover:bg-gray-300 transition-colors">
            ← Volver
          </Link>
        </div>
      </div>

      {/* === NUEVO: Indicador de versión === */}
      {selectedVersionNum && (
        <div className="mx-4 mt-4 bg-blue-50 border border-blue-200 rounded p-3">
          <div className="flex items-center justify-between">
            <div>
              <strong>{getRevisionDisplayName(versions.find((v) => v.version_number === selectedVersionNum) || currentVersion || { version_number: selectedVersionNum })}</strong>
              {versions.find((v) => v.version_number === selectedVersionNum)?.change_reason && (
                <span className="ml-3 text-sm text-slate-600">
                  Razón: {versions.find((v) => v.version_number === selectedVersionNum).change_reason}
                </span>
              )}
            </div>
            <button
              onClick={() => {
                setSelectedVersionNum(null);
                notifyVersionSelection(currentVersion?.version_number || null, currentVersion || null);
                if (currentVersion?.version_number) {
                  loadVersion(currentVersion.version_number);
                } else {
                  window.location.reload();
                }
              }}
              className="text-sm text-blue-600 hover:underline"
            >
              Volver a versión actual
            </button>
          </div>
        </div>
      )}

      <div className="p-4 md:p-6 space-y-6 overflow-y-auto">
        {/* encabezado superior */}
        <div className="overflow-x-auto">
          <div className="min-w-[980px] grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6">
            <Box>
              <div className="py-2 text-center font-bold text-lg bg-blue-100">REF: {deal.reference}</div>
                            <div className="flex items-center justify-between gap-3 px-3 py-2 bg-blue-50 border-b-2 border-gray-300">
                <div className="text-sm font-bold">MONEDA</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={`px-2 py-0.5 text-[11px] rounded border ${opCurrency === "USD" ? "bg-black text-white border-black" : "bg-white"}`}
                    onClick={() => {
                      if (opCurrency === "USD") return;
                      if (!gsToUsd) return alert("Defin? primero el tipo de cambio Gs/USD.");
                      setCompraRows((prev) =>
                        prev.map((r) => ({
                          ...r,
                          usdXKg: convertValue(r.usdXKg, gsToUsd, "toUSD"),
                          total: convertValue(r.total, gsToUsd, "toUSD"),
                          ventaInt: convertValue(r.ventaInt, gsToUsd, "toUSD"),
                        }))
                      );
                      setVentaRows((prev) =>
                        prev.map((r) => ({
                          ...r,
                          usdXKg: convertValue(r.usdXKg, gsToUsd, "toUSD"),
                          total: convertValue(r.total, gsToUsd, "toUSD"),
                          ventaInt: convertValue(r.ventaInt, gsToUsd, "toUSD"),
                        }))
                      );
                      setSegCostoRows((prev) =>
                        prev.map((r) => ({
                          ...r,
                          usd: convertValue(r.usd ?? r.monto, gsToUsd, "toUSD"),
                          monto: convertValue(r.monto, gsToUsd, "toUSD"),
                        }))
                      );
                      setSegVentaRows((prev) =>
                        prev.map((r) => ({
                          ...r,
                          usd: convertValue(r.usd ?? r.monto, gsToUsd, "toUSD"),
                          monto: convertValue(r.monto, gsToUsd, "toUSD"),
                        }))
                      );
                      setOperationCurrency("USD");
                    }}
                  >
                    USD
                  </button>
                  <button
                    type="button"
                    className={`px-2 py-0.5 text-[11px] rounded border ${opCurrency === "PYG" ? "bg-black text-white border-black" : "bg-white"}`}
                    onClick={() => {
                      if (opCurrency === "PYG") return;
                      if (!gsToUsd) return alert("Defin? primero el tipo de cambio Gs/USD.");
                      setCompraRows((prev) =>
                        prev.map((r) => ({
                          ...r,
                          usdXKg: convertValue(r.usdXKg, gsToUsd, "toPYG"),
                          total: convertValue(r.total, gsToUsd, "toPYG"),
                          ventaInt: convertValue(r.ventaInt, gsToUsd, "toPYG"),
                        }))
                      );
                      setVentaRows((prev) =>
                        prev.map((r) => ({
                          ...r,
                          usdXKg: convertValue(r.usdXKg, gsToUsd, "toPYG"),
                          total: convertValue(r.total, gsToUsd, "toPYG"),
                          ventaInt: convertValue(r.ventaInt, gsToUsd, "toPYG"),
                        }))
                      );
                      setSegCostoRows((prev) =>
                        prev.map((r) => ({
                          ...r,
                          usd: convertValue(r.usd ?? r.monto, gsToUsd, "toPYG"),
                          monto: convertValue(r.monto, gsToUsd, "toPYG"),
                        }))
                      );
                      setSegVentaRows((prev) =>
                        prev.map((r) => ({
                          ...r,
                          usd: convertValue(r.usd ?? r.monto, gsToUsd, "toPYG"),
                          monto: convertValue(r.monto, gsToUsd, "toPYG"),
                        }))
                      );
                      setOperationCurrency("PYG");
                    }}
                  >
                    PYG
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-[1fr_120px] bg-blue-50">
                <HeadCell className="text-center">CARGA {modo || "???"}</HeadCell>
                <HeadCell className="text-center">{clase || "???"}</HeadCell>
              </div>

              <div className="grid grid-cols-2">
                <div className="p-3 space-y-2">
                  <div>
                    <div className="text-xs font-semibold text-gray-500 mb-0.5">CLIENTE</div>
                    <div className="font-medium">{deal.org_name || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500 mb-0.5">CONTACTO</div>
                    <div className="font-medium">{deal.contact_name || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500 mb-0.5">TELEFONO</div>
                    <div className="font-medium">{cf["telefono"] || deal.contact_phone || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500 mb-0.5">PESO A UTILIZAR (KG)</div>
                    <NumInput disabled={!canEdit} value={pesoKg} onChange={(e) => setPesoKg(e.target.value)} className="bg-yellow-50 w-40" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500 mb-0.5">PESO BRUTO TOTAL</div>
                    <div className="font-medium">{cf["peso_bruto"] || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500 mb-0.5">PESO VOL. TOTAL</div>
                    <div className="font-medium">{cf["p_vol"] || cf["peso_vol"] || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500 mb-0.5">CANT. DE BULTOS</div>
                    <div className="font-medium">{cf["cant_bultos"] || "—"}</div>
                  </div>
                </div>

                <div className="p-3 space-y-2">
                  <div>
                    <div className="text-xs font-semibold text-gray-500 mb-0.5">ORIGEN</div>
                    <div className="font-medium">{cf["origen_pto"] || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500 mb-0.5">DESTINO</div>
                    <div className="font-medium">{cf["destino_pto"] || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500 mb-0.5">MERC.</div>
                    <Input disabled={!canEdit} value={mercaderia} onChange={(e) => setMercaderia(e.target.value)} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500 mb-0.5">M AWB</div>
                    <Input disabled={!canEdit} value={awb} onChange={(e) => setAwb(e.target.value)} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500 mb-0.5">H B/L</div>
                    <Input disabled={!canEdit} value={hbl} onChange={(e) => setHbl(e.target.value)} />
                  </div>

                  {/* === ALL IN === */}
                  <div className="p-3 mt-1 rounded border bg-green-50">
                    <label className={`text-sm font-semibold flex items-center gap-2 ${!canEdit ? notAllowedCls : ""}`}>
                      <input
                        type="checkbox"
                        disabled={!canEdit}
                        checked={allInEnabled}
                        onChange={(e) => setAllInEnabled(e.target.checked)}
                      />
                      All in (concentrar venta en un servicio)
                    </label>

                    <div className="mt-2">
                      <div className="text-xs text-gray-600 mb-1">Servicio principal:</div>
                      <select
                        disabled={!canEdit || !catalogLoaded}
                        className={`w-full border rounded px-2 py-1 text-sm ${!canEdit ? notAllowedCls : ""}`}
                        value={allInServiceName}
                        onChange={(e) => setAllInServiceName(e.target.value)}
                      >
                        <option value="">— Elegir servicio del catálogo —</option>
                        {catalogServices.map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                      <div className="text-[11px] text-gray-600 mt-2">

                      </div>
                    </div>
                  </div>
                  {/* === /ALL IN === */}

                  <div className="grid grid-cols-[120px_1fr] items-center mt-2">
                    <div className="text-xs font-semibold text-gray-500">Gs/USD</div>
                    <NumInput disabled={!canEdit} value={gsRate} onChange={(e) => setGsRate(e.target.value)} className="w-36 bg-yellow-50" />
                  </div>
                </div>
              </div>
            </Box>

            <Box>
              <div className="py-2 text-center font-bold text-lg bg-green-100">RESUMEN</div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-[1fr_160px] items-center">
                  <div className="font-semibold">COMPRA</div>
                  <div className="text-right font-bold text-lg">{currencyLabel} {formatMoney(totalCostos, currencyLabel)}</div>
                </div>
                <div className="grid grid-cols-[1fr_160px] items-center">
                  <div className="font-semibold">VENTA</div>
                  <div className="text-right font-bold text-lg">{currencyLabel} {formatMoney(totalVentas, currencyLabel)}</div>
                </div>
                <div className="grid grid-cols-[1fr_160px] items-center">
                  <div className="font-semibold">PROFIT GENERAL</div>
                  <div className={`text-right font-bold text-xl ${profitGeneral >= 0 ? "text-green-700" : "text-red-700"}`}>
                    {currencyLabel} {formatMoney(profitGeneral, currencyLabel)}
                  </div>
                </div>
              </div>
              <div className="px-3 py-2 text-xs text-gray-600 bg-gray-50">
                * Compra/Venta incluyen flete + locales + seguro; tipo de cambio Gs/USD editable.
              </div>
            </Box>
          </div>
        </div>

        {/* tablas compra/venta */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <CargoTable
            title="COMPRA DEL AGENTE"
            currency={currencyLabel}
            showProfit={false}
            rows={compraRows}
            setRows={setCompraRows}
            usedKg={pesoKg}
            disabled={!canEdit}
            presetItems={catalogItems}
            currentMode={modo}
          />
          <CargoTable
            title="VENTA AL CLIENTE"
            currency={currencyLabel}
            showProfit
            showTaxRate
            isVenta
            allInEnabled={allInEnabled}
            rows={ventaRowsView}     // vista (concentrada si all-in)
            setRows={setVentaRows}   // edita el crudo (incluye ventaInt)
            usedKg={pesoKg}
            compraRows={compraRows}
            disabled={!canEdit}
            presetItems={catalogItems}
            currentMode={modo}
          />
        </div>

        {/* Locales */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LocalesTable title="COSTOS LOCALES (en Gs)" rows={locRows} setRows={setLocRows} gsToUsd={gsToUsd} disabled={!canEdit} />
          <LocalesTable title="GASTOS LOCALES AL CLIENTE (Gs)" rows={locCliRows} setRows={setLocCliRows} gsToUsd={gsToUsd} showProfit costosRows={locRows} disabled={!canEdit} />
        </div>

        {/* Seguro */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SeguroTable title="COSTOS SEGURO DE CARGA" rows={segCostoRows} setRows={setSegCostoRows} disabled={!canEdit} />
          <SeguroTable title="VENTAS SEGURO DE CARGA" rows={segVentaRows} setRows={setSegVentaRows} showProfit costosRows={segCostoRows} disabled={!canEdit} />
        </div>

        {/* pie + acciones */}
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <div className="flex items-center justify-between gap-8">
            <div className="flex items-center gap-3">
              <button
                disabled={!canEdit}
                title={!canEdit ? titleLock : ""}
                className={`px-4 py-2 rounded text-white ${!canEdit ? "bg-gray-400 " + notAllowedCls : "bg-blue-600 hover:bg-blue-700"
                  }`}
                onClick={saveCostSheet}
              >
                Guardar
              </button>

              {isVentas && budgetStatus === "borrador" && (
                <button className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white" onClick={confirmBudget}>
                  Confirmar presupuesto
                </button>
              )}

              {isAdmin && budgetStatus === "borrador" && (
                <>
                  <button className="px-4 py-2 rounded bg-amber-600 hover:bg-amber-700 text-white" onClick={lockBudget}>
                    Bloquear presupuesto
                  </button>
                  <button className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white" onClick={confirmBudget}>
                    Confirmar presupuesto
                  </button>
                </>
              )}
              {isAdmin && budgetStatus === "bloqueado" && (
                <button className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white" onClick={confirmBudget}>
                  Confirmar presupuesto
                </button>
              )}

              {(isAdmin && (budgetStatus === "bloqueado" || budgetStatus === "confirmado")) && (
                <button className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white" onClick={reopenBudget}>
                  Reabrir presupuesto
                </button>
              )}
            </div>

            <div className="text-right">
              <div className="mb-1.5">
                <span className="text-gray-500 mr-2">Compra total:</span>
                <span className="font-bold text-lg">{currencyLabel} {formatMoney(totalCostos, currencyLabel)}</span>
              </div>
              <div className="mb-1.5">
                <span className="text-gray-500 mr-2">Venta total:</span>
                <span className="font-bold text-lg">{currencyLabel} {formatMoney(totalVentas, currencyLabel)}</span>
              </div>
              <div className={`text-xl font-black ${totalVentas - totalCostos >= 0 ? "text-green-700" : "text-red-700"}`}>
                PROFIT GENERAL: {currencyLabel} {formatMoney(totalVentas - totalCostos, currencyLabel)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
