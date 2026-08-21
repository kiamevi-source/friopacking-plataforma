/* ════════════════════════════════════════════════════════════════════
   dashboard-contratistas.render.js
   Cablea el dashboard estático a Supabase (tabla evaluacion_contratistas).
   Conserva el HTML/CSS como esqueleto y sobrescribe las zonas de datos con
   los valores reales del último período con datos. Si Supabase falla, queda
   la vista estática (fallback). NO cambia el diseño.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const SB_URL = 'https://vsploxglutkbeokumunp.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzcGxveGdsdXRrYmVva3VtdW5wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3OTMyMzEsImV4cCI6MjA5MjM2OTIzMX0.wca52ejPsimIyG-iHS3TFRv4xjZF-55eDWoRR2I9nL0';
  const SB_HDR = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY };
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const d1 = v => (Math.round(v * 10) / 10).toFixed(1);            // siempre 1 decimal
  const n1 = v => { const r = Math.round(v * 10) / 10; return (r % 1 === 0) ? String(r) : r.toFixed(1); }; // sin .0
  const MEDAL = ['🥇', '🥈', '🥉'];
  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  // Niveles y colores (idénticos al estático)
  function nivel(v) {
    if (v >= 90) return { lbl: 'Estratégico', tx: '#1A6B4A', bg: '#ECF7F2', bd: '#C0DDD3', stroke: '#1A6B4A' };
    if (v >= 80) return { lbl: 'Confiable',   tx: '#0D2B45', bg: '#EBF0F8', bd: '#C0CDE0', stroke: '#3DD6B5' };
    if (v >= 65) return { lbl: 'Observado',   tx: '#7A5C1E', bg: '#F8F3E8', bd: '#DCCFAB', stroke: '#7A5C1E' };
    return           { lbl: 'Crítico',    tx: '#8B2323', bg: '#F8EEEE', bd: '#DCC0C0', stroke: '#8B2323' };
  }
  const lvTag = v => { const n = nivel(v); return `<span class="lv-tag" style="background:${n.bg};color:${n.tx};border-color:${n.bd}">${n.lbl}</span>`; };
  const ssCls = v => v < 60 ? 'bad' : v < 70 ? 'lo' : v < 85 ? 'ok' : 'hi';   // celdas .ss (4 niveles)
  const sf3 = v => v < 65 ? '#8B2323' : v < 80 ? '#0D2B45' : '#3DD6B5';       // celdas .sf/.sn (3 niveles)

  const CRITS = [
    { k: 'ssoma', p: 'ssoma', short: 'SSOMA',   name: 'SSOMA',        ico: '🦺', t: '🦺 SSOMA / Seguridad — Ranking Completo',      lbl: 'SSOMA / Seguridad',      sub: 'Controles Equipo de protección · supervisión · normas' },
    { k: 'cumpl', p: 'cumpl', short: 'Cumpl.',  name: 'Cumplimiento', ico: '📋', t: '📋 Cumplimiento — Ranking Completo',            lbl: 'Cumplimiento',           sub: 'Horario · cronogramas · documentación' },
    { k: 'cal',   p: 'cal',   short: 'Calidad', name: 'Calidad',      ico: '⭐', t: '⭐ Calidad del Servicio — Ranking Completo',     lbl: 'Calidad del Servicio',   sub: 'Estándares técnicos · retrabajos' },
    { k: 'gest',  p: 'gest',  short: 'Gestión', name: 'Gestión',      ico: '🤝', t: '🤝 Gestión Administrativa — Ranking Completo',   lbl: 'Gestión Administrativa', sub: 'Reuniones · respuesta · responsabilidad' },
  ];
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const avgOf = (C, p) => avg(C.map(c => c[p]));
  const strengthWeak = c => {
    let mx = CRITS[0], mn = CRITS[0];
    CRITS.forEach(cr => { if (c[cr.p] > c[mx.p]) mx = cr; if (c[cr.p] < c[mn.p]) mn = cr; });
    return { mx, mn };
  };

  async function main() {
    // Último período con datos
    let per = await fetch(SB_URL + '/rest/v1/evaluacion_contratistas?select=periodo&order=periodo.desc&limit=1', { headers: SB_HDR }).then(r => r.ok ? r.json() : []);
    if (!per.length) { console.warn('[dash] sin datos en Supabase; se mantiene la vista estática'); return; }
    const periodo = per[0].periodo;
    const rows = await fetch(SB_URL + '/rest/v1/evaluacion_contratistas?periodo=eq.' + periodo +
      '&select=contratista,especialidad,prom_seguridad,prom_cumplimiento,prom_calidad,prom_gestion,puntaje_final', { headers: SB_HDR }).then(r => r.ok ? r.json() : []);
    if (!rows.length) { console.warn('[dash] período sin filas'); return; }

    // Un registro agregado por contratista (promedio de sus filas)
    const map = {};
    rows.forEach(r => {
      const k = r.contratista;
      if (!map[k]) map[k] = { nombre: k, ssoma: [], cumpl: [], cal: [], gest: [], final: [] };
      map[k].ssoma.push(+r.prom_seguridad); map[k].cumpl.push(+r.prom_cumplimiento);
      map[k].cal.push(+r.prom_calidad); map[k].gest.push(+r.prom_gestion); map[k].final.push(+r.puntaje_final);
    });
    const C = Object.values(map).map(c => ({
      nombre: c.nombre, ssoma: avg(c.ssoma), cumpl: avg(c.cumpl), cal: avg(c.cal), gest: avg(c.gest), final: avg(c.final)
    }));
    const N = C.length;
    const byFinal = C.slice().sort((a, b) => b.final - a.final);

    // Promedio por especialidad (a nivel de fila, no de contratista)
    const espMap = {};
    rows.forEach(r => { const e = r.especialidad || '—'; (espMap[e] = espMap[e] || []).push(+r.puntaje_final); });
    const esp = {}; Object.keys(espMap).forEach(e => esp[e] = avg(espMap[e]));

    try { renderPeriodo(periodo, N); } catch (e) { console.warn('[dash] periodo', e); }
    try { renderS0(C, N, byFinal, esp); } catch (e) { console.warn('[dash] S0', e); }
    try { renderS1(C, byFinal); } catch (e) { console.warn('[dash] S1', e); }
    try { renderS2(byFinal); } catch (e) { console.warn('[dash] S2', e); }
    try { renderS3(C); } catch (e) { console.warn('[dash] S3', e); }
    try { renderS4(C); } catch (e) { console.warn('[dash] S4', e); }
    try { renderCritValues(C); } catch (e) { console.warn('[dash] critValues', e); }
    console.info('[dash] render OK · ' + N + ' contratistas · período ' + periodo);
  }

  function periodoLabel(periodo) {
    const p = String(periodo).split('-'); return MESES[(+p[1]) - 1] + ' ' + p[0];
  }
  function renderPeriodo(periodo, N) {
    const lbl = periodoLabel(periodo);
    $$('.period-tag').forEach(el => el.textContent = lbl);
    // Reemplazar en textos hoja: "<mes> 20xx" → período real, y "NN empresas evaluadas" → N
    $$('div, span, p').forEach(el => {
      if (el.children.length) return;
      const t = el.textContent;
      if (/20\d{2}/.test(t) && /(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic)/i.test(t)) {
        el.textContent = t.replace(/(Enero|Febrero|Marzo|Abril|Mayo|Junio|Julio|Agosto|Septiembre|Octubre|Noviembre|Diciembre)\s+20\d{2}/i, lbl);
      }
      if (/\d+\s+empresas\b/i.test(el.textContent)) {
        el.textContent = el.textContent.replace(/\d+(\s+empresas\b)/i, N + '$1');
      }
    });
  }

  // ── S0 · Vista Ejecutiva ──────────────────────────────────────────────
  function renderS0(C, N, byFinal, esp) {
    const est = C.filter(c => c.final >= 90).length;
    const conf = C.filter(c => c.final >= 80 && c.final < 90).length;
    const obs = C.filter(c => c.final >= 65 && c.final < 80).length;
    const crit = C.filter(c => c.final < 65).length;
    const risk = obs + crit;
    const riskPct = Math.round(risk / N * 100);

    const univ = $('#s0 .univ');
    if (univ) univ.innerHTML =
      `<div class="univ-item"><div class="uv">${N}</div><div class="ul">Empresas Evaluadas</div></div>` +
      kpi('ke', 'e', est, N, 'Estratégicos ≥ 90 pts', 'Candidatos a renovar contrato') +
      kpi('kc', 'c', conf, N, 'Confiables 80–89 pts', 'Buen desempeño, continuar') +
      kpi('ko', 'o', obs, N, 'Observados 65–79 pts', 'Requieren seguimiento activo') +
      kpi('kr', 'r', crit, N, 'Críticos &lt; 65 pts', 'Intervención urgente') +
      `<div class="kpi" style="border-top-color:var(--navy)"><div class="kv" style="font-size:22pt">${riskPct}%</div><div class="kl">En zona de riesgo</div><div class="kh">${risk} de ${N} empresas</div></div>`;

    // Ranking izquierdo (34 filas)
    const panel = $$('#s0 .panel').find(p => /Ranking General/.test((p.querySelector('.sh') || {}).textContent || ''));
    if (panel) {
      panel.innerHTML = `<div class="sh">Ranking General — ${N} Contratistas</div>` +
        byFinal.map((c, i) => rrow(c, i)).join('');
    }

    // Insights
    setInsight('good', byFinal.filter(c => c.final >= 90).map(c => c.nombre).join(' · '),
      `Puntajes ${d1(Math.min(...byFinal.filter(c=>c.final>=90).map(c=>c.final)))}–${d1(byFinal[0].final)} pts. Consistentes en los 4 criterios. Candidatos para ampliar alcance contractual.`);
    setInsight('warn', C.filter(c => c.final >= 65 && c.final < 70).map(c => c.nombre).join(' · '),
      'Rango 65–69 pts. Sin mejora documentada en 30 días: considerar suspensión contractual.');
    const criticos = C.filter(c => c.final < 65).sort((a, b) => a.final - b.final);
    if (criticos.length) {
      const w = criticos[0];
      setInsightLabel('crit', `! Acción Inmediata — ${esc(w.nombre)} · ${d1(w.final)} pts`);
      setInsight('crit', `SSOMA: ${n1(w.ssoma)} · Calidad: ${n1(w.cal)} · Cumplimiento: ${n1(w.cumpl)}`,
        'Bajo umbral mínimo en todos los criterios. Riesgo operacional y legal. Decisión urgente.');
    }
    // Criterio más débil
    const avgs = CRITS.map(cr => ({ cr, v: avgOf(C, cr.p) })).sort((a, b) => a.v - b.v);
    const weak = avgs[0], strong = avgs[avgs.length - 1];
    const ssBajo = C.filter(c => c.ssoma < 65).length;
    setInsight('info', `${weak.cr.short === 'SSOMA' ? 'SSOMA' : weak.cr.lbl} es el criterio más débil — promedio ${d1(weak.v)} pts`,
      `${ssBajo} empresas con SSOMA &lt; 65. ${strong.cr.short === 'Gestión' ? 'Gestión' : strong.cr.lbl} lidera (${d1(strong.v)} pts). Se recomienda programa de capacitación.`);

    // Distribución por nivel
    const distBar = $('#s0 .dist-bar');
    if (distBar) {
      const segs = [[est, '#1A6B4A', '3px 0 0 3px'], [conf, '#0D2B45', ''], [obs, '#7A5C1E', ''], [crit, '#8B2323', '0 3px 3px 0']];
      distBar.innerHTML = segs.map(([n, col, rad]) => `<div style="width:${(n / N * 100).toFixed(1)}%;background:${col}${rad ? ';border-radius:' + rad : ''}"></div>`).join('');
    }
    const dvs = $$('#s0 .dl .dv');
    if (dvs.length >= 4) { [est, conf, obs, crit].forEach((v, i) => dvs[i] && (dvs[i].textContent = v)); }

    // Grid de especialidades (actualizar en sitio para conservar imágenes de fondo)
    $$('#s0 .spec-card').forEach(card => {
      const nm = (card.querySelector('.spec-name') || {}).textContent || '';
      const key = Object.keys(esp).find(e => e === nm || e.replace(/^Inst\.\s*/, '') === nm.replace(/^Inst\.\s*/, ''));
      if (key == null) return;
      const score = Math.round(esp[key]);
      const nv = nivel(score);
      const rv = card.querySelector('.spec-rv'); if (rv) { rv.textContent = score; rv.style.color = nv.stroke; }
      const lv = card.querySelector('.spec-lv'); if (lv) { lv.textContent = nv.lbl; lv.style.color = nv.stroke; }
      const circles = card.querySelectorAll('circle');
      if (circles.length >= 2) {
        const c2 = circles[1];
        c2.setAttribute('stroke', nv.stroke);
        c2.setAttribute('stroke-dashoffset', (194.8 * (1 - score / 100)).toFixed(1));
      }
    });
  }
  function kpi(kc, kv, val, N, l, h) {
    return `<div class="kpi ${kc}"><div class="kv ${kv}" style="font-size:22pt">${val}<span style="font-size:11pt;color:var(--mu)"> /${N}</span></div><div class="kl">${l}</div><div class="kh">${h}</div></div>`;
  }
  function rrow(c, i) {
    const nv = nivel(c.final);
    const top = i < 3;
    const rn = top ? `<div class="rn" style="color:#1A6B4A;font-size:15pt">${MEDAL[i]}</div>` : `<div class="rn" style="color:#CBD5E0;">${i + 1}</div>`;
    const nmStyle = top ? 'font-weight:700;color:#1A2332' : 'font-weight:500;color:#6B7A8D';
    const wrap = i === 0 ? ' style="background:#F0FBF7;border-left:2px solid #3DD6B5;"' : ' style="border-left:2px solid transparent;"';
    return `<div class="rrow"${wrap}>${rn}<div style="flex:1;min-width:0"><div class="rb-nm"><span style="${nmStyle}">${esc(c.nombre)}</span>${lvTag(c.final)}</div><div class="rb-tr"><div class="rb-fl" style="width:${c.final}%;background:${nv.tx}"></div></div></div><div class="rs" style="color:${nv.tx}">${d1(c.final)}</div></div>`;
  }
  function setInsight(cls, body, sub) {
    const el = $('#s0 .insight.' + cls); if (!el) return;
    const b = el.querySelector('.ibody'); if (b) b.innerHTML = body;
    const s = el.querySelector('.isub'); if (s) s.innerHTML = sub;
  }
  function setInsightLabel(cls, html) {
    const el = $('#s0 .insight.' + cls); if (!el) return;
    const l = el.querySelector('.ilabel'); if (l) l.innerHTML = html;
  }

  // ── S2 · Ranking General (tabla completa) ─────────────────────────────
  function renderS2(byFinal) {
    const tb = $('#s2 table.rtable tbody'); if (!tb) return;
    tb.innerHTML = byFinal.map((c, i) => {
      const nv = nivel(c.final);
      const rank = i < 3 ? `<span class="tn" style="color:#1A6B4A">${MEDAL[i]}</span>` : `<span class="tn" style="color:${nv.tx}">${i + 1}</span>`;
      const cell = v => `<td class="c"><span class="ss ${ssCls(v)}">${n1(v)}</span></td>`;
      const { mx, mn } = strengthWeak(c);
      return `<tr><td class="c">${rank}</td><td><span class="tname">${esc(c.nombre)}</span></td>` +
        `<td><div class="tbw"><div class="tbb"><div class="tbf" style="background:${nv.tx};width:${c.final}%"></div></div><span class="tsv" style="color:${nv.tx}">${d1(c.final)}</span></div></td>` +
        cell(c.ssoma) + cell(c.cumpl) + cell(c.cal) + cell(c.gest) +
        `<td class="c">${lvTag(c.final)}</td>` +
        `<td class="c" style="color:#1A6B4A;font-size:7.5pt;font-weight:600">↑ ${mx.short}</td>` +
        `<td class="c" style="color:#8B2323;font-size:7.5pt;font-weight:600">↓ ${mn.short}</td></tr>`;
    }).join('');
  }

  // ── S4 · Ranking por Criterio (4 tbody) ───────────────────────────────
  function renderS4(C) {
    CRITS.forEach(cr => {
      const tb = document.getElementById('panel-' + cr.k); if (!tb) return;
      const ordered = C.slice().sort((a, b) => b[cr.p] - a[cr.p]);
      tb.innerHTML = ordered.map((c, i) => {
        const nv = nivel(c.final);
        const rank = i < 3 ? `<span style='font-size:13pt'>${MEDAL[i]}</span>` : `<span style="color:${nv.tx};font-weight:700">${i + 1}</span>`;
        const scell = (p) => {
          const v = c[p], col = sf3(v), hl = (p === cr.p) ? ' style="background:#F0FBF7;"' : ' style=""';
          return `<td class="c"${hl}><div class="sp"><div class="sb"><div class="sf" style="background:${col};width:${v}%"></div></div><span class="sn" style="color:${col}">${n1(v)}</span></div></td>`;
        };
        return `<tr><td class="c">${rank}</td><td><span class="tname">${esc(c.nombre)}</span></td>` +
          scell('ssoma') + scell('cumpl') + scell('cal') + scell('gest') +
          `<td class="c"><div class="tbw" style="justify-content:center"><div class="tbb" style="width:58px"><div class="tbf" style="background:${nv.tx};width:${c.final}%"></div></div><span style="font-size:12pt;font-weight:800;color:${nv.tx}">${d1(c.final)}</span></div></td>` +
          `<td class="c">${lvTag(c.final)}</td></tr>`;
      }).join('');
    });
  }

  // ── Promedios de criterio en S1/S3/S4 (headers/botones) + CM badges ────
  function renderCritValues(C) {
    const avgs = {}; CRITS.forEach(cr => avgs[cr.k] = avgOf(C, cr.p));
    const vals = CRITS.map(cr => avgs[cr.k]);
    const maxV = Math.max(...vals), minV = Math.min(...vals);
    // S3: valores de las pestañas #cav-*
    CRITS.forEach(cr => { const el = document.getElementById('cav-' + cr.k); if (el) el.textContent = d1(avgs[cr.k]); });
    // S4: botones .cbtn (valor + barra + etiqueta débil/fuerte)
    CRITS.forEach(cr => {
      const btn = document.getElementById('btn-' + cr.k); if (!btn) return;
      const v = avgs[cr.k];
      const bv = btn.querySelector('.cbtn-val'); if (bv) bv.textContent = d1(v);
      const bf = btn.querySelector('.cbtn-fill'); if (bf) bf.style.width = v + '%';
      const bs = btn.querySelector('.cbtn-sub');
      if (bs) bs.innerHTML = cr.sub + (v === minV ? '<br>⚠ Criterio más débil' : v === maxV ? '<br>✓ Criterio más fuerte' : '');
    });
    // CM badges (objeto global del módulo) + refrescar título/badge activos
    try {
      if (typeof CM !== 'undefined') {
        CRITS.forEach(cr => { if (CM[cr.k]) CM[cr.k].b = 'Promedio: ' + d1(avgs[cr.k]) + ' pts'; });
        if (typeof setCrit === 'function') setCrit('ssoma');
      }
    } catch (e) { /* CM fuera de alcance */ }
  }

  // ── S1 · Panel de Decisiones ──────────────────────────────────────────
  const minCrit = c => Math.min(c.ssoma, c.cumpl, c.cal, c.gest);
  function decItem(nm, sub, val, col) {
    return `<div class="dec-item"><div><div class="dec-nm">${esc(nm)}</div><div class="dec-sub">${sub}</div></div><div class="dec-val" style="color:${col}">${val}</div></div>`;
  }
  function setDecItems(sel, items) {
    const card = $(sel); if (!card) return;
    const title = card.querySelector('.dec-title');
    card.innerHTML = (title ? title.outerHTML : '') + items.join('');
  }
  function renderS1(C, byFinal) {
    const avgs = {}; CRITS.forEach(cr => avgs[cr.k] = avgOf(C, cr.p));
    const vals = CRITS.map(cr => avgs[cr.k]); const maxV = Math.max(...vals), minV = Math.min(...vals);
    // 4 tarjetas de criterio (primer hijo grid de #s1)
    const s1 = document.getElementById('s1');
    const grid = s1 && s1.children[0];
    if (grid && /repeat\(4/.test(grid.getAttribute('style') || '')) {
      grid.innerHTML = CRITS.map(cr => {
        const v = avgs[cr.k], nv = nivel(v);
        const tag = v === minV ? '⚠ Criterio más débil' : v === maxV ? '✓ Criterio más fuerte' : '&nbsp;';
        return `<div class="panel" style="padding:14px;text-align:center"><div style="font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--mu);margin-bottom:4px">${cr.ico} ${cr.name}</div><div style="font-size:28pt;font-weight:900;color:${nv.tx};line-height:1">${d1(v)}</div><div style="height:5px;background:var(--bdr2);border-radius:3px;overflow:hidden;margin-top:8px"><div style="width:${v}%;height:100%;background:${nv.tx};border-radius:3px"></div></div><div style="font-size:7pt;color:var(--mu);margin-top:6px;font-weight:600">${tag}</div></div>`;
      }).join('');
    }
    // dec-cards
    setDecItems('#s1 .dec-card.ren', byFinal.filter(c => c.final >= 90).slice(0, 6)
      .map(c => decItem(c.nombre, 'Mín. criterio: ' + n1(minCrit(c)) + ' pts', d1(c.final), '#1A6B4A')));
    setDecItems('#s1 .dec-card.rie', C.filter(c => c.ssoma < 65).sort((a, b) => a.ssoma - b.ssoma)
      .map(c => decItem(c.nombre, 'SSOMA ' + n1(c.ssoma) + ' pts · bajo umbral 65', n1(c.ssoma), '#8B2323')));
    const brechas = C.map(c => { const sw = strengthWeak(c); return { c, mx: sw.mx, mn: sw.mn, gap: c[sw.mx.p] - c[sw.mn.p] }; })
      .sort((a, b) => b.gap - a.gap).slice(0, 6);
    setDecItems('#s1 .dec-card.bre', brechas.map(b =>
      decItem(b.c.nombre, '↑ ' + b.mx.name + ': ' + n1(b.c[b.mx.p]) + ' · ↓ ' + b.mn.name + ': ' + n1(b.c[b.mn.p]) + ' (Δ ' + Math.round(b.gap) + ')', d1(b.c.final), nivel(b.c.final).tx)));
    // Tabla zona de riesgo (final < 80, asc)
    const tb = $('#s1 table.rtable tbody');
    if (tb) {
      const risk = C.filter(c => c.final < 80).sort((a, b) => a.final - b.final);
      const cell = v => `<td class="c"><span class="ss ${ssCls(v)}">${n1(v)}</span></td>`;
      tb.innerHTML = risk.map((c, i) => {
        const nv = nivel(c.final);
        const acc = c.final < 65 ? ['Suspender', '#8B2323'] : ['Plan 30d', '#7A5C1E'];
        return `<tr><td class="c"><span class="tn" style="color:${nv.tx}">${i + 1}</span></td><td><span class="tname">${esc(c.nombre)}</span></td>` +
          `<td><div class="tbw"><div class="tbb"><div class="tbf" style="background:${nv.tx};width:${c.final}%"></div></div><span class="tsv" style="color:${nv.tx}">${d1(c.final)}</span></div></td>` +
          cell(c.ssoma) + cell(c.cumpl) + cell(c.cal) + cell(c.gest) +
          `<td class="c">${lvTag(c.final)}</td><td class="c"><span style="font-size:7.5pt;font-weight:700;color:${acc[1]}">${acc[0]}</span></td></tr>`;
      }).join('');
    }
  }

  // ── S3 · Análisis por Criterio (cuerpos de los 4 paneles) ─────────────
  function s3Panel(cr, C) {
    const p = cr.p, N = C.length;
    const v = avgOf(C, p), nv = nivel(v);
    const est = C.filter(c => c[p] >= 90).length, conf = C.filter(c => c[p] >= 80 && c[p] < 90).length,
          obs = C.filter(c => c[p] >= 65 && c[p] < 80).length, crit = C.filter(c => c[p] < 65).length;
    const sorted = C.slice().sort((a, b) => b[p] - a[p]);
    const top3 = sorted.slice(0, 3), bot3 = sorted.slice(-3).reverse();
    const item = (c, col) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #EDF2F7"><span style="font-size:8.5pt;font-weight:600;color:#1A2332">${esc(c.nombre)}</span><span style="font-size:11pt;font-weight:800;color:${col}">${n1(c[p])}</span></div>`;
    const mini = (n, bg, col, lbl) => `<div style="text-align:center;padding:6px;background:${bg};border-radius:4px"><div style="font-size:14pt;font-weight:900;color:${col}">${n}</div><div style="font-size:6.5pt;color:${col};font-weight:600">${lbl}</div></div>`;
    const pct = n => (n / N * 100).toFixed(1);
    return `<div class="ca-panel">` +
      `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #EDF2F7">` +
        `<div style="display:flex;align-items:center;gap:12px"><div style="font-size:26pt">${cr.ico}</div><div><div style="font-size:11pt;font-weight:800;color:#0D2B45">${cr.lbl}</div><div style="font-size:7.5pt;color:#6B7A8D;margin-top:1px">Promedio del mes · ${N} empresas evaluadas</div></div></div>` +
        `<div style="text-align:right"><div style="font-size:30pt;font-weight:900;color:${nv.tx};line-height:1">${d1(v)}</div><div style="font-size:7pt;font-weight:600;color:#A0AEC0">/ 100 pts</div><div style="margin-top:4px">${lvTag(v)}</div></div>` +
      `</div>` +
      `<div style="margin-bottom:14px"><div style="font-size:7pt;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#A0AEC0;margin-bottom:7px">Distribución de empresas</div>` +
        `<div style="height:16px;border-radius:4px;overflow:hidden;display:flex;gap:2px;margin-bottom:8px">` +
          `<div style="width:${pct(est)}%;background:#1A6B4A;border-radius:3px 0 0 3px"></div><div style="width:${pct(conf)}%;background:#0D2B45"></div><div style="width:${pct(obs)}%;background:#7A5C1E"></div><div style="width:${pct(crit)}%;background:#8B2323;border-radius:0 3px 3px 0"></div>` +
        `</div>` +
        `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">${mini(est,'#ECF7F2','#1A6B4A','Estratégico')}${mini(conf,'#EBF0F8','#0D2B45','Confiable')}${mini(obs,'#F8F3E8','#7A5C1E','Observado')}${mini(crit,'#F8EEEE','#8B2323','Crítico')}</div>` +
      `</div>` +
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">` +
        `<div><div style="font-size:7pt;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#A0AEC0;margin-bottom:8px">Top 3 — Mayor Puntaje</div>${top3.map(c => item(c, '#1A6B4A')).join('')}</div>` +
        `<div><div style="font-size:7pt;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#A0AEC0;margin-bottom:8px">Bajo 3 — Menor Puntaje</div>${bot3.map(c => item(c, '#8B2323')).join('')}</div>` +
      `</div>` +
      `<div style="border-left:3px solid #0D2B45;padding:10px 14px;border-radius:0 6px 6px 0;background:#EBF0F8;border:1px solid #C0CDE0;border-left:3px solid #0D2B45"><div style="font-size:7pt;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#0D2B45;margin-bottom:3px">Análisis</div><div style="font-size:8.5pt;font-weight:600;color:#1A2332">${crit} empresas bajo el umbral mínimo (65 pts) en ${cr.name}.</div></div>` +
      `</div>`;
  }
  function renderS3(C) {
    CRITS.forEach(cr => { const wrap = document.getElementById('ca-panel-' + cr.k); if (wrap) wrap.innerHTML = s3Panel(cr, C); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => main().catch(e => console.warn('[dash]', e)));
  else main().catch(e => console.warn('[dash]', e));
})();
