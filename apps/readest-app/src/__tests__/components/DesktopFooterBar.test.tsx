import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, within } from '@testing-library/react';
import DesktopFooterBar from '@/app/reader/components/footerbar/DesktopFooterBar';
import type { FooterBarChildProps } from '@/app/reader/components/footerbar/types';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, values?: Record<string, string | number>) =>
    s.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values?.[key] ?? '')),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    hoveredBookKey: 'book1',
    getView: () => ({ history: { canGoBack: true, canGoForward: true } }),
    getViewState: () => ({ ttsEnabled: false }),
    getViewSettings: () => ({ rtl: false, showPaginationButtons: false }),
  }),
}));

vi.mock('@/app/reader/components/footerbar/PageJumpInput', () => ({
  default: () => <span data-testid='page-jump' />,
}));

const props = (overrides: Partial<FooterBarChildProps> = {}): FooterBarChildProps => ({
  bookKey: 'book1',
  progressValid: true,
  progressFraction: 0.67,
  pageNumber: { current: 3, total: 12 },
  gridInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  actionTab: '',
  forceMobileLayout: false,
  onSetActionTab: () => {},
  onSpeakText: () => {},
  navigationHandlers: {
    onPrevPage: () => {},
    onNextPage: () => {},
    onPrevSection: () => {},
    onNextSection: () => {},
    onGoBack: () => {},
    onGoForward: () => {},
    onProgressChange: () => {},
  },
  ...overrides,
});

const setWindowWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
};

beforeEach(() => setWindowWidth(1024));
afterEach(() => {
  cleanup();
  setWindowWidth(1024);
});

describe('DesktopFooterBar', () => {
  it('lays the bar out as three groups between the bar edges', () => {
    const { getByTestId } = render(<DesktopFooterBar {...props()} />);
    const bar = getByTestId('footer-left').parentElement!;
    expect(bar.className).toContain('justify-between');
    expect(within(getByTestId('footer-left')).getByLabelText('Previous Page')).toBeTruthy();
    expect(within(getByTestId('footer-left')).getByTestId('page-jump')).toBeTruthy();
    expect(within(getByTestId('footer-middle')).getByRole('slider')).toBeTruthy();
    expect(within(getByTestId('footer-right')).getByTestId('footer-page-count')).toBeTruthy();
  });

  it('gives the slider a capped width instead of letting it fill the bar', () => {
    const { getByRole } = render(<DesktopFooterBar {...props()} />);
    const slider = getByRole('slider');
    expect(slider.className).toContain('w-[min(480px,40%)]');
    expect(slider.className).not.toContain('flex-1');
    expect(getByRole('slider').parentElement!.className).toContain('px-6');
  });

  it('shows the 1-based page position and the page count', () => {
    const { getByTestId } = render(
      <DesktopFooterBar {...props({ pageNumber: { current: 3, total: 12 } })} />,
    );
    expect(getByTestId('footer-page-count').textContent).toBe('Page 3 of 12');
  });

  it('shows no reading-time estimate for a fixed-layout book', () => {
    const { getByTestId, queryByText } = render(
      <DesktopFooterBar {...props({ bookKey: 'comic1', pageNumber: { current: 3, total: 12 } })} />,
    );
    expect(getByTestId('footer-page-count').textContent).toBe('Page 3 of 12');
    expect(queryByText(/left/i)).toBeNull();
    expect(queryByText(/remaining/i)).toBeNull();
  });

  it('orders the right group as position, speak, undo, redo', () => {
    const { getByTestId } = render(<DesktopFooterBar {...props()} />);
    const right = getByTestId('footer-right');
    const labels = Array.from(right.querySelectorAll('button')).map((button) =>
      button.getAttribute('aria-label'),
    );
    expect(labels).toEqual(['Speak', 'Go Back', 'Go Forward']);
    expect(right.firstElementChild!.getAttribute('data-testid')).toBe('footer-page-count');
  });

  it('folds the right group into an overflow menu on a narrow window', () => {
    setWindowWidth(700);
    const { getByTestId, getByRole, queryByRole } = render(<DesktopFooterBar {...props()} />);
    expect(getByRole('button', { name: 'More' })).toBeTruthy();
    expect(queryByRole('button', { name: 'Go Back' })).toBeNull();
    expect(queryByRole('button', { name: 'Speak' })).toBeNull();
    expect(getByTestId('footer-right')).toBeTruthy();
  });
});
