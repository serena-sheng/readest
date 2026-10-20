'use client';

import React from 'react';
import { MdOutlineQuestionAnswer } from 'react-icons/md';

import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Button from '@/components/Button';
import { useAskLocalPanel } from '../hooks/useReaderTools';

interface AskLocalTogglerProps {
  bookKey: string;
  title: string;
}

const AskLocalToggler: React.FC<AskLocalTogglerProps> = ({ bookKey, title }) => {
  const _ = useTranslation();
  const iconSize18 = useResponsiveSize(18);
  const { toggle, panel } = useAskLocalPanel({ bookKey, title });

  return (
    <>
      <Button
        icon={<MdOutlineQuestionAnswer size={iconSize18} className='fill-base-content' />}
        onClick={toggle}
        label={_('问书')}
      />
      {panel}
    </>
  );
};

export default AskLocalToggler;
