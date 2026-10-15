'use strict';
(function () {
  const $ = (s) => document.querySelector(s);
  const form = $('#auth-form');
  let setupMode = false;
  const showError = (message) => { const el = $('#auth-error'); el.textContent = message; el.hidden = false; };
  const setMode = (configured) => {
    setupMode = !configured;
    $('#auth-title').textContent = setupMode ? 'Set up ResApp' : 'Welcome back';
    $('#auth-description').textContent = setupMode
      ? 'Create the first administrator account. Use a unique password of at least 12 characters.'
      : 'Sign in to continue to your restaurant operations.';
    $('#name-field').hidden = !setupMode;
    $('#name-field input').required = setupMode;
    $('#confirm-field').hidden = !setupMode;
    $('#confirm-field input').required = setupMode;
    $('input[name="password"]').autocomplete = setupMode ? 'new-password' : 'current-password';
    $('input[name="password"]').minLength = 12;
    $('#auth-submit').textContent = setupMode ? 'Create administrator' : 'Sign in';
    $('#auth-footnote').textContent = setupMode
      ? 'This first account has administrator access. Add managers and staff after signing in.'
      : 'Access is limited to authorized ResApp users.';
  };
  fetch('/api/auth/status').then((r) => r.json()).then((data) => {
    if (data.authenticated) { location.replace('index.html#/dashboard'); return; }
    setMode(data.configured);
  }).catch(() => showError('Unable to connect to ResApp. Please refresh and try again.'));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    $('#auth-error').hidden = true;
    const data = Object.fromEntries(new FormData(form));
    if (setupMode && data.password !== data.confirm_password) { showError('Passwords do not match.'); return; }
    const payload = { email: data.email, password: data.password };
    if (setupMode) payload.name = data.name;
    $('#auth-submit').disabled = true;
    try {
      const response = await fetch(setupMode ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Sign in failed.');
      location.replace('index.html#/dashboard');
    } catch (error) {
      showError(error.message);
    } finally {
      $('#auth-submit').disabled = false;
    }
  });
})();