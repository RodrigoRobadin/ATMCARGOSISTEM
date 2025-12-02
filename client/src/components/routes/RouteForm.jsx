// client/src/components/routes/RouteForm.jsx
import React, { useState, useEffect } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';

export default function RouteForm({ onSuccess, onCancel, editRoute = null }) {
    const { user } = useAuth();
    const [zones, setZones] = useState([]);
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(false);

    const [formData, setFormData] = useState({
        name: '',
        zone_id: '',
        user_id: '',
        start_date: '',
        end_date: '',
        notes: '',
    });

    const [errors, setErrors] = useState({});

    useEffect(() => {
        loadInitialData();
    }, []);

    useEffect(() => {
        if (editRoute) {
            setFormData({
                name: editRoute.name || '',
                zone_id: editRoute.zone_id || '',
                user_id: editRoute.user_id || '',
                start_date: editRoute.start_date || '',
                end_date: editRoute.end_date || '',
                notes: editRoute.notes || '',
            });
        }
    }, [editRoute]);

    async function loadInitialData() {
        try {
            const [zonesRes, usersRes] = await Promise.all([
                api.get('/zones'),
                api.get('/users').catch(() => ({ data: [] })),
            ]);

            setZones(zonesRes.data || []);
            setUsers(usersRes.data || []);
        } catch (err) {
            console.error('Error loading initial data:', err);
            alert('Error al cargar datos iniciales');
        }
    }

    function handleChange(field, value) {
        setFormData(prev => ({ ...prev, [field]: value }));
        // Limpiar error del campo cuando el usuario empieza a escribir
        if (errors[field]) {
            setErrors(prev => ({ ...prev, [field]: null }));
        }
    }

    function validateForm() {
        const newErrors = {};

        if (!formData.name.trim()) {
            newErrors.name = 'El nombre es requerido';
        }

        if (!formData.zone_id) {
            newErrors.zone_id = 'Debe seleccionar una zona';
        }

        if (!formData.start_date) {
            newErrors.start_date = 'La fecha de inicio es requerida';
        }

        if (!formData.end_date) {
            newErrors.end_date = 'La fecha de fin es requerida';
        }

        if (formData.start_date && formData.end_date) {
            if (new Date(formData.end_date) < new Date(formData.start_date)) {
                newErrors.end_date = 'La fecha de fin debe ser posterior a la de inicio';
            }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    }

    async function handleSubmit(e) {
        e.preventDefault();

        if (!validateForm()) {
            return;
        }

        setLoading(true);

        try {
            const payload = {
                name: formData.name.trim(),
                zone_id: parseInt(formData.zone_id),
                start_date: formData.start_date,
                end_date: formData.end_date,
                notes: formData.notes.trim() || null,
            };

            // Solo admin puede asignar a otro usuario
            const isAdmin = (user?.role || '').toLowerCase() === 'admin';
            if (isAdmin && formData.user_id) {
                payload.user_id = parseInt(formData.user_id);
            }

            if (editRoute) {
                await api.put(`/routes/${editRoute.id}`, payload);
                alert('Recorrido actualizado correctamente');
            } else {
                await api.post('/routes', payload);
                alert('Recorrido creado correctamente');
            }

            if (onSuccess) {
                onSuccess();
            }
        } catch (err) {
            console.error('Error saving route:', err);
            alert(err.response?.data?.error || 'Error al guardar recorrido');
        } finally {
            setLoading(false);
        }
    }

    const selectedZone = zones.find(z => z.id === parseInt(formData.zone_id));

    return (
        <div className="bg-white rounded-lg shadow-lg p-6 max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold">
                    {editRoute ? 'Editar Recorrido' : 'Nuevo Recorrido'}
                </h2>
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="text-gray-500 hover:text-gray-700"
                    >
                        ✕
                    </button>
                )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                {/* Nombre del recorrido */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Nombre del Recorrido *
                    </label>
                    <input
                        type="text"
                        className={`w-full border rounded-lg px-3 py-2 ${errors.name ? 'border-red-500' : 'border-gray-300'
                            }`}
                        placeholder="Ej: Recorrido Zona Este - Enero 2025"
                        value={formData.name}
                        onChange={(e) => handleChange('name', e.target.value)}
                        disabled={loading}
                    />
                    {errors.name && (
                        <p className="text-red-500 text-xs mt-1">{errors.name}</p>
                    )}
                </div>

                {/* Zona */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Zona *
                    </label>
                    <select
                        className={`w-full border rounded-lg px-3 py-2 ${errors.zone_id ? 'border-red-500' : 'border-gray-300'
                            }`}
                        value={formData.zone_id}
                        onChange={(e) => handleChange('zone_id', e.target.value)}
                        disabled={loading}
                    >
                        <option value="">Seleccionar zona...</option>
                        {zones.map(zone => (
                            <option key={zone.id} value={zone.id}>
                                {zone.name}
                            </option>
                        ))}
                    </select>
                    {errors.zone_id && (
                        <p className="text-red-500 text-xs mt-1">{errors.zone_id}</p>
                    )}
                    {selectedZone && (
                        <div className="mt-2 flex items-center gap-2 text-sm text-gray-600">
                            <span
                                className="inline-block w-4 h-4 rounded-full"
                                style={{ backgroundColor: selectedZone.color }}
                            />
                            <span>
                                Departamentos: {selectedZone.departments?.join(', ') || 'N/A'}
                            </span>
                        </div>
                    )}
                </div>

                {/* Ejecutivo (solo admin) */}
                {(user?.role || '').toLowerCase() === 'admin' && users.length > 0 && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Asignar a Ejecutivo
                        </label>
                        <select
                            className="w-full border border-gray-300 rounded-lg px-3 py-2"
                            value={formData.user_id}
                            onChange={(e) => handleChange('user_id', e.target.value)}
                            disabled={loading}
                        >
                            <option value="">Mi usuario (por defecto)</option>
                            {users.map(user => (
                                <option key={user.id} value={user.id}>
                                    {user.name || user.email}
                                </option>
                            ))}
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                            Si no seleccionas, se asignará a tu usuario
                        </p>
                    </div>
                )}

                {/* Fechas */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Fecha de Inicio *
                        </label>
                        <input
                            type="date"
                            className={`w-full border rounded-lg px-3 py-2 ${errors.start_date ? 'border-red-500' : 'border-gray-300'
                                }`}
                            value={formData.start_date}
                            onChange={(e) => handleChange('start_date', e.target.value)}
                            disabled={loading}
                        />
                        {errors.start_date && (
                            <p className="text-red-500 text-xs mt-1">{errors.start_date}</p>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Fecha de Fin *
                        </label>
                        <input
                            type="date"
                            className={`w-full border rounded-lg px-3 py-2 ${errors.end_date ? 'border-red-500' : 'border-gray-300'
                                }`}
                            value={formData.end_date}
                            onChange={(e) => handleChange('end_date', e.target.value)}
                            disabled={loading}
                            min={formData.start_date}
                        />
                        {errors.end_date && (
                            <p className="text-red-500 text-xs mt-1">{errors.end_date}</p>
                        )}
                    </div>
                </div>

                {/* Notas */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Notas
                    </label>
                    <textarea
                        rows={3}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2"
                        placeholder="Observaciones, objetivos del recorrido, etc."
                        value={formData.notes}
                        onChange={(e) => handleChange('notes', e.target.value)}
                        disabled={loading}
                    />
                </div>

                {/* Botones */}
                <div className="flex gap-3 pt-4">
                    <button
                        type="submit"
                        className="flex-1 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                        disabled={loading}
                    >
                        {loading ? 'Guardando...' : editRoute ? 'Actualizar Recorrido' : 'Crear Recorrido'}
                    </button>
                    {onCancel && (
                        <button
                            type="button"
                            onClick={onCancel}
                            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                            disabled={loading}
                        >
                            Cancelar
                        </button>
                    )}
                </div>

                <p className="text-xs text-gray-500 text-center">
                    * Campos requeridos
                </p>
            </form>
        </div>
    );
}
