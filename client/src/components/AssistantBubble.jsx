import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import { ASSISTANT_ATTACH_EVENT } from "../utils/assistantContext";

const STORAGE_KEY = "assistant_phase2_history";
const CONTEXT_STORAGE_KEY = "assistant_phase2_context";
const CHIP_POSITION_KEY = "assistant_phase2_chip_position";

const SUGGESTIONS = [
  "Cuantas operaciones abiertas hay?",
  "Que operaciones abiertas no tienen cotizacion?",
  "Dame un resumen del cliente BIT FARMS",
  "Creame una tarea para la operacion 508 que diga llamar de vuelta",
];

function loadStored(key) {
  try {
    const raw = window.sessionStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStored(key, value, limit = 20) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value.slice(-limit)));
  } catch {
    // noop
  }
}

function loadChipPosition() {
  try {
    const raw = window.localStorage.getItem(CHIP_POSITION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (
      parsed &&
      Number.isFinite(Number(parsed.top)) &&
      Number.isFinite(Number(parsed.right))
    ) {
      return {
        top: Number(parsed.top),
        right: Number(parsed.right),
      };
    }
  } catch {
    // noop
  }
  return { top: 112, right: 0 };
}

function saveChipPosition(position) {
  try {
    window.localStorage.setItem(CHIP_POSITION_KEY, JSON.stringify(position));
  } catch {
    // noop
  }
}

function normalizeContextItem(item) {
  if (!item || typeof item !== "object") return null;
  const type = String(item.type || "").trim();
  const id = item.id == null ? null : Number(item.id);
  const label = String(item.label || "").trim();
  if (!type || !label) return null;
  return {
    type,
    id: Number.isFinite(id) ? id : item.id,
    label,
    meta: item.meta && typeof item.meta === "object" ? item.meta : {},
  };
}

function contextKey(item) {
  return `${item.type}:${item.id ?? item.label}`;
}

function contextDescriptor(item) {
  if (!item) return "";
  const typeLabel = {
    operation: "Operacion",
    organization: "Cliente",
    contact: "Contacto",
    service_case: "Servicio",
  }[item.type] || "Contexto";
  return `${typeLabel}: ${item.label}`;
}

function modeLabel(mode) {
  return {
    conversation: "Conversacion",
    system_query: "Consulta",
    assisted_action: "Accion",
  }[mode] || "";
}

function parseStructuredAssistantContent(content) {
  const text = String(content || "").trim();
  if (!text) return null;

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return null;

  const keyValueLines = lines.filter((line) => /^[^:]{2,60}:\s+.+$/.test(line));
  if (keyValueLines.length >= 2) {
    const firstLineIsKeyValue = /^[^:]{2,60}:\s+.+$/.test(lines[0]);
    const title = firstLineIsKeyValue ? null : lines[0];
    const detailLines = firstLineIsKeyValue ? lines : lines.slice(1);
    const fields = detailLines
      .filter((line) => /^[^:]{2,60}:\s+.+$/.test(line))
      .map((line) => {
        const idx = line.indexOf(":");
        return {
          label: line.slice(0, idx).trim(),
          value: line.slice(idx + 1).trim(),
        };
      });
    const leftover = detailLines.filter((line) => !/^[^:]{2,60}:\s+.+$/.test(line));
    return {
      kind: "summary",
      title,
      fields,
      text: leftover.join("\n"),
    };
  }

  if (lines.length >= 2 && lines.every((line) => /^[-*•]\s+/.test(line))) {
    return {
      kind: "list",
      items: lines.map((line) => line.replace(/^[-*•]\s+/, "").trim()),
    };
  }

  return null;
}

function AssistantResponseBody({ message }) {
  if (message.response_card && Array.isArray(message.response_card.fields)) {
    const showTextFallback = !String(message.response_kind || "").endsWith("_summary");
    return (
      <div className="space-y-3">
        {message.response_card.title && (
          <div className="text-sm font-semibold text-slate-900">{message.response_card.title}</div>
        )}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="grid divide-y">
            {message.response_card.fields.map((field) => (
              <div
                key={`${field.label}-${field.value}`}
                className="grid grid-cols-[120px_1fr] gap-3 px-3 py-2 text-sm"
              >
                <div className="font-medium text-slate-500">{field.label}</div>
                <div className="text-slate-800">{field.value}</div>
              </div>
            ))}
          </div>
        </div>
        {showTextFallback && message.content && (
          <div className="text-sm whitespace-pre-wrap text-slate-700">{message.content}</div>
        )}
      </div>
    );
  }

  const parsed = parseStructuredAssistantContent(message.content);

  if (!parsed) {
    return <div>{message.content}</div>;
  }

  if (parsed.kind === "list") {
    return (
      <div className="space-y-2">
        {parsed.items.map((item) => (
          <div key={item} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700">
            {item}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {parsed.title && <div className="text-sm font-semibold text-slate-900">{parsed.title}</div>}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="grid divide-y">
          {parsed.fields.map((field) => (
            <div
              key={`${field.label}-${field.value}`}
              className="grid grid-cols-[120px_1fr] gap-3 px-3 py-2 text-sm"
            >
              <div className="font-medium text-slate-500">{field.label}</div>
              <div className="text-slate-800">{field.value}</div>
            </div>
          ))}
        </div>
      </div>
      {parsed.text && <div className="text-sm text-slate-700 whitespace-pre-wrap">{parsed.text}</div>}
    </div>
  );
}

export default function AssistantBubble() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(false);
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState(() => loadStored(STORAGE_KEY));
  const [contextItems, setContextItems] = useState(() => loadStored(CONTEXT_STORAGE_KEY));
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [chipPosition, setChipPosition] = useState(() => loadChipPosition());
  const listRef = useRef(null);
  const chipDragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startTop: 0,
    startRight: 0,
    moved: false,
  });

  useEffect(() => {
    saveStored(STORAGE_KEY, messages, 24);
  }, [messages]);

  useEffect(() => {
    saveStored(CONTEXT_STORAGE_KEY, contextItems, 12);
  }, [contextItems]);

  useEffect(() => {
    saveChipPosition(chipPosition);
  }, [chipPosition]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open, loading]);

  useEffect(() => {
    let live = true;
    setBooting(true);
    setError("");

    api
      .get("/assistant/status")
      .then(({ data }) => {
        if (!live) return;
        setStatus(data || null);
      })
      .catch((err) => {
        if (!live) return;
        setError(err?.response?.data?.message || "No se pudo cargar el asistente.");
      })
      .finally(() => {
        if (!live) return;
        setBooting(false);
      });

    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    function onAttach(event) {
      const nextItem = normalizeContextItem(event.detail);
      if (!nextItem) return;
      setOpen(true);
      setContextItems((prev) => {
        const filtered = prev.filter((item) => contextKey(item) !== contextKey(nextItem));
        return [nextItem, ...filtered].slice(0, 8);
      });
    }

    window.addEventListener(ASSISTANT_ATTACH_EVENT, onAttach);
    return () => window.removeEventListener(ASSISTANT_ATTACH_EVENT, onAttach);
  }, []);

  const canSend = useMemo(() => {
    return Boolean(draft.trim() && !loading && status?.configured !== false);
  }, [draft, loading, status]);

  async function sendMessage(text) {
    const content = String(text || "").trim();
    if (!content || loading) return;

    const visibleUserMessage = {
      role: "user",
      content,
      context_items: contextItems,
    };
    const nextHistory = [...messages, visibleUserMessage];

    setMessages(nextHistory);
    setDraft("");
    setLoading(true);
    setError("");

    try {
      const payloadHistory = nextHistory
        .slice(-12)
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role,
          content: m.content,
          context_items: m.role === "user" ? m.context_items || [] : [],
        }));

      const { data } = await api.post("/assistant/respond", {
        message: content,
        context_items: contextItems,
        history: payloadHistory.slice(0, -1),
      });

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data?.answer || "No pude responder esa consulta.",
          mode: data?.mode || null,
          response_kind: data?.response_kind || null,
          response_card: data?.response_card || null,
          tools_used: Array.isArray(data?.tools_used) ? data.tools_used : [],
          links: Array.isArray(data?.links) ? data.links : [],
          pending_action: data?.pending_action || null,
        },
      ]);
    } catch (err) {
      const baseMsg = err?.response?.data?.message || "No se pudo procesar la consulta.";
      const detail = err?.response?.data?.detail;
      setError(detail ? `${baseMsg} Detalle: ${detail}` : baseMsg);
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }

  function clearConversation() {
    setMessages([]);
    setContextItems([]);
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
      window.sessionStorage.removeItem(CONTEXT_STORAGE_KEY);
    } catch {
      // noop
    }
  }

  function openAssistantLink(href) {
    if (!href) return;
    navigate(href);
  }

  async function confirmPendingAction(messageIndex) {
    const message = messages[messageIndex];
    const actionId = message?.pending_action?.id;
    if (!actionId || loading) return;

    setLoading(true);
    setError("");

    try {
      const { data } = await api.post("/assistant/confirm-action", {
        action_id: actionId,
      });

      setMessages((prev) => {
        const next = [...prev];
        if (next[messageIndex]) {
          next[messageIndex] = {
            ...next[messageIndex],
            pending_action: {
              ...next[messageIndex].pending_action,
              status: "confirmed",
            },
          };
        }
        next.push({
          role: "assistant",
          content: data?.answer || "La accion fue ejecutada.",
          mode: data?.mode || "assisted_action",
          response_kind: data?.response_kind || null,
          response_card: data?.response_card || null,
          links: Array.isArray(data?.links) ? data.links : [],
          tools_used: [],
        });
        return next;
      });
    } catch (err) {
      const baseMsg = err?.response?.data?.message || "No se pudo ejecutar la accion asistida.";
      const detail = err?.response?.data?.detail;
      setError(detail ? `${baseMsg} Detalle: ${detail}` : baseMsg);
    } finally {
      setLoading(false);
    }
  }

  function cancelPendingAction(messageIndex) {
    setMessages((prev) => {
      const next = [...prev];
      if (next[messageIndex]?.pending_action) {
        next[messageIndex] = {
          ...next[messageIndex],
          pending_action: {
            ...next[messageIndex].pending_action,
            status: "cancelled",
          },
        };
      }
      return next;
    });
  }

  function removeContextItem(key) {
    setContextItems((prev) => prev.filter((item) => contextKey(item) !== key));
  }

  function onDropContext(event) {
    event.preventDefault();
    setDragActive(false);

    const payload = event.dataTransfer?.getData("application/x-assistant-context");
    if (!payload) return;

    try {
      const parsed = JSON.parse(payload);
      const nextItem = normalizeContextItem(parsed);
      if (!nextItem) return;
      setContextItems((prev) => {
        const filtered = prev.filter((item) => contextKey(item) !== contextKey(nextItem));
        return [nextItem, ...filtered].slice(0, 8);
      });
    } catch {
      // noop
    }
  }

  useEffect(() => {
    function onMove(event) {
      const state = chipDragRef.current;
      if (!state.active) return;
      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      state.moved = true;

      const nextTop = Math.max(72, Math.min(window.innerHeight - 120, state.startTop + dy));
      const nextRight = Math.max(0, Math.min(window.innerWidth - 72, state.startRight - dx));

      setChipPosition({
        top: nextTop,
        right: nextRight,
      });
    }

    function onUp() {
      chipDragRef.current.active = false;
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  function startChipDrag(event) {
    chipDragRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      startTop: chipPosition.top,
      startRight: chipPosition.right,
      moved: false,
    };
  }

  function handleChipClick() {
    const wasDragging = chipDragRef.current.moved;
    chipDragRef.current.moved = false;
    if (wasDragging) return;
    setOpen(true);
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          className="fixed z-40 rounded-l-2xl bg-slate-950 px-3 py-4 text-sm font-semibold text-white shadow-lg hover:bg-slate-900 cursor-grab active:cursor-grabbing select-none"
          style={{ top: `${chipPosition.top}px`, right: `${chipPosition.right}px` }}
          onMouseDown={startChipDrag}
          onClick={handleChipClick}
          title="Abrir asistente IA"
        >
          IA
        </button>
      )}

      <div
        className={`fixed right-0 top-14 z-40 h-[calc(100vh-56px)] w-[430px] max-w-[calc(100vw-1rem)] border-l bg-white shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col overflow-hidden">
          <div className="border-b bg-slate-950 px-4 py-3 text-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Asistente IA</div>
                <div className="text-[11px] text-slate-300">
                  Panel asistido con contexto adjunto
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="text-[11px] text-slate-300 hover:text-white"
                  onClick={clearConversation}
                >
                  Limpiar
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-900"
                  onClick={() => setOpen(false)}
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>

          <div className="border-b bg-slate-50 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Contexto adjunto
              </div>
              <div className="text-[11px] text-slate-500">
                Arrastra operaciones, clientes o contactos
              </div>
            </div>
            <div
              className={`mt-2 rounded-2xl border border-dashed p-3 transition ${
                dragActive
                  ? "border-blue-400 bg-blue-50"
                  : "border-slate-300 bg-white"
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={onDropContext}
            >
              {contextItems.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {contextItems.map((item) => (
                    <div
                      key={contextKey(item)}
                      className="inline-flex items-center gap-2 rounded-full border bg-slate-100 px-3 py-1 text-xs text-slate-700"
                      title={contextDescriptor(item)}
                    >
                      <span>{contextDescriptor(item)}</span>
                      <button
                        type="button"
                        className="text-slate-400 hover:text-slate-700"
                        onClick={() => removeContextItem(contextKey(item))}
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-500">
                  Aun no hay contexto adjunto. Puedes arrastrar una operación o usar la API de contexto desde otras pantallas.
                </div>
              )}
            </div>
          </div>

          <div className="border-b bg-slate-50 px-4 py-2 text-[11px] text-slate-600">
            Consulta datos reales y puede proponer acciones con confirmacion.
          </div>

          <div ref={listRef} className="flex-1 overflow-auto bg-white px-4 py-4">
            <div className="space-y-3">
              {booting && <div className="text-xs text-slate-500">Cargando asistente...</div>}

              {!booting && status?.configured === false && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                  El asistente no esta configurado todavia.
                </div>
              )}

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              {!messages.length && !booting && (
                <div className="space-y-3">
                  <div className="text-sm text-slate-700">
                    Este panel puede trabajar con contexto vivo. Adjunta una operación, un cliente o un contacto y luego consulta o pide una acción.
                  </div>
                  <div className="grid gap-2">
                    {SUGGESTIONS.map((item) => (
                      <button
                        key={item}
                        type="button"
                        className="w-full rounded-xl border px-3 py-2 text-left text-sm hover:bg-slate-50"
                        onClick={() => sendMessage(item)}
                        disabled={loading || status?.configured === false}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((message, idx) => {
                const isAssistant = message.role === "assistant";
                return (
                  <div
                    key={`${message.role}-${idx}-${message.content.slice(0, 24)}`}
                    className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}
                  >
                    <div
                      className={
                        "max-w-[92%] rounded-2xl px-3 py-3 text-sm whitespace-pre-wrap " +
                        (isAssistant ? "bg-slate-100 text-slate-800" : "bg-blue-600 text-white")
                      }
                    >
                      {!isAssistant && Array.isArray(message.context_items) && message.context_items.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1">
                          {message.context_items.map((item) => (
                            <span
                              key={contextKey(item)}
                              className="rounded-full bg-white/20 px-2 py-1 text-[10px] uppercase tracking-wide"
                            >
                              {contextDescriptor(item)}
                            </span>
                          ))}
                        </div>
                      )}

                      {isAssistant && message.mode && (
                        <div className="mb-2">
                          <span className="rounded-full border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                            {modeLabel(message.mode)}
                          </span>
                        </div>
                      )}

                      {isAssistant ? (
                        <AssistantResponseBody message={message} />
                      ) : (
                        <div>{message.content}</div>
                      )}

                      {isAssistant && message.pending_action && (
                        <div className="mt-3 rounded-xl border border-slate-300 bg-white px-3 py-3 text-slate-800">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Accion propuesta
                          </div>
                          <div className="mt-1 text-sm">{message.pending_action.summary}</div>
                          {message.pending_action.status === "confirmed" && (
                            <div className="mt-2 text-[11px] text-emerald-700">Accion confirmada.</div>
                          )}
                          {message.pending_action.status === "cancelled" && (
                            <div className="mt-2 text-[11px] text-slate-500">Accion cancelada.</div>
                          )}
                          {!message.pending_action.status && (
                            <div className="mt-3 flex gap-2">
                              <button
                                type="button"
                                className="rounded-lg bg-slate-900 px-3 py-1.5 text-[12px] text-white hover:bg-slate-800"
                                onClick={() => confirmPendingAction(idx)}
                                disabled={loading}
                              >
                                Confirmar
                              </button>
                              <button
                                type="button"
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50"
                                onClick={() => cancelPendingAction(idx)}
                                disabled={loading}
                              >
                                Cancelar
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {isAssistant && Array.isArray(message.links) && message.links.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5 whitespace-normal">
                          {message.links.map((link) => (
                            <button
                              key={`${link.type}-${link.id}-${link.href}`}
                              type="button"
                              className="rounded-full border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                              onClick={() => openAssistantLink(link.href)}
                              title={link.href}
                            >
                              {link.label}
                            </button>
                          ))}
                        </div>
                      )}

                      {isAssistant && Array.isArray(message.tools_used) && message.tools_used.length > 0 && (
                        <div className="mt-2 text-[11px] text-slate-500">
                          Tools: {message.tools_used.join(", ")}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {loading && (
                <div className="flex justify-start">
                  <div className="rounded-2xl bg-slate-100 px-3 py-3 text-sm text-slate-600">
                    Consultando...
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="border-t bg-white p-3">
            <div className="mb-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-full border px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
                onClick={() => setDraft((prev) => (prev ? `${prev} ` : "") + "Resumime este contexto")}
              >
                Resumir
              </button>
              <button
                type="button"
                className="rounded-full border px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
                onClick={() => setDraft((prev) => (prev ? `${prev} ` : "") + "Que seguimiento pendiente tiene esto?")}
              >
                Seguimiento
              </button>
              <button
                type="button"
                className="rounded-full border px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
                onClick={() => setDraft((prev) => (prev ? `${prev} ` : "") + "Tiene cotizacion o presupuesto?")}
              >
                Cotizacion
              </button>
            </div>
            <div className="flex gap-2">
              <textarea
                className="min-h-[52px] max-h-28 flex-1 resize-y rounded-xl border px-3 py-2 text-sm"
                placeholder="Escribi una consulta o una accion usando el contexto adjunto..."
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (canSend) sendMessage(draft);
                  }
                }}
              />
              <button
                type="button"
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
                disabled={!canSend}
                onClick={() => sendMessage(draft)}
              >
                Enviar
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
