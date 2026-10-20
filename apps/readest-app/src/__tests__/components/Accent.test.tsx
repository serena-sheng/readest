import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * One accent, not two. These surfaces used to paint their active state with
 * Tailwind's `blue-500` while everything around them used the theme's
 * `primary`; a theme whose primary is not blue then showed two accents at
 * once. The rule is source-level because the class strings are what regress.
 */

const read = (file: string) => readFileSync(resolve(process.cwd(), 'src', file), 'utf8');

const ACCENTED_FILES = [
  'app/reader/components/TranslationToggler.tsx',
  'app/reader/components/footerbar/NavigationBar.tsx',
  'app/library/components/BookItem.tsx',
  'app/library/components/TaggingModal.tsx',
  'app/library/components/GroupingModal.tsx',
];

describe('accent colour', () => {
  it('never reaches for blue-500 in the tool, footer and library accents', () => {
    for (const file of ACCENTED_FILES) {
      expect(read(file), file).not.toMatch(/blue-500/);
    }
  });

  it('paints those accents with the theme primary', () => {
    expect(read('app/reader/components/TranslationToggler.tsx')).toMatch(/text-primary/);
    expect(read('app/reader/components/footerbar/NavigationBar.tsx')).toMatch(/text-primary/);
    expect(read('app/library/components/BookItem.tsx')).toMatch(/fill-primary/);
    expect(read('app/library/components/TaggingModal.tsx')).toMatch(/fill-primary/);
    expect(read('app/library/components/GroupingModal.tsx')).toMatch(/fill-primary/);
  });

  it('gives native range sliders the primary accent, so the footer bar matches', () => {
    expect(read('styles/globals.css')).toMatch(
      /input\[type='range'\]\s*\{[^}]*accent-color:\s*var\(--color-primary\)/,
    );
  });
});
