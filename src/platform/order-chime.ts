/** A short two-note chime. No asset file, so it works offline. */
export function playOrderChime() {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
  gain.connect(ctx.destination);
  [660, 880].forEach((freq, index) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);
    const start = now + index * 0.12;
    osc.start(start);
    osc.stop(start + 0.18);
  });
  window.setTimeout(() => void ctx.close().catch(() => {}), 700);
}
