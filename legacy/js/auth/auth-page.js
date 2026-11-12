/**
 * POS staff auth page: sign in, forgot password, change password.
 *   auth.html                     → sign in (redirects if already signed in)
 *   auth.html?change=1            → change password (requires session)
 *   auth.html#…type=recovery      → set new password from the emailed link
 */
(function initPosAuthPage() {
  const auth = window.VenusPosAuth;
  const statusEl = document.querySelector('[data-auth-status]');
  const panels = Object.fromEntries(
    [...document.querySelectorAll('[data-auth-panel]')].map((el) => [el.dataset.authPanel, el]),
  );
  const forms = Object.fromEntries(
    [...document.querySelectorAll('[data-auth-form]')].map((el) => [el.dataset.authForm, el]),
  );
  if (!auth || !forms.login) return;

  let recoverySession = null;

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

  function setBusy(form, busy) {
    const btn = form?.querySelector('[type="submit"]');
    if (!btn) return;
    btn.disabled = busy;
    btn.classList.toggle('is-loading', busy);
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    form.querySelectorAll('input').forEach((i) => {
      i.readOnly = busy;
    });
  }

  function show(name) {
    Object.entries(panels).forEach(([key, el]) => {
      el.hidden = key !== name;
    });
    const sub = document.querySelector('.auth-brand__sub');
    if (sub) {
      sub.textContent =
        name === 'forgot' ? 'Reset password' : name === 'change' ? 'Change password' : 'Staff sign-in';
    }
    const first = panels[name]?.querySelector('input');
    if (first) setTimeout(() => first.focus(), 30);
  }

  function friendlyError(err, fallback) {
    const code = err?.code || '';
    const msg = String(err?.message || '');
    if (code === 'not_staff' || /not authorized/i.test(msg)) return 'This account is not authorized for POS.';
    if (/email not confirmed/i.test(msg)) return 'This email has not been confirmed yet. Ask the owner.';
    if (/invalid login|invalid credentials|invalid_grant/i.test(msg)) return 'Wrong email or password.';
    if (/rate limit|too many|429/i.test(msg) || err?.status === 429) return 'Too many attempts. Wait a minute and try again.';
    if (/should be different|same.*password/i.test(msg)) return 'New password must be different from the old one.';
    if (/weak|at least|characters/i.test(msg)) return msg;
    if (auth.isTransientAuthError?.(err) || /fetch|network|timeout|Load failed|Failed to load/i.test(msg)) {
      return 'Cannot reach login service. Check internet and try again.';
    }
    if (err?.status === 401 || code === 'no_session') return 'Your session expired. Sign in again.';
    return fallback;
  }

  // Show / hide password toggles
  document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.togglePassword);
      if (!input) return;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.setAttribute('aria-pressed', showing ? 'false' : 'true');
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      input.focus();
    });
  });

  document.querySelectorAll('[data-auth-goto]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setStatus('');
      const target = btn.dataset.authGoto;
      if (target === 'forgot' && forms.forgot) {
        const email = forms.login.querySelector('[name="email"]')?.value || '';
        const f = forms.forgot.querySelector('[name="email"]');
        if (f && !f.value) f.value = email;
      }
      show(target);
    });
  });

  document.querySelector('[data-auth-cancel-change]')?.addEventListener('click', () => {
    window.location.replace(auth.resolveNextHref());
  });

  // --- Route ---
  const params = new URLSearchParams(window.location.search);
  recoverySession = auth.recoverySessionFromHash?.(window.location.hash) || null;
  const existing = auth.staffSessionFromStore?.();

  if (recoverySession) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    const intro = document.querySelector('[data-change-intro]');
    if (intro) intro.textContent = 'Set a new password for your account (at least 8 characters).';
    show('change');
  } else if (params.get('change') === '1') {
    if (!existing) {
      setStatus('Sign in first, then change your password.', 'info');
      show('login');
    } else {
      show('change');
    }
  } else if (existing) {
    window.location.replace(auth.resolveNextHref());
    return;
  } else {
    show('login');
  }

  // --- Sign in ---
  forms.login.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('');
    const data = new FormData(forms.login);
    const email = String(data.get('email') || '').trim();
    const password = String(data.get('password') || '');
    if (!email || !password) {
      setStatus('Enter your email and password.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus('That email address does not look right.');
      return;
    }
    setBusy(forms.login, true);
    try {
      await auth.signIn(email, password);
      if (params.get('change') === '1') {
        setBusy(forms.login, false);
        setStatus('');
        show('change');
        return;
      }
      window.location.replace(auth.resolveNextHref());
    } catch (err) {
      setStatus(friendlyError(err, 'Could not sign in. Try again.'));
      setBusy(forms.login, false);
    }
  });

  // --- Forgot password ---
  forms.forgot?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('');
    const email = String(new FormData(forms.forgot).get('email') || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus('Enter the email you sign in with.');
      return;
    }
    setBusy(forms.forgot, true);
    try {
      const redirectTo = new URL('auth.html', window.location.href).href;
      await auth.requestPasswordReset(email, redirectTo);
      setStatus('If that email has a POS account, a reset link is on its way. Check your inbox.', 'success');
    } catch (err) {
      setStatus(friendlyError(err, 'Could not send the reset link. Try again.'));
    } finally {
      setBusy(forms.forgot, false);
    }
  });

  // --- Change password ---
  forms.change?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('');
    const data = new FormData(forms.change);
    const next = String(data.get('new_password') || '');
    const confirm = String(data.get('confirm_password') || '');
    if (next.length < 8) {
      setStatus('Use at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      setStatus('The two passwords do not match.');
      return;
    }
    setBusy(forms.change, true);
    try {
      await auth.updatePassword(next, recoverySession?.access_token);
      if (recoverySession) {
        const adopted = auth.adoptSession?.(recoverySession);
        recoverySession = null;
        if (!adopted) {
          setStatus('Password updated. This account is not a POS account.', 'success');
          setBusy(forms.change, false);
          return;
        }
      }
      forms.change.reset();
      setStatus('Password updated.', 'success');
      setTimeout(() => window.location.replace(auth.resolveNextHref()), 900);
    } catch (err) {
      setStatus(friendlyError(err, 'Could not update password. Try again.'));
      setBusy(forms.change, false);
    }
  });
})();
