import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const globals = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8');

/**
 * Every CSS rule whose selector mentions `.header-title`, with its body. The
 * emm theme used to hide the bar's title and print it again as an 11px
 * uppercase imprint; both rules were removed so the HeaderBar's own
 * `text-meta font-medium` line is the only rendering. The SectionInfo imprint
 * rules are separate selectors and must stay.
 */
const headerTitleRules = () => {
  const rules: { selector: string; body: string }[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(globals)) !== null) {
    const selector = (match[1] ?? '').trim();
    if (selector.includes('.header-title')) {
      rules.push({ selector, body: match[2] ?? '' });
    }
  }
  return rules;
};

describe('emm theme header title', () => {
  it('does not hide the header title', () => {
    for (const { selector, body } of headerTitleRules()) {
      expect(body, selector).not.toMatch(/visibility:\s*hidden/);
    }
  });

  it('does not uppercase the header title', () => {
    for (const { selector, body } of headerTitleRules()) {
      expect(body, selector).not.toMatch(/text-transform:\s*uppercase/);
    }
  });

  it('keeps the SectionInfo imprint styling', () => {
    // The imprint stays, but at the caption step and without the uppercase
    // tracking that CJK text cannot use.
    expect(globals).toMatch(
      /html\[data-theme\^='emm'\] \.sectioninfo[^{]*\{[^}]*font-size:\s*var\(--text-caption\)/,
    );
    expect(globals).not.toMatch(/\.sectioninfo[^{]*\{[^}]*text-transform:\s*uppercase/);
  });
});
