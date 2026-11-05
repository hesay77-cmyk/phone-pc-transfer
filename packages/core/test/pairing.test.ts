import { describe, expect, it } from 'vitest';
import { deriveKeys, isValidSecret, newSecret, open, pairingUrl, seal, secretFromHash } from '../src/pairing';

describe('配对暗号', () => {
  it('新暗号格式正确', () => {
    const s = newSecret();
    expect(isValidSecret(s)).toBe(true);
    expect(isValidSecret('short')).toBe(false);
  });

  it('二维码网址里放进去、能从 # 后面读出来', () => {
    const s = newSecret();
    const url = pairingUrl('https://x.test/app/#old', s);
    expect(url).toBe('https://x.test/app/#k=' + s);
    expect(secretFromHash(new URL(url).hash)).toBe(s);
    expect(secretFromHash('#k=bad')).toBeNull();
    expect(secretFromHash('')).toBeNull();
  });

  it('同一个暗号算出同一个频道，不同暗号不同频道', async () => {
    const s = newSecret();
    const a = await deriveKeys(s), b = await deriveKeys(s), c = await deriveKeys(newSecret());
    expect(a.topic).toBe(b.topic);
    expect(a.topic).not.toBe(c.topic);
    expect(a.topic).not.toContain(s);
  });

  it('加密后能解开；改一个字或换暗号就解不开', async () => {
    const s = newSecret();
    const { key } = await deriveKeys(s);
    const sealed = await seal(key, { sdp: '连接信息' });
    expect(await open(key, sealed)).toEqual({ sdp: '连接信息' });
    const flipped = sealed.slice(0, 20) + (sealed[20] === 'A' ? 'B' : 'A') + sealed.slice(21);
    expect(await open(key, flipped)).toBeNull();
    const other = await deriveKeys(newSecret());
    expect(await open(other.key, sealed)).toBeNull();
    expect(await open(key, 'garbage')).toBeNull();
  });
});
