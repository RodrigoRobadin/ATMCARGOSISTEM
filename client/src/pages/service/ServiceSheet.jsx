// client/src/pages/service/ServiceSheet.jsx
import React, { useMemo, useState } from "react";
import { api } from "../../api";

const fmtMoney = (n = 0, currency = "USD") =>
  new Intl.NumberFormat("es-PY", {
    style: "currency",
    currency: (currency || "USD").toUpperCase(),
    minimumFractionDigits: 2,
  }).format(Number(n) || 0);

function monthLabel(ym) {
  if (!ym) return "";
  const [y, m] = String(ym).split("-");
  if (!y || !m) return ym;
  return `${m}/${y}`;
}

function CostModal({ open, onClose, row, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState([]);

  React.useEffect(() => {
    if (!open || !row) return;
    setNotes(row.real_cost_notes || "");
    const baseItems = Array.isArray(row.install_items) ? row.install_items : [];
    const realItems = Array.isArray(row.real_cost_items) ? row.real_cost_items : [];
    const realByLine = new Map(realItems.map((it) => [Number(it.line_no || 0), it]));
    const mapped = baseItems.map((it, idx) => {
      const line = Number(it.line_no || idx + 1);
      const real = realByLine.get(line);
      return {
        line_no: line,
        description: it.description || "",
        qty: Number(it.qty || 0) || 1,
        unit_cost_gs: Number(it.unit_cost_gs || 0) || 0,
        real_cost_gs: Number(real?.real_cost_gs ?? 0) || 0,
      };
    });
    setItems(mapped);
  }, [open, row]);

  if (!open || !row) return null;

  async function save() {
    setSaving(true);
    try {
      const installRate = Number(row.install_rate || 1) || 1;
      const totalRealGs = items.reduce((sum, it) => sum + Number(it.real_cost_gs || 0), 0);
      await api.put(`/service/cases/${row.service_case_id}/install-cost`, {
        real_cost_amount: Number(totalRealGs || 0),
        real_cost_currency: "PYG",
        real_cost_exchange_rate: installRate,
        real_cost_items: items.map((it) => ({
          line_no: it.line_no,
          description: it.description,
          qty: it.qty,
          real_cost_gs: Number(it.real_cost_gs || 0),
        })),
        notes: notes || null,
      });
      onSaved && onSaved();
      onClose();
    } catch (e) {
      alert("No se pudo guardar el costo real");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl w-full max-w-4xl p-4 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-lg font-semibold">Costo de instalación</div>
            <div className="text-xs text-slate-500">
              Servicio {row.reference || `#${row.service_case_id}`}
            </div>
          </div>
          <button type="button" className="text-sm px-3 py-1.5 rounded border" onClick={onClose}>
            Cerrar
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-slate-50 border rounded p-3">
            <div className="text-xs text-slate-500">Costo cotizado (USD)</div>
            <div className="text-sm font-semibold">
              {fmtMoney(row.cost_cotizado_usd || 0, "USD")}
            </div>
            <div className="text-xs text-slate-500 mt-2">Costo cotizado (Gs)</div>
            <div className="text-sm font-semibold">
              {fmtMoney(row.cost_cotizado_gs || 0, "PYG")}
            </div>
          </div>
          <div className="bg-slate-50 border rounded p-3">
            <div className="text-xs text-slate-500">Servicio cotizado (USD)</div>
            <div className="text-sm font-semibold">
              {fmtMoney(row.servicio_cotizado_usd || 0, "USD")}
            </div>
            <div className="text-xs text-slate-500 mt-2">Servicio cotizado (Gs)</div>
            <div className="text-sm font-semibold">
              {fmtMoney(row.servicio_cotizado_gs || 0, "PYG")}
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-500">TC instalación (Gs/USD)</label>
            <input
              className="border rounded px-2 py-1 w-full bg-slate-50"
              value={row.install_rate || 1}
              readOnly
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-slate-500">Notas</label>
            <textarea
              className="border rounded px-2 py-1 w-full"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-3">
          <div className="text-sm font-semibold mb-2">Detalle de instalación (Gs)</div>
          <div className="border rounded overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="text-left px-3 py-2">Item</th>
                  <th className="text-left px-3 py-2">Descripción</th>
                  <th className="text-right px-3 py-2">Cant</th>
                  <th className="text-right px-3 py-2">Costo cotizado</th>
                  <th className="text-right px-3 py-2">Costo real</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => {
                  const cot = Number(it.unit_cost_gs || 0) * Number(it.qty || 0);
                  return (
                    <tr key={it.line_no || idx} className="border-t">
                      <td className="px-3 py-2">{it.line_no}</td>
                      <td className="px-3 py-2">{it.description || "-"}</td>
                      <td className="px-3 py-2 text-right">{it.qty}</td>
                      <td className="px-3 py-2 text-right">{fmtMoney(cot, "PYG")}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          className="border rounded px-2 py-1 w-32 text-right"
                          value={it.real_cost_gs}
                          onChange={(e) => {
                            const val = e.target.value;
                            setItems((prev) => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], real_cost_gs: val };
                              return next;
                            });
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                      Sin items de instalación.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ServiceSheet() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ from: "", to: "" });
  const [monthFrom, setMonthFrom] = useState("01");
  const [monthTo, setMonthTo] = useState("12");
  const [year, setYear] = useState(new Date().getFullYear());
  const [statusFilter, setStatusFilter] = useState("facturado"); // facturado | cobrado | no_cobrado | todos
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [costRow, setCostRow] = useState(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const y = Number(year) || new Date().getFullYear();
      const mFrom = String(monthFrom || "01").padStart(2, "0");
      const mTo = String(monthTo || "12").padStart(2, "0");
      const from = `${y}-${mFrom}-01`;
      const toDate = new Date(y, Number(mTo) - 1 + 1, 0);
      const to = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, "0")}-${String(
        toDate.getDate()
      ).padStart(2, "0")}`;
      const params = { ...filters, from, to };
      const { data } = await api.get("/service/sheet", { params });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError("No se pudo cargar la planilla.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    const q = String(search || "").toLowerCase().trim();
    const filteredRows = rows.filter((r) => {
      const cobrado = Number(r.cobrado || 0);
      const noCobrado = Number(r.no_cobrado || 0);
      if (statusFilter === "cobrado") return cobrado > 0 && noCobrado <= 0.01;
      if (statusFilter === "no_cobrado") return noCobrado > 0.01;
      if (statusFilter === "facturado") return true;
      return true;
    });
    const searched = q
      ? filteredRows.filter((r) => {
          const hay = [
            r.reference,
            r.servicio_cotizado_desc,
            r.invoice_number,
            r.issue_date,
            r.org_name,
            r.currency,
            r.monto_factura,
            r.cobrado,
            r.no_cobrado,
            r.costo_real,
            r.profit_real,
          ]
            .filter(Boolean)
            .map((v) => String(v).toLowerCase())
            .join(" ");
          return hay.includes(q);
        })
      : filteredRows;
    const map = new Map();
    searched.forEach((r) => {
      const key = r.month || "sin-fecha";
      if (!map.has(key)) map.set(key, { month: key, items: [] });
      map.get(key).items.push(r);
    });
    return Array.from(map.values()).sort((a, b) => (a.month || "").localeCompare(b.month || ""));
  }, [rows, statusFilter, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          className="border rounded px-2 py-1"
          value={monthFrom}
          onChange={(e) => setMonthFrom(e.target.value)}
        >
          <option value="01">Enero</option>
          <option value="02">Febrero</option>
          <option value="03">Marzo</option>
          <option value="04">Abril</option>
          <option value="05">Mayo</option>
          <option value="06">Junio</option>
          <option value="07">Julio</option>
          <option value="08">Agosto</option>
          <option value="09">Septiembre</option>
          <option value="10">Octubre</option>
          <option value="11">Noviembre</option>
          <option value="12">Diciembre</option>
        </select>
        <span className="text-sm text-slate-500">a</span>
        <select
          className="border rounded px-2 py-1"
          value={monthTo}
          onChange={(e) => setMonthTo(e.target.value)}
        >
          <option value="01">Enero</option>
          <option value="02">Febrero</option>
          <option value="03">Marzo</option>
          <option value="04">Abril</option>
          <option value="05">Mayo</option>
          <option value="06">Junio</option>
          <option value="07">Julio</option>
          <option value="08">Agosto</option>
          <option value="09">Septiembre</option>
          <option value="10">Octubre</option>
          <option value="11">Noviembre</option>
          <option value="12">Diciembre</option>
        </select>
        <input
          type="number"
          className="border rounded px-2 py-1 w-24"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />
        <input
          className="border rounded px-2 py-1 w-64"
          placeholder="Buscar en planilla..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="border rounded px-2 py-1"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="facturado">Facturado</option>
          <option value="cobrado">Cobrado</option>
          <option value="no_cobrado">No cobrado</option>
          <option value="todos">Todos</option>
        </select>
        <button className="btn btn-primary" onClick={load} disabled={loading}>
          Buscar
        </button>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}
      {loading ? (
        <div className="text-sm text-slate-500">Cargando...</div>
      ) : (
        <div className="space-y-4">
          {grouped.map((g) => {
            const byRef = new Map();
            g.items.forEach((r) => {
              const key = r.service_case_id || r.reference || "sin-ref";
              if (!byRef.has(key)) {
                byRef.set(key, {
                  key,
                  reference: r.reference,
                  service_case_id: r.service_case_id,
                  servicio_desc: r.servicio_cotizado_desc,
                  rows: [],
                });
              }
              byRef.get(key).rows.push(r);
            });
            const refGroups = Array.from(byRef.values());
            const totalsByCurrency = refGroups.flatMap((rg) => rg.rows).reduce((acc, r) => {
              const curr = String(r.currency || "USD").toUpperCase();
              if (!acc[curr]) acc[curr] = { monto: 0, cobrado: 0, no_cobrado: 0, costo: 0, profit: 0 };
              acc[curr].monto += Number(r.monto_factura || 0);
              acc[curr].cobrado += Number(r.cobrado || 0);
              acc[curr].no_cobrado += Number(r.no_cobrado || 0);
              acc[curr].costo += Number(r.cost_cotizado || 0);
              acc[curr].profit += Number(r.profit_servicio || 0);
              return acc;
            }, {});
            return (
            <div key={g.month} className="bg-white border rounded-lg overflow-auto">
              <div className="bg-slate-100 px-3 py-2 text-sm font-semibold">
                {monthLabel(g.month)}
              </div>
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="text-left px-3 py-2">Referencia servicio</th>
                    <th className="text-left px-3 py-2">Servicio cotizado</th>
                    <th className="text-left px-3 py-2">Factura Nro</th>
                    <th className="text-left px-3 py-2">Fecha</th>
                    <th className="text-left px-3 py-2">Costo</th>
                    <th className="text-left px-3 py-2">Monto</th>
                    <th className="text-left px-3 py-2">Profit</th>
                    <th className="text-left px-3 py-2">Cobrado</th>
                    <th className="text-left px-3 py-2">Por cobrar</th>
                    <th className="text-left px-3 py-2">Estado</th>
                    <th className="text-left px-3 py-2">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {refGroups.map((grp) => (
                    <React.Fragment key={grp.key}>
                      <tr className="border-t bg-slate-50">
                          <td className="px-3 py-2" colSpan={11}>
                          {(() => {
                            const first = grp.rows[0];
                            const cobrado = Number(first?.cobrado || 0);
                            const noCobrado = Number(first?.no_cobrado || 0);
                            const cls =
                              cobrado > 0 && noCobrado <= 0.01
                                ? "text-green-800 bg-green-100 border border-green-200"
                                : noCobrado > 0.01
                                ? "text-yellow-900 bg-yellow-100 border border-yellow-200"
                                : "text-blue-800 bg-blue-100 border border-blue-200";
                            return (
                              <a
                                className={`inline-flex items-center px-2 py-1 rounded ${cls}`}
                                href={`/service/cases/${grp.service_case_id}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {grp.reference || `#${grp.service_case_id}`}
                              </a>
                            );
                          })()}
                          <span className="ml-2 text-xs text-slate-500">
                            {grp.servicio_desc || "-"}
                          </span>
                        </td>
                      </tr>
                      {grp.rows.map((r) => (
                        <tr key={r.invoice_id} className="border-t">
                          <td className="px-3 py-2"></td>
                          <td className="px-3 py-2"></td>
                          <td className="px-3 py-2">
                            {r.invoice_number ? (
                              <a
                                className="text-blue-600 underline"
                                href={`/invoices/${r.invoice_id}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {r.invoice_number}
                              </a>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="px-3 py-2">{(r.issue_date || "").slice(0, 10) || "-"}</td>
                          <td className="px-3 py-2">{fmtMoney(r.cost_cotizado, r.currency)}</td>
                          <td className="px-3 py-2">{fmtMoney(r.monto_factura, r.currency)}</td>
                          <td className="px-3 py-2">{fmtMoney(r.profit_servicio, r.currency)}</td>
                          <td className="px-3 py-2">{fmtMoney(r.cobrado, r.currency)}</td>
                          <td className="px-3 py-2">{fmtMoney(r.no_cobrado, r.currency)}</td>
                          <td className="px-3 py-2">
                            {(() => {
                              const cobrado = Number(r.cobrado || 0);
                              const noCobrado = Number(r.no_cobrado || 0);
                              if (cobrado > 0 && noCobrado <= 0.01) {
                                return <span className="text-xs px-2 py-1 rounded bg-green-100 text-green-700">Cobrado</span>;
                              }
                              if (noCobrado > 0.01) {
                                return <span className="text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-800">No cobrado</span>;
                              }
                              return <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700">Facturado</span>;
                            })()}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              className="text-blue-600 underline"
                              onClick={() => setCostRow(r)}
                            >
                              Ver costos
                            </button>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                  {g.items.length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-3 py-4 text-center text-slate-500">
                        Sin registros.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="bg-slate-50 border-t">
                  {Object.keys(totalsByCurrency).map((curr) => (
                    <tr key={curr}>
                      <td className="px-3 py-2 text-xs text-slate-500" colSpan={4}>
                        Resumen {curr}
                      </td>
                      <td className="px-3 py-2 text-sm font-semibold">
                        {fmtMoney(totalsByCurrency[curr].costo, curr)}
                      </td>
                      <td className="px-3 py-2 text-sm font-semibold">
                        {fmtMoney(totalsByCurrency[curr].monto, curr)}
                      </td>
                      <td className="px-3 py-2 text-sm font-semibold">
                        {fmtMoney(totalsByCurrency[curr].profit, curr)}
                      </td>
                      <td className="px-3 py-2 text-sm font-semibold">
                        {fmtMoney(totalsByCurrency[curr].cobrado, curr)}
                      </td>
                      <td className="px-3 py-2 text-sm font-semibold">
                        {fmtMoney(totalsByCurrency[curr].no_cobrado, curr)}
                      </td>
                      <td className="px-3 py-2" colSpan={2}></td>
                    </tr>
                  ))}
                </tfoot>
              </table>
            </div>
          );})}
          {grouped.length === 0 && (
            <div className="text-sm text-slate-500">Sin registros.</div>
          )}
        </div>
      )}

      <CostModal
        open={Boolean(costRow)}
        row={costRow}
        onClose={() => setCostRow(null)}
        onSaved={load}
      />
    </div>
  );
}
