/**
 * POS staff login page.
 */
(function initPosAuthPage() {
  const form = document.querySelector('[data-auth-form="login"]');
  const statusEl = document.querySelector('[data-auth-status]');
  const submitBtn = form?.querySelector('[type="submit"]');
  if (!form || !window.VenusPosAuth) return;

  function setStatus(message, tone = 'error') {
    if (!statusEl) return;
    if (!message) {
      statusEl.hidden = true;
      statusEl.textContent = '';
      statusEl.removeAttribute('data-tone');
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = message;
    statusEl.dataset.tone = tone;
  }

  function setBusy(busy) {
    if (!submitBtn) return;
    submitBtn.disabled = busy;
    submitBtn.classList.toggle('is-loading', busy);
  }

  const existing = window.VenusPosAuth.staffSessionFromStore?.();
  if (existing) {
    window.location.replace(window.VenusPosAuth.resolveNextHref());
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('');
    const data = new FormData(form);
    const email = String(data.get('email') || '').trim();
    const password = String(data.get('password') || '');
    if (!email || !password) {
      setStatus('Enter your email and password.');
      return;
    }

    setBusy(true);
    try {
      await window.VenusPosAuth.signIn(email, password);
      window.location.replace(window.VenusPosAuth.resolveNextHref());
    } catch (err) {
      const code = err?.code || '';
      const msg = String(err?.message || '');
      if (code === 'not_staff' || /not authorized/i.test(msg)) {
        setStatus('This account is not authorized for POS.');
      } else if (/invalid login|invalid credentials|email not confirmed|invalid_grant/i.test(msg)) {
        setStatus('Wrong email or password.');
      } else if (
        window.VenusPosAuth.isTransientAuthError?.(err) ||
        /fetch|network|timeout|Load failed|Failed to load/i.test(msg)
      ) {
        setStatus('Cannot reach login service. Check internet and try again.');
      } else {
        setStatus('Could not sign in. Try again.');
      }
      setBusy(false);
    }
  });
})();
