(function () {
  'use strict';
  var panel = document.getElementById('panel');
  var handle = document.getElementById('handle');
  var mobile = window.matchMedia('(max-width:879px)');
  var legend = document.getElementById('legend');
  var filter = document.getElementById('filterBtn');
  var gesture = document.getElementById('mapGesture');
  function sync() {
    if (!mobile.matches) panel.classList.remove('min', 'expanded');
    var collapsed = panel.classList.contains('min');
    handle.textContent = collapsed ? '↑ Otwórz panel' : '⌖ Pokaż mapę';
    handle.setAttribute('aria-expanded', String(!collapsed));
    handle.setAttribute('aria-label', collapsed ? 'Rozwiń panel' : 'Zwiń panel');
    handle.title = handle.getAttribute('aria-label');
    document.getElementById('mapGestureText').textContent = collapsed ? 'Przesuń w górę · wróć do trasy ↑' : 'Przesuń w dół · pokaż mapę ↓';
    gesture.setAttribute('aria-expanded', String(!collapsed));
    document.getElementById('mapOnlyBtn').hidden = true;
    panel.classList.toggle('route-active', document.getElementById('pgRoute').classList.contains('on'));
    if (mobile.matches) document.getElementById('mapwrap').style.bottom = '168px';
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
  var drag = null, suppressClick = false;
  gesture.addEventListener('pointerdown', function (e) {
    if (!mobile.matches || !e.isPrimary || e.button !== 0) return;
    drag = { id:e.pointerId, x:e.clientX, y:e.clientY, collapsed:panel.classList.contains('min') };
    gesture.setPointerCapture(e.pointerId);
  });
  gesture.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.collapsed) panel.style.transform = 'translateY(' + Math.max(0,e.clientY-drag.y) + 'px)';
  });
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dy=e.clientY-drag.y, dx=e.clientX-drag.x;
    var toggle=e.type==='pointerup' && Math.abs(dy)>50 && Math.abs(dy)>Math.abs(dx) && (drag.collapsed ? dy<0 : dy>0);
    drag=null; panel.style.transform='';
    if (toggle) { suppressClick=true; handle.click(); setTimeout(function(){suppressClick=false;},300); }
  }
  gesture.addEventListener('pointerup', endDrag);
  gesture.addEventListener('pointercancel', endDrag);
  gesture.addEventListener('lostpointercapture', function(){drag=null;panel.style.transform='';});
  gesture.onclick=function(){if(!suppressClick)handle.click();};
  sync();

  var installEvent;
  var install = document.getElementById('installBtn');
  var help = document.createElement('dialog');
  help.id = 'installHelp';
  help.innerHTML = '<h2>Zainstaluj VESNA.GROT</h2><p>Wybierz telefon. Aplikację dodasz bezpośrednio do ekranu głównego, bez sklepu.</p><div class="install-choices"><button type="button" class="btn" id="installAndroid">Android</button><button type="button" class="btn" id="installIOS">iPhone / iPad</button></div><div id="installSteps" role="status">Wybierz urządzenie powyżej.</div><p class="tiny">Instalację potwierdzasz w systemie. Mapy i trasy wymagają internetu.</p><form method="dialog"><button class="btn wide">Zamknij</button></form>';
  document.body.appendChild(help);
  window.addEventListener('beforeinstallprompt', function (event) { event.preventDefault(); installEvent = event; });
  function steps(platform) {
    document.getElementById('installSteps').innerHTML = platform === 'ios'
      ? '<b>iPhone / iPad</b><ol><li>Otwórz tę stronę w Safari.</li><li>Dotknij Udostępnij (kwadrat ze strzałką ↑).</li><li>Wybierz „Do ekranu początkowego”, włącz „Otwórz jako aplikację”, jeśli jest dostępne, i potwierdź „Dodaj”.</li></ol>'
      : '<b>Android</b><ol><li>Otwórz tę stronę w Chrome.</li><li>Dotknij menu ⋮ → „Zainstaluj aplikację” lub „Dodaj do ekranu głównego”.</li><li>Potwierdź instalację. Ikona VESNA.GROT pojawi się na telefonie.</li></ol><p>Ta przeglądarka nie udostępnia teraz automatycznego monitu.</p>';
  }
  async function installNative() {
    if (installEvent) {
      var prompt = installEvent; installEvent = null;
      try { await prompt.prompt(); await prompt.userChoice; } catch (_) { steps('android'); if(!help.open)help.showModal(); }
    } else { steps('android'); if(!help.open)help.showModal(); }
  }
  document.getElementById('installAndroid').onclick = installNative;
  document.getElementById('installIOS').onclick = function(){steps('ios');};
  install.onclick = function () {
    if(installEvent) { installNative(); return; }
    help.showModal();
    if(/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1)) steps('ios');
    else if(/Android/.test(navigator.userAgent)) steps('android');
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
