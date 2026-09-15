# Plataforma Unificada · FrioPacking

## El flujo se documenta en `docs/flujo.html`

El mapa visual de la plataforma vive ahí. Sus datos están en el bloque
`const MAPA` al inicio del `<script>`: tarjetas, filas y conexiones. Eso es lo
único que se edita; el dibujo se rearma solo. `docs/FLUJO.md` guarda la letra
chica: tablas de sincronización, gotchas y esta misma regla.

**Regla:** si un cambio toca el flujo, `docs/flujo.html` y `docs/FLUJO.md` se
actualizan en el **mismo commit** que el código. Cuenta como cambio de flujo:

- una pantalla o módulo que se agrega, se quita o cambia de app
- una tabla que cambia de dueño, o una app que empieza a leer otra instancia
- un job de `pg_cron` nuevo, apagado o con otra frecuencia
- una entrada de datos nueva: un Excel, un importador, un sistema externo
- un cambio en quién puede escribir qué

Al tocarlo, actualiza también la fecha en el comentario del bloque `MAPA` y
en la cabecera de `docs/FLUJO.md`.

## Las tres instancias

| Apodo | Ref de Supabase | App que la usa como principal |
|---|---|---|
| PMO / Gerencia | `vsploxglutkbeokumunp` | `app-live` |
| Supervisor | `iiceeajjmugtuzcfqggs` | `app-sup` |
| Contratas | `uijuokwcsvnlzxoyvrcj` | `app-contratas` |

La información base del proyecto la crea y edita solo Gerencia. Supervisor y
Contratas la leen.
