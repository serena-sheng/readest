import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LibraryHome, { type LibraryHomeProps } from '@/app/library/components/LibraryHome';
import type { Book } from '@/types/book';
import type { BookMetadata } from '@/libs/document';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 } }),
}));

// BookCover reaches for next/image and the library store; the study view only
// needs a title-sized box here.
vi.mock('@/components/BookCover', () => ({
  default: ({ book }: { book: Book }) => <div data-testid={`cover-${book.hash}`} />,
}));

const createMockBook = (
  overrides: Partial<Omit<Book, 'metadata'> & { metadata?: Partial<BookMetadata> }> = {},
): Book => ({
  hash: `hash-${Math.random().toString(36).slice(2, 11)}`,
  format: 'EPUB',
  title: 'Test Book',
  author: 'Test Author',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  progress: [10, 100],
  readingStatus: 'reading',
  ...overrides,
  metadata: { ...overrides.metadata } as BookMetadata,
});

const renderHome = (books: Book[], overrides: Partial<LibraryHomeProps> = {}) => {
  const props = {
    books,
    onOpenBook: vi.fn(),
    onShowAll: vi.fn(),
    onSearch: vi.fn(),
    onImport: vi.fn(),
    ...overrides,
  };
  const view = render(<LibraryHome {...props} />);
  return { ...view, props };
};

afterEach(() => {
  cleanup();
});

describe('LibraryHome', () => {
  it('renders the three study sections once the library has books', () => {
    const { container } = renderHome([
      createMockBook({ hash: 'a', title: '夜航西飞', updatedAt: 2000 }),
      createMockBook({ hash: 'b', title: '看不见的城市', updatedAt: 1000 }),
    ]);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('书房');
    expect(screen.getByRole('region', { name: '桌上这本' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '接下来' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '书架' })).toBeTruthy();
    expect(container.querySelector('.study-home')).not.toBeNull();
  });

  it('puts the most recently read book on the desk and continues it', () => {
    const older = createMockBook({ hash: 'older', title: '旧书', updatedAt: 1000 });
    const newer = createMockBook({ hash: 'newer', title: '新读', updatedAt: 5000 });

    const { props } = renderHome([older, newer]);
    const desk = screen.getByRole('region', { name: '桌上这本' });

    expect(within(desk).getByRole('heading', { level: 2 }).textContent).toBe('新读');
    fireEvent.click(within(desk).getByRole('button', { name: '继续阅读' }));

    expect(props.onOpenBook).toHaveBeenCalledWith(newer);
  });

  it('lists at most seven upcoming books', () => {
    const books = Array.from({ length: 9 }, (_, index) =>
      createMockBook({
        hash: `book-${index}`,
        title: `Book ${index}`,
        updatedAt: 1000 + index,
        progress: [1, 100],
      }),
    );

    renderHome(books);
    const nextUp = screen.getByRole('region', { name: '接下来' });

    expect(within(nextUp).getAllByRole('listitem')).toHaveLength(7);
  });

  it('counts the library in the "all books" link and shows the grid', () => {
    const { props } = renderHome([createMockBook({ hash: 'a' }), createMockBook({ hash: 'b' })]);

    const allBooks = screen.getByRole('button', { name: '全部 2 本 →' });
    fireEvent.click(allBooks);

    expect(props.onShowAll).toHaveBeenCalledTimes(1);
  });

  it('keeps the shelf to twelve covers', () => {
    const books = Array.from({ length: 14 }, (_, index) =>
      createMockBook({ hash: `book-${index}`, updatedAt: 1000 + index }),
    );

    const { container } = renderHome(books);
    const shelf = screen.getByRole('region', { name: '书架' });

    // One cover on the desk plus twelve on the shelf.
    expect(container.querySelectorAll('[data-testid^="cover-"]').length).toBe(13);
    expect(within(shelf).getAllByRole('button')).toHaveLength(13); // 12 covers + the link
  });

  it('offers one sentence and a text button when the library is empty', () => {
    const { props } = renderHome([]);

    expect(screen.getByText('书房还空着')).toBeTruthy();
    expect(screen.queryByRole('region', { name: '桌上这本' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '导入书籍' }));
    expect(props.onImport).toHaveBeenCalledTimes(1);
  });

  it('expands the search field on click and submits the query', () => {
    const { props } = renderHome([createMockBook({ hash: 'a' })], { onSearch: vi.fn() });

    expect(screen.queryByRole('searchbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    const input = screen.getByRole('searchbox');
    expect(input.getAttribute('placeholder')).toBe('书名、作者或划线');

    fireEvent.change(input, { target: { value: '夜航' } });
    fireEvent.submit(input.closest('form')!);

    expect(props.onSearch).toHaveBeenCalledWith('夜航');
  });

  it('opens search with the keyboard shortcut', () => {
    renderHome([createMockBook({ hash: 'a' })]);

    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    expect(screen.getByRole('searchbox')).toBeTruthy();
  });
});
