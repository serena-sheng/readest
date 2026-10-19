import { describe, expect, it } from 'vitest';

import {
  BASE_PROMPT,
  buildVisionPrompt,
  clampBubble,
  normalizeBubble,
  parseVisionResult,
  toPixel,
} from '@/services/manga/visionPrompt';

const ITEM = {
  box: [0.1, 0.2, 0.4, 0.5],
  src: 'こんにちは',
  dst: '你好',
  vertical: true,
};

describe('parseVisionResult', () => {
  it('parses a plain JSON array without bounds', () => {
    const bubbles = parseVisionResult(JSON.stringify([ITEM]));

    expect(bubbles).toEqual([
      { box: [0.1, 0.2, 0.4, 0.5], src: 'こんにちは', dst: '你好', vertical: true },
    ]);
  });

  it('parses an array wrapped in a markdown fence', () => {
    const raw = `\`\`\`json\n${JSON.stringify([ITEM])}\n\`\`\``;

    expect(parseVisionResult(raw)).toHaveLength(1);
    expect(parseVisionResult(raw)[0]!.dst).toBe('你好');
  });

  it('ignores explanatory text before and after the array', () => {
    const raw = `Here are the detected bubbles:\n${JSON.stringify([
      ITEM,
    ])}\nLet me know if you need anything else.`;

    expect(parseVisionResult(raw)).toHaveLength(1);
  });

  it('returns an empty array for an empty array, blank input and garbage', () => {
    expect(parseVisionResult('[]')).toEqual([]);
    expect(parseVisionResult('   ')).toEqual([]);
    expect(parseVisionResult(null)).toEqual([]);
    expect(parseVisionResult('not json at all')).toEqual([]);
  });

  it('drops bubbles without a translation and defaults a missing source', () => {
    const raw = JSON.stringify([
      { box: [0.1, 0.1, 0.2, 0.2], dst: '有译文' },
      { box: [0.3, 0.3, 0.4, 0.4], src: 'no translation' },
      { box: [0.5, 0.5, 0.6], dst: 'short box' },
    ]);

    expect(parseVisionResult(raw)).toEqual([
      { box: [0.1, 0.1, 0.2, 0.2], src: '', dst: '有译文', vertical: false },
    ]);
  });

  it('discards the whole result when coordinates overshoot the page by over 20%', () => {
    // Normalized [2,2,...] becomes pixel [2000,2000,...] on a 1000×1000 page,
    // far past the 20% slack in both directions.
    const raw = JSON.stringify([{ box: [2, 2, 2.5, 2.5], dst: '越界', vertical: false }]);

    expect(parseVisionResult(raw, { width: 1000, height: 1000 })).toEqual([]);
  });

  it('keeps the page when only a minority of boxes are invalid', () => {
    const raw = JSON.stringify([
      { box: [0.1, 0.1, 0.2, 0.2], dst: '正常' },
      { box: [0.3, 0.3, 0.4, 0.4], dst: '正常二' },
      { box: [9, 9, 9.5, 9.5], dst: '越界' },
    ]);

    expect(parseVisionResult(raw, { width: 1000, height: 1000 })).toHaveLength(2);
  });

  it('converts normalized coordinates to pixels when bounds are given', () => {
    const raw = JSON.stringify([ITEM]);

    expect(parseVisionResult(raw, { width: 1000, height: 2000 })[0]!.box).toEqual([
      100, 400, 400, 1000,
    ]);
  });

  it('passes vertical through unchanged', () => {
    const raw = JSON.stringify([
      { ...ITEM, vertical: true },
      { ...ITEM, vertical: false },
      { ...ITEM, vertical: undefined },
    ]);

    expect(parseVisionResult(raw).map((bubble) => bubble.vertical)).toEqual([
      true,
      false,
      false,
    ]);
  });
});

describe('normalizeBubble', () => {
  it('orders box corners and tolerates numeric strings', () => {
    expect(normalizeBubble({ box: ['0.8', '0.9', '0.2', '0.1'], dst: ' 译文 ' })).toEqual({
      box: [0.2, 0.1, 0.8, 0.9],
      src: '',
      dst: '译文',
      vertical: false,
    });
  });

  it('rejects malformed items', () => {
    expect(normalizeBubble(null)).toBeNull();
    expect(normalizeBubble({ box: [0, 0, 1], dst: 'x' })).toBeNull();
    expect(normalizeBubble({ box: [0, 0, NaN, 1], dst: 'x' })).toBeNull();
    expect(normalizeBubble({ box: [0, 0, 1, 1], dst: '   ' })).toBeNull();
  });
});

describe('clampBubble and toPixel', () => {
  it('clamps a slight overflow to the page edges', () => {
    const bubble = normalizeBubble({ box: [-5, -8, 100, 120], dst: 'x' })!;

    expect(clampBubble(bubble, 800, 600)!.box).toEqual([0, 0, 100, 120]);
  });

  it('drops boxes that lie outside the page and boxes too small to render', () => {
    const outside = normalizeBubble({ box: [-1000, -1000, -900, -900], dst: 'x' })!;
    const tiny = normalizeBubble({ box: [10, 10, 12, 12], dst: 'x' })!;

    expect(clampBubble(outside, 800, 600)).toBeNull();
    expect(clampBubble(tiny, 800, 600)).toBeNull();
  });

  it('scales a normalized box into pixels', () => {
    const bubble = normalizeBubble(ITEM)!;

    expect(toPixel(bubble, 500, 400).box).toEqual([50, 80, 200, 200]);
  });
});

describe('buildVisionPrompt', () => {
  it('returns the base prompt when there is nothing to append', () => {
    expect(buildVisionPrompt()).toBe(BASE_PROMPT);
    expect(buildVisionPrompt({ glossary: {}, extra: '   ' })).toBe(BASE_PROMPT);
  });

  it('appends glossary terms, empty entries and site requirements', () => {
    const prompt = buildVisionPrompt({
      glossary: { 猫: '咪咪', さん: '' },
      extra: '保留敬语。',
    });

    expect(prompt.startsWith(BASE_PROMPT)).toBe(true);
    expect(prompt).toContain('猫 → 咪咪');
    expect(prompt).toContain('さん → 保留原文');
    expect(prompt).toContain('本站点补充要求:\n保留敬语。');
    expect(prompt.endsWith('以上补充要求不改变输出格式:仍然只输出 JSON 数组。')).toBe(true);
  });
});
