import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../api';

const STATUS_TABS = [
  { value: 'por_cobrar', label: 'Por cobrar' },
  { value: 'vencido', label: 'Vencidos' },
  { value: 'vence_hoy', label: 'Vence hoy' },
  { value: 'due_7d', label: 'Proximos 7 dias' },
  { value: 'parcial', label: 'Pago parcial' },
  { value: 'pagado', label: 'Pagado' },
  { value: 'todos', label: 'Todos' },
];

const STATUS_META = {
  pendiente: { label: 'Pendiente', className: 'bg-amber-50 text-amber-700' },
  parcial: { label: 'Pago parcial', className: 'bg-blue-50 text-blue-700' },
  vencido: { label: 'Vencido', className: 'bg-red-50 text-red-700' },
  vence_hoy: { label: 'Vence hoy', className: 'bg-orange-50 text-orange-700' },
  pagado: { label: 'Pagado', className: 'bg-emerald-50 text-emerald-700' },
  anulado: { label: 'Anulado', className: 'bg-slate-100 text-slate-600' },
};

const MOVEMENT_LABELS = {
  invoice: 'Factura',
  receipt: 'Recibo',
  credit_note: 'Nota de credito',
};

function fmtMoney(value = 0, currency = 'USD') {
  const curr = String(currency || 'USD').toUpperCase();
  const isPyg = curr === 'PYG' || curr === 'GS';
  return new Intl.NumberFormat('es-PY', {
    style: 'currency',
    currency: curr === 'GS' ? 'PYG' : curr,
    minimumFractionDigits: isPyg ? 0 : 2,
    maximumFractionDigits: isPyg ? 0 : 2,
  }).format(Number(value || 0));
}

function fmtDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('es-PY');
}

function currencyList(values = {}) {
  return Object.entries(values || {}).filter(([, amount]) => Math.abs(Number(amount || 0)) > 0.0001);
}

function CurrencyStack({ values, emptyCurrency = 'USD', tone = 'slate' }) {
  const entries = currencyList(values);
  const toneClass = tone === 'red' ? 'text-red-700' : tone === 'emerald' ? 'text-emerald-700' : 'text-slate-900';
  if (!entries.length) return <span className={toneClass}>{fmtMoney(0, emptyCurrency)}</span>;
  return (
    <div className={`space-y-0.5 ${toneClass}`}>
      {entries.map(([currency, amount]) => (
        <div key={currency}>{fmtMoney(amount, currency)}</div>
      ))}
    </div>
  );
}

function StatusChip({ status }) {
  const meta = STATUS_META[status] || { label: status || '-', className: 'bg-slate-100 text-slate-700' };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}>
      {meta.label}
    </span>
  );
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function downloadCsv(rows, filename) {
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function AccountStatement() {
  const [data, setData] = useState({
    totals: {},
    clients: [],
    documents: [],
    movements: [],
  });
  const [filters, setFilters] = useState({
    client_q: '',
    search: '',
    status: 'por_cobrar',
    currency_code: 'todas',
    from_date: '',
    to_date: '',
    due_from: '',
    due_to: '',
  });
  const [selectedClientKey, setSelectedClientKey] = useState('');
  const [clientDrawerOpen, setClientDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [htmlPreview, setHtmlPreview] = useState('');
  const [htmlTitle, setHtmlTitle] = useState('');
  const [collectionData, setCollectionData] = useState({ promises: [], events: [] });
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [promiseForm, setPromiseForm] = useState({
    promise_date: '',
    promised_amount: '',
    currency_code: 'USD',
    invoice_id: '',
    notes: '',
  });
  const [eventForm, setEventForm] = useState({
    event_type: 'nota',
    event_date: '',
    invoice_id: '',
    subject: '',
    notes: '',
    next_action_date: '',
  });
  const htmlRef = useRef(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const params = {
          client_q: filters.client_q || undefined,
          search: filters.search || undefined,
          status: filters.status || 'por_cobrar',
          currency_code: filters.currency_code || 'todas',
          from_date: filters.from_date || undefined,
          to_date: filters.to_date || undefined,
          due_from: filters.due_from || undefined,
          due_to: filters.due_to || undefined,
        };
        const { data: response } = await api.get('/invoices/customer-statement', { params });
        if (!alive) return;
        setData({
          totals: response?.totals || {},
          clients: Array.isArray(response?.clients) ? response.clients : [],
          documents: Array.isArray(response?.documents) ? response.documents : [],
          movements: Array.isArray(response?.movements) ? response.movements : [],
        });
      } catch (err) {
        console.error('customer statement load error', err);
        if (!alive) return;
        setError(err?.response?.data?.error || 'No se pudo cargar el estado de cuenta.');
        setData({ totals: {}, clients: [], documents: [], movements: [] });
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [filters]);

  const selectedClient = useMemo(
    () => data.clients.find((client) => client.customer_key === selectedClientKey) || null,
    [data.clients, selectedClientKey]
  );

  const selectedClientDocuments = useMemo(() => {
    if (!selectedClientKey) return [];
    return data.documents.filter((row) => row.customer_key === selectedClientKey);
  }, [data.documents, selectedClientKey]);

  const selectedClientMovements = useMemo(() => {
    if (!selectedClientKey) return [];
    return data.movements.filter((row) => row.customer_key === selectedClientKey);
  }, [data.movements, selectedClientKey]);

  const selectedClientAging = useMemo(() => {
    const buckets = {
      current: {},
      d30: {},
      d60: {},
      d90: {},
      over90: {},
    };
    for (const row of selectedClientDocuments) {
      if (Number(row.balance || 0) <= 0.0001 || row.normalized_status === 'anulado') continue;
      const days = Number(row.days_overdue || 0);
      const key = days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : 'over90';
      const currency = row.currency_code || 'USD';
      buckets[key][currency] = Number(((buckets[key][currency] || 0) + Number(row.balance || 0)).toFixed(2));
    }
    return buckets;
  }, [selectedClientDocuments]);

  const selectedClientContact = useMemo(() => {
    const doc = selectedClientDocuments.find((row) => row.organization_email || row.customer_email || row.organization_phone) || {};
    return {
      email: doc.customer_email || doc.organization_email || '',
      phone: doc.organization_phone || '',
    };
  }, [selectedClientDocuments]);

  const defaultClientCurrency = useMemo(() => {
    const fromBalance = currencyList(selectedClient?.balance_by_currency || {})[0]?.[0];
    const fromDoc = selectedClientDocuments.find((row) => row.currency_code)?.currency_code;
    return String(fromBalance || fromDoc || 'USD').toUpperCase();
  }, [selectedClient, selectedClientDocuments]);

  useEffect(() => {
    setPromiseForm((prev) => ({ ...prev, currency_code: defaultClientCurrency }));
  }, [defaultClientCurrency]);

  useEffect(() => {
    if (!selectedClientKey || !selectedClient) {
      setCollectionData({ promises: [], events: [] });
      return;
    }
    loadCollections(selectedClient);
  }, [selectedClientKey, selectedClient?.organization_id]);

  const visibleDocuments = useMemo(() => {
    if (!selectedClientKey) return data.documents;
    return data.documents.filter((row) => row.customer_key === selectedClientKey);
  }, [data.documents, selectedClientKey]);

  const visibleMovements = useMemo(() => {
    if (!selectedClientKey) return data.movements;
    return data.movements.filter((row) => row.customer_key === selectedClientKey);
  }, [data.movements, selectedClientKey]);

  const tabCounts = useMemo(() => {
    const counts = {
      por_cobrar: 0,
      vencido: 0,
      vence_hoy: 0,
      due_7d: 0,
      parcial: 0,
      pagado: 0,
      todos: data.documents.length,
    };
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const max = new Date(today);
    max.setDate(max.getDate() + 7);
    for (const row of data.documents) {
      if (Number(row.balance || 0) > 0.0001 && row.normalized_status !== 'anulado') counts.por_cobrar += 1;
      if (counts[row.normalized_status] != null) counts[row.normalized_status] += 1;
      const due = row.due_date ? new Date(row.due_date) : null;
      if (due && !Number.isNaN(due.getTime())) {
        const dueOnly = new Date(due.getFullYear(), due.getMonth(), due.getDate());
        if (Number(row.balance || 0) > 0.0001 && dueOnly >= today && dueOnly <= max) counts.due_7d += 1;
      }
    }
    return counts;
  }, [data.documents]);

  function setFilter(name, value) {
    setFilters((prev) => ({ ...prev, [name]: value }));
    setSelectedClientKey('');
    setClientDrawerOpen(false);
  }

  function clearFilters() {
    setFilters({
      client_q: '',
      search: '',
      status: 'por_cobrar',
      currency_code: 'todas',
      from_date: '',
      to_date: '',
      due_from: '',
      due_to: '',
    });
    setSelectedClientKey('');
    setClientDrawerOpen(false);
  }

  function openClientDrawer(client) {
    setSelectedClientKey(client.customer_key);
    setClientDrawerOpen(true);
  }

  function selectClient(client) {
    setSelectedClientKey(client.customer_key);
  }

  function handleClientDoubleClick(client) {
    openClientDrawer(client);
  }

  function closeClientDrawer() {
    setClientDrawerOpen(false);
  }

  async function loadCollections(client = selectedClient) {
    if (!client?.customer_key) return;
    setCollectionsLoading(true);
    try {
      const { data: response } = await api.get('/customer-collections', {
        params: {
          customer_key: client.customer_key,
          organization_id: client.organization_id || undefined,
        },
      });
      setCollectionData({
        promises: Array.isArray(response?.promises) ? response.promises : [],
        events: Array.isArray(response?.events) ? response.events : [],
      });
    } catch (err) {
      console.error('customer collections load error', err);
      setCollectionData({ promises: [], events: [] });
    } finally {
      setCollectionsLoading(false);
    }
  }

  async function savePromise() {
    if (!selectedClient) return;
    const amount = Number(promiseForm.promised_amount || 0);
    if (!promiseForm.promise_date) return alert('Carga la fecha prometida.');
    if (!amount || amount <= 0) return alert('Carga un monto prometido valido.');
    try {
      await api.post('/customer-collections/promises', {
        organization_id: selectedClient.organization_id || null,
        customer_key: selectedClient.customer_key,
        invoice_id: promiseForm.invoice_id || null,
        promise_date: promiseForm.promise_date,
        promised_amount: amount,
        currency_code: promiseForm.currency_code || defaultClientCurrency,
        notes: promiseForm.notes || null,
      });
      setPromiseForm({
        promise_date: '',
        promised_amount: '',
        currency_code: defaultClientCurrency,
        invoice_id: '',
        notes: '',
      });
      await loadCollections(selectedClient);
    } catch (err) {
      console.error('customer promise save error', err);
      alert(err?.response?.data?.error || 'No se pudo registrar la promesa.');
    }
  }

  async function updatePromiseStatus(promise, status) {
    try {
      await api.patch(`/customer-collections/promises/${promise.id}`, { status });
      await loadCollections(selectedClient);
    } catch (err) {
      console.error('customer promise update error', err);
      alert(err?.response?.data?.error || 'No se pudo actualizar la promesa.');
    }
  }

  async function saveCollectionEvent() {
    if (!selectedClient) return;
    if (!eventForm.subject.trim() && !eventForm.notes.trim()) return alert('Carga asunto o detalle.');
    try {
      await api.post('/customer-collections/events', {
        organization_id: selectedClient.organization_id || null,
        customer_key: selectedClient.customer_key,
        invoice_id: eventForm.invoice_id || null,
        event_type: eventForm.event_type || 'nota',
        event_date: eventForm.event_date ? eventForm.event_date.replace('T', ' ') : null,
        subject: eventForm.subject || null,
        notes: eventForm.notes || null,
        next_action_date: eventForm.next_action_date || null,
      });
      setEventForm({
        event_type: 'nota',
        event_date: '',
        invoice_id: '',
        subject: '',
        notes: '',
        next_action_date: '',
      });
      await loadCollections(selectedClient);
    } catch (err) {
      console.error('customer event save error', err);
      alert(err?.response?.data?.error || 'No se pudo registrar el seguimiento.');
    }
  }

  function exportDocumentsCsv(rows, filename) {
    const lines = [
      ['Cliente', 'RUC', 'Factura', 'Operacion', 'Emision', 'Vencimiento', 'Moneda', 'Total', 'NC', 'Cobrado', 'Saldo', 'Estado', 'Dias mora']
        .map(csvEscape)
        .join(';'),
      ...rows.map((row) =>
        [
          row.customer_name,
          row.customer_ruc,
          row.invoice_number,
          row.operation_reference,
          fmtDate(row.issue_date),
          fmtDate(row.due_date),
          row.currency_code,
          row.total_amount,
          row.credited_total,
          row.paid_amount,
          row.balance,
          row.status_label,
          row.days_overdue || 0,
        ].map(csvEscape).join(';')
      ),
    ];
    downloadCsv(lines, filename);
  }

  function buildHtmlTable(rows, title) {
    const body = rows.map((row) => `
      <tr>
        <td>${row.invoice_number || ''}</td>
        <td>${fmtDate(row.issue_date)}</td>
        <td>${fmtDate(row.due_date)}</td>
        <td>${row.operation_reference || ''}</td>
        <td>${row.currency_code || ''}</td>
        <td align="right">${fmtMoney(row.total_amount, row.currency_code)}</td>
        <td align="right">${fmtMoney(row.paid_amount, row.currency_code)}</td>
        <td align="right">${fmtMoney(row.credited_total, row.currency_code)}</td>
        <td align="right">${fmtMoney(row.balance, row.currency_code)}</td>
        <td>${row.status_label || ''}</td>
      </tr>
    `).join('');
    return `
      <div style="font-family:Arial,sans-serif;font-size:14px;font-weight:bold;margin-bottom:8px;">${title}</div>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:12px;">
        <thead style="background:#f1f5f9;">
          <tr>
            <th align="left">Factura</th>
            <th align="left">Emision</th>
            <th align="left">Vencimiento</th>
            <th align="left">Operacion</th>
            <th align="left">Moneda</th>
            <th align="right">Total</th>
            <th align="right">Cobrado</th>
            <th align="right">NC</th>
            <th align="right">Saldo</th>
            <th align="left">Estado</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    `;
  }

  function openHtmlPreview(rows, title) {
    setHtmlTitle(title);
    setHtmlPreview(buildHtmlTable(rows, title));
  }

  async function exportPdf() {
    try {
      const params = {
        client_q: selectedClient?.organization_id ? undefined : (selectedClient?.customer_name || filters.client_q || undefined),
        organization_id: selectedClient?.organization_id || undefined,
        search: filters.search || undefined,
        status: filters.status || 'por_cobrar',
        currency_code: filters.currency_code || 'todas',
        from_date: filters.from_date || undefined,
        to_date: filters.to_date || undefined,
        due_from: filters.due_from || undefined,
        due_to: filters.due_to || undefined,
      };
      const response = await api.get('/invoices/customer-statement/pdf', {
        params,
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      console.error('customer statement pdf error', err);
      alert(err?.response?.data?.error || 'No se pudo generar el PDF.');
    }
  }

  async function copyHtml() {
    if (!htmlPreview) return;
    try {
      const plain = htmlRef.current?.innerText || '';
      if (window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([htmlPreview], { type: 'text/html' }),
            'text/plain': new Blob([plain], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plain || htmlPreview);
      }
      alert('Tabla copiada.');
    } catch {
      alert('No se pudo copiar. Selecciona y copia manualmente.');
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Estado de cuenta de clientes</h1>
          <p className="text-sm text-slate-500">
            Libro de facturas, recibos, notas de credito y saldos por cliente.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border px-3 py-2 text-sm hover:bg-slate-50"
            disabled={!visibleDocuments.length}
            onClick={exportPdf}
          >
            Exportar PDF
          </button>
          <button
            type="button"
            className="rounded border px-3 py-2 text-sm hover:bg-slate-50"
            disabled={!visibleDocuments.length}
            onClick={() => exportDocumentsCsv(visibleDocuments, selectedClient ? `estado-cuenta-${selectedClient.customer_name}.csv` : 'estado-cuenta-clientes.csv')}
          >
            Exportar CSV
          </button>
          <button
            type="button"
            className="rounded border px-3 py-2 text-sm hover:bg-slate-50"
            disabled={!visibleDocuments.length}
            onClick={() => openHtmlPreview(visibleDocuments, selectedClient ? `Estado de cuenta - ${selectedClient.customer_name}` : 'Estado de cuenta clientes')}
          >
            Tabla para correo
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border bg-white p-3">
          <div className="text-xs text-slate-500">Saldo por cobrar</div>
          <div className="mt-2 text-lg font-semibold">
            <CurrencyStack values={data.totals.balance_by_currency} />
          </div>
        </div>
        <div className="rounded-lg border bg-white p-3">
          <div className="text-xs text-slate-500">Vencido</div>
          <div className="mt-2 text-lg font-semibold">
            <CurrencyStack values={data.totals.overdue_by_currency} tone="red" />
          </div>
        </div>
        <div className="rounded-lg border bg-white p-3">
          <div className="text-xs text-slate-500">Cobrado</div>
          <div className="mt-2 text-lg font-semibold">
            <CurrencyStack values={data.totals.paid_by_currency} tone="emerald" />
          </div>
        </div>
        <div className="rounded-lg border bg-white p-3">
          <div className="text-xs text-slate-500">Documentos abiertos</div>
          <div className="mt-2 text-lg font-semibold">{data.totals.open_documents || 0}</div>
          <div className="text-xs text-slate-500">
            {data.totals.overdue_documents || 0} vencidos · {data.totals.partial_documents || 0} parciales
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-3">
        <div className="mb-3 flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              className={`rounded-full border px-3 py-1.5 text-sm ${
                filters.status === tab.value ? 'bg-black text-white' : 'hover:bg-slate-50'
              }`}
              onClick={() => setFilter('status', tab.value)}
            >
              {tab.label}
              <span className="ml-1 text-xs opacity-70">{tabCounts[tab.value] || 0}</span>
            </button>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-6">
          <div>
            <label className="text-xs text-slate-500">Cliente</label>
            <input
              className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
              placeholder="Nombre / RUC"
              value={filters.client_q}
              onChange={(event) => setFilter('client_q', event.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Buscar</label>
            <input
              className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
              placeholder="Factura, operacion..."
              value={filters.search}
              onChange={(event) => setFilter('search', event.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Moneda</label>
            <select
              className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
              value={filters.currency_code}
              onChange={(event) => setFilter('currency_code', event.target.value)}
            >
              <option value="todas">Todas</option>
              <option value="PYG">PYG</option>
              <option value="USD">USD</option>
              <option value="BRL">BRL</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Emitida desde</label>
            <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" type="date" value={filters.from_date} onChange={(event) => setFilter('from_date', event.target.value)} />
          </div>
          <div>
            <label className="text-xs text-slate-500">Emitida hasta</label>
            <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" type="date" value={filters.to_date} onChange={(event) => setFilter('to_date', event.target.value)} />
          </div>
          <div className="flex items-end">
            <button type="button" className="w-full rounded border px-3 py-2 text-sm hover:bg-slate-50" onClick={clearFilters}>
              Limpiar filtros
            </button>
          </div>
        </div>
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="rounded-lg border bg-white">
          <div className="border-b px-3 py-2">
            <div className="text-sm font-semibold">Saldos por cliente</div>
            <div className="text-xs text-slate-500">{data.clients.length} clientes</div>
          </div>
          <div className="max-h-[560px] overflow-auto divide-y">
            {loading ? (
              <div className="p-3 text-sm text-slate-500">Cargando...</div>
            ) : data.clients.length === 0 ? (
              <div className="p-3 text-sm text-slate-500">Sin clientes para los filtros actuales.</div>
            ) : (
              data.clients.map((client) => (
                <button
                  key={client.customer_key}
                  type="button"
                  className={`w-full px-3 py-2 text-left hover:bg-slate-50 ${
                    selectedClientKey === client.customer_key ? 'bg-slate-100' : ''
                  }`}
                  onClick={() => selectClient(client)}
                  onDoubleClick={() => handleClientDoubleClick(client)}
                  title="Doble click para abrir detalle"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{client.customer_name || 'Sin cliente'}</div>
                      <div className="text-xs text-slate-500">{client.customer_ruc || '-'}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {client.open_documents || 0} abiertos · {client.overdue_documents || 0} vencidos
                      </div>
                    </div>
                    <div className="text-right text-sm font-semibold">
                      <CurrencyStack values={client.balance_by_currency} />
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="space-y-4 min-w-0">
          {selectedClient && (
            <div className="rounded-lg border bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{selectedClient.customer_name}</div>
                  <div className="text-xs text-slate-500">RUC: {selectedClient.customer_ruc || '-'}</div>
                </div>
                <div className="grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <div className="text-xs text-slate-500">Saldo</div>
                    <div className="font-semibold"><CurrencyStack values={selectedClient.balance_by_currency} /></div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Vencido</div>
                    <div className="font-semibold"><CurrencyStack values={selectedClient.overdue_by_currency} tone="red" /></div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Ultimo pago</div>
                    <div className="font-semibold">{fmtDate(selectedClient.last_payment_date)}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-lg border bg-white">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <div>
                <div className="text-sm font-semibold">Documentos</div>
                <div className="text-xs text-slate-500">{visibleDocuments.length} facturas</div>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left">Factura</th>
                    <th className="px-3 py-2 text-left">Cliente</th>
                    <th className="px-3 py-2 text-left">Operacion</th>
                    <th className="px-3 py-2 text-left">Emision</th>
                    <th className="px-3 py-2 text-left">Vence</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Cobrado</th>
                    <th className="px-3 py-2 text-right">NC</th>
                    <th className="px-3 py-2 text-right">Saldo</th>
                    <th className="px-3 py-2 text-left">Estado</th>
                    <th className="px-3 py-2 text-left">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={11} className="px-3 py-4 text-center text-slate-500">Cargando...</td></tr>
                  ) : visibleDocuments.length === 0 ? (
                    <tr><td colSpan={11} className="px-3 py-4 text-center text-slate-500">Sin documentos.</td></tr>
                  ) : (
                    visibleDocuments.map((row) => (
                      <tr key={row.id} className="border-t">
                        <td className="px-3 py-2">
                          <a className="font-medium text-blue-600 hover:underline" href={`/invoices/${row.id}`} target="_blank" rel="noreferrer">
                            {row.invoice_number || row.id}
                          </a>
                        </td>
                        <td className="px-3 py-2">
                          <div>{row.customer_name || '-'}</div>
                          <div className="text-xs text-slate-500">{row.customer_ruc || '-'}</div>
                        </td>
                        <td className="px-3 py-2">
                          {row.deal_id ? (
                            <a className="text-blue-600 hover:underline" href={`/operations/${row.deal_id}`} target="_blank" rel="noreferrer">
                              {row.operation_reference || row.deal_id}
                            </a>
                          ) : row.operation_reference || '-'}
                        </td>
                        <td className="px-3 py-2">{fmtDate(row.issue_date || row.created_at)}</td>
                        <td className="px-3 py-2">
                          <div>{fmtDate(row.due_date)}</div>
                          {row.days_overdue > 0 && <div className="text-xs text-red-600">{row.days_overdue} dias mora</div>}
                        </td>
                        <td className="px-3 py-2 text-right">{fmtMoney(row.total_amount, row.currency_code)}</td>
                        <td className="px-3 py-2 text-right text-emerald-700">{fmtMoney(row.paid_amount, row.currency_code)}</td>
                        <td className="px-3 py-2 text-right text-amber-700">{fmtMoney(row.credited_total, row.currency_code)}</td>
                        <td className="px-3 py-2 text-right font-semibold">{fmtMoney(row.balance, row.currency_code)}</td>
                        <td className="px-3 py-2"><StatusChip status={row.normalized_status} /></td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2 whitespace-nowrap text-xs">
                            <a className="text-blue-600 hover:underline" href={`/invoices/${row.id}`} target="_blank" rel="noreferrer">Ver</a>
                            {row.balance > 0.0001 && (
                              <a className="text-emerald-700 hover:underline" href={`/invoices/${row.id}`} target="_blank" rel="noreferrer">Cobrar</a>
                            )}
                            {row.normalized_status !== 'anulado' && (
                              <a className="text-orange-700 hover:underline" href={`/invoices/${row.id}#credit-note`} target="_blank" rel="noreferrer">NC</a>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border bg-white">
            <div className="border-b px-3 py-2">
              <div className="text-sm font-semibold">Libro de movimientos</div>
              <div className="text-xs text-slate-500">Debe, haber y saldo corrido por cliente/moneda</div>
            </div>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left">Fecha</th>
                    <th className="px-3 py-2 text-left">Tipo</th>
                    <th className="px-3 py-2 text-left">Documento</th>
                    <th className="px-3 py-2 text-left">Cliente</th>
                    <th className="px-3 py-2 text-left">Ref.</th>
                    <th className="px-3 py-2 text-right">Debe</th>
                    <th className="px-3 py-2 text-right">Haber</th>
                    <th className="px-3 py-2 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMovements.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-4 text-center text-slate-500">Sin movimientos.</td></tr>
                  ) : (
                    visibleMovements.map((row) => (
                      <tr key={row.id} className="border-t">
                        <td className="px-3 py-2">{fmtDate(row.date)}</td>
                        <td className="px-3 py-2">{MOVEMENT_LABELS[row.source_type] || row.source_type}</td>
                        <td className="px-3 py-2">{row.document_number || '-'}</td>
                        <td className="px-3 py-2">{row.customer_name || '-'}</td>
                        <td className="px-3 py-2">{row.reference || '-'}</td>
                        <td className="px-3 py-2 text-right">{Number(row.debit || 0) ? fmtMoney(row.debit, row.currency_code) : '-'}</td>
                        <td className="px-3 py-2 text-right">{Number(row.credit || 0) ? fmtMoney(row.credit, row.currency_code) : '-'}</td>
                        <td className="px-3 py-2 text-right font-semibold">{fmtMoney(row.balance, row.currency_code)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {clientDrawerOpen && selectedClient && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
          <div className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
            <div className="sticky top-0 z-10 border-b bg-white px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold">{selectedClient.customer_name}</div>
                  <div className="text-xs text-slate-500">RUC: {selectedClient.customer_ruc || '-'}</div>
                </div>
                <button type="button" className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50" onClick={closeClientDrawer}>
                  Cerrar
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="rounded bg-black px-3 py-1.5 text-sm text-white" onClick={exportPdf}>
                  PDF
                </button>
                <button
                  type="button"
                  className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50"
                  onClick={() => exportDocumentsCsv(selectedClientDocuments, `estado-cuenta-${selectedClient.customer_name}.csv`)}
                >
                  CSV
                </button>
                <button
                  type="button"
                  className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50"
                  onClick={() => openHtmlPreview(selectedClientDocuments, `Estado de cuenta - ${selectedClient.customer_name}`)}
                >
                  Tabla correo
                </button>
              </div>
            </div>

            <div className="space-y-4 p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-slate-500">Saldo</div>
                  <div className="mt-1 text-sm font-semibold"><CurrencyStack values={selectedClient.balance_by_currency} /></div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-slate-500">Vencido</div>
                  <div className="mt-1 text-sm font-semibold"><CurrencyStack values={selectedClient.overdue_by_currency} tone="red" /></div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-slate-500">Ultimo pago</div>
                  <div className="mt-1 text-sm font-semibold">{fmtDate(selectedClient.last_payment_date)}</div>
                </div>
              </div>

              <div className="rounded-lg border p-3">
                <div className="mb-2 text-sm font-semibold">Datos de contacto</div>
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <div className="text-xs text-slate-500">Email</div>
                    <div>{selectedClientContact.email || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Telefono</div>
                    <div>{selectedClientContact.phone || '-'}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Promesas de pago</div>
                    <div className="text-xs text-slate-500">Fechas y montos comprometidos por el cliente</div>
                  </div>
                  {collectionsLoading && <div className="text-xs text-slate-500">Cargando...</div>}
                </div>

                <div className="grid gap-2 md:grid-cols-5">
                  <input
                    type="date"
                    className="rounded border px-2 py-1.5 text-sm"
                    value={promiseForm.promise_date}
                    onChange={(event) => setPromiseForm((prev) => ({ ...prev, promise_date: event.target.value }))}
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="rounded border px-2 py-1.5 text-sm"
                    placeholder="Monto"
                    value={promiseForm.promised_amount}
                    onChange={(event) => setPromiseForm((prev) => ({ ...prev, promised_amount: event.target.value }))}
                  />
                  <select
                    className="rounded border px-2 py-1.5 text-sm"
                    value={promiseForm.currency_code}
                    onChange={(event) => setPromiseForm((prev) => ({ ...prev, currency_code: event.target.value }))}
                  >
                    <option value="USD">USD</option>
                    <option value="PYG">PYG</option>
                    <option value="BRL">BRL</option>
                  </select>
                  <select
                    className="rounded border px-2 py-1.5 text-sm"
                    value={promiseForm.invoice_id}
                    onChange={(event) => setPromiseForm((prev) => ({ ...prev, invoice_id: event.target.value }))}
                  >
                    <option value="">Cliente general</option>
                    {selectedClientDocuments.filter((row) => Number(row.balance || 0) > 0.0001).map((row) => (
                      <option key={row.id} value={row.id}>{row.invoice_number || row.id}</option>
                    ))}
                  </select>
                  <button type="button" className="rounded bg-black px-3 py-1.5 text-sm text-white" onClick={savePromise}>
                    Agregar
                  </button>
                  <textarea
                    className="md:col-span-5 min-h-[64px] rounded border px-2 py-1.5 text-sm"
                    placeholder="Observacion de la promesa"
                    value={promiseForm.notes}
                    onChange={(event) => setPromiseForm((prev) => ({ ...prev, notes: event.target.value }))}
                  />
                </div>

                <div className="mt-3 overflow-auto rounded border">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-600">
                      <tr>
                        <th className="px-3 py-2 text-left">Fecha</th>
                        <th className="px-3 py-2 text-left">Factura</th>
                        <th className="px-3 py-2 text-right">Monto</th>
                        <th className="px-3 py-2 text-left">Estado</th>
                        <th className="px-3 py-2 text-left">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {collectionData.promises.length === 0 ? (
                        <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-500">Sin promesas registradas.</td></tr>
                      ) : collectionData.promises.map((promise) => (
                        <tr key={promise.id} className="border-t">
                          <td className="px-3 py-2">
                            <div>{fmtDate(promise.promise_date)}</div>
                            {promise.created_by_name && <div className="text-xs text-slate-500">{promise.created_by_name}</div>}
                          </td>
                          <td className="px-3 py-2">{promise.invoice_number || 'General'}</td>
                          <td className="px-3 py-2 text-right font-semibold">{fmtMoney(promise.promised_amount, promise.currency_code)}</td>
                          <td className="px-3 py-2 capitalize">{promise.status || '-'}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-2 text-xs">
                              {promise.status === 'pendiente' && (
                                <>
                                  <button type="button" className="text-emerald-700 hover:underline" onClick={() => updatePromiseStatus(promise, 'cumplida')}>Cumplida</button>
                                  <button type="button" className="text-red-700 hover:underline" onClick={() => updatePromiseStatus(promise, 'incumplida')}>Incumplida</button>
                                  <button type="button" className="text-slate-600 hover:underline" onClick={() => updatePromiseStatus(promise, 'cancelada')}>Cancelar</button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-lg border p-3">
                <div className="mb-3">
                  <div className="text-sm font-semibold">Seguimiento de cobranza</div>
                  <div className="text-xs text-slate-500">Registro de llamadas, mensajes, correos y notas</div>
                </div>
                <div className="grid gap-2 md:grid-cols-4">
                  <select
                    className="rounded border px-2 py-1.5 text-sm"
                    value={eventForm.event_type}
                    onChange={(event) => setEventForm((prev) => ({ ...prev, event_type: event.target.value }))}
                  >
                    <option value="nota">Nota</option>
                    <option value="llamada">Llamada</option>
                    <option value="email">Email</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="reclamo">Reclamo</option>
                    <option value="otro">Otro</option>
                  </select>
                  <input
                    type="datetime-local"
                    className="rounded border px-2 py-1.5 text-sm"
                    value={eventForm.event_date}
                    onChange={(event) => setEventForm((prev) => ({ ...prev, event_date: event.target.value }))}
                  />
                  <select
                    className="rounded border px-2 py-1.5 text-sm"
                    value={eventForm.invoice_id}
                    onChange={(event) => setEventForm((prev) => ({ ...prev, invoice_id: event.target.value }))}
                  >
                    <option value="">Cliente general</option>
                    {selectedClientDocuments.map((row) => (
                      <option key={row.id} value={row.id}>{row.invoice_number || row.id}</option>
                    ))}
                  </select>
                  <input
                    type="date"
                    className="rounded border px-2 py-1.5 text-sm"
                    value={eventForm.next_action_date}
                    onChange={(event) => setEventForm((prev) => ({ ...prev, next_action_date: event.target.value }))}
                    title="Proxima accion"
                  />
                  <input
                    className="md:col-span-4 rounded border px-2 py-1.5 text-sm"
                    placeholder="Asunto"
                    value={eventForm.subject}
                    onChange={(event) => setEventForm((prev) => ({ ...prev, subject: event.target.value }))}
                  />
                  <textarea
                    className="md:col-span-4 min-h-[76px] rounded border px-2 py-1.5 text-sm"
                    placeholder="Detalle de la gestion"
                    value={eventForm.notes}
                    onChange={(event) => setEventForm((prev) => ({ ...prev, notes: event.target.value }))}
                  />
                  <div className="md:col-span-4 flex justify-end">
                    <button type="button" className="rounded bg-black px-3 py-1.5 text-sm text-white" onClick={saveCollectionEvent}>
                      Registrar seguimiento
                    </button>
                  </div>
                </div>

                <div className="mt-3 max-h-72 overflow-auto rounded border">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-600">
                      <tr>
                        <th className="px-3 py-2 text-left">Fecha</th>
                        <th className="px-3 py-2 text-left">Tipo</th>
                        <th className="px-3 py-2 text-left">Asunto</th>
                        <th className="px-3 py-2 text-left">Factura</th>
                        <th className="px-3 py-2 text-left">Proxima</th>
                      </tr>
                    </thead>
                    <tbody>
                      {collectionData.events.length === 0 ? (
                        <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-500">Sin seguimientos registrados.</td></tr>
                      ) : collectionData.events.map((event) => (
                        <tr key={event.id} className="border-t align-top">
                          <td className="px-3 py-2">
                            <div>{fmtDate(event.event_date)}</div>
                            {event.created_by_name && <div className="text-xs text-slate-500">{event.created_by_name}</div>}
                          </td>
                          <td className="px-3 py-2 capitalize">{event.event_type}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium">{event.subject || '-'}</div>
                            {event.notes && <div className="mt-1 text-xs text-slate-500">{event.notes}</div>}
                          </td>
                          <td className="px-3 py-2">{event.invoice_number || 'General'}</td>
                          <td className="px-3 py-2">{fmtDate(event.next_action_date)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-lg border p-3">
                <div className="mb-2 text-sm font-semibold">Aging de cobranza</div>
                <div className="grid gap-2 sm:grid-cols-5">
                  {[
                    ['current', 'Al dia'],
                    ['d30', '1-30'],
                    ['d60', '31-60'],
                    ['d90', '61-90'],
                    ['over90', '+90'],
                  ].map(([key, label]) => (
                    <div key={key} className="rounded border bg-slate-50 p-2">
                      <div className="text-xs text-slate-500">{label}</div>
                      <div className="mt-1 text-xs font-semibold">
                        <CurrencyStack values={selectedClientAging[key]} tone={key === 'over90' ? 'red' : 'slate'} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border">
                <div className="border-b px-3 py-2">
                  <div className="text-sm font-semibold">Facturas abiertas</div>
                  <div className="text-xs text-slate-500">{selectedClientDocuments.filter((row) => Number(row.balance || 0) > 0.0001).length} documentos con saldo</div>
                </div>
                <div className="max-h-72 overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-600">
                      <tr>
                        <th className="px-3 py-2 text-left">Factura</th>
                        <th className="px-3 py-2 text-left">Vence</th>
                        <th className="px-3 py-2 text-right">Saldo</th>
                        <th className="px-3 py-2 text-left">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedClientDocuments.filter((row) => Number(row.balance || 0) > 0.0001).slice(0, 20).map((row) => (
                        <tr key={row.id} className="border-t">
                          <td className="px-3 py-2">
                            <a className="text-blue-600 hover:underline" href={`/invoices/${row.id}`} target="_blank" rel="noreferrer">
                              {row.invoice_number || row.id}
                            </a>
                          </td>
                          <td className="px-3 py-2">
                            <div>{fmtDate(row.due_date)}</div>
                            {row.days_overdue > 0 && <div className="text-xs text-red-600">{row.days_overdue} dias mora</div>}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold">{fmtMoney(row.balance, row.currency_code)}</td>
                          <td className="px-3 py-2"><StatusChip status={row.normalized_status} /></td>
                        </tr>
                      ))}
                      {selectedClientDocuments.filter((row) => Number(row.balance || 0) > 0.0001).length === 0 && (
                        <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-500">Sin facturas abiertas.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-lg border">
                <div className="border-b px-3 py-2">
                  <div className="text-sm font-semibold">Ultimos movimientos</div>
                  <div className="text-xs text-slate-500">Facturas, recibos y notas de credito</div>
                </div>
                <div className="max-h-72 overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-600">
                      <tr>
                        <th className="px-3 py-2 text-left">Fecha</th>
                        <th className="px-3 py-2 text-left">Tipo</th>
                        <th className="px-3 py-2 text-left">Doc.</th>
                        <th className="px-3 py-2 text-right">Debe</th>
                        <th className="px-3 py-2 text-right">Haber</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedClientMovements.slice(-20).reverse().map((row) => (
                        <tr key={row.id} className="border-t">
                          <td className="px-3 py-2">{fmtDate(row.date)}</td>
                          <td className="px-3 py-2">{MOVEMENT_LABELS[row.source_type] || row.source_type}</td>
                          <td className="px-3 py-2">{row.document_number || '-'}</td>
                          <td className="px-3 py-2 text-right">{Number(row.debit || 0) ? fmtMoney(row.debit, row.currency_code) : '-'}</td>
                          <td className="px-3 py-2 text-right">{Number(row.credit || 0) ? fmtMoney(row.credit, row.currency_code) : '-'}</td>
                        </tr>
                      ))}
                      {selectedClientMovements.length === 0 && (
                        <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-500">Sin movimientos.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {htmlPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-5xl rounded-xl bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{htmlTitle}</div>
                <div className="text-xs text-slate-500">Vista previa para copiar al correo.</div>
              </div>
              <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={() => setHtmlPreview('')}>Cerrar</button>
            </div>
            <div ref={htmlRef} className="max-h-[60vh] overflow-auto rounded border p-3" dangerouslySetInnerHTML={{ __html: htmlPreview }} />
            <div className="mt-3 flex justify-end">
              <button type="button" className="rounded bg-black px-4 py-2 text-sm text-white" onClick={copyHtml}>Copiar tabla</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

