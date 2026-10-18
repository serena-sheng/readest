'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MdOutlineQuestionAnswer } from 'react-icons/md';

import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Button from '@/components/Button';
import AskLocalPanel from './AskLocalPanel';

interface AskLocalTogglerProps {
  bookKey: string;
  title: string;
}

const AskLocalToggler: React.FC<AskLocalTogglerProps> = ({ bookKey, title }) => {
  const _ = useTranslation();
  const { getView } = useReaderStore();
  const iconSize18 = useResponsiveSize(18);
  const [isOpen, setIsOpen] = useState(false);
  const [selection, setSelection] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const handleToggle = () => {
    if (!isOpen) {
      const docs = getView(bookKey)?.renderer.getContents() ?? [];
      setSelection(
        docs.reduce((text, { doc }) => text || (doc?.getSelection()?.toString().trim() ?? ''), ''),
      );
    }
    setIsOpen(!isOpen);
  };

  return (
    <>
      <Button
        icon={<MdOutlineQuestionAnswer size={iconSize18} className='fill-base-content' />}
        onClick={handleToggle}
        label={_('问书')}
      />
      {mounted &&
        createPortal(
          <AskLocalPanel
            title={title}
            selection={selection}
            open={isOpen}
            onClose={() => setIsOpen(false)}
          />,
          document.body,
        )}
    </>
  );
};

export default AskLocalToggler;
