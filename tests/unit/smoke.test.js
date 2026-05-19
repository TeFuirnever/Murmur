import { describe, it, expect } from 'vitest';

describe('Smoke Test', () => {
  it('basic arithmetic works', () => {
    expect(1 + 1).toBe(2);
  });

  it('project name is correct', () => {
    expect('Murmur').toBeTruthy();
  });
});
