import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Hook giả lập âm thanh môi trường văn phòng (Office Ambience) bằng Web Audio API thuần:
 * - Tiếng điều hòa / luồng khí êm dịu (Filtered Brown/Pink Noise)
 * - Âm hưởng lo-fi ấm áp (Warm Acoustic Chord Harmonics)
 * - Tiếng gõ phím nhẹ nhàng ngẫu nhiên (Subtle mechanical key clicks)
 * Hoàn toàn không phụ thuộc file mp3 bên ngoài, không tốn băng thông mạng.
 */
export function useOfficeAmbience() {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [volume, setVolumeState] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('ft_office_ambience_vol');
      return saved ? Math.max(0, Math.min(1, parseFloat(saved))) : 0.4;
    } catch {
      return 0.4;
    }
  });

  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const noiseSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const harmonicGainRef = useRef<GainNode | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const clickTimerRef = useRef<number | null>(null);

  // Tạo pink/brown noise buffer trong bộ nhớ
  const createNoiseBuffer = (ctx: AudioContext): AudioBuffer => {
    const bufferSize = 2 * ctx.sampleRate; // 2 giây loop
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = buffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      // Brown noise tích lũy với leak
      lastOut = (lastOut + 0.02 * white) / 1.02;
      output[i] = lastOut * 3.5;
    }
    return buffer;
  };

  // Giả lập tiếng gõ phím / lách cách nhẹ nhàng
  const triggerKeyClick = useCallback(() => {
    const ctx = audioCtxRef.current;
    const master = masterGainRef.current;
    if (!ctx || !master || ctx.state !== 'running') return;

    try {
      const clickOsc = ctx.createOscillator();
      const clickGain = ctx.createGain();
      const clickFilter = ctx.createBiquadFilter();

      const baseFreq = 800 + Math.random() * 600;
      clickOsc.type = 'triangle';
      clickOsc.frequency.setValueAtTime(baseFreq, ctx.currentTime);

      clickFilter.type = 'bandpass';
      clickFilter.frequency.setValueAtTime(baseFreq, ctx.currentTime);
      clickFilter.Q.setValueAtTime(3.0, ctx.currentTime);

      const clickVol = 0.015 + Math.random() * 0.02;
      clickGain.gain.setValueAtTime(clickVol, ctx.currentTime);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.04);

      clickOsc.connect(clickFilter);
      clickFilter.connect(clickGain);
      clickGain.connect(master);

      clickOsc.start(ctx.currentTime);
      clickOsc.stop(ctx.currentTime + 0.05);
    } catch {
      // Ignore audio error
    }
  }, []);

  const scheduleNextClick = useCallback(() => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    const delay = 600 + Math.random() * 2500;
    clickTimerRef.current = window.setTimeout(() => {
      triggerKeyClick();
      scheduleNextClick();
    }, delay);
  }, [triggerKeyClick]);

  const startAudio = useCallback(async () => {
    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return;

      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtxClass();
      }
      const ctx = audioCtxRef.current;

      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      // Master Gain
      if (!masterGainRef.current) {
        const master = ctx.createGain();
        master.gain.setValueAtTime(volume * 0.5, ctx.currentTime);
        master.connect(ctx.destination);
        masterGainRef.current = master;
      } else {
        masterGainRef.current.gain.cancelScheduledValues(ctx.currentTime);
        masterGainRef.current.gain.linearRampToValueAtTime(volume * 0.5, ctx.currentTime + 0.5);
      }

      // Brown/Pink Air conditioning noise
      if (!noiseSourceRef.current) {
        const noiseBuf = createNoiseBuffer(ctx);
        const noiseSource = ctx.createBufferSource();
        noiseSource.buffer = noiseBuf;
        noiseSource.loop = true;

        const noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = 'lowpass';
        noiseFilter.frequency.setValueAtTime(260, ctx.currentTime); // Lọc tần số cao, chỉ giữ tiếng rì rào ấm
        noiseFilter.Q.setValueAtTime(1.0, ctx.currentTime);

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.22, ctx.currentTime);

        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(masterGainRef.current);

        noiseSource.start();
        noiseSourceRef.current = noiseSource;
      }

      // Warm Subtle Lo-fi Hum (174Hz Solfeggio / D2 Warm Tone)
      if (!oscRef.current) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(174.6, ctx.currentTime); // F3

        const humGain = ctx.createGain();
        humGain.gain.setValueAtTime(0.015, ctx.currentTime);
        harmonicGainRef.current = humGain;

        osc.connect(humGain);
        humGain.connect(masterGainRef.current);

        osc.start();
        oscRef.current = osc;
      }

      scheduleNextClick();
    } catch (e) {
      console.warn('Lỗi khởi tạo âm thanh văn phòng Web Audio:', e);
    }
  }, [volume, scheduleNextClick]);

  const stopAudio = useCallback(() => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }

    const ctx = audioCtxRef.current;
    const master = masterGainRef.current;
    if (ctx && master) {
      try {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
      } catch {
        // Ignore
      }
    }

    setTimeout(() => {
      try {
        if (noiseSourceRef.current) {
          noiseSourceRef.current.stop();
          noiseSourceRef.current.disconnect();
          noiseSourceRef.current = null;
        }
        if (oscRef.current) {
          oscRef.current.stop();
          oscRef.current.disconnect();
          oscRef.current = null;
        }
      } catch {
        // Ignore
      }
    }, 350);
  }, []);

  const toggleAmbience = useCallback(() => {
    setIsPlaying((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('ft_office_ambience', String(next));
      } catch {
        // Ignore
      }
      if (next) {
        startAudio();
      } else {
        stopAudio();
      }
      return next;
    });
  }, [startAudio, stopAudio]);

  const setVolume = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(1, val));
    setVolumeState(clamped);
    const ctx = audioCtxRef.current;
    const master = masterGainRef.current;
    if (ctx && master) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.linearRampToValueAtTime(clamped * 0.5, ctx.currentTime + 0.1);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      try {
        if (noiseSourceRef.current) noiseSourceRef.current.stop();
        if (oscRef.current) oscRef.current.stop();
        if (audioCtxRef.current) audioCtxRef.current.close();
      } catch {
        // Ignore
      }
    };
  }, []);

  return {
    isPlaying,
    volume,
    toggleAmbience,
    setVolume
  };
}
