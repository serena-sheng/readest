import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Book } from '@/types/book';
import LibraryHeader from '@/app/library/components/LibraryHeader';
import { DEFAULT_BOOK_SEARCH_CONFIG } from '@/services/constants';

const store = vi.hoisted(() => ({ books: [] as Book[] }));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    systemUIVisible: false,
    statusBarHeight: 0,
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    isIPhoneDuo: false,
  }),
}));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({ currentBookshelf: store.books }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (text: string, values?: Record<string, unknown>) =>
    text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values?.[key] ?? '')),
}));
vi.mock('@/hooks/useTrafficLight', () => ({
  useTrafficLight: () => ({ isTrafficLightVisible: false }),
}));
vi.mock('@/hooks/useShortcuts', () => ({ default: () => {} }));
vi.mock('@/app/library/components/SettingsMenu', () => ({ default: () => null }));
vi.mock('@/app/library/components/ImportMenu', () => ({ default: () => null }));
vi.mock('@/app/library/components/ViewMenu', () => ({ default: () => null }));

const noop = () => {};

const renderHeader = () =>
  render(
    <LibraryHeader
      isSelectMode={false}
      isSelectAll={false}
      searchQuery=''
      searchTarget='books'
      searchConfig={DEFAULT_BOOK_SEARCH_CONFIG}
      onPullLibrary={noop}
      onImportBooksFromFiles={noop}
      onOpenCatalogManager={noop}
      onOpenFeeds={noop}
      onToggleSelectMode={noop}
      onSelectAll={noop}
      onDeselectAll={noop}
      onSearchConfigChange={noop}
      onSearchQueryChange={noop}
      onSearchTargetChange={noop}
    />,
  );

beforeEach(() => {
  store.books = Array.from({ length: 5 }, (_, index) => ({
    hash: `book-${index}`,
    title: `Book ${index}`,
    author: 'Author',
    format: 'EPUB' as const,
    createdAt: index,
    updatedAt: index,
  }));
});
afterEach(cleanup);

describe('library header title', () => {
  it('renders the page title as the header heading', () => {
    renderHeader();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Library');
  });

  it('shows the book count beside the title', () => {
    renderHeader();
    expect(screen.getByText('5 books')).toBeTruthy();
  });

  it('caps the search field at 420px and leaves the scope to a text control', () => {
    renderHeader();
    const input = screen.getByRole('textbox');
    expect(input.parentElement?.className).toContain('max-w-[420px]');
    expect(input.className).toContain('h-9');
    expect(input.className).toContain('bg-base-100');
    expect(screen.getByRole('button', { name: 'Search Scope' }).textContent).toContain('Title');
  });
});
