# MyLife · Backend

API de finanzas personales y compartidas para MyLife. Este repositorio es independiente del frontend. La API usa Google OpenID Connect y sesiones revocables; todos los datos de negocio están aislados por espacio Personal o CoLife. Escucha en `localhost` por defecto y no debe exponerse a Internet sin una revisión de despliegue.

## Stack y arquitectura

- Node.js 20.19–22.x, TypeScript, Express 5.
- Azure SQL Database; Prisma 6 gestiona el esquema y las migraciones SQL Server.
- Zod valida cuerpos y parámetros. Importes persistidos como `DECIMAL(12,2)`.
- `src/app.ts` monta rutas; `src/server.ts` limita el host y cierra conexiones con elegancia.
- `src/routes/`: autenticación, espacios/miembros, dashboard, categorías, movimientos (`FinancialEntry`), recurrencias, presupuestos, compras, gastos compartidos y liquidaciones.
- `src/lib/date.ts`: periodos UTC, fecha actual de Europe/Madrid y recurrencias mensuales con ajuste al último día del mes.
- Las rutas de negocio requieren sesión, `x-space-id`, membresía activa y `TENANT_DATA_READY=true`; `/api/health` y las rutas de sesión/autenticación son independientes del gate de datos.

## Dominio actual

- Cada usuario dispone de un espacio Personal y puede pertenecer a espacios CoLife. El saldo Personal es ingresos confirmados menos gastos confirmados; cada cuota CoLife se refleja como un gasto Personal derivado.
- Cada categoría es de tipo `INCOME` o `EXPENSE`.
- Los movimientos tienen importe positivo, fecha, categoría, tipo y estado `PENDING`/`CONFIRMED`. `isFixed` conserva el carácter fijo aunque se elimine su regla; los movimientos creados manualmente son variables.
- Las reglas fijas generan un movimiento pendiente por mes. `POST /api/recurring/generate` es repetible: la clave única `(recurringRuleId, scheduledFor)` evita duplicados. Para una regla del día 29–31, febrero usa el último día disponible. La fecha inicial se incluye si ya ha llegado; la final, si existe, también.
- Los presupuestos se definen por categoría de gasto y mes. El gasto ejecutado cuenta solo movimientos confirmados.
- Los gastos CoLife conservan un total de grupo, cuotas por miembro, espejos personales, pagos parciales inmutables, ajustes de reconciliación y auditoría append-only. Una corrección posterior a una liquidación no reescribe el pago ni reabre el saldo ya conciliado; registra el delta por miembro como ajuste.

## Configuración local

### Base de datos nueva (vacía)

Para empezar desde cero, crea primero una base vacía en SQL Server/Azure SQL y ejecuta `prisma/sql/create-database.sql` conectado a esa base. El script crea el esquema final de MyLife —tablas, índices, restricciones y relaciones—, pero no crea el recurso de Azure ni inserta usuarios o datos iniciales. No ejecutes las migraciones encima de esta base: el script ya incluye su resultado. Para que Prisma reconozca ese esquema como baseline, registra las migraciones en orden con `npx prisma migrate resolve --applied <nombre>` (`20261116000000_init`, `20261116010000_shopping`, `20261116020000_shopping_units_purchased`, `20261117000000_identity_tenancy`) y comprueba `npx prisma migrate status`. Una base recién creada no necesita backfill legacy; verifica el esquema y el estado de Prisma antes de habilitar `TENANT_DATA_READY`.

Los pasos siguientes de esta sección describen la preparación de una base existente con datos legacy. No ejecutes el backfill sobre una base vacía creada con el script anterior.

1. Instala Node.js 20.19 o 22 y npm. Copia `.env.example` a `.env` y configura la cadena de conexión solo en tu entorno local; no guardes `.env` en Git.
2. Registra una aplicación OAuth de Google para desarrollo con callback `http://localhost:4000/api/auth/google/callback`. Configura `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OIDC_REDIRECT_URI` y `FRONTEND_ORIGIN` localmente. No compartas ni incluyas credenciales en logs o documentación.
3. Ejecuta `npm install` y `npm run db:generate`. La generación del cliente es local y no migra ni accede por sí misma a la base.
4. Revisa y aplica manualmente, en orden, las migraciones SQL que falten: `20261116000000_init`, `20261116010000_shopping`, `20261116020000_shopping_units_purchased` y `20261117000000_identity_tenancy`. Registra cada migración en Prisma con `npx prisma migrate resolve --applied <nombre>` únicamente después de verificar que su SQL terminó correctamente. La migración de fase 2 añade las columnas tenant como anulables; no activa el gate ni asigna automáticamente datos legacy.
5. Inicia sesión con la cuenta Google verificada. Obtén localmente el `User.id` de esa sesión y úsalo únicamente en `prisma/manual/phase2-backfill-and-finalize.sql`, después de revisar el respaldo, los conteos y que el destino Personal sea el correcto. Este script transaccional es de un solo uso: asigna filas legacy, valida relaciones, vuelve `spaceId` obligatorio y reemplaza índices globales por índices por espacio.
6. Ejecuta `npm run db:seed` para sincronizar las categorías iniciales de los espacios Personales. Verifica manualmente el resultado del backfill y las categorías antes de cambiar `TENANT_DATA_READY=false` a `TENANT_DATA_READY=true` y reiniciar la API.
7. Ejecuta `npm run dev`. API: `http://localhost:4000/api`; salud: `/api/health`.

El gate permanece cerrado por defecto: mientras esté en `false`, las rutas de negocio y espacios rechazan operaciones aunque la autenticación funcione. No lo abras antes de completar la migración y el backfill. Los SQL de fase 2 son guías manuales revisables; no ejecutes `db:migrate`/`db:deploy` a ciegas ni conectes tests a datos personales. No se debe ejecutar esta preparación contra Azure ni contra datos reales sin autorización y revisión explícitas.

La idempotencia de recurrencias usa un índice SQL Server filtrado sobre `(recurringRuleId, scheduledFor)` solo cuando ambos campos no son `NULL`. Prisma no modela ese filtro: conserva el índice al aplicar SQL manual y no lo sustituyas por un `@@unique` no filtrado, que tiene semántica distinta en SQL Server.

### Activar la funcionalidad de Compras en una base existente

Las migraciones de Compras son aditivas. La primera crea las tablas e índices; la siguiente añade el contador de unidades compradas a los tickets ya existentes. No se ejecutan automáticamente contra Azure ni contra datos personales.

Si las tablas de Compras ya existen pero aparece que falta `unitsPurchased`, detén el backend, haz una copia de seguridad y ejecuta **solo** `prisma/migrations/20261116020000_shopping_units_purchased/migration.sql` en la base correcta. El script pone el valor `1` en las líneas antiguas y no pierde sus datos. No vuelvas a ejecutar la migración `20261116010000_shopping`.

Tras ejecutar correctamente el script, registra la migración con `npx prisma migrate resolve --applied 20261116020000_shopping_units_purchased` y reinicia el backend. Si la migración anterior se ejecutó manualmente pero aún no se registró en Prisma, registra primero `20261116010000_shopping` con `npx prisma migrate resolve --applied 20261116010000_shopping`.

Para una base nueva, ejecuta en orden los scripts `20261116010000_shopping` y `20261116020000_shopping_units_purchased`, y registra ambos como aplicados. No ejecutes `db:deploy` sin revisar el estado de la base. Si un script falla, su transacción intenta revertir los cambios; no marques esa migración como aplicada.

No ejecutes `db:deploy` para esta base antes de revisar su estado. Si el script falla, su transacción intenta revertir los cambios; no marques la migración como aplicada y revisa el error antes de reintentar.

## Recursos Azure manuales

Para el nivel gratuito, crea una **Azure SQL Database nueva** desde el flujo **Start free** del Portal. La oferta vigente indica hasta 100.000 vCore-segundos, 32 GB de datos y 32 GB de almacenamiento de copias de seguridad gratis al mes por suscripción, con hasta 10 bases de datos elegibles. Selecciona explícitamente el límite gratuito y `AutoPause` al agotarse la cuota; verifica en el resumen que el coste estimado de la base sea cero antes de confirmar. La base serverless se pausa tras 15 minutos sin actividad; no tiene SLA y puede quedar inaccesible hasta el siguiente mes al consumir la cuota. Confirma la elegibilidad de tu suscripción y revisa cargos de recursos adicionales por separado.

La creación del asistente gratuito crea una base nueva (por ejemplo, `mylife`) en un servidor lógico SQL. Configura acceso desde el equipo local limitando el firewall a tu IP pública y usa autenticación SQL para la API; guarda el usuario y contraseña solo en `.env`. La conexión de ejemplo usa cifrado TLS y `schema=dbo`. Las contraseñas que incluyan caracteres especiales deben escaparse con llaves en la URL de Prisma. La primera conexión puede tardar mientras Azure reanuda la base pausada.

No hay plantillas de infraestructura, automatización de aprovisionamiento ni pipelines. El servidor Azure sigue generando coste aunque no uses la app: al terminar, exporta/respáldalo si quieres conservar datos, y detén o elimina el servidor desde el Portal. Un borrado puede ser irreversible; verifica antes.

## Contrato API (resumen)

Prefijo `/api`; JSON; errores `{ "error": "..." }` (validación incluye `details`). Fechas `YYYY-MM-DD`; mes `YYYY-MM`. Las rutas de dominio requieren cookie de sesión, `x-space-id`, membresía activa y gate habilitado. Las rutas `/spaces` usan su ID de ruta y verifican membresía; autenticación y salud no dependen del gate.

| Método y ruta | Uso |
|---|---|
| `GET /health` | Estado del proceso. |
| `GET /auth/session`, `GET /auth/google/login`, `POST /auth/logout` | Consultar sesión, iniciar OIDC y cerrar la sesión actual. |
| `GET /spaces`, `POST /spaces`, `PATCH /spaces/:spaceId` | Listar/crear CoLife y cambiar su nombre. |
| `POST /spaces/invitations/accept`, `GET/PATCH /spaces/:spaceId/invitation`, `POST /spaces/:spaceId/invitation/rotate` | Aceptar invitación, consultar/abrir/cerrar o rotar el enlace reutilizable (administradores). |
| `/spaces/:spaceId/members...`, `/spaces/:spaceId/archive`, `/spaces/:spaceId/audit` | Administrar membresías/roles, salir, archivar/restaurar y consultar auditoría. |
| `GET/POST /shared-expenses`, `GET/PATCH/DELETE /shared-expenses/:id` | Consultar, registrar, editar y revertir gastos y sus cuotas CoLife. |
| `GET /settlements/balance`, `GET/POST /settlements` | Consultar saldos/sugerencias e historial; registrar pagos parciales inmutables. |
| `GET /dashboard?month=YYYY-MM` | Resumen mensual, saldo confirmado acumulado, desglose fijo/variable, categorías y movimientos recientes. |
| `GET /categories`, `POST /categories` | Listar y crear categorías. Alta: `{name,type,color?,icon?}`. |
| `GET /entries?...` | Lista paginada; filtros `from`, `to`, `type`, `status`, `categoryId`, `recurring`, `page`, `pageSize`. |
| `POST /entries` | Crear movimiento variable: `{type,amount,description,date,categoryId,status?}`. |
| `PATCH /entries/:id/confirm`, `DELETE /entries/:id` | Confirmar o borrar movimiento. |
| `GET /recurring`, `POST /recurring` | Consultar/crear regla mensual; alta `{type,amount,description,categoryId,startDate,endDate?}`. |
| `POST /recurring/generate` | Generar movimientos pendientes vencidos, de forma idempotente. |
| `PATCH /recurring/:id` | Cambiar `{active:boolean}`. `DELETE /recurring/:id` elimina la regla; los movimientos conservan su marca fija histórica. |
| `GET /budgets?month=YYYY-MM`, `PUT /budgets` | Consultar/guardar límite por categoría. Alta `{categoryId,month,limitAmount}`; respuesta de consulta añade `spent`. |
| `DELETE /budgets/:id` | Eliminar presupuesto. |
| `GET /shopping/supermarkets?includeArchived=true`, `POST /shopping/supermarkets`, `PATCH /shopping/supermarkets/:id` | Listar, crear, archivar o restaurar supermercados. |
| `GET /shopping/products?q=...&includeArchived=true`, `POST /shopping/products`, `PATCH /shopping/products/:id` | Buscar, crear, archivar o restaurar productos genéricos; la búsqueda incluye variantes y sus últimos datos de compra. |
| `GET /shopping/list`, `POST /shopping/list`, `PATCH /shopping/list/:id`, `DELETE /shopping/list/:id` | Gestionar la lista pendiente; el borrado del elemento equivale a marcarlo como comprado. |
| `GET /shopping/receipts`, `POST /shopping/receipts`, `PATCH /shopping/receipts/:id`, `DELETE /shopping/receipts/:id` | Consultar y mantener tickets con líneas, tienda, fecha, categoría, ajuste y total; crear/actualizar/eliminar el movimiento enlazado en la misma transacción. |
| `GET /shopping/compare/:productId` | Devolver el precio comparable más reciente por variante y tienda, la mejor variante por tienda y observaciones de los últimos 12 meses. |

Cada línea acepta el número de unidades/envases comprados, la cantidad contenida en cada unidad y el importe total pagado por todas ellas; así no es necesario repetir un mismo producto. Las cantidades agregadas de peso y volumen se normalizan internamente a gramos y mililitros; también se conserva la unidad introducida para editar el ticket. La comparación se expresa en €/kg, €/l o €/unidad según la primera compra registrada para el producto genérico. El ticket crea un único gasto confirmado por su total final, no un movimiento por producto. Las operaciones de ticket y movimiento son atómicas; no edites ni elimines desde `/entries` un movimiento enlazado a un ticket.

El origen CORS se limita a `FRONTEND_ORIGIN` y se usan cookies con credenciales, CSRF y validación exacta de `Origin` para mutaciones. La API aún está diseñada para desarrollo local; la autenticación no sustituye una revisión de TLS, cookies, secretos, límites de acceso, backups y observabilidad antes de desplegar.

### Identidad, espacios y CoLife

- `GET /api/auth/session`, `GET /api/auth/google/login`, `GET /api/auth/google/callback` y `POST /api/auth/logout` gestionan sesión Google.
- `/api/spaces` permite listar/crear espacios; las rutas por espacio gestionan invitaciones, rotación del enlace reutilizable, miembros, roles, archivo/restauración, nombre y auditoría. El token solo se entrega al crear/rotar y se persiste como hash. Aceptar invitación requiere una sesión autenticada.
- Todas las rutas de negocio envían `x-space-id`; ese espacio se valida contra una membresía activa. Los cambios requieren CSRF y el origen configurado.
- `/api/shared-expenses` gestiona gastos/repartos CoLife; `/api/settlements` registra pagos parciales separados y expone saldos/historial. Las correcciones tras liquidaciones crean `SettlementAdjustment` inmutables y eventos de auditoría.
- Los cambios de gasto/ticket conservan pagos históricos. Las ocurrencias recurrentes CoLife quedan pendientes y no crean cuota Personal hasta confirmarse; una regla se pausa al salir un pagador o participante para no cargarle cuotas futuras.

## Comandos

- `npm run dev`: API con recarga.
- `npm run build` / `npm start`: compilar / iniciar.
- `npm run typecheck`, `npm run lint`, `npm test`.
- `npm run db:migrate`, `npm run db:seed`, `npm run db:studio`.

## Evolución futura

Cuentas múltiples, exportación/importación y análisis de tendencias requieren sus propios cambios de dominio y permisos. Mantén autorización y aislamiento en backend; no dependas de ocultar funciones en el frontend.