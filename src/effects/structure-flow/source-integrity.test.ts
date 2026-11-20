import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The authored nebula document must stay byte-exact with the registered ThreeUI source (nebula.json). */
describe('ThreeUI nebula source', () => {
  it('matches the registered SHA-256', () => {
    const bytes = readFileSync(join(__dirname, 'sources', 'julian-vance-nebula.html'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      'e4f3bda31a5c260356790add556a2ae59bb97ad6015a1f84cc6c9801b37e5a4d'
    );
  });
});
