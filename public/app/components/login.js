import { html, useState } from '/vendor/preact-htm.js';
import { login } from '../lib/store.js';

/** Shown when Hearth is on the internet and this screen hasn't signed in. */
export function LoginScreen() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    const err = await login(password);
    setBusy(false);
    if (err) {
      setError(err);
      setPassword('');
    }
  };

  return html`<div class="gate">
    <form class="gate-card" onSubmit=${submit}>
      <img src="/icons/icon.svg" alt="" width="72" height="72" />
      <h1>Welcome to Hearth</h1>
      <p class="muted">Enter your household password. This screen stays signed in, so you only do this once.</p>
      <label class="field"><span>Household password</span>
        <input class="input big" type="password" autocomplete="current-password" autofocus
          value=${password} onInput=${(e) => setPassword(e.target.value)} /></label>
      ${error && html`<p class="gate-error" role="alert">${error}</p>`}
      <button class="btn primary" type="submit" disabled=${!password || busy}>${busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </div>`;
}

/** Shown when the server itself isn't set up yet (e.g. no password or database). */
export function SetupScreen({ problems }) {
  return html`<div class="gate">
    <div class="gate-card">
      <img src="/icons/icon.svg" alt="" width="72" height="72" />
      <h1>Almost there</h1>
      <p class="muted">Hearth is running, but whoever set it up needs to finish a step first:</p>
      <ul class="gate-list">${problems.map((p) => html`<li key=${p.code}>${p.message}</li>`)}</ul>
      <p class="muted small">This page checks again by itself. The setup guide is in docs/cloud.md.</p>
    </div>
  </div>`;
}
