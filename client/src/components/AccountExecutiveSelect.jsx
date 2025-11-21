// client/src/components/AccountExecutiveSelect.jsx
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";

export default function AccountExecutiveSelect({
  value,            // id del usuario seleccionado (o null/"")
  onChange,         // (id|null) => void
  disabled = false,
  label = "Ejecutivo de cuenta",
  placeholder = "— Sin asignar —",
  onlyActive = true,
}) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // ...
  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const { data } = await api.get("/users/select", {
          params: onlyActive ? { active: 1 } : { active: 0 },
        });
        if (!live) return;
        const list = Array.isArray(data) ? data : [];
        const map = list
          .map((u) => {
            const id = u.id ?? u.user_id ?? null;
            const name = u.name || u.email || null;
            if (!id || !name) return null;
            return { id, name: String(name), email: u.email || "" };
          })
          .filter(Boolean);
        setUsers(map);
      } catch (e) {
        setErr("No se pudo cargar la lista de usuarios.");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [onlyActive]);
  // ...


  const options = useMemo(() => users, [users]);

  return (
    <label className="text-sm">
      {label}
      <select
        className="w-full border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/10 mt-1"
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value ? Number(e.target.value) : null)}
        disabled={disabled || loading}
      >
        <option value="">{placeholder}</option>
        {options.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} {u.email ? `· ${u.email}` : ""}
          </option>
        ))}
      </select>
      {err && <div className="text-xs text-red-600 mt-1">{err}</div>}
    </label>
  );
}
