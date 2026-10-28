/**
 * Web Audio Synthesizer cho Túi đồ vui nhộn
 * Tự sinh 100% âm thanh bằng Web Audio API thuần:
 * - Tiếng ù tai (Tinnitus) của bom choáng CS2
 * - Tiếng "meo meo" của mèo con
 * - Tiếng ném và biến mất (Poof)
 * Không tải file từ bên ngoài, không lo bản quyền hay lỗi mạng.
 */

const STORAGE_KEY_MUTED = 'ft_itembag_muted';

export function getInitialMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_KEY_MUTED) === '1';
  } catch {
    return false;
  }
}

export function saveMuted(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_MUTED, muted ? '1' : '0');
  } catch {
    // Ignore storage errors
  }
}

let sharedAudioCtx: AudioContext | null = null;

export function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtxClass) return null;

  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    try {
      sharedAudioCtx = new AudioCtxClass();
    } catch {
      return null;
    }
  }

  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }

  return sharedAudioCtx;
}

let activeTinnitusOsc: OscillatorNode | null = null;
let activeTinnitusGain: GainNode | null = null;

/**
 * Phát tiếng ù tai (Tinnitus) tần số cao ~3700Hz của bom choáng CS2
 * Âm lượng nhỏ dần trong 4.5s
 */
export function playTinnitusSound(isMuted: boolean, reducedMotion: boolean): void {
  if (isMuted || reducedMotion) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    // Dừng âm ù tai trước đó nếu có
    if (activeTinnitusOsc) {
      try {
        activeTinnitusOsc.stop();
        activeTinnitusOsc.disconnect();
      } catch {}
      activeTinnitusOsc = null;
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(3700, now);

    // Fade in rất nhanh để không gây tiếng 'click' âm thanh, giữ 1.2s rồi decay dần
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.08);
    gain.gain.setValueAtTime(0.16, now + 1.2);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 4.8);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 5.0);

    activeTinnitusOsc = osc;
    activeTinnitusGain = gain;
  } catch (err) {
    console.warn('Không thể phát âm thanh tinnitus:', err);
  }
}

export function stopTinnitusSound(): void {
  if (activeTinnitusOsc) {
    try {
      activeTinnitusOsc.stop();
      activeTinnitusOsc.disconnect();
    } catch {}
    activeTinnitusOsc = null;
    activeTinnitusGain = null;
  }
}

/**
 * Phát tiếng kêu "meo... meo!" của mèo con
 * Tổng hợp bằng Formant Synthesizer qua bộ lọc Bandpass
 */
export function playMeowSound(isMuted: boolean): void {
  if (isMuted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;

    const playSingleMeow = (startTime: number, startPitch: number, peakPitch: number, endPitch: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = 'triangle';

      // Đường biến thiên cao độ (Pitch Contour): bắt đầu m-e, vút lên -o-, hạ xuống -w
      osc.frequency.setValueAtTime(startPitch, startTime);
      osc.frequency.exponentialRampToValueAtTime(peakPitch, startTime + dur * 0.38);
      osc.frequency.exponentialRampToValueAtTime(endPitch, startTime + dur);

      // Bộ lọc Formant mô phỏng âm thanh thanh quản
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1050, startTime);
      filter.frequency.linearRampToValueAtTime(1450, startTime + dur * 0.4);
      filter.frequency.linearRampToValueAtTime(850, startTime + dur);
      filter.Q.value = 3.6;

      // Đường bao âm lượng
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.linearRampToValueAtTime(0.18, startTime + 0.07);
      gain.gain.exponentialRampToValueAtTime(0.14, startTime + dur * 0.7);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + dur + 0.05);
    };

    // 2 nhịp kêu liên tiếp: Meo... Meo!
    playSingleMeow(now + 0.05, 420, 840, 500, 0.52);
    playSingleMeow(now + 0.72, 460, 920, 530, 0.58);
  } catch (err) {
    console.warn('Không thể phát âm meo meo:', err);
  }
}

/**
 * Tiếng "Bụp / Poof" nhẹ khi mèo biến mất trong làn khói
 */
export function playPoofSound(isMuted: boolean): void {
  if (isMuted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.18);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.25);
  } catch (err) {
    console.warn('Không thể phát âm poof:', err);
  }
}

/**
 * Tiếng "Vút" nhẹ khi ném món đồ
 */
export function playThrowSound(isMuted: boolean): void {
  if (isMuted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(380, now + 0.12);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.18);
  } catch (err) {
    console.warn('Không thể phát âm ném:', err);
  }
}
