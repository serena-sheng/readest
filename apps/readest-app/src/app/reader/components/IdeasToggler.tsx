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

  const handleToggle = () => {
    // Both panels own the same fixed right-hand slot, so opening this one
    // closes the ask drawer through the channel its toggler already listens to.
    if (!isOpen) eventDispatcher.dispatch('ask-local-close', { bookKey });
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
