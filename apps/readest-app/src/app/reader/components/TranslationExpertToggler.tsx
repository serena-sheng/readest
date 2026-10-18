'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MdTranslate } from 'react-icons/md';

import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Button from '@/components/Button';
import { eventDispatcher } from '@/utils/event';
import TranslationExpertPanel from './TranslationExpertPanel';

interface TranslationExpertTogglerProps {
  bookKey: string;
  title: string;
}

const TranslationExpertToggler: React.FC<TranslationExpertTogglerProps> = ({ bookKey, title }) => {
  const iconSize18 = useResponsiveSize(18);
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const handleToggle = () => {
    // All three drawers share the same fixed right-hand slot. Opening this one
    // announces through the channels the ask and ideas panels already listen
    // to, so only one drawer is ever visible.
    if (!isOpen) {
      eventDispatcher.dispatch('ask-local-close', { bookKey });
      eventDispatcher.dispatch('ideas-close', { bookKey });
    }
    setIsOpen(!isOpen);
  };

  return (
    <>
      <Button
        icon={<MdTranslate size={iconSize18} className='fill-base-content' />}
        onClick={handleToggle}
        label='翻译专家'
      />
      {mounted &&
        createPortal(
          <TranslationExpertPanel
            bookKey={bookKey}
            title={title}
            open={isOpen}
            onClose={() => setIsOpen(false)}
          />,
          document.body,
        )}
    </>
  );
};

export default TranslationExpertToggler;
