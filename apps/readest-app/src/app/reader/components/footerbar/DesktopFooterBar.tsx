import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FaHeadphones } from 'react-icons/fa6';
import { MdMoreHoriz } from 'react-icons/md';
import { RiArrowLeftSLine, RiArrowRightSLine } from 'react-icons/ri';
import { RiArrowGoBackLine, RiArrowGoForwardLine } from 'react-icons/ri';
import { RiArrowLeftDoubleLine, RiArrowRightDoubleLine } from 'react-icons/ri';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import type { FooterBarChildProps } from './types';
import { getNavigationIcon } from './utils';
import Button from '@/components/Button';
import Dropdown from '@/components/Dropdown';
import Menu from '@/components/Menu';
import MenuItem from '@/components/MenuItem';
import PageJumpInput from './PageJumpInput';

// Below this the desktop bar is still what shows (the mobile bar takes over at
// 640), but there is no room for three groups plus the right group's icons, so
// the right group folds into the overflow menu.
const NARROW_FOOTER_WIDTH = 720;

const DesktopFooterBar: React.FC<FooterBarChildProps> = ({
  bookKey,
  gridInsets,
  progressValid,
  progressFraction,
  pageNumber,
  navigationHandlers,
  forceMobileLayout,
  onSpeakText,
}) => {
  const _ = useTranslation();
  const { hoveredBookKey, getView, getViewState, getViewSettings } = useReaderStore();
  const view = getView(bookKey);
  const viewState = getViewState(bookKey);
  const viewSettings = getViewSettings(bookKey);

  const [progressValue, setProgressValue] = React.useState(
    progressValid ? progressFraction * 100 : 0,
  );

  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);

  const rangeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (hoveredBookKey !== bookKey) {
      if (rangeInputRef.current && document.activeElement === rangeInputRef.current) {
        rangeInputRef.current.blur();
      }
    }
  }, [hoveredBookKey, bookKey]);

  useEffect(() => {
    if (progressValid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProgressValue(progressFraction * 100);
    }
  }, [progressValid, progressFraction]);

  const handleProgressChange = useCallback(
    (value: number) => {
      setProgressValue(value);
      navigationHandlers.onProgressChange(value);
    },
    [navigationHandlers],
  );

  const isMobile = window.innerWidth < 640 || window.innerHeight < 640;
  const isNarrow = windowWidth < NARROW_FOOTER_WIDTH;
  const showPaginationButtons = !viewSettings?.showPaginationButtons;

  const goBackButton = (
    <Button
      icon={getNavigationIcon(viewSettings?.rtl, <RiArrowGoBackLine />, <RiArrowGoForwardLine />)}
      onClick={navigationHandlers.onGoBack}
      label={_('Go Back')}
      disabled={!view?.history.canGoBack}
    />
  );
  const goForwardButton = (
    <Button
      icon={getNavigationIcon(viewSettings?.rtl, <RiArrowGoForwardLine />, <RiArrowGoBackLine />)}
      onClick={navigationHandlers.onGoForward}
      label={_('Go Forward')}
      disabled={!view?.history.canGoForward}
    />
  );
  const speakButton = (
    <Button
      icon={<FaHeadphones className={viewState?.ttsEnabled ? 'text-primary' : ''} />}
      onClick={onSpeakText!}
      label={_('Speak')}
    />
  );

  // The page position reads as a position, not as a pacing estimate: fixed
  // layout books (CBZ, PDF) have no chapter pace, so the footer never adds a
  // "left in book" minutes label next to it.
  const pageCountLabel = pageNumber
    ? _('Page {{current}} of {{total}}', {
        current: pageNumber.current,
        total: pageNumber.total,
      })
    : '';
  const pageCount = pageCountLabel ? (
    <span
      data-testid='footer-page-count'
      className='text-base-content/70 shrink-0 text-[13px] tabular-nums whitespace-nowrap'
    >
      {pageCountLabel}
    </span>
  ) : null;

  return (
    <div
      className={clsx('hidden h-8 w-full items-center ps-4 pe-2', !forceMobileLayout && 'sm:flex')}
      style={{
        bottom: isMobile ? `${gridInsets.bottom * 0.33}px` : '0px',
      }}
    >
      {/* Same column as the header's content row, so the progress bar and the
        page count sit under the toolbar instead of the window's edges. */}
      <div className='mx-auto flex h-full w-[var(--reader-measure)] items-center justify-between gap-x-4'>
        {/* Left group: turning is one cluster, with the progress percentage it
          acts on between the backward and forward pairs. */}
        <div data-testid='footer-left' className='flex shrink-0 items-center gap-1'>
          {showPaginationButtons && (
            <Button
              icon={getNavigationIcon(
                viewSettings?.rtl,
                <RiArrowLeftDoubleLine />,
                <RiArrowRightDoubleLine />,
              )}
              onClick={navigationHandlers.onPrevSection}
              label={_('Previous Section')}
            />
          )}
          {showPaginationButtons && (
            <Button
              icon={getNavigationIcon(
                viewSettings?.rtl,
                <RiArrowLeftSLine />,
                <RiArrowRightSLine />,
              )}
              onClick={navigationHandlers.onPrevPage}
              label={_('Previous Page')}
            />
          )}
          <PageJumpInput bookKey={bookKey} showPercentage className='text-[13px]' />
          {showPaginationButtons && (
            <Button
              icon={getNavigationIcon(
                viewSettings?.rtl,
                <RiArrowRightSLine />,
                <RiArrowLeftSLine />,
              )}
              onClick={navigationHandlers.onNextPage}
              label={_('Next Page')}
            />
          )}
          {showPaginationButtons && (
            <Button
              icon={getNavigationIcon(
                viewSettings?.rtl,
                <RiArrowRightDoubleLine />,
                <RiArrowLeftDoubleLine />,
              )}
              onClick={navigationHandlers.onNextSection}
              label={_('Next Section')}
            />
          )}
        </div>

        {/* Middle group: a fixed-width track between the two clusters, so the
          page buttons stay at the edges instead of being pushed apart by the
          slider growing to fill the bar. */}
        <div
          data-testid='footer-middle'
          className='flex min-w-0 flex-1 items-center justify-center px-6'
        >
          <input
            ref={rangeInputRef}
            type='range'
            className='text-base-content mx-auto w-[min(480px,40%)] min-w-0'
            min={0}
            max={100}
            aria-label={_('Jump to Location')}
            value={progressValue}
            onChange={(e) => handleProgressChange(parseInt(e.target.value, 10))}
          />
        </div>

        {/* Right group: position first, then the actions that act on the whole
          book rather than the page. */}
        <div data-testid='footer-right' className='flex shrink-0 items-center gap-2'>
          {isNarrow ? (
            <Dropdown
              label={_('More')}
              className='dropdown-top'
              buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0'
              toggleButton={<MdMoreHoriz />}
            >
              <Menu className='dropdown-content no-triangle z-20 mb-2 shadow-2xl'>
                {pageCount && <div className='px-3 py-2'>{pageCount}</div>}
                <MenuItem
                  label={_('Speak')}
                  Icon={<FaHeadphones />}
                  transient
                  onClick={onSpeakText!}
                />
                <MenuItem
                  label={_('Go Back')}
                  Icon={RiArrowGoBackLine}
                  disabled={!view?.history.canGoBack}
                  transient
                  onClick={navigationHandlers.onGoBack}
                />
                <MenuItem
                  label={_('Go Forward')}
                  Icon={RiArrowGoForwardLine}
                  disabled={!view?.history.canGoForward}
                  transient
                  onClick={navigationHandlers.onGoForward}
                />
              </Menu>
            </Dropdown>
          ) : (
            <>
              {pageCount}
              {speakButton}
              {goBackButton}
              {goForwardButton}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DesktopFooterBar;
