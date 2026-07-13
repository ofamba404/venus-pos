import { addClient, filterClients, findClientByName, highlightClientName } from './clients.js';
import { animateDropdown } from './animations.js';
import { clients } from './state.js';
import { escapeHtml, showToast } from './utils.js';

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
        <input type="text" class="client-input" id="${inputId}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" value="${escapeHtml(value)}" />
        <button class="client-search-clear" id="${clearId}" type="button" ${value ? '' : 'hidden'} aria-label="Clear">✕</button>
      </div>
      <div class="client-autocomplete-dropdown" id="${dropdownId}" role="listbox"></div>
    </div>`;
}

export function wireClientAutocomplete({
  inputId,
  dropdownId,
  clearId,
  onChange,
  showAllOnFocus = false,
  maxResults = 6,
}) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  const clearBtn = clearId ? document.getElementById(clearId) : null;
  if (!input || !dropdown) return;

  const hide = () => animateDropdown(dropdown, false);

  const notify = (name) => {
    const client = findClientByName(name);
    onChange(name, client || null);
  };

  const selectClient = (client) => {
    input.value = client.name;
    onChange(client.name, client);
    hide();
  };

  const renderDropdownRows = (filtered, trimmed, showCreate) => {
    const wasOpen = dropdown.classList.contains('open');

    if (filtered.length === 0 && !showCreate) {
      dropdown.innerHTML =
        trimmed || clients.length
          ? `<div class="client-ac-empty">${trimmed ? 'No matches' : 'No saved clients yet'}</div>`
          : '';
      if (dropdown.innerHTML) animateDropdown(dropdown, true, { contentUpdate: wasOpen });
      else hide();
      return;
    }

    let html = '';
    if (showCreate) {
      html += `
        <button class="client-ac-row client-ac-create" data-create-client type="button">
          <span class="client-ac-create-label">Create</span>
          <span class="client-ac-create-name">“${escapeHtml(trimmed)}”</span>
        </button>`;
    }

    html += filtered
      .map(
        (c) => `
        <button class="client-ac-row" data-client="${c.id}" type="button">
          ${highlightClientName(c.name, trimmed)}
        </button>`,
      )
      .join('');

    dropdown.innerHTML = html;
    animateDropdown(dropdown, true, { contentUpdate: wasOpen });

    dropdown.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => e.preventDefault());
    });

    dropdown.querySelector('[data-create-client]')?.addEventListener('click', async () => {
      const created = await addClient(trimmed);
      if (created) selectClient(created);
      else showToast('Could not add client — name may already exist', true);
    });

    dropdown.querySelectorAll('[data-client]').forEach((row) => {
      row.addEventListener('click', () => {
        const client = clients.find((c) => c.id === row.dataset.client);
        if (client) selectClient(client);
      });
    });
  };

  const updateDropdown = (query) => {
    const trimmed = query?.trim() || '';
    if (!trimmed) {
      if (!showAllOnFocus) {
        dropdown.innerHTML = '';
        hide();
        return;
      }
      renderDropdownRows(filterClients('').slice(0, maxResults), '', false);
      return;
    }

    const filtered = filterClients(trimmed).slice(0, maxResults);
    const exact = findClientByName(trimmed);
    const showCreate = !exact;

    if (exact && filtered.length === 1 && exact.name.toLowerCase() === trimmed.toLowerCase()) {
      dropdown.innerHTML = '';
      hide();
      return;
    }

    renderDropdownRows(filtered, trimmed, showCreate);
  };

  input.addEventListener('input', () => {
    notify(input.value);
    if (clearBtn) {
      if (input.value) clearBtn.removeAttribute('hidden');
      else clearBtn.setAttribute('hidden', '');
    }
    updateDropdown(input.value);
  });

  input.addEventListener('focus', () => {
    updateDropdown(input.value);
  });

  input.addEventListener('blur', hide);

  clearBtn?.addEventListener('click', () => {
    input.value = '';
    onChange('', null);
    clearBtn.setAttribute('hidden', '');
    hide();
    input.focus();
  });

  input.addEventListener('keydown', async (e) => {
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

    const created = await addClient(trimmed);
    if (created) selectClient(created);
    else showToast('Could not add client — name may already exist', true);
  });
}
