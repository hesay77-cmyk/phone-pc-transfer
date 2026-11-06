# Calm ambient bed: soft pad chords + sparse bell notes + long reverb.
import sys, wave
import numpy as np

DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 36.0
SR = 48000
rng = np.random.default_rng(7)
t = np.arange(int(DUR * SR)) / SR
L = np.zeros_like(t); R = np.zeros_like(t)

def hz(m): return 440.0 * 2 ** ((m - 69) / 12)

# D major colour: Dmaj9, Bm9, Gmaj9, Asus2 (MIDI notes)
chords = [[50, 57, 61, 64, 66], [47, 54, 57, 61, 62], [43, 50, 54, 57, 62], [45, 52, 57, 59, 64]]
CH = 4.5
def env(start, length, att=1.8, rel=2.5):
    e = np.zeros_like(t)
    s = int(start * SR); n = int((length + rel) * SR)
    seg = np.arange(min(n, len(t) - s)) / SR
    a = np.clip(seg / att, 0, 1) ** 2
    r = np.clip((length + rel - seg) / rel, 0, 1) ** 2
    e[s:s + len(seg)] = a * r
    return e

k = 0; start = 0.0
while start < DUR:
    ch = chords[k % 4]; e = env(start, CH)
    for i, m in enumerate(ch):
        f = hz(m + 12 if i > 0 else m)  # keep it airy
        amp = 0.05 if i == 0 else 0.032
        for det, pan in ((-0.12, 0.25), (0.12, 0.75)):
            ph = rng.uniform(0, 2 * np.pi)
            w = np.sin(2 * np.pi * (f + det) * t + ph) + 0.18 * np.sin(2 * np.pi * 2 * (f + det) * t + ph)
            L += amp * e * w * (1 - pan); R += amp * e * w * pan
    start += CH; k += 1

# sparse bells: a gentle rising figure at each chord change
bells = []
for c in range(int(DUR / CH) + 1):
    ch = chords[c % 4]
    for j, idx in enumerate((2, 3, 4)):
        bells.append((c * CH + 0.35 + j * 0.55, ch[idx] + 24, 0.5 + 0.25 * (j % 2)))
for st, m, pan in bells:
    if st > DUR - 3: continue
    s = int(st * SR); n = int(3.5 * SR); seg = np.arange(min(n, len(t) - s)) / SR
    f = hz(m)
    w = (np.sin(2 * np.pi * f * seg) + 0.25 * np.sin(2 * np.pi * 2.01 * f * seg) * np.exp(-seg * 3)) * np.exp(-seg * 1.6) * np.clip(seg / 0.006, 0, 1)
    L[s:s + len(seg)] += 0.022 * w * (1 - pan); R[s:s + len(seg)] += 0.022 * w * pan

# reverb: convolve with decaying noise
ir_n = int(3.2 * SR); it = np.arange(ir_n) / SR
def ir(): x = rng.standard_normal(ir_n) * np.exp(-it * 2.2); x[:int(.02 * SR)] = 0; return x / np.sqrt((x ** 2).sum())
def conv(x, h):
    n = len(x) + len(h); N = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, N) * np.fft.rfft(h, N), N)[:len(x)]
L = 0.65 * L + 0.55 * conv(L, ir()); R = 0.65 * R + 0.55 * conv(R, ir())

fade = np.clip(t / 1.2, 0, 1) * np.clip((DUR - t) / 3.0, 0, 1)
L *= fade; R *= fade
peak = max(np.abs(L).max(), np.abs(R).max()); L *= 0.5 / peak; R *= 0.5 / peak
out = np.stack([L, R], 1)
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((out * 32767).astype('<i2').tobytes())
