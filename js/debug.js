import { closeModal, openModal } from './animations.js';

const debugLogEntries = [];

export function logDebug(msg) {
  const time = new Date().toLocaleTimeString();
  debugLogEntries.push(`[${time}] ${msg}`);
  if (debugLogEntries.length > 200) debugLogEntries.shift();

  const badge = document.getElementById('debugBadge');
  if (badge) {
    badge.style.display = 'flex';
    badge.textContent = debugLogEntries.length > 99 ? '99+' : debugLogEntries.length;
  }

  const textEl = document.getElementById('debugLogText');
  const overlay = document.getElementById('debugOverlay');
  if (textEl && overlay && !overlay.hidden) {
    textEl.value = debugLogEntries.join('\n');
    textEl.scrollTop = textEl.scrollHeight;
  }
}

export function wireDebugPanel() {
  window.addEventListener('error', (e) => {
    logDebug(`JS error: ${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    logDebug(`Unhandled promise rejection: ${e.reason?.message ?? e.reason}`);
  });

  window.gm_authFailure = function gmAuthFailure() {
    logDebug(
      'Google Maps auth failure — enable Maps JavaScript API, Places API (New), Distance Matrix API, billing, and referrer restrictions.',
    );
  };

  const _origConsoleError = console.error.bind(console);
  console.error = function patchedConsoleError(...args) {
    _origConsoleError(...args);
    logDebug(
      args
        .map((a) => (a?.message ? a.message : typeof a === 'object' ? JSON.stringify(a) : String(a)))
        .join(' '),
    );
  };

  const debugOverlay = document.getElementById('debugOverlay');
  const debugLogText = document.getElementById('debugLogText');
  const debugBtn = document.getElementById('debugBtn');

  debugBtn?.addEventListener('click', () => {
    if (debugLogText) debugLogText.value = debugLogEntries.length ? debugLogEntries.join('\n') : '';
    if (debugOverlay) openModal(debugOverlay);
  });

  document.getElementById('debugCloseBtn')?.addEventListener('click', () => {
    if (debugOverlay) closeModal(debugOverlay);
  });

  debugOverlay?.addEventListener('click', (e) => {
    if (e.target === debugOverlay) closeModal(debugOverlay);
  });

  document.getElementById('debugClearBtn')?.addEventListener('click', () => {
    debugLogEntries.length = 0;
    if (debugLogText) debugLogText.value = '';
    const badge = document.getElementById('debugBadge');
    if (badge) {
      badge.style.display = 'none';
      badge.textContent = '0';
    }
  });

  document.getElementById('debugCopyBtn')?.addEventListener('click', async () => {
    const text = debugLogEntries.length ? debugLogEntries.join('\n') : 'No errors logged.';
    try {
      await navigator.clipboard.writeText(text);
      const { showToast } = await import('./utils.js');
      showToast('Log copied');
    } catch {
      debugLogText?.select();
      document.execCommand('copy');
      const { showToast } = await import('./utils.js');
      showToast('Log copied');
    }
  });
}
