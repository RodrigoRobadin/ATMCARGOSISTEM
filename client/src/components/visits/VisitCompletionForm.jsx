// client/src/components/visits/VisitCompletionForm.jsx
import React, { useState } from "react";
import { api } from "../../api";

export default function VisitCompletionForm({ visit, onSuccess, onCancel }) {
    const [form, setForm] = useState({
        actual_start: visit.actual_start || "",
        actual_end: visit.actual_end || "",
        actual_attendees: visit.actual_attendees || "",
        outcome: visit.outcome || "neutral",
        interest_level: visit.interest_level || 3,
        agreements: visit.agreements || "",
        next_steps: visit.next_steps || "",
        detailed_notes: visit.detailed_notes || "",
        next_visit_date: visit.next_visit_date || "",
        needs_quote: visit.needs_quote || false,
        needs_proposal: visit.needs_proposal || false,
    });

    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            // Actualizar la visita con información de ejecución y marcarla como completada
            await api.patch(`/visits/${visit.id}`, {
                ...form,
                status: "completed",
            });

            alert("Visita completada exitosamente");
            if (onSuccess) onSuccess();
        } catch (err) {
            console.error(err);
            alert("No se pudo completar la visita");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                    <span className="text-2xl">✅</span>
                    <div>
                        <h3 className="font-semibold text-blue-900">Completar información de visita</h3>
                        <p className="text-sm text-blue-700 mt-1">
                            Registra los detalles de la visita realizada para mantener un seguimiento completo.
                        </p>
                    </div>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
                {/* Información de Ejecución */}
                <div>
                    <h4 className="font-semibold text-lg mb-4">⏱️ Información de Ejecución</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="block text-sm">
                            <div className="text-xs text-slate-600 mb-1">Hora de inicio real</div>
                            <input
                                type="datetime-local"
                                className="border rounded-lg px-3 py-2 w-full"
                                value={form.actual_start ? form.actual_start.slice(0, 16) : ""}
                                onChange={(e) =>
                                    setForm((f) => ({ ...f, actual_start: e.target.value }))
                                }
                            />
                        </label>

                        <label className="block text-sm">
                            <div className="text-xs text-slate-600 mb-1">Hora de fin real</div>
                            <input
                                type="datetime-local"
                                className="border rounded-lg px-3 py-2 w-full"
                                value={form.actual_end ? form.actual_end.slice(0, 16) : ""}
                                onChange={(e) =>
                                    setForm((f) => ({ ...f, actual_end: e.target.value }))
                                }
                            />
                        </label>

                        <label className="block text-sm md:col-span-2">
                            <div className="text-xs text-slate-600 mb-1">
                                Asistentes reales (nombres y cargos)
                            </div>
                            <textarea
                                rows={2}
                                className="border rounded-lg px-3 py-2 w-full"
                                value={form.actual_attendees}
                                onChange={(e) =>
                                    setForm((f) => ({ ...f, actual_attendees: e.target.value }))
                                }
                                placeholder="Ej: Juan Pérez (Gerente General), María González (Jefa de Compras)"
                            />
                        </label>
                    </div>
                </div>

                {/* Resultado y Nivel de Interés */}
                <div>
                    <h4 className="font-semibold text-lg mb-4">📊 Resultado de la Visita</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="block text-sm">
                            <div className="text-xs text-slate-600 mb-1">
                                Resultado general <span className="text-red-500">*</span>
                            </div>
                            <select
                                className="border rounded-lg px-3 py-2 w-full"
                                value={form.outcome}
                                onChange={(e) => setForm((f) => ({ ...f, outcome: e.target.value }))}
                                required
                            >
                                <option value="successful">✅ Exitosa - Hubo interés y avances</option>
                                <option value="neutral">➖ Neutral - Sin resultado claro</option>
                                <option value="negative">❌ Negativa - No hubo interés</option>
                            </select>
                        </label>

                        <label className="block text-sm">
                            <div className="text-xs text-slate-600 mb-1">
                                Nivel de interés (1-5)
                            </div>
                            <div className="flex items-center gap-3">
                                <input
                                    type="range"
                                    min="1"
                                    max="5"
                                    className="flex-1"
                                    value={form.interest_level}
                                    onChange={(e) =>
                                        setForm((f) => ({
                                            ...f,
                                            interest_level: Number(e.target.value),
                                        }))
                                    }
                                />
                                <div className="text-2xl w-32">
                                    {"⭐".repeat(form.interest_level)}
                                </div>
                            </div>
                        </label>
                    </div>
                </div>

                {/* Acuerdos y Próximos Pasos */}
                <div>
                    <h4 className="font-semibold text-lg mb-4">🤝 Acuerdos y Compromisos</h4>
                    <div className="space-y-4">
                        <label className="block text-sm">
                            <div className="text-xs text-slate-600 mb-1">
                                Acuerdos alcanzados
                            </div>
                            <textarea
                                rows={3}
                                className="border rounded-lg px-3 py-2 w-full"
                                value={form.agreements}
                                onChange={(e) =>
                                    setForm((f) => ({ ...f, agreements: e.target.value }))
                                }
                                placeholder="Ej: Acordamos enviar cotización formal antes del viernes. Cliente se compromete a revisar y dar feedback en 5 días hábiles."
                            />
                        </label>

                        <label className="block text-sm">
                            <div className="text-xs text-slate-600 mb-1">
                                Próximos pasos / Acciones a seguir
                            </div>
                            <textarea
                                rows={3}
                                className="border rounded-lg px-3 py-2 w-full"
                                value={form.next_steps}
                                onChange={(e) =>
                                    setForm((f) => ({ ...f, next_steps: e.target.value }))
                                }
                                placeholder="Ej: 1) Enviar cotización detallada, 2) Agendar llamada de seguimiento, 3) Preparar propuesta técnica"
                            />
                        </label>

                        <label className="block text-sm">
                            <div className="text-xs text-slate-600 mb-1">
                                Notas detalladas de la visita
                            </div>
                            <textarea
                                rows={5}
                                className="border rounded-lg px-3 py-2 w-full"
                                value={form.detailed_notes}
                                onChange={(e) =>
                                    setForm((f) => ({ ...f, detailed_notes: e.target.value }))
                                }
                                placeholder="Describe en detalle lo que se habló, impresiones, puntos importantes, objeciones, oportunidades detectadas, etc."
                            />
                        </label>
                    </div>
                </div>

                {/* Seguimiento */}
                <div>
                    <h4 className="font-semibold text-lg mb-4">🎯 Seguimiento</h4>
                    <div className="space-y-4">
                        <label className="block text-sm">
                            <div className="text-xs text-slate-600 mb-1">
                                Fecha de próxima visita (opcional)
                            </div>
                            <input
                                type="date"
                                className="border rounded-lg px-3 py-2 w-full"
                                value={form.next_visit_date}
                                onChange={(e) =>
                                    setForm((f) => ({ ...f, next_visit_date: e.target.value }))
                                }
                            />
                        </label>

                        <div className="flex flex-wrap gap-4">
                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={form.needs_quote}
                                    onChange={(e) =>
                                        setForm((f) => ({ ...f, needs_quote: e.target.checked }))
                                    }
                                />
                                <span className="text-sm">📄 Necesita cotización</span>
                            </label>

                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={form.needs_proposal}
                                    onChange={(e) =>
                                        setForm((f) => ({ ...f, needs_proposal: e.target.checked }))
                                    }
                                />
                                <span className="text-sm">📋 Necesita propuesta comercial</span>
                            </label>
                        </div>
                    </div>
                </div>

                {/* Botones */}
                <div className="flex gap-3 pt-4 border-t">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="px-4 py-2 rounded-lg border hover:bg-slate-50"
                        disabled={loading}
                    >
                        Cancelar
                    </button>
                    <button
                        type="submit"
                        className="px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                        disabled={loading}
                    >
                        {loading ? "Guardando..." : "✅ Completar visita"}
                    </button>
                </div>
            </form>
        </div>
    );
}
