# ModaNueva · Tienda online

Tienda de ropa y accesorios hecha con **HTML + Tailwind CSS + JavaScript** y **Supabase** (base de datos Postgres + autenticación). No tiene servidor propio: el navegador habla directo con Supabase y la seguridad la dan las reglas RLS de la base de datos.

> Proyecto adaptado a partir de [Cristiancano1236/Ecommerce-node.js](https://github.com/Cristiancano1236/Ecommerce-node.js).

## Estructura

```
public/
  index.html        Tienda (catálogo, carrito, login, perfil)
  admin.html        Panel de administración
  js/
    config.js       URL y anon key de Supabase + nombre/moneda de la tienda
    supabaseClient.js  Conexión única a Supabase
    util.js         Formato de precios, escape de HTML, avisos
    tienda.js       Lógica de la tienda
    admin.js        Lógica del admin
supabase/
  schema.sql        Tablas, vista, funciones, seguridad RLS y datos de ejemplo
```

## Puesta en marcha

1. **Base de datos:** Supabase > SQL Editor > pega todo `supabase/schema.sql` > Run.
2. **Conexión:** pon tu *Project URL* y *anon key* en `public/js/config.js`
   (Supabase > Project Settings > API). **Nunca** pongas la `service_role key` ahí.
3. **Probar en local:** `npm run dev` y abre http://localhost:3000
   (o `python -m http.server 3000` dentro de `public/`).
4. **Crear tu admin:** regístrate en la tienda y luego, en el SQL Editor:
   ```sql
   update public.perfiles set rol = 'admin' where correo = '<tu-correo>';
   ```
   Después entra a `/admin.html`.

> Si Supabase pide confirmar el correo al registrarse y no lo quieres en pruebas:
> Authentication > Providers > Email > desactiva "Confirm email".

## Cómo funciona la seguridad

- Los visitantes solo leen productos y categorías activos.
- Cada cliente ve únicamente sus propios pedidos y perfil.
- El **rol** no se puede cambiar desde el navegador (solo con la función `cambiar_rol`, exclusiva de admins).
- Las compras pasan por la función SQL `crear_orden`, que calcula precios con descuento, valida y descuenta stock en una sola transacción. El navegador no puede fijar precios.

## Publicarla

Es un sitio estático: sube la carpeta `public/` a Netlify, Vercel, Cloudflare Pages o GitHub Pages.
