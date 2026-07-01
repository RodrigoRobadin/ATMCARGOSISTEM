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

En `cmd`:

```cmd
set EXPO_PUBLIC_API_URL=http://TU-IP-LAN:4000/api
npx.cmd expo start -c
```

En telefono fisico, no usar `localhost` para la API: usar la IP LAN del equipo donde corre el backend.

## Flujo operativo

La pestana **Operar** permite elegir **ATM CARGO** o **ATM INDUSTRIAL**. La app autocompleta organizaciones/contactos, permite elegir etapa del pipeline, crea una operacion real con referencia `OP-...`, guarda datos base como custom fields y sube fotos, imagenes o documentos directamente a la operacion.

ATM CARGO carga modalidad, tipo de carga, origen/destino con sugerencias, mercaderia, cantidad, unidad, peso, volumen y notas. ATM INDUSTRIAL carga cliente, etapa, marca y notas. Costos, precio de venta, moneda y cotizacion completa siguen definiendose desde la web.

La pestana **Operaciones** permite buscar operaciones, abrir el detalle mobile por secciones, cambiar etapa, completar datos importantes para cotizar mas tarde y adjuntar fotos, imagenes o documentos sobre la misma operacion. El detalle usa `GET /api/mobile/operations/:id`, que devuelve `deal`, `custom_fields`, `files`, `stages`, `detail_kind`, `cargo_detail`, `industrial_doors`, `catalog_products` y `catalog_services` para espejar la estructura que ya usa la web.

En operaciones industriales, los productos se guardan en `industrial_doors` y sus imagenes se suben a `uploads/industrial-doors/:doorId/` mediante `industrial_door_images`. Los adjuntos generales de la operacion se guardan aparte en `deal_files`, por lo que una foto cargada dentro de un producto queda asignada a ese producto y no como adjunto general.
