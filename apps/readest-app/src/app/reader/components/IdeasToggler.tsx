'use client';

import React from 'react';
import { MdOutlineLightbulb } from 'react-icons/md';

import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Button from '@/components/Button';
import { useIdeasPanel } from '../hooks/useReaderTools';

interface IdeasTogglerProps {
  bookKey: string;
  title: string;
}

const IdeasToggler: React.FC<IdeasTogglerProps> = ({ bookKey, title }) => {
  const iconSize18 = useResponsiveSize(18);
  const { toggle, panel } = useIdeasPanel({ bookKey, title });

  return (
    <>
      <Button
        icon={<MdOutlineLightbulb size={iconSize18} className='fill-base-content' />}
        onClick={toggle}
        label={'想法'}
      />
      {panel}
    </>
  );
};

export default IdeasToggler;
