// client/src/components/routes/RouteMap.jsx
import React, { useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix para los iconos de Leaflet en Vite/Webpack
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

export default function RouteMap({ stops = [], zoneColor = '#3B82F6' }) {
    // Crear iconos numerados personalizados
    const createNumberedIcon = (number, status) => {
        const color = status === 'completada' ? '#10B981' :
            status === 'cancelada' ? '#6B7280' :
                '#3B82F6';

        return L.divIcon({
            className: 'custom-marker',
            html: `
                <div style="
                    background-color: ${color};
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    border: 3px solid white;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-weight: bold;
                    font-size: 14px;
                ">
                    ${number}
                </div>
            `,
            iconSize: [32, 32],
            iconAnchor: [16, 16],
            popupAnchor: [0, -16],
        });
    };

    // Filtrar paradas con coordenadas válidas
    const validStops = useMemo(() => {
        return stops.filter(stop =>
            stop.latitude &&
            stop.longitude &&
            !isNaN(parseFloat(stop.latitude)) &&
            !isNaN(parseFloat(stop.longitude))
        );
    }, [stops]);

    // Calcular centro y bounds del mapa
    const { center, bounds } = useMemo(() => {
        if (validStops.length === 0) {
            // Centro de Paraguay por defecto
            return {
                center: [-23.4425, -58.4438],
                bounds: null
            };
        }

        if (validStops.length === 1) {
            return {
                center: [parseFloat(validStops[0].latitude), parseFloat(validStops[0].longitude)],
                bounds: null
            };
        }

        // Calcular bounds para incluir todas las paradas
        const lats = validStops.map(s => parseFloat(s.latitude));
        const lngs = validStops.map(s => parseFloat(s.longitude));

        return {
            center: [
                (Math.min(...lats) + Math.max(...lats)) / 2,
                (Math.min(...lngs) + Math.max(...lngs)) / 2
            ],
            bounds: [
                [Math.min(...lats), Math.min(...lngs)],
                [Math.max(...lats), Math.max(...lngs)]
            ]
        };
    }, [validStops]);

    // Crear líneas de ruta
    const routeLines = useMemo(() => {
        if (validStops.length < 2) return [];

        return validStops.map((stop, index) => {
            if (index === validStops.length - 1) return null;

            const nextStop = validStops[index + 1];
            return [
                [parseFloat(stop.latitude), parseFloat(stop.longitude)],
                [parseFloat(nextStop.latitude), parseFloat(nextStop.longitude)]
            ];
        }).filter(Boolean);
    }, [validStops]);

    if (validStops.length === 0) {
        return (
            <div className="bg-gray-50 rounded-lg p-8 text-center">
                <div className="text-gray-400 text-4xl mb-2">🗺️</div>
                <p className="text-gray-600 font-medium">No hay paradas con ubicación</p>
                <p className="text-sm text-gray-500 mt-1">
                    Agrega coordenadas (latitud/longitud) a las organizaciones para verlas en el mapa
                </p>
            </div>
        );
    }

    return (
        <div className="rounded-lg overflow-hidden border shadow-sm">
            <MapContainer
                center={center}
                zoom={bounds ? undefined : 7}
                bounds={bounds}
                boundsOptions={{ padding: [50, 50] }}
                style={{ height: '500px', width: '100%' }}
                scrollWheelZoom={true}
            >
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {validStops.map((stop) => (
                    <Marker
                        key={stop.id}
                        position={[parseFloat(stop.latitude), parseFloat(stop.longitude)]}
                        icon={createNumberedIcon(stop.stop_order, stop.status)}
                    >
                        <Popup>
                            <div className="p-2">
                                <div className="font-bold text-lg mb-1">
                                    {stop.stop_order}. {stop.organization_name}
                                </div>
                                {stop.city && (
                                    <div className="text-sm text-gray-600">
                                        📍 {stop.city}{stop.department && `, ${stop.department}`}
                                    </div>
                                )}
                                {stop.address && (
                                    <div className="text-sm text-gray-600 mt-1">
                                        {stop.address}
                                    </div>
                                )}
                                {stop.notes && (
                                    <div className="text-sm text-gray-700 mt-2 italic">
                                        "{stop.notes}"
                                    </div>
                                )}
                                <div className="mt-2">
                                    <span className={`text-xs px-2 py-1 rounded ${stop.status === 'completada' ? 'bg-green-100 text-green-700' :
                                            stop.status === 'cancelada' ? 'bg-gray-100 text-gray-700' :
                                                'bg-blue-100 text-blue-700'
                                        }`}>
                                        {stop.status === 'completada' ? '✓ Completada' :
                                            stop.status === 'cancelada' ? '✕ Cancelada' :
                                                'Pendiente'}
                                    </span>
                                </div>
                            </div>
                        </Popup>
                    </Marker>
                ))}

                {routeLines.map((line, index) => (
                    <Polyline
                        key={index}
                        positions={line}
                        pathOptions={{
                            color: zoneColor,
                            weight: 3,
                            opacity: 0.7,
                            dashArray: '10, 10'
                        }}
                    />
                ))}
            </MapContainer>
        </div>
    );
}
