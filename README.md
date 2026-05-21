# Cariana Notifications Center

Aplicacion embebida de Shopify para notificaciones push con:

- Eventos automaticos de pedidos y reembolsos.
- Integracion de devoluciones.
- Deteccion de carritos abandonados (1h, 24h, 3d).
- Campanas manuales segmentadas.
- Integracion FCM para Android.
- Dashboard administrativo con metricas e historial.

## Stack

- Node.js + Express
- PostgreSQL
- Firebase Cloud Messaging
- Shopify Webhooks + OAuth base

## 1) Variables de entorno

1. Copia `.env.example` a `.env`.
2. Completa:
   - `DATABASE_URL`
   - `SHOPIFY_API_KEY`
   - `SHOPIFY_API_SECRET`
   - `SHOPIFY_APP_URL` (en desarrollo la URL de `shopify app dev`)
   - `APP_INTERNAL_API_KEY`
   - `FIREBASE_SERVICE_ACCOUNT_JSON` (JSON completo en una sola linea o escapado)

## 2) Instalar dependencias

```bash
npm install
```

## 3) Levantar PostgreSQL (opcional con Docker)

```bash
docker compose up -d
```

Conexion por defecto:

- `postgres://postgres:postgres@localhost:5432/cariana_notifications`

## 4) Migraciones y seed

```bash
npm run db:migrate
npm run db:seed
```

## 5) Ejecutar servidor

```bash
npm run dev
```

Servidor local:

- `GET /health`
- `GET /` panel administrativo inicial.

## 6) Shopify CLI

Este repositorio ya incluye:

- `shopify.app.centro-de-notificaciones.toml`
- `shopify.web.toml`

Ejecuta:

```bash
shopify app dev --config shopify.app.centro-de-notificaciones.toml --reset --store <tu-tienda>.myshopify.com
```

## Endpoints clave

### Webhooks Shopify

- `POST /webhooks/shopify`
  - `orders/create`
  - `orders/updated`
  - `orders/fulfilled`
  - `orders/cancelled`
  - `refunds/create`
  - `checkouts/update`

Prueba local de webhook firmado:

```bash
npm run test:webhook
```

### Android / Mobile

- `POST /api/mobile/register-token`
- `POST /api/mobile/unregister-token`
- `POST /api/mobile/notifications/opened`
- `POST /api/mobile/notifications/converted`

### Campanas y panel

- `GET /api/dashboard/metrics`
- `GET /api/dashboard/history`
- `GET /api/campaigns`
- `POST /api/campaigns`
- `POST /api/campaigns/:id/send`
- `GET /api/templates`
- `POST /api/templates`

### Devoluciones

- `POST /api/returns/events`

Payload esperado:

```json
{
  "shopDomain": "tu-tienda.myshopify.com",
  "event": {
    "return_reference": "RMA-1009",
    "shopify_customer_id": 123456789,
    "status": "approved"
  }
}
```

### Estado manual de pedido

- `POST /api/orders/manual-status`

Estados soportados:

- `confirmed`
- `preparing`
- `shipped`
- `in_transit`
- `delivered`
- `cancelled`

## Seguridad implementada

- Validacion HMAC de webhooks Shopify.
- Dedupe por `X-Shopify-Webhook-Id`.
- API key interna (`x-api-key`) para endpoints de administracion/mobile.

## Scheduler (cron)

- Cada 10 min: carritos abandonados.
- Cada 1 min: campanas programadas.
- Diario 03:00: limpieza de tokens invalidados.
