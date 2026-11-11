import { go, ROUTES } from '../../app/router';
import { isAdmin } from '../../data/auth';
import { IconChevronRight } from '../../ui/icons';

export function MorePage() {
  const links = ROUTES.filter((r) => r.nav === 'more').filter(
    (r) => r.minRole === 'staff' || isAdmin() || location.port === '5173',
  );

  return (
    <section>
      <h1 class="page-title">More</h1>
      <div>
        {links.map((r) => (
          <button key={r.id} type="button" class="v-list-row" onClick={() => go(r.path)}>
            <div class="v-list-row__main">
              <div class="v-list-row__title">{r.title}</div>
            </div>
            <span class="v-list-row__chevron" aria-hidden="true">
              <IconChevronRight size={18} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
