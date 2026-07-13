import { getPageHref } from './config.js';
import { salesCache } from './state.js';
import { fmtUGX, isToday } from './utils.js';

export function updateTodayStrip() {
  const todaySales = salesCache.filter((s) => isToday(s.created_at));
  const revenue = todaySales.reduce((sum, s) => sum + s.total_ugx, 0);
  let joints = 0;
  let cookies = 0;
  todaySales.forEach((s) =>
    (s.items || []).forEach((i) => {
      Object.entries(i.breakdown || {}).forEach(([catId, qty]) => {
        if (catId === 'cookie') cookies += qty;
        else joints += qty;
      });
    }),
  );

  const todayRevenue = document.getElementById('todayRevenue');
  const todayJoints = document.getElementById('todayJoints');
  const todayCookies = document.getElementById('todayCookies');
  if (todayRevenue) todayRevenue.textContent = fmtUGX(revenue);
  if (todayJoints) todayJoints.textContent = String(joints);
  if (todayCookies) todayCookies.textContent = String(cookies);
}

export function wireHomePage() {
  const stockSplit = document.querySelector('.stock-split');
  const goInventory = () => {
    window.location.href = getPageHref('inventory');
  };
  stockSplit?.addEventListener('click', goInventory);
  stockSplit?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      goInventory();
    }
  });

  document.getElementById('todayRevenueStat')?.addEventListener('click', () => {
    window.location.href = getPageHref('analytics');
  });
  document.getElementById('todayUnitsStat')?.addEventListener('click', () => {
    window.location.href = getPageHref('analytics', '#orders');
  });
}
