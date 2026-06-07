-- ============================================================================
-- FRIOPACKING · PMO · FASE 1: Infraestructura de datos
-- ============================================================================
-- Pegar este SQL en: Supabase Dashboard > SQL Editor > New query
-- Se puede correr COMPLETO o por BLOQUES (cada bloque está numerado).
-- Si un bloque ya existe, podés saltarlo (todos los CREATE usan IF NOT EXISTS).
-- ============================================================================
-- Convención de keys:
--   * Todas las tablas usan `nombre_proyecto` (TEXT) para enlazar con la
--     tabla `proyectos` existente (igual que `reportes`).
--   * Las fechas son DATE; las marcas de tiempo son TIMESTAMPTZ.
--   * `payload` JSONB se reserva para campos libres que necesitemos sumar
--     después sin tener que correr ALTER TABLE.
-- ============================================================================


-- ====================== BLOQUE 1: gantt_imports ============================
-- Versionado: cada vez que un supervisor sube un Gantt, queda registrado.
CREATE TABLE IF NOT EXISTS gantt_imports (
  id              BIGSERIAL PRIMARY KEY,
  nombre_proyecto TEXT NOT NULL,
  supervisor      TEXT,
  archivo_nombre  TEXT,
  archivo_url     TEXT,                       -- Supabase Storage URL (opcional)
  formato         TEXT CHECK (formato IN ('mpp','xml','pdf','xlsx','csv')),
  version         INT NOT NULL DEFAULT 1,
  total_tareas    INT DEFAULT 0,
  observaciones   TEXT,
  payload         JSONB,                      -- metadata libre
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by     TEXT                        -- email/usuario, si hay auth
);

CREATE INDEX IF NOT EXISTS idx_gantt_imports_proj
  ON gantt_imports (nombre_proyecto, uploaded_at DESC);


-- ====================== BLOQUE 2: gantt_tareas ============================
-- Cada línea (fila) del Gantt importado. Se versiona por gantt_import_id
-- para no perder históricos al reimportar.
CREATE TABLE IF NOT EXISTS gantt_tareas (
  id                  BIGSERIAL PRIMARY KEY,
  gantt_import_id     BIGINT REFERENCES gantt_imports(id) ON DELETE CASCADE,
  nombre_proyecto     TEXT NOT NULL,
  -- Identidad de la tarea en el Gantt original
  id_tarea            TEXT NOT NULL,          -- Id de MS Project (string para soportar "1.2.3")
  nivel               INT,                    -- nivel jerárquico (0=root, 1=fase, etc.)
  parent_id_tarea     TEXT,                   -- Id del padre en el Gantt
  seccion             TEXT,                   -- Auto-detectada: INICIO/PLANIFICACIÓN/EJECUCIÓN/etc.
  subseccion          TEXT,                   -- Ej: "Importación", "Compra Local", "Gestión de contratistas", "Hitos del cliente"
  nombre_tarea        TEXT NOT NULL,
  duracion_dias       NUMERIC,
  fecha_inicio        DATE,
  fecha_fin           DATE,
  predecesoras        TEXT,                   -- raw, ej: "12FC+2 días"
  -- Clasificación auto (de la subsección + heurística)
  tipo                TEXT CHECK (tipo IN (
                       'fase','hito','equipo_importado','valvula_importada',
                       'material_local','licitacion','frente_cliente',
                       'prueba_presion','prueba_electrica','pem','ingenieria','otro'
                     )),
  -- Flag manual: el supervisor lo marca cuando confirma que el equipo está definido
  equipo_definido     BOOLEAN DEFAULT FALSE,
  equipo_definido_at  TIMESTAMPTZ,
  equipo_definido_by  TEXT,
  -- Vínculos a otras tablas (se llenan después)
  match_equipo_csv    TEXT,                   -- Nombre que matchea con EQUIPOS_CSV
  match_nisira_partida TEXT,                  -- Partida en Nisira (REQ/OC)
  -- Datos crudos por si el parser pierde algo
  payload             JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gantt_tareas_proj
  ON gantt_tareas (nombre_proyecto);
CREATE INDEX IF NOT EXISTS idx_gantt_tareas_tipo
  ON gantt_tareas (nombre_proyecto, tipo);
CREATE INDEX IF NOT EXISTS idx_gantt_tareas_fecha
  ON gantt_tareas (nombre_proyecto, fecha_fin);
CREATE INDEX IF NOT EXISTS idx_gantt_tareas_definido
  ON gantt_tareas (nombre_proyecto, equipo_definido)
  WHERE tipo IN ('equipo_importado','valvula_importada','material_local');


-- ====================== BLOQUE 3: nisira_movimientos =======================
-- Cada exportación de Nisira deja N filas: REQ, OC, Adelantos pagados, Recepciones.
CREATE TABLE IF NOT EXISTS nisira_movimientos (
  id              BIGSERIAL PRIMARY KEY,
  nombre_proyecto TEXT NOT NULL,
  partida         TEXT,                       -- Nombre de la partida en Nisira (ej: "Compresores")
  partida_codigo  TEXT,                       -- Código contable
  tipo_mov        TEXT NOT NULL CHECK (tipo_mov IN (
                    'REQ','OC','ADELANTO_PAGADO','RECEPCION','FACTURA','OTRO'
                  )),
  numero_doc      TEXT,                       -- Nro de OC, REQ, factura
  fecha_doc       DATE,
  proveedor       TEXT,
  descripcion     TEXT,
  monto           NUMERIC(14,2),
  moneda          TEXT DEFAULT 'USD',
  estado          TEXT,                       -- Pendiente/Aprobado/Pagado/etc. (raw de Nisira)
  -- Metadata
  import_batch    TEXT,                       -- UUID del archivo que generó la fila
  import_fecha    TIMESTAMPTZ DEFAULT NOW(),
  payload         JSONB
);

CREATE INDEX IF NOT EXISTS idx_nisira_proj
  ON nisira_movimientos (nombre_proyecto);
CREATE INDEX IF NOT EXISTS idx_nisira_partida
  ON nisira_movimientos (nombre_proyecto, partida);
CREATE INDEX IF NOT EXISTS idx_nisira_tipo
  ON nisira_movimientos (nombre_proyecto, tipo_mov);
-- Anti-duplicado: misma fila no se importa 2 veces
CREATE UNIQUE INDEX IF NOT EXISTS uq_nisira_doc
  ON nisira_movimientos (nombre_proyecto, tipo_mov, numero_doc)
  WHERE numero_doc IS NOT NULL;


-- ====================== BLOQUE 4: materiales_nisira ========================
-- Catálogo de materiales y válvulas locales (compra local / stock).
-- Sirve para que el supervisor "asigne" material a un hito del Gantt
-- desde un dropdown (no que lo escriba manual).
CREATE TABLE IF NOT EXISTS materiales_nisira (
  id              BIGSERIAL PRIMARY KEY,
  codigo          TEXT UNIQUE NOT NULL,       -- Código Nisira
  descripcion     TEXT NOT NULL,
  unidad          TEXT,                       -- und, m, kg, glb
  categoria       TEXT,                       -- "Válvula", "Tubería", "Eléctrico", "Estructural", etc.
  subcategoria    TEXT,
  marca           TEXT,
  proveedor_pref  TEXT,
  precio_ref      NUMERIC(12,2),
  stock_actual    NUMERIC(12,2),
  ubicacion       TEXT,                       -- Almacén
  activo          BOOLEAN DEFAULT TRUE,
  payload         JSONB,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mat_categoria
  ON materiales_nisira (categoria, subcategoria);
CREATE INDEX IF NOT EXISTS idx_mat_descripcion
  ON materiales_nisira USING gin (to_tsvector('spanish', descripcion));


-- Tabla puente: qué material está asignado a qué hito del Gantt
CREATE TABLE IF NOT EXISTS gantt_tarea_materiales (
  id              BIGSERIAL PRIMARY KEY,
  gantt_tarea_id  BIGINT NOT NULL REFERENCES gantt_tareas(id) ON DELETE CASCADE,
  material_id     BIGINT NOT NULL REFERENCES materiales_nisira(id) ON DELETE RESTRICT,
  cantidad        NUMERIC(12,2),
  asignado_at     TIMESTAMPTZ DEFAULT NOW(),
  asignado_by     TEXT,
  UNIQUE (gantt_tarea_id, material_id)
);


-- ====================== BLOQUE 5: presupuestos =============================
-- Importado del Excel "Resumen de Cuadro de Precio" de la propuesta económica.
-- Cada fila es una partida (equipo, instalación, PEM, gastos generales, etc.).
CREATE TABLE IF NOT EXISTS presupuestos (
  id              BIGSERIAL PRIMARY KEY,
  nombre_proyecto TEXT NOT NULL,
  -- Identidad de la partida en el Excel
  item            TEXT,                       -- "1.1", "2.3", etc.
  descripcion     TEXT NOT NULL,
  unidad          TEXT,                       -- und, glb, m2, mes
  cantidad        NUMERIC(14,4),
  -- Costos COMERCIALES (lo que se cotizó al cliente)
  costo_unit      NUMERIC(14,4),
  costo_total     NUMERIC(14,2),
  margen_pct      NUMERIC(6,4),               -- 0.18 = 18%
  venta_unit      NUMERIC(14,4),
  venta_total     NUMERIC(14,2),
  -- Clasificación auto (para alimentar los tabs)
  categoria       TEXT CHECK (categoria IN (
                    'equipo','infraestructura','instalacion','tuberia',
                    'electrico','pem','gastos_generales','staff','otro'
                  )),
  subcategoria    TEXT,
  hoja_origen     TEXT,                       -- Nombre de la hoja del Excel
  -- Auditoría
  import_batch    TEXT,
  import_fecha    TIMESTAMPTZ DEFAULT NOW(),
  payload         JSONB
);

CREATE INDEX IF NOT EXISTS idx_pres_proj
  ON presupuestos (nombre_proyecto);
CREATE INDEX IF NOT EXISTS idx_pres_categoria
  ON presupuestos (nombre_proyecto, categoria);


-- ====================== BLOQUE 6: costos_reales ============================
-- Carga MENSUAL del costo real por proyecto (análisis de tu equipo).
-- Mientras no haya Nisira automático, este es el "costo real" oficial.
CREATE TABLE IF NOT EXISTS costos_reales (
  id              BIGSERIAL PRIMARY KEY,
  nombre_proyecto TEXT NOT NULL,
  periodo_anio    INT NOT NULL,
  periodo_mes     INT NOT NULL CHECK (periodo_mes BETWEEN 1 AND 12),
  -- Por categoría (igual a presupuestos.categoria para poder comparar)
  categoria       TEXT,
  subcategoria    TEXT,
  -- Montos
  costo_real      NUMERIC(14,2),
  venta_real      NUMERIC(14,2),              -- facturado o devengado del periodo
  facturado       NUMERIC(14,2),              -- solo lo cobrado
  -- Metadata
  fuente          TEXT,                       -- "Analisis_KPI06", "Nisira_export", "Valorizacion_aproximada"
  observaciones   TEXT,
  cargado_at      TIMESTAMPTZ DEFAULT NOW(),
  cargado_by      TEXT,
  payload         JSONB,
  UNIQUE (nombre_proyecto, periodo_anio, periodo_mes, categoria, subcategoria)
);

CREATE INDEX IF NOT EXISTS idx_creales_proj
  ON costos_reales (nombre_proyecto, periodo_anio, periodo_mes);


-- ====================== BLOQUE 7: restricciones ============================
-- Reportadas en el reporte diario. Una restricción por categoría por día.
CREATE TABLE IF NOT EXISTS restricciones (
  id              BIGSERIAL PRIMARY KEY,
  nombre_proyecto TEXT NOT NULL,
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  categoria       TEXT NOT NULL CHECK (categoria IN (
                    'materiales','personal','frentes_cliente','otros'
                  )),
  titulo          TEXT,                       -- corto: "Falta tablero principal"
  descripcion     TEXT,
  impacto         TEXT CHECK (impacto IN ('bajo','medio','alto','critico')),
  responsable     TEXT,                       -- quién debe destrabar
  fecha_objetivo  DATE,                       -- cuándo se espera resolver
  estado          TEXT DEFAULT 'abierta' CHECK (estado IN (
                    'abierta','en_gestion','resuelta','escalada'
                  )),
  resuelta_at     TIMESTAMPTZ,
  resuelta_by     TEXT,
  reportada_por   TEXT,                       -- supervisor
  payload         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restr_proj
  ON restricciones (nombre_proyecto, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_restr_abiertas
  ON restricciones (nombre_proyecto, estado)
  WHERE estado IN ('abierta','en_gestion','escalada');


-- ====================== BLOQUE 8: histograma_personal ======================
-- Personal REAL por día y especialidad (lo reporta el supervisor).
-- El "proyectado" se calcula en vivo desde gantt_tareas (no se guarda).
CREATE TABLE IF NOT EXISTS histograma_personal (
  id              BIGSERIAL PRIMARY KEY,
  nombre_proyecto TEXT NOT NULL,
  fecha           DATE NOT NULL,
  especialidad    TEXT NOT NULL CHECK (especialidad IN (
                    'mecanico','soldador','electrico','civil','ayudante',
                    'supervisor','tecnico_frio','tecnico_instrumentacion','otro'
                  )),
  cantidad        INT NOT NULL DEFAULT 0,
  contratista     TEXT,                       -- empresa que aporta el personal
  reportado_por   TEXT,
  payload         JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (nombre_proyecto, fecha, especialidad, contratista)
);

CREATE INDEX IF NOT EXISTS idx_hist_proj
  ON histograma_personal (nombre_proyecto, fecha);


-- ====================== BLOQUE 9: contratistas_licitacion ==================
-- Estados de licitación que vienen del Gantt (sección "Gestión de contratistas").
-- Se enlazan a un gantt_tarea (la línea "Licitación Inst. mecánica NH3" etc.).
CREATE TABLE IF NOT EXISTS contratistas_licitacion (
  id              BIGSERIAL PRIMARY KEY,
  nombre_proyecto TEXT NOT NULL,
  gantt_tarea_id  BIGINT REFERENCES gantt_tareas(id) ON DELETE SET NULL,
  -- Identificación de la licitación
  alcance         TEXT NOT NULL,              -- "Inst. mecánica NH3", "Inst. paneles", etc.
  especialidad    TEXT,                       -- mecanica/electrica/civil/etc.
  fecha_necesidad DATE,                       -- viene del Gantt
  -- Estado
  estado          TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN (
                    'pendiente','en_licitacion','adjudicado','contratado','cancelado'
                  )),
  -- Una vez adjudicada
  contratista_id  BIGINT,                     -- FK opcional a tabla `contratistas` (si existe)
  contratista_nombre TEXT,
  monto_adjudicado NUMERIC(14,2),
  fecha_adjudicacion DATE,
  observaciones   TEXT,
  payload         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lic_proj
  ON contratistas_licitacion (nombre_proyecto, estado);


-- ====================== BLOQUE 10: pruebas_hitos ===========================
-- Fechas de pruebas de presión, eléctricas y PEM (puesta en marcha).
-- Salen del Gantt automáticamente (tipo='prueba_presion'/'prueba_electrica'/'pem')
-- pero se duplican aquí para tener estado + fecha real vs planificada.
CREATE TABLE IF NOT EXISTS pruebas_hitos (
  id              BIGSERIAL PRIMARY KEY,
  nombre_proyecto TEXT NOT NULL,
  gantt_tarea_id  BIGINT REFERENCES gantt_tareas(id) ON DELETE SET NULL,
  tipo            TEXT NOT NULL CHECK (tipo IN (
                    'prueba_presion','prueba_giro_motor','prueba_electrica',
                    'pem_inicio','pem_fin','recepcion_cliente'
                  )),
  alcance         TEXT,                       -- "Sala 1", "Sistema NH3", etc.
  fecha_planif    DATE,                       -- del Gantt
  fecha_real      DATE,                       -- cuando se ejecutó
  estado          TEXT DEFAULT 'pendiente' CHECK (estado IN (
                    'pendiente','en_proceso','aprobada','observada','reprogramada'
                  )),
  observaciones   TEXT,
  payload         JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pruebas_proj
  ON pruebas_hitos (nombre_proyecto, fecha_planif);


-- ====================== BLOQUE 11: costos_supervision ======================
-- Para el KPI06 (Opción C híbrida). Cargas mensuales del análisis
-- "Costo de Supervisión". Lo sube tu equipo desde un Excel simple.
CREATE TABLE IF NOT EXISTS costos_supervision (
  id              BIGSERIAL PRIMARY KEY,
  nombre_proyecto TEXT NOT NULL,
  periodo_anio    INT NOT NULL,
  periodo_mes     INT NOT NULL CHECK (periodo_mes BETWEEN 1 AND 12),
  -- Real y presupuesto del mes
  costo_real_staff      NUMERIC(14,2),
  costo_real_gg         NUMERIC(14,2),         -- gastos generales + movilidad
  costo_real_total      NUMERIC(14,2),
  ppto_staff            NUMERIC(14,2),
  ppto_gg               NUMERIC(14,2),
  ppto_total            NUMERIC(14,2),
  -- Ratios (calculados al cargar)
  ratio_real_vs_ppto    NUMERIC(6,4),          -- 1.54 = 154%
  desviacion            NUMERIC(14,2),
  observaciones         TEXT,
  cargado_at      TIMESTAMPTZ DEFAULT NOW(),
  cargado_by      TEXT,
  payload         JSONB,
  UNIQUE (nombre_proyecto, periodo_anio, periodo_mes)
);

CREATE INDEX IF NOT EXISTS idx_sup_proj
  ON costos_supervision (nombre_proyecto, periodo_anio, periodo_mes);


-- ============================================================================
-- VISTAS para consultas rápidas desde el frontend
-- ============================================================================

-- Vista: Resumen de equipos por proyecto con su flujo completo
-- (cruza gantt_tareas con nisira_movimientos para saber en qué estado va cada uno)
CREATE OR REPLACE VIEW v_flujo_equipos AS
SELECT
  gt.id,
  gt.nombre_proyecto,
  gt.id_tarea,
  gt.nombre_tarea,
  gt.tipo,
  gt.fecha_inicio,
  gt.fecha_fin                                AS fecha_necesidad_campo,
  gt.equipo_definido,
  -- Estados de flujo (calculados desde Nisira)
  EXISTS (SELECT 1 FROM nisira_movimientos n
          WHERE n.nombre_proyecto = gt.nombre_proyecto
            AND n.partida ILIKE '%' || gt.nombre_tarea || '%'
            AND n.tipo_mov = 'REQ')           AS req_emitida,
  EXISTS (SELECT 1 FROM nisira_movimientos n
          WHERE n.nombre_proyecto = gt.nombre_proyecto
            AND n.partida ILIKE '%' || gt.nombre_tarea || '%'
            AND n.tipo_mov = 'OC')            AS oc_emitida,
  EXISTS (SELECT 1 FROM nisira_movimientos n
          WHERE n.nombre_proyecto = gt.nombre_proyecto
            AND n.partida ILIKE '%' || gt.nombre_tarea || '%'
            AND n.tipo_mov = 'ADELANTO_PAGADO') AS adelanto_pagado
FROM gantt_tareas gt
WHERE gt.tipo IN ('equipo_importado','valvula_importada','material_local');


-- Vista: Margen comercial vs real por proyecto
CREATE OR REPLACE VIEW v_margen_proyecto AS
SELECT
  p.nombre_proyecto,
  SUM(p.venta_total)                          AS venta_comercial,
  SUM(p.costo_total)                          AS costo_comercial,
  SUM(p.venta_total) - SUM(p.costo_total)     AS margen_comercial,
  CASE WHEN SUM(p.venta_total) > 0
       THEN (SUM(p.venta_total) - SUM(p.costo_total)) / SUM(p.venta_total)
       ELSE NULL
  END                                         AS margen_pct,
  (SELECT SUM(cr.costo_real) FROM costos_reales cr
    WHERE cr.nombre_proyecto = p.nombre_proyecto) AS costo_real,
  (SELECT SUM(cr.venta_real) FROM costos_reales cr
    WHERE cr.nombre_proyecto = p.nombre_proyecto) AS venta_real
FROM presupuestos p
GROUP BY p.nombre_proyecto;


-- Vista: Restricciones abiertas por proyecto (resumen)
CREATE OR REPLACE VIEW v_restricciones_abiertas AS
SELECT
  nombre_proyecto,
  categoria,
  COUNT(*)                                    AS cantidad,
  COUNT(*) FILTER (WHERE impacto = 'critico') AS criticas
FROM restricciones
WHERE estado IN ('abierta','en_gestion','escalada')
GROUP BY nombre_proyecto, categoria;


-- ============================================================================
-- TRIGGER de updated_at (para tablas con columna updated_at)
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'gantt_tareas','restricciones','contratistas_licitacion','pruebas_hitos'
  ])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON %I;', t);
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();', t);
  END LOOP;
END$$;


-- ============================================================================
-- RLS (Row Level Security)
-- ============================================================================
-- DEJADO COMENTADO. Cuando me pases los roles (gerencia/supervisor/etc.)
-- te genero las políticas. Por ahora, las tablas son accesibles con la
-- API key publishable que ya usa la app.
--
-- ALTER TABLE gantt_tareas ENABLE ROW LEVEL SECURITY;
-- ... (etc.)


-- ============================================================================
-- FIN. Si todo corrió bien, deberías ver 11 tablas + 3 vistas nuevas:
--   gantt_imports, gantt_tareas, nisira_movimientos, materiales_nisira,
--   gantt_tarea_materiales, presupuestos, costos_reales, restricciones,
--   histograma_personal, contratistas_licitacion, pruebas_hitos,
--   costos_supervision
--   + v_flujo_equipos, v_margen_proyecto, v_restricciones_abiertas
-- ============================================================================
