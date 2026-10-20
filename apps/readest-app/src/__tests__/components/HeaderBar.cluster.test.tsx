import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HeaderBar from '@/app/reader/components/HeaderBar';

/**
 * The header's clusters after the top-bar convergence: the left cluster keeps
 * its one-click icons in a fixed order, and the right cluster is only the `…`
 * menu and close. Everything the `…` menu absorbed must still be reachable.
 */

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const h = vi.hoisted(() => ({
  toggleNotebook: vi.fn(),
  toggleTranslation: vi.fn(),
  setSideBarBookKey: vi.fn(),
  viewSettings: { enableAnnotationQuickActions: false } as Record<string, unknown>,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

const useEnvMock = vi.fn();
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => useEnvMock(),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalReadSettings: { highlightStyle: 'highlight', highlightStyles: {} } },
  }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ isDarkMode: false, systemUIVisible: true, statusBarHeight: 0 }),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({
    isSideBarVisible: false,
    getIsSideBarVisible: () => false,
    sideBarBookKey: null,
    setSideBarBookKey: h.setSideBarBookKey,
  }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    bookKeys: ['book-1'],
    hoveredBookKey: 'book-1',
    getView: () => null,
    getViewSettings: () => h.viewSettings,
    setHoveredBookKey: vi.fn(),
    getState: () => ({
      getView: () => null,
      getViewSettings: () => h.viewSettings,
      hoveredBookKey: 'book-1',
      viewStates: {},
    }),
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => null, getConfig: () => null }),
}));
vi.mock('@/store/notebookStore', () => ({
  useNotebookStore: () => ({ isNotebookVisible: false, toggleNotebook: h.toggleNotebook }),
}));
vi.mock('@/store/trafficLightStore', () => ({
  useTrafficLightStore: () => ({
    trafficLightInFullscreen: false,
    setTrafficLightVisibility: vi.fn(),
  }),
}));
vi.mock('@/hooks/useTrafficLight', () => ({
  useTrafficLight: () => ({ isTrafficLightVisible: false }),
}));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (n: number) => n }));
vi.mock('@/app/reader/hooks/useSpatialNavigation', () => ({ useSpatialNavigation: () => {} }));
vi.mock('@/utils/insets', () => ({
  getHeaderTriggerHeight: () => 0,
  getHorizontalInsetStyle: () => ({}),
}));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));

// Left-cluster icons become identifiable markers; their behaviour is covered
// by their own tests. The manga toggle is stubbed for the same reason — its
// menu is asserted by the manga tests.
vi.mock('@/app/reader/components/SidebarToggler', () => ({
  default: () => <button type='button'>sidebar-toggler</button>,
}));
vi.mock('@/app/reader/components/BookmarkToggler', () => ({
  default: () => <button type='button'>bookmark-toggler</button>,
}));
vi.mock('@/app/reader/components/TranslationToggler', () => ({
  default: () => <button type='button'>translation-toggler</button>,
}));
vi.mock('@/app/reader/components/manga/MangaTranslateToggler', () => ({
  default: () => <button type='button'>manga-toggler</button>,
}));
vi.mock('@/app/reader/components/annotator/QuickActionMenu', () => ({ default: () => null }));

// The drawers themselves are heavy; the menu is about reaching them.
vi.mock('@/app/reader/components/TranslationExpertPanel', () => ({
  default: ({ open }: { open: boolean }) => (
    <div data-testid='translation-expert-panel' data-open={String(open)} />
  ),
}));
vi.mock('@/app/reader/components/AskLocalPanel', () => ({
  default: ({ open }: { open: boolean }) => (
    <div data-testid='ask-local-panel' data-open={String(open)} />
  ),
}));
vi.mock('@/app/reader/components/TypesetPanel', () => ({
  default: ({ open }: { open: boolean }) => (
    <div data-testid='typeset-panel' data-open={String(open)} />
  ),
}));
vi.mock('@/app/reader/components/IdeasPanel', () => ({
  default: ({ open }: { open: boolean }) => (
    <div data-testid='ideas-panel' data-open={String(open)} />
  ),
}));

// View options are not this suite's subject, and pull in the whole reader.
vi.mock('@/app/reader/components/ViewMenu', () => ({ default: () => null }));
vi.mock('@/app/reader/components/SyncInfoDialog', () => ({ default: () => null }));
vi.mock('@/components/ModalPortal', () => ({ default: () => null }));

// The dropdown is always open here: its own open/close is covered elsewhere.
// Its toggle and its rows stay separate so the cluster can be counted.
vi.mock('@/components/Dropdown', () => ({
  default: ({
    label,
    toggleButton,
    children,
  }: {
    label: string;
    toggleButton?: React.ReactNode;
    children?: React.ReactNode;
  }) => (
    <div className='dropdown-container'>
      <button type='button' aria-label={label}>
        {toggleButton}
      </button>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock('@/components/WindowButtons', () => ({
  default: ({ closeButtonLabel }: { closeButtonLabel?: string }) => (
    <button type='button' aria-label={closeButtonLabel}>
      {closeButtonLabel}
    </button>
  ),
}));

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
};

const insets = { top: 0, right: 0, bottom: 0, left: 0 };

const renderHeader = () =>
  render(
    <HeaderBar
      bookKey='book-1'
      bookTitle='Book'
      isTopLeft={false}
      isHoveredAnim={false}
      gridInsets={insets}
      screenInsets={insets}
      onCloseBook={vi.fn()}
      onGoToLibrary={vi.fn()}
    />,
  );

const buttonNames = (root: Element) =>
  Array.from(root.querySelectorAll('button')).map(
    (button) =>
      button.textContent?.trim() ||
      button.getAttribute('aria-label') ||
      button.getAttribute('title') ||
      '',
  );

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  useEnvMock.mockReturnValue({ envConfig: {}, appService: { isMobile: false } });
  h.viewSettings = { enableAnnotationQuickActions: false };
  setViewport(1440, 900);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useEnvMock.mockReset();
  h.toggleNotebook.mockReset();
  h.toggleTranslation.mockReset();
  h.setSideBarBookKey.mockReset();
});

describe('HeaderBar left cluster', () => {
  it('keeps sidebar, library, bookmark, translation and manga in that order', () => {
    const { container } = renderHeader();
    const start = container.querySelector('.header-tools-start') as HTMLElement;

    expect(buttonNames(start)).toEqual([
      'sidebar-toggler',
      'Go to Library',
      'bookmark-toggler',
      'translation-toggler',
      'manga-toggler',
    ]);
  });

  it('puts the annotation action last when quick actions are on', () => {
    h.viewSettings = { enableAnnotationQuickActions: true, annotationQuickAction: null };
    const { container } = renderHeader();
    const start = container.querySelector('.header-tools-start') as HTMLElement;

    expect(buttonNames(start)).toEqual([
      'sidebar-toggler',
      'Go to Library',
      'bookmark-toggler',
      'translation-toggler',
      'manga-toggler',
      'Enable Quick Action on Selection',
    ]);
  });
});

describe('HeaderBar right cluster', () => {
  it('renders only the more menu toggle and close', () => {
    const { container } = renderHeader();
    const end = container.querySelector('.header-tools-end') as HTMLElement;
    const toolbarButtons = Array.from(end.querySelectorAll('button')).filter(
      (button) => button.getAttribute('role') !== 'menuitem',
    );

    expect(toolbarButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'View Options',
      'Close Book',
    ]);
  });

  it('no longer renders the folded tools as header icons', () => {
    renderHeader();

    for (const name of ['翻译专家', '问书', '排版', '想法', 'Notebook']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });
});

describe('HeaderBar more menu', () => {
  it('lists the folded tools with an aria-label each', () => {
    renderHeader();

    const rows: Array<[string, string]> = [
      ['译文设置', '选择译员与译文样式'],
      ['问书', '就当前内容向 AI 提问'],
      ['排版', '调整正文的字体与版式'],
      ['想法', '记录并整理阅读中的灵感'],
      ['Notebook', '打开本书的笔记本'],
    ];

    for (const [name, description] of rows) {
      const row = screen.getByRole('menuitem', { name });
      expect(row.getAttribute('aria-label')).toBe(name);
      expect(row.textContent).toContain(description);
    }
  });

  it('opens the typeset drawer from its row', () => {
    renderHeader();
    const panel = screen.getByTestId('typeset-panel');
    expect(panel.getAttribute('data-open')).toBe('false');

    fireEvent.click(screen.getByRole('menuitem', { name: '排版' }));

    expect(panel.getAttribute('data-open')).toBe('true');
  });

  it('still toggles the notebook from its row', () => {
    renderHeader();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Notebook' }));

    expect(h.setSideBarBookKey).toHaveBeenCalledWith('book-1');
    expect(h.toggleNotebook).toHaveBeenCalledTimes(1);
  });

  it('opens the translation expert from 译文设置, not from an icon', () => {
    renderHeader();
    const panel = screen.getByTestId('translation-expert-panel');

    fireEvent.click(screen.getByRole('menuitem', { name: '译文设置' }));

    expect(panel.getAttribute('data-open')).toBe('true');
  });
});
