import React, { useMemo } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

function coordinates(stop) {
  const latitude = Number(stop.latitude_snapshot ?? stop.latitude);
  const longitude = Number(stop.longitude_snapshot ?? stop.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? [latitude, longitude] : null;
}

function numberedIcon(number, status) {
  const color = status === 'completada' || status === 'completed'
    ? '#047857'
    : status === 'cancelada' || status === 'cancelled'
      ? '#64748b'
      : '#0f766e';
  return L.divIcon({
    className: '',
    html: '<div style="width:30px;height:30px;border-radius:50%;background:' + color + ';border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:white;font-weight:700">' + number + '</div>',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15],
  });
}

export default function RouteMap({ stops = [] }) {
  const locatedStops = useMemo(() => stops.map((stop) => ({ ...stop, point: coordinates(stop) })).filter((stop) => stop.point), [stops]);
  const bounds = locatedStops.length > 1 ? locatedStops.map((stop) => stop.point) : undefined;
  const center = locatedStops[0]?.point || [-25.3, -57.57];
  const line = locatedStops.map((stop) => stop.point);

  if (!locatedStops.length) {
    return <div className="rounded border border-dashed p-10 text-center">
      <div className="font-medium text-gray-700">Sin coordenadas exactas</div>
      <div className="mt-1 text-sm text-gray-500">El recorrido puede planificarse por ciudad, pero necesita latitud y longitud para dibujar las paradas.</div>
    </div>;
  }

  return <div className="overflow-hidden rounded border">
    <MapContainer center={center} zoom={locatedStops.length === 1 ? 13 : 10} bounds={bounds} boundsOptions={{ padding: [35, 35] }} style={{ height: 430, width: '100%' }} scrollWheelZoom>
      <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {locatedStops.map((stop) => <Marker key={stop.id || stop.location_key} position={stop.point} icon={numberedIcon(stop.stop_order || locatedStops.indexOf(stop) + 1, stop.status || stop.visit_status)}>
        <Popup><div className="min-w-[190px]"><strong>{stop.organization_name}</strong><div>{stop.branch_name || stop.location_name || 'Casa matriz'}</div><div>{stop.address_snapshot || stop.address || ''}</div></div></Popup>
      </Marker>)}
      {line.length > 1 && <Polyline positions={line} pathOptions={{ color: '#0f766e', weight: 4, opacity: 0.75 }} />}
    </MapContainer>
  </div>;
}
