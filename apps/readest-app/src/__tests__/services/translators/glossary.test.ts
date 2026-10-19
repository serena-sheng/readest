import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  GLOSSARY_REVISION_KEY,
  GLOSSARY_STORAGE_KEY,
  getGlossary,
  getGlossaryRevision,
  getGlossaryText,
  parseGlossary,
  setGlossaryText,
  withGlossaryRevision,
} from '@/services/translators/glossary';
import { installMemoryStorage } from '../../memoryStorage';

beforeEach(() => {
  installMemoryStorage();
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage?.clear();
});

describe('parseGlossary', () => {
  it('ignores blank lines, comments and lines with an empty side', () => {
    const text = [
      '# 常用译名',
      '',
      '   ',
      'Elizabeth=伊丽莎白',
      '=只有译名',
      'Darcy=',
      '没有等号',
      '# 另一条注释',
      'Bennet = 班纳特 ',
    ].join('\n');

    expect(parseGlossary(text)).toEqual({
      Elizabeth: '伊丽莎白',
      Bennet: '班纳特',
    });
  });

  it('splits on the first = so a translation may contain one, last duplicate wins', () => {
    expect(parseGlossary('a=b=c\nKey=旧\nKey=新')).toEqual({ a: 'b=c', Key: '新' });
  });

  it('returns an empty object for empty or malformed input', () => {
    expect(parseGlossary('')).toEqual({});
    expect(parseGlossary('\n# 注释\n   \nno separator\n=empty')).toEqual({});
  });
});

describe('glossary storage', () => {
  it('round-trips raw text and parsed pairs', () => {
    const text = 'Elizabeth=伊丽莎白\nDarcy=达西';
    expect(getGlossaryText()).toBe('');
    expect(getGlossary()).toEqual({});

    setGlossaryText(text);

    expect(window.localStorage.getItem(GLOSSARY_STORAGE_KEY)).toBe(text);
    expect(getGlossaryText()).toBe(text);
    expect(getGlossary()).toEqual({ Elizabeth: '伊丽莎白', Darcy: '达西' });
  });

  it('bumps the revision on every write and starts at zero', () => {
    expect(getGlossaryRevision()).toBe(0);

    setGlossaryText('a=b');
    expect(getGlossaryRevision()).toBe(1);
    expect(window.localStorage.getItem(GLOSSARY_REVISION_KEY)).toBe('1');

    setGlossaryText('a=c');
    expect(getGlossaryRevision()).toBe(2);

    // A hand-edited or corrupted counter reads as zero rather than NaN.
    window.localStorage.setItem(GLOSSARY_REVISION_KEY, 'not-a-number');
    expect(getGlossaryRevision()).toBe(0);
  });

  it('changes the cache scope when the revision changes', () => {
    const scope = 'openai-compatible|';
    const before = withGlossaryRevision(scope);
    expect(before).toBe('openai-compatible||g0');

    setGlossaryText('Elizabeth=伊丽莎白');
    expect(withGlossaryRevision(scope)).toBe('openai-compatible||g1');
    expect(withGlossaryRevision(scope)).not.toBe(before);
  });

  it('degrades silently when storage is unavailable', () => {
    Object.defineProperty(window, 'localStorage', { value: undefined, configurable: true });

    expect(getGlossaryText()).toBe('');
    expect(getGlossary()).toEqual({});
    expect(getGlossaryRevision()).toBe(0);
    expect(() => setGlossaryText('Elizabeth=伊丽莎白')).not.toThrow();
    expect(getGlossaryText()).toBe('');
    expect(withGlossaryRevision('scope')).toBe('scope|g0');
  });
});
