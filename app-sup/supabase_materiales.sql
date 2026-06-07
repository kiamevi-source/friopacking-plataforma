-- ============================================================================
-- FIX: Agregar 'materiales' al CHECK constraint de presupuestos.categoria
-- ============================================================================
-- Correr UNA SOLA VEZ en Supabase Dashboard > SQL Editor.
-- Después de esto, el importador podrá guardar partidas con categoria='materiales'.
-- ============================================================================

ALTER TABLE presupuestos DROP CONSTRAINT IF EXISTS presupuestos_categoria_check;

ALTER TABLE presupuestos ADD CONSTRAINT presupuestos_categoria_check
  CHECK (categoria IN (
    'equipo','materiales','infraestructura','instalacion','tuberia',
    'electrico','pem','gastos_generales','staff','otro'
  ));

-- Verificación (opcional): contar partidas por categoría existentes
-- SELECT categoria, COUNT(*) FROM presupuestos GROUP BY categoria ORDER BY 2 DESC;
