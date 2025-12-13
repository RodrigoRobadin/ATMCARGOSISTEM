// client/src/components/op-details/IndustrialDoorList.jsx
import React, { useState, useEffect, useRef } from "react";
import { api } from "../../api";
import { generateQuoteEmail } from "../../utils/generateQuoteEmail";

const Input = ({ readOnly, ...props }) => (
    <input
        className={`border rounded-lg px-2 py-1 text-sm w-full focus:outline-none ${readOnly
            ? "bg-slate-50 cursor-not-allowed"
            : "focus:ring-2 focus:ring-black/10"
            }`}
        readOnly={readOnly}
        {...props}
    />
);

const Select = ({ readOnly, children, ...props }) => (
    <select
        disabled={!!readOnly}
        className={`border rounded-lg px-2 py-1 text-sm w-full bg-white focus:outline-none ${readOnly
            ? "bg-slate-50 cursor-not-allowed"
            : "focus:ring-2 focus:ring-black/10"
            }`}
        {...props}
    >
        {children}
    </select>
);

function Field({ label, children }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-600">{label}</span>
            <div>{children}</div>
        </label>
    );
}

export default function IndustrialDoorList({ dealId, editMode, dealReference }) {
    const [doors, setDoors] = useState([]);
    const [loading, setLoading] = useState(false);
    const [editingDoorId, setEditingDoorId] = useState(null);
    const [doorFormData, setDoorFormData] = useState({});
    const [uploadingImage, setUploadingImage] = useState(null);
    const fileInputRef = useRef(null);

    // Cargar puertas
    async function loadDoors() {
        if (!dealId) return;
        setLoading(true);
        try {
            const { data } = await api.get(`/deals/${dealId}/industrial-doors`);
            setDoors(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error("Error cargando puertas:", error);
            setDoors([]);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadDoors();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dealId]);

    // Agregar nueva puerta
    async function handleAddDoor() {
        if (!dealId) return;
        try {
            await api.post(`/deals/${dealId}/industrial-doors`, {
                product_id: null,
                identifier: `P${doors.length + 1}`,
            });
            await loadDoors();
        } catch (error) {
            console.error("Error agregando puerta:", error);
            alert("No se pudo agregar la puerta");
        }
    }

    // Iniciar edición de una puerta
    function startEditDoor(door) {
        setEditingDoorId(door.id);
        setDoorFormData({
            identifier: door.identifier || "",
            frame_type: door.frame_type || "",
            canvas_type: door.canvas_type || "",
            frame_material: door.frame_material || "",
            finish: door.finish || "",
            width_available: door.width_available || "",
            height_available: door.height_available || "",
            overheight_available: door.overheight_available || "",
            side_install: door.side_install || "",
            clearance_right: door.clearance_right || "",
            clearance_left: door.clearance_left || "",
            motor_side: door.motor_side || "",
            actuators: door.actuators || "",
            visor_lines: door.visor_lines || "",
            right_leg: door.right_leg || "",
            notes: door.notes || "",
        });
    }

    // Guardar cambios de una puerta
    async function handleSaveDoor() {
        if (!editingDoorId) return;
        try {
            const payload = {
                identifier: doorFormData.identifier || null,
                frame_type: doorFormData.frame_type || null,
                canvas_type: doorFormData.canvas_type || null,
                frame_material: doorFormData.frame_material || null,
                finish: doorFormData.finish || null,
                width_available: doorFormData.width_available ? Number(doorFormData.width_available) : null,
                height_available: doorFormData.height_available ? Number(doorFormData.height_available) : null,
                overheight_available: doorFormData.overheight_available ? Number(doorFormData.overheight_available) : null,
                side_install: doorFormData.side_install || null,
                clearance_right: doorFormData.clearance_right ? Number(doorFormData.clearance_right) : null,
                clearance_left: doorFormData.clearance_left ? Number(doorFormData.clearance_left) : null,
                motor_side: doorFormData.motor_side || null,
                actuators: doorFormData.actuators || null,
                visor_lines: doorFormData.visor_lines || null,
                right_leg: doorFormData.right_leg || null,
                notes: doorFormData.notes || null,
            };

            await api.put(`/industrial-doors/${editingDoorId}`, payload);
            await loadDoors();
            setEditingDoorId(null);
            setDoorFormData({});
        } catch (error) {
            console.error("Error guardando puerta:", error);
            alert("No se pudo guardar la puerta");
        }
    }

    // Cancelar edición
    function handleCancelEdit() {
        setEditingDoorId(null);
        setDoorFormData({});
    }

    // Eliminar puerta
    async function handleDeleteDoor(doorId) {
        if (!window.confirm("¿Estás seguro de eliminar esta puerta?")) return;
        try {
            await api.delete(`/industrial-doors/${doorId}`);
            await loadDoors();
        } catch (error) {
            console.error("Error eliminando puerta:", error);
            alert("No se pudo eliminar la puerta");
        }
    }

    // Actualizar campo del formulario
    function updateFormField(field, value) {
        setDoorFormData((prev) => ({ ...prev, [field]: value }));
    }

    // Subir imagen
    async function handleImageUpload(doorId, file) {
        if (!file) return;

        const formData = new FormData();
        formData.append("image", file);

        setUploadingImage(doorId);
        try {
            await api.post(`/industrial-doors/${doorId}/images`, formData, {
                headers: { "Content-Type": "multipart/form-data" },
            });
            await loadDoors();
        } catch (error) {
            console.error("Error subiendo imagen:", error);
            alert("No se pudo subir la imagen");
        } finally {
            setUploadingImage(null);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    }

    // Eliminar imagen
    async function handleDeleteImage(doorId, imageId) {
        if (!window.confirm("¿Eliminar esta imagen?")) return;
        try {
            await api.delete(`/industrial-doors/${doorId}/images/${imageId}`);
            await loadDoors();
        } catch (error) {
            console.error("Error eliminando imagen:", error);
            alert("No se pudo eliminar la imagen");
        }
    }

        // Generar correo de cotizacion en texto plano (tabla fija)
    async function handleGenerateQuoteEmail() {
        if (doors.length === 0) {
            alert("No hay puertas para cotizar");
            return;
        }
        try {
            const { subject, copied } = await generateQuoteEmail(doors, dealReference);
            const msg = copied
                ? "Texto copiado al portapapeles y correo listo."
                : "No se pudo copiar automaticamente; revisa el borrador abierto.";
            alert(`${msg}
Asunto: ${subject}`);
        } catch (error) {
            console.error("Error generando correo:", error);
            alert("No se pudo generar el correo en texto plano");
        }
    }

    if (loading) {
        return (
            <div className="bg-white rounded-2xl shadow p-4">
                <p className="text-sm text-slate-600">Cargando puertas...</p>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-2xl shadow p-4">
            <div className="flex items-center justify-between mb-4">
                <h3 className="font-medium">Puertas / Productos Industriales</h3>
                <div className="flex gap-2">
                    {doors.length > 0 && (
                        <button
                            className="px-3 py-1.5 text-sm rounded-lg border border-blue-600 text-blue-600 hover:bg-blue-50"
                            onClick={handleGenerateQuoteEmail}
                        >
                            📧 Generar correo de cotización
                        </button>
                    )}
                    {editMode && (
                        <button
                            className="px-3 py-1.5 text-sm rounded-lg bg-black text-white hover:opacity-90"
                            onClick={handleAddDoor}
                        >
                            + Agregar puerta
                        </button>
                    )}
                </div>
            </div>

            {doors.length === 0 ? (
                <p className="text-sm text-slate-500">
                    No hay puertas agregadas.{" "}
                    {editMode && "Haz clic en 'Agregar puerta' para comenzar."}
                </p>
            ) : (
                <div className="space-y-4">
                    {doors.map((door) => (
                        <div key={door.id} className="border rounded-xl p-4">
                            {editingDoorId === door.id ? (
                                /* MODO EDICIÓN */
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between mb-3">
                                        <h4 className="font-medium text-lg">
                                            Editando: {door.identifier || "Puerta sin identificación"}
                                        </h4>
                                        <div className="flex gap-2">
                                            <button
                                                className="px-3 py-1 text-sm rounded-lg border hover:bg-slate-50"
                                                onClick={handleCancelEdit}
                                            >
                                                Cancelar
                                            </button>
                                            <button
                                                className="px-3 py-1 text-sm rounded-lg bg-black text-white hover:opacity-90"
                                                onClick={handleSaveDoor}
                                            >
                                                Guardar
                                            </button>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        <Field label="Identificación de la puerta">
                                            <Input
                                                value={doorFormData.identifier || ""}
                                                onChange={(e) => updateFormField("identifier", e.target.value)}
                                                placeholder="Ej: Puerta Principal"
                                            />
                                        </Field>

                                        <Field label="Tipo de puerta">
                                            <Select
                                                value={doorFormData.frame_type || ""}
                                                onChange={(e) => updateFormField("frame_type", e.target.value)}
                                            >
                                                <option value="">—</option>
                                                <option value="SECCIONAL">SECCIONAL</option>
                                                <option value="VECTOR FLEX">VECTOR FLEX</option>
                                                <option value="RP">RP</option>
                                                <option value="FRIGOMAX">FRIGOMAX</option>
                                                <option value="RP SL 01">RP SL 01</option>
                                                <option value="AL 01">AL 01</option>
                                                <option value="M2">M2</option>
                                            </Select>
                                        </Field>

                                        <Field label="Tipo de lona">
                                            <Select
                                                value={doorFormData.canvas_type || ""}
                                                onChange={(e) => updateFormField("canvas_type", e.target.value)}
                                            >
                                                <option value="">—</option>
                                                <option value="VINIL">Vinil</option>
                                                <option value="X-FORCE">X-Force</option>
                                            </Select>
                                        </Field>

                                        <Field label="Tipo de marco">
                                            <Select
                                                value={doorFormData.frame_material || ""}
                                                onChange={(e) => updateFormField("frame_material", e.target.value)}
                                            >
                                                <option value="">—</option>
                                                <option value="MAMPOSTERIA">Mampostería</option>
                                                <option value="ISOPANEL">Isopanel</option>
                                            </Select>
                                        </Field>

                                        <Field label="Acabado">
                                            <Select
                                                value={doorFormData.finish || ""}
                                                onChange={(e) => updateFormField("finish", e.target.value)}
                                            >
                                                <option value="">—</option>
                                                <option value="INOX">Inox</option>
                                            </Select>
                                        </Field>

                                        <Field label="Ancho (mm)">
                                            <Input
                                                type="number"
                                                value={doorFormData.width_available || ""}
                                                onChange={(e) => updateFormField("width_available", e.target.value)}
                                                placeholder="Ej: 3000"
                                            />
                                        </Field>

                                        <Field label="Alto (mm)">
                                            <Input
                                                type="number"
                                                value={doorFormData.height_available || ""}
                                                onChange={(e) => updateFormField("height_available", e.target.value)}
                                                placeholder="Ej: 3000"
                                            />
                                        </Field>

                                        <Field label="Sobre alto disponible (mm)">
                                            <Input
                                                type="number"
                                                value={doorFormData.overheight_available || ""}
                                                onChange={(e) => updateFormField("overheight_available", e.target.value)}
                                                placeholder="Ej: 500"
                                            />
                                        </Field>

                                        <Field label="Lado de instalación">
                                            <Select
                                                value={doorFormData.side_install || ""}
                                                onChange={(e) => updateFormField("side_install", e.target.value)}
                                            >
                                                <option value="">—</option>
                                                <option value="DERECHA">Derecha</option>
                                                <option value="IZQUIERDA">Izquierda</option>
                                                <option value="CENTRO">Centro</option>
                                            </Select>
                                        </Field>

                                        <Field label="Disp. lado derecho (mm)">
                                            <Input
                                                type="number"
                                                value={doorFormData.clearance_right || ""}
                                                onChange={(e) => updateFormField("clearance_right", e.target.value)}
                                                placeholder="Ej: 150"
                                            />
                                        </Field>

                                        <Field label="Disp. lado izquierdo (mm)">
                                            <Input
                                                type="number"
                                                value={doorFormData.clearance_left || ""}
                                                onChange={(e) => updateFormField("clearance_left", e.target.value)}
                                                placeholder="Ej: 150"
                                            />
                                        </Field>

                                        <Field label="Lado motor">
                                            <Select
                                                value={doorFormData.motor_side || ""}
                                                onChange={(e) => updateFormField("motor_side", e.target.value)}
                                            >
                                                <option value="">—</option>
                                                <option value="DERECHA">Derecha</option>
                                                <option value="IZQUIERDA">Izquierda</option>
                                            </Select>
                                        </Field>

                                        <Field label="Líneas de visor">
                                            <Input
                                                value={doorFormData.visor_lines || ""}
                                                onChange={(e) => updateFormField("visor_lines", e.target.value)}
                                                placeholder="Ej: 2"
                                            />
                                        </Field>

                                        <Field label="Pie derecho">
                                            <Input
                                                value={doorFormData.right_leg || ""}
                                                onChange={(e) => updateFormField("right_leg", e.target.value)}
                                                placeholder="Ej: Sí/No"
                                            />
                                        </Field>
                                    </div>

                                    <Field label="Accionadores (Ej: 2 Botonera, 1 Lazo inductivo, 2 Sensor)">
                                        <textarea
                                            className="border rounded-lg px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-black/10"
                                            rows={2}
                                            value={doorFormData.actuators || ""}
                                            onChange={(e) => updateFormField("actuators", e.target.value)}
                                            placeholder="Ej: 2 Botonera, 1 Lazo inductivo, 2 Sensor"
                                        />
                                        <div className="text-xs text-slate-500 mt-1">
                                            Tipos disponibles: Botonera, Lazo inductivo, Sensor, Tirador, Control
                                        </div>
                                    </Field>

                                    <Field label="Observaciones / Detalles adicionales">
                                        <textarea
                                            className="border rounded-lg px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-black/10"
                                            rows={3}
                                            value={doorFormData.notes || ""}
                                            onChange={(e) => updateFormField("notes", e.target.value)}
                                            placeholder="Detalles adicionales..."
                                        />
                                    </Field>
                                </div>
                            ) : (
                                /* MODO VISTA */
                                <div>
                                    <div className="flex items-center justify-between mb-3">
                                        <h4 className="font-medium text-lg">
                                            {door.identifier || "Puerta sin identificación"}
                                        </h4>
                                        {editMode && (
                                            <div className="flex gap-2">
                                                <button
                                                    className="px-3 py-1 text-sm rounded-lg border hover:bg-slate-50"
                                                    onClick={() => startEditDoor(door)}
                                                >
                                                    Editar
                                                </button>
                                                <button
                                                    className="px-3 py-1 text-sm rounded-lg border text-red-600 hover:bg-red-50"
                                                    onClick={() => handleDeleteDoor(door.id)}
                                                >
                                                    Eliminar
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Imágenes */}
                                    {door.images && door.images.length > 0 && (
                                        <div className="mb-4">
                                            <div className="text-xs text-slate-600 mb-2">Imágenes:</div>
                                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                                                {door.images.map((img) => (
                                                    <div key={img.id} className="relative group">
                                                        <img
                                                            src={img.url}
                                                            alt={img.filename}
                                                            className="w-full h-32 object-cover rounded-lg border"
                                                        />
                                                        {editMode && (
                                                            <button
                                                                className="absolute top-1 right-1 bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                                                onClick={() => handleDeleteImage(door.id, img.id)}
                                                                title="Eliminar imagen"
                                                            >
                                                                ×
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Botón para agregar imágenes */}
                                    {editMode && (
                                        <div className="mb-4">
                                            <input
                                                ref={fileInputRef}
                                                type="file"
                                                accept="image/*"
                                                className="hidden"
                                                onChange={(e) => {
                                                    if (e.target.files?.[0]) {
                                                        handleImageUpload(door.id, e.target.files[0]);
                                                    }
                                                }}
                                            />
                                            <button
                                                className="px-3 py-1.5 text-sm rounded-lg border hover:bg-slate-50 disabled:opacity-50"
                                                onClick={() => fileInputRef.current?.click()}
                                                disabled={uploadingImage === door.id}
                                            >
                                                {uploadingImage === door.id ? "Subiendo..." : "+ Agregar imagen"}
                                            </button>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-sm">
                                        {door.frame_type && (
                                            <div>
                                                <span className="text-slate-500">Tipo:</span>{" "}
                                                <span className="font-medium">{door.frame_type}</span>
                                            </div>
                                        )}
                                        {door.canvas_type && (
                                            <div>
                                                <span className="text-slate-500">Tipo de lona:</span>{" "}
                                                <span className="font-medium">{door.canvas_type}</span>
                                            </div>
                                        )}
                                        {door.frame_material && (
                                            <div>
                                                <span className="text-slate-500">Tipo de marco:</span>{" "}
                                                <span className="font-medium">{door.frame_material}</span>
                                            </div>
                                        )}
                                        {door.finish && (
                                            <div>
                                                <span className="text-slate-500">Acabado:</span>{" "}
                                                <span className="font-medium">{door.finish}</span>
                                            </div>
                                        )}
                                        {door.width_available && (
                                            <div>
                                                <span className="text-slate-500">Ancho:</span>{" "}
                                                <span className="font-medium">{door.width_available} mm</span>
                                            </div>
                                        )}
                                        {door.height_available && (
                                            <div>
                                                <span className="text-slate-500">Alto:</span>{" "}
                                                <span className="font-medium">{door.height_available} mm</span>
                                            </div>
                                        )}

                                        {door.overheight_available && (
                                            <div>
                                                <span className="text-slate-500">Sobre alto:</span>{" "}
                                                <span className="font-medium">{door.overheight_available} mm</span>
                                            </div>
                                        )}
                                        {door.side_install && (
                                            <div>
                                                <span className="text-slate-500">Lado instalación:</span>{" "}
                                                <span className="font-medium">{door.side_install}</span>
                                            </div>
                                        )}
                                        {door.clearance_right && (
                                            <div>
                                                <span className="text-slate-500">Disp. derecha:</span>{" "}
                                                <span className="font-medium">{door.clearance_right} mm</span>
                                            </div>
                                        )}
                                        {door.clearance_left && (
                                            <div>
                                                <span className="text-slate-500">Disp. izquierda:</span>{" "}
                                                <span className="font-medium">{door.clearance_left} mm</span>
                                            </div>
                                        )}
                                        {door.motor_side && (
                                            <div>
                                                <span className="text-slate-500">Lado motor:</span>{" "}
                                                <span className="font-medium">{door.motor_side}</span>
                                            </div>
                                        )}
                                        {door.visor_lines && (
                                            <div>
                                                <span className="text-slate-500">Líneas visor:</span>{" "}
                                                <span className="font-medium">{door.visor_lines}</span>
                                            </div>
                                        )}
                                        {door.right_leg && (
                                            <div>
                                                <span className="text-slate-500">Pie derecho:</span>{" "}
                                                <span className="font-medium">{door.right_leg}</span>
                                            </div>
                                        )}
                                    </div>

                                    {door.actuators && (
                                        <div className="mt-3 pt-3 border-t">
                                            <div className="text-xs text-slate-500 mb-1">Accionadores:</div>
                                            <div className="text-sm">{door.actuators}</div>
                                        </div>
                                    )}

                                    {door.notes && (
                                        <div className="mt-3 pt-3 border-t">
                                            <div className="text-xs text-slate-500 mb-1">Observaciones:</div>
                                            <div className="text-sm whitespace-pre-wrap">{door.notes}</div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
