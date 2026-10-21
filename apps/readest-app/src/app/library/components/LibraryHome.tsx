'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MdSearch } from 'react-icons/md';

import type { Book } from '@/types/book';
import { useTranslation, type TranslationFunc } from '@/hooks/useTranslation';
import { useThemeStore } from '@/store/themeStore';
import { formatAuthors } from '@/utils/book';
import BookCover from '@/components/BookCover';
import {
  getDisplayedTimeRemaining,
  getProgressPercentage,
  selectRecentShelfBooks,
} from '../utils/libraryUtils';

/** How many rows the "接下来" column shows. */
export const NEXT_UP_BOOK_COUNT = 7;
/** How many covers the horizontal shelf shows. */
export const HOME_SHELF_BOOK_COUNT = 12;

const liveBooks = (books: Book[]): Book[] => books.filter((book) => !book.deletedAt);

/**
 * The book on the desk: the one the reader touched most recently and has not
 * finished. When nothing is in progress the newest unfinished book stands in,
 * so the desk is not empty while the library is not.
 */
export const selectNowReading = (books: Book[]): Book | undefined => {
  const visible = liveBooks(books);
  const inProgress = selectRecentShelfBooks(visible, 1)[0];
  if (inProgress) return inProgress;
  return [...visible]
    .filter((book) => book.readingStatus !== 'finished')
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
};

/** The queue beside the desk: the most recently touched books after the desk. */
export const selectNextUpBooks = (
  books: Book[],
  currentHash: string | undefined,
  count = NEXT_UP_BOOK_COUNT,
): Book[] =>
  liveBooks(books)
    .filter((book) => book.hash !== currentHash && book.readingStatus !== 'finished')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, count);

/** The books on the low shelf, newest first. */
export const selectShelfBooks = (
  books: Book[],
  count = HOME_SHELF_BOOK_COUNT,
): Book[] =>
  liveBooks(books)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, count);

const formatRemaining = (minutes: number, _: TranslationFunc): string => {
  if (minutes < 60) return _('{{minutes}}m left', { minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest
    ? _('{{hours}}h {{minutes}}m left', { hours, minutes: rest })
    : _('{{hours}}h left', { hours });
};

interface StudyCoverProps {
  book: Book;
  className?: string;
  onOpen: (book: Book) => void;
}

const StudyCover: React.FC<StudyCoverProps> = ({ book, className, onOpen }) => (
  <button
    type='button'
    onClick={() => onOpen(book)}
    aria-label={book.title}
    className={clsx(
      'eink:border-base-content relative block overflow-hidden rounded-cover eink:border',
      className,
    )}
  >
    <BookCover book={book} coverFit='crop' />
  </button>
);

export interface LibraryHomeProps {
  /** The library, tombstones included — the component filters them out. */
  books: Book[];
  onOpenBook: (book: Book) => void;
  /** "全部 N 本" — reveals the classic cover grid. */
  onShowAll: () => void;
  /** A submitted query; the grid renders the results. */
  onSearch: (query: string) => void;
  /** Import action for the empty state. */
  onImport?: () => void;
  /** The `⋯` toolbar actions; receives the button as the popup anchor. */
  onOpenMenu?: (anchor: HTMLElement) => void;
}

/**
 * The library's landing view: a quiet desk (the book being read), the queue
 * beside it, and a low shelf of recent covers. The cover grid is still there,
 * one click away — this view trades density for a single obvious next action.
 */
const LibraryHome: React.FC<LibraryHomeProps> = ({
  books,
  onOpenBook,
  onShowAll,
  onSearch,
  onImport,
  onOpenMenu,
}) => {
  const _ = useTranslation();
  const { safeAreaInsets } = useThemeStore();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);

  const visible = useMemo(() => liveBooks(books), [books]);
  const nowReading = useMemo(() => selectNowReading(visible), [visible]);
  const nextUp = useMemo(
    () => selectNextUpBooks(visible, nowReading?.hash),
    [visible, nowReading?.hash],
  );
  const shelf = useMemo(() => selectShelfBooks(visible), [visible]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  // ⌘K / Ctrl+K opens search from anywhere in the library.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery('');
    searchButtonRef.current?.focus();
  }, []);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const term = query.trim();
    if (!term) return;
    onSearch(term);
  };

  const progressPercentage = nowReading ? (getProgressPercentage(nowReading) ?? 0) : 0;
  const remainingMinutes = nowReading ? getDisplayedTimeRemaining(nowReading) : undefined;
  const currentPage = nowReading?.progress?.[0];

  return (
    <div
      className='study-home bg-study-canvas text-study-ink full-height overflow-y-auto'
      style={{ paddingTop: safeAreaInsets?.top ? `${safeAreaInsets.top}px` : undefined }}
    >
      {/* 1120px of content, 72px of margin: the column never touches the
          window edge, and on narrow screens the page falls back to a single
          stack instead of squeezing the desk. */}
      <div className='mx-auto flex min-h-full w-full max-w-[1264px] flex-col px-6 pb-16 pt-4 sm:px-[72px] sm:pt-6'>
        <header className='flex h-11 shrink-0 items-center justify-between gap-4'>
          <h1 className='text-[15px] leading-[22px] font-medium'>书房</h1>
          <div className='flex items-center gap-2'>
            {searchOpen ? (
              <form onSubmit={submitSearch} className='relative flex h-10 items-center'>
                <MdSearch className='text-study-ink/45 pointer-events-none absolute start-3 h-4 w-4' />
                <input
                  ref={searchInputRef}
                  type='search'
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') closeSearch();
                  }}
                  placeholder='书名、作者或划线'
                  aria-label={_('Search books, authors, or highlights')}
                  className='bg-study-chip placeholder:text-study-ink/40 h-10 w-[280px] rounded-control border-0 ps-9 pe-3 text-[15px] leading-[22px] outline-none focus:ring-1 focus:ring-study-ink/15'
                />
              </form>
            ) : (
              <button
                ref={searchButtonRef}
                type='button'
                onClick={() => setSearchOpen(true)}
                aria-label={_('Search')}
                title={_('Search')}
                className='hover:bg-study-chip flex h-8 w-8 items-center justify-center rounded-control transition-colors duration-200 ease-study'
              >
                <MdSearch className='h-4 w-4' />
              </button>
            )}
            {onOpenMenu && (
              <button
                type='button'
                onClick={(event) => onOpenMenu(event.currentTarget)}
                aria-label={_('More')}
                title={_('More')}
                className='hover:bg-study-chip flex h-8 w-8 items-center justify-center rounded-control text-[17px] leading-none transition-colors duration-200 ease-study'
              >
                ⋯
              </button>
            )}
          </div>
        </header>

        {visible.length === 0 ? (
          <div className='flex flex-1 flex-col items-start justify-center gap-4 pb-24'>
            <p className='font-serif text-section'>书房还空着</p>
            <p className='text-body text-study-ink/60'>导入第一本书，就能从这里接着读。</p>
            {onImport && (
              <button
                type='button'
                onClick={onImport}
                className='text-body underline decoration-study-ink/30 underline-offset-4 hover:decoration-study-ink'
              >
                导入书籍
              </button>
            )}
          </div>
        ) : (
          <>
            <div className='mt-16 grid grid-cols-1 gap-16 lg:grid-cols-[62fr_38fr] lg:gap-10'>
              <section aria-label='桌上这本' className='min-w-0'>
                {nowReading ? (
                  <>
                    <StudyCover
                      book={nowReading}
                      onOpen={onOpenBook}
                      className='shadow-cover eink:shadow-none aspect-[28/41] w-[240px] max-w-full'
                    />
                    <h2 className='mt-8 font-serif text-display text-balance break-words'>
                      {nowReading.title}
                    </h2>
                    <p className='text-body text-study-ink/60 mt-2'>
                      {formatAuthors(nowReading.author || nowReading.metadata?.author || '')}
                    </p>
                    <div
                      className='bg-study-ink/10 mt-6 h-px w-[240px] max-w-full'
                      role='presentation'
                    >
                      <div
                        className='bg-study-ink/55 h-px'
                        style={{ width: `${Math.min(100, Math.max(0, progressPercentage))}%` }}
                      />
                    </div>
                    <p className='text-meta text-study-ink/55 mt-3 tabular-nums'>
                      {[
                        currentPage ? `第 ${currentPage} 页` : null,
                        remainingMinutes ? `还剩 ${formatRemaining(remainingMinutes, _)}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <button
                      type='button'
                      onClick={() => onOpenBook(nowReading)}
                      className='text-body mt-5 inline-block underline decoration-study-ink/30 underline-offset-4 transition-colors duration-200 ease-study hover:decoration-study-ink'
                    >
                      继续阅读
                    </button>
                  </>
                ) : (
                  <p className='text-body text-study-ink/60'>挑一本书，从第一页开始。</p>
                )}
              </section>

              <section aria-label='接下来' className='min-w-0'>
                <h2 className='text-body text-study-ink/60'>接下来</h2>
                <ul className='mt-4'>
                  {nextUp.map((book) => (
                    <li key={book.hash} className='hairline-b last:border-b-0'>
                      <button
                        type='button'
                        onClick={() => onOpenBook(book)}
                        className='group flex h-10 w-full items-center justify-between gap-4 text-start'
                      >
                        <span className='text-body text-study-ink/60 group-hover:text-study-ink truncate transition-colors duration-200 ease-study'>
                          {book.title}
                        </span>
                        <span className='text-meta text-study-ink/45 group-hover:text-study-ink/80 shrink-0 truncate transition-colors duration-200 ease-study'>
                          {formatAuthors(book.author || book.metadata?.author || '')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <section aria-label='书架' className='mt-16'>
              <div className='flex items-end gap-6'>
                <div className='no-scrollbar flex min-w-0 flex-1 items-end gap-4 overflow-x-auto pb-1'>
                  {shelf.map((book) => (
                    <StudyCover
                      key={book.hash}
                      book={book}
                      onOpen={onOpenBook}
                      className='aspect-[28/41] w-[96px] shrink-0'
                    />
                  ))}
                </div>
                <button
                  type='button'
                  onClick={onShowAll}
                  className='text-meta text-study-ink/60 hover:text-study-ink mb-1 shrink-0 whitespace-nowrap transition-colors duration-200 ease-study'
                >
                  全部 {visible.length} 本 →
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default LibraryHome;
