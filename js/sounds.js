// ============================================
// UNO Sound Effects — Web Audio API (no files)
// ============================================

const UnoSounds = (() => {
    let ctx = null;
    let enabled = true;

    function getCtx() {
        if (!ctx || ctx.state === 'closed') {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    function tone(freq, dur, type = 'sine', vol = 0.3, delay = 0) {
        if (!enabled) return;
        try {
            const c = getCtx();
            const t = c.currentTime + delay;
            const o = c.createOscillator();
            const g = c.createGain();
            o.type = type;
            o.frequency.setValueAtTime(freq, t);
            g.gain.setValueAtTime(vol, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + dur);
            o.connect(g);
            g.connect(c.destination);
            o.start(t);
            o.stop(t + dur);
        } catch (e) {}
    }

    function noise(dur, vol = 0.15) {
        if (!enabled) return;
        try {
            const c = getCtx();
            const len = Math.floor(c.sampleRate * dur);
            const buf = c.createBuffer(1, len, c.sampleRate);
            const d = buf.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
            const src = c.createBufferSource();
            src.buffer = buf;
            const g = c.createGain();
            g.gain.setValueAtTime(vol, c.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
            const f = c.createBiquadFilter();
            f.type = 'highpass';
            f.frequency.value = 800;
            src.connect(f);
            f.connect(g);
            g.connect(c.destination);
            src.start();
        } catch (e) {}
    }

    return {
        toggle() { enabled = !enabled; return enabled; },
        isEnabled() { return enabled; },
        playCard() { noise(0.08, 0.18); tone(200, 0.1, 'triangle', 0.12); },
        drawCard() { noise(0.1, 0.08); },
        yourTurn() { tone(523, 0.12, 'sine', 0.2); tone(659, 0.12, 'sine', 0.2, 0.13); tone(784, 0.18, 'sine', 0.25, 0.26); },
        skip() { tone(600, 0.08, 'square', 0.08); tone(400, 0.12, 'square', 0.08, 0.09); },
        reverse() { tone(400, 0.08, 'sawtooth', 0.08); tone(500, 0.08, 'sawtooth', 0.08, 0.09); tone(600, 0.12, 'sawtooth', 0.08, 0.18); },
        draw2() { tone(300, 0.08, 'square', 0.12); tone(300, 0.08, 'square', 0.12, 0.12); },
        wild() { tone(300, 0.08, 'sine', 0.15); tone(400, 0.08, 'sine', 0.15, 0.09); tone(500, 0.08, 'sine', 0.15, 0.18); tone(650, 0.15, 'sine', 0.2, 0.27); },
        uno() { tone(880, 0.12, 'sine', 0.25); tone(880, 0.12, 'sine', 0.25, 0.18); tone(1100, 0.25, 'sine', 0.3, 0.36); },
        win() { [523, 587, 659, 784, 1047].forEach((n, i) => tone(n, 0.25, 'sine', 0.22, i * 0.13)); },
        tick() { tone(1000, 0.04, 'sine', 0.08); },
        chat() { tone(800, 0.06, 'sine', 0.08); },
        emoji() { tone(600, 0.05, 'sine', 0.06); },
    };
})();
