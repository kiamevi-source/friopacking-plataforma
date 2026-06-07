/* ════════════════════════════════════════════════════════════════════
   core.js — Cliente Supabase, helpers globales, toast, banner, errores
   Dependencias: config.js (SB_URL, SB_KEY), supabase UMD, lucide
   ════════════════════════════════════════════════════════════════════ */

// ── Inicializar cliente Supabase ──
window.sb = null;
try {
  window.sb = supabase.createClient(window.SB_URL, window.SB_KEY);
} catch (e) {
  console.warn('Supabase init failed', e);
}

// ── Helpers de texto ──
window.escapeHtml = function (s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

// ── Helpers de fecha ──
window.fmtDateShort = function (iso) {
  try {
    const d = new Date(iso);
    const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    return `${d.getDate()} ${months[d.getMonth()]}`;
  } catch {
    return '—';
  }
};

window.daysUntil = function (iso) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(iso); d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
};

// ── Animated counter ──
window.animateNumber = function (el, target, duration = 900) {
  const start = performance.now();
  function step(t) {
    const p = Math.min((t - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(target * eased);
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = target;
  }
  requestAnimationFrame(step);
};

// ── Toast ──
window.showToast = function (t, s, type, duration) {
  const el = document.getElementById('toast');
  if (!el) return;
  document.getElementById('toast-t').textContent = t;
  document.getElementById('toast-s').textContent = s || '';
  el.classList.toggle('err', type === 'err');
  el.classList.add('on');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove('on'), duration || 4500);
};

// ── Success banner (post-NP) ──
window.showSuccessBanner = function (proj) {
  const old = document.getElementById('np-success-banner');
  if (old) old.remove();

  const banner = document.createElement('div');
  banner.id = 'np-success-banner';
  banner.style.cssText = 'position:relative;margin:0 0 18px;padding:16px 22px;background:linear-gradient(135deg,#daf4ec 0%,#b5e8d6 100%);border:1px solid #5fd9c1;border-radius:14px;display:flex;align-items:center;gap:14px;animation:fade-up .4s ease both;box-shadow:0 8px 24px -8px rgba(62,203,176,.35)';
  banner.innerHTML = `
    <div style="width:42px;height:42px;background:#3ECBB0;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:22px;color:white;font-weight:800">✓</div>
    <div style="flex:1;min-width:0">
      <div style="font-family:Manrope,sans-serif;font-weight:800;font-size:15px;color:#0f1e35;line-height:1.2">Proyecto creado correctamente</div>
      <div style="font-size:13px;color:#1f9a82;font-weight:600;margin-top:3px"><b>${(proj.nombre || '').replace(/</g, '&lt;')}</b>${proj.cod_proyecto ? ' · ' + proj.cod_proyecto : ''}${proj.id ? ' · ID #' + proj.id : ''} ya está en Supabase</div>
    </div>
    <button onclick="this.parentElement.remove()" style="background:rgba(255,255,255,.5);border:none;width:30px;height:30px;border-radius:8px;cursor:pointer;color:#0f1e35;font-size:18px;font-weight:600;line-height:1">×</button>`;

  const main = document.querySelector('main.main');
  if (main) {
    const titleSection = main.querySelector('.title-h1')?.parentElement;
    if (titleSection) {
      titleSection.parentElement.insertBefore(banner, titleSection.nextSibling);
    } else {
      main.insertBefore(banner, main.firstChild);
    }
  }

  // Auto-dismiss after 12s
  setTimeout(() => {
    if (banner.parentElement) {
      banner.style.transition = 'opacity .4s, transform .4s';
      banner.style.opacity = '0';
      banner.style.transform = 'translateY(-8px)';
      setTimeout(() => banner.remove(), 400);
    }
  }, 12000);
};

// ── Spin animation (utility) ──
(function injectSpin() {
  if (document.getElementById('np-spin-style')) return;
  const s = document.createElement('style');
  s.id = 'np-spin-style';
  s.textContent = '@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}';
  document.head.appendChild(s);
})();

// ── Global error handlers ──
window.addEventListener('error', (e) => {
  console.error('[GlobalError]', e.error || e.message);
  if (typeof window.showToast === 'function') {
    window.showToast('Error JS', String(e.error || e.message).slice(0, 120), 'err');
  }
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[UnhandledRejection]', e.reason);
  if (typeof window.showToast === 'function') {
    window.showToast('Error async', String(e.reason).slice(0, 120), 'err');
  }
});

// ── Render Lucide icons on initial load ──
if (window.lucide) lucide.createIcons();
