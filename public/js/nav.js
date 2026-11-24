/* In de geïnstalleerde app op Android: links naar andere sites openen in de echte Chrome (nieuw tabblad),
   zodat de uitleg in Stroomwekker open blijft en je heen en weer kunt wisselen. */
(function () {
  var app = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  if (!app || !/Android/i.test(navigator.userAgent)) return;
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target !== '_blank' || e.defaultPrevented) return;
    var u; try { u = new URL(a.href); } catch (x) { return; }
    if (u.origin === location.origin || !/^https?:$/.test(u.protocol) || /(^|\.)alexa\.amazon\./.test(u.host)) return; // Alexa-links: laat Android de Alexa-app openen
    e.preventDefault();
    location.href = 'intent://' + u.host + u.pathname + u.search + u.hash.replace(/#/g, '%23') +
      '#Intent;scheme=' + u.protocol.slice(0, -1) + ';package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(u.href) + ';end';
  });
})();

/* Home- en terugknop: altijd in beeld, op elke pagina behalve de startpagina. */
(function () {
  var pad = location.pathname.replace(/index\.html?$/, '');
  if (pad === '/' || pad === '') return;
  function start() {
    var css = '#sw-nav{position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:25;display:flex;gap:8px}' +
      '#sw-nav a{display:inline-grid;place-items:center;width:48px;height:48px;border-radius:12px;background:#0F2340;color:#fff;box-shadow:0 4px 14px rgba(5,15,35,.28);text-decoration:none;border:2px solid #F5B700}' +
      '#sw-nav a:focus-visible{outline:3px solid #F5B700;outline-offset:2px}#sw-nav svg{width:24px;height:24px}' +
      '@media print{#sw-nav{display:none}}body{padding-bottom:max(76px,env(safe-area-inset-bottom))}';
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    var n = document.createElement('nav'); n.id = 'sw-nav'; n.setAttribute('aria-label', 'Terug en startpagina');
    var i = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
    n.innerHTML = '<a href="/" class="terug" aria-label="Terug" title="Terug">' + i + '<path d="M15 18l-6-6 6-6"/></svg></a>' +
      '<a href="/" aria-label="Startpagina" title="Startpagina">' + i + '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg></a>';
    document.body.appendChild(n);
    n.querySelector('.terug').addEventListener('click', function (e) {
      var vanHier = false; try { vanHier = document.referrer && new URL(document.referrer).origin === location.origin; } catch (x) {}
      if (vanHier && history.length > 1) { e.preventDefault(); history.back(); }
    });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
