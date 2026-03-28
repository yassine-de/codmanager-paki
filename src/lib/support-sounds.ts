// Notification sounds for Support system using Web Audio API

let lastSoundTime = 0;
const MIN_INTERVAL = 3000; // Don't play sounds more than once every 3s

function canPlaySound() {
  const now = Date.now();
  if (now - lastSoundTime < MIN_INTERVAL) return false;
  lastSoundTime = now;
  return true;
}

/** Admin receives a seller message — lower pitch, double beep */
export function playAdminNotificationSound() {
  if (!canPlaySound()) return;
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const playBeep = (freq: number, start: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.12, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + 0.15);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + 0.15);
    };
    playBeep(660, 0);
    playBeep(880, 0.18);
  } catch {}
}

/** Seller receives an admin reply — higher pitch, single beep */
export function playSellerNotificationSound() {
  if (!canPlaySound()) return;
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 1046;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.25);
  } catch {}
}
