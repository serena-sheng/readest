'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MdOutlineLightbulb } from 'react-icons/md';

import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Button from '@/components/Button';
import { eventDispatcher } from '@/utils/event';
import IdeasPanel from './IdeasPanel';

interface IdeasTogglerProps {
  bookKey: string;
  title: string;
}

const IdeasToggler: React.FC<IdeasTogglerProps> = ({ bookKey, title }) => {
  const iconSize18 = useResponsiveSize(18);
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // `ideas-close` is the shared-slot signal the expert drawer also listens to,
  // so it closes this panel without a second event name. Events this panel
  // dispatches itself carry `from: 'ideas'` and are ignored.
  useEffect(() => {
    const close = (event: CustomEvent) => {
      const detail = event.detail as { bookKey?: string; from?: string } | undefined;
      if (detail?.from === 'ideas') return;
      if (detail?.bookKey && detail.bookKey !== bookKey) return;
      setIsOpen(false);
    };
    eventDispatcher.on('ideas-close', close);
    return () => eventDispatcher.off('ideas-close', close);
  }, [bookKey]);

  const handleToggle = () => {
    // Both panels own the same fixed right-hand slot, so opening this one
    // closes the ask and expert drawers through the channels their togglers
    // already listen to.
    if (!isOpen) {
      eventDispatcher.dispatch('ask-local-close', { bookKey });
      eventDispatcher.dispatch('ideas-close', { bookKey, from: 'ideas' });
    }
    setIsOpen(!isOpen);
  };

  return (
    <>
      <Button
        icon={<MdOutlineLightbulb size={iconSize18} className='fill-base-content' />}
        onClick={handleToggle}
        label={'想法'}
      />
      {mounted &&
        createPortal(
          <IdeasPanel title={title} open={isOpen} onClose={() => setIsOpen(false)} />,
          document.body,
        )}
    </>
  );
};

export default IdeasToggler;
