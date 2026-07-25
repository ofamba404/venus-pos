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

  // Already signed in as staff → continue.
  window.VenusPosAuth.ensureStaffSession()
    .then((session) => {
      if (session) {
        window.location.replace(window.VenusPosAuth.resolveNextHref());
      }
    })
    .catch(() => {});

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
      const code = err?.code || err?.message || '';
      if (code === 'not_staff' || /not authorized/i.test(String(err?.message || ''))) {
        setStatus('This account is not authorized for POS.');
      } else if (/invalid login|invalid credentials|email not confirmed/i.test(String(err?.message || ''))) {
        setStatus('Wrong email or password.');
      } else {
        setStatus(err?.message || 'Could not sign in.');
      }
      setBusy(false);
    }
  });
})();
