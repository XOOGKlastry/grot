(function () {
  'use strict';
  var panel = document.getElementById('panel');
  var handle = document.getElementById('handle');
  var mobile = window.matchMedia('(max-width:879px)');
  var legend = document.getElementById('legend');
  var filter = document.getElementById('filterBtn');
  function sync() {
    if (!mobile.matches) panel.classList.remove('min', 'expanded');
    var collapsed = panel.classList.contains('min');
    handle.textContent = collapsed ? '↑ Otwórz panel' : '⌖ Pokaż mapę';
    handle.setAttribute('aria-expanded', String(!collapsed));
    handle.setAttribute('aria-label', collapsed ? 'Rozwiń panel' : 'Zwiń panel');
    handle.title = handle.getAttribute('aria-label');
    document.getElementById('mapOnlyBtn').hidden = true;
    panel.classList.toggle('route-active', document.getElementById('pgRoute').classList.contains('on'));
    if (mobile.matches) document.getElementById('mapwrap').style.bottom = '116px';
    else document.getElementById('mapwrap').style.bottom = '';
  }
  if (mobile.matches) panel.classList.add('min');
  document.getElementById('mapOnlyBtn').onclick = function () { panel.classList.add('min'); panel.classList.remove('expanded'); sync(); };
  document.addEventListener('grot:panel', function () {
    panel.classList.remove('expanded'); sync();
  });
  document.addEventListener('grot:page', function () {
    panel.classList.remove('min', 'expanded');
    legend.classList.remove('open'); filter.setAttribute('aria-expanded', 'false');
    sync();
  });
  document.querySelectorAll('#tabs .tab').forEach(function (tab) {
    tab.addEventListener('click', function () { panel.classList.remove('min', 'expanded'); sync(); });
  });
  document.querySelectorAll('#panel input,#panel textarea').forEach(function (input) {
    input.addEventListener('focus', function () { if (mobile.matches) { panel.classList.add('expanded'); sync(); } });
  });
  filter.onclick = function () {
    var open = legend.classList.toggle('open');
    if (open && mobile.matches) { panel.classList.add('min'); panel.classList.remove('expanded'); sync(); }
    filter.setAttribute('aria-expanded', String(open));
  };
  legend.addEventListener('click', function () { legend.classList.remove('open'); filter.setAttribute('aria-expanded', 'false'); });
  new MutationObserver(sync).observe(document.getElementById('tabs'), { subtree: true, attributes: true, attributeFilter: ['class'] });
  new ResizeObserver(sync).observe(panel);
  window.addEventListener('resize', sync);
  sync();

  var installEvent;
  var install = document.getElementById('installBtn');
  var help = document.createElement('dialog');
  help.id = 'installHelp';
  help.innerHTML = '<h2>VESNA.GROT na telefonie</h2><p>Instalujesz aplikację webową (PWA) bezpośrednio z przeglądarki, nie ze sklepu Google Play.</p><p><b>Android:</b> menu przeglądarki ⋮ → „Zainstaluj aplikację” lub „Dodaj do ekranu głównego”.</p><p><b>iPhone (Safari):</b> Udostępnij → „Do ekranu początkowego”.</p><p>Mapy, wyszukiwanie adresów i wyznaczanie tras wymagają internetu. Zapisane trasy pozostają na tym urządzeniu.</p><form method="dialog"><button class="btn wide">Rozumiem</button></form>';
  document.body.appendChild(help);
  window.addEventListener('beforeinstallprompt', function (event) { event.preventDefault(); installEvent = event; });
  install.onclick = async function () {
    if (installEvent) {
      var prompt = installEvent; installEvent = null;
      try { await prompt.prompt(); await prompt.userChoice; } catch (_) { help.showModal(); }
    } else help.showModal();
  };
  function installed() { install.hidden = true; document.body.classList.add('installed'); sync(); }
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) installed();
  window.addEventListener('appinstalled', installed);
  var go = document.getElementById('btnGo'), mapGo = document.getElementById('mapGo');
  function syncNavigation() {
    var href = go.getAttribute('href');
    mapGo.hidden = !href;
    if (href) mapGo.href = href; else mapGo.removeAttribute('href');
  }
  new MutationObserver(syncNavigation).observe(go, {attributes:true, attributeFilter:['href']});
  syncNavigation();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(function (err) { console.warn('Instalacja offline niedostępna:', err); });
})();
