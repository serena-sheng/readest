import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(resolve(process.cwd(), 'src', file), 'utf8');

const globals = read('styles/globals.css');

const SCALE = {
  caption: { size: '12px', lineHeight: '17px' },
  meta: { size: '13px', lineHeight: '19px' },
  body: { size: '15px', lineHeight: '26px' },
  title: { size: '19px', lineHeight: '26px' },
  display: { size: '44px', lineHeight: '48px' },
} as const;

describe('type scale tokens', () => {
  it('declares all five steps with a size and a line height', () => {
    for (const [name, { size, lineHeight }] of Object.entries(SCALE)) {
      expect(globals).toMatch(new RegExp(`--text-${name}:\\s*${size};`));
      expect(globals).toMatch(new RegExp(`--text-${name}--line-height:\\s*${lineHeight};`));
    }
  });

  it('no longer reaches outside the scale in reader and library chrome', () => {
    const files = [
      'app/reader/components/StatusInfo.tsx',
      'app/reader/components/TypesetPanel.tsx',
      'app/reader/components/annotator/HighlightOptions.tsx',
      'app/reader/components/annotator/SelectionActions.tsx',
      'app/reader/components/tts/TTSMiniPlayer.tsx',
      'app/reader/components/tts/TTSLyricsView.tsx',
      'app/library/components/Bookshelf.tsx',
      'components/MenuItem.tsx',
    ];

    for (const file of files) {
      const source = read(file);
      for (const size of ['text-[8px]', 'text-[9px]', 'text-[10px]', 'text-[12.5px]']) {
        expect(source, `${file} still uses ${size}`).not.toContain(size);
      }
    }
  });

  it('routes the converted chrome text through the tokens', () => {
    expect(read('app/reader/components/StatusInfo.tsx')).toContain('text-caption');
    expect(read('app/reader/components/annotator/SelectionActions.tsx')).toContain('text-meta');
    expect(read('app/reader/components/TaskStatusBar.tsx')).toContain('text-body');
    expect(read('components/MenuItem.tsx')).toContain('text-body');
    expect(read('components/MenuItem.tsx')).toContain('text-meta');
  });

  it('keeps no bold or extrabold weight in reader and library chrome', () => {
    const files = [
      'app/reader/components/HeaderBar.tsx',
      'app/reader/components/annotator/DictionaryResultsView.tsx',
      'app/reader/components/annotator/ExportMarkdownDialog.tsx',
      'app/reader/components/annotator/ProofreadPopup.tsx',
      'app/reader/components/rsvp/RSVPOverlay.tsx',
      'app/reader/components/rsvp/RSVPStartDialog.tsx',
      'app/reader/components/sidebar/SearchOptions.tsx',
      'app/reader/components/tts/TTSPlayerSheet.tsx',
      'app/library/components/CacheManagerWindow.tsx',
    ];

    for (const file of files) {
      const source = read(file);
      expect(source, `${file} still uses font-bold`).not.toMatch(/font-(?:bold|extrabold)/);
    }
  });
});
