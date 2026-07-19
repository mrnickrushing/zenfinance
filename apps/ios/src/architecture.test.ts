/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('iOS application module boundaries', () => {
  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

  it('keeps generated styles and cohesive state clusters out of App.tsx', () => {
    const lineCount = appSource.split(/\r?\n/).length;
    const localStateCalls = appSource.match(/\buseReducerState(?:<[^\n]+?>)?\(/g) ?? [];

    expect(lineCount).toBeLessThan(5_200);
    expect(localStateCalls.length).toBeLessThanOrEqual(60);
    expect(appSource).not.toMatch(/\buseState(?:<[^\n]+?>)?\(/);
    expect(appSource).not.toContain('const styles = StyleSheet.create({');
  });
});
