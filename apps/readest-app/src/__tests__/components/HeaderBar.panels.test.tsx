import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HeaderBar from '@/app/reader/components/HeaderBar';
import { DropdownProvider } from '@/context/DropdownContext';

/**
 * The `…` menu's drawers, exercised through the real Dropdown.
 *
 * The regression this guards: a dropdown unmounts its children when it closes,
 * and every row is transient (it closes the menu on click). Rendering the
 * panels inside that subtree made every row a no-op — the panel opened and was
 * torn down in the same click. `HeaderBar.cluster.test.tsx` mocks the Dropdown
 * open, so it cannot see that; this suite does not mock it.
 */

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const h = vi.hoisted(() => ({
  toggleNotebook: vi.fn(),
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
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: vi.fn(),
    releaseBackKeyInterception: vi.fn(),
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

// The left-cluster icons have their own tests; the drawers are stubbed so a
// row's effect is observable as `data-open`.
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
    <DropdownProvider>
      <HeaderBar
        bookKey='book-1'
        bookTitle='Book'
        isTopLeft={false}
        isHoveredAnim={false}
        gridInsets={insets}
        screenInsets={insets}
        onCloseBook={vi.fn()}
        onGoToLibrary={vi.fn()}
      />
    </DropdownProvider>,
  );

const toggleMenu = () =>
  fireEvent.click(screen.getByRole('button', { name: 'View Options' }));

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
  h.setSideBarBookKey.mockReset();
});

describe('HeaderBar more menu drawers', () => {
  it('opens the ask panel from its row and keeps it after the menu closes', () => {
    renderHeader();
    const panel = screen.getByTestId('ask-local-panel');
    expect(panel.getAttribute('data-open')).toBe('false');

    toggleMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '问书' }));

    expect(screen.getByTestId('ask-local-panel').getAttribute('data-open')).toBe('true');
    // The row is transient, so the menu it lived in is mounted no more...
    expect(screen.queryByRole('menuitem', { name: '问书' })).toBeNull();
    // ...and the panel the row opened is still there.
    expect(screen.getByTestId('ask-local-panel').getAttribute('data-open')).toBe('true');
  });

  it('mounts the opened panel outside the dropdown subtree', () => {
    renderHeader();

    toggleMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '排版' }));

    const panel = screen.getByTestId('typeset-panel');
    expect(panel.getAttribute('data-open')).toBe('true');
    expect(document.querySelector('.dropdown-container')?.contains(panel)).toBe(false);
    expect(panel.parentElement).toBe(document.body);
  });

  it('keeps the ideas panel open when the menu is closed by its toggle', () => {
    renderHeader();

    toggleMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '想法' }));
    expect(screen.getByTestId('ideas-panel').getAttribute('data-open')).toBe('true');

    // The row already closed the menu. Reopen it and close it by the toggle:
    // a closed menu must not take the open drawer with it.
    toggleMenu();
    toggleMenu();
    expect(screen.queryByRole('menuitem', { name: '想法' })).toBeNull();
    expect(screen.getByTestId('ideas-panel').getAttribute('data-open')).toBe('true');
  });

  it('opens the translation expert from its row through the real dropdown', () => {
    renderHeader();
    const panel = screen.getByTestId('translation-expert-panel');

    toggleMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '译文设置' }));

    expect(panel.getAttribute('data-open')).toBe('true');
    expect(screen.queryByRole('menuitem', { name: '译文设置' })).toBeNull();
  });

  it('still toggles the notebook from its row', () => {
    renderHeader();

    toggleMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Notebook' }));

    expect(h.setSideBarBookKey).toHaveBeenCalledWith('book-1');
    expect(h.toggleNotebook).toHaveBeenCalledTimes(1);
  });
});
