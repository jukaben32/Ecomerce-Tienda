# ModaNueva · Tienda online

**En producción: https://modanueva.vercel.app**

Tienda de ropa y accesorios hecha con **HTML + Tailwind CSS + JavaScript** y **Supabase** (Postgres + Auth + Storage). No tiene servidor propio: el navegador habla directo con Supabase y la seguridad la dan las reglas RLS de la base de datos.

> Proyecto adaptado a partir de [Cristiancano1236/Ecommerce-node.js](https://github.com/Cristiancano1236/Ecommerce-node.js).

## Qué incluye

**Tienda (`/`)**
- Catálogo con categorías, búsqueda, descuentos y stock en vivo
- Carrito, registro e inicio de sesión
- Checkout con dirección (libreta de direcciones), medio de pago, notas y envío calculado
- Horario de domicilios (avisa si el pedido llega fuera de horario)
- Volantes / promociones en la portada
- Portada con secciones alimentadas por tus datos reales: **categorías**, **cómo ordenar** (asistente o WhatsApp), **calificaciones de clientes** (solo primer nombre), **medios de pago**, **entregas y horario**, **tu opinión** y pie con redes
- Botón flotante de **WhatsApp** (aparece al configurar tu número) y formulario de **quejas, reclamos y sugerencias**
- SEO: datos estructurados (JSON-LD) con tu horario, teléfono y calificación, imagen para compartir, sitemap
- Perfil: mis compras, direcciones, datos y contraseña
- Calificación de pedidos entregados
- **Asistente con IA**: escribe tu pedido o sube la foto de tu lista y llena el carrito (OpenRouter)
- **Medios de pago pensados para República Dominicana** (el admin activa o desactiva cada uno):
  - Contra entrega: **efectivo** y **tarjeta con datáfono**
  - Anticipado: **transferencia bancaria** (el cliente sube el comprobante, también por WhatsApp) y **tarjeta en línea** (Stripe)
- Moneda **peso dominicano (RD$)**, hora de Santo Domingo

**Panel admin (`/admin.html`)**
- Resumen de ventas (por día, medio de pago, más vendidos, calificación)
- Órdenes: filtros, cambio de estado (devuelve stock al cancelar), detalle y ticket imprimible
- Nuevo pedido a nombre de un cliente **con o sin cuenta** (pedidos por teléfono / WhatsApp)
- **Pedido desde WhatsApp con IA**: pega el mensaje del cliente (o una captura) y la IA rellena productos, dirección, teléfono y medio de pago; reconoce al cliente por su teléfono. Tú revisas y confirmas
- **Precios con IA**: escribe «sube 10% los pantalones» o «15% de descuento en accesorios»; ves una vista previa, eliges qué aplicar y puedes **deshacer** (historial de cambios)
- Productos: crear/editar, descuentos, **importar Excel/CSV** con vista previa
- Categorías, Clientes y equipo (roles), Calificaciones
- Promociones, Medios (subir imágenes), Configuración (horario, envío, mínimo, pagos, ticket)
- **Mensajes**: bandeja de quejas, reclamos y sugerencias de clientes (nuevas / leídas / resueltas)
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
  migrations/004_cancelar_pagos_vencidos.sql  Cancela pagos con tarjeta abandonados y devuelve el stock
  migrations/005_republica_dominicana.sql     Moneda DOP, datáfono y comprobantes de transferencia
  migrations/006_clientes_sin_cuenta_y_precios.sql  Clientes sin cuenta e historial de precios (deshacer)
  migrations/007_secciones_publicas.sql  Calificaciones públicas sin datos personales, mensajes de clientes, redes y cobertura
  functions/chat/               Edge Function: asistente con IA (OpenRouter)
  functions/crear-pago/         Edge Function: crea la sesión de pago de Stripe
  functions/stripe-webhook/     Edge Function: confirma el pago (verifica la firma de Stripe)
  functions/interpretar-pedido/ Edge Function (solo admin): lee un mensaje de WhatsApp y propone el pedido
  functions/ajustar-precios/    Edge Function (solo admin): convierte una instrucción en una vista previa de precios
```

## Puesta en marcha

1. **Base de datos:** Supabase > SQL Editor. Ejecuta, en este orden:
   1. `supabase/schema.sql`
   2. `supabase/migrations/002_nivel_pro.sql`
   3. `supabase/migrations/003_chat_y_pagos.sql`
   4. `supabase/migrations/004_cancelar_pagos_vencidos.sql`
   5. `supabase/migrations/005_republica_dominicana.sql`  (pone moneda DOP y hora de Santo Domingo)
   6. `supabase/migrations/006_clientes_sin_cuenta_y_precios.sql`
   7. `supabase/migrations/007_secciones_publicas.sql`
2. **Conexión:** pon tu *Project URL* y *anon key* en `public/js/config.js`
   (Supabase > Project Settings > API). **Nunca** pongas la `service_role key` ahí.
3. **Probar en local:** `npm install` y luego `npm run dev` (compila el CSS y abre http://localhost:3000).
   Si cambias estilos, `npm run watch` recompila solo.
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
`supabase functions deploy interpretar-pedido` · `supabase functions deploy ajustar-precios` ·
`supabase functions deploy stripe-webhook --no-verify-jwt`

**Webhook de Stripe:** Developers > Webhooks > Add endpoint
- URL: `https://<tu-proyecto>.supabase.co/functions/v1/stripe-webhook`
- Evento: `checkout.session.completed`
- Copia el *Signing secret* (`whsec_…`) al secreto `STRIPE_WEBHOOK_SECRET`.

**Activar la tarjeta:** cuando Stripe esté configurado, en el admin > Configuración marca «Tarjeta».
Hasta entonces los clientes solo ven efectivo y transferencia.

**Cuenta de Stripe compartida con otros proyectos:** cada pago de ModaNueva lleva la marca `tienda=modanueva` y el webhook
ignora todo lo que no la tenga, así que no se mezcla con los pagos de tus otros proyectos (y viceversa).

**Pagos abandonados:** un pedido con tarjeta sin pagar tras 26 horas se cancela solo y devuelve el stock (tarea `pg_cron`, migración 004).

**Seguridad del chat:** exige sesión iniciada, limita 40 mensajes por usuario y hora, y la IA nunca crea pedidos:
solo llena el carrito (el cliente confirma dirección y pago en el checkout).

## Pedidos por WhatsApp y precios con IA (solo administradores)

**Nuevo pedido > «Pedido desde WhatsApp (IA)»**: pega lo que escribió el cliente («dame 2 blusas y una gorra, mi cel 809…,
mándalo a Calle Duarte 15») o sube una captura. La IA busca los productos en tu catálogo, rellena el formulario y te marca
lo que debes confirmar (talla, productos que no existen…). Si el teléfono ya es de un cliente, lo selecciona solo; si es nuevo,
un botón lo registra como **cliente sin cuenta**. Nada se crea hasta que pulsas «Crear pedido».

**Precios IA**: la IA solo interpreta tu instrucción como una regla (qué productos, qué operación, qué valor). Las cuentas y el
redondeo los hace el servidor, ves una vista previa con antes/después y eliges qué filas aplicar. Cada cambio queda en el
historial y se puede **deshacer** (si editaste un producto a mano después, el deshacer no lo pisa).

Ambas funciones exigen rol admin, tienen límite de uso por hora y nunca modifican datos por sí solas.

## Pagos: transferencia y contra entrega

En el admin > **Configuración** > *Medios de pago* marcas cuáles ve el cliente:

| Medio | Cómo funciona |
|---|---|
| Efectivo contra entrega | El cliente paga al recibir. |
| Tarjeta contra entrega (datáfono) | El mensajero lleva el datáfono. |
| Transferencia bancaria | Al pedir, el cliente ve la cuenta (la escribes en *Datos para la transferencia*) y sube la foto del comprobante. Tú lo ves en Órdenes (botón **Comprobante**) y cambias el estado a *pagada*. |
| Tarjeta en línea | Pago seguro con Stripe; se marca *pagada* sola. |

Los comprobantes se guardan en un bucket **privado**: solo el cliente dueño y los administradores pueden verlos
(el admin los abre con un enlace temporal de 2 minutos). Escribe tu número en *WhatsApp* para que el cliente
también pueda enviarlo por ahí.

## Importar productos (Excel / CSV)

Descarga la plantilla desde Productos > "Descargar plantilla". Columnas obligatorias: `sku`, `nombre`, `precio`. Opcionales: `descripcion`, `existencias`, `categoria` (nombre o slug), `activo`, `imagen_url`. Si el SKU ya existe se actualiza.

## Privacidad de las calificaciones y mensajes

- La tabla `calificaciones` es privada. La portada usa la función `resumen_calificaciones()`, que solo devuelve estrellas, comentario
  y el **primer nombre** del cliente (nunca apellido, correo ni teléfono).
- Los mensajes de clientes (`sugerencias`) solo se crean con `enviar_sugerencia()`: exige sesión y limita a 5 por usuario cada 24 h.
  Solo los administradores pueden leerlos.

## Si cambias de dominio

Además de lo indicado arriba, actualiza las URLs absolutas de `public/index.html` (canonical, `og:url`, `og:image`, JSON-LD),
`public/sitemap.xml` y `public/robots.txt`.

## Notas

- `supabase/schema.sql` trae valores de ejemplo en COP; la migración 005 los convierte a RD$.
- Posibles mejoras futuras: notificar pedidos nuevos por WhatsApp, factura con comprobante fiscal (e-CF / NCF).

## Publicación (Vercel)

Es un sitio estático. Vercel ejecuta `npm run build` (compila Tailwind a `public/css/`) y sirve la carpeta `public/`.
El repositorio está conectado: **cada `git push` a `main` se publica solo**.

`vercel.json` ya trae las cabeceras de seguridad (CSP estricta, HSTS, `nosniff`, `frame-ancestors 'none'`…), URLs limpias
(`/admin`), `noindex` para el panel y la caché con revalidación.

**Al cambiar de dominio** (por ejemplo uno propio como `mitienda.com`) hay que actualizar 4 sitios:
1. Vercel > Project > Settings > Domains: agregar el dominio.
2. Supabase > Authentication > URL Configuration: *Site URL* y *Redirect URLs*.
3. Secreto `SITE_URLS` de las Edge Functions (a dónde vuelve Stripe tras pagar).
4. `connect-src` en `vercel.json` solo cambia si cambias de proyecto Supabase.

**Registro de clientes:** está sin confirmación de correo, porque el servidor de correo gratuito de Supabase solo envía
2 correos por hora. Cuando conectes tu propio SMTP (Resend, SendGrid…) puedes activar «Confirm email» y la recuperación de
contraseña en Supabase > Authentication.
