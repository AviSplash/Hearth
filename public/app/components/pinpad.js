import { html, useState, useEffect } from '/vendor/preact-htm.js';
import { Modal, Icon } from '../lib/ui.js';

/**
 * Big-button PIN entry. `check(pin)` returns null when the PIN is accepted,
 * or an error message to show.
 */
export function PinPad({ title = 'Parent PIN', reason, onDone, onCancel, check, minLength = 4 }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(reason || '');
  const [busy, setBusy] = useState(false);

  const submit = async (value = pin) => {
    if (value.length < minLength || busy) return;
    setBusy(true);
    const problem = check ? await check(value) : null;
    setBusy(false);
    if (problem) {
      setError(problem);
      setPin('');
      return;
    }
    onDone(value);
  };

  const press = (d) => {
    if (busy) return;
    setError('');
    setPin((p) => (p.length < 8 ? p + d : p));
  };

  useEffect(() => {
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter') submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return html`<${Modal} title=${title} onClose=${onCancel} className="pin-modal">
    <div class="pin-dots ${error ? 'shake' : ''}">
      ${Array.from({ length: Math.max(minLength, pin.length) }, (_, i) => html`<span class=${i < pin.length ? 'on' : ''}></span>`)}
    </div>
    <p class="pin-msg ${error ? 'error' : ''}">${error || 'Enter the parent PIN'}</p>
    <div class="pin-grid">
      ${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => html`<button key=${d} onClick=${() => press(d)}>${d}</button>`)}
      <button class="pin-aux" onClick=${() => setPin((p) => p.slice(0, -1))} aria-label="Delete">⌫</button>
      <button onClick=${() => press('0')}>0</button>
      <button class="pin-go" disabled=${pin.length < minLength || busy} onClick=${() => submit()} aria-label="OK">
        <${Icon} name="check" size=${28} />
      </button>
    </div>
  </${Modal}>`;
}
