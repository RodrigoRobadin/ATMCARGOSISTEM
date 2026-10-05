import React, { useState } from 'react';
import { api } from '../api';

export default function OperationDocuments({
  dealId,
  files,
  labels,
  invoices,
  selected,
  onSelect,
  onUploaded,
  onSaveLabel,
  onRemove,
  canDelete,
  fileTypeLabel,
  fileUrl,
  renderFile,
  renderInvoice,
}) {
  const [name, setName] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const selectedFile = files.find((item) => `f-${item.id}` === selected);
  const selectedInvoice = invoices.find((item) => `doc-${item.kind}-${item.id}` === selected);

  async function upload(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const cleanName = name.trim();
    if (!cleanName || !file || busy) return;
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.append('type', 'general');
      body.append('file', file);
      const { data } = await api.post(`/deals/${dealId}/files`, body);
      await onUploaded();
      onSelect(`f-${data.id}`);
      setName('');
      setFile(null);
      formElement.reset();
      try {
        await onSaveLabel(data.id, cleanName);
      } catch {
        setError('El archivo se cargó, pero no se pudo guardar su nombre. Podés corregirlo en la lista.');
      }
    } catch (requestError) {
      setError(requestError?.response?.data?.error || 'No se pudo cargar el archivo.');
    } finally {
      setBusy(false);
    }
  }

  async function saveRename(fileId) {
    const cleanName = renameValue.trim();
    if (!cleanName || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSaveLabel(fileId, cleanName);
      setRenamingId(null);
    } catch {
      setError('No se pudo guardar el nombre del archivo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="bg-white rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-900">Cargar archivos</h3>
        <form onSubmit={upload} className="mt-3 grid gap-3 md:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_auto] md:items-end">
          <label className="block text-sm text-slate-700">
            Nombre del archivo
            <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={name} onChange={(event) => setName(event.target.value)} maxLength={255} required disabled={busy} />
          </label>
          <label className="block text-sm text-slate-700">
            Archivo
            <input className="mt-1 block w-full text-sm" type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} required disabled={busy} />
          </label>
          <button type="submit" disabled={busy || !name.trim() || !file} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {busy ? 'Cargando...' : 'Cargar archivo'}
          </button>
        </form>
        {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
        <div className="space-y-4 xl:max-h-[75vh] xl:overflow-y-auto">
      <section className="bg-white rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-900">Archivos de la operación ({files.length})</h3>
        {!files.length ? <p className="mt-3 text-sm text-slate-500">Sin archivos cargados.</p> : (
          <ul className="mt-3 divide-y divide-slate-200">
            {files.map((item) => (
              <li key={item.id} className={`flex flex-wrap items-center gap-2 py-2 text-sm ${selected === `f-${item.id}` ? 'bg-slate-50' : ''}`}>
                <div className="min-w-0 flex-1">
                  {renamingId === item.id ? (
                    <div className="flex gap-2">
                      <input className="min-w-0 flex-1 rounded border px-2 py-1" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} maxLength={255} aria-label="Nombre del archivo" />
                      <button type="button" onClick={() => saveRename(item.id)} disabled={busy || !renameValue.trim()} className="rounded border px-2 py-1 disabled:opacity-50">Guardar</button>
                      <button type="button" onClick={() => setRenamingId(null)} disabled={busy} className="rounded border px-2 py-1">Cancelar</button>
                    </div>
                  ) : (
                    <>
                      <button type="button" onClick={() => onSelect(`f-${item.id}`)} className="max-w-full truncate text-left font-medium text-blue-700 hover:underline" title={labels[item.id] || item.filename}>{labels[item.id] || item.filename}</button>
                      <div className="text-xs text-slate-500">{fileTypeLabel(item.type)} · {item.created_at ? new Date(item.created_at).toLocaleDateString('es-PY') : ''}</div>
                    </>
                  )}
                </div>
                <button type="button" onClick={() => onSelect(`f-${item.id}`)} className="rounded border px-2 py-1">Ver</button>
                <a href={fileUrl(item.url)} target="_blank" rel="noreferrer" className="rounded border px-2 py-1">Abrir</a>
                {renamingId !== item.id && <button type="button" onClick={() => { setRenamingId(item.id); setRenameValue(labels[item.id] || item.filename); }} className="rounded border px-2 py-1">Renombrar</button>}
                {canDelete && <button type="button" onClick={() => onRemove(item.id)} className="rounded border px-2 py-1 text-red-700">Eliminar</button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {invoices.length > 0 && (
        <section className="bg-white rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Documentos generados ({invoices.length})</h3>
          <ul className="mt-3 divide-y divide-slate-200">
            {invoices.map((item) => (
              <li key={`${item.kind}-${item.id}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>{item.kind === 'credit_note' ? 'Nota de crédito' : 'Factura'} {item.number || item.id}</span>
                <button type="button" onClick={() => onSelect(`doc-${item.kind}-${item.id}`)} className="rounded border px-2 py-1">Ver</button>
              </li>
            ))}
          </ul>
        </section>
      )}

        </div>
        <div className="min-w-0">
          {selectedFile ? renderFile(selectedFile) : selectedInvoice ? renderInvoice(selectedInvoice) : (
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">Seleccioná un documento para verlo aquí.</div>
          )}
        </div>
      </div>
    </div>
  );
}
