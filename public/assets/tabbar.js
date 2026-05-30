// Family Hub - bottom tab bar. Include once per app page (after the .app content):
//   <script src="/assets/tabbar.js"></script>
// Renders a fixed 5-tab nav and highlights the active tab by pathname.
// Icons are inline SVG using currentColor, so they crisply recolor per skin
// (active tab = --accent, inactive = --text-muted) and stay sharp at any size.
(function () {
  const I = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5a.5.5 0 0 0 .5.5h12a.5.5 0 0 0 .5-.5V10"/><path d="M10 20v-5h4v5"/>',
    basket: '<path d="M5 9h14l-1.1 9.2a1.5 1.5 0 0 1-1.5 1.3H7.6a1.5 1.5 0 0 1-1.5-1.3L5 9Z"/><path d="M9 9 11 4M15 9l-2-5"/><path d="M9.5 12.5v3.5M14.5 12.5v3.5"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.2"/><path d="M3.5 9.5h17"/><path d="M8 3.5v3.2M16 3.5v3.2"/>',
    apple: '<path d="M12 8.4c-1.1-1.6-4-1.6-5.2.3-1.3 2.1-.5 7 1.7 9.2.9 1 2.1 1 3 .3.3-.2.7-.2 1 0 .9.7 2.1.7 3-.3 2.2-2.2 3-7.1 1.7-9.2-1.2-1.9-4.1-1.9-5.2-.3Z"/><path d="M12 8.4V5.5"/><path d="M12 5.6c.4-1.3 1.9-2.1 3.1-1.7.2 1.3-1.3 2.1-3.1 1.7Z"/>',
    smile: '<circle cx="12" cy="12" r="8.4"/><path d="M9 10.5h.01M15 10.5h.01"/><path d="M8.7 14.4a4.2 4.2 0 0 0 6.6 0"/>',
  };
  const svg = (p) => `<svg class="ico" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const TABS = [
    { href: '/home.html',      label: 'Home',      ico: svg(I.home) },
    { href: '/groceries.html', label: 'Groceries', ico: svg(I.basket) },
    { href: '/calendar.html',  label: 'Calendar',  ico: svg(I.calendar) },
    { href: '/food.html',      label: 'Food',      ico: svg(I.apple) },
    { href: '/kids.html',      label: 'Kids',      ico: svg(I.smile) },
  ];
  const path = window.location.pathname.replace(/\/$/, '') || '/home.html';
  const nav = document.createElement('nav');
  nav.className = 'tabbar';
  nav.innerHTML = TABS.map((t) => {
    const active = path === t.href || (path === '/' && t.href === '/home.html');
    return `<a href="${t.href}" class="${active ? 'active' : ''}">
      ${t.ico}<span>${t.label}</span></a>`;
  }).join('');
  document.body.appendChild(nav);
})();
