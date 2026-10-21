import type { BookFormat, PageInfo } from '@/types/book';
import { Insets } from '@/types/misc';

export interface FooterBarProps {
  bookKey: string;
  bookFormat: BookFormat;
  section?: PageInfo;
  pageinfo?: PageInfo;
  isHoveredAnim: boolean;
  gridInsets: Insets;
  /**
   * Renders as the quiet chrome's 40px bottom overlay: no border, no shadow,
   * no hover trigger of its own (the 2px hairline's strip opens it).
   */
  compact?: boolean;
}

export interface NavigationHandlers {
  onPrevPage: () => void;
  onNextPage: () => void;
  onPrevSection: () => void;
  onNextSection: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onProgressChange: (value: number) => void;
}

export interface FooterBarChildProps {
  bookKey: string;
  navigationHandlers: NavigationHandlers;
  progressFraction: number;
  progressValid: boolean;
  /** 1-based page position and page count, when the book has a valid one. */
  pageNumber?: { current: number; total: number } | null;
  gridInsets: Insets;
  actionTab: string;
  forceMobileLayout: boolean;
  onSetActionTab: (tab: string) => void;
  onSpeakText: () => void;
}
