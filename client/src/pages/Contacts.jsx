// client/src/pages/Contacts.jsx
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

export default function Contacts() {
  const [q, setQ] = useState("");
  const [label, setLabel] = useState("");
  const [owner, setOwner] = useState("");
  const [visibility, setVisibility] = useState("");
  const [hasEmail, setHasEmail] = useState(false);

  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);

  const [owners, setOwners] = useState([]);
  const [labelOptions, setLabelOptions] = useState([]);

  async function load() {
    const { data } = await api.get("/contacts", {
      params: {
        q: q || undefined,
        label: label || undefined,
        owner_user_id: owner || undefined,
        visibility: visibility || undefined,
        has_email: hasEmail ? 1 : undefined,
      },
    });
    setRows(data);
  }

  useEffect(() => {
    load();
    (async () => {
      try {
        const [{ data: users }, { data: labels }] = await Promise.all([
          api.get("/users"),
          api.get("/labels", { params: { scope: "person" } }),
        ]);
        setOwners(users || []);
        setLabelOptions(Array.isArray(labels) ? labels : []);
      } catch {}
    })();
  }, []);

  async function onSearch(e) {
    e?.preventDefault?.();
    await load();
  }

  function onClear() {
    setQ("");
    setLabel("");
    setOwner("");
    setVisibility("");
    setHasEmail(false);
    setTimeout(load, 0);
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">Contactos</h2>

        <form onSubmit={onSearch} className="flex items-center gap-2 flex-wrap">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nombre, email o teléfono…"
            className="border rounded-lg px-3 py-2 text-sm w-64"
          />

          <div className="relative">
            <input
              list="labels-person"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Etiqueta (ej. Cliente, Prospecto)"
              className="border rounded-lg px-3 py-2 text-sm w-48"
            />
            <datalist id="labels-person">
              {labelOptions.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </div>

          <select
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Owner (todos)</option>
            {owners.length
              ? owners.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.id})
                  </option>
                ))
              : <option value="1">Admin (1)</option>}
          </select>

          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Visibilidad (todas)</option>
            <option value="company">company</option>
            <option value="shared">shared</option>
            <option value="private">private</option>
          </select>

          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={hasEmail}
              onChange={(e) => setHasEmail(e.target.checked)}
            />
            Sólo con email
          </label>

          <button className="px-3 py-2 text-sm rounded-lg border">Buscar</button>
          <button
            type="button"
            onClick={onClear}
            className="px-3 py-2 text-sm rounded-lg border"
          >
            Limpiar
          </button>

          <button
            type="button"
            onClick={() => setOpen(true)}
            className="px-3 py-2 text-sm rounded-lg bg-black text-white"
          >
            ➕ Nuevo contacto
          </button>
        </form>
      </div>

      <div className="overflow-x-auto bg-white shadow rounded-xl">
        <table className="min-w-full border-collapse">
          <thead className="bg-slate-100 text-sm text-left">
            <tr>
              <th className="px-4 py-2 border-b">Nombre</th>
              <th className="px-4 py-2 border-b">Email</th>
              <th className="px-4 py-2 border-b">Teléfono</th>
              <th className="px-4 py-2 border-b">Cargo</th>
              <th className="px-4 py-2 border-b">Organización</th>
              <th className="px-4 py-2 border-b">Etiqueta</th>
              <th className="px-4 py-2 border-b">Creado</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 border-b">
                  <Link to={`/contacts/${c.id}`} className="text-blue-600 hover:underline">
                    {c.name || c.email || `Contacto #${c.id}`}
                  </Link>
                </td>
                <td className="px-4 py-2 border-b">{c.email || "—"}</td>
                <td className="px-4 py-2 border-b">{c.phone || "—"}</td>
                <td className="px-4 py-2 border-b">{c.title || "—"}</td>
                <td className="px-4 py-2 border-b">{c.org_name || "—"}</td>
                <td className="px-4 py-2 border-b">
                  {c.label ? (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-slate-200">
                      {c.label}
                    </span>
                  ) : "—"}
                </td>
                <td className="px-4 py-2 border-b">
                  {c.created_at ? new Date(c.created_at).toLocaleDateString() : "—"}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                  No hay contactos para este filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <NewContactModal
          onClose={() => setOpen(false)}
          onCreated={async () => {
            await load();
            try {
              const { data: labels } = await api.get("/labels", { params: { scope: "person" } });
              setLabelOptions(Array.isArray(labels) ? labels : []);
            } catch {}
          }}
          owners={owners}
          labelOptions={labelOptions}
        />
      )}
    </div>
  );
}

function NewContactModal({ onClose, onCreated, owners = [], labelOptions = [] }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("");

  const [label, setLabel] = useState("");
  const [owner_user_id, setOwnerUserId] = useState("");
  const [visibility, setVisibility] = useState("company");

  const [orgQ, setOrgQ] = useState("");
  const [orgResults, setOrgResults] = useState([]);
  const [orgPicked, setOrgPicked] = useState(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!orgQ) { setOrgResults([]); return; }
      const { data } = await api.get("/organizations", { params: { q: orgQ } });
      if (!cancel) setOrgResults((Array.isArray(data) ? data : []).slice(0, 10));
    })();
    return () => { cancel = true; };
  }, [orgQ]);

  async function submit(e) {
    e.preventDefault();
    if (!name && !email) return;

    let org_id = orgPicked?.id || null;
    if (!org_id && orgQ) {
      const { data } = await api.post("/organizations", { name: orgQ });
      org_id = data.id;
    }

    await api.post("/contacts", {
      name,
      email,
      phone,
      title,
      org_id,
      label: label || null,
      owner_user_id: owner_user_id || null,
      visibility: visibility || "company"
    });

    await onCreated?.();
    onClose?.();
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-2xl p-4 w-full max-w-md space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Nuevo contacto</h3>
          <button type="button" onClick={onClose} className="text-sm">✕</button>
        </div>

        <label className="block text-sm">Nombre
          <input className="w-full border rounded-lg px-3 py-2" value={name} onChange={e=>setName(e.target.value)} />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm">Email
            <input className="w-full border rounded-lg px-3 py-2" value={email} onChange={e=>setEmail(e.target.value)} />
          </label>
          <label className="block text-sm">Teléfono
            <input className="w-full border rounded-lg px-3 py-2" value={phone} onChange={e=>setPhone(e.target.value)} />
          </label>
        </div>

        <label className="block text-sm">Cargo (opcional)
          <input className="w-full border rounded-lg px-3 py-2" value={title} onChange={e=>setTitle(e.target.value)} />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm">Etiqueta
            <input
              list="labels-person"
              className="w-full border rounded-lg px-3 py-2"
              value={label}
              onChange={(e)=>setLabel(e.target.value)}
              placeholder="Ej: Cliente, Prospecto…"
            />
            <datalist id="labels-person">
              {labelOptions.map(l => <option key={l} value={l} />)}
            </datalist>
          </label>

          <label className="block text-sm">Owner
            <select
              className="w-full border rounded-lg px-3 py-2"
              value={owner_user_id}
              onChange={(e)=>setOwnerUserId(e.target.value)}
            >
              <option value="">(sin owner)</option>
              {owners.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="block text-sm">Visibilidad
          <select
            className="w-full border rounded-lg px-3 py-2"
            value={visibility}
            onChange={(e)=>setVisibility(e.target.value)}
          >
            <option value="company">company</option>
            <option value="shared">shared</option>
            <option value="private">private</option>
          </select>
        </label>

        {/* Organización (buscar o crear) */}
        <div className="relative">
          <label className="block text-sm">Organización (buscar o crear)</label>
          <input
            className="w-full border rounded-lg px-3 py-2"
            value={orgQ}
            onChange={(e)=>{ setOrgQ(e.target.value); setOrgPicked(null); }}
            placeholder="Escribe para buscar…"
          />
          {!!orgResults.length && (
            <div className="absolute z-10 bg-white border rounded w-full mt-1 max-h-48 overflow-auto">
              {orgResults.map(o => (
                <div
                  key={o.id}
                  className="px-3 py-2 text-sm hover:bg-slate-100 cursor-pointer"
                  onClick={()=>{ setOrgQ(o.name); setOrgPicked(o); setOrgResults([]); }}
                >
                  {o.name} <span className="text-slate-500">{o.industry || ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="pt-2 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 border rounded-lg">Cancelar</button>
          <button className="px-3 py-2 rounded-lg bg-black text-white">Crear</button>
        </div>
      </form>
    </div>
  );
}
