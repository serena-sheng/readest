import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const globals = readFileSync(resolve(process.cwd(), 'src', 'styles', 'globals.css'), 'utf8');
// The theme block wraps some values (the cover shadow) across lines; compare
// against a single-space copy so the assertions describe the values, not the
// formatting.
const flat = globals.replace(/\s+/g, ' ');

const STUDY_SCALE = {
  display: { size: '34px', lineHeight: '40px' },
  section: { size: '22px', lineHeight: '30px' },
  body: { size: '15px', lineHeight: '26px' },
  read: { size: '17px', lineHeight: '29px' },
  meta: { size: '12px', lineHeight: '18px' },
} as const;

describe('study design tokens', () => {
  it('declares the five-step type scale', () => {
    for (const [name, { size, lineHeight }] of Object.entries(STUDY_SCALE)) {
      expect(flat, `--text-${name}`).toContain(`--text-${name}: ${size};`);
      expect(flat, `--text-${name} line height`).toContain(
        `--text-${name}--line-height: ${lineHeight};`,
      );
    }
  });

  it('carries the serif family for titles', () => {
    expect(flat).toContain(
      "--font-serif: 'Source Han Serif CN', 'Source Serif 4', Georgia, serif;",
    );
  });

  it('separates surfaces with one hairline variable, flipped for dark themes', () => {
    expect(flat).toContain('--hairline: 1px solid rgba(26, 22, 16, 0.1);');
    expect(flat).toContain(":root[data-theme$='-dark']");
    expect(flat).toContain('--hairline: 1px solid rgba(233, 226, 213, 0.1);');
  });

  it('declares the study surfaces for light and dark', () => {
    expect(flat).toContain('--color-study-canvas: #f6f1e7;');
    expect(flat).toContain('--color-study-page: #fdfbf7;');
    expect(flat).toContain('--color-study-chip: #ede6d8;');
    expect(flat).toContain('--color-study-canvas: #141210;');
    expect(flat).toContain('--color-study-page: #1b1815;');
    expect(flat).toContain('--color-study-ink: #e9e2d5;');
  });

  it('lets only the cover cast a shadow', () => {
    expect(flat).toContain(
      '--shadow-cover: 0 1px 2px rgba(60, 45, 25, 0.06), 0 8px 24px rgba(60, 45, 25, 0.05);',
    );
    const occurrences = flat.split('0 8px 24px rgba(60, 45, 25, 0.05)').length - 1;
    expect(occurrences).toBe(1);
  });

  it('declares the cover/control radii and the study easing', () => {
    expect(flat).toContain('--radius-cover: 2px;');
    expect(flat).toContain('--radius-control: 4px;');
    expect(flat).toContain('--ease-study: cubic-bezier(0.23, 1, 0.32, 1);');
  });
});
