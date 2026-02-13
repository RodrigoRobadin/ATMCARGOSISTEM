// client/src/socket.js
import { io } from "socket.io-client";
import { TOKEN_KEY, API_BASE } from "./api";

function getToken() {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t || t === "SESSION") return null;
    return t;
  } catch {
    return null;
  }
}

function getSocketUrl() {
  if (typeof window === "undefined") return "";
  try {
    const base = API_BASE || "";
    if (base.startsWith("http")) {
      const u = new URL(base);
      return `${u.protocol}//${u.host}`;
    }
  } catch {}
  return window.location.origin;
}

let socket = null;

export function getSocket() {
  if (socket) return socket;
  const token = getToken();
  socket = io(getSocketUrl(), {
    withCredentials: true,
    auth: token ? { token } : {},
    transports: ["websocket", "polling"],
  });
  return socket;
}
