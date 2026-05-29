// Family Hub - bottom tab bar. Include once per app page (after the .app content):
//   <script src="/assets/tabbar.js"></script>
// Renders a fixed 5-tab nav and highlights the active tab by pathname.
(function () {
  const TABS = [
    { href: '/home.html',      label: 'Home',      ico: '🏠' },
    { href: '/groceries.html', label: 'Groceries', ico: '🛒' },
    { href: '/calendar.html',  label: 'Calendar',  ico: '📅' },
    { href: '/food.html',      label: 'Food',      ico: '🍎' },
    { href: '/kids.html',      label: 'Kids',      ico: '🧸' },
  ];
  const path = window.location.pathname.replace(/\/$/, '') || '/home.html';
  const nav = document.createElement('nav');
  nav.className = 'tabbar';
  nav.innerHTML = TABS.map((t) => {
    const active = path === t.href || (path === '/' && t.href === '/home.html');
    return `<a href="${t.href}" class="${active ? 'active' : ''}">
      <span class="ico">${t.ico}</span><span>${t.label}</span></a>`;
  }).join('');
  document.body.appendChild(nav);
})();
