import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";

const STORAGE_KEY = "assistant_phase1_history";

const SUGGESTIONS = [
  "Cuantas operaciones abiertas hay?",
  "Que operaciones abiertas no tienen cotizacion?",
  "Cuales operaciones tienen atraso de cotizacion?",
  "Dame un resumen del cliente BIT FARMS",
  "Cuantos servicios abiertos hay?",
];

function loadStoredMessages() {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStoredMessages(messages) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-20)));
  } catch {
    // noop
  }
}

export default function AssistantBubble() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(false);
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState(() => loadStoredMessages());
  const [error, setError] = useState("");
  const listRef = useRef(null);

  useEffect(() => {
    saveStoredMessages(messages);
  }, [messages]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open, loading]);

  useEffect(() => {
    if (!open || status) return;
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
  }, [open, status]);

  const canSend = useMemo(() => {
    return Boolean(
      draft.trim() &&
        !loading &&
        status?.configured !== false
    );
  }, [draft, loading, status]);

  async function sendMessage(text) {
    const content = String(text || "").trim();
    if (!content || loading) return;

    const nextHistory = [
      ...messages,
      { role: "user", content },
    ];

    setMessages(nextHistory);
    setDraft("");
    setLoading(true);
    setError("");

    try {
      const payloadHistory = nextHistory
        .slice(-12)
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content }));

      const { data } = await api.post("/assistant/respond", {
        message: content,
        history: payloadHistory.slice(0, -1),
      });

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data?.answer || "No pude responder esa consulta.",
          tools_used: Array.isArray(data?.tools_used) ? data.tools_used : [],
          links: Array.isArray(data?.links) ? data.links : [],
          pending_action: data?.pending_action || null,
        },
      ]);
    } catch (err) {
      const baseMsg =
        err?.response?.data?.message ||
        "No se pudo procesar la consulta.";
      const detail = err?.response?.data?.detail;
      const msg = detail ? `${baseMsg} Detalle: ${detail}` : baseMsg;
      setError(msg);
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }

  function clearConversation() {
    setMessages([]);
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // noop
    }
  }

  function openAssistantLink(href) {
    if (!href) return;
    setOpen(false);
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
          links: Array.isArray(data?.links) ? data.links : [],
          tools_used: [],
        });
        return next;
      });
    } catch (err) {
      const baseMsg =
        err?.response?.data?.message ||
        "No se pudo ejecutar la accion asistida.";
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

  return (
    <>
      <button
        type="button"
        className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full bg-slate-900 text-white shadow-lg hover:bg-slate-800"
        onClick={() => setOpen((v) => !v)}
        title="Asistente IA"
      >
        IA
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/20"
            aria-label="Cerrar asistente"
            onClick={() => setOpen(false)}
          />

          <div className="fixed bottom-24 right-6 z-50 w-[400px] max-w-[calc(100vw-2rem)] h-[620px] rounded-2xl border bg-white shadow-2xl flex flex-col overflow-hidden">
            <div className="border-b px-4 py-3 bg-slate-950 text-white">
              <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Asistente IA</div>
                    <div className="text-[11px] text-slate-300">
                    Fase 2 - consultas y acciones con confirmacion
                  </div>
                </div>
                <button
                  type="button"
                  className="text-[11px] text-slate-300 hover:text-white"
                  onClick={clearConversation}
                >
                  Limpiar
                </button>
              </div>
            </div>

            <div className="px-4 py-2 border-b bg-slate-50 text-[11px] text-slate-600">
              Consulta datos reales y puede proponer acciones de seguimiento. Toda accion requiere confirmacion.
            </div>

            <div ref={listRef} className="flex-1 overflow-auto px-4 py-4 space-y-3 bg-white">
              {booting && (
                <div className="text-xs text-slate-500">Cargando asistente...</div>
              )}

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
                    Puedo ayudarte a consultar operaciones, cotizaciones, clientes, contactos, seguimiento y servicio.
                  </div>
                  <div className="space-y-2">
                    {SUGGESTIONS.map((item) => (
                      <button
                        key={item}
                        type="button"
                        className="w-full text-left rounded-xl border px-3 py-2 text-sm hover:bg-slate-50"
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
                        "max-w-[88%] rounded-2xl px-3 py-3 text-sm whitespace-pre-wrap " +
                        (isAssistant
                          ? "bg-slate-100 text-slate-800"
                          : "bg-blue-600 text-white")
                      }
                    >
                      <div>{message.content}</div>
                      {isAssistant && message.pending_action && (
                        <div className="mt-3 rounded-xl border border-slate-300 bg-white px-3 py-3 text-slate-800">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Accion propuesta
                          </div>
                          <div className="mt-1 text-sm">
                            {message.pending_action.summary}
                          </div>
                          {message.pending_action.status === "confirmed" && (
                            <div className="mt-2 text-[11px] text-emerald-700">
                              Accion confirmada.
                            </div>
                          )}
                          {message.pending_action.status === "cancelled" && (
                            <div className="mt-2 text-[11px] text-slate-500">
                              Accion cancelada.
                            </div>
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

            <div className="border-t p-3 bg-white">
              <div className="flex gap-2">
                <textarea
                  className="min-h-[44px] max-h-28 flex-1 resize-y rounded-xl border px-3 py-2 text-sm"
                  placeholder="Escribi una consulta sobre el sistema..."
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
        </>
      )}
    </>
  );
}
