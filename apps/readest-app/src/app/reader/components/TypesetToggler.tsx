'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MdTextFields } from 'react-icons/md';

import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Button from '@/components/Button';
import { eventDispatcher } from '@/utils/event';
import TypesetPanel from './TypesetPanel';

interface TypesetTogglerProps {
  bookKey: string;
  title: string;
}

const TypesetToggler: React.FC<TypesetTogglerProps> = ({ bookKey, title }) => {
  const iconSize18 = useResponsiveSize(18);
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const handleToggle = () => {
    // The ask, ideas and translation-expert drawers all sit in the same fixed
    // right-hand slot. Both announcement channels are dispatched so whichever
    // sibling is open yields before this one slides in.
    if (!isOpen) {
      eventDispatcher.dispatch('ask-local-close', { bookKey });
      eventDispatcher.dispatch('ideas-close', { bookKey });
    }
    setIsOpen(!isOpen);
  };

  return (
    <>
      <Button
        icon={<MdTextFields size={iconSize18} className='fill-base-content' />}
        onClick={handleToggle}
        label='排版'
      />
      {mounted &&
        createPortal(
          <TypesetPanel
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

export default TypesetToggler;
