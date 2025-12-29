import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";

export default function Quotes() {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  async function loadQuotes() {
    setLoading(true);
    try {
      const { data } = await api.get("/quotes");
      setQuotes(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Error cargando cotizaciones", e);
      setQuotes([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadQuotes();
  }, []);

  function exportXlsx(id) {
    // usa baseURL de axios
    // con api.js tu base ya es /api o localhost:4000/api
    const url = `${api.defaults.baseURL}/quotes/${id}/export-xlsx`;
    window.open(url, "_blank");
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Cotizaciones</h2>
        <button
          className="px-3 py-2 rounded-lg bg-blue-600 text-white hover:opacity-90"
          onClick={() => navigate("/quotes/new")}
        >
          Nueva cotización
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Cargando...</div>
      ) : (
        <div className="overflow-auto rounded-xl border">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="px-3 py-2">Ref</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Total ventas USD</th>
                <th className="px-3 py-2 text-right">Profit total USD</th>
                <th className="px-3 py-2">Actualizado</th>
                <th className="px-3 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {quotes.length === 0 && (
                <tr>
                  <td className="px-3 py-2 text-slate-500" colSpan={7}>
                    Sin registros.
                  </td>
                </tr>
              )}
              {quotes.map((q) => (
                <tr key={q.id} className="border-t">
                  <td className="px-3 py-2">{q.ref_code || `#${q.id}`}</td>
                  <td className="px-3 py-2">{q.client_name || "-"}</td>
                  <td className="px-3 py-2">{q.status || "draft"}</td>
                  <td className="px-3 py-2 text-right">
                    {q.total_sales_usd != null ? q.total_sales_usd.toFixed(2) : "-"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {q.profit_total_usd != null ? q.profit_total_usd.toFixed(2) : "-"}
                  </td>
                  <td className="px-3 py-2 text-slate-500">
                    {q.updated_at ? new Date(q.updated_at).toLocaleString() : "-"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-3 items-center">
                      <Link className="text-blue-600 underline" to={`/quotes/${q.id}`}>
                        Editar
                      </Link>

                      <button
                        className="text-emerald-700 underline"
                        onClick={() => exportXlsx(q.id)}
                      >
                        Export XLSX
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}