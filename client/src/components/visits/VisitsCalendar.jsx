// client/src/components/visits/VisitsCalendar.jsx
import React, { useState, useMemo } from "react";

export default function VisitsCalendar({ visits = [], tasks = [], onVisitClick, onTaskClick }) {
    const [currentDate, setCurrentDate] = useState(new Date());

    // Obtener primer y último día del mes actual
    const firstDayOfMonth = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1
    );
    const lastDayOfMonth = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() + 1,
        0
    );

    // Obtener día de la semana del primer día (0 = domingo)
    const firstDayWeekday = firstDayOfMonth.getDay();

    // Generar array de días del mes
    const daysInMonth = lastDayOfMonth.getDate();
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    // Días vacíos al inicio
    const emptyDays = Array.from({ length: firstDayWeekday }, (_, i) => i);

    // Agrupar visitas y tareas por día
    const eventsByDay = useMemo(() => {
        const map = new Map();

        // Agregar visitas
        visits.forEach((visit) => {
            if (!visit.scheduled_at) return;
            const date = new Date(visit.scheduled_at);
            const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

            if (!map.has(key)) {
                map.set(key, { visits: [], tasks: [] });
            }
            map.get(key).visits.push(visit);
        });

        // Agregar tareas
        tasks.forEach((task) => {
            if (!task.due_at) return;
            const date = new Date(task.due_at);
            const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

            if (!map.has(key)) {
                map.set(key, { visits: [], tasks: [] });
            }
            map.get(key).tasks.push(task);
        });

        return map;
    }, [visits, tasks]);

    const getEventsForDay = (day) => {
        const key = `${currentDate.getFullYear()}-${currentDate.getMonth()}-${day}`;
        return eventsByDay.get(key) || { visits: [], tasks: [] };
    };

    const isToday = (day) => {
        const today = new Date();
        return (
            day === today.getDate() &&
            currentDate.getMonth() === today.getMonth() &&
            currentDate.getFullYear() === today.getFullYear()
        );
    };

    const goToPreviousMonth = () => {
        setCurrentDate(
            new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1)
        );
    };

    const goToNextMonth = () => {
        setCurrentDate(
            new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1)
        );
    };

    const goToToday = () => {
        setCurrentDate(new Date());
    };

    const monthNames = [
        "Enero",
        "Febrero",
        "Marzo",
        "Abril",
        "Mayo",
        "Junio",
        "Julio",
        "Agosto",
        "Septiembre",
        "Octubre",
        "Noviembre",
        "Diciembre",
    ];

    return (
        <div className="bg-white rounded-2xl shadow p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">
                    📅 {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
                </h3>
                <div className="flex gap-2">
                    <button
                        onClick={goToPreviousMonth}
                        className="px-3 py-1.5 rounded-lg border hover:bg-slate-50"
                    >
                        ←
                    </button>
                    <button
                        onClick={goToToday}
                        className="px-3 py-1.5 rounded-lg border hover:bg-slate-50 text-sm"
                    >
                        Hoy
                    </button>
                    <button
                        onClick={goToNextMonth}
                        className="px-3 py-1.5 rounded-lg border hover:bg-slate-50"
                    >
                        →
                    </button>
                </div>
            </div>

            {/* Días de la semana */}
            <div className="grid grid-cols-7 gap-1 mb-2">
                {["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((day) => (
                    <div
                        key={day}
                        className="text-center text-xs font-medium text-slate-600 py-2"
                    >
                        {day}
                    </div>
                ))}
            </div>

            {/* Días del mes */}
            <div className="grid grid-cols-7 gap-1">
                {/* Días vacíos */}
                {emptyDays.map((i) => (
                    <div key={`empty-${i}`} className="aspect-square" />
                ))}

                {/* Días del mes */}
                {days.map((day) => {
                    const events = getEventsForDay(day);
                    const hasEvents = events.visits.length > 0 || events.tasks.length > 0;

                    return (
                        <div
                            key={day}
                            className={`aspect-square border rounded-lg p-1 ${isToday(day)
                                    ? "bg-blue-50 border-blue-300"
                                    : "hover:bg-slate-50"
                                }`}
                        >
                            <div className="flex flex-col h-full">
                                <div
                                    className={`text-sm font-medium ${isToday(day) ? "text-blue-600" : "text-slate-700"
                                        }`}
                                >
                                    {day}
                                </div>

                                {hasEvents && (
                                    <div className="flex-1 flex flex-col gap-0.5 mt-1 overflow-hidden">
                                        {/* Visitas */}
                                        {events.visits.slice(0, 2).map((visit) => (
                                            <button
                                                key={visit.id}
                                                onClick={() => onVisitClick && onVisitClick(visit)}
                                                className="text-[10px] px-1 py-0.5 rounded bg-green-100 text-green-700 hover:bg-green-200 text-left truncate"
                                                title={`${visit.org_name} - ${visit.objective || "Visita"}`}
                                            >
                                                🚗 {visit.org_name?.substring(0, 10)}
                                            </button>
                                        ))}

                                        {/* Tareas */}
                                        {events.tasks.slice(0, 2).map((task) => (
                                            <button
                                                key={task.id}
                                                onClick={() => onTaskClick && onTaskClick(task)}
                                                className="text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 text-left truncate"
                                                title={task.title}
                                            >
                                                ✓ {task.title?.substring(0, 10)}
                                            </button>
                                        ))}

                                        {/* Indicador de más eventos */}
                                        {events.visits.length + events.tasks.length > 2 && (
                                            <div className="text-[9px] text-slate-500 text-center">
                                                +{events.visits.length + events.tasks.length - 2} más
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Leyenda */}
            <div className="flex items-center gap-4 mt-4 pt-4 border-t text-xs">
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded bg-green-100 border border-green-300" />
                    <span className="text-slate-600">Visitas</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded bg-amber-100 border border-amber-300" />
                    <span className="text-slate-600">Tareas</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded bg-blue-50 border border-blue-300" />
                    <span className="text-slate-600">Hoy</span>
                </div>
            </div>
        </div>
    );
}
