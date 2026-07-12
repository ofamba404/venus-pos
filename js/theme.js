function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('.theme-icon-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.themeChoice === theme);
  });
}

export function setTheme(theme) {
  applyTheme(theme);
  try {
    localStorage.setItem('pos-theme', theme);
  } catch {
    /* ignore */
  }
}

export function loadTheme() {
  let theme = 'dark';
  try {
    const stored = localStorage.getItem('pos-theme');
    if (stored) theme = stored;
  } catch {
    /* ignore */
  }
  applyTheme(theme);
}

export function wireThemeControls() {
  loadTheme();

  document.querySelectorAll('.theme-icon-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      setTheme(btn.dataset.themeChoice);
      closeThemePanels();
    });
  });

  const themeTabBtn = document.getElementById('themeTabBtn');
  const themePopover = document.getElementById('themePopover');
  themeTabBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (themePopover) themePopover.hidden = !themePopover.hidden;
  });

  document.addEventListener('click', (e) => {
    if (!themePopover || themePopover.hidden) return;
    if (!themePopover.contains(e.target) && e.target !== themeTabBtn) {
      themePopover.hidden = true;
    }
  });

  const themeHeaderBtn = document.getElementById('themeHeaderBtn');
  const themeMobileOverlay = document.getElementById('themeMobileOverlay');
  themeHeaderBtn?.addEventListener('click', () => {
    if (themeMobileOverlay) themeMobileOverlay.hidden = false;
  });

  document.getElementById('themeMobileClose')?.addEventListener('click', () => {
    if (themeMobileOverlay) themeMobileOverlay.hidden = true;
  });

  themeMobileOverlay?.addEventListener('click', (e) => {
    if (e.target === themeMobileOverlay) themeMobileOverlay.hidden = true;
  });
}

function closeThemePanels() {
  const themePopover = document.getElementById('themePopover');
  const themeMobileOverlay = document.getElementById('themeMobileOverlay');
  if (themePopover) themePopover.hidden = true;
  if (themeMobileOverlay) themeMobileOverlay.hidden = true;
}
