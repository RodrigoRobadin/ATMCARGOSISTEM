import React, { useEffect, useState } from "react";
import { api } from "../../api";

const SERVICE_TYPES = [
  "instalacion",
  "inspeccion",
  "mantenimiento",
  "reparacion",
  "retiro",
  "informe_tecnico",
];

const SERVICE_STATUSES = ["pendiente", "ejecutado", "cerrado"];

function resolveUploadUrl(urlPath = "") {
  if (/^https?:\/\//i.test(urlPath)) return urlPath;
  const base = api?.defaults?.baseURL || "";
  try {
    const url = new URL(base);
    return `${url.protocol}//${url.host}${urlPath}`;
  } catch {
    return urlPath;
  }
}

function emptyLog(units = []) {
  return {
    id: null,
    container_unit_id: units[0]?.id || "",
    service_type: "instalacion",
    status: "pendiente",
    performed_at: "",
    technician_name: "",
    description: "",
    report_text: "",
  };
}

export default function ContainerServicesPanel({ dealId, units }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logs, setLogs] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(() => emptyLog(units));
  const [attachments, setAttachments] = useState([]);

  async function loadLogs(preserve = true) {
    setLoading(true);
    try {
      const { data } = await api.get(`/container/deals/${dealId}/services`);
      const rows = Array.isArray(data) ? data : [];
      setLogs(rows);
      if (!preserve) {
        setSelectedId(rows[0]?.id || null);
      } else if (selectedId && !rows.some((row) => row.id === selectedId)) {
        setSelectedId(rows[0]?.id || null);
      } else if (!selectedId && rows[0]?.id) {
        setSelectedId(rows[0].id);
      }
      if (!rows.length) {
        setForm(emptyLog(units));
        setAttachments([]);
      }
    } catch (err) {
      console.error("load container services", err);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLogs(false);
  }, [dealId]);

  useEffect(() => {
    if (!selectedId) {
      setForm(emptyLog(units));
      setAttachments([]);
      return;
    }
    const selected = logs.find((row) => row.id === selectedId);
    if (selected) setForm({ ...selected });
    let live = true;
    (async () => {
      try {
        const { data } = await api.get(`/container/services/${selectedId}/attachments`);
        if (!live) return;
        setAttachments(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("load service attachments", err);
        if (live) setAttachments([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [selectedId, logs, units]);

  async function createLog() {
    try {
      setSaving(true);
      const { data } = await api.post(`/container/deals/${dealId}/services`, emptyLog(units));
      await loadLogs(false);
      setSelectedId(data?.id || null);
    } catch (err) {
      console.error("create container service log", err);
      alert(err?.response?.data?.error || "No se pudo crear el registro tecnico.");
    } finally {
      setSaving(false);
    }
  }

  async function saveLog() {
    if (!form.container_unit_id || !form.service_type) {
      alert("Contenedor y tipo de servicio son obligatorios.");
      return;
    }
    try {
      setSaving(true);
      if (form.id) {
        const { data } = await api.put(`/container/services/${form.id}`, form);
        setLogs((prev) => prev.map((row) => (row.id === form.id ? data : row)));
        setForm((prev) => ({ ...prev, ...data }));
      } else {
        const { data } = await api.post(`/container/deals/${dealId}/services`, form);
        setLogs((prev) => [data, ...prev]);
        setSelectedId(data.id);
      }
      await loadLogs();
    } catch (err) {
      console.error("save container service log", err);
      alert(err?.response?.data?.error || "No se pudo guardar el servicio tecnico.");
    } finally {
      setSaving(false);
    }
  }

  async function removeLog() {
    if (!form.id) return;
    if (!window.confirm("Eliminar este registro tecnico?")) return;
    try {
      await api.delete(`/container/services/${form.id}`);
      setSelectedId(null);
      await loadLogs();
    } catch (err) {
      console.error("delete container service log", err);
      alert(err?.response?.data?.error || "No se pudo eliminar el registro.");
    }
  }

  async function uploadFiles(files) {
    if (!form.id || !files?.length) return;
    const fd = new FormData();
    Array.from(files).forEach((file) => fd.append("files", file));
    try {
      const { data } = await api.post(`/container/services/${form.id}/attachments`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setAttachments(Array.isArray(data) ? data : []);
      await loadLogs();
    } catch (err) {
      console.error("upload container service attachments", err);
      alert(err?.response?.data?.error || "No se pudieron cargar los adjuntos.");
    }
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-4">
      <div className="rounded-2xl border bg-white overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div>
            <div className="font-semibold">Servicios tecnicos</div>
            <div className="text-xs text-slate-500">Historial por contenedor</div>
          </div>
          <button type="button" className="px-3 py-2 rounded-lg border text-sm" onClick={createLog} disabled={saving || !units.length}>
            + Nuevo
          </button>
        </div>
        <div className="divide-y">
          {loading && <div className="px-4 py-6 text-sm text-slate-500">Cargando...</div>}
          {!loading && !logs.length && (
            <div className="px-4 py-6 text-sm text-slate-500">Sin registros tecnicos.</div>
          )}
          {logs.map((row) => (
            <button
              key={row.id}
              type="button"
              className={`w-full text-left px-4 py-3 ${selectedId === row.id ? "bg-slate-50" : "bg-white hover:bg-slate-50"}`}
              onClick={() => setSelectedId(row.id)}
            >
              <div className="font-medium">{row.container_no || `Contenedor #${row.container_unit_id}`}</div>
              <div className="text-xs text-slate-500 mt-1">
                {row.service_type} - {row.status}
              </div>
              <div className="text-xs text-slate-600 mt-1">
                {row.performed_at || "-"} {row.attachment_count ? `- ${row.attachment_count} adj.` : ""}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold">Editor tecnico</div>
            <div className="text-sm text-slate-500">Instalacion, inspeccion, mantenimiento y retiro.</div>
          </div>
          <div className="flex gap-2">
            {!!form.id && (
              <button type="button" className="px-3 py-2 rounded-lg border text-sm" onClick={removeLog}>
                Eliminar
              </button>
            )}
            <button type="button" className="px-3 py-2 rounded-lg bg-black text-white text-sm" onClick={saveLog} disabled={saving || !units.length}>
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>

        {!units.length ? (
          <div className="rounded-xl border border-dashed p-6 text-sm text-slate-500">
            Primero carga contenedores en la operacion para poder registrar servicio tecnico.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <label className="text-sm">
                <div className="text-xs text-slate-600 mb-1">Contenedor</div>
                <select className="w-full border rounded-lg px-3 py-2 bg-white" value={form.container_unit_id || ""} onChange={(e) => setForm((prev) => ({ ...prev, container_unit_id: e.target.value }))}>
                  <option value="">Elegir...</option>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.container_no || `Contenedor #${unit.id}`} - {unit.container_type || "Sin tipo"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <div className="text-xs text-slate-600 mb-1">Tipo</div>
                <select className="w-full border rounded-lg px-3 py-2 bg-white" value={form.service_type || "instalacion"} onChange={(e) => setForm((prev) => ({ ...prev, service_type: e.target.value }))}>
                  {SERVICE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <div className="text-xs text-slate-600 mb-1">Estado</div>
                <select className="w-full border rounded-lg px-3 py-2 bg-white" value={form.status || "pendiente"} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}>
                  {SERVICE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <div className="text-xs text-slate-600 mb-1">Fecha</div>
                <input className="w-full border rounded-lg px-3 py-2" type="date" value={form.performed_at || ""} onChange={(e) => setForm((prev) => ({ ...prev, performed_at: e.target.value }))} />
              </label>
            </div>

            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Tecnico / responsable" value={form.technician_name || ""} onChange={(e) => setForm((prev) => ({ ...prev, technician_name: e.target.value }))} />
            <textarea className="w-full min-h-[120px] border rounded-xl px-3 py-2 text-sm" placeholder="Descripcion del trabajo" value={form.description || ""} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} />
            <textarea className="w-full min-h-[180px] border rounded-xl px-3 py-2 text-sm" placeholder="Informe tecnico" value={form.report_text || ""} onChange={(e) => setForm((prev) => ({ ...prev, report_text: e.target.value }))} />

            {!!form.id && (
              <div className="rounded-xl border p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">Adjuntos</div>
                  <input type="file" multiple onChange={(e) => uploadFiles(e.target.files)} />
                </div>
                {!attachments.length ? (
                  <div className="text-sm text-slate-500">Sin adjuntos.</div>
                ) : (
                  <div className="space-y-2">
                    {attachments.map((file) => (
                      <div key={file.id} className="flex items-center justify-between gap-3 border rounded-lg px-3 py-2 text-sm">
                        <div>
                          <div className="font-medium">{file.original_name || file.filename}</div>
                          <div className="text-xs text-slate-500">{file.mime_type || "-"}</div>
                        </div>
                        <a className="px-3 py-2 rounded-lg border text-sm" href={resolveUploadUrl(file.file_url)} target="_blank" rel="noreferrer">
                          Ver
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
