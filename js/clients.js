import { sbFetch } from './api.js';
import { readStaleCache, writeCache } from './cache.js';
import { clients } from './state.js';
import { debounce, escapeHtml, showConfirm, showToast } from './utils.js';
import { clientRowPlaceholders, showPlaceholder } from './pending.js';

function applyClients(rows) {
  clients.length = 0;
  clients.push(...rows);
}

export function findClientByName(name) {
  const q = name?.trim().toLowerCase();
  if (!q) return null;
  return clients.find((c) => c.name.toLowerCase() === q) ?? null;
}

export function filterClients(query) {
  const q = query?.trim().toLowerCase() || '';
  if (!q) return [...clients];

  return clients
    .filter((c) => c.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const aExact = aName === q;
      const bExact = bName === q;
      if (aExact !== bExact) return aExact ? -1 : 1;
      const aStarts = aName.startsWith(q);
      const bStarts = bName.startsWith(q);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export function highlightClientName(name, query) {
  const safe = escapeHtml(name);
  const q = query?.trim();
  if (!q) return safe;

  const idx = name.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return safe;

  const before = escapeHtml(name.slice(0, idx));
  const match = escapeHtml(name.slice(idx, idx + q.length));
  const after = escapeHtml(name.slice(idx + q.length));
  return `${before}<mark class="client-match">${match}</mark>${after}`;
}

export function restoreClientsFromCache() {
  const stale = readStaleCache('clients');
  if (!stale?.length) return false;
  applyClients(stale);
  return true;
}

export async function loadClients() {
  const hadData = clients.length > 0;

  try {
    const res = await sbFetch('clients?select=*&order=name.asc');
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    const rows = await res.json();
    writeCache('clients', rows);
    applyClients(rows);
  } catch (e) {
    console.error('load clients failed', e);
    if (!hadData && !clients.length) {
      showToast('Could not load clients', true);
    }
  }
  renderClientsTab();
}

function getClientSearchQuery() {
  return document.getElementById('clientSearchInput')?.value.trim() || '';
}

function updateClientListMeta(filteredCount, totalCount, query) {
  const meta = document.getElementById('clientListMeta');
  if (!meta) return;

  if (!totalCount) {
    meta.textContent = '';
    return;
  }

  if (!query) {
    meta.textContent = `${totalCount} client${totalCount === 1 ? '' : 's'}`;
    return;
  }

  meta.textContent =
    filteredCount === totalCount
      ? `${filteredCount} match${filteredCount === 1 ? '' : 'es'}`
      : `${filteredCount} of ${totalCount}`;
}

export function renderClientsTab() {
  const list = document.getElementById('clientList');
  if (!list) return;

  const query = getClientSearchQuery();
  const filtered = filterClients(query);
  updateClientListMeta(filtered.length, clients.length, query);

  if (clients.length === 0) {
    list.innerHTML = showPlaceholder('clients')
      ? clientRowPlaceholders(5)
      : `<div class="client-empty">No clients yet — add one above, or save one while checking out a sale</div>`;
    return;
  }

  if (filtered.length === 0) {
    list.innerHTML = `<div class="client-empty">No clients match “${escapeHtml(query)}”</div>`;
    return;
  }

  list.innerHTML = filtered
    .map((c) => {
      const d = new Date(c.created_at);
      const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      return `
        <div class="client-row" data-client-row="${c.id}">
          <span class="cl-name">${highlightClientName(c.name, query)}</span>
          <span class="cl-date">since ${dateStr}</span>
          <div class="cl-actions">
            <button class="cl-icon-btn" data-rename="${c.id}" title="Rename" type="button">✎</button>
            <button class="cl-icon-btn delete" data-delete="${c.id}" title="Delete" type="button">✕</button>
          </div>
        </div>`;
    })
    .join('');

  list.querySelectorAll('[data-rename]').forEach((btn) => {
    btn.addEventListener('click', () => startRenameClient(btn.dataset.rename));
  });
  list.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => deleteClient(btn.dataset.delete));
  });
}

function startRenameClient(id) {
  const client = clients.find((c) => c.id === id);
  const row = document.querySelector(`[data-client-row="${id}"]`);
  if (!client || !row) return;

  const dateEl = row.querySelector('.cl-date');
  if (dateEl) dateEl.style.display = 'none';
  row.querySelector('.cl-name').outerHTML = `<input type="text" class="cl-name-input" id="renameInput-${id}" value="${escapeHtml(client.name)}" />`;
  const input = document.getElementById(`renameInput-${id}`);
  input.focus();
  input.select();

  const commit = () => finishRenameClient(id, input.value.trim());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') renderClientsTab();
  });
  input.addEventListener('blur', commit);
}

async function finishRenameClient(id, newName) {
  const client = clients.find((c) => c.id === id);
  if (!newName || (client && client.name === newName)) {
    renderClientsTab();
    return;
  }

  const duplicate = findClientByName(newName);
  if (duplicate && duplicate.id !== id) {
    showToast('Another client already has that name', true);
    renderClientsTab();
    return;
  }

  try {
    const res = await sbFetch(`clients?id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ name: newName }),
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    if (client) client.name = newName;
    clients.sort((a, b) => a.name.localeCompare(b.name));
    writeCache('clients', [...clients]);
    renderClientsTab();
    showToast('Client renamed');
  } catch (e) {
    console.error('rename client failed', e);
    showToast('Could not rename client', true);
    renderClientsTab();
  }
}

async function deleteClient(id) {
  const ok = await showConfirm('Remove this client? Past sales stay on record, just without the name attached.');
  if (!ok) return;
  try {
    const res = await sbFetch(`clients?id=eq.${id}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    const idx = clients.findIndex((c) => c.id === id);
    if (idx > -1) clients.splice(idx, 1);
    writeCache('clients', [...clients]);
    renderClientsTab();
    showToast('Client removed');
  } catch (e) {
    console.error('delete client failed', e);
    showToast('Could not delete client', true);
  }
}

export async function addClient(name) {
  const trimmed = name?.trim();
  if (!trimmed) return null;

  const existing = findClientByName(trimmed);
  if (existing) return existing;

  try {
    const res = await sbFetch('clients', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ name: trimmed }),
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    const rows = await res.json();
    const newClient = rows[0];
    clients.push(newClient);
    clients.sort((a, b) => a.name.localeCompare(b.name));
    writeCache('clients', [...clients]);
    return newClient;
  } catch (e) {
    console.error('add client failed', e);
    return null;
  }
}

export function wireClientsPage() {
  const addBtn = document.getElementById('addClientBtn');
  const addInput = document.getElementById('newClientInput');
  const searchInput = document.getElementById('clientSearchInput');
  const searchClear = document.getElementById('clientSearchClear');

  const submitNewClient = async () => {
    const name = addInput?.value.trim();
    if (!name) return;

    const existing = findClientByName(name);
    if (existing) {
      showToast(`“${existing.name}” is already saved`);
      if (searchInput) {
        searchInput.value = existing.name;
        searchClear?.removeAttribute('hidden');
      }
      if (addInput) addInput.value = '';
      renderClientsTab();
      document.querySelector(`[data-client-row="${existing.id}"]`)?.scrollIntoView({ block: 'nearest' });
      return;
    }

    const created = await addClient(name);
    if (!created) {
      showToast('Could not add client — name may already exist', true);
      return;
    }

    if (addInput) addInput.value = '';
    if (searchInput) {
      searchInput.value = created.name;
      searchClear?.removeAttribute('hidden');
    }
    renderClientsTab();
    showToast(`Added ${created.name}`);
    document.querySelector(`[data-client-row="${created.id}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  addBtn?.addEventListener('click', submitNewClient);
  addInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitNewClient();
  });

  const onSearch = debounce(() => {
    renderClientsTab();
    if (searchClear) {
      if (searchInput?.value) searchClear.removeAttribute('hidden');
      else searchClear.setAttribute('hidden', '');
    }
  }, 150);

  searchInput?.addEventListener('input', onSearch);
  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (searchInput) searchInput.value = '';
      searchClear?.setAttribute('hidden', '');
      renderClientsTab();
    }
  });
  searchClear?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    searchClear.setAttribute('hidden', '');
    searchInput?.focus();
    renderClientsTab();
  });
}

export async function resolveClientId(name) {
  if (!name?.trim()) return null;
  const existing = findClientByName(name);
  if (existing) return existing.id;
  const created = await addClient(name);
  return created?.id ?? null;
}
