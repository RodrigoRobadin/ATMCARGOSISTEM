// client/src/hooks/useParamOptions.js
import { useEffect, useState } from 'react';
import api from '../api';

/**
 * useParamOptions(keys, opts)
 * - keys: array de claves
 * - opts.onlyActive: true => filtra por active = 1
 * - opts.asValues:   true => devuelve sólo array de strings (value)
 *
 * Ejemplo:
 *   const { options, loading } = useParamOptions(
 *     ['org_tipo', 'org_rubro'],
 *     { onlyActive: true, asValues: true }
 *   );
 *   options.org_tipo -> ['Cliente', 'Proveedor', ...]
 */
export default function useParamOptions(keys = [], opts = {}) {
  const { onlyActive = false, asValues = false } = opts;
  const [options, setOptions] = useState({});
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0); // para forzar recarga manual

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      try {
        const arrKeys = Array.isArray(keys) ? keys.filter(Boolean) : [];
        if (!arrKeys.length) {
          if (alive) {
            setOptions({});
            setLoading(false);
          }
          return;
        }

        const { data } = await api.get('/params', {
          params: { keys: arrKeys.join(',') },
        });

        if (!alive) return;

        const raw = data || {};
        const out = {};

        for (const k of arrKeys) {
          const list = Array.isArray(raw[k]) ? raw[k] : [];

          const filtered = onlyActive
            ? list.filter((x) =>
                // acepta x.active === 1, '1', true, etc.
                x && (x.active === 1 || x.active === '1' || x.active === true)
              )
            : list;

          if (asValues) {
            out[k] = filtered
              .map((x) => {
                if (typeof x === 'string') return x;
                return x?.value ?? x?.key ?? x?.code ?? '';
              })
              .filter(Boolean);
          } else {
            out[k] = filtered;
          }
        }

        setOptions(out);
      } catch (e) {
        // en caso de error, no tiramos la app, solo dejamos options como {}
        if (alive) {
          setOptions({});
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
    // stringify para detectar cambios de contenido en keys
  }, [JSON.stringify(keys), onlyActive, asValues, reloadTick]);

  const reload = () => setReloadTick((n) => n + 1);

  return { options, loading, reload };
}
