import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";

const emptyItem = (n = 1) => ({ line_no: n, description: "", qty: 1, door_value_usd: 0 });
const emptyInstall = (n = 1) => ({ line_no: n, description: "", qty: 1, unit_cost_gs: 0, unit_price_gs: 0 });
const emptyCustoms = (n = 1) => ({ line_no: n, concept_name: "", type: "PERCENT_OF_IMPONIBLE_USD", rate_decimal: 0, amount_usd: 0, amount_gs: 0, include_in_iva_base: true, enabled: true });

export default function QuoteEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === "new" || !id;

  const [inputs, setInputs] = useState({
    ref_code: "",
    client_name: "",
    status: "draft",
    rent_rate: 0.3,
    freight_international_total_usd: 0,
    additional_global_usd: 0,
    additional_mode: "COMPAT_SINGLE_ITEM",
    insurance_sale_total_usd: 0,
    insurance_buy_rate: 0,
    insurance_profit_mode: "CORRECTED",
    exchange_rate_customs_gs_per_usd: 0,
    exchange_rate_customs_internal_gs_per_usd: 1,
    exchange_rate_install_gs_per_usd: 1,
    exchange_rate_operation_buy_usd: 1,
    exchange_rate_operation_sell_usd: 1,
    financing_buy_annual_rate: 0.152,
    financing_sell_annual_rate: 0.182,
    financing_term_months: 6,
    financing_surcharge_rate: 0.1,
    freight_buy_usd: 0,
    items: [emptyItem(1)],
    install_items: [emptyInstall(1)],
    customs_lines: [emptyCustoms(1)],
  });
  const [computed, setComputed] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isNew) loadQuote();
  }, [id]);

  async function loadQuote() {
    setLoading(true);
    try {
      const { data } = await api.get(`/quotes/${id}`);
      setInputs({ ...inputs, ...(data.inputs || {}) });
      setComputed(data.computed || null);
    } catch (e) {
      console.error("Error cargando cotizacion", e);
    } finally {
      setLoading(false);
    }
  }

  const updateField = (k, v) => setInputs((prev) => ({ ...prev, [k]: v }));
  const updateItem = (idx, field, value) => {
    setInputs((prev) => {
      const next = [...(prev.items || [])];
      next[idx] = { ...next[idx], [field]: value };
      return { ...prev, items: next };
    });
  };
  const updateInstall = (idx, field, value) => {
    setInputs((prev) => {
      const next = [...(prev.install_items || [])];
      next[idx] = { ...next[idx], [field]: value };
      return { ...prev, install_items: next };
    });
  };
  const updateCustoms = (idx, field, value) => {
    setInputs((prev) => {
      const next = [...(prev.customs_lines || [])];
      next[idx] = { ...next[idx], [field]: value };
      return { ...prev, customs_lines: next };
    });
  };

  async function saveQuote() {
    setLoading(true);
    try {
      const payload = { inputs };
      const resp = isNew
        ? await api.post("/quotes", payload)
        : await api.put(`/quotes/${id}`, payload);
      setInputs(resp.data.inputs || inputs);
      setComputed(resp.data.computed || null);
      if (isNew && resp.data.id) navigate(`/quotes/${resp.data.id}`);
      alert("Cotizacion guardada");
    } catch (e) {
      console.error("Error guardando", e);
      alert("No se pudo guardar");
    } finally {
      setLoading(false);
    }
  }

  async function recalcQuote() {
    if (isNew) return saveQuote();
    setLoading(true);
    try {
      const { data } = await api.post(`/quotes/${id}/recalculate`);
      setInputs(data.inputs || inputs);
      setComputed(data.computed || null);
      alert("Recalculado");
    } catch (e) {
      console.error("Error recalculando", e);
      alert("No se pudo recalcular");
    } finally {
      setLoading(false);
    }
  }

  const computedTotals = computed?.oferta?.totals || {};
  const oper = computed?.operacion || {};

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Editar cotizacion</h2>
          {id && !isNew && <div className="text-sm text-slate-500">ID: {id}</div>}
        </div>
        <div className="flex gap-2">
          <button
            className="px-3 py-2 rounded-lg border"
            onClick={() => navigate(-1)}
          >
            Volver
          </button>
          <button
            className="px-3 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-60"
            onClick={saveQuote}
            disabled={loading}
          >
            {loading ? "Guardando..." : "Guardar"}
          </button>
          <button
            className="px-3 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-60"
            onClick={recalcQuote}
            disabled={loading}
          >
            Recalcular
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="p-3 rounded-xl border bg-slate-50">
          <div className="text-xs text-slate-500">Total ventas USD</div>
          <div className="text-lg font-semibold">
            {computedTotals.total_sales_usd != null
              ? computedTotals.total_sales_usd.toFixed(2)
              : "-"}
          </div>
        </div>
        <div className="p-3 rounded-xl border bg-slate-50">
          <div className="text-xs text-slate-500">Total compra USD</div>
          <div className="text-lg font-semibold">
            {oper?.totals?.total_buy_usd != null
              ? oper.totals.total_buy_usd.toFixed(2)
              : "-"}
          </div>
        </div>
        <div className="p-3 rounded-xl border bg-slate-50">
          <div className="text-xs text-slate-500">Profit total USD</div>
          <div className="text-lg font-semibold">
            {oper?.totals?.profit_total_usd != null
              ? oper.totals.profit_total_usd.toFixed(2)
              : "-"}
          </div>
        </div>
      </div>

      {/* Datos generales */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="flex flex-col text-sm gap-1">
          Ref
          <input
            className="border rounded px-2 py-1"
            value={inputs.ref_code || ""}
            onChange={(e) => updateField("ref_code", e.target.value)}
          />
        </label>
        <label className="flex flex-col text-sm gap-1">
          Cliente
          <input
            className="border rounded px-2 py-1"
            value={inputs.client_name || ""}
            onChange={(e) => updateField("client_name", e.target.value)}
          />
        </label>
        <label className="flex flex-col text-sm gap-1">
          Estado
          <select
            className="border rounded px-2 py-1"
            value={inputs.status || "draft"}
            onChange={(e) => updateField("status", e.target.value)}
          >
            <option value="draft">Borrador</option>
            <option value="approved">Aprobado</option>
            <option value="sent">Enviado</option>
          </select>
        </label>
      </div>

      {/* Parametros globales */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="flex flex-col text-sm gap-1">
          Rent rate
          <input
            type="number"
            step="0.01"
            className="border rounded px-2 py-1"
            value={inputs.rent_rate}
            onChange={(e) => updateField("rent_rate", parseFloat(e.target.value) || 0)}
          />
        </label>
        <label className="flex flex-col text-sm gap-1">
          Flete intl USD
          <input
            type="number"
            className="border rounded px-2 py-1"
            value={inputs.freight_international_total_usd}
            onChange={(e) => updateField("freight_international_total_usd", parseFloat(e.target.value) || 0)}
          />
        </label>
        <label className="flex flex-col text-sm gap-1">
          Adicional global USD
          <input
            type="number"
            className="border rounded px-2 py-1"
            value={inputs.additional_global_usd}
            onChange={(e) => updateField("additional_global_usd", parseFloat(e.target.value) || 0)}
          />
        </label>
        <label className="flex flex-col text-sm gap-1">
          Modo adicional
          <select
            className="border rounded px-2 py-1"
            value={inputs.additional_mode}
            onChange={(e) => updateField("additional_mode", e.target.value)}
          >
            <option value="COMPAT_SINGLE_ITEM">COMPAT_SINGLE_ITEM</option>
            <option value="PRORATED">PRORATED</option>
          </select>
        </label>
        <label className="flex flex-col text-sm gap-1">
          Seguro venta total USD
          <input
            type="number"
            className="border rounded px-2 py-1"
            value={inputs.insurance_sale_total_usd}
            onChange={(e) => updateField("insurance_sale_total_usd", parseFloat(e.target.value) || 0)}
          />
        </label>
        <label className="flex flex-col text-sm gap-1">
          Seguro compra rate
          <input
            type="number"
            step="0.0001"
            className="border rounded px-2 py-1"
            value={inputs.insurance_buy_rate}
            onChange={(e) => updateField("insurance_buy_rate", parseFloat(e.target.value) || 0)}
          />
        </label>
        <label className="flex flex-col text-sm gap-1">
          Modo profit seguro
          <select
            className="border rounded px-2 py-1"
            value={inputs.insurance_profit_mode}
            onChange={(e) => updateField("insurance_profit_mode", e.target.value)}
          >
            <option value="CORRECTED">CORRECTED</option>
            <option value="COMPAT_SIMPLE">COMPAT_SIMPLE</option>
          </select>
        </label>
        <label className="flex flex-col text-sm gap-1">
          TC Aduana (Gs/USD)
          <input
            type="number"
            className="border rounded px-2 py-1"
            value={inputs.exchange_rate_customs_gs_per_usd}
            onChange={(e) => updateField("exchange_rate_customs_gs_per_usd", parseFloat(e.target.value) || 0)}
          />
        </label>
        <label className="flex flex-col text-sm gap-1">
          TC Aduana interno
          <input
            type="number"
            className="border rounded px-2 py-1"
            value={inputs.exchange_rate_customs_internal_gs_per_usd}
            onChange={(e) => updateField("exchange_rate_customs_internal_gs_per_usd", parseFloat(e.target.value) || 0)}
          />
        </label>
        <label className="flex flex-col text-sm gap-1">
          TC Instalación (Gs/USD)
          <input
            type="number"
            className="border rounded px-2 py-1"
            value={inputs.exchange_rate_install_gs_per_usd}
            onChange={(e) => updateField("exchange_rate_install_gs_per_usd", parseFloat(e.target.value) || 0)}
          />
        </label>
        <label className="flex flex-col text-sm gap-1">
          TC Operación compra
          <input
            type="number"
            className="border rounded px-2 py-1"
            value={inputs.exchange_rate_operation_buy_usd}
            onChange={(e) => updateField("exchange_rate_operation_buy_usd", parseFloat(e.target.value) || 0)}
          />
        </label>
        <label className="flex flex-col text-sm gap-1">
          TC Operación venta
          <input
            type="number"
            className="border rounded px-2 py-1"
            value={inputs.exchange_rate_operation_sell_usd}
            onChange={(e) => updateField("exchange_rate_operation_sell_usd", parseFloat(e.target.value) || 0)}
          />
        </label>
      </div>

      {/* Items principales */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Items</h3>
          <button
            className="px-2 py-1 text-sm rounded border"
            onClick={() =>
              setInputs((prev) => ({
                ...prev,
                items: [...(prev.items || []), emptyItem((prev.items || []).length + 1)],
              }))
            }
          >
            + Item
          </button>
        </div>
        <div className="overflow-auto border rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-2 py-1">#</th>
                <th className="px-2 py-1">Desc</th>
                <th className="px-2 py-1">Qty</th>
                <th className="px-2 py-1">Valor USD</th>
              </tr>
            </thead>
            <tbody>
              {(inputs.items || []).map((it, idx) => (
                <tr key={idx} className="border-t">
                  <td className="px-2 py-1">{it.line_no ?? idx + 1}</td>
                  <td className="px-2 py-1">
                    <input
                      className="border rounded px-1 py-0.5 w-full"
                      value={it.description || ""}
                      onChange={(e) => updateItem(idx, "description", e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      className="border rounded px-1 py-0.5 w-full"
                      value={it.qty}
                      onChange={(e) => updateItem(idx, "qty", parseFloat(e.target.value) || 0)}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      className="border rounded px-1 py-0.5 w-full"
                      value={it.door_value_usd}
                      onChange={(e) =>
                        updateItem(idx, "door_value_usd", parseFloat(e.target.value) || 0)
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Instalacion */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Instalación (Gs)</h3>
          <button
            className="px-2 py-1 text-sm rounded border"
            onClick={() =>
              setInputs((prev) => ({
                ...prev,
                install_items: [
                  ...(prev.install_items || []),
                  emptyInstall((prev.install_items || []).length + 1),
                ],
              }))
            }
          >
            + Línea
          </button>
        </div>
        <div className="overflow-auto border rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-2 py-1">#</th>
                <th className="px-2 py-1">Desc</th>
                <th className="px-2 py-1">Qty</th>
                <th className="px-2 py-1">C Unit Gs</th>
                <th className="px-2 py-1">V Unit Gs</th>
              </tr>
            </thead>
            <tbody>
              {(inputs.install_items || []).map((it, idx) => (
                <tr key={idx} className="border-t">
                  <td className="px-2 py-1">{it.line_no ?? idx + 1}</td>
                  <td className="px-2 py-1">
                    <input
                      className="border rounded px-1 py-0.5 w-full"
                      value={it.description || ""}
                      onChange={(e) => updateInstall(idx, "description", e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      className="border rounded px-1 py-0.5 w-full"
                      value={it.qty}
                      onChange={(e) => updateInstall(idx, "qty", parseFloat(e.target.value) || 0)}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      className="border rounded px-1 py-0.5 w-full"
                      value={it.unit_cost_gs}
                      onChange={(e) =>
                        updateInstall(idx, "unit_cost_gs", parseFloat(e.target.value) || 0)
                      }
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      className="border rounded px-1 py-0.5 w-full"
                      value={it.unit_price_gs}
                      onChange={(e) =>
                        updateInstall(idx, "unit_price_gs", parseFloat(e.target.value) || 0)
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Despacho */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Despacho</h3>
          <button
            className="px-2 py-1 text-sm rounded border"
            onClick={() =>
              setInputs((prev) => ({
                ...prev,
                customs_lines: [
                  ...(prev.customs_lines || []),
                  emptyCustoms((prev.customs_lines || []).length + 1),
                ],
              }))
            }
          >
            + Línea
          </button>
        </div>
        <div className="overflow-auto border rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-2 py-1">#</th>
                <th className="px-2 py-1">Concepto</th>
                <th className="px-2 py-1">Tipo</th>
                <th className="px-2 py-1">Rate</th>
                <th className="px-2 py-1">USD</th>
                <th className="px-2 py-1">Gs</th>
                <th className="px-2 py-1">IVA base</th>
                <th className="px-2 py-1">ON</th>
              </tr>
            </thead>
            <tbody>
              {(inputs.customs_lines || []).map((it, idx) => (
                <tr key={idx} className="border-t">
                  <td className="px-2 py-1">{it.line_no ?? idx + 1}</td>
                  <td className="px-2 py-1">
                    <input
                      className="border rounded px-1 py-0.5 w-full"
                      value={it.concept_name || ""}
                      onChange={(e) => updateCustoms(idx, "concept_name", e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <select
                      className="border rounded px-1 py-0.5"
                      value={it.type}
                      onChange={(e) => updateCustoms(idx, "type", e.target.value)}
                    >
                      <option value="FIXED_USD">FIXED_USD</option>
                      <option value="PERCENT_OF_IMPONIBLE_USD">PERCENT_OF_IMPONIBLE_USD</option>
                      <option value="IVA_PERCENT_OF_BASE_USD">IVA_PERCENT_OF_BASE_USD</option>
                      <option value="FIXED_GS">FIXED_GS</option>
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      step="0.0001"
                      className="border rounded px-1 py-0.5 w-full"
                      value={it.rate_decimal}
                      onChange={(e) =>
                        updateCustoms(idx, "rate_decimal", parseFloat(e.target.value) || 0)
                      }
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      className="border rounded px-1 py-0.5 w-full"
                      value={it.amount_usd}
                      onChange={(e) =>
                        updateCustoms(idx, "amount_usd", parseFloat(e.target.value) || 0)
                      }
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      className="border rounded px-1 py-0.5 w-full"
                      value={it.amount_gs}
                      onChange={(e) =>
                        updateCustoms(idx, "amount_gs", parseFloat(e.target.value) || 0)
                      }
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={!!it.include_in_iva_base}
                      onChange={(e) => updateCustoms(idx, "include_in_iva_base", e.target.checked)}
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={it.enabled !== false}
                      onChange={(e) => updateCustoms(idx, "enabled", e.target.checked)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Financiacion */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <label className="flex flex-col text-sm gap-1">
          Tasa anual compra
          <input
            type="number"
            step="0.0001"
            className="border rounded px-2 py-1"
            value={inputs.financing_buy_annual_rate}
            onChange={(e) => updateField("financing_buy_annual_rate", parseFloat(e.target.value) || 0)}
          />
        </label>
        <label className="flex flex-col text-sm gap-1">
          Tasa anual venta
          <input
            type="number"
            step="0.0001"
            className="border rounded px-2 py-1"
            value={inputs.financing_sell_annual_rate}
            onChange={(e) => updateField("financing_sell_annual_rate", parseFloat(e.target.value) || 0)}
          />
        </label>
        <label className="flex flex-col text-sm gap-1">
          Plazo meses
          <input
            type="number"
            className="border rounded px-2 py-1"
            value={inputs.financing_term_months}
            onChange={(e) => updateField("financing_term_months", parseInt(e.target.value, 10) || 0)}
          />
        </label>
        <label className="flex flex-col text-sm gap-1">
          Recargo finan
          <input
            type="number"
            step="0.0001"
            className="border rounded px-2 py-1"
            value={inputs.financing_surcharge_rate}
            onChange={(e) => updateField("financing_surcharge_rate", parseFloat(e.target.value) || 0)}
          />
        </label>
        <label className="flex flex-col text-sm gap-1">
          Flete compra USD
          <input
            type="number"
            className="border rounded px-2 py-1"
            value={inputs.freight_buy_usd}
            onChange={(e) => updateField("freight_buy_usd", parseFloat(e.target.value) || 0)}
          />
        </label>
      </div>

      {/* Resumen calculos */}
      {computed && (
        <div className="space-y-3">
          <h3 className="font-medium">Resumen calculado</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3 border rounded-lg">
              <div className="text-xs text-slate-500">Despacho (venta USD)</div>
              <div className="text-lg font-semibold">
                {computed.despacho?.totals?.customs_total_sale_usd?.toFixed(2) || "-"}
              </div>
            </div>
            <div className="p-3 border rounded-lg">
              <div className="text-xs text-slate-500">Financiacion venta USD</div>
              <div className="text-lg font-semibold">
                {computed.financiacion?.sell?.financing_total_sale_usd?.toFixed(2) || "-"}
              </div>
            </div>
            <div className="p-3 border rounded-lg">
              <div className="text-xs text-slate-500">Instalacion venta USD</div>
              <div className="text-lg font-semibold">
                {computed.instalacion?.totals?.installation_total_sale_usd?.toFixed(2) || "-"}
              </div>
            </div>
          </div>

          <div className="overflow-auto border rounded-lg">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="px-2 py-1">#</th>
                  <th className="px-2 py-1">Desc</th>
                  <th className="px-2 py-1 text-right">Total USD</th>
                  <th className="px-2 py-1 text-right">Unit USD</th>
                </tr>
              </thead>
              <tbody>
                {(computed.oferta?.items || []).map((it, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="px-2 py-1">{it.line_no}</td>
                    <td className="px-2 py-1">{it.description}</td>
                    <td className="px-2 py-1 text-right">{it.total_sales?.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right">
                      {it.unit_price != null ? it.unit_price.toFixed(2) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
