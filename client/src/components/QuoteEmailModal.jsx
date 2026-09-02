import React, { useEffect, useState } from 'react';

export default function QuoteEmailModal({
  open,
  onClose,
  onSend,
  sending = false,
  initialTo = '',
  initialSubject = '',
  initialMessage = '',
  filename = 'presupuesto.pdf',
}) {
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open) return;
    setTo(initialTo || '');
    setCc('');
    setSubject(initialSubject || '');
    setMessage(initialMessage || '');
  }, [open, initialTo, initialSubject, initialMessage]);

  if (!open) return null;

  const submit = (event) => {
    event.preventDefault();
    if (!to.trim() || !subject.trim()) return;
    onSend?.({ to: to.trim(), cc: cc.trim(), subject: subject.trim(), message: message.trim() });
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Enviar presupuesto">
      <form onSubmit={submit} className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Enviar presupuesto</h2>
            <p className="text-sm text-slate-500">El PDF visible se adjuntara al correo.</p>
          </div>
          <button type="button" onClick={onClose} disabled={sending} className="h-9 w-9 border text-xl text-slate-600 hover:bg-slate-50" title="Cerrar">x</button>
        </div>

        <div className="space-y-4 p-5">
          <label className="block text-sm font-medium text-slate-700">
            Para *
            <input type="text" value={to} onChange={(event) => setTo(event.target.value)} placeholder="cliente@empresa.com" className="mt-1 w-full rounded border px-3 py-2" autoFocus />
            <span className="mt-1 block text-xs font-normal text-slate-500">Podes separar varios correos con coma o punto y coma.</span>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            CC
            <input type="text" value={cc} onChange={(event) => setCc(event.target.value)} placeholder="copia@empresa.com" className="mt-1 w-full rounded border px-3 py-2" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Asunto *
            <input type="text" value={subject} onChange={(event) => setSubject(event.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Mensaje
            <textarea rows={7} value={message} onChange={(event) => setMessage(event.target.value)} className="mt-1 w-full resize-y rounded border px-3 py-2" />
          </label>
          <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm">
            <span className="min-w-0 truncate text-slate-600" title={filename}>Adjunto: <strong>{filename}</strong></span>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={onClose} disabled={sending} className="rounded border px-4 py-2 font-medium text-slate-700 disabled:opacity-50">Cancelar</button>
              <button type="submit" disabled={sending || !to.trim() || !subject.trim()} className="rounded bg-emerald-700 px-4 py-2 font-medium text-white disabled:opacity-50">
                {sending ? 'Enviando...' : 'Enviar correo'}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
