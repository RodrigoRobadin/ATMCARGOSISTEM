import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const TABS = [
  { key: 'categories', label: 'Categorías' },
  { key: 'subcategories', label: 'Subcategorías' },
  { key: 'costCenters', label: 'Centros de costo' },
];

const sortByOrder = (rows) =>
  [...rows].sort(
    (a, b) =>
      Number(a.ord || 0) - Number(b.ord || 0) ||
      String(a.name || '').localeCompare(String(b.name || ''), 'es')
  );

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export default function AdminExpensesMastersModal({
  open,
  onClose,
  meta,
  onRefresh,
}) {
  const [activeTab, setActiveTab] = useState('categories');
  const [search, setSearch] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [newName, setNewName] = useState('');
  const [newSubcategoryCategoryId, setNewSubcategoryCategoryId] = useState('');
  const [categoryEdits, setCategoryEdits] = useState({});
  const [subcategoryEdits, setSubcategoryEdits] = useState({});
  const [costCenterEdits, setCostCenterEdits] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const categories = useMemo(
    () => sortByOrder(meta?.categories || []),
    [meta?.categories]
  );
  const subcategories = useMemo(
    () => sortByOrder(meta?.subcategories || []),
    [meta?.subcategories]
  );
  const costCenters = useMemo(
    () => sortByOrder(meta?.costCenters || []),
    [meta?.costCenters]
  );

  useEffect(() => {
    if (!open) return;
    const firstActiveCategory = categories.find((category) => category.active);
    setSelectedCategoryId((current) => current || String(firstActiveCategory?.id || ''));
    setNewSubcategoryCategoryId((current) =>
      current || String(firstActiveCategory?.id || '')
    );
  }, [open, categories]);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setNewName('');
    setError('');
  }, [activeTab, open]);

  const query = normalizeSearch(search);
  const filteredCategories = categories.filter((category) =>
    normalizeSearch(category.name).includes(query)
  );
  const filteredSubcategories = subcategories.filter((subcategory) => {
    const matchesCategory =
      !selectedCategoryId ||
      String(subcategory.category_id) === String(selectedCategoryId);
    return matchesCategory && normalizeSearch(subcategory.name).includes(query);
  });
  const filteredCostCenters = costCenters.filter((center) =>
    normalizeSearch(center.name).includes(query)
  );

  const currentRows =
    activeTab === 'categories'
      ? filteredCategories
      : activeTab === 'subcategories'
        ? filteredSubcategories
        : filteredCostCenters;

  function editFor(type, row) {
    if (type === 'categories') return categoryEdits[row.id] || row;
    if (type === 'subcategories') return subcategoryEdits[row.id] || row;
    return costCenterEdits[row.id] || row;
  }

  function setEdit(type, row, patch) {
    const setter =
      type === 'categories'
        ? setCategoryEdits
        : type === 'subcategories'
          ? setSubcategoryEdits
          : setCostCenterEdits;
    setter((current) => ({
      ...current,
      [row.id]: { ...editFor(type, row), ...patch },
    }));
  }

  async function run(action) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (requestError) {
      setError(
        requestError?.response?.data?.error ||
          'No se pudo guardar el cambio. Revisa los datos e intenta nuevamente.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function refreshAndClear(type, id) {
    const setter =
      type === 'categories'
        ? setCategoryEdits
        : type === 'subcategories'
          ? setSubcategoryEdits
          : setCostCenterEdits;
    setter((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    await onRefresh();
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) {
      setError('Escribe un nombre antes de agregar.');
      return;
    }
    await run(async () => {
      if (activeTab === 'categories') {
        await api.post('/admin-expenses/categories', { name });
      } else if (activeTab === 'subcategories') {
        if (!newSubcategoryCategoryId) {
          throw { response: { data: { error: 'Selecciona una categoría.' } } };
        }
        await api.post('/admin-expenses/subcategories', {
          name,
          category_id: newSubcategoryCategoryId,
        });
      } else {
        await api.post('/admin-expenses/cost-centers', { name });
      }
      setNewName('');
      await onRefresh();
    });
  }

  async function handleSave(type, row) {
    const edit = editFor(type, row);
    const path =
      type === 'categories'
        ? 'categories'
        : type === 'subcategories'
          ? 'subcategories'
          : 'cost-centers';
    const payload = {
      name: String(edit.name || '').trim(),
      ord: Number(edit.ord || 0),
      active: edit.active ? 1 : 0,
    };
    if (type === 'subcategories') {
      payload.category_id = edit.category_id;
    }
    await run(async () => {
      await api.patch(`/admin-expenses/${path}/${row.id}`, payload);
      await refreshAndClear(type, row.id);
    });
  }

  async function move(type, row, direction) {
    const rows = currentRows;
    const index = rows.findIndex((item) => item.id === row.id);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= rows.length) return;

    const other = rows[target];
    const path =
      type === 'categories'
        ? 'categories'
        : type === 'subcategories'
          ? 'subcategories'
          : 'cost-centers';
    const currentOrder = Number(row.ord || index * 10 + 10);
    const targetOrder = Number(other.ord || target * 10 + 10);
    await run(async () => {
      await api.patch(`/admin-expenses/${path}/${row.id}`, {
        ord: targetOrder,
      });
      await api.patch(`/admin-expenses/${path}/${other.id}`, {
        ord: currentOrder,
      });
      await onRefresh();
    });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Maestros de gastos</h2>
            <p className="text-xs text-slate-500">
              Administra las clasificaciones disponibles para gastos y recurrencias.
            </p>
          </div>
          <button
            type="button"
            className="rounded border px-3 py-1.5 text-sm"
            onClick={onClose}
          >
            Cerrar
          </button>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b px-4 pt-3">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                activeTab === tab.key
                  ? 'border-black font-medium text-slate-950'
                  : 'border-transparent text-slate-500'
              }`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 border-b px-4 py-3 md:grid-cols-[1fr_1fr_auto]">
          <div>
            <label className="text-xs text-slate-500">Buscar</label>
            <input
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nombre"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">
              {activeTab === 'categories'
                ? 'Nueva categoría'
                : activeTab === 'subcategories'
                  ? 'Nueva subcategoría'
                  : 'Nuevo centro de costo'}
            </label>
            <div className="mt-1 flex gap-2">
              {activeTab === 'subcategories' && (
                <select
                  className="w-44 rounded border px-2 py-2 text-sm"
                  value={newSubcategoryCategoryId}
                  onChange={(event) =>
                    setNewSubcategoryCategoryId(event.target.value)
                  }
                >
                  <option value="">Categoría</option>
                  {categories.filter((category) => category.active).map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              )}
              <input
                className="min-w-0 flex-1 rounded border px-3 py-2 text-sm"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleCreate();
                  }
                }}
                placeholder="Nombre"
              />
            </div>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              className="w-full rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
              onClick={handleCreate}
              disabled={busy}
            >
              Agregar
            </button>
          </div>
        </div>

        {activeTab === 'subcategories' && (
          <div className="border-b px-4 py-3">
            <label className="text-xs text-slate-500">Ver subcategorías de</label>
            <select
              className="ml-2 rounded border px-2 py-1.5 text-sm"
              value={selectedCategoryId}
              onChange={(event) => setSelectedCategoryId(event.target.value)}
            >
              <option value="">Todas las categorías</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <div className="border-b bg-red-50 px-4 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="overflow-auto">
          <table className="min-w-[820px] w-full text-sm">
            <thead className="sticky top-0 bg-slate-100 text-slate-600">
              <tr>
                <th className="px-4 py-2 text-left">Nombre</th>
                {activeTab === 'subcategories' && (
                  <th className="px-4 py-2 text-left">Categoría</th>
                )}
                <th className="w-24 px-4 py-2 text-left">Orden</th>
                <th className="w-24 px-4 py-2 text-center">Activo</th>
                <th className="w-36 px-4 py-2 text-center">Mover</th>
                <th className="w-24 px-4 py-2 text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {currentRows.map((row, index) => {
                const edit = editFor(activeTab, row);
                const isCore = Boolean(row.system_key);
                return (
                  <tr key={row.id} className="border-t">
                    <td className="px-4 py-2">
                      <input
                        className="w-full rounded border px-2 py-1.5"
                        value={edit.name || ''}
                        onChange={(event) =>
                          setEdit(activeTab, row, { name: event.target.value })
                        }
                      />
                      {isCore && (
                        <div className="mt-1 text-[11px] text-slate-400">
                          Maestro base
                        </div>
                      )}
                    </td>
                    {activeTab === 'subcategories' && (
                      <td className="px-4 py-2">
                        <select
                          className="w-full rounded border px-2 py-1.5"
                          value={edit.category_id || ''}
                          disabled={isCore}
                          onChange={(event) =>
                            setEdit(activeTab, row, {
                              category_id: event.target.value,
                            })
                          }
                        >
                          {categories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    )}
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        className="w-20 rounded border px-2 py-1.5"
                        value={edit.ord ?? 0}
                        onChange={(event) =>
                          setEdit(activeTab, row, { ord: event.target.value })
                        }
                      />
                    </td>
                    <td className="px-4 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={Boolean(edit.active)}
                        disabled={isCore}
                        title={
                          isCore
                            ? 'Los maestros base no se pueden desactivar'
                            : undefined
                        }
                        onChange={(event) =>
                          setEdit(activeTab, row, {
                            active: event.target.checked ? 1 : 0,
                          })
                        }
                      />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-center gap-1">
                        <button
                          type="button"
                          className="rounded border px-2 py-1 text-xs disabled:opacity-30"
                          onClick={() => move(activeTab, row, 'up')}
                          disabled={busy || index === 0}
                        >
                          Subir
                        </button>
                        <button
                          type="button"
                          className="rounded border px-2 py-1 text-xs disabled:opacity-30"
                          onClick={() => move(activeTab, row, 'down')}
                          disabled={busy || index === currentRows.length - 1}
                        >
                          Bajar
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        className="rounded border px-3 py-1.5 text-xs disabled:opacity-50"
                        onClick={() => handleSave(activeTab, row)}
                        disabled={busy}
                      >
                        Guardar
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!currentRows.length && (
                <tr>
                  <td
                    colSpan={activeTab === 'subcategories' ? 6 : 5}
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    No hay resultados para esta búsqueda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
