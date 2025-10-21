import React, { useEffect, useState } from "react";
import { api } from "../../../api";

export default function DocsDrawer({ open, onClose, op }) {
  const [loading, setLoading] = useState(false);
  const [docs, setDocs] = useState([]);
  const [form, setForm] = useState({
    kind: "OTRO",
    title: "",
    file_url: "",
    notes: "",
  });

  useEffect(() => {
    if (!open || !op?.id) return;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/api/admin/ops/${op.id}/docs?t=${Date.now()}`);
        setDocs(data || []);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, op?.id]);

  const addDoc = async () => {
    if (!form.title || !form.file_url) return;
    const { data } = await api.post(`/api/admin/ops/${op.id}/docs`, form);
    setDocs([data, ...docs]);
    setForm({ kind: "OTRO", title: "", file_url: "", notes: "" });
  };

  const delDoc = async (docId) => {
    await api.delete(`/api/admin/ops/${op.id}/docs/${docId}`);
    setDocs(docs.filter((d) => d.id !== docId));
  };

  const nuevaCompra = () => alert("🧾 Nueva compra: conecta aquí tu endpoint.");
  const emitirFactura = () => alert("💰 Emitir factura: conecta aquí tu endpoint.");

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-[520px] bg-white shadow-xl p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs text-slate-500">Operación</div>
            <div className="font-semibold">
              {op?.reference} — {op?.org_name || op?.contact_name}
            </div>
          </div>
          <button className="px-3 py-1.5 border rounded" onClick={onClose}>
            Cerrar
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          <button className="px-3 py-1.5 border rounded" onClick={nuevaCompra}>
            + Nueva compra
          </button>
          <button className="px-3 py-1.5 border rounded" onClick={emitirFactura}>
            Emitir factura
          </button>
        </div>

        <div className="mb-3">
          <div className="text-sm font-semibold mb-2">Adjuntar documento</div>
          <div className="grid gap-2">
            <select
              className="border rounded px-2 py-1"
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
            >
              <option value="OTRO">OTRO</option>
              <option value="COMPROBANTE">COMPROBANTE</option>
              <option value="FACTURA">FACTURA</option>
              <option value="BL/AWB/CMR">BL/AWB/CMR</option>
            </select>
            <input
              className="border rounded px-2 py-1"
              placeholder="Título"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
            <input
              className="border rounded px-2 py-1"
              placeholder="URL del archivo"
              value={form.file_url}
              onChange={(e) => setForm((f) => ({ ...f, file_url: e.target.value }))}
            />
            <textarea
              className="border rounded px-2 py-1"
              rows={2}
              placeholder="Notas"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
            <div className="flex justify-end">
              <button
                className="px-3 py-1.5 border rounded bg-slate-900 text-white"
                onClick={addDoc}
              >
                Guardar doc
              </button>
            </div>
          </div>
        </div>

        <div className="border-t pt-3">
          <div className="text-sm font-semibold mb-2">Documentos</div>
          {loading && <div className="text-slate-500 text-sm">Cargando…</div>}
          {!loading && docs.length === 0 && (
            <div className="text-slate-400 text-sm">Sin documentos</div>
          )}
          <ul className="space-y-2">
            {docs.map((d) => (
              <li key={d.id} className="border rounded p-2">
                <div className="text-xs text-slate-500">{d.kind}</div>
                <div className="font-medium">{d.title}</div>
                <div className="text-xs truncate">
                  <a
                    className="text-blue-600 underline"
                    href={d.file_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {d.file_url}
                  </a>
                </div>
                {d.notes && (
                  <div className="text-xs text-slate-500 mt-1">{d.notes}</div>
                )}
                <div className="text-xs text-slate-400 mt-1">
                  {new Date(
                    d.uploaded_at || d.created_at || Date.now()
                  ).toLocaleString()}
                </div>
                <div className="mt-2">
                  <button
                    className="px-2 py-1 text-xs border rounded"
                    onClick={() => delDoc(d.id)}
                  >
                    Eliminar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
