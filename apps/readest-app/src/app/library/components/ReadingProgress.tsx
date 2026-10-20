import type React from 'react';
import { memo, useMemo } from 'react';
import type { Book } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import {
  getDisplayedTimeRemaining,
  getProgressPercentage,
  formatTimeLeft,
} from '../utils/libraryUtils';
import { useMedianPageDurationSecs } from '@/hooks/useMedianPageDurationSecs';

interface ReadingProgressProps {
  book: Book;
  showTimeRemaining: boolean;
}

const ReadingProgress: React.FC<ReadingProgressProps> = memo(
  ({ book, showTimeRemaining }) => {
    const _ = useTranslation();
    const progressPercentage = useMemo(() => getProgressPercentage(book), [book]);
    const medianPageDurationSecs = useMedianPageDurationSecs(book.hash) ?? undefined;
    const minutes = getDisplayedTimeRemaining(book, medianPageDurationSecs);
    const percentLabel =
      progressPercentage !== null && !Number.isNaN(progressPercentage)
        ? `${progressPercentage}%`
        : null;

    // One meta line carries both the state and the progress: the coloured 8px
    // badge that used to sit beside it outshouted the book title.
    let label: string | null = null;
    if (book.readingStatus === 'finished') {
      label = `${_('Finished')} · 100%`;
    } else if (book.readingStatus === 'abandoned') {
      label = percentLabel ? `${_('On hold')} · ${percentLabel}` : _('On hold');
    } else if (book.readingStatus === 'unread') {
      label = _('Unread');
    } else if (percentLabel) {
      const timeLeft = showTimeRemaining && minutes ? ` · ${formatTimeLeft(minutes, _)}` : '';
      label = `${_('Reading')} · ${percentLabel}${timeLeft}`;
    }

    return (
      <div
        className='text-base-content/55 flex min-w-0 items-center text-[13px] leading-[18px] font-normal tabular-nums'
        role='status'
        aria-label={label ?? undefined}
      >
        <span className='truncate'>{label}</span>
      </div>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.book.hash === nextProps.book.hash &&
      prevProps.book.updatedAt === nextProps.book.updatedAt &&
      prevProps.book.readingStatus === nextProps.book.readingStatus &&
      prevProps.showTimeRemaining === nextProps.showTimeRemaining
    );
  },
);

ReadingProgress.displayName = 'ReadingProgress';

export default ReadingProgress;
