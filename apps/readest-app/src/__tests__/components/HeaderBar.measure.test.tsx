import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HeaderBar from '@/app/reader/components/HeaderBar';

// jsdom ships no ResizeObserver, and HeaderBar constructs one to track its own
// width. Same stub as HeaderBar.test.tsx.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

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
  useSidebarStore: () => ({ isSideBarVisible: false, getIsSideBarVisible: () => false }),
}));
vi.mock('@/store/readerStore', () => {
  const state = {
    bookKeys: ['book-1'],
    hoveredBookKey: 'book-1',
    getView: () => null,
    getViewSettings: () => ({ enableAnnotationQuickActions: false }),
    setHoveredBookKey: vi.fn(),
    viewStates: {},
  };
  const useReaderStore = () => state;
  useReaderStore.getState = () => state;
  return { useReaderStore };
});
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => null, getConfig: () => null }),
}));
vi.mock('@/store/notebookStore', () => ({
  useNotebookStore: () => ({ isNotebookVisible: false, toggleNotebook: vi.fn() }),
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

vi.mock('@/app/reader/components/SidebarToggler', () => ({
  default: () => <button type='button'>sidebar-toggler</button>,
}));
vi.mock('@/app/reader/components/BookmarkToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/NotebookToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/TranslationToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/ViewMenu', () => ({ default: () => null }));
vi.mock('@/app/reader/components/TranslationExpertPanel', () => ({ default: () => null }));
vi.mock('@/app/reader/components/AskLocalPanel', () => ({ default: () => null }));
vi.mock('@/app/reader/components/TypesetPanel', () => ({ default: () => null }));
vi.mock('@/app/reader/components/IdeasPanel', () => ({ default: () => null }));
vi.mock('@/app/reader/components/SyncInfoDialog', () => ({ default: () => null }));
vi.mock('@/components/Dropdown', () => ({
  default: ({ label, toggleButton }: { label: string; toggleButton?: React.ReactNode }) => (
    <button type='button' aria-label={label}>
      {toggleButton}
    </button>
  ),
}));
vi.mock('@/components/WindowButtons', () => ({ default: () => null }));
vi.mock('@/components/ModalPortal', () => ({ default: () => null }));

const renderHeader = () =>
  render(
    <HeaderBar
      bookKey='book-1'
      bookTitle='Book'
      isTopLeft={false}
      isHoveredAnim={false}
      gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
      screenInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
      onCloseBook={vi.fn()}
      onGoToLibrary={vi.fn()}
    />,
  );

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
  useEnvMock.mockReturnValue({ envConfig: {}, appService: { isMobile: false } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useEnvMock.mockReset();
});

describe('HeaderBar measure', () => {
  it('keeps the bar full-width but centres its contents on the reader measure', () => {
    const { container } = renderHeader();
    const bar = container.querySelector('.header-bar');
    const row = bar?.firstElementChild as HTMLElement;

    expect(bar!.classList.contains('w-full')).toBe(true);
    expect(row).not.toBeNull();
    expect(row.classList.contains('w-[var(--reader-measure)]')).toBe(true);
    expect(row.classList.contains('mx-auto')).toBe(true);
    expect(row.querySelector('.header-tools-start')).not.toBeNull();
    expect(row.querySelector('.header-tools-end')).not.toBeNull();
  });

  it('uses the same gap in both clusters', () => {
    const { container } = renderHeader();
    const start = container.querySelector('.header-tools-start')!;
    const end = container.querySelector('.header-tools-end')!;

    expect(start.classList.contains('gap-x-1')).toBe(true);
    expect(end.classList.contains('gap-x-1')).toBe(true);
    expect(end.classList.contains('gap-x-4')).toBe(false);
  });
});
