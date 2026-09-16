# Flujo de la Plataforma Unificada · FrioPacking

**El mapa visual está en [`docs/flujo.html`](./flujo.html).** Ese archivo es la
fuente de verdad: los datos del mapa viven en el bloque `const MAPA` que está al
inicio del `<script>`. Si cambia el flujo, se edita ahí, en el **mismo commit**
que el código. Este documento es la letra chica que no cabe en el dibujo.

Última revisión: **15 de septiembre de 2026**

---

## 1. La regla de oro

La información base del proyecto la crea y edita **solo Gerencia**. Supervisor y
Contratas la leen. Cada app es dueña de una instancia de Supabase y todo lo
demás que toca es lectura o sincronización.

| Apodo | Ref de Supabase | App dueña |
|---|---|---|
| PMO / Gerencia | `vsploxglutkbeokumunp` | `app-live` |
| Supervisor | `iiceeajjmugtuzcfqggs` | `app-sup` |
| Contratas | `uijuokwcsvnlzxoyvrcj` | `app-contratas` |

La entrada es única: `index.html` muestra el selector, hace el login contra la
instancia que corresponde y abre la app en un iframe.

## 2. Sincronizaciones automáticas

| Job | Dónde corre | Cada | Qué mueve |
|---|---|---|---|
| `sync_reportes_from_supervisor` | PMO | 2 min | Reportes nuevos de Supervisor hacia PMO |
| `espejo_reportes_to_supervisor` | PMO | 2 min | Reportes que entran por el netlify viejo hacia Supervisor |
| `push_accesos_to_supervisor` | PMO | 5 min | Quién puede reportar en cada obra |
| `sync_reportes_from_pmo` | Supervisor | 2 min | Jalador anterior de reportes desde PMO |
| `cleanup_http_responses` | PMO y Supervisor | 30 min | Limpia respuestas HTTP acumuladas |

La instancia Contratas no tiene tareas programadas: se conecta en vivo a PMO.

## 3. Lo que hay que tener presente

- **El reporte diario tiene dos orígenes.** El netlify viejo
  `pmo-grupofriopacking` sigue vivo y escribe directo en `reportes` de PMO. Manda
  el código de obra vacío y el destino tiene índice único por código y fecha, así
  que el espejo resuelve el código por nombre de obra.
- **Hay dos caminos haciendo Gerencia hacia Supervisor.** El espejo
  `espejo_reportes_to_supervisor` y el jalador anterior `sync_reportes_from_pmo`,
  los dos cada 2 minutos. Vale consolidarlos en uno.
- **Sin señal el reporte no se pierde.** La app de campo guarda en el navegador,
  con las fotos en IndexedDB, y reintenta al volver la conexión.
- **Los equipos importados en Gerencia viajan a Supervisor.** El puente escribe
  en `equipos_pmo` de la instancia Supervisor después de cada importación.
- **Las obras nuevas entran desde NISIRA, por ahora a mano.** Desde el 15 de
  septiembre de 2026, Claude lee la Orden de Proyectos de NISIRA (la lista
  `lst_orden_proyectos` y la cabecera «Datos Generales» de `edt_orden_proyectos`)
  por escritorio remoto. La usuaria aprueba cada ficha antes de insertarla en
  `proyectos` de PMO. Más adelante TI lo va a automatizar. La regla es una sola
  dirección, de NISIRA hacia la plataforma.
  - Alcance: solo la serie PRY, años 2025 y 2026, con estado NISIRA «Pendiente».
    Un PRY es nuevo si su código no está en `proyectos.cod_proyecto` ni dentro
    de ningún arreglo jsonb `proyectos.codigos`.
  - Mapeo: `nombre` = nombre corto «CLIENTE + SEDE» que elige la usuaria;
    `estado` = `'Por Iniciar'`; `supervisor` = «Responsable» de NISIRA y
    `supervisor_email` sale de `supervisores_equipo`; `departamento`,
    `provincia`, `distrito` y `direccion` salen del Ubigeo y de «Dirección
    Proyecto»; `zona` se deriva del departamento (Áncash = CENTRO);
    `fecha_ini_contractual` y `fecha_fin_contractual` = Fecha Programada de
    inicio y fin; `venta` = V.Venta tal cual, en la moneda de NISIRA;
    `categoria` = Rubro.
  - Columnas nuevas en `proyectos` (13): `cliente_ruc`, `cliente_razon_social`,
    `cliente_direccion`, `moneda`, `vendedor`, `cotizacion`, `cotizacion_fecha`,
    `refrigerante`, `sucursal`, `fecha_orden`, `ppto_costo`, `ppto_margen`,
    `costo_std_planificado`. Las obras que ya existían se van a completar con
    estos campos.
  - Las tablas `nisira_*` de la instancia Supervisor siguen con cero filas: esta
    entrada no las usa.
  - Una obra puede tener **varios PRY**. Antes de crear una ficha se cruza con
    `valorizacion_lineas` (trae el supervisor real y el avance por código) y con
    `reportes`: si el PRY es parte de una obra que ya existe, entra como código
    más en `proyectos.codigos` y la `venta` pasa a ser la suma. Si la obra ya
    terminó, entra como Cerrado.
  - Los 13 campos de NISIRA se ven y se editan en la ficha del proyecto de
    Gerencia, grupo «Datos de NISIRA».
- **Licitaciones se arma desde el presupuesto de Supervisor.** Gerencia lee
  `v_partidas_licitables` de la instancia Supervisor y agrupa las partidas por
  rubro y partida, para mandar un rubro entero a licitar. En obras cargadas
  desde NISIRA el código de partida es la EDT (`0003.001.002.014`) y el monto
  viene en dólares.
- **El supervisor ve el estado de la licitación, no lo copia.** La pestaña de
  costos de la app de campo consulta `lic_partidas` y `lic_licitaciones` de PMO,
  enlazadas por `lic_partidas.origen_presupuesto_id` = `presupuestos.id`. Es solo
  lectura, a propósito: una copia sincronizada podría contradecir a Gerencia.
- **Levantamiento de observaciones: cinco estados y bitácora.** Restricciones,
  punch list y observaciones viven en `pendientes` de la instancia Supervisor.
  El ciclo es Abierta → En proceso → Por validar → Cerrada, más «No aplica»;
  el paso a Cerrada lo da el supervisor como conformidad y queda firmado en
  `validado_por`. «No aplica» sale del % levantado. Una observación se marca
  urgente sola a los 30 días vencida, o con impacto alto ya vencida, y el
  supervisor puede forzarla. Reprogramar exige motivo y suma
  `reprogramaciones`. Cada cambio se escribe en `pendientes_historial`
  (tabla nueva) y se puede deshacer. Columnas nuevas: `urgente`, `causa`,
  `fuera_alcance`, `requiere_cotizacion`, `reprogramaciones`, `validado_por`,
  `validado_at`, `ubicacion`, `plano_x`, `plano_y`. Entran a mano
  o importadas desde un Excel (`origen = 'excel'`). No hay plantilla obligatoria:
  cada obra usa su formato. El importador elige la hoja y la fila de encabezado
  que mejor reconoce y asigna cada columna por palabras completas, tolerando
  una letra de errata; si dos columnas compiten, una vacía nunca gana. Las
  columnas que no calzan se guardan en la descripción como «Encabezado: valor».
  Sin columna de estado, el estado sale del % de avance (100 = cerrada). Sin
  columna de tipo, «punch list» en el nombre o el título del archivo lo marca
  como punch. Solo se omiten las filas que ya están en la obra (mismo título y
  categoría) o que son idénticas a otra del archivo. Valores guardados: tipo
  `restriccion` / `punch` / `observacion`, impacto `alto` / `medio` / `bajo`,
  estado `abierta` / `en_proceso` / `cerrada`.

## 4. Cómo se mantiene

1. El mapa se edita en el bloque `const MAPA` de `docs/flujo.html`, en el mismo
   commit que el cambio de código. Un commit que mueve datos y no toca el mapa
   está incompleto.
2. Qué cuenta como cambio de flujo: una pantalla nueva o eliminada, una tabla
   que cambia de dueño, un job de sincronización nuevo o apagado, una app que
   empieza a leer otra instancia, una entrada de datos nueva.
3. Actualiza la fecha en la cabecera de este archivo y en el comentario del
   bloque `MAPA` cada vez que los toques.
