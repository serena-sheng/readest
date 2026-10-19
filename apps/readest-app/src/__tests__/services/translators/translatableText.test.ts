import { describe, expect, test } from 'vitest';
import {
  isTranslatableText,
  looksLikeTranslationRefusal,
} from '@/app/reader/hooks/useTextTranslation';

describe('isTranslatableText', () => {
  test('rejects filenames and bare keys', () => {
    expect(isTranslatableText('page03.png')).toBe(false);
    expect(isTranslatableText('PAGE05.PNG')).toBe(false);
    expect(isTranslatableText('page03')).toBe(false);
    expect(isTranslatableText('001')).toBe(false);
    expect(isTranslatableText('img_12')).toBe(false);
  });

  test('accepts prose and CJK', () => {
    expect(isTranslatableText('It is a truth universally acknowledged.')).toBe(true);
    expect(isTranslatableText('第一章 初遇')).toBe(true);
    expect(isTranslatableText('Chapter 1')).toBe(true);
  });

  test('rejects empty and symbol-only text', () => {
    expect(isTranslatableText('   ')).toBe(false);
    expect(isTranslatableText('***')).toBe(false);
  });
});

describe('looksLikeTranslationRefusal', () => {
  test('detects apologies and meta replies', () => {
    expect(
      looksLikeTranslationRefusal("I don't see any text to translate — please paste the text."),
    ).toBe(true);
    expect(looksLikeTranslationRefusal('请提供需要翻译的文本')).toBe(true);
    expect(looksLikeTranslationRefusal('No text to translate')).toBe(true);
  });

  test('keeps real translations', () => {
    expect(looksLikeTranslationRefusal('举世公认的真理是，一个拥有丰厚财产的单身男子')).toBe(false);
  });
});
