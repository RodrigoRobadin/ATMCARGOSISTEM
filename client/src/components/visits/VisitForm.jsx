// client/src/components/visits/VisitForm.jsx
import React, { useState } from "react";
import { api } from "../../api";

export default function VisitForm({ orgs = [], contacts = [], onSuccess }) {
    const [form, setForm] = useState({
        org_id: "",
        contact_ids: [],
        scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000) // +1 día
            .toISOString()
            .slice(0, 16)
            .replace("T", " "),
        estimated_duration_min: 60,
        address: "",
        objective: "",
        products_to_present: "",
        materials_needed: "",
        preparation_notes: "",
    });

    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.org_id || !form.scheduled_at) {
            alert("Organización y fecha son requeridos");
            return;
        }

        setLoading(true);
        try {
            await api.post("/visits", form);
            alert("Visita creada exitosamente");
            // Reset form
            setForm({
                org_id: "",
                contact_ids: [],
                scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000)
                    .toISOString()
                    .slice(0, 16)
                    .replace("T", " "),
                estimated_duration_min: 60,
                address: "",
                objective: "",
                products_to_present: "",
                materials_needed: "",
                preparation_notes: "",
            });
            if (onSuccess) onSuccess();
        } catch (err) {
            console.error(err);
            alert("No se pudo crear la visita");
        } finally {
            setLoading(false);
        }
    };

    const orgContacts = contacts.filter((c) =>
        form.org_id ? String(c.org_id) === String(form.org_id) : false
    );

    const selectedOrg = orgs.find((o) => String(o.id) === String(form.org_id));

    return (
        <div className="bg-white rounded-2xl shadow p-4">
            <div className="font-medium mb-3">Programar nueva visita</div>
            <form onSubmit={handleSubmit} className="space-y-3">
                {/* Organización */}
                <label className="block text-sm">
                    <div className="text-xs text-slate-600 mb-1">
                        Organización <span className="text-red-500">*</span>
                    </div>
                    <select
                        className="border rounded-lg px-3 py-1.5 w-full"
                        value={form.org_id}
                        onChange={(e) => {
                            setForm((f) => ({
                                ...f,
                                org_id: e.target.value,
                                contact_ids: [],
                                address: "",
                            }));
                            // Prellenar dirección si existe
                            const org = orgs.find((o) => String(o.id) === e.target.value);
                            if (org?.address) {
                                setForm((f) => ({ ...f, address: org.address }));
                            }
                        }}
                        required
                    >
                        <option value="">— Seleccionar —</option>
                        {orgs.map((o) => (
                            <option key={o.id} value={o.id}>
                                {o.name}
                            </option>
                        ))}
                    </select>
                </label>

                {/* Contactos */}
                {form.org_id && orgContacts.length > 0 && (
                    <label className="block text-sm">
                        <div className="text-xs text-slate-600 mb-1">Contactos a reunirse</div>
                        <div className="border rounded-lg p-2 space-y-1 max-h-32 overflow-y-auto">
                            {orgContacts.map((c) => (
                                <label key={c.id} className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={form.contact_ids.includes(c.id)}
                                        onChange={(e) => {
                                            if (e.target.checked) {
                                                setForm((f) => ({
                                                    ...f,
                                                    contact_ids: [...f.contact_ids, c.id],
                                                }));
                                            } else {
                                                setForm((f) => ({
                                                    ...f,
                                                    contact_ids: f.contact_ids.filter((id) => id !== c.id),
                                                }));
                                            }
                                        }}
                                    />
                                    <span className="text-sm">
                                        {c.name} {c.email ? `(${c.email})` : ""}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </label>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Fecha y hora */}
                    <label className="block text-sm">
                        <div className="text-xs text-slate-600 mb-1">
                            Fecha y hora <span className="text-red-500">*</span>
                        </div>
                        <input
                            type="datetime-local"
                            className="border rounded-lg px-3 py-1.5 w-full"
                            value={form.scheduled_at.replace(" ", "T").slice(0, 16)}
                            onChange={(e) =>
                                setForm((f) => ({
                                    ...f,
                                    scheduled_at: e.target.value.replace("T", " "),
                                }))
                            }
                            required
                        />
                    </label>

                    {/* Duración estimada */}
                    <label className="block text-sm">
                        <div className="text-xs text-slate-600 mb-1">Duración estimada (min)</div>
                        <input
                            type="number"
                            min="15"
                            step="15"
                            className="border rounded-lg px-3 py-1.5 w-full"
                            value={form.estimated_duration_min}
                            onChange={(e) =>
                                setForm((f) => ({
                                    ...f,
                                    estimated_duration_min: Number(e.target.value),
                                }))
                            }
                        />
                    </label>
                </div>

                {/* Dirección */}
                <label className="block text-sm">
                    <div className="text-xs text-slate-600 mb-1">Dirección</div>
                    <textarea
                        rows={2}
                        className="border rounded-lg px-3 py-1.5 w-full"
                        value={form.address}
                        onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                        placeholder={selectedOrg?.address || "Dirección de la visita"}
                    />
                </label>

                {/* Objetivo */}
                <label className="block text-sm">
                    <div className="text-xs text-slate-600 mb-1">Objetivo de la visita</div>
                    <select
                        className="border rounded-lg px-3 py-1.5 w-full"
                        value={form.objective}
                        onChange={(e) => setForm((f) => ({ ...f, objective: e.target.value }))}
                    >
                        <option value="">— Seleccionar —</option>
                        <option value="Presentación">Presentación</option>
                        <option value="Demostración">Demostración</option>
                        <option value="Negociación">Negociación</option>
                        <option value="Cierre">Cierre</option>
                        <option value="Soporte técnico">Soporte técnico</option>
                        <option value="Seguimiento">Seguimiento</option>
                    </select>
                </label>

                {/* Productos a presentar */}
                <label className="block text-sm">
                    <div className="text-xs text-slate-600 mb-1">Productos/servicios a presentar</div>
                    <textarea
                        rows={2}
                        className="border rounded-lg px-3 py-1.5 w-full"
                        value={form.products_to_present}
                        onChange={(e) =>
                            setForm((f) => ({ ...f, products_to_present: e.target.value }))
                        }
                        placeholder="Ej: Puertas industriales, cortinas de PVC..."
                    />
                </label>

                {/* Materiales necesarios */}
                <label className="block text-sm">
                    <div className="text-xs text-slate-600 mb-1">Materiales necesarios</div>
                    <textarea
                        rows={2}
                        className="border rounded-lg px-3 py-1.5 w-full"
                        value={form.materials_needed}
                        onChange={(e) =>
                            setForm((f) => ({ ...f, materials_needed: e.target.value }))
                        }
                        placeholder="Ej: Catálogos, muestras, laptop, proyector..."
                    />
                </label>

                {/* Notas de preparación */}
                <label className="block text-sm">
                    <div className="text-xs text-slate-600 mb-1">Notas de preparación</div>
                    <textarea
                        rows={3}
                        className="border rounded-lg px-3 py-1.5 w-full"
                        value={form.preparation_notes}
                        onChange={(e) =>
                            setForm((f) => ({ ...f, preparation_notes: e.target.value }))
                        }
                        placeholder="Puntos clave a investigar, temas a tratar..."
                    />
                </label>

                {/* Botón */}
                <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-50"
                >
                    {loading ? "Guardando..." : "Programar visita"}
                </button>
            </form>
        </div>
    );
}
