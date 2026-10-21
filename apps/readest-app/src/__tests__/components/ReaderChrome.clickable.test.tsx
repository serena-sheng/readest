import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ReaderChrome from '@/app/reader/components/ReaderChrome';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));

const readerState = {
  bookKeys: ['book-1'],
  setHoveredBookKey: vi.fn(),
  getView: () => ({
    renderer: { columnCount: 1, getContents: () => [] },
  }),
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

const tools = vi.hoisted(() => ({
  notebookToggle: vi.fn(),
  typesetToggle: vi.fn(),
}));
vi.mock('@/app/reader/hooks/useReaderTools', () => ({
  ReaderToolsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReaderToolsPanels: () => ({
    translationExpert: { isOpen: false, toggle: vi.fn() },
    askLocal: { isOpen: false, toggle: vi.fn() },
    typeset: { isOpen: false, toggle: tools.typesetToggle },
    ideas: { isOpen: false, toggle: vi.fn() },
  }),
  useNotebookToggle: () => ({ isOpen: false, toggle: tools.notebookToggle }),
}));

// The menu shell is exercised by its own tests; what matters here is that the
// button in the bar reaches ReaderChrome's handler.
vi.mock('@/components/Dropdown', () => ({
  default: ({
    label,
    toggleButton,
    onToggle,
  }: {
    label: string;
    toggleButton?: React.ReactNode;
    onToggle?: (open: boolean) => void;
  }) => (
    <button type='button' aria-label={label} onClick={() => onToggle?.(true)}>
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
vi.mock('@/app/reader/components/manga/MangaTranslateToggler', () => ({
  default: () => <div data-testid='manga-toggler' />,
}));

const renderChrome = (overrides: Partial<React.ComponentProps<typeof ReaderChrome>> = {}) =>
  render(
    <ReaderChrome
      bookKey='book-1'
      bookTitle='夜航西飞'
      fraction={0.25}
      gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
      onCloseBook={vi.fn()}
      onGoToLibrary={vi.fn()}
      {...overrides}
    />,
  );

const toolbar = (container: HTMLElement) =>
  container.querySelector('[role="toolbar"]') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('ReaderChrome clickable controls', () => {
  it('accepts pointer events only while the bar is visible', () => {
    const { container } = renderChrome();

    expect(toolbar(container).className).toContain('pointer-events-none');

    fireEvent.mouseEnter(container.querySelector('.reader-chrome-trigger')!);

    expect(toolbar(container).className).toContain('pointer-events-auto');
    expect(toolbar(container).className).not.toContain('pointer-events-none');
    // The edge trigger is below the bar, so it can never steal a click aimed
    // at a visible icon.
    expect(toolbar(container).className).toContain('z-10');
    expect(container.querySelector('.reader-chrome-trigger')!.className).toContain('z-0');
  });

  it('opens the table of contents from 目录', () => {
    const { container } = renderChrome();

    fireEvent.click(toolbar(container).querySelector('[aria-label="目录"]')!);

    expect(sidebarState.setSideBarBookKey).toHaveBeenCalledWith('book-1');
    expect(sidebarState.setSideBarVisible).toHaveBeenCalledWith(true);
    expect(bookDataState.setConfig).toHaveBeenCalledWith('book-1', {
      viewSettings: expect.objectContaining({ sideBarTab: 'toc' }),
    });
  });

  it('opens the search bar from 搜索', () => {
    const { container } = renderChrome();

    fireEvent.click(toolbar(container).querySelector('[aria-label="搜索"]')!);

    expect(sidebarState.setSearchBarVisible).toHaveBeenCalledWith(true);
    expect(sidebarState.setSideBarVisible).toHaveBeenCalledWith(true);
  });

  it('opens the notebook from 笔记', () => {
    const { container } = renderChrome();

    fireEvent.click(toolbar(container).querySelector('[aria-label="笔记"]')!);

    expect(tools.notebookToggle).toHaveBeenCalledTimes(1);
  });

  it('opens the typeset panel from 字体', () => {
    const { container } = renderChrome();

    fireEvent.click(toolbar(container).querySelector('[aria-label="字体"]')!);

    expect(tools.typesetToggle).toHaveBeenCalledTimes(1);
  });

  it('reports the 更多 menu opening', () => {
    const onDropdownOpenChange = vi.fn();
    const { container } = renderChrome({ onDropdownOpenChange });

    fireEvent.click(toolbar(container).querySelector('[aria-label="更多"]')!);

    expect(onDropdownOpenChange).toHaveBeenCalledWith(true);
  });

  it('mounts the manga cluster in the default reading state, outside the menu', () => {
    const { container } = renderChrome();

    const toggler = container.querySelector('[data-testid="manga-toggler"]') as HTMLElement;
    expect(toggler).not.toBeNull();
    expect(toolbar(container).contains(toggler)).toBe(false);
  });
});
