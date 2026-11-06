import React, { useEffect, useState } from 'react';
import { api } from '../api';

const labels = {
  draft: 'Pendiente de envío', sending: 'Enviando', processing: 'Procesando',
  approved: 'Aprobado', rejected: 'Rechazado', review: 'Requiere revisión', cancelled: 'Cancelado',
  confirmed: 'Confirmado por FactPy, actualizando CRM',
};

export default function FiscalStatusPanel({ type = 'invoice', id, onRefresh, onState }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const base = type === 'credit_note' ? `/invoices/credit-notes/${id}` : `/invoices/${id}`;

  async function load() {
    try {
      const { data } = await api.get(`${base}/fiscal-status`);
      setState(data);
      onState?.(data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo consultar el estado fiscal');
    }
  }

  useEffect(() => { load(); }, [base]);

  async function refresh(path, body) {
    setBusy(true);
    try {
      await api.post(`${base}/${path}`, body);
      await load();
      onRefresh?.();
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo consultar FactPy');
    } finally {
      setBusy(false);
    }
  }

  return <section className="border border-sky-200 bg-sky-50 rounded p-4 space-y-2 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <strong>Estado fiscal: {labels[state?.status] || 'Cargando...'}</strong>
      {state && !['draft', 'approved', 'rejected', 'cancelled'].includes(state.status) &&
        <button type="button" className="btn border border-sky-400" disabled={busy}
          onClick={() => refresh('fiscal-status/refresh')}>
          {busy ? 'Consultando...' : 'Consultar estado'}
        </button>}
      {!state?.provisional_cdc && (state?.status === 'review' || (state?.status === 'rejected' && /^(?:ERROR - Falta certificado de firma|ERROR - No existe el recordID|JSON inválido: Syntax error)/i.test(state.message || ''))) && state.environment === 'test' &&
        <button type="button" className="btn border border-amber-500" disabled={busy}
          onClick={() => {
            if (window.confirm('Se consultará primero si este recibo existe en FactPy Test. Solo si no existe, se reenviará exactamente el mismo número y recibo. ¿Continuar?')) {
              refresh('fiscal-retry', { confirm_same_document: true });
            }
          }}>
          Reintentar mismo envío
        </button>}
      {state?.production_retry_available &&
        <button type="button" className="btn border border-amber-500" disabled={busy}
          onClick={() => {
            if (window.confirm(`Confirmo con FactPy que ${state.document_number} no existe en Producción. Se consultará su estado y se reenviará el mismo número y recibo ${state.receipt_id}. ¿Continuar?`)) {
              refresh('fiscal-retry', { confirm_same_document: true, confirm_factpy_absent: true });
            }
          }}>
          Reintentar mismo envío
        </button>}
    </div>
    {state?.environment && <div>Ambiente: {state.environment}</div>}
    {state?.receipt_id && <div>Recibo de envío: {state.receipt_id}</div>}
    {state?.document_number && <div>Número reservado: {state.document_number}</div>}
    {state?.cdc && <div className="break-all">CDC: {state.cdc}</div>}
    {state?.provisional_cdc && <div className="break-all text-amber-900">CDC recibido de FactPy, pendiente de verificar aprobación: {state.provisional_cdc}</div>}
    {state?.kude_url && <a className="text-blue-700 underline" href={state.kude_url} target="_blank" rel="noreferrer">Abrir KuDE</a>}
    {state?.xml_url && <a className="ml-3 text-blue-700 underline" href={state.xml_url} target="_blank" rel="noreferrer">Abrir XML</a>}
    {state?.message && <div className="text-amber-800">{state.message}</div>}
    {state?.cancellation && <div className="border-t border-sky-200 pt-2">
      Cancelación fiscal: {labels[state.cancellation.status] || state.cancellation.status}
      {state.cancellation.message && <span> · {state.cancellation.message}</span>}
      {['review', 'sending', 'registered'].includes(state.cancellation.status) &&
        <span className="block text-amber-800">Resultado incierto: verificar en FactPy antes de cualquier nuevo envío.</span>}
      {state.environment === 'test' && state.cancellation.status === 'review' &&
        (state.cancellation.message === 'FactPy respondió HTTP 404' ||
          /^Unexpected token '<',[\s\S]*is not valid JSON$/.test(state.cancellation.message || '')) &&
        <button type="button" className="ml-3 text-blue-700 underline" disabled={busy}
          onClick={() => {
            if (window.confirm('Confirmo que el documento sigue vigente en FactPy Test y que no se registró la cancelación anterior. ¿Reintentar el mismo evento con el motivo original?')) {
              refresh('fiscal-cancel/retry', { confirm_factpy_active: true });
            }
          }}>Reintentar cancelación</button>}
      {state.cancellation.status === 'confirmed' &&
        <button type="button" className="ml-3 text-blue-700 underline" disabled={busy}
          onClick={() => refresh('fiscal-cancel/refresh')}>Completar actualización</button>}
    </div>}
    {error && <div className="text-red-700">{error}</div>}
  </section>;
}
