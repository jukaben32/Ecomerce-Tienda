# ModaNueva · Tienda online

Tienda de ropa y accesorios hecha con **HTML + Tailwind CSS + JavaScript** y **Supabase** (Postgres + Auth + Storage). No tiene servidor propio: el navegador habla directo con Supabase y la seguridad la dan las reglas RLS de la base de datos.

> Proyecto adaptado a partir de [Cristiancano1236/Ecommerce-node.js](https://github.com/Cristiancano1236/Ecommerce-node.js).

## Qué incluye

**Tienda (`/`)**
- Catálogo con categorías, búsqueda, descuentos y stock en vivo
- Carrito, registro e inicio de sesión
- Checkout con dirección (libreta de direcciones), medio de pago, notas y envío calculado
- Horario de domicilios (avisa si el pedido llega fuera de horario)
- Volantes / promociones en la portada
- Perfil: mis compras, direcciones, datos y contraseña
- Calificación de pedidos entregados
- **Asistente con IA**: escribe tu pedido o sube la foto de tu lista y llena el carrito (OpenRouter)
- Pago con tarjeta en línea (Stripe) o transferencia bancaria

**Panel admin (`/admin.html`)**
- Resumen de ventas (por día, medio de pago, más vendidos, calificación)
- Órdenes: filtros, cambio de estado (devuelve stock al cancelar), detalle y ticket imprimible
- Nuevo pedido a nombre de un cliente
- Productos: crear/editar, descuentos, **importar Excel/CSV** con vista previa
- Categorías, Clientes y equipo (roles), Calificaciones
- Promociones, Medios (subir imágenes), Configuración (horario, envío, mínimo, pagos, ticket)
- Asistente IA: contexto que usa el chat e incidencias (preguntas que la IA no supo responder)
- Link de pago de Stripe para cualquier orden pendiente

## Estructura

```
public/
  index.html, admin.html
  js/
    config.js, supabaseClient.js, util.js, configuracion.js
    tienda.js, checkout.js, compras.js, direcciones.js, promos.js     (tienda)
    admin.js + admin/*.js                                            (un módulo por pestaña)
supabase/
  schema.sql                    Tablas base, vista, seguridad RLS y datos de ejemplo
  migrations/002_nivel_pro.sql  Direcciones, configuración, calificaciones, promociones, reportes, storage
  migrations/003_chat_y_pagos.sql  Límite de uso del chat y columnas de pago con Stripe
  functions/chat/               Edge Function: asistente con IA (OpenRouter)
  functions/crear-pago/         Edge Function: crea la sesión de pago de Stripe
  functions/stripe-webhook/     Edge Function: confirma el pago (verifica la firma de Stripe)
```

## Puesta en marcha

1. **Base de datos:** Supabase > SQL Editor. Ejecuta, en este orden:
   1. `supabase/schema.sql`
   2. `supabase/migrations/002_nivel_pro.sql`
   3. `supabase/migrations/003_chat_y_pagos.sql`
2. **Conexión:** pon tu *Project URL* y *anon key* en `public/js/config.js`
   (Supabase > Project Settings > API). **Nunca** pongas la `service_role key` ahí.
3. **Probar en local:** `npm run dev` y abre http://localhost:3000
4. **Crear tu admin:** regístrate en la tienda y luego, en el SQL Editor:
   ```sql
   update public.perfiles set rol = 'admin' where correo = '<tu-correo>';
   ```
   Después entra a `/admin.html`.

> Si Supabase pide confirmar el correo al registrarte y no lo quieres en pruebas:
> Authentication > Providers > Email > desactiva "Confirm email".

## Seguridad

- Visitantes: solo leen productos, categorías, promociones y configuración públicos.
- Cada cliente ve únicamente sus pedidos, direcciones y perfil.
- El **rol** no se puede cambiar desde el navegador (solo con `cambiar_rol`, exclusiva de admins).
- Las compras pasan por `crear_orden`, que valida medios de pago, mínimo y horario, calcula precios con descuento y envío, y descuenta stock en una sola transacción. El navegador no puede fijar precios.
- Las imágenes se suben a un bucket público `medios`; solo un admin puede subir o borrar.
- El webhook de Stripe verifica la firma HMAC, rechaza eventos viejos y comprueba que el monto cobrado sea el total de la orden.

## Chat con IA y pagos (Edge Functions)

Las llaves **nunca** van en el código ni en el navegador: se guardan como *secretos* de Supabase
(Project Settings > Edge Functions > Secrets, o `supabase secrets set`).

| Secreto | Para qué |
|---|---|
| `OPENROUTER_API_KEY` | Chat con IA (https://openrouter.ai/keys) |
| `OPENROUTER_MODEL` | Opcional. Por defecto `anthropic/claude-haiku-5.5` |
| `STRIPE_SECRET_KEY` | Pagos con tarjeta (`sk_test_…` para pruebas, `sk_live_…` en producción) |
| `STRIPE_WEBHOOK_SECRET` | Firma del webhook (`whsec_…`) |
| `SITE_URLS` | Dominios de tu tienda separados por coma (a dónde vuelve Stripe tras pagar). Ej: `http://localhost:3000,https://mitienda.com` |

Despliegue (con la CLI de Supabase): `supabase functions deploy chat` · `supabase functions deploy crear-pago` ·
`supabase functions deploy stripe-webhook --no-verify-jwt`

**Webhook de Stripe:** Developers > Webhooks > Add endpoint
- URL: `https://<tu-proyecto>.supabase.co/functions/v1/stripe-webhook`
- Evento: `checkout.session.completed`
- Copia el *Signing secret* (`whsec_…`) al secreto `STRIPE_WEBHOOK_SECRET`.

**Activar la tarjeta:** cuando Stripe esté configurado, en el admin > Configuración marca «Tarjeta».
Hasta entonces los clientes solo ven efectivo y transferencia.

**Seguridad del chat:** exige sesión iniciada, limita 40 mensajes por usuario y hora, y la IA nunca crea pedidos:
solo llena el carrito (el cliente confirma dirección y pago en el checkout).

## Importar productos (Excel / CSV)

Descarga la plantilla desde Productos > "Descargar plantilla". Columnas obligatorias: `sku`, `nombre`, `precio`. Opcionales: `descripcion`, `existencias`, `categoria` (nombre o slug), `activo`, `imagen_url`. Si el SKU ya existe se actualiza.

## Pendiente

- Actualizar precios con IA (por ejemplo, subir un % por categoría con lenguaje natural)
- Pedidos de clientes sin cuenta (teléfono / WhatsApp)

## Publicarla

Es un sitio estático: sube la carpeta `public/` a Netlify, Vercel, Cloudflare Pages o GitHub Pages.
