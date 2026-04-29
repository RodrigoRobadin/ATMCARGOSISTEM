import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";

function normalizeOrganizations(data) {
  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data?.items)
    ? data.items
    : [];
  return rows
    .map((row) => {
      if (!row) return null;
      const id = row.id ?? row.org_id ?? row.organization_id ?? null;
      const name = row.razon_social || row.name || row.org_name || null;
      if (!id || !name) return null;
      return {
        id: Number(id),
        name: String(name),
        razon_social: row.razon_social || row.name || "",
        ruc: row.ruc || "",
        tipo_org: row.tipo_org || "",
      };
    })
    .filter(Boolean);
}

export default function OrganizationLookupField({
  value = null,
  onSelect,
  tipoOrg = "",
  placeholder = "Buscar organización...",
  disabled = false,
  allowCreate = false,
  createLabel = "Crear organización",
}) {
  const [query, setQuery] = useState(value?.name || "");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setQuery(value?.name || "");
  }, [value?.id, value?.name]);

  useEffect(() => {
    if (disabled) return undefined;
    const q = String(query || "").trim();
    if (q.length < 2) {
      setResults([]);
      return undefined;
    }

    const timer = setTimeout(async () => {
      try {
        setLoading(true);
        const { data } = await api.get("/organizations", {
          params: { q, tipo_org: tipoOrg || undefined, limit: 10 },
        });
        setResults(normalizeOrganizations(data));
        setOpen(true);
      } catch (err) {
        console.error("No se pudo buscar organizaciones", err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query, tipoOrg, disabled]);

  const canCreate = useMemo(() => {
    const q = String(query || "").trim();
    if (!allowCreate || q.length < 2 || creating) return false;
    return !results.some((row) => row.name.toLowerCase() === q.toLowerCase());
  }, [allowCreate, creating, query, results]);

  async function handleCreate() {
    const name = String(query || "").trim();
    if (!name) return;
    try {
      setCreating(true);
      const { data } = await api.post("/organizations", {
        razon_social: name,
        name,
        tipo_org: tipoOrg || null,
      });
      const created = normalizeOrganizations([data])[0];
      if (created) {
        onSelect?.(created);
        setQuery(created.name);
        setOpen(false);
      }
    } catch (err) {
      console.error("No se pudo crear organización rápida", err);
      alert("No se pudo crear la organización.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="relative">
      <div className="flex gap-2">
        <input
          className={`w-full rounded-lg border px-2 py-1 text-sm focus:outline-none ${
            disabled ? "cursor-not-allowed bg-slate-50" : "focus:ring-2 focus:ring-black/10"
          }`}
          value={query}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={() => {
            if (!disabled && (results.length || canCreate)) setOpen(true);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
        />
        {value?.id ? (
          <button
            type="button"
            className="rounded-lg border px-2 py-1 text-xs"
            disabled={disabled}
            onClick={() => {
              onSelect?.(null);
              setQuery("");
              setResults([]);
              setOpen(false);
            }}
          >
            Limpiar
          </button>
        ) : null}
      </div>

      {open && !disabled ? (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border bg-white shadow-lg">
          {loading ? (
            <div className="px-3 py-2 text-sm text-slate-500">Buscando...</div>
          ) : null}

          {!loading && results.map((row) => (
            <button
              key={row.id}
              type="button"
              className="block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50"
              onClick={() => {
                onSelect?.(row);
                setQuery(row.name);
                setOpen(false);
              }}
            >
              <div className="font-medium">{row.name}</div>
              <div className="text-xs text-slate-500">
                {row.tipo_org || "Sin tipo"}
                {row.ruc ? ` • RUC: ${row.ruc}` : ""}
              </div>
            </button>
          ))}

          {!loading && !results.length && !canCreate ? (
            <div className="px-3 py-2 text-sm text-slate-500">Sin resultados</div>
          ) : null}

          {!loading && canCreate ? (
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-sm font-medium text-blue-700 hover:bg-blue-50"
              onClick={handleCreate}
            >
              {creating ? "Creando..." : `${createLabel}: "${String(query || "").trim()}"`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
