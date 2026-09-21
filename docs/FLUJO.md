# Flujo de la Plataforma Unificada · FrioPacking

**El mapa visual está en [`docs/flujo.html`](./flujo.html).** Ese archivo es la
fuente de verdad: los datos del mapa viven en el bloque `const MAPA` que está al
inicio del `<script>`. Si cambia el flujo, se edita ahí, en el **mismo commit**
que el código. Este documento es la letra chica que no cabe en el dibujo.

Última revisión: **21 de septiembre de 2026**

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
  viene en dólares. **Los «Servicios generales» no se licitan** (fletes,
  viáticos, alquiler de grúas y andamios, transporte): la vista los deja fuera
  aunque NISIRA los marque SER. Lo que sí queda es todo el trabajo de obra,
  incluidos pintura, arenado, limpieza, presurizado y puesta en marcha.
- **Se invita a cuentas reales del portal.** El cockpit lista las empresas de
  `contratas_cuentas` (instancia Contratas) con la función
  `contratistas_para_licitar()` (security definer: la tabla no es legible sin
  sesión) y cruza por nombre y alias con `portafolio_servicios` para mostrar
  especialidad y obras previas. Ya no se inventan correos
  `@contratista.friopacking.com`: una invitación a un correo sin cuenta sale
  marcada «Sin cuenta» porque nadie la verá.
- **Archivos de licitación en el bucket privado `lic-expediente` (PMO).**
  Expediente (`lic_documentos.path`), planos por revisión
  (`lic_plano_versiones.path`) y adjuntos de la oferta (`lic_ofertas.adjuntos`,
  jsonb). Rutas `<licitacion_id>/expediente|planos|ofertas/…`. Se abren con link
  firmado de una hora; el enlace público no funciona. El bucket viejo
  `lic-docs` (público) solo guarda el PDF de requisitos SSOMA.
- **El contratista se entera dentro del portal, sin correos.** Solo ve
  licitaciones desde «Publicada». `lic_invitados.visto_at` marca su última
  visita; lo que Gerencia registra después en `lic_eventos` (documento, plano,
  revisión, adenda, respuesta, cambio de estado, adjudicación) aparece como
  novedad y como contador en el menú. El cockpit muestra «Vista · fecha» por
  invitado. Consultas y ofertas se aceptan solo con la licitación abierta y
  hasta el final del día de `fecha_limite`; la oferta se puede corregir hasta
  ese momento.
- **El portal entra a licitaciones solo por la función `lic-portal` (PMO).**
  Desde el 21 de septiembre de 2026 el portal ya no lee ni escribe las tablas
  `lic_*` con la llave pública de Gerencia. Llama a la Edge Function
  `lic-portal` con el token de su sesión de Contratas; la función lo valida
  contra `/auth/v1/user` de Contratas, toma el correo y devuelve **solo lo de
  ese contratista**: sus invitaciones, el expediente de las licitaciones donde
  está invitado, su oferta, las consultas públicas o propias (las de otros
  nunca) y sus contratos y requisitos. Si la licitación se adjudicó a otra
  empresa, solo sabe que existe, sin nombre ni monto. La oferta se guarda con
  `lic_portal_guardar_oferta` (solo `service_role`): una sola oferta por
  invitado, el total lo calcula el servidor con las cantidades de las
  partidas y el cierre se valida en hora de Lima. Los adjuntos se suben con un
  link firmado a la carpeta `<licitacion_id>/ofertas/<correo>/` que decide el
  servidor; solo se pueden descargar los propios y el expediente.
- **El supervisor arma la licitación por la función `lic-supervisor` (PMO).**
  La pantalla es `app-sup/licitaciones-supervisor.html`, que se abre en la
  pestaña «Licitaciones» del Supervisor dentro de un marco con la obra elegida
  (usa `sbTokenVigente()` del shell). El service worker solo guarda el shell
  como copia sin señal: esa página siempre va a la red.
  Desde el 21 de septiembre de 2026 el flujo es: el supervisor crea el borrador
  desde app-sup (partidas del presupuesto, especificación, adjuntos y
  contratistas sugeridos) y lo envía a Gerencia (`Por aprobar`); Gerencia
  aprueba y publica, o lo devuelve (`Observada`). La función valida el token
  de la instancia Supervisor contra su `/auth/v1/user` y el acceso a la obra en
  `PMO.proyecto_accesos` (o los 4 administradores). Solo edita borradores
  propios (`origen = 'supervisor'`, `Borrador`/`Observada`). El precio base
  (`pu_base` = costo de mano de obra ÷ cantidad) y el código `LIC-AAAA-NNNN`
  los pone el servidor con `lic_sup_guardar` (solo `service_role`). Los
  sugeridos van a `lic_invitados` con estado `Sugerido` y el portal no los ve
  hasta que Gerencia los invite. El código fuente de ambas funciones está en
  `supabase/functions/`.
- **La adjudicación guarda `email` y `licitacion_codigo`.** Sin eso el ganador
  no veía su contrato en «Mis contratos».
- **El supervisor ve el estado de la licitación, no lo copia.** La pestaña de
  costos de la app de campo consulta `lic_partidas` y `lic_licitaciones` de PMO,
  enlazadas por `lic_partidas.origen_presupuesto_id` = `presupuestos.id`. Es solo
  lectura, a propósito: una copia sincronizada podría contradecir a Gerencia.
- **Levantamiento de observaciones: cinco estados y bitácora.** Restricciones,
  punch list y observaciones viven en `pendientes` de la instancia Supervisor.
  **Todo es una observación**: ya no hay tres tipos. Las que impiden avanzar se
  marcan con `restriccion = true` (casilla «Genera restricción» en el alta, en
  el recorrido y en la ficha, con su filtro en «Filtros»); «punch list» pasó
  a ser el origen, no un tipo. La pantalla abre con un resumen por zona (una
  tarjeta por zona con lo que falta levantar); las zonas se agrupan sin
  distinguir mayúsculas, tildes ni espacios, y se unifican en lote con
  «Cambiar zona». El ciclo es Abierta → En proceso → Por validar →
  Cerrada, más «No aplica»;
  el cierre lo da el supervisor (desde cualquier estado) y queda firmado en
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
  categoría) o que son idénticas a otra del archivo; al reimportar el mismo
  cuadro se actualizan estado, fecha, responsable e impacto de las que ya
  están, en vez de duplicarlas. Valores guardados: tipo `restriccion` /
  `punch` / `observacion`, impacto `alto` / `medio` / `bajo`, estado
  `abierta` / `en_proceso` / `por_validar` / `cerrada` / `no_aplica`.
- **Repetidas y textos ordenados.** Al importar, cada fila nueva se compara con
  lo que ya tiene la obra y con las otras filas del archivo: si habla de lo mismo
  (títulos muy parecidos, o parecidos en la misma zona) no se importa salvo que
  el supervisor marque «Importar igual». Los textos en MAYÚSCULAS pasan a
  minúsculas con inicial mayúscula (respetando siglas) y la zona toma el nombre
  que ya usa la obra. Para lo ya cargado está «Ordenar zonas y textos» (menú ⋯):
  unifica zonas escritas distinto (también la zona con QR), ordena mayúsculas y
  pasa las repetidas a «No aplica» con referencia a la que se queda; no borra y
  se puede deshacer.
- **Modo recorrido.** Para registrar caminando la obra: se dicta por voz (motor
  del navegador, es-PE) o se escribe, se elige área, tipo e impacto, y cada una
  se guarda con `origen = 'recorrido'` y fecha objetivo según el impacto
  (alto 2 días, medio 7, bajo 15). Si en lo dictado se nombra una zona que la obra ya usa
  («Sala de máquinas, falta sello…», también «túnel tres» = «Túnel 3»), o se dice
  «zona X,» al inicio, la observación se guarda en esa zona y la zona sale del
  título; elegir la zona a mano manda sobre lo detectado. Al abrir la obra, un aviso resume urgentes,
  lo que vence hoy y lo que espera conformidad.
- **QR por zona, sin plano.** Cada obra se divide en zonas con nombre (tabla
  `obra_zonas` de Supervisor, única por obra y nombre). Desde «Zonas y QR» se
  crean, se renombran y se imprime una hoja A4 con seis etiquetas por página.
  El QR lleva solo el id: `app-sup/?zona=ID`. Al escanearlo, la app pide sesión
  si hace falta, abre la obra (solo si la cuenta tiene acceso), va a
  Levantamiento de observaciones y filtra por la zona, con un botón para
  registrar ahí mismo. La zona se enlaza con las observaciones por
  `pendientes.categoria`; renombrarla cambia también ese campo y el QR impreso
  sigue sirviendo. Borrar la zona deja el QR sin destino. El plano sigue
  disponible, pero ya no es necesario para ubicar.
- **El responsable se puede elegir del banco de contratistas.** La app de campo
  lee `portafolio_servicios` de PMO solo para sugerir nombres; el banco sigue
  siendo de Gerencia.
- **Ubicación en el plano.** El plano general de la obra se sube una vez como
  imagen al bucket `planos` (público) y queda registrado en la tabla `planos`
  de Supervisor. Cada observación guarda su punto en `plano_x` / `plano_y`, en
  porcentaje, así que sirve en cualquier pantalla. GOTCHA: la subida NO puede
  llevar la cabecera `x-upsert`; el bucket solo tiene política de INSERT para
  `anon`, y el upsert exige UPDATE y SELECT. Cada plano sube con nombre único.
- **De la obra al negocio.** Cuando el supervisor marca una observación «fuera
  de alcance», la app-sup crea un **adicional** en PMO (`adicionales`) para que
  Comercial lo cotice; si la marca es «requiere cotización», crea un
  **requerimiento** (`requerimientos_compra`) para Compras o Licitaciones. La
  observación guarda el id (`adicional_id`, `requerimiento_id`) y al desmarcar
  se retira el pedido. Es la única escritura de Supervisor hacia PMO, y solo
  crea pedidos: nunca toca la información base del proyecto. Desde el 16 de
  septiembre de 2026 va **solo** por las funciones `obs_pedido_solicitar` y
  `obs_pedido_retirar` (security definer en PMO): validan que la obra exista,
  no duplican (una observación = un pedido) y no borran un pedido que ya salió
  de «solicitado»; en ese caso avisan al supervisor. Las tablas quedaron de solo
  lectura para anon, salvo el `estado` que cambia Gerencia. «Deshacer» sobre
  una marca vuelve a pedir o retirar el pedido.
- **El pago espera a que la obra quede limpia.** El portal de Contratas lee
  (solo lectura) las observaciones abiertas de la instancia Supervisor que
  calzan con los alias de esa contrata (palabra completa; los alias de menos de
  3 letras no cuentan). Si tiene urgentes sin levantar **en la obra que
  factura**, esa factura entra como `estado_revision = 'en_espera'` y el portal
  se lo explica antes de registrarla. «Hoy» se calcula en hora local. Gerencia ve esas facturas retenidas en el
  módulo de Observaciones y puede liberarlas de a una.
- **La contratista ve y responde sus observaciones.** El portal de Contratas
  tiene la sección «Observaciones de obra»: lee de `pendientes` (instancia
  Supervisor) las que tienen como responsable a su empresa o a uno de sus
  alias, comparando por palabra completa. Puede escribir el plan de acción y
  avisar «La estoy trabajando» (→ En proceso) o «Ya la levanté» (→ Por validar).
  Escribe **solo** por la función `contrata_avisa_pendiente` (security
  definer), que no deja cerrar, reabrir ni tocar fecha o responsable, guarda el
  aviso en `aviso_contrata` / `aviso_contrata_at` y deja constancia en
  `pendientes_historial`. El supervisor ve el aviso en la ficha y da la
  conformidad.
- **Quién escribe en las tablas de observaciones** (instancia Supervisor, desde
  el 16 de septiembre de 2026). La lectura sigue abierta: Gerencia y Contratas
  leen con la clave anónima. Escribir en `pendientes` y `obra_zonas` exige
  sesión y `tiene_acceso(cod_proyecto)`, igual que `reportes`. La clave anónima
  solo puede cambiar `pendientes.postventa` (Gerencia, al cerrar una obra) y
  agregar líneas a `pendientes_historial`, que no se editan ni se borran. La
  contratista escribe solo por `contrata_avisa_pendiente`. Pendiente: en PMO,
  `adicionales` y `requerimientos_compra` siguen abiertas porque el supervisor
  borra ahí con la clave anónima al desmarcar; necesitan una función propia.
- **Reimportar el Excel no pisa lo decidido en obra.** El estado solo avanza;
  lo que el Excel da por cerrado pasa a «Por validar»; lo cerrado, por validar o
  «No aplica» en la app no se toca; la fecha no reemplaza una reprogramación con
  motivo; responsable e impacto solo llenan vacíos. Si la carga de la obra
  falla, la app muestra el error y no deja importar ni registrar (evita
  duplicar la obra completa).
- **La sesión del supervisor se renueva sola** con `sb_refresh` antes de vencer
  y ante un 401, así un recorrido largo no falla a la hora de haber entrado.
- **Estados libres para el supervisor.** Desde el 16 de septiembre de 2026 se
  puede pasar de cualquier estado a cualquier otro, también en lote (con
  confirmación y deshacer). Quien cierra queda como conformidad
  (`validado_por`, `validado_at`) con la fecha del día.
- **Eliminar.** Desde la ficha (⋯ → Eliminar) o en lote, quien tiene acceso a
  la obra puede borrar observaciones cargadas por error. Se pide confirmación,
  se borra el historial (en cascada), no se puede deshacer, y antes se retiran
  por `obs_pedido_retirar` los pedidos en Gerencia que nadie empezó a trabajar.
- **Consolidado en Gerencia.** `app-live/modulos/observaciones.html` junta todas
  las obras: pendientes, urgentes, avance y costo estimado (lee `pendientes` de
  Supervisor), más los adicionales y requerimientos de PMO, cuyo estado se
  cambia desde ahí. También agrupa por responsable (insumo para la evaluación de
  contratistas) y muestra lo que se repite en dos o más obras. Al cerrarse una
  obra, desde ahí se pasan sus observaciones abiertas a **postventa**
  (`pendientes.postventa`), sin perderlas.
- **Lo que sale hacia el cliente.** Desde la misma pantalla se genera el acta de
  recepción (provisional o definitiva) en el formato de Friopacking: membrete,
  datos del cliente, texto de recepción, firmas (cada firmante puede firmar en
  el celular) y un anexo con las observaciones. Empresa, dirección, códigos y
  monto se leen de `proyectos` de PMO y se pueden corregir en el acta; lo
  corregido se recuerda en ese navegador y no toca la ficha de Gerencia.
  También sale el informe de avance en PDF y el Excel con las columnas del cliente (hojas
  Resumen y Observaciones). En todo lo que va al cliente el responsable sale
  como «Friopacking»: qué contrata ejecuta queda interno (solo se muestra tal
  cual si el responsable es el propio cliente). Todo se arma con lo que ya está en `pendientes`:
  no se guarda nada nuevo ni se envía a ningún servicio externo.

## 4. Cómo se mantiene

1. El mapa se edita en el bloque `const MAPA` de `docs/flujo.html`, en el mismo
   commit que el cambio de código. Un commit que mueve datos y no toca el mapa
   está incompleto.
2. Qué cuenta como cambio de flujo: una pantalla nueva o eliminada, una tabla
   que cambia de dueño, un job de sincronización nuevo o apagado, una app que
   empieza a leer otra instancia, una entrada de datos nueva.
3. Actualiza la fecha en la cabecera de este archivo y en el comentario del
   bloque `MAPA` cada vez que los toques.
