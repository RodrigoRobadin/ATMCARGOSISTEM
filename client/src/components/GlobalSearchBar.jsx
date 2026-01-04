// client/src/components/GlobalSearchBar.jsx
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";

export default function GlobalSearchBar() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState({ deals: [], organizations: [], contacts: [], notes: [] });
  const timer = useRef();
  const navigate = useNavigate();

  useEffect(() => {
    clearTimeout(timer.current);

    if (!q) {
      setRes({ deals: [], organizations: [], contacts: [], notes: [] });
      setOpen(false);
      return;
    }

    timer.current = setTimeout(async () => {
      try {
        const { data } = await api.get("/search", { params: { q } });
        // data = { deals, organizations, contacts }
        setRes(data || { deals: [], organizations: [], contacts: [], notes: [] });
        setOpen(true);
      } catch (e) {
        console.error("search failed", e);
        setRes({ deals: [], organizations: [], contacts: [], notes: [] });
        setOpen(true);
      }
    }, 300);

    return () => clearTimeout(timer.current);
  }, [q]);

  const go = (type, id, extra) => {
    setOpen(false);
    if (type === "deal") navigate(`/operations/${id}`);
    if (type === "org") navigate(`/organizations/${id}`);
    if (type === "contact") navigate(`/contacts/${id}`);
    if (type === "note") {
      if (extra?.deal_id) return navigate(`/operations/${extra.deal_id}`);
      if (extra?.org_id) return navigate(`/organizations/${extra.org_id}`);
      if (extra?.contact_id) return navigate(`/contacts/${extra.contact_id}`);
    }
  };

  const hasResults =
    (res.deals?.length || 0) +
      (res.organizations?.length || 0) +
      (res.contacts?.length || 0) +
      (res.notes?.length || 0) >
    0;

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por referencia, cliente, contacto, mercadería, modalidad, tipo de carga, origen, destino…"
        className="w-full border rounded-lg px-3 py-2"
        onFocus={() => q && setOpen(true)}
      />

      {open && (
        <div className="absolute mt-1 bg-white border rounded-lg shadow w-full max-h-72 overflow-auto z-50">
          {/* Operaciones */}
          {res.deals?.length > 0 && (
            <div>
              <div className="px-3 py-1 text-xs text-slate-500">Operaciones</div>
              {res.deals.map((d) => (
                <button
                  key={`d-${d.id}`}
                  onClick={() => go("deal", d.id)}
                  className="block w-full text-left px-3 py-2 hover:bg-slate-50"
                >
                  <div className="text-sm font-medium">
                    {d.reference} {d.title ? `— ${d.title}` : ""}
                  </div>
                  <div className="text-xs text-slate-500">
                    {d.org_name || "Sin cliente"}
                    {d.contact_name ? ` • Cont.: ${d.contact_name}` : ""}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {d.mercaderia ? `Mercadería: ${d.mercaderia} • ` : ""}
                    {d.modalidad_carga || d.transport_type
                      ? `Mod.: ${d.modalidad_carga || d.transport_type}`
                      : ""}
                    {d.tipo_carga ? ` • Tipo: ${d.tipo_carga}` : ""}
                    {(d.origen_pto || d.destino_pto) && (
                      <>
                        {" "}
                        • {d.origen_pto || "?"} → {d.destino_pto || "?"}
                      </>
                    )}
                    {d.incoterm ? ` • Incoterm: ${d.incoterm}` : ""}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Organizaciones */}
          {res.organizations?.length > 0 && (
            <div>
              <div className="px-3 py-1 text-xs text-slate-500">Organizaciones</div>
              {res.organizations.map((o) => (
                <button
                  key={`o-${o.id}`}
                  onClick={() => go("org", o.id)}
                  className="block w-full text-left px-3 py-2 hover:bg-slate-50"
                >
                  <div className="text-sm font-medium">{o.name}</div>
                </button>
              ))}
            </div>
          )}

          {/* Contactos */}
          {res.contacts?.length > 0 && (
            <div>
              <div className="px-3 py-1 text-xs text-slate-500">Contactos</div>
              {res.contacts.map((c) => (
                <button
                  key={`c-${c.id}`}
                  onClick={() => go("contact", c.id)}
                  className="block w-full text-left px-3 py-2 hover:bg-slate-50"
                >
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-slate-500">
                    {c.email || c.phone || "Sin datos de contacto"}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Notas */}
          {res.notes?.length > 0 && (
            <div>
              <div className="px-3 py-1 text-xs text-slate-500">Notas</div>
              {res.notes.map((n) => (
                <button
                  key={`n-${n.id}`}
                  onClick={() =>
                    go("note", n.id, {
                      deal_id: n.deal_id,
                      org_id: n.org_id,
                      contact_id: n.contact_id,
                    })
                  }
                  className="block w-full text-left px-3 py-2 hover:bg-slate-50"
                >
                  <div className="text-sm font-medium line-clamp-2">{n.content}</div>
                  <div className="text-[11px] text-slate-500">
                    {n.deal_reference ? `Op: ${n.deal_reference} · ` : ""}
                    {n.org_name || ""}
                    {n.contact_name ? ` · ${n.contact_name}` : ""}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Sin resultados */}
          {!hasResults && (
            <div className="px-3 py-2 text-sm text-slate-500">Sin resultados</div>
          )}
        </div>
      )}
    </div>
  );
}
