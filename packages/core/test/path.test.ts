import { describe, expect, it } from 'vitest';
import { ABSENT, applyOverrides, getAtPath, removeAtPath, setAtPath } from '../src/derive/path.js';
import { baseline } from './fixtures.js';

describe('getAtPath', () => {
  it('reads a nested value', () => {
    expect(getAtPath({ a: { b: 1 } }, 'a.b')).toEqual({ present: true, value: 1 });
  });

  it('reports a missing segment as absent rather than undefined', () => {
    expect(getAtPath({ a: {} }, 'a.b')).toEqual(ABSENT);
  });

  it('distinguishes a key holding undefined from a missing key', () => {
    expect(getAtPath({ a: undefined }, 'a')).toEqual({ present: true, value: undefined });
    expect(getAtPath({}, 'a')).toEqual(ABSENT);
  });

  it('does not read through arrays as if they were objects', () => {
    expect(getAtPath({ a: [1, 2] }, 'a.b')).toEqual(ABSENT);
  });
});

describe('setAtPath', () => {
  it('creates intermediate objects', () => {
    const root: Record<string, unknown> = {};
    setAtPath(root, 'a.b.c', 7);
    expect(root).toEqual({ a: { b: { c: 7 } } });
  });

  it('replaces a non-object standing in the way', () => {
    const root: Record<string, unknown> = { a: 'scalar' };
    setAtPath(root, 'a.b', 1);
    expect(root).toEqual({ a: { b: 1 } });
  });
});

describe('removeAtPath', () => {
  it('deletes the key rather than blanking it', () => {
    const root: Record<string, unknown> = { a: { b: 1, c: 2 } };
    removeAtPath(root, 'a.b');
    expect(root).toEqual({ a: { c: 2 } });
    expect(getAtPath(root, 'a.b')).toEqual(ABSENT);
  });

  it('is a no-op for a path that does not exist', () => {
    const root: Record<string, unknown> = { a: 1 };
    removeAtPath(root, 'x.y');
    expect(root).toEqual({ a: 1 });
  });
});

describe('applyOverrides', () => {
  it('returns the baseline unchanged when there are no overrides', () => {
    const resolved = applyOverrides(baseline, []);
    expect(resolved.context).toEqual(baseline.context);
    expect(resolved.config).toEqual(baseline.config);
  });

  it('does not mutate the baseline', () => {
    const before = structuredClone(baseline.context);
    applyOverrides(baseline, [
      { path: 'context.body.channel', op: 'set', value: 'sms' },
    ]);
    expect(baseline.context).toEqual(before);
  });

  it('applies set, remove and append in order', () => {
    const resolved = applyOverrides(baseline, [
      { path: 'context.body.channel', op: 'set', value: 'sms' },
      { path: 'context.headers.Authorization', op: 'remove' },
      { path: 'context.body.tags', op: 'append', value: 'urgent' },
      { path: 'context.body.tags', op: 'append', value: 'billing' },
    ]);
    expect(getAtPath(resolved, 'context.body.channel')).toEqual({ present: true, value: 'sms' });
    expect(getAtPath(resolved, 'context.headers.Authorization')).toEqual(ABSENT);
    expect(getAtPath(resolved, 'context.body.tags')).toEqual({
      present: true,
      value: ['urgent', 'billing'],
    });
  });

  it('lets a later override win over an earlier one', () => {
    const resolved = applyOverrides(baseline, [
      { path: 'context.body.channel', op: 'set', value: 'sms' },
      { path: 'context.body.channel', op: 'set', value: 'push' },
    ]);
    expect(getAtPath(resolved, 'context.body.channel')).toEqual({ present: true, value: 'push' });
  });

  it('carries preconditions and target through untouched', () => {
    const resolved = applyOverrides(baseline, []);
    expect(resolved.preconditions).toEqual(baseline.preconditions);
    expect(resolved.target).toEqual(baseline.target);
  });
});
