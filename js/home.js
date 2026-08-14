import { isCookieCategoryId } from './config.js';
import { isDataPending, revealLoaded } from './pending.js';
import { navigate } from './router.js';
import { sumOwnerRevenue } from './revenue.js';
import { salesCache } from './state.js';
import { fmtUGX, isToday } from './utils.js';

export function updateTodayStrip() {
  const pending = isDataPending('sales');
  const todaySales = salesCache.filter((s) => isToday(s.created_at));
  const revenue = sumOwnerRevenue(todaySales);
  let joints = 0;
  let cookies = 0;
  todaySales.forEach((s) =>
    (s.items || []).forEach((i) => {
      Object.entries(i.breakdown || {}).forEach(([catId, qty]) => {
        if (isCookieCategoryId(catId)) cookies += qty;
        else joints += qty;
      });
    }),
  );

  const todayRevenue = document.getElementById('todayRevenue');
  const todayJoints = document.getElementById('todayJoints');
  const todayCookies = document.getElementById('todayCookies');
  if (todayRevenue) {
    todayRevenue.classList.toggle('is-pending', pending);
    todayRevenue.textContent = pending ? 'UGX —' : fmtUGX(revenue);
    if (!pending) revealLoaded(todayRevenue);
  }
  if (todayJoints) {
    todayJoints.classList.toggle('is-pending', pending);
    todayJoints.textContent = pending ? '—' : String(joints);
    if (!pending) revealLoaded(todayJoints);
  }
  if (todayCookies) {
    todayCookies.classList.toggle('is-pending', pending);
    todayCookies.textContent = pending ? '—' : String(cookies);
    if (!pending) revealLoaded(todayCookies);
  }
}

export function wireHomePage() {
  const stockSplit = document.querySelector('.stock-split');
  const goInventory = () => {
    void navigate('inventory');
  };
  stockSplit?.addEventListener('click', goInventory);
  stockSplit?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      goInventory();
    }
  });

  document.getElementById('todayRevenueStat')?.addEventListener('click', () => {
    void navigate('analytics');
  });
  document.getElementById('todayUnitsStat')?.addEventListener('click', () => {
    void navigate('history');
  });
}
