import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Book } from '@/types/book';
import BookItem from '@/app/library/components/BookItem';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (text: string, values?: Record<string, unknown>) =>
    text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values?.[key] ?? '')),
}));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/hooks/useMedianPageDurationSecs', () => ({
  useMedianPageDurationSecs: () => undefined,
}));
vi.mock('@/components/BookCover', () => ({ default: () => null }));

const baseBook: Book = {
  hash: 'hierarchy',
  title: 'Hierarchy',
  author: 'Author',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  progress: [1, 3],
};

const props = {
  mode: 'grid' as const,
  coverFit: 'crop' as const,
  isSelectMode: false,
  bookSelected: false,
  transferProgress: null,
  handleBookUpload: vi.fn(),
  handleBookDownload: vi.fn(),
  showBookDetailsModal: vi.fn(),
  showTimeRemaining: false,
};

afterEach(cleanup);

describe('library card information hierarchy', () => {
  it('drops the coloured status badge', () => {
    const { container } = render(
      <BookItem {...props} book={{ ...baseBook, readingStatus: 'finished' }} />,
    );
    expect(container.querySelector('.status-badge-finished')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Finished · 100%');
  });

  it('writes state and progress into one meta line', () => {
    const { rerender } = render(<BookItem {...props} book={baseBook} />);
    expect(screen.getByRole('status').textContent).toBe('Reading · 33%');

    rerender(<BookItem {...props} book={{ ...baseBook, readingStatus: 'unread' }} />);
    expect(screen.getByRole('status').textContent).toBe('Unread');

    rerender(<BookItem {...props} book={{ ...baseBook, readingStatus: 'abandoned' }} />);
    expect(screen.getByRole('status').textContent).toBe('On hold · 33%');
  });

  it('sets the title at 13/19 · 500 and the meta at 13/18 · 400', () => {
    const { container } = render(<BookItem {...props} book={baseBook} />);
    const title = container.querySelector('h4')!;
    expect(title.className).toContain('text-meta');
    expect(title.className).toContain('leading-[19px]');
    expect(title.className).toContain('font-medium');

    const meta = screen.getByRole('status');
    expect(meta.className).toContain('text-[13px]');
    expect(meta.className).toContain('leading-[18px]');
    expect(meta.className).toContain('font-normal');
    expect(meta.className).toContain('tabular-nums');
  });
});
