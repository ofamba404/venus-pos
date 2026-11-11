import { addClient, filterClients, findClientByName, highlightClientName } from './clients.js';
import { animateDropdown } from './animations.js';
import { clientArSummary } from './settle-credit.js';
import { clients } from './state.js';
import { escapeHtml, fmtCompact, showToast } from './utils.js';

const BLUR_HIDE_MS = 140;

export function clientAutocompleteMarkup({
  inputId,
  dropdownId,
  clearId,
  value = '',
  placeholder = 'Client (optional)',
}) {
  return `
    <div class="client-autocomplete">
      <div class="client-search-wrap client-search-wrap-modal">
        <input type="text" class="client-input" id="${inputId}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" value="${escapeHtml(value)}" aria-autocomplete="list" aria-controls="${dropdownId}" aria-expanded="false" />
        <button class="client-search-clear" id="${clearId}" type="button" ${value ? '' : 'hidden'} aria-label="Clear">✕</button>
      </div>
      <div class="suggest-menu client-autocomplete-dropdown" id="${dropdownId}" role="listbox"></div>
    </div>`;
}

export function wireClientAutocomplete({
  inputId,
  dropdownId,
  clearId,
  onChange,
  showAllOnFocus = false,
}) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  const clearBtn = clearId ? document.getElementById(clearId) : null;
  if (!input || !dropdown) return;

  let hideTimer = null;
  let selecting = false;

  const setExpanded = (open) => {
    input.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  const hide = () => {
    clearTimeout(hideTimer);
    hideTimer = null;
    animateDropdown(dropdown, false);
    setExpanded(false);
  };

  const hideSoon = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!selecting) hide();
    }, BLUR_HIDE_MS);
  };

  const cancelHide = () => {
    clearTimeout(hideTimer);
    hideTimer = null;
  };

  const notify = (name) => {
    const client = findClientByName(name);
    onChange(name, client || null);
  };

  const selectClient = (client) => {
    selecting = true;
    cancelHide();
    input.value = client.name;
    if (clearBtn) clearBtn.removeAttribute('hidden');
    onChange(client.name, client);
    hide();
    selecting = false;
  };

  const openWithHtml = (html, { contentUpdate = false } = {}) => {
    dropdown.innerHTML = html;
    animateDropdown(dropdown, true, { contentUpdate });
    setExpanded(true);
  };

  const renderDropdownRows = (filtered, trimmed, showCreate) => {
    const wasOpen = dropdown.classList.contains('open');

    if (filtered.length === 0 && !showCreate) {
      if (!trimmed && !clients.length) {
        dropdown.innerHTML = '';
        hide();
        return;
      }
      openWithHtml(
        `<div class="suggest-empty client-ac-empty">${trimmed ? 'No matches' : 'No saved clients yet'}</div>`,
        { contentUpdate: wasOpen },
      );
      return;
    }

    let html = '';
    if (showCreate) {
      html += `
        <button class="suggest-row client-ac-row client-ac-create" data-create-client type="button" role="option">
          <span class="client-ac-create-label">Create</span>
          <span class="client-ac-create-name">“${escapeHtml(trimmed)}”</span>
        </button>`;
    }

    html += filtered
      .map((c) => {
        const ar = clientArSummary(c.id);
        const owed = ar
          ? `<span class="client-ac-owed">owes ${fmtCompact(ar.totalUgx)}</span>`
          : '';
        return `
        <button class="suggest-row client-ac-row" data-client="${c.id}" type="button" role="option">
          <span class="client-ac-name">${highlightClientName(c.name, trimmed)}</span>
          ${owed}
        </button>`;
      })
      .join('');

    openWithHtml(html, { contentUpdate: wasOpen });
  };

  const rankByAr = (list) =>
    list.slice().sort((a, b) => {
      const aOwed = clientArSummary(a.id)?.totalUgx || 0;
      const bOwed = clientArSummary(b.id)?.totalUgx || 0;
      if (aOwed !== bOwed) return bOwed - aOwed;
      return a.name.localeCompare(b.name);
    });

  const updateDropdown = (query) => {
    const trimmed = query?.trim() || '';
    if (!trimmed) {
      if (!showAllOnFocus) {
        dropdown.innerHTML = '';
        hide();
        return;
      }
      renderDropdownRows(rankByAr(filterClients('')), '', false);
      return;
    }

    const filtered = rankByAr(filterClients(trimmed));
    const exact = findClientByName(trimmed);
    const showCreate = !exact;

    if (exact && filtered.length === 1 && exact.name.toLowerCase() === trimmed.toLowerCase()) {
      dropdown.innerHTML = '';
      hide();
      return;
    }

    renderDropdownRows(filtered, trimmed, showCreate);
  };

  const syncClearBtn = () => {
    if (!clearBtn) return;
    if (input.value) clearBtn.removeAttribute('hidden');
    else clearBtn.setAttribute('hidden', '');
  };

  dropdown.addEventListener('mousedown', (e) => {
    if (e.target.closest?.('.suggest-row, .client-ac-row')) e.preventDefault();
  });
  dropdown.addEventListener('pointerdown', (e) => {
    if (e.target.closest?.('.suggest-row, .client-ac-row')) e.preventDefault();
  });
  dropdown.addEventListener('click', async (e) => {
    const createBtn = e.target.closest?.('[data-create-client]');
    if (createBtn) {
      const trimmed = input.value.trim();
      if (!trimmed) return;
      selecting = true;
      const created = await addClient(trimmed);
      selecting = false;
      if (created) selectClient(created);
      else showToast('Could not add client — name may already exist', true);
      return;
    }

    const row = e.target.closest?.('[data-client]');
    if (!row) return;
    const client = clients.find((c) => c.id === row.dataset.client);
    if (client) selectClient(client);
  });

  input.addEventListener('input', () => {
    notify(input.value);
    syncClearBtn();
    updateDropdown(input.value);
  });

  input.addEventListener('focus', () => {
    cancelHide();
    updateDropdown(input.value);
  });

  input.addEventListener('blur', hideSoon);

  clearBtn?.addEventListener('click', () => {
    cancelHide();
    input.value = '';
    onChange('', null);
    clearBtn.setAttribute('hidden', '');
    hide();
    input.focus({ preventScroll: true });
  });

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      hide();
      input.blur();
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const trimmed = input.value.trim();
    if (!trimmed) return;

    const exact = findClientByName(trimmed);
    if (exact) {
      selectClient(exact);
      return;
    }

    const filtered = filterClients(trimmed);
    if (filtered.length === 1) {
      selectClient(filtered[0]);
      return;
    }

    selecting = true;
    const created = await addClient(trimmed);
    selecting = false;
    if (created) selectClient(created);
    else showToast('Could not add client — name may already exist', true);
  });
}
