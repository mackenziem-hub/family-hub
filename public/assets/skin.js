/* Family Hub - skin switcher.
   Skins are pure CSS-variable sets in app.css, toggled via data-skin on <html>.
   Resolution order: ?skin= query (handy for sharing/testing) > saved choice > default.
   Loaded synchronously in <head> so the attribute is set before first paint (no flash).
   The picker UI is injected after the DOM is ready. Choice persists per device. */
(function () {
  var SKINS = ['midnight', 'playful', 'calm', 'cozy'];
  var META = {
    midnight: { label: 'Midnight', swatch: '#11172c', sub: 'dark + teal' },
    playful: { label: 'Playful', swatch: '#14b8a6', sub: 'bright + fun' },
    calm: { label: 'Calm', swatch: '#5b8c76', sub: 'minimal sage' },
    cozy: { label: 'Cozy', swatch: '#c9744a', sub: 'warm cream' },
  };
  var DEFAULT = 'calm';
  var KEY = 'familyhub.skin';

  function valid(s) { return SKINS.indexOf(s) >= 0; }

  function resolve() {
    try {
      var q = new URLSearchParams(location.search).get('skin');
      if (valid(q)) return q;
    } catch (e) {}
    try {
      var s = localStorage.getItem(KEY);
      if (valid(s)) return s;
    } catch (e) {}
    return DEFAULT;
  }

  function apply(skin) { document.documentElement.setAttribute('data-skin', skin); }

  function save(skin) {
    apply(skin);
    try { localStorage.setItem(KEY, skin); } catch (e) {}
    var btn = document.getElementById('skinBtn');
    if (btn) btn.style.background = META[skin].swatch;
    var pop = document.getElementById('skinPop');
    if (pop) {
      [].forEach.call(pop.querySelectorAll('[data-skin-opt]'), function (el) {
        el.setAttribute('aria-current', el.getAttribute('data-skin-opt') === skin ? 'true' : 'false');
      });
    }
  }

  // Apply ASAP (this script is in <head>, before <body> paints).
  apply(resolve());

  function buildPicker() {
    if (document.getElementById('skinPicker')) return;
    var current = resolve();

    var style = document.createElement('style');
    style.textContent =
      '#skinPicker{position:fixed;top:calc(env(safe-area-inset-top) + 10px);right:10px;z-index:9999;font-family:Inter,system-ui,sans-serif;}' +
      '#skinBtn{width:38px;height:38px;border-radius:50%;border:2px solid rgba(255,255,255,.7);box-shadow:0 3px 12px rgba(0,0,0,.28);cursor:pointer;display:grid;place-items:center;font-size:16px;padding:0;}' +
      '#skinBtn:active{transform:scale(.94);}' +
      '#skinPop{position:absolute;top:46px;right:0;width:200px;background:#fff;color:#14202e;border-radius:14px;box-shadow:0 12px 36px rgba(0,0,0,.22);padding:6px;display:none;}' +
      '#skinPop.open{display:block;}' +
      '#skinPop .hd{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#7b8aa0;padding:8px 10px 4px;}' +
      '#skinPop button{width:100%;display:flex;align-items:center;gap:10px;background:none;border:0;cursor:pointer;padding:9px 10px;border-radius:10px;font:inherit;color:inherit;text-align:left;}' +
      '#skinPop button:hover{background:#f1f5f9;}' +
      '#skinPop button[aria-current="true"]{background:#eef6f4;}' +
      '#skinPop .dot{width:18px;height:18px;border-radius:50%;flex:0 0 auto;box-shadow:inset 0 0 0 1px rgba(0,0,0,.12);}' +
      '#skinPop .nm{font-weight:600;font-size:14px;}' +
      '#skinPop .sb{font-size:11px;color:#7b8aa0;}' +
      '#skinPop .tick{margin-left:auto;color:#14b8a6;font-weight:900;opacity:0;}' +
      '#skinPop button[aria-current="true"] .tick{opacity:1;}';
    document.head.appendChild(style);

    var wrap = document.createElement('div');
    wrap.id = 'skinPicker';

    var btn = document.createElement('button');
    btn.id = 'skinBtn';
    btn.type = 'button';
    btn.title = 'Change theme';
    btn.setAttribute('aria-label', 'Change theme');
    btn.textContent = '🎨'; // palette
    btn.style.background = META[current].swatch;

    var pop = document.createElement('div');
    pop.id = 'skinPop';
    var hd = document.createElement('div');
    hd.className = 'hd';
    hd.textContent = 'Theme';
    pop.appendChild(hd);

    SKINS.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-skin-opt', s);
      b.setAttribute('aria-current', s === current ? 'true' : 'false');
      b.innerHTML =
        '<span class="dot" style="background:' + META[s].swatch + '"></span>' +
        '<span><span class="nm">' + META[s].label + '</span><br><span class="sb">' + META[s].sub + '</span></span>' +
        '<span class="tick">✓</span>';
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        save(s);
        pop.classList.remove('open');
      });
      pop.appendChild(b);
    });

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      pop.classList.toggle('open');
    });
    document.addEventListener('click', function () { pop.classList.remove('open'); });

    wrap.appendChild(btn);
    wrap.appendChild(pop);
    document.body.appendChild(wrap);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildPicker);
  else buildPicker();
})();
