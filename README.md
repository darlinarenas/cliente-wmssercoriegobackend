# Backend PostgreSQL · SercoRiego Lite WMS

Backend Node/Express preparado para PostgreSQL. Conserva la lógica y datos de la versión congelada y añade autenticación real, usuarios administrables, persistencia PostgreSQL y control de concurrencia por revisión.

En esta etapa de desarrollo las contraseñas se almacenan temporalmente sin
transformación, de acuerdo con la configuración actual del proyecto. Antes de
producción comercial deben migrarse a hash seguro.

## 1. Configuración

1. Copia `.env.example` a `.env` solo en el equipo local. En Render configura
   las mismas claves como variables de entorno.
2. Coloca tu `DATABASE_URL` de PostgreSQL.
3. Cambia `JWT_SECRET` por una clave larga y aleatoria.
4. Define `FRONTEND_ORIGIN` con la URL real del frontend. Se pueden separar varios orígenes por coma.
5. Ejecuta `npm install`.
6. Ejecuta `npm run db:init` para crear tablas y cargar el inventario inicial.
7. Ejecuta `npm start`.

El servidor también ejecuta la inicialización de esquema al arrancar, por lo que `db:init` es recomendable pero no obligatorio.

No subas ni compartas el archivo `.env`.

## Credenciales iniciales

- Usuario: `admin`
- Contraseña: `SercoRiego2026!`

Estas credenciales pueden cambiarse con `ADMIN_USERNAME` y `ADMIN_PASSWORD` antes del primer arranque. Cambia la contraseña del administrador después de ingresar.

## Rutas principales

- `GET /api/health`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/change-password`
- `GET/POST/PUT /api/users` (solo administrador)
- `GET /api/state`
- `PUT /api/state`
- CRUD autenticado: `/api/products`, `/api/inventory`, `/api/racks`, `/api/locations`, `/api/pallets`, `/api/receipts`, `/api/transfers`, `/api/movements`, `/api/audit`, `/api/sites`, `/api/sectors`.

`PUT /api/state` se ejecuta dentro de una transacción PostgreSQL y usa `meta.revision` para evitar que dos equipos sobrescriban silenciosamente cambios concurrentes.
