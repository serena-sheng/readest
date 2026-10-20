import React from 'react';
import { RiQuillPenLine } from 'react-icons/ri';

import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Button from '@/components/Button';
import { useNotebookToggle } from '../hooks/useReaderTools';

interface NotebookTogglerProps {
  bookKey: string;
}

const NotebookToggler: React.FC<NotebookTogglerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const iconSize18 = useResponsiveSize(18);
  const { toggle } = useNotebookToggle(bookKey);

  return (
    <Button
      icon={<RiQuillPenLine size={iconSize18} className='text-base-content' />}
      onClick={toggle}
      label={_('Notebook')}
    ></Button>
  );
};

export default NotebookToggler;
