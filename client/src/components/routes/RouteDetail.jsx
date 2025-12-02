// client/src/components/routes/RouteDetail.jsx
import React, { useState, useEffect } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import RouteForm from './RouteForm';
import RouteMap from './RouteMap';

export default function RouteDetail({ routeId, onClose, onUpdate }) {
    const { user } = useAuth();
    const [route, setRoute] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showEditForm, setShowEditForm] = useState(false);
    const [organizations, setOrganizations] = useState([]);
    const [selectedOrg, setSelectedOrg] = useState('');
    const [addingStop, setAddingStop] = useState(false);

    useEffect(() => {
        loadRouteDetail();
    }, [routeId]);

    async function loadRouteDetail() {
        setLoading(true);
        try {
            const [routeRes, orgsRes] = await Promise.all([
                api.get(`/routes/${routeId}`),
                api.get('/organizations')
            ]);

            setRoute(routeRes.data);
            setOrganizations(orgsRes.data || []);
        } catch (err) {
            console.error('Error loading route detail:', err);
            alert('Error al cargar el recorrido');
        } finally {
            setLoading(false);
        }
    }

    async function handleAddStop() {
        if (!selectedOrg) {
            alert('Selecciona una organización');
            return;
        }

        setAddingStop(true);
        try {
            await api.post(`/routes/${routeId}/stops`, {
                organization_id: parseInt(selectedOrg),
                stop_order: (route.stops?.length || 0) + 1,
            });

            setSelectedOrg('');
            await loadRouteDetail();
            alert('Parada agregada correctamente');
        } catch (err) {
            console.error('Error adding stop:', err);
            alert(err.response?.data?.error || 'Error al agregar parada');
        } finally {
            setAddingStop(false);
        }
    }

    async function handleDeleteStop(stopId) {
        if (!confirm('¿Estás seguro de eliminar esta parada?')) {
            return;
        }

        try {
            await api.delete(`/routes/${routeId}/stops/${stopId}`);
            await loadRouteDetail();
            alert('Parada eliminada correctamente');
        } catch (err) {
            console.error('Error deleting stop:', err);
            alert(err.response?.data?.error || 'Error al eliminar parada');
        }
    }

    async function handleMoveStop(stopId, direction) {
        const stop = route.stops.find(s => s.id === stopId);
        if (!stop) return;

        const newOrder = direction === 'up' ? stop.stop_order - 1 : stop.stop_order + 1;

        if (newOrder < 1 || newOrder > route.stops.length) {
            return;
        }

        try {
            await api.patch(`/routes/${routeId}/stops/${stopId}/order`, { new_order: newOrder });
            await loadRouteDetail();
        } catch (err) {
            console.error('Error reordering stop:', err);
            alert('Error al reordenar parada');
        }
    }

    async function handleChangeStatus(newStatus) {
        try {
            await api.patch(`/routes/${routeId}/status`, { status: newStatus });
            await loadRouteDetail();
            if (onUpdate) onUpdate();
            alert('Estado actualizado correctamente');
        } catch (err) {
            console.error('Error changing status:', err);
            alert('Error al cambiar estado');
        }
    }

    async function handleDeleteRoute() {
        if (!confirm('¿Estás seguro de eliminar este recorrido? Esta acción no se puede deshacer.')) {
            return;
        }

        try {
            await api.delete(`/routes/${routeId}`);
            alert('Recorrido eliminado correctamente');
            if (onUpdate) onUpdate();
            if (onClose) onClose();
        } catch (err) {
            console.error('Error deleting route:', err);
            alert('Error al eliminar recorrido');
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
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${styles[status] || styles.planificado}`}>
                {labels[status] || status}
            </span>
        );
    }

    function formatDate(dateStr) {
        if (!dateStr) return '—';
        return new Date(dateStr).toLocaleDateString('es-PY');
    }

    const isAdmin = (user?.role || '').toLowerCase() === 'admin';
    const isOwner = route && Number(user?.id) === Number(route.user_id);
    const canEdit = isAdmin || isOwner;

    // Filtrar organizaciones de la misma zona
    const availableOrgs = organizations.filter(org =>
        org.zone_id === route?.zone_id &&
        !route?.stops?.some(stop => stop.organization_id === org.id)
    );

    if (loading) {
        return (
            <div className="flex justify-center items-center p-8">
                <div className="text-gray-500">Cargando recorrido...</div>
            </div>
        );
    }

    if (!route) {
        return (
            <div className="text-center p-8">
                <p className="text-gray-600">Recorrido no encontrado</p>
            </div>
        );
    }

    if (showEditForm) {
        return (
            <RouteForm
                editRoute={route}
                onSuccess={() => {
                    setShowEditForm(false);
                    loadRouteDetail();
                    if (onUpdate) onUpdate();
                }}
                onCancel={() => setShowEditForm(false)}
            />
        );
    }

    return (
        <div className="bg-white rounded-lg shadow-lg max-w-4xl mx-auto">
            {/* Header */}
            <div className="p-6 border-b">
                <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                        <h2 className="text-2xl font-bold mb-2">{route.name}</h2>
                        <div className="flex items-center gap-4 text-sm text-gray-600">
                            <div className="flex items-center gap-2">
                                <span
                                    className="inline-block w-4 h-4 rounded-full"
                                    style={{ backgroundColor: route.zone_color || '#3B82F6' }}
                                />
                                <span>{route.zone_name}</span>
                            </div>
                            <div>👤 {route.user_name}</div>
                            <div>📅 {formatDate(route.start_date)} - {formatDate(route.end_date)}</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {getStatusBadge(route.status)}
                        {onClose && (
                            <button
                                onClick={onClose}
                                className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
                            >
                                ✕
                            </button>
                        )}
                    </div>
                </div>

                {route.notes && (
                    <div className="mt-4 p-3 bg-gray-50 rounded">
                        <p className="text-sm text-gray-700">{route.notes}</p>
                    </div>
                )}
            </div>

            {/* Actions */}
            {canEdit && (
                <div className="p-4 border-b bg-gray-50 flex flex-wrap gap-2">
                    <button
                        onClick={() => setShowEditForm(true)}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                    >
                        ✏️ Editar
                    </button>

                    {route.status === 'planificado' && (
                        <button
                            onClick={() => handleChangeStatus('en_curso')}
                            className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 text-sm"
                        >
                            ▶️ Iniciar
                        </button>
                    )}

                    {route.status === 'en_curso' && (
                        <button
                            onClick={() => handleChangeStatus('completado')}
                            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
                        >
                            ✓ Completar
                        </button>
                    )}

                    {route.status !== 'cancelado' && (
                        <button
                            onClick={() => handleChangeStatus('cancelado')}
                            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm"
                        >
                            ✕ Cancelar
                        </button>
                    )}

                    <button
                        onClick={handleDeleteRoute}
                        className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm ml-auto"
                    >
                        🗑️ Eliminar Recorrido
                    </button>
                </div>
            )}

            {/* Stops Section */}
            <div className="p-6">
                <h3 className="text-xl font-bold mb-4">
                    📍 Paradas ({route.stops?.length || 0})
                </h3>

                {/* Add Stop */}
                {canEdit && route.status !== 'completado' && route.status !== 'cancelado' && (
                    <div className="mb-6 p-4 bg-green-50 rounded-lg">
                        <h4 className="font-semibold mb-2">Agregar Parada</h4>
                        <div className="flex gap-2">
                            <select
                                className="flex-1 border rounded px-3 py-2"
                                value={selectedOrg}
                                onChange={(e) => setSelectedOrg(e.target.value)}
                                disabled={addingStop}
                            >
                                <option value="">Seleccionar organización...</option>
                                {availableOrgs.map(org => (
                                    <option key={org.id} value={org.id}>
                                        {org.name} - {org.city || 'Sin ciudad'}
                                    </option>
                                ))}
                            </select>
                            <button
                                onClick={handleAddStop}
                                disabled={!selectedOrg || addingStop}
                                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
                            >
                                {addingStop ? 'Agregando...' : '+ Agregar'}
                            </button>
                        </div>
                        {availableOrgs.length === 0 && (
                            <p className="text-sm text-gray-500 mt-2">
                                No hay más organizaciones disponibles en esta zona
                            </p>
                        )}
                    </div>
                )}

                {/* Stops List */}
                {route.stops && route.stops.length > 0 ? (
                    <div className="space-y-2">
                        {route.stops.map((stop, index) => (
                            <div
                                key={stop.id}
                                className="flex items-center gap-3 p-4 border rounded hover:bg-gray-50"
                            >
                                <div className="flex flex-col gap-1">
                                    <button
                                        onClick={() => handleMoveStop(stop.id, 'up')}
                                        disabled={index === 0 || !canEdit}
                                        className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                                    >
                                        ▲
                                    </button>
                                    <button
                                        onClick={() => handleMoveStop(stop.id, 'down')}
                                        disabled={index === route.stops.length - 1 || !canEdit}
                                        className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                                    >
                                        ▼
                                    </button>
                                </div>

                                <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">
                                    {stop.stop_order}
                                </div>

                                <div className="flex-1">
                                    <div className="font-semibold">{stop.organization_name}</div>
                                    <div className="text-sm text-gray-600">
                                        {stop.city && `${stop.city}, `}
                                        {stop.department || 'Sin ubicación'}
                                    </div>
                                    {stop.notes && (
                                        <div className="text-xs text-gray-500 mt-1">{stop.notes}</div>
                                    )}
                                </div>

                                <div className="text-sm">
                                    <span className={`px-2 py-1 rounded text-xs ${stop.status === 'completada' ? 'bg-green-100 text-green-700' :
                                        stop.status === 'cancelada' ? 'bg-gray-100 text-gray-700' :
                                            'bg-blue-100 text-blue-700'
                                        }`}>
                                        {stop.status === 'completada' ? '✓ Completada' :
                                            stop.status === 'cancelada' ? '✕ Cancelada' :
                                                'Pendiente'}
                                    </span>
                                </div>

                                {canEdit && route.status !== 'completado' && (
                                    <button
                                        onClick={() => handleDeleteStop(stop.id)}
                                        className="text-red-600 hover:text-red-800 px-2"
                                    >
                                        🗑️
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center p-8 bg-gray-50 rounded">
                        <div className="text-gray-400 text-4xl mb-2">📍</div>
                        <p className="text-gray-600">No hay paradas en este recorrido</p>
                        <p className="text-sm text-gray-500 mt-1">
                            Agrega organizaciones para planificar tu recorrido
                        </p>
                    </div>
                )}

                {/* Mapa de Recorrido */}
                {route.stops && route.stops.length > 0 && (
                    <div className="mt-6">
                        <h4 className="text-lg font-bold mb-3">🗺️ Mapa del Recorrido</h4>
                        <RouteMap
                            stops={route.stops}
                            zoneColor={route.zone_color || '#3B82F6'}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
