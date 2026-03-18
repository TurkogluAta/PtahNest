const { encrypt, decrypt } = require('../../src/utils/encryption');

describe('Encryption (AES-256-GCM)', () => {
  const plaintext = 'gho_test_token_abc123';

  test('encrypt and decrypt should round-trip correctly', () => {
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  test('each encrypt call should produce different ciphertext (random IV)', () => {
    const encrypted1 = encrypt(plaintext);
    const encrypted2 = encrypt(plaintext);
    expect(encrypted1).not.toBe(encrypted2);

    // Both should decrypt to same value
    expect(decrypt(encrypted1)).toBe(plaintext);
    expect(decrypt(encrypted2)).toBe(plaintext);
  });

  test('should handle empty string', () => {
    const encrypted = encrypt('');
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe('');
  });

  test('should handle unicode text', () => {
    const unicode = 'test_token_öçşğüı_日本語';
    const encrypted = encrypt(unicode);
    expect(decrypt(encrypted)).toBe(unicode);
  });

  test('corrupted ciphertext should throw error', () => {
    const encrypted = encrypt(plaintext);
    const parts = encrypted.split(':');
    // Corrupt the encrypted data
    parts[1] = 'deadbeef';
    const corrupted = parts.join(':');

    expect(() => decrypt(corrupted)).toThrow();
  });

  test('wrong format (missing parts) should throw error', () => {
    expect(() => decrypt('only_one_part')).toThrow('Invalid encrypted token format');
    expect(() => decrypt('two:parts')).toThrow('Invalid encrypted token format');
  });

  test('tampered auth tag should throw error', () => {
    const encrypted = encrypt(plaintext);
    const parts = encrypted.split(':');
    // Tamper the auth tag
    parts[2] = '00'.repeat(16);
    const tampered = parts.join(':');

    expect(() => decrypt(tampered)).toThrow();
  });
});
