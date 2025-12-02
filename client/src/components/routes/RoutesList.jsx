// client/src/components/routes/RoutesList.jsx
import React, { useState, useEffect } from 'react';
import { api } from '../../api';
import RouteForm from './RouteForm';
import RouteDetail from './RouteDetail';

export default function RoutesList({ onSelectRoute }) {
    const [routes, setRoutes] = useState([]);
    const [zones, setZones] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterZone, setFilterZone] = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [selectedRouteId, setSelectedRouteId] = useState(null);
    useEffect(() => {
        loadData();
    }, [filterZone, filterStatus]);

    async function loadData() {
        setLoading(true);
        try {
            const params = {};
            if (filterZone) params.zone_id = filterZone;
            if (filterStatus) params.status = filterStatus;

            const [routesRes, zonesRes] = await Promise.all([
                api.get('/routes', { params }),
                api.get('/zones')
            ]);

            setRoutes(routesRes.data || []);
            setZones(zonesRes.data || []);
        } catch (err) {
            console.error('Error loading routes:', err);
            alert('Error al cargar recorridos');
        } finally {
            setLoading(false);
        }
    }

    function getStatusBadge(status) {
        const styles = {
            planificado: 'bg-blue-100 text-blue-700',
            en_curso: 'bg-yellow-100 text-yellow-700',
            completado: 'bg-green-100 text-green-700',
            cancelado: 'bg-gray-100 text-gray-700',
        };

        const labels = {
            planificado: 'Planificado',
            en_curso: 'En Curso',
            completado: 'Completado',
            cancelado: 'Cancelado',
        };

        return (
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || styles.planificado}`}>
                {labels[status] || status}
            </span>
        );
    }

    function formatDate(dateStr) {
        if (!dateStr) return '—';
        return new Date(dateStr).toLocaleDateString('es-PY');
    }

    if (loading) {
        return (
            <div className="flex justify-center items-center p-8">
                <div className="text-gray-500">Cargando recorridos...</div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header con filtros */}
            <div className="bg-white rounded-lg shadow p-4">
                <div className="flex flex-wrap gap-4 items-end">
                    <div className="flex-1 min-w-[200px]">
                        <h2 className="text-xl font-bold mb-2">🗺️ Mis Recorridos</h2>
                        <p className="text-sm text-gray-600">
                            Gestiona tus recorridos de visitas por zonas
                        </p>
                    </div>

                    {/* Filtro por zona */}
                    <div className="min-w-[150px]">
                        <label className="block text-xs text-gray-600 mb-1">Zona</label>
                        <select
                            className="w-full border rounded px-3 py-2 text-sm"
                            value={filterZone}
                            onChange={(e) => setFilterZone(e.target.value)}
                        >
                            <option value="">Todas las zonas</option>
                            {zones.map(zone => (
                                <option key={zone.id} value={zone.id}>
                                    {zone.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Filtro por estado */}
                    <div className="min-w-[150px]">
                        <label className="block text-xs text-gray-600 mb-1">Estado</label>
                        <select
                            className="w-full border rounded px-3 py-2 text-sm"
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                        >
                            <option value="">Todos</option>
                            <option value="planificado">Planificado</option>
                            <option value="en_curso">En Curso</option>
                            <option value="completado">Completado</option>
                            <option value="cancelado">Cancelado</option>
                        </select>
                    </div>

                    {/* Botón nuevo recorrido */}
                    <button
                        className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors text-sm font-medium"
                        onClick={() => setShowForm(true)}
                    >
                        + Nuevo Recorrido
                    </button>
                </div>
            </div>

            {/* Lista de recorridos */}
            {routes.length === 0 ? (
                <div className="bg-white rounded-lg shadow p-8 text-center">
                    <div className="text-gray-400 text-4xl mb-2">🗺️</div>
                    <p className="text-gray-600">No hay recorridos para mostrar</p>
                    <p className="text-sm text-gray-500 mt-1">
                        Crea tu primer recorrido para empezar a planificar visitas
                    </p>
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {routes.map(route => (
                        <div
                            key={route.id}
                            className="bg-white rounded-lg shadow hover:shadow-md transition-shadow cursor-pointer"
                            onClick={() => setSelectedRouteId(route.id)}
                        >
                            <div className="p-4">
                                {/* Header con zona */}
                                <div className="flex items-start justify-between mb-2">
                                    <div className="flex-1">
                                        <h3 className="font-bold text-lg mb-1">{route.name}</h3>
                                        <div className="flex items-center gap-2 text-sm">
                                            <span
                                                className="inline-block w-3 h-3 rounded-full"
                                                style={{ backgroundColor: route.zone_color || '#3B82F6' }}
                                            />
                                            <span className="text-gray-600">{route.zone_name}</span>
                                        </div>
                                    </div>
                                    {getStatusBadge(route.status)}
                                </div>

                                {/* Información del recorrido */}
                                <div className="space-y-2 mt-3 text-sm">
                                    <div className="flex items-center gap-2 text-gray-600">
                                        <span>👤</span>
                                        <span>{route.user_name || 'Sin asignar'}</span>
                                    </div>

                                    <div className="flex items-center gap-2 text-gray-600">
                                        <span>📅</span>
                                        <span>
                                            {formatDate(route.start_date)} - {formatDate(route.end_date)}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-2 text-gray-600">
                                        <span>📍</span>
                                        <span>
                                            {route.stops_count || 0} paradas
                                            {route.completed_stops > 0 && (
                                                <span className="ml-1 text-green-600">
                                                    ({route.completed_stops} completadas)
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                </div>

                                {/* Notas (si existen) */}
                                {route.notes && (
                                    <div className="mt-3 pt-3 border-t">
                                        <p className="text-xs text-gray-500 line-clamp-2">
                                            {route.notes}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modal de formulario */}
            {showForm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="max-w-2xl w-full">
                        <RouteForm
                            onSuccess={() => {
                                setShowForm(false);
                                loadData();
                            }}
                            onCancel={() => setShowForm(false)}
                        />
                    </div>
                </div>
            )}

            {/* Modal de detalle */}
            {selectedRouteId && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
                    <div className="w-full max-w-4xl my-8">
                        <RouteDetail
                            routeId={selectedRouteId}
                            onClose={() => setSelectedRouteId(null)}
                            onUpdate={() => loadData()}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
