import React, { useEffect, useState } from "react";
import { api } from "../../api";

const STATUSES = ["pendiente", "aprobada", "pago_parcial", "pagada", "anulada"];
const STATUS_LABELS = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  pago_parcial: "Pago parcial",
  pagada: "Pagada",
  anulada: "Anulada",
};

function StatusBadge({ status }) {
  const key = String(status || "pendiente").toLowerCase();
  const label = STATUS_LABELS[key] || "Pendiente";
  const cls =
    key === "aprobada"
      ? "bg-emerald-100 text-emerald-700"
      : key === "pendiente"
      ? "bg-amber-100 text-amber-700"
      : key === "pago_parcial"
      ? "bg-blue-100 text-blue-700"
      : key === "pagada"
      ? "bg-slate-100 text-slate-700"
      : "bg-red-100 text-red-700";
  return <span className={`text-xs px-2 py-1 rounded ${cls}`}>{label}</span>;
}

function formatMoney(amount, currency) {
  const curr = String(currency || "PYG").toUpperCase();
  const value = Number(amount || 0);
  if (curr === "PYG") {
    return value.toLocaleString("es-PY", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  if (curr === "USD") {
    return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return value.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PaymentOrders() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [filters, setFilters] = useState({
    from_date: "",
    to_date: "",
    payment_from: "",
    payment_to: "",
    due_from: "",
    due_to: "",
    status: "",
    search_q: "",
    supplier_q: "",
    operation_q: "",
    currency_code: "",
  });
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFilters, setExportFilters] = useState(filters);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/admin/ops/payment-orders", { params: filters });
      setRows(Array.isArray(data) ? data : []);
      setSelectedIds(new Set());
    } catch (e) {
      console.error("Error loading payment orders", e);
      setError("No se pudieron cargar las ordenes de pago.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const searchSuggestions = React.useMemo(() => {
    const set = new Set();
    rows.forEach((r) => {
      if (r.supplier_display) set.add(String(r.supplier_display));
      if (r.supplier_ruc) set.add(String(r.supplier_ruc));
      if (r.receipt_number) set.add(String(r.receipt_number));
      if (r.operation_reference) set.add(String(r.operation_reference));
      if (r.order_number) set.add(String(r.order_number));
    });
    return Array.from(set).slice(0, 40);
  }, [rows]);

  async function exportXlsx() {
    try {
      const res = await api.get("/admin/ops/payment-orders/export", {
        params: exportFilters,
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = "ordenes-de-pago.xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      setExportOpen(false);
    } catch (e) {
      console.error("Error exporting payment orders", e);
      alert("No se pudo exportar.");
    }
  }

  function allSelected() {
    if (!rows.length) return false;
    return rows.every((r) => selectedIds.has(r.id));
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const shouldSelect = !allSelected();
      rows.forEach((r) => {
        if (shouldSelect) next.add(r.id);
        else next.delete(r.id);
      });
      return next;
    });
  }

  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function downloadZip() {
    try {
      const ids = Array.from(selectedIds);
      if (!ids.length) return;
      const res = await api.post(
        "/admin/ops/payment-orders/export-zip",
        { ids },
        { responseType: "blob" }
      );
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = "ordenes-de-pago.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      alert(e?.response?.data?.error || "No se pudo descargar el ZIP.");
    }
  }

  async function openPdf(row) {
    try {
      const res = await api.get(
        `/operations/${row.operation_id}/payment-orders/${row.id}/pdf`,
        {
          params: { operation_type: row.operation_type || "deal" },
          responseType: "blob",
        }
      );
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      window.open(url, "_blank", "noopener");
      setTimeout(() => window.URL.revokeObjectURL(url), 10000);
    } catch (e) {
      alert(e?.response?.data?.error || "No se pudo abrir el PDF.");
    }
  }

  async function downloadPdf(row) {
    try {
      const res = await api.get(
        `/operations/${row.operation_id}/payment-orders/${row.id}/pdf`,
        {
          params: { operation_type: row.operation_type || "deal" },
          responseType: "blob",
        }
      );
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `orden-pago-${row.order_number || row.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      alert(e?.response?.data?.error || "No se pudo descargar el PDF.");
    }
  }

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-800">Ordenes de pago</h1>
        <p className="text-slate-500 text-sm">Listado y exportacion de ordenes de pago.</p>
      </div>

      <div className="bg-white rounded-2xl shadow p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            className="border rounded px-2 py-1"
            list="payment-orders-search-suggestions"
            placeholder="Buscar (cliente, factura, referencia, orden)"
            value={filters.search_q}
            onChange={(e) => setFilters((f) => ({ ...f, search_q: e.target.value }))}
          />
          <datalist id="payment-orders-search-suggestions">
            {searchSuggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <input
            className="border rounded px-2 py-1"
            placeholder="Proveedor (nombre o RUC)"
            value={filters.supplier_q}
            onChange={(e) => setFilters((f) => ({ ...f, supplier_q: e.target.value }))}
          />
          <input
            className="border rounded px-2 py-1"
            placeholder="Operacion (referencia)"
            value={filters.operation_q}
            onChange={(e) => setFilters((f) => ({ ...f, operation_q: e.target.value }))}
          />
          <select
            className="border rounded px-2 py-1"
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
          >
            <option value="">Estado</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className="border rounded px-2 py-1"
            value={filters.currency_code}
            onChange={(e) => setFilters((f) => ({ ...f, currency_code: e.target.value }))}
          >
            <option value="">Moneda</option>
            <option value="PYG">PYG</option>
            <option value="USD">USD</option>
          </select>
          <div>
            <div className="text-xs text-slate-500 mb-1">Creacion desde</div>
            <input
              className="border rounded px-2 py-1 w-full"
              type="date"
              value={filters.from_date}
              onChange={(e) => setFilters((f) => ({ ...f, from_date: e.target.value }))}
            />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Creacion hasta</div>
            <input
              className="border rounded px-2 py-1 w-full"
              type="date"
              value={filters.to_date}
              onChange={(e) => setFilters((f) => ({ ...f, to_date: e.target.value }))}
            />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Pago desde</div>
            <input
              className="border rounded px-2 py-1 w-full"
              type="date"
              value={filters.payment_from}
              onChange={(e) => setFilters((f) => ({ ...f, payment_from: e.target.value }))}
            />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Pago hasta</div>
            <input
              className="border rounded px-2 py-1 w-full"
              type="date"
              value={filters.payment_to}
              onChange={(e) => setFilters((f) => ({ ...f, payment_to: e.target.value }))}
            />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Vencimiento desde</div>
            <input
              className="border rounded px-2 py-1 w-full"
              type="date"
              value={filters.due_from}
              onChange={(e) => setFilters((f) => ({ ...f, due_from: e.target.value }))}
            />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Vencimiento hasta</div>
            <input
              className="border rounded px-2 py-1 w-full"
              type="date"
              value={filters.due_to}
              onChange={(e) => setFilters((f) => ({ ...f, due_to: e.target.value }))}
            />
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button className="px-3 py-2 text-sm rounded bg-black text-white" onClick={load}>
            Buscar
          </button>
          <button
            className="px-3 py-2 text-sm rounded border"
            onClick={() => {
              setFilters({
                from_date: "",
                to_date: "",
                payment_from: "",
                payment_to: "",
                due_from: "",
                due_to: "",
                status: "",
                search_q: "",
                supplier_q: "",
                operation_q: "",
                currency_code: "",
              });
            }}
          >
            Limpiar
          </button>
          <button
            className="px-3 py-2 text-sm rounded border"
            onClick={() => {
              setExportFilters(filters);
              setExportOpen(true);
            }}
          >
            Exportar
          </button>
          {selectedIds.size > 0 && (
            <>
              <button className="px-3 py-2 text-sm rounded border" onClick={downloadZip}>
                Descargar ZIP
              </button>
              <div className="text-sm text-slate-600 flex items-center">
                Seleccionadas: <span className="ml-1 font-semibold">{selectedIds.size}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {error && <div className="text-sm text-red-600 mb-3">{error}</div>}

      <div className="bg-white rounded-2xl shadow overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="text-left px-3 py-2">
                <input type="checkbox" checked={allSelected()} onChange={toggleSelectAll} />
              </th>
              <th className="text-left px-3 py-2">Orden</th>
              <th className="text-left px-3 py-2">Proveedor</th>
              <th className="text-left px-3 py-2">Factura</th>
              <th className="text-left px-3 py-2">Cant</th>
              <th className="text-left px-3 py-2">Operacion</th>
              <th className="text-left px-3 py-2">Metodo</th>
              <th className="text-left px-3 py-2">Fecha pago</th>
              <th className="text-left px-3 py-2">Vencimiento</th>
              <th className="text-left px-3 py-2">Monto</th>
              <th className="text-left px-3 py-2">Pagado</th>
              <th className="text-left px-3 py-2">Saldo</th>
              <th className="text-left px-3 py-2">Estado</th>
              <th className="text-left px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={15} className="px-3 py-4 text-center text-slate-500">
                  Cargando...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={15} className="px-3 py-4 text-center text-slate-500">
                  Sin resultados.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(r.id)}
                      onChange={() => toggleSelected(r.id)}
                    />
                  </td>
                  <td className="px-3 py-2">{r.order_number || "-"}</td>
                  <td className="px-3 py-2">{r.supplier_display || "-"}</td>
                  <td className="px-3 py-2">
                    {r.invoices_list ? (
                      <div className="flex flex-col gap-1">
                        {String(r.invoices_list)
                          .split("||")
                          .filter(Boolean)
                          .map((part, idx) => {
                            const [num, amt, curr] = part.split("::");
                            const amount = Number(amt || 0);
                            return (
                              <div key={`${r.id}-inv-${idx}`} className="text-xs text-slate-700">
                                {num || "-"} · {(curr || r.currency_code || "PYG")} {formatMoney(amount, curr || r.currency_code)}
                              </div>
                            );
                          })}
                      </div>
                    ) : (
                      <span>{r.receipt_number || "-"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{r.invoice_count || 0}</td>
                  <td className="px-3 py-2">{r.operation_reference || "-"}</td>
                  <td className="px-3 py-2">{r.payment_method || "-"}</td>
                  <td className="px-3 py-2">{r.payment_date || "-"}</td>
                  <td className="px-3 py-2">{r.due_date || "-"}</td>
                  <td className="px-3 py-2">
                    {r.currency_code || "PYG"} {formatMoney(r.amount, r.currency_code)}
                  </td>
                  <td className="px-3 py-2">
                    {r.currency_code || "PYG"} {formatMoney(r.paid_amount, r.currency_code)}
                  </td>
                  <td className="px-3 py-2">
                    {r.currency_code || "PYG"} {formatMoney(r.balance, r.currency_code)}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      <button
                        className="px-2 py-1 rounded border text-xs text-blue-700 hover:bg-blue-50 text-left"
                        onClick={() => openPdf(r)}
                      >
                        Ver PDF
                      </button>
                      <button
                        className="px-2 py-1 rounded border text-xs text-blue-700 hover:bg-blue-50 text-left"
                        onClick={() => downloadPdf(r)}
                      >
                        Descargar PDF
                      </button>
                      {String(r.status || "").toLowerCase() === "pendiente" && (
                        <button
                          className="px-2 py-1 rounded border text-xs text-emerald-700 hover:bg-emerald-50 text-left"
                          onClick={async () => {
                            try {
                              await api.patch(`/admin/ops/payment-orders/${r.id}/approve`);
                              load();
                            } catch (e) {
                              alert(e?.response?.data?.error || "No se pudo aprobar.");
                            }
                          }}
                        >
                          Aprobar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {exportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Exportar ordenes de pago</h3>
              <button className="text-sm underline" onClick={() => setExportOpen(false)}>
                Cerrar
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <input
                className="border rounded px-2 py-1"
                placeholder="Proveedor"
                value={exportFilters.supplier_q}
                onChange={(e) => setExportFilters((f) => ({ ...f, supplier_q: e.target.value }))}
              />
              <input
                className="border rounded px-2 py-1"
                placeholder="Operacion"
                value={exportFilters.operation_q}
                onChange={(e) => setExportFilters((f) => ({ ...f, operation_q: e.target.value }))}
              />
              <select
                className="border rounded px-2 py-1"
                value={exportFilters.status}
                onChange={(e) => setExportFilters((f) => ({ ...f, status: e.target.value }))}
              >
                <option value="">Estado</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="border rounded px-2 py-1"
                  type="date"
                  value={exportFilters.payment_from}
                  onChange={(e) => setExportFilters((f) => ({ ...f, payment_from: e.target.value }))}
                />
                <input
                  className="border rounded px-2 py-1"
                  type="date"
                  value={exportFilters.payment_to}
                  onChange={(e) => setExportFilters((f) => ({ ...f, payment_to: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="border rounded px-2 py-1"
                  type="date"
                  value={exportFilters.due_from}
                  onChange={(e) => setExportFilters((f) => ({ ...f, due_from: e.target.value }))}
                />
                <input
                  className="border rounded px-2 py-1"
                  type="date"
                  value={exportFilters.due_to}
                  onChange={(e) => setExportFilters((f) => ({ ...f, due_to: e.target.value }))}
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="px-4 py-2 text-sm rounded border" onClick={() => setExportOpen(false)}>
                Cancelar
              </button>
              <button className="px-4 py-2 text-sm rounded bg-black text-white" onClick={exportXlsx}>
                Descargar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
