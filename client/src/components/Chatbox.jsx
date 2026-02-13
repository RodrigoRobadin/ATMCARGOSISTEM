// client/src/components/Chatbox.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import api, { USER_KEY } from "../api";
import { getSocket } from "../socket";

const formatTime = (v) => {
  if (!v) return "";
  const d = new Date(String(v).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const formatDate = (v) => {
  if (!v) return "";
  const d = new Date(String(v).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString();
};

const initials = (name = "") => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
};

export default function Chatbox() {
  const [open, setOpen] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [users, setUsers] = useState([]);
  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkType, setLinkType] = useState("operation");
  const [linkId, setLinkId] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [pendingLinks, setPendingLinks] = useState([]);
  const fileRef = useRef(null);
  const listRef = useRef(null);
  const myId = useMemo(() => {
    try {
      const raw = localStorage.getItem(USER_KEY);
      const u = raw ? JSON.parse(raw) : null;
      return u?.id || null;
    } catch {
      return null;
    }
  }, []);

  const totalUnread = useMemo(
    () =>
      conversations.reduce(
        (acc, c) => acc + Number(c.unread_count || 0),
        0
      ),
    [conversations]
  );

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await api.get("/messages/conversations");
      setConversations(Array.isArray(data) ? data : []);
    })();
  }, [open]);

  useEffect(() => {
    if (!activeId) return;
    (async () => {
      const { data } = await api.get(
        `/messages/conversations/${activeId}/messages`
      );
      setMessages(Array.isArray(data) ? data : []);
      await api.post(`/messages/conversations/${activeId}/read`);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeId ? { ...c, unread_count: 0 } : c
        )
      );
    })();
  }, [activeId]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onNew = (payload) => {
      const convId = payload?.conversation_id;
      if (!convId) return;
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                last_message_body: payload.body,
                last_message_at: payload.created_at,
                unread_count:
                  c.id === activeId ? 0 : Number(c.unread_count || 0) + 1,
              }
            : c
        )
      );
      if (convId === activeId) {
        setMessages((prev) => [...prev, payload]);
        api.post(`/messages/conversations/${convId}/read`).catch(() => {});
      }
    };
    socket.on("message:new", onNew);
    return () => {
      socket.off("message:new", onNew);
    };
  }, [activeId]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    if (activeId) {
      socket.emit("conversation:join", activeId);
    }
    return () => {
      if (activeId) socket.emit("conversation:leave", activeId);
    };
  }, [activeId]);

  useEffect(() => {
    if (!open || !newOpen) return;
    (async () => {
      const { data } = await api.get("/users");
      setUsers(Array.isArray(data) ? data : []);
    })();
  }, [open, newOpen]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, activeId]);

  const activeConv = conversations.find((c) => c.id === activeId) || null;
  const activeTitle = useMemo(() => {
    if (!activeConv) return "";
    if (activeConv.title) return activeConv.title;
    const others = (activeConv.members || []).filter(
      (m) => (myId ? m.id !== myId : true)
    );
    if (others.length === 1) return others[0].name;
    if (activeConv.members?.length) return activeConv.members.map((m) => m.name).join(", ");
    return "Conversacion";
  }, [activeConv, myId]);

  async function sendMessage() {
    if (!activeId) return;
    const body = draft.trim();
    if (!body && pendingLinks.length === 0) return;

    const links = pendingLinks.map((l) => ({
      entity_type: l.entity_type,
      entity_id: l.entity_id,
      label: l.label,
      url: l.url,
    }));
    setDraft("");
    setPendingLinks([]);
    setLinkOpen(false);
    setLinkId("");
    setLinkLabel("");
    setLinkUrl("");

    const { data } = await api.post(
      `/messages/conversations/${activeId}/messages`,
      { body, links }
    );
    setMessages((prev) => [...prev, data]);
  }

  async function uploadFile(file) {
    if (!activeId || !file) return;
    const fd = new FormData();
    fd.append("file", file);
    const { data } = await api.post(
      `/messages/conversations/${activeId}/files`,
      fd,
      { headers: { "Content-Type": "multipart/form-data" } }
    );
    setMessages((prev) => [...prev, data]);
  }

  async function createConversation() {
    if (selectedUsers.length === 0) return;
    const type = selectedUsers.length === 1 ? "direct" : "group";
    const { data } = await api.post("/messages/conversations", {
      type,
      title: type === "group" ? newTitle.trim() || null : null,
      member_ids: selectedUsers,
    });
    const { data: list } = await api.get("/messages/conversations");
    setConversations(Array.isArray(list) ? list : []);
    setNewOpen(false);
    setSelectedUsers([]);
    setNewTitle("");
    setActiveId(data?.id || null);
  }

  function addLink() {
    if (!linkType) return;
    const entity_id = linkId ? Number(linkId) : null;
    const label = linkLabel || "";
    const url = linkUrl || "";
    if (!entity_id && !url) return;
    setPendingLinks((prev) => [
      ...prev,
      { entity_type: linkType, entity_id, label, url },
    ]);
    setLinkId("");
    setLinkLabel("");
    setLinkUrl("");
    setLinkOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border bg-white text-sm font-semibold hover:bg-slate-50"
        title="Mensajeria"
        onClick={() => setOpen((v) => !v)}
      >
        C
        {totalUnread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-blue-600 text-white text-[10px] leading-[18px] text-center">
            {totalUnread}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 bg-black/20 z-40"
            aria-label="Cerrar chat"
            onClick={() => setOpen(false)}
          />
          <div className="fixed right-4 top-16 z-50 w-[780px] max-w-[92vw] h-[560px] rounded-2xl border bg-white shadow-xl flex overflow-hidden">
            <div className="w-56 border-r flex flex-col bg-slate-50">
              <div className="p-3 border-b flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-700">Chats</div>
                <button
                  type="button"
                  className="text-[11px] text-blue-600 hover:underline"
                  onClick={() => setNewOpen(true)}
                >
                  Nuevo
                </button>
              </div>
              <div className="flex-1 overflow-auto">
                {conversations.map((c) => {
                  const names =
                    c.title ||
                    (c.members || [])
                      .filter((m) => (myId ? m.id !== myId : true))
                      .map((m) => m.name)
                      .join(", ") ||
                    "Conversacion";
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={`w-full text-left px-3 py-3 border-b hover:bg-white ${
                        activeId === c.id ? "bg-white" : ""
                      }`}
                      onClick={() => setActiveId(c.id)}
                    >
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-slate-200 text-slate-700 text-[11px] font-semibold flex items-center justify-center">
                          {initials(names)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-semibold text-slate-800 truncate">
                            {names}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {c.last_message_body || "Sin mensajes"}
                          </div>
                        </div>
                        {Number(c.unread_count || 0) > 0 && (
                          <span className="text-[10px] text-white bg-blue-600 rounded-full px-2 py-0.5">
                            {c.unread_count}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
                {!conversations.length && (
                  <div className="text-[11px] text-slate-500 p-3">
                    Sin conversaciones
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 flex flex-col">
              <div className="p-4 border-b">
                <div className="text-sm font-semibold text-slate-800 truncate">
                  {activeTitle || "Selecciona un chat"}
                </div>
                {activeConv && (
                  <div className="text-[11px] text-slate-500">
                    {activeConv.type === "group" ? "Grupo" : "Directo"}
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-auto p-4 pr-8 space-y-3" ref={listRef}>
                {messages.map((m) => {
                  const mine = myId && Number(m.sender_id) === Number(myId);
                  return (
                    <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[75%] min-w-0 rounded-2xl px-3 py-2 text-[12px] ${
                          mine ? "bg-black text-white mr-2" : "bg-slate-100 text-slate-800 ml-2"
                        }`}
                      >
                        <div className="text-[10px] opacity-70 mb-1">
                          {mine ? "Yo" : (m.sender_name || `Usuario ${m.sender_id}`)} · {formatTime(m.created_at)}
                        </div>
                        {m.body && (
                          <div className="whitespace-pre-wrap break-words">
                            {m.body}
                          </div>
                        )}
                        {m.attachments?.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {m.attachments.map((a) => (
                              <div key={a.id} className="text-[11px]">
                                {a.type === "file" && a.url && (
                                  <a
                                    href={a.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`inline-flex items-center gap-2 rounded-lg px-2 py-1 max-w-full ${
                                      mine ? "bg-white/10 text-white" : "bg-white text-slate-700"
                                    }`}
                                  >
                                    <span className="text-[12px] shrink-0">📎</span>
                                    <span className="truncate max-w-[220px]">
                                      {a.filename || "Archivo"}
                                    </span>
                                  </a>
                                )}
                                {a.type === "link" && (
                                  <a
                                    href={
                                      a.url ||
                                      (a.entity_type === "operation"
                                        ? `/operations/${a.entity_id}`
                                        : a.entity_type === "organization"
                                        ? `/organizations/${a.entity_id}`
                                        : "#")
                                    }
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`inline-flex items-center gap-2 rounded-full px-2 py-0.5 max-w-full ${
                                      mine ? "bg-white/10 text-white" : "bg-white text-slate-700"
                                    }`}
                                  >
                                    <span className="text-[10px] uppercase tracking-wide shrink-0">
                                      {a.entity_type || "link"}
                                    </span>
                                    <span className="truncate max-w-[200px]">
                                      {a.label || a.entity_id || ""}
                                    </span>
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="text-[10px] opacity-60 mt-1">
                          {formatDate(m.created_at)}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!messages.length && (
                  <div className="text-[11px] text-slate-500">
                    Sin mensajes
                  </div>
                )}
              </div>

              {pendingLinks.length > 0 && (
                <div className="px-4 pb-1 text-[11px] text-slate-600">
                  Adjuntos:
                  {pendingLinks.map((l, i) => (
                    <span key={`${l.entity_type}-${i}`} className="ml-2">
                      {l.label || l.entity_type} {l.entity_id || ""}
                    </span>
                  ))}
                </div>
              )}

              <div className="p-3 border-t flex items-center gap-2 bg-white">
                <button
                  type="button"
                  className="px-2 py-1 text-[11px] border rounded hover:bg-slate-50"
                  onClick={() => setLinkOpen((v) => !v)}
                  disabled={!activeId}
                >
                  Link
                </button>
                <button
                  type="button"
                  className="px-2 py-1 text-[11px] border rounded hover:bg-slate-50"
                  onClick={() => fileRef.current?.click()}
                  disabled={!activeId}
                >
                  Archivo
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadFile(f);
                    e.target.value = "";
                  }}
                />
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Escribe un mensaje..."
                  className="flex-1 border rounded px-2 py-2 text-sm"
                  disabled={!activeId}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                />
                <button
                  type="button"
                  className="px-3 py-2 text-sm rounded bg-black text-white"
                  onClick={sendMessage}
                  disabled={!activeId}
                >
                  Enviar
                </button>
              </div>

              {linkOpen && (
                <div className="p-3 border-t bg-slate-50 text-[11px]">
                  <div className="flex items-center gap-2">
                    <select
                      value={linkType}
                      onChange={(e) => setLinkType(e.target.value)}
                      className="border rounded px-2 py-1"
                    >
                      <option value="operation">Operacion</option>
                      <option value="organization">Organizacion</option>
                      <option value="document">Documento</option>
                    </select>
                    <input
                      value={linkId}
                      onChange={(e) => setLinkId(e.target.value)}
                      placeholder="ID"
                      className="border rounded px-2 py-1 w-20"
                    />
                    <input
                      value={linkLabel}
                      onChange={(e) => setLinkLabel(e.target.value)}
                      placeholder="Etiqueta"
                      className="border rounded px-2 py-1 flex-1"
                    />
                    <input
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      placeholder="URL (opcional)"
                      className="border rounded px-2 py-1 flex-1"
                    />
                    <button
                      type="button"
                      className="px-2 py-1 border rounded hover:bg-white"
                      onClick={addLink}
                    >
                      Agregar
                    </button>
                  </div>
                </div>
              )}
            </div>

            {newOpen && (
              <div className="absolute inset-0 bg-white/95 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold">Nuevo chat</div>
                  <button
                    type="button"
                    className="text-[11px] text-blue-600 hover:underline"
                    onClick={() => setNewOpen(false)}
                  >
                    Cerrar
                  </button>
                </div>
                <div className="mb-2 text-[11px] text-slate-500">
                  Selecciona usuarios. Si eliges mas de uno, se crea grupo.
                </div>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Titulo (solo grupos)"
                  className="w-full border rounded px-2 py-2 text-sm mb-2"
                />
                <div className="max-h-72 overflow-auto border rounded p-2 mb-2">
                  {users.filter((u) => u.id !== myId).map((u) => (
                    <label key={u.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedUsers.includes(u.id)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSelectedUsers((prev) =>
                            checked
                              ? [...prev, u.id]
                              : prev.filter((id) => id !== u.id)
                          );
                        }}
                      />
                      <span>{u.name}</span>
                    </label>
                  ))}
                  {!users.length && (
                    <div className="text-[11px] text-slate-500">
                      Sin usuarios
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="px-3 py-2 text-sm rounded bg-black text-white"
                  onClick={createConversation}
                >
                  Crear
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
