import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ReaderChrome from '@/app/reader/components/ReaderChrome';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {} }),
}));

const readerState = {
  bookKeys: ['book-1'],
  setHoveredBookKey: vi.fn(),
  getView: () => null,
};
vi.mock('@/store/readerStore', () => ({ useReaderStore: () => readerState }));

const sidebarState = {
  setSideBarBookKey: vi.fn(),
  setSideBarVisible: vi.fn(),
  setSearchBarVisible: vi.fn(),
};
vi.mock('@/store/sidebarStore', () => ({ useSidebarStore: () => sidebarState }));

const bookDataState = {
  getConfig: () => ({
    viewSettings: { sideBarTab: 'toc', enableAnnotationQuickActions: false },
    lastSyncedAtConfig: 0,
  }),
  setConfig: vi.fn(),
  getBookData: () => null,
};
vi.mock('@/store/bookDataStore', () => ({ useBookDataStore: () => bookDataState }));

vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));

const notebookToggle = vi.fn();
const typesetToggle = vi.fn();
vi.mock('@/app/reader/hooks/useReaderTools', () => ({
  ReaderToolsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReaderToolsPanels: () => ({
    translationExpert: { isOpen: false, toggle: vi.fn() },
    askLocal: { isOpen: false, toggle: vi.fn() },
    typeset: { isOpen: false, toggle: typesetToggle },
    ideas: { isOpen: false, toggle: vi.fn() },
  }),
  useNotebookToggle: () => ({ isOpen: false, toggle: notebookToggle }),
}));

vi.mock('@/components/Dropdown', () => ({
  default: ({ label, toggleButton }: { label: string; toggleButton?: React.ReactNode }) => (
    <button type='button' aria-label={label}>
      {toggleButton}
    </button>
  ),
}));
vi.mock('@/components/Menu', () => ({ default: () => null }));
vi.mock('@/components/MenuItem', () => ({ default: () => null }));
vi.mock('@/components/ModalPortal', () => ({ default: () => null }));
vi.mock('@/components/WindowButtons', () => ({ default: () => null }));
vi.mock('@/app/reader/components/ReaderToolsMenuItems', () => ({ default: () => null }));
vi.mock('@/app/reader/components/ViewMenu', () => ({ default: () => null }));
vi.mock('@/app/reader/components/SyncInfoDialog', () => ({ default: () => null }));
vi.mock('@/app/reader/components/BookmarkToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/TranslationToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/manga/MangaTranslateToggler', () => ({ default: () => null }));

const renderChrome = (overrides: Partial<React.ComponentProps<typeof ReaderChrome>> = {}) =>
  render(
    <ReaderChrome
      bookKey='book-1'
      bookTitle='夜航西飞'
      sectionLabel='第三章'
      page={214}
      fraction={0.25}
      gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
      onCloseBook={vi.fn()}
      onGoToLibrary={vi.fn()}
      {...overrides}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ReaderChrome top toolbar', () => {
  it('is absent by default and reveals five icons on the top edge', () => {
    const { container } = renderChrome();
    const bar = container.querySelector('[role="toolbar"]') as HTMLElement;

    expect(bar.getAttribute('aria-hidden')).toBe('true');
    expect(bar.className).toContain('opacity-0');
    expect(bar.className).toContain('pointer-events-none');

    fireEvent.mouseEnter(container.querySelector('.reader-chrome-trigger')!);

    expect((container.querySelector('[role="toolbar"]') as HTMLElement).getAttribute('aria-hidden')).toBe('false');
    expect((container.querySelector('[role="toolbar"]') as HTMLElement).className).toContain('opacity-100');

    const icons = ['目录', '搜索', '笔记', '字体', '更多'];
    for (const label of icons) {
      expect((container.querySelector('[role="toolbar"]') as HTMLElement).querySelector(`[aria-label="${label}"]`)).not.toBeNull();
    }
    expect((container.querySelector('[role="toolbar"]') as HTMLElement).querySelectorAll('button')).toHaveLength(5);
  });

  it('centres its row on the reader measure', () => {
    const { container } = renderChrome();
    const row = container.querySelector('.reader-chrome-row') as HTMLElement;

    expect(row.classList.contains('w-[var(--reader-measure)]')).toBe(true);
    expect(row.classList.contains('mx-auto')).toBe(true);
  });

  it('hides itself 1.2s after appearing', () => {
    vi.useFakeTimers();
    const { container } = renderChrome();

    act(() => {
      fireEvent.mouseEnter(container.querySelector('.reader-chrome-trigger')!);
    });
    expect((container.querySelector('[role="toolbar"]') as HTMLElement).getAttribute('aria-hidden')).toBe('false');

    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect((container.querySelector('[role="toolbar"]') as HTMLElement).getAttribute('aria-hidden')).toBe('true');
  });

  it('reveals on ⌘K and opens the contents drawer from the first icon', () => {
    const { container } = renderChrome();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect((container.querySelector('[role="toolbar"]') as HTMLElement).getAttribute('aria-hidden')).toBe('false');

    fireEvent.click((container.querySelector('[role="toolbar"]') as HTMLElement).querySelector('[aria-label="目录"]')!);
    expect(sidebarState.setSideBarBookKey).toHaveBeenCalledWith('book-1');
    expect(sidebarState.setSideBarVisible).toHaveBeenCalledWith(true);
    expect(bookDataState.setConfig).toHaveBeenCalledWith('book-1', {
      viewSettings: expect.objectContaining({ sideBarTab: 'toc' }),
    });
  });
});

describe('ReaderChrome bottom hairline', () => {
  it('draws the progress as a 2px line at the window edge', () => {
    const { container } = renderChrome({ fraction: 0.25 });
    const line = container.querySelector('[data-testid="reader-progress-line"]') as HTMLElement;

    expect(line).not.toBeNull();
    expect(line.style.width).toBe('25%');
    expect(line.className).toContain('bg-primary');
  });

  it('expands the footer on hover without moving the page content', () => {
    const { container } = render(
      <div>
        <div data-testid='page-content' style={{ paddingTop: 96 }}>
          text
        </div>
        <ReaderChrome
          bookKey='book-1'
          bookTitle='夜航西飞'
          fraction={0.5}
          gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
          onCloseBook={vi.fn()}
          onGoToLibrary={vi.fn()}
        />
      </div>,
    );

    const content = container.querySelector('[data-testid="page-content"]') as HTMLElement;
    const before = content.getAttribute('style');
    const foot = container.querySelector('[data-testid="reader-chrome-foot"]') as HTMLElement;

    // The whole bottom surface is an absolute overlay, so it cannot take part
    // in the text column's layout.
    expect(foot.className).toContain('absolute');
    expect(foot.className).toContain('bottom-0');

    fireEvent.mouseEnter(container.querySelector('[data-testid="reader-chrome-foot-strip"]')!);

    expect(readerState.setHoveredBookKey).toHaveBeenCalledWith('book-1');
    expect(content.getAttribute('style')).toBe(before);
  });
});
