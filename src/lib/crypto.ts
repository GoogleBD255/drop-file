
/**
 * Utility for end-to-end encryption using AES-GCM.
 */

const ALGORITHM = 'AES-GCM';
const IV_LENGTH = 12;

export async function deriveKeyFromPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  // Use a fixed salt for the app to ensure the same PIN generates the same key
  const salt = encoder.encode('fast-share-secure-salt-v1');
  
  const key = await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 250000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: ALGORITHM, length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  const exported = await window.crypto.subtle.exportKey('raw', key);
  return b64Encode(new Uint8Array(exported));
}

/**
 * Generates a random base64 string to be used as an encryption key.
 */
export function generateEncryptionKey(): string {
  const array = new Uint8Array(32); // 256 bits
  window.crypto.getRandomValues(array);
  return b64Encode(array);
}

/**
 * Encrypts an ArrayBuffer using the provided base64 key.
 * Prepends the IV to the result.
 */
export async function encryptChunk(chunk: ArrayBuffer, keyB64: string): Promise<ArrayBuffer> {
  const key = await importKey(keyB64);
  const iv = window.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  
  const encrypted = await window.crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    chunk
  );

  // Prepend IV to the encrypted data
  const result = new Uint8Array(iv.length + encrypted.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(encrypted), iv.length);
  
  return result.buffer;
}

/**
 * Decrypts an ArrayBuffer that has the IV prepended.
 */
export async function decryptChunk(chunk: ArrayBuffer, keyB64: string): Promise<ArrayBuffer> {
  const key = await importKey(keyB64);
  const data = new Uint8Array(chunk);
  
  const iv = data.slice(0, IV_LENGTH);
  const encrypted = data.slice(IV_LENGTH);
  
  try {
    const decrypted = await window.crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      key,
      encrypted
    );
    return decrypted;
  } catch (e) {
    console.error('Decryption failed', e);
    throw new Error('Failed to decrypt chunk. The encryption key might be incorrect.');
  }
}

/**
 * Encrypts a string (e.g. JSON) using the provided base64 key.
 */
export async function encryptText(text: string, keyB64: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const encrypted = await encryptChunk(data.buffer as ArrayBuffer, keyB64);
  return b64Encode(new Uint8Array(encrypted));
}

/**
 * Decrypts a base64 string back to text.
 */
export async function decryptText(b64Data: string, keyB64: string): Promise<string> {
  const encrypted = b64Decode(b64Data);
  const decrypted = await decryptChunk(encrypted.buffer as ArrayBuffer, keyB64);
  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  const keyData = b64Decode(keyB64);
  return window.crypto.subtle.importKey(
    'raw',
    keyData,
    ALGORITHM,
    false,
    ['encrypt', 'decrypt']
  );
}

function b64Encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64Decode(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
