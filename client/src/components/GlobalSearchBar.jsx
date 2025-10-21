// client/src/components/GlobalSearchBar.jsx
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

export default function GlobalSearchBar() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState({ deals: [], orgs: [], contacts: [] });
  const timer = useRef();
  const navigate = useNavigate();

  useEffect(() => {
    clearTimeout(timer.current);

    if (!q) {
      setRes({ deals: [], orgs: [], contacts: [] });
      setOpen(false);
      return;
    }

    timer.current = setTimeout(async () => {
      try {
        const { data } = await api.get('/search', { params: { q } });
        setRes(data);
        setOpen(true);
      } catch (e) {
        console.error('search failed', e);
        setRes({ deals: [], orgs: [], contacts: [] });
        setOpen(true);
      }
    }, 300);

    return () => clearTimeout(timer.current);
  }, [q]);

  const go = (type, id) => {
    setOpen(false);
    if (type === 'deal') navigate(`/operations/${id}`);
    if (type === 'org') navigate(`/organizations/${id}`);
    if (type === 'contact') navigate(`/contacts/${id}`);
  };

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar operaciones, organizaciones, contactos…"
        className="w-full border rounded-lg px-3 py-2"
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
                  onClick={() => go('deal', d.id)}
                  className="block w-full text-left px-3 py-2 hover:bg-slate-50"
                >
                  <div className="text-sm font-medium">{d.title || d.reference}</div>
                  <div className="text-xs text-slate-500">Ref: {d.reference}</div>
                </button>
              ))}
            </div>
          )}

          {/* Organizaciones */}
          {res.orgs?.length > 0 && (
            <div>
              <div className="px-3 py-1 text-xs text-slate-500">Organizaciones</div>
              {res.orgs.map((o) => (
                <button
                  key={`o-${o.id}`}
                  onClick={() => go('org', o.id)}
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
                  onClick={() => go('contact', c.id)}
                  className="block w-full text-left px-3 py-2 hover:bg-slate-50"
                >
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-slate-500">{c.email || c.phone}</div>
                </button>
              ))}
            </div>
          )}

          {/* Sin resultados */}
          {!res.deals?.length && !res.orgs?.length && !res.contacts?.length && (
            <div className="px-3 py-2 text-sm text-slate-500">Sin resultados</div>
          )}
        </div>
      )}
    </div>
  );
}
