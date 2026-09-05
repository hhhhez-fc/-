import { describe, expect, it } from 'vitest';
import html from '../index.html?raw';

describe('application shell', () => {
  it('declares an inline favicon so browsers do not probe a missing resource', () => {
    expect(html).toMatch(/<link rel="icon" href="data:image\/svg\+xml,/);
  });
});
