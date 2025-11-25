// client/src/pages/DetCosSheet.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

// === helpers de UI disabled/lock ===
const notAllowedCls = "cursor-not-allowed select-none";
const titleLock = "🚫 Presupuesto bloqueado";

/* ===================== helpers ===================== */
const money = (n) =>
  isNaN(n)
    ? "0,00"
    : Number(n).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

const num = (v) => {
  if (v === "" || v === null || v === undefined) return 0;
  const s = String(v).replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return isNaN(n) ? 0 : n;
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

/* ===================== tablas ===================== */
function CargoTable({
  title,
  showProfit,
  isVenta = false,           // 👈 saber si es la tabla de venta
  allInEnabled = false,     // 👈 para mostrar la columna “Venta (interno)”
  rows,
  setRows,
  usedKg,
  compraRows = null,
  disabled = false,
  presets = [],
}) {
  const ignoredLinksRef = useRef(new Set());

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
    ? "grid auto-rows-min grid-cols-[minmax(220px,1fr)_120px_140px_140px_140px]"
    : "grid auto-rows-min grid-cols-[minmax(220px,1fr)_120px_140px_140px]";

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[820px]">
        <Box>
          <div className={`py-2 text-center font-bold text-base ${title.includes("COMPRA") ? "bg-blue-100" : "bg-green-100"}`}>
            {title}
          </div>

          <div className={gridCols}>
            <HeadCell className="bg-blue-100">CARGOS</HeadCell>
            <HeadCell className="bg-blue-100 text-right">USD X KG</HeadCell>

            {/* Cuando es venta + all-in: aparece columna de “VENTA (interno)” */}
            {isVenta && allInEnabled && (
              <HeadCell className="bg-blue-100 text-right">VENTA (interno)</HeadCell>
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
                        value={presets.includes(r.concepto) ? r.concepto : ""}
                        onChange={(e) => {
                          if (disabled) return;
                          const v = e.target.value;
                          setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, concepto: v || r.concepto } : x)));
                        }}
                      >
                        <option value="">preset…</option>
                        {presets.map((p) => (
                          <option key={p} value={p}>{p}</option>
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
                    {r.lockPerKg && <div className="text-[11px] text-right text-gray-500 mt-0.5">= {money(computed)}</div>}
                  </Cell>

                  <Cell className="bg-white">
                    <div className="flex items-center justify-end gap-2">
                      {showProfit ? (
                        <span className={profit >= 0 ? "text-green-600" : "text-red-600"}>
                          {profit === null ? "—" : money(profit)}
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
                    {presets.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div className="text-sm">
                <span className="font-bold">TOTAL:</span>
                <span className="ml-2 font-black">$ {money(tableTotal)}</span>
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
  const addRow = () => { if (!disabled) setRows((prev) => [...prev, { id: crypto.randomUUID(), concepto: "", gs: "" }]); };
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
          next.push({ id: crypto.randomUUID(), sourceId: cr.id, concepto: cr.concepto || "", gs: "" });
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
          <div className="grid auto-rows-min grid-cols-[minmax(220px,1fr)_160px_140px]">
            <HeadCell className="bg-blue-100">Concepto</HeadCell>
            <HeadCell className="bg-blue-100 text-right">Gs</HeadCell>
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
                  <Cell className="bg-white">
                    <div className="flex items-center justify-end gap-2">
                      {showProfit ? (
                        <span className={profit >= 0 ? "text-green-600" : "text-red-600"}>
                          {profit === null ? "—" : money(profit)}
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
                <span className="font-black">Gs {totalGs.toLocaleString()}</span>
                <span className="ml-2 text-gray-500">= USD {money(totalUsd)}</span>
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
  const addRow = () => { if (!disabled) setRows((prev) => [...prev, { id: crypto.randomUUID(), concepto: "", usd: "" }]); };
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
          next.push({ id: crypto.randomUUID(), sourceId: cr.id, concepto: cr.concepto || "", usd: "" });
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
          <div className="grid auto-rows-min grid-cols-[minmax(220px,1fr)_140px_140px]">
            <HeadCell className="bg-blue-100">Concepto</HeadCell>
            <HeadCell className="bg-blue-100 text-right">USD</HeadCell>
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
                  <Cell className="bg-white">
                    <div className="flex items-center justify-end gap-2">
                      {showProfit ? (
                        <span className={profit >= 0 ? "text-green-600" : "text-red-600"}>
                          {profit === null ? "—" : money(profit)}
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
                TOTAL: <span className="font-black">$ {money(totalUsd)}</span>
              </div>
            </div>
          </div>
        </Box>
      </div>
    </div>
  );
}

/* ===================== pagina ===================== */
export default function DetCosSheet() {
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

  // cabecera / parametros
  const [modo, setModo] = useState("");
  const [clase, setClase] = useState("");
  const [pesoKg, setPesoKg] = useState("");
  const [awb, setAwb] = useState("");
  const [hbl, setHbl] = useState("");
  const [mercaderia, setMercaderia] = useState("");
  const [gsRate, setGsRate] = useState("5860");

  // presets desde catálogo
  const [catalogServices, setCatalogServices] = useState([]);
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
          const names = (items || [])
            .filter((it) => SERVICES.has(String(it.type || "").toUpperCase()))
            .map((it) => String(it.name || "").trim())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b));

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
      { id: crypto.randomUUID(), concepto: allInServiceName, usdXKg: "", total: String(total), lockPerKg: false },
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
  const totalLocalesUsd = useMemo(() => (gsToUsd ? totalLocalesGs / gsToUsd : 0), [totalLocalesGs, gsToUsd]);
  const totalLocalesClienteGs = useMemo(() => locCliRows.reduce((a, r) => a + num(r.gs), 0), [locCliRows]);
  const totalLocalesClienteUsd = useMemo(() => (gsToUsd ? totalLocalesClienteGs / gsToUsd : 0), [totalLocalesClienteGs, gsToUsd]);
  const segCostoUsd = useMemo(() => segCostoRows.reduce((a, r) => a + num(r.usd || r.monto || 0), 0), [segCostoRows]);
  const segVentaUsd = useMemo(() => segVentaRows.reduce((a, r) => a + num(r.usd || r.monto || 0), 0), [segVentaRows]);
  const totalCostos = useMemo(() => totalCompra + totalLocalesUsd + segCostoUsd, [totalCompra, totalLocalesUsd, segCostoUsd]);
  const totalVentas = useMemo(() => totalVenta + totalLocalesClienteUsd + segVentaUsd, [totalVenta, totalLocalesClienteUsd, segVentaUsd]);
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
    } catch (err) {
      console.error("Error al cargar versión actual:", err);
      setCurrentVersion(null);
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
      setAllInEnabled(!!h.allInEnabled);
      setAllInServiceName(h.allInServiceName || "");
      setCompraRows(Array.isArray(d.compraRows) ? d.compraRows : []);
      setVentaRows(Array.isArray(d.ventaRows) ? d.ventaRows : []);
      setLocRows(Array.isArray(d.locRows) ? d.locRows : []);
      setLocCliRows(Array.isArray(d.locCliRows) ? d.locCliRows : []);
      setSegCostoRows(Array.isArray(d.segCostoRows) ? d.segCostoRows : []);
      setSegVentaRows(Array.isArray(d.segVentaRows) ? d.segVentaRows : []);
      setSelectedVersionNum(versionNum);
    } catch (err) {
      console.error("Error al cargar versión:", err);
      alert("No se pudo cargar la versión");
    }
  }

  // === NUEVO: Crear nueva revisión ===
  async function createNewRevision() {
    const reason = prompt("Razón de la nueva revisión:");
    if (!reason) return;

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
        change_reason: reason,
      });
      await updateDealValue(profitGeneral);
      await loadVersions();
      await loadCurrentVersion();
      setSelectedVersionNum(null);
      alert("Nueva revisión creada ✓");
    } catch (err) {
      console.error("Error al crear revisión:", err);
      alert("Error al crear nueva revisión");
    }
  }

  // === REEMPLAZADO: guardar usando sistema de versiones ===
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
      },
      compraRows,
      ventaRows, // guardamos “crudo” (incluye ventaInt)
      locRows,
      locCliRows,
      segCostoRows,
      segVentaRows,
      totals: { totalCostos, totalVentas, profitGeneral },
    };

    try {
      if (currentVersion?.status === "borrador") {
        // Actualizar versión actual si es borrador
        await api.put(
          `/deals/${id}/cost-sheet/versions/${currentVersion.id}`,
          { data: payload }
        );
        alert("Versión actualizada ✓");
      } else {
        // Crear nueva versión
        const reason = prompt("Razón del cambio (opcional):");
        await api.post(`/deals/${id}/cost-sheet/versions`, {
          data: payload,
          change_reason: reason || "Actualización de presupuesto",
        });
        alert("Nueva versión creada ✓");
      }
      await updateDealValue(profitGeneral);
      await loadVersions();
      await loadCurrentVersion();
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
                  v{v.version_number} - {v.status} ({new Date(v.created_at).toLocaleDateString()})
                </option>
              ))}
            </select>
          )}

          {/* === NUEVO: Botón Nueva Revisión - SIEMPRE VISIBLE === */}
          {canEdit && (
            <button
              onClick={createNewRevision}
              className="px-3 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700"
              title="Crear nueva revisión del presupuesto"
            >
              ➕ Nueva Revisión
            </button>
          )}

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
              <strong>Viendo versión {selectedVersionNum}</strong>
              {versions.find((v) => v.version_number === selectedVersionNum)?.change_reason && (
                <span className="ml-3 text-sm text-slate-600">
                  Razón: {versions.find((v) => v.version_number === selectedVersionNum).change_reason}
                </span>
              )}
            </div>
            <button
              onClick={() => {
                setSelectedVersionNum(null);
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
              <div className="grid grid-cols-[1fr_120px_1fr_100px] bg-blue-50">
                <HeadCell className="text-center">CARGA {modo || "—"}</HeadCell>
                <HeadCell className="text-center">{clase || "—"}</HeadCell>
                <HeadCell className="text-right">MONEDA:</HeadCell>
                <HeadCell className="text-left">USD</HeadCell>
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
                  <div className="text-right font-bold text-lg">$ {money(totalCostos)}</div>
                </div>
                <div className="grid grid-cols-[1fr_160px] items-center">
                  <div className="font-semibold">VENTA</div>
                  <div className="text-right font-bold text-lg">$ {money(totalVentas)}</div>
                </div>
                <div className="grid grid-cols-[1fr_160px] items-center">
                  <div className="font-semibold">PROFIT GENERAL</div>
                  <div className={`text-right font-bold text-xl ${profitGeneral >= 0 ? "text-green-700" : "text-red-700"}`}>
                    $ {money(profitGeneral)}
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
            showProfit={false}
            rows={compraRows}
            setRows={setCompraRows}
            usedKg={pesoKg}
            disabled={!canEdit}
            presets={catalogServices}
          />
          <CargoTable
            title="VENTA AL CLIENTE"
            showProfit
            isVenta
            allInEnabled={allInEnabled}
            rows={ventaRowsView}     // vista (concentrada si all-in)
            setRows={setVentaRows}   // edita el crudo (incluye ventaInt)
            usedKg={pesoKg}
            compraRows={compraRows}
            disabled={!canEdit}
            presets={catalogServices}
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
                <span className="font-bold text-lg">$ {money(totalCostos)}</span>
              </div>
              <div className="mb-1.5">
                <span className="text-gray-500 mr-2">Venta total:</span>
                <span className="font-bold text-lg">$ {money(totalVentas)}</span>
              </div>
              <div className={`text-xl font-black ${totalVentas - totalCostos >= 0 ? "text-green-700" : "text-red-700"}`}>
                PROFIT GENERAL: $ {money(totalVentas - totalCostos)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}