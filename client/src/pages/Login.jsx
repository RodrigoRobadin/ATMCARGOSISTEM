// src/pages/Login.jsx
import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import bgImage from "../assets/IMAGEN FONDO ATM.jpg"; // ⬅️ import del fondo

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const from = loc.state?.from?.pathname || "/";

  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    setSubmitting(true);
    try {
      await login({ email, password: pass });
      nav(from, { replace: true });
    } catch (e) {
      setErr("Usuario o contraseña inválidos");
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="min-h-screen grid place-items-center bg-gray-50 p-4 bg-no-repeat bg-cover bg-center"
      style={{ backgroundImage: `url(${bgImage})` }}
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white border rounded-2xl p-6 space-y-3"
      >
        <h1 className="text-lg font-semibold">Ingresar</h1>
        {err && <div className="text-sm text-red-600">{err}</div>}
        <label className="block">
          <span className="text-xs text-slate-600">Email</span>
          <input
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">Contraseña</span>
          <input
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            required
          />
        </label>
        <button
          disabled={submitting}
          className="w-full px-3 py-2 rounded-lg bg-black text-white"
          type="submit"
        >
          {submitting ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
    </div>
  );
}
