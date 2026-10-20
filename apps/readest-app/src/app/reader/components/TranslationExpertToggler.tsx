'use client';

import React from 'react';
import { MdTranslate } from 'react-icons/md';

import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Button from '@/components/Button';
import { useTranslationExpertPanel } from '../hooks/useReaderTools';

interface TranslationExpertTogglerProps {
  bookKey: string;
  title: string;
}

const TranslationExpertToggler: React.FC<TranslationExpertTogglerProps> = ({ bookKey, title }) => {
  const iconSize18 = useResponsiveSize(18);
  const { toggle, panel } = useTranslationExpertPanel({ bookKey, title });

  return (
    <>
      <Button
        icon={<MdTranslate size={iconSize18} className='fill-base-content' />}
        onClick={toggle}
        label='翻译专家'
      />
      {panel}
    </>
  );
};

export default TranslationExpertToggler;
