'use client';

import React from 'react';
import { MdTextFields } from 'react-icons/md';

import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Button from '@/components/Button';
import { useTypesetPanel } from '../hooks/useReaderTools';

interface TypesetTogglerProps {
  bookKey: string;
  title: string;
}

const TypesetToggler: React.FC<TypesetTogglerProps> = ({ bookKey, title }) => {
  const iconSize18 = useResponsiveSize(18);
  const { toggle, panel } = useTypesetPanel({ bookKey, title });

  return (
    <>
      <Button
        icon={<MdTextFields size={iconSize18} className='fill-base-content' />}
        onClick={toggle}
        label='排版'
      />
      {panel}
    </>
  );
};

export default TypesetToggler;
