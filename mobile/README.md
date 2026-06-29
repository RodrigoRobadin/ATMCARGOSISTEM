# ATMCARGOSISTEM Mobile

App movil MVP para Android e iOS construida con Expo.

## Desarrollo

```powershell
cd mobile
npm install
npx expo start
```

Configurar `EXPO_PUBLIC_API_URL` cuando se use una API distinta al dominio de produccion:

```powershell
$env:EXPO_PUBLIC_API_URL="http://TU-IP-LAN:4000/api"
npx expo start
```

En telefono fisico, no usar `localhost` para la API: usar la IP LAN del equipo donde corre el backend.

## Flujo operativo

La pestaña **Nueva operacion** permite elegir **ATM CARGO** o **ATM INDUSTRIAL**. La app autocompleta organizaciones/contactos, crea una operacion real en el backend con referencia `OP-...`, guarda datos base como custom fields, crea un borrador de cotizacion rapida asociado y luego abre adjuntos para cargar imagenes o documentos sobre la operacion.
