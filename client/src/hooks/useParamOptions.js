// client/src/hooks/useParamOptions.js
import { useEffect, useState } from 'react';
import { api } from '../api';

/**
 * useParamOptions(keys, opts)
 * - keys: array de claves
 * - opts.onlyActive: true => filtra por active = 1
 * - opts.asValues:   true => devuelve sólo array de strings (value)
 */
export default function useParamOptions(keys = [], opts = {}) {
  const { onlyActive = false, asValues = false } = opts;
  const [options, setOptions] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get('/params', {
          params: { keys: keys.join(',') },
        });
        if (!alive) return;

        const out = {};
        (data || {});
        for (const k of keys) {
          const arr = (data?.[k] || []);
          const filtered = onlyActive ? arr.filter(x => !!x.active) : arr;
          out[k] = asValues ? filtered.map(x => x.value) : filtered;
        }
        setOptions(out);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [JSON.stringify(keys), onlyActive, asValues]);

  return { options, loading, reload: () => setLoading(true) };
}
