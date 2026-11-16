# MyLife · Backend

API local de finanzas personales para el frontend de MyLife. Este repositorio es independiente del frontend. La app no tiene autenticación en esta fase: escucha en `127.0.0.1` por defecto y no debe exponerse a Internet.

## Stack y arquitectura

- Node.js 20.19–22.x, TypeScript, Express 5.
- Azure SQL Database; Prisma 6 gestiona el esquema y las migraciones SQL Server.
- Zod valida cuerpos y parámetros. Importes persistidos como `DECIMAL(12,2)`.
- `src/app.ts` monta rutas; `src/server.ts` limita el host y cierra conexiones con elegancia.
- `src/routes/`: dashboard, categorías, movimientos (`FinancialEntry`), recurrencias y presupuestos.
- `src/lib/date.ts`: periodos UTC, fecha actual de Europe/Madrid y recurrencias mensuales con ajuste al último día del mes.

## Dominio actual

- Una cuenta personal lógica: el saldo es ingresos confirmados menos gastos confirmados, acumulado desde el inicio. No hay transferencias ni cuentas múltiples.
- Cada categoría es de tipo `INCOME` o `EXPENSE`.
- Los movimientos tienen importe positivo, fecha, categoría, tipo y estado `PENDING`/`CONFIRMED`. `isFixed` conserva el carácter fijo aunque se elimine su regla; los movimientos creados manualmente son variables.
- Las reglas fijas generan un movimiento pendiente por mes. `POST /api/recurring/generate` es repetible: la clave única `(recurringRuleId, scheduledFor)` evita duplicados. Para una regla del día 29–31, febrero usa el último día disponible. La fecha inicial se incluye si ya ha llegado; la final, si existe, también.
- Los presupuestos se definen por categoría de gasto y mes. El gasto ejecutado cuenta solo movimientos confirmados.
- No se modelan hogares/usuarios compartidos hasta que se implemente autenticación en una fase futura.

## Configuración local

1. Instala Node.js 20.19 o 22 y npm.
2. Copia `.env.example` a `.env` y sustituye los datos de conexión. No guardes `.env` en Git.
3. En Azure SQL, configura el firewall para permitir solo tu IP pública actual. Usa autenticación SQL y TLS; no uses las credenciales administrativas del servidor para la aplicación.
4. `npm install` y `npm run db:generate`. Para una base nueva, ejecuta una sola vez `prisma/migrations/20261116000000_init/migration.sql` desde el editor SQL conectado a la base `mylife`; después, desde `backend`, registra que ya se aplicó con `npx prisma migrate resolve --applied 20261116000000_init` y carga categorías con `npm run db:seed`.
5. `npm run dev`. API: `http://127.0.0.1:4000/api`; salud: `/api/health`.

No ejecutes `db:deploy` para la migración inicial si ya la aplicaste a mano: primero debes registrarla con `migrate resolve`, para evitar que Prisma intente crear las tablas otra vez. La migración inicial SQL Server corresponde a una base nueva y no migra datos de PostgreSQL. No apuntes los tests a datos personales.

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

Prefijo `/api`; JSON; errores `{ "error": "..." }` (validación incluye `details`). Fechas `YYYY-MM-DD`; mes `YYYY-MM`.

| Método y ruta | Uso |
|---|---|
| `GET /health` | Estado del proceso. |
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

El origen CORS se limita a `FRONTEND_ORIGIN`. En producción, el API aún requiere autenticación antes de exponerse.

## Comandos

- `npm run dev`: API con recarga.
- `npm run build` / `npm start`: compilar / iniciar.
- `npm run typecheck`, `npm run lint`, `npm test`.
- `npm run db:migrate`, `npm run db:seed`, `npm run db:studio`.

## Fase futura

Autenticación, separación de datos por usuario, invitaciones/hogares, gastos compartidos y cuentas múltiples. Diseñar esas migraciones junto con el modelo de permisos; no confiar en ocultar funciones solo en el frontend.