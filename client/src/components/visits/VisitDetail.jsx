// client/src/components/visits/VisitDetail.jsx
import React, { useState, useEffect } from "react";
import { api } from "../../api";
import VisitCompletionForm from "./VisitCompletionForm";

export default function VisitDetail({ visitId, onClose, onUpdate }) {
    const [visit, setVisit] = useState(null);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(false);
    const [showCompletionForm, setShowCompletionForm] = useState(false);
    const [form, setForm] = useState({});

    useEffect(() => {
        if (visitId) {
            loadVisit();
        }
    }, [visitId]);

    const loadVisit = async () => {
        setLoading(true);
        try {
            const res = await api.get(`/visits/${visitId}`);
            setVisit(res.data);
            setForm(res.data);
        } catch (err) {
            console.error(err);
            alert("No se pudo cargar la visita");
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            await api.patch(`/visits/${visitId}`, form);
            alert("Visita actualizada exitosamente");
            setEditing(false);
            if (onUpdate) onUpdate();
            loadVisit();
        } catch (err) {
            console.error(err);
            alert("No se pudo actualizar la visita");
        }
    };

    const handleStatusChange = async (newStatus) => {
        try {
            await api.patch(`/visits/${visitId}`, { status: newStatus });
            alert(`Estado cambiado a: ${getStatusLabel(newStatus)}`);
            if (onUpdate) onUpdate();
            loadVisit();
        } catch (err) {
            console.error(err);
            alert("No se pudo cambiar el estado");
        }
    };

    const getStatusLabel = (status) => {
        const labels = {
            scheduled: "Programada",
            confirmed: "Confirmada",
            completed: "Completada",
            cancelled: "Cancelada",
            rescheduled: "Reprogramada",
        };
        return labels[status] || status;
    };

    const getStatusBadge = (status) => {
        const badges = {
            scheduled: "bg-blue-100 text-blue-700",
            confirmed: "bg-green-100 text-green-700",
            completed: "bg-slate-100 text-slate-700",
            cancelled: "bg-red-100 text-red-700",
            rescheduled: "bg-amber-100 text-amber-700",
        };
        return (
            <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${badges[status] || badges.scheduled}`}>
                {getStatusLabel(status)}
            </span>
        );
    };

    const getOutcomeBadge = (outcome) => {
        if (!outcome) return <span className="text-slate-400">Sin resultado</span>;
        const badges = {
            successful: "bg-emerald-100 text-emerald-700",
            neutral: "bg-slate-100 text-slate-700",
            negative: "bg-rose-100 text-rose-700",
        };
        const labels = {
            successful: "Exitosa",
            neutral: "Neutral",
            negative: "Negativa",
        };
        return (
            <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${badges[outcome]}`}>
                {labels[outcome]}
            </span>
        );
    };

    if (loading) {
        return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <div className="bg-white rounded-2xl p-8">
                    <div className="text-center">Cargando...</div>
                </div>
            </div>
        );
    }

    if (!visit) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full my-8">
                {/* Header */}
                <div className="border-b p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-2xl font-bold">Detalle de Visita</h2>
                            <p className="text-sm text-slate-600 mt-1">
                                {visit.org_name || "Sin organización"}
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="text-slate-400 hover:text-slate-600 text-2xl"
                        >
                            ×
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                    {/* Estado y acciones rápidas */}
                    <div className="flex items-center justify-between bg-slate-50 rounded-lg p-4">
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-slate-600">Estado:</span>
                            {getStatusBadge(visit.status)}
                            {visit.outcome && (
                                <>
                                    <span className="text-slate-300">|</span>
                                    <span className="text-sm text-slate-600">Resultado:</span>
                                    {getOutcomeBadge(visit.outcome)}
                                </>
                            )}
                        </div>
                        <div className="flex gap-2">
                            {visit.status === "scheduled" && (
                                <button
                                    onClick={() => handleStatusChange("confirmed")}
                                    className="px-3 py-1.5 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700"
                                >
                                    Confirmar
                                </button>
                            )}
                            {(visit.status === "scheduled" || visit.status === "confirmed") && (
                                <button
                                    onClick={() => setShowCompletionForm(true)}
                                    className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                                >
                                    ✅ Completar visita
                                </button>
                            )}
                            {visit.status !== "cancelled" && (
                                <button
                                    onClick={() => handleStatusChange("cancelled")}
                                    className="px-3 py-1.5 text-sm rounded-lg border border-red-300 text-red-600 hover:bg-red-50"
                                >
                                    Cancelar
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Información de planificación */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="font-semibold text-lg">📅 Planificación</h3>
                            {!editing && (
                                <button
                                    onClick={() => setEditing(true)}
                                    className="px-3 py-1.5 text-sm rounded-lg border hover:bg-slate-50"
                                >
                                    ✏️ Editar
                                </button>
                            )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs text-slate-600">Fecha programada</label>
                                <div className="mt-1 font-medium">
                                    {visit.scheduled_at
                                        ? new Date(visit.scheduled_at).toLocaleString()
                                        : "—"}
                                </div>
                            </div>
                            <div>
                                <label className="text-xs text-slate-600">Duración estimada</label>
                                <div className="mt-1 font-medium">
                                    {visit.estimated_duration_min} minutos
                                </div>
                            </div>
                            <div className="md:col-span-2">
                                <label className="text-xs text-slate-600">Dirección</label>
                                <div className="mt-1 font-medium">{visit.address || "—"}</div>
                            </div>
                            <div>
                                <label className="text-xs text-slate-600">Objetivo</label>
                                <div className="mt-1 font-medium">{visit.objective || "—"}</div>
                            </div>
                            <div>
                                <label className="text-xs text-slate-600">Tiempo de viaje</label>
                                <div className="mt-1 font-medium">
                                    {visit.travel_time_min ? `${visit.travel_time_min} min` : "—"}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Contactos */}
                    {visit.contacts && visit.contacts.length > 0 && (
                        <div>
                            <h3 className="font-semibold text-lg mb-3">👥 Contactos</h3>
                            <div className="space-y-2">
                                {visit.contacts.map((contact) => (
                                    <div
                                        key={contact.id}
                                        className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg"
                                    >
                                        <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center font-medium">
                                            {contact.name?.charAt(0) || "?"}
                                        </div>
                                        <div>
                                            <div className="font-medium">{contact.name}</div>
                                            {contact.email && (
                                                <div className="text-sm text-slate-600">{contact.email}</div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Productos y materiales */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <h3 className="font-semibold text-lg mb-3">📦 Productos a presentar</h3>
                            <div className="p-3 bg-slate-50 rounded-lg text-sm">
                                {visit.products_to_present || "No especificado"}
                            </div>
                        </div>
                        <div>
                            <h3 className="font-semibold text-lg mb-3">🎒 Materiales necesarios</h3>
                            <div className="p-3 bg-slate-50 rounded-lg text-sm">
                                {visit.materials_needed || "No especificado"}
                            </div>
                        </div>
                    </div>

                    {/* Notas de preparación */}
                    {visit.preparation_notes && (
                        <div>
                            <h3 className="font-semibold text-lg mb-3">📝 Notas de preparación</h3>
                            <div className="p-3 bg-slate-50 rounded-lg text-sm whitespace-pre-wrap">
                                {visit.preparation_notes}
                            </div>
                        </div>
                    )}

                    {/* Información de ejecución (si está completada) */}
                    {visit.status === "completed" && (
                        <div className="border-t pt-6">
                            <h3 className="font-semibold text-lg mb-4">✅ Información de Ejecución</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {visit.actual_start && (
                                    <div>
                                        <label className="text-xs text-slate-600">Hora de inicio real</label>
                                        <div className="mt-1 font-medium">
                                            {new Date(visit.actual_start).toLocaleString()}
                                        </div>
                                    </div>
                                )}
                                {visit.actual_end && (
                                    <div>
                                        <label className="text-xs text-slate-600">Hora de fin real</label>
                                        <div className="mt-1 font-medium">
                                            {new Date(visit.actual_end).toLocaleString()}
                                        </div>
                                    </div>
                                )}
                                {visit.interest_level && (
                                    <div>
                                        <label className="text-xs text-slate-600">Nivel de interés</label>
                                        <div className="mt-1 font-medium">
                                            {"⭐".repeat(visit.interest_level)} ({visit.interest_level}/5)
                                        </div>
                                    </div>
                                )}
                                {visit.actual_attendees && (
                                    <div className="md:col-span-2">
                                        <label className="text-xs text-slate-600">Asistentes reales</label>
                                        <div className="mt-1 font-medium">{visit.actual_attendees}</div>
                                    </div>
                                )}
                                {visit.agreements && (
                                    <div className="md:col-span-2">
                                        <label className="text-xs text-slate-600">Acuerdos alcanzados</label>
                                        <div className="mt-1 p-3 bg-green-50 rounded-lg text-sm">
                                            {visit.agreements}
                                        </div>
                                    </div>
                                )}
                                {visit.next_steps && (
                                    <div className="md:col-span-2">
                                        <label className="text-xs text-slate-600">Próximos pasos</label>
                                        <div className="mt-1 p-3 bg-blue-50 rounded-lg text-sm">
                                            {visit.next_steps}
                                        </div>
                                    </div>
                                )}
                                {visit.detailed_notes && (
                                    <div className="md:col-span-2">
                                        <label className="text-xs text-slate-600">Notas detalladas</label>
                                        <div className="mt-1 p-3 bg-slate-50 rounded-lg text-sm whitespace-pre-wrap">
                                            {visit.detailed_notes}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Indicadores de seguimiento */}
                    {(visit.needs_quote || visit.needs_proposal || visit.next_visit_date) && (
                        <div className="border-t pt-6">
                            <h3 className="font-semibold text-lg mb-4">🎯 Seguimiento</h3>
                            <div className="flex flex-wrap gap-3">
                                {visit.needs_quote && (
                                    <span className="px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg text-sm">
                                        📄 Necesita cotización
                                    </span>
                                )}
                                {visit.needs_proposal && (
                                    <span className="px-3 py-1.5 bg-purple-100 text-purple-700 rounded-lg text-sm">
                                        📋 Necesita propuesta
                                    </span>
                                )}
                                {visit.next_visit_date && (
                                    <span className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-sm">
                                        📅 Próxima visita: {new Date(visit.next_visit_date).toLocaleDateString()}
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Formulario de completar visita */}
                    {showCompletionForm && (visit.status === "scheduled" || visit.status === "confirmed") && (
                        <div className="border-t pt-6">
                            <VisitCompletionForm
                                visit={visit}
                                onSuccess={() => {
                                    setShowCompletionForm(false);
                                    if (onUpdate) onUpdate();
                                    loadVisit();
                                }}
                                onCancel={() => setShowCompletionForm(false)}
                            />
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="border-t p-6 flex justify-between items-center bg-slate-50">
                    <div className="text-xs text-slate-500">
                        Creada: {visit.created_at ? new Date(visit.created_at).toLocaleString() : "—"}
                    </div>
                    <div className="flex gap-2">
                        {editing && (
                            <>
                                <button
                                    onClick={() => setEditing(false)}
                                    className="px-4 py-2 rounded-lg border hover:bg-white"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleSave}
                                    className="px-4 py-2 rounded-lg bg-black text-white hover:bg-slate-800"
                                >
                                    Guardar cambios
                                </button>
                            </>
                        )}
                        {!editing && (
                            <button
                                onClick={onClose}
                                className="px-4 py-2 rounded-lg bg-black text-white hover:bg-slate-800"
                            >
                                Cerrar
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
