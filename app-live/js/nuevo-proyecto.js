/* ════════════════════════════════════════════════════════════════════
   nuevo-proyecto.js — Drawer "Nuevo Proyecto": form, validación, save
   Dependencias: core.js (sb, escapeHtml, showToast, showSuccessBanner)
   Expone: window.NP, window.__doSaveProject
   ════════════════════════════════════════════════════════════════════ */

const NP = {
  supervisors: [],
  supervisorCounts: {},

  open: async function () {
    document.getElementById('drawer-bg').classList.add('on');
    document.getElementById('drawer-np').classList.add('on');
    const fv = document.getElementById('np-form-view');
    if (fv) fv.style.display = 'block';
    document.body.style.overflow = 'hidden';
    if (!this.supervisors.length) await this.loadSupervisors();
  },

  close: function () {
    document.getElementById('drawer-bg').classList.remove('on');
    document.getElementById('drawer-np').classList.remove('on');
    document.body.style.overflow = '';
  },

  loadSupervisors: async function () {
    if (!window.sb) return;
    try {
      const { data, error } = await window.sb
        .from('proyectos')
        .select('supervisor,activo')
        .not('supervisor', 'is', null);
      if (error) throw error;

      const counts = {};
      (data || []).forEach((r) => {
        if (!r.supervisor) return;
        if (!counts[r.supervisor]) counts[r.supervisor] = { active: 0, total: 0 };
        counts[r.supervisor].total++;
        if (r.activo) counts[r.supervisor].active++;
      });

      this.supervisorCounts = counts;
      const unique = Object.keys(counts).sort();
      this.supervisors = unique;

      const sel = document.getElementById('np-supervisor');
      sel.innerHTML =
        '<option value="">— Seleccionar supervisor —</option>' +
        unique.map((s) => {
          const c = counts[s];
          const label = c.active > 0
            ? `${s} · ${c.active} activo${c.active !== 1 ? 's' : ''}`
            : `${s} · libre`;
          return `<option value="${window.escapeHtml(s)}">${window.escapeHtml(label)}</option>`;
        }).join('') +
        '<option value="__new__">+ Otro (escribir manualmente)</option>';
      sel.onchange = () => this.onSupervisorChange();
    } catch (e) {
      console.warn('Load supervisors error', e);
    }
  },

  onSupervisorChange: function () {
    const sel    = document.getElementById('np-supervisor');
    const banner = document.getElementById('np-carga-banner');
    const val    = sel.value;
    banner.classList.remove('on', 'ok', 'med', 'alta');
    banner.innerHTML = '';
    if (!val || val === '__new__' || !this.supervisorCounts[val]) return;

    const c = this.supervisorCounts[val];
    let cls = 'ok', ico = 'check-circle-2';
    let txt = `Carga óptima — ${c.active} proyecto${c.active !== 1 ? 's' : ''} activo${c.active !== 1 ? 's' : ''} actualmente`;
    if (c.active >= 6) {
      cls = 'alta'; ico = 'alert-triangle';
      txt = `Alta carga — ya tiene ${c.active} proyectos activos. Considera otro supervisor o confirma la asignación.`;
    } else if (c.active >= 4) {
      cls = 'med'; ico = 'gauge';
      txt = `Carga media — ${c.active} proyectos activos. Aún puede asumir más.`;
    }
    banner.classList.add('on', cls);
    banner.innerHTML = `<i data-lucide="${ico}" style="width:15px;height:15px;stroke-width:2.2"></i><span>${window.escapeHtml(txt)}</span>`;
    if (window.lucide) lucide.createIcons();
  },

  suggestCode: async function () {
    if (!window.sb) return;
    const hintEl = document.getElementById('np-cod-hint');
    hintEl.textContent = 'Buscando último código...';
    hintEl.style.color = '#94a3b8';
    try {
      const { data, error } = await window.sb
        .from('proyectos')
        .select('cod_proyecto')
        .not('cod_proyecto', 'is', null);
      if (error) throw error;

      const year = new Date().getFullYear();
      /* Detecta variaciones reales del patrón PRY:
         "PRY 2026-0000020", "PRY 2026 - 0000020", "PRY PRY 2026-0000020", etc. */
      const re = new RegExp(`PRY[\\s]*(?:PRY[\\s]*)?${year}[\\s-]+(\\d{4,7})`, 'i');
      let maxN = 0;
      (data || []).forEach((r) => {
        const m = (r.cod_proyecto || '').match(re);
        if (m) { const n = parseInt(m[1]); if (n > maxN) maxN = n; }
      });

      const nextN = maxN + 1;
      const nextCode = `PRY ${year}-${String(nextN).padStart(7, '0')}`;
      document.getElementById('np-cod').value = nextCode;
      if (maxN > 0) {
        hintEl.innerHTML = `✨ Sugerido — último encontrado para ${year}: <b>PRY ${year}-${String(maxN).padStart(7, '0')}</b>`;
      } else {
        hintEl.innerHTML = `✨ Primer código de ${year}`;
      }
      hintEl.style.color = '#1f9a82';
    } catch (e) {
      console.error('suggestCode error', e);
      hintEl.textContent = 'No se pudo sugerir código. Escribe uno manualmente.';
      hintEl.style.color = '#ef4444';
    }
  },

  collectData: function () {
    return {
      cod_proyecto:           document.getElementById('np-cod').value.trim() || null,
      nombre:                 document.getElementById('np-nombre').value.trim(),
      estado:                 document.getElementById('np-estado').value,
      categoria:              document.getElementById('np-categoria').value.trim() || null,
      supervisor:             document.getElementById('np-supervisor').value !== '__new__'
                                ? document.getElementById('np-supervisor').value || null
                                : null,
      asistente:              document.getElementById('np-asistente').value.trim() || null,
      supervisor_email:       document.getElementById('np-sup-email').value.trim() || null,
      zona:                   document.getElementById('np-zona').value || null,
      departamento:           document.getElementById('np-depto').value || null,
      provincia:              document.getElementById('np-provincia').value.trim() || null,
      distrito:               document.getElementById('np-distrito').value.trim() || null,
      direccion:              document.getElementById('np-direccion').value.trim() || null,
      fecha_ini_contractual:  document.getElementById('np-fini').value || null,
      fecha_fin_contractual:  document.getElementById('np-ffin').value || null,
      fecha_ini_real:         document.getElementById('np-fini-real').value || null,
      fecha_fin_real:         document.getElementById('np-ffin-real').value || null,
      venta:                  parseFloat(document.getElementById('np-venta').value) || 0,
      penalidades:            document.getElementById('np-penalidades').value,
      penalidad_pct:          document.getElementById('np-pen-pct').value.trim() || null,
      penalidad_tipo:         document.getElementById('np-pen-tipo').value.trim() || null,
      ambientes:              document.getElementById('np-ambientes').value.trim() || null,
      activo: true,
    };
  },

  validate: function (d) {
    const errors = {};
    // Limpiar errores previos
    ['nombre', 'fini', 'ffin'].forEach((id) => {
      const el = document.getElementById(`np-${id}`);
      if (el) el.classList.remove('err');
      const e = document.getElementById(`np-${id}-err`);
      if (e) { e.style.display = 'none'; e.textContent = ''; }
    });

    // Solo nombre es obligatorio
    if (!d.nombre || d.nombre.length < 3) {
      errors.nombre = 'El nombre del proyecto es obligatorio (mínimo 3 caracteres)';
    }
    // Si llenó ambas fechas, fin >= inicio
    if (d.fecha_ini_contractual && d.fecha_fin_contractual && d.fecha_fin_contractual < d.fecha_ini_contractual) {
      errors.ffin = 'La fecha de fin no puede ser anterior al inicio';
    }

    let firstEl = null;
    Object.entries(errors).forEach(([k, msg]) => {
      const id = k === 'nombre' ? 'np-nombre' : k === 'fini' ? 'np-fini' : 'np-ffin';
      const fEl = document.getElementById(id);
      if (fEl) { fEl.classList.add('err'); if (!firstEl) firstEl = fEl; }
      const eEl = document.getElementById(id + '-err');
      if (eEl) { eEl.textContent = msg; eEl.style.display = 'block'; }
    });

    if (firstEl) {
      firstEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => firstEl.focus(), 300);
      window.showToast('Faltan datos', 'Solo el nombre es obligatorio. Revisa el campo marcado en rojo.', 'err');
    }
    return Object.keys(errors).length === 0;
  },

  save: async function () {
    const saveBtn = document.getElementById('np-save-btn');
    const originalLabel = saveBtn ? saveBtn.textContent : 'Guardar proyecto';
    const setBtn = (txt, disabled) => {
      if (!saveBtn) return;
      saveBtn.textContent = txt;
      saveBtn.disabled = !!disabled;
      saveBtn.style.opacity = disabled ? '.7' : '';
      saveBtn.style.cursor = disabled ? 'wait' : '';
    };

    // STEP 1: Verificar Supabase
    if (!window.sb) {
      window.showToast('Error step 1', 'Cliente Supabase no inicializado', 'err', 6000);
      setBtn(originalLabel, false);
      return;
    }

    // STEP 2: Recolectar
    setBtn('⏳ Validando...', true);
    let d;
    try {
      d = this.collectData();
    } catch (e) {
      console.error('[SAVE] step 2 FAILED:', e);
      window.showToast('Error step 2', e.message || 'No se pudo leer el formulario', 'err', 6000);
      setBtn(originalLabel, false);
      return;
    }

    // STEP 3: Validar
    if (!this.validate(d)) {
      setBtn(originalLabel, false);
      return;
    }

    // STEP 4: INSERT
    setBtn('⏳ Guardando en Supabase...', true);
    try {
      const { data, error } = await window.sb.from('proyectos').insert([d]).select();
      if (error) throw error;
      const created = (data && data[0]) || d;

      window.showToast(
        `✅ Proyecto creado: ${created.nombre}`,
        `${created.cod_proyecto || 'Sin código'} · ID #${created.id || '?'} · Sincronizado con Supabase`,
        'ok',
        7000
      );
      this.close();
      window.showSuccessBanner(created);

      // Reset form
      ['np-cod','np-nombre','np-categoria','np-asistente','np-sup-email','np-provincia',
       'np-distrito','np-direccion','np-fini','np-ffin','np-fini-real','np-ffin-real',
       'np-venta','np-pen-pct','np-pen-tipo','np-ambientes'].forEach((id) => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      ['np-supervisor','np-zona','np-depto'].forEach((id) => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      const estEl = document.getElementById('np-estado'); if (estEl) estEl.value = 'Por Iniciar';
      const penEl = document.getElementById('np-penalidades'); if (penEl) penEl.value = 'No aplica';
      const carga = document.getElementById('np-carga-banner');
      if (carga) { carga.classList.remove('on', 'ok', 'med', 'alta'); carga.innerHTML = ''; }

      // Refresh dashboard live
      try {
        document.querySelectorAll('.kpi-card').forEach((c) => {
          c.style.transition = 'box-shadow .4s';
          c.style.boxShadow = '0 0 0 3px rgba(62,203,176,.4)';
          setTimeout(() => { c.style.boxShadow = ''; c.style.transition = ''; }, 800);
        });
        if (typeof window.loadDashboard === 'function') await window.loadDashboard();
      } catch (de) { console.warn('refresh dashboard error', de); }
    } catch (e) {
      console.error('[NP] save error', e);
      const code = e.code || (e.details && e.details.code);
      const msg = (e.message || '').toLowerCase();
      if (code === '23505' || msg.includes('duplicate') || msg.includes('unique') || msg.includes('nombre')) {
        const nombreEl = document.getElementById('np-nombre');
        const errEl    = document.getElementById('np-nombre-err');
        if (nombreEl) nombreEl.classList.add('err');
        if (errEl) {
          errEl.textContent = `Ya existe un proyecto llamado "${d.nombre}". Usa un nombre distinto o agrega un sufijo (ej. "${d.nombre} 2026" o "${d.nombre} / UBICACIÓN").`;
          errEl.style.display = 'block';
        }
        if (nombreEl) { nombreEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => nombreEl.focus(), 300); }
        window.showToast('⚠️ Nombre duplicado', `Ya existe "${d.nombre}". Cambia el nombre o agrega ubicación/año.`, 'err', 8000);
      } else {
        window.showToast('Error al guardar', e.message || JSON.stringify(e).slice(0, 150) || 'No se pudo crear el proyecto', 'err', 8000);
      }
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.style.opacity = '';
        saveBtn.style.cursor = '';
        saveBtn.textContent = originalLabel || 'Guardar proyecto';
      }
    }
  },
};

// ── Expose NP globally para que onclick inline pueda llamarlo ──
window.NP = NP;

// ── Wrapper bulletproof del save (sin dedupe artificial) ──
window.__npSaving = false;
window.__doSaveProject = async function (ev) {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  if (window.__npSaving) { return; }
  window.__npSaving = true;
  try {
    await NP.save();
  } catch (e) {
    console.error('[__doSaveProject] exception:', e);
    window.showToast('Error', String(e.message || e), 'err');
  } finally {
    window.__npSaving = false;
  }
};

// ── Wire CTAs ──
(function wireNP() {
  const btnNew    = document.getElementById('btn-new-project');
  const bg        = document.getElementById('drawer-bg');
  const closeBtn  = document.getElementById('drawer-close-btn');
  const codAuto   = document.getElementById('np-cod-auto');

  if (btnNew)   btnNew.addEventListener('click', () => NP.open());
  if (bg)       bg.addEventListener('click', () => NP.close());
  if (closeBtn) closeBtn.addEventListener('click', () => NP.close());
  if (codAuto)  codAuto.addEventListener('click', () => NP.suggestCode());

  // ESC cierra drawer
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('drawer-np')?.classList.contains('on')) NP.close();
  });
})();
