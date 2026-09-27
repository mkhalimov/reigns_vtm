// Шифрование трафика комнаты ключом из кода: публичный ретранслятор видит только шифротекст.
const enc = new TextEncoder();
const dec = new TextDecoder();

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export interface RoomKey {
  topic: string;
  key: CryptoKey;
}

export async function roomKey(code: string): Promise<RoomKey> {
  const topic = hex(await crypto.subtle.digest('SHA-256', enc.encode(`rouen-topic:${code}`))).slice(0, 32);
  const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('rouen-vtm-room'), iterations: 60000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { topic, key };
}

export async function seal(k: RoomKey, msg: unknown): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k.key, enc.encode(JSON.stringify(msg))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return out;
}

/** null — чужое или повреждённое сообщение. */
export async function open<T>(k: RoomKey, data: Uint8Array): Promise<T | null> {
  if (data.length < 13) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, k.key, data.slice(12));
    return JSON.parse(dec.decode(pt)) as T;
  } catch {
    return null;
  }
}
