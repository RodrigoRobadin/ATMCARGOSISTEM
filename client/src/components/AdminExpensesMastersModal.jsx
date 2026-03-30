import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

function normalizeOrd(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export default function AdminExpensesMastersModal({ open, onClose, meta, onRefresh }) {
  const [newCategory, setNewCategory] = useState('');
  const [newSubcategory, setNewSubcategory] = useState('');
  const [newSubcategoryCategoryId, setNewSubcategoryCategoryId] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [newCostCenter, setNewCostCenter] = useState('');
  const [newProvider, setNewProvider] = useState('');
  const [newProviderRuc, setNewProviderRuc] = useState('');
  const [categoryEdits, setCategoryEdits] = useState({});
  const [subcategoryEdits, setSubcategoryEdits] = useState({});
  const [categoriesState, setCategoriesState] = useState([]);
  const [subcategoriesState, setSubcategoriesState] = useState([]);
  const [dragInfo, setDragInfo] = useState(null);

  useEffect(() => {
    if (!open) return;
    const cats = [...(meta.categories || [])].sort(
      (a, b) => (a.ord ?? 0) - (b.ord ?? 0) || a.name.localeCompare(b.name)
    );
    const subs = [...(meta.subcategories || [])].sort(
      (a, b) => (a.ord ?? 0) - (b.ord ?? 0) || a.name.localeCompare(b.name)
    );
    setCategoriesState(cats);
    setSubcategoriesState(subs);
  }, [open, meta.categories, meta.subcategories]);

  const categoriesSorted = useMemo(() => categoriesState, [categoriesState]);
  const subcategoriesSorted = useMemo(() => subcategoriesState, [subcategoriesState]);

  const visibleSubcategories = subcategoriesSorted.filter((s) =>
    selectedCategoryId ? String(s.category_id) === String(selectedCategoryId) : true
  );

  async function persistCategoryOrder(list) {
    await Promise.all(
      list.map((cat) =>
        api.patch(`/admin-expenses/categories/${cat.id}`, { ord: cat.ord ?? 0 })
      )
    );
    await onRefresh();
  }

  async function persistSubcategoryOrder(list) {
    await Promise.all(
      list.map((sub) =>
        api.patch(`/admin-expenses/subcategories/${sub.id}`, { ord: sub.ord ?? 0 })
      )
    );
    await onRefresh();
  }

  async function handleCreateCategory() {
    const name = newCategory.trim();
    if (!name) return;
    await api.post('/admin-expenses/categories', { name });
    setNewCategory('');
    await onRefresh();
  }

  async function handleCreateSubcategory() {
    const name = newSubcategory.trim();
    const categoryId = newSubcategoryCategoryId;
    if (!name || !categoryId) return;
    await api.post('/admin-expenses/subcategories', { name, category_id: categoryId });
    setNewSubcategory('');
    await onRefresh();
  }

  async function handleCreateCostCenter() {
    const name = newCostCenter.trim();
    if (!name) return;
    await api.post('/admin-expenses/cost-centers', { name });
    setNewCostCenter('');
    await onRefresh();
  }

  async function handleCreateProvider() {
    const name = newProvider.trim();
    if (!name) return;
    await api.post('/admin-expenses/providers', { name, ruc: newProviderRuc.trim() || null });
    setNewProvider('');
    setNewProviderRuc('');
    await onRefresh();
  }

  async function handleUpdateCategory(id) {
    const patch = categoryEdits[id];
    if (!patch) return;
    await api.patch(`/admin-expenses/categories/${id}`, {
      name: patch.name,
      ord: Number(patch.ord || 0),
      active: patch.active ? 1 : 0,
    });
    setCategoryEdits((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    await onRefresh();
  }

  async function handleUpdateSubcategory(id) {
    const patch = subcategoryEdits[id];
    if (!patch) return;
    await api.patch(`/admin-expenses/subcategories/${id}`, {
      name: patch.name,
      ord: Number(patch.ord || 0),
      active: patch.active ? 1 : 0,
      category_id: patch.category_id || null,
    });
    setSubcategoryEdits((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    await onRefresh();
  }

  async function moveCategory(id, direction) {
    const list = categoriesSorted;
    const index = list.findIndex((c) => c.id === id);
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= list.length) return;
    const current = list[index];
    const other = list[targetIndex];
    const currOrd = normalizeOrd(current.ord, index);
    const otherOrd = normalizeOrd(other.ord, targetIndex);
    await api.patch(`/admin-expenses/categories/${current.id}`, { ord: otherOrd });
    await api.patch(`/admin-expenses/categories/${other.id}`, { ord: currOrd });
    await onRefresh();
  }

  async function moveSubcategory(id, direction) {
    const list = visibleSubcategories;
    const index = list.findIndex((s) => s.id === id);
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= list.length) return;
    const current = list[index];
    const other = list[targetIndex];
    const currOrd = normalizeOrd(current.ord, index);
    const otherOrd = normalizeOrd(other.ord, targetIndex);
    await api.patch(`/admin-expenses/subcategories/${current.id}`, { ord: otherOrd });
    await api.patch(`/admin-expenses/subcategories/${other.id}`, { ord: currOrd });
    await onRefresh();
  }

  function reorderList(list, fromIndex, toIndex) {
    const next = [...list];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return next.map((item, idx) => ({ ...item, ord: idx }));
  }

  async function handleCategoryDrop(targetIndex) {
    if (!dragInfo || dragInfo.type !== 'category') return;
    const fromIndex = dragInfo.index;
    if (fromIndex === targetIndex) return;
    const next = reorderList(categoriesSorted, fromIndex, targetIndex);
    setCategoriesState(next);
    setDragInfo(null);
    await persistCategoryOrder(next);
  }

  async function handleSubcategoryDrop(targetIndex) {
    if (!dragInfo || dragInfo.type !== 'subcategory') return;
    const fromIndex = dragInfo.index;
    if (fromIndex === targetIndex) return;
    const nextVisible = reorderList(visibleSubcategories, fromIndex, targetIndex);
    const nextAll = subcategoriesSorted.map((s) => {
      const updated = nextVisible.find((v) => v.id === s.id);
      return updated ? updated : s;
    });
    setSubcategoriesState(nextAll);
    setDragInfo(null);
    await persistSubcategoryOrder(nextVisible);
  }

  function isDragging(type, index) {
    return dragInfo && dragInfo.type === type && dragInfo.index === index;
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-7xl p-4 space-y-4 max-h-[92vh] overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Maestros (categorias y subcategorias)</div>
          <button className="text-sm border rounded px-2 py-1" type="button" onClick={onClose}>
            Cerrar
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-slate-500">Nueva categoria</label>
            <div className="mt-1 flex gap-2">
              <input
                className="w-full border rounded px-2 py-1 text-sm"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
              />
              <button className="text-sm border rounded px-2" onClick={handleCreateCategory}>
                Agregar
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500">Nueva subcategoria</label>
            <div className="mt-1 flex flex-col gap-2">
              <select
                className="w-full border rounded px-2 py-1 text-sm"
                value={newSubcategoryCategoryId}
                onChange={(e) => setNewSubcategoryCategoryId(e.target.value)}
              >
                <option value="">Categoria</option>
                {categoriesSorted.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <input
                  className="w-full border rounded px-2 py-1 text-sm"
                  value={newSubcategory}
                  onChange={(e) => setNewSubcategory(e.target.value)}
                />
                <button className="text-sm border rounded px-2" onClick={handleCreateSubcategory}>
                  Agregar
                </button>
              </div>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500">Nuevo centro de costo</label>
            <div className="mt-1 flex gap-2">
              <input
                className="w-full border rounded px-2 py-1 text-sm"
                value={newCostCenter}
                onChange={(e) => setNewCostCenter(e.target.value)}
              />
              <button className="text-sm border rounded px-2" onClick={handleCreateCostCenter}>
                Agregar
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500">Nuevo proveedor</label>
            <div className="mt-1 flex flex-col gap-2">
              <input
                className="w-full border rounded px-2 py-1 text-sm"
                placeholder="Nombre"
                value={newProvider}
                onChange={(e) => setNewProvider(e.target.value)}
              />
              <div className="flex gap-2">
                <input
                  className="w-full border rounded px-2 py-1 text-sm"
                  placeholder="RUC"
                  value={newProviderRuc}
                  onChange={(e) => setNewProviderRuc(e.target.value)}
                />
                <button className="text-sm border rounded px-2" onClick={handleCreateProvider}>
                  Agregar
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 overflow-auto">
          <div className="space-y-2">
            <div className="text-sm font-semibold">Editar categorias</div>
            <div className="overflow-auto border rounded max-h-[52vh]">
              <table className="min-w-full text-sm table-auto">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th className="text-left px-3 py-2 w-[40%] min-w-[240px]">Nombre</th>
                    <th className="text-left px-3 py-2">Orden</th>
                    <th className="text-left px-3 py-2">Activa</th>
                    <th className="text-left px-3 py-2">Mover</th>
                    <th className="text-left px-3 py-2">Accion</th>
                  </tr>
                </thead>
                <tbody>
                  {categoriesSorted.map((cat, index) => {
                    const edit = categoryEdits[cat.id] || cat;
                    return (
                      <tr
                        key={cat.id}
                        className={`border-t ${isDragging('category', index) ? 'bg-slate-50' : ''}`}
                        draggable
                        onDragStart={() => setDragInfo({ type: 'category', index })}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => handleCategoryDrop(index)}
                      >
                        <td className="px-3 py-2 w-[40%] min-w-[240px]">
                          <input
                            className="w-full border rounded px-2 py-1 text-sm"
                            value={edit.name || ''}
                            onChange={(e) =>
                              setCategoryEdits((prev) => ({
                                ...prev,
                                [cat.id]: { ...edit, name: e.target.value },
                              }))
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            className="w-20 border rounded px-2 py-1 text-sm"
                            value={edit.ord ?? 0}
                            onChange={(e) =>
                              setCategoryEdits((prev) => ({
                                ...prev,
                                [cat.id]: { ...edit, ord: e.target.value },
                              }))
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={Boolean(edit.active)}
                            onChange={(e) =>
                              setCategoryEdits((prev) => ({
                                ...prev,
                                [cat.id]: { ...edit, active: e.target.checked ? 1 : 0 },
                              }))
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            <button
                              className="text-xs border rounded px-2 py-1"
                              type="button"
                              onClick={() => moveCategory(cat.id, 'up')}
                            >
                              Subir
                            </button>
                            <button
                              className="text-xs border rounded px-2 py-1"
                              type="button"
                              onClick={() => moveCategory(cat.id, 'down')}
                            >
                              Bajar
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <button
                            className="text-xs border rounded px-2 py-1"
                            type="button"
                            onClick={() => handleUpdateCategory(cat.id)}
                          >
                            Guardar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!categoriesSorted.length && (
                    <tr>
                      <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                        Sin categorias cargadas.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold">Editar subcategorias</div>
            <div>
              <label className="text-xs text-slate-500">Categoria</label>
              <select
                className="mt-1 w-full border rounded px-2 py-1 text-sm"
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
              >
                <option value="">Todas</option>
                {categoriesSorted.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="overflow-auto border rounded max-h-[52vh]">
              <table className="min-w-full text-sm table-auto">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th className="text-left px-3 py-2 w-[35%] min-w-[220px]">Nombre</th>
                    <th className="text-left px-3 py-2 w-[25%] min-w-[160px]">Categoria</th>
                    <th className="text-left px-3 py-2">Orden</th>
                    <th className="text-left px-3 py-2">Activa</th>
                    <th className="text-left px-3 py-2">Mover</th>
                    <th className="text-left px-3 py-2">Accion</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSubcategories.map((sub, index) => {
                    const edit = subcategoryEdits[sub.id] || sub;
                    return (
                      <tr
                        key={sub.id}
                        className={`border-t ${isDragging('subcategory', index) ? 'bg-slate-50' : ''}`}
                        draggable
                        onDragStart={() => setDragInfo({ type: 'subcategory', index })}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => handleSubcategoryDrop(index)}
                      >
                        <td className="px-3 py-2 w-[35%] min-w-[220px]">
                          <input
                            className="w-full border rounded px-2 py-1 text-sm"
                            value={edit.name || ''}
                            onChange={(e) =>
                              setSubcategoryEdits((prev) => ({
                                ...prev,
                                [sub.id]: { ...edit, name: e.target.value },
                              }))
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            className="border rounded px-2 py-1 text-sm"
                            value={edit.category_id || ''}
                            onChange={(e) =>
                              setSubcategoryEdits((prev) => ({
                                ...prev,
                                [sub.id]: { ...edit, category_id: e.target.value },
                              }))
                            }
                          >
                            <option value="">Seleccionar</option>
                            {categoriesSorted.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            className="w-20 border rounded px-2 py-1 text-sm"
                            value={edit.ord ?? 0}
                            onChange={(e) =>
                              setSubcategoryEdits((prev) => ({
                                ...prev,
                                [sub.id]: { ...edit, ord: e.target.value },
                              }))
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={Boolean(edit.active)}
                            onChange={(e) =>
                              setSubcategoryEdits((prev) => ({
                                ...prev,
                                [sub.id]: { ...edit, active: e.target.checked ? 1 : 0 },
                              }))
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            <button
                              className="text-xs border rounded px-2 py-1"
                              type="button"
                              onClick={() => moveSubcategory(sub.id, 'up')}
                            >
                              Subir
                            </button>
                            <button
                              className="text-xs border rounded px-2 py-1"
                              type="button"
                              onClick={() => moveSubcategory(sub.id, 'down')}
                            >
                              Bajar
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <button
                            className="text-xs border rounded px-2 py-1"
                            type="button"
                            onClick={() => handleUpdateSubcategory(sub.id)}
                          >
                            Guardar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!visibleSubcategories.length && (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                        Sin subcategorias cargadas.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
