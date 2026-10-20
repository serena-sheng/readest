'use client';

import clsx from 'clsx';
import React from 'react';

import { useEnv } from '@/context/EnvContext';
import Menu from '@/components/Menu';
import ReaderToolsMenuItems from './ReaderToolsMenuItems';
import ViewMenu from './ViewMenu';

interface ReaderMoreMenuProps {
  bookKey: string;
  onShowMetaHashDialog: () => void;
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

/**
 * The reader header's `…` menu: the tools that used to occupy their own icons
 * (译文设置 / 问书 / 排版 / 想法 / 笔记本) followed by the view options. One
 * container, one menu, so the right cluster is just this toggle plus close.
 */
const ReaderMoreMenu: React.FC<ReaderMoreMenuProps> = ({
  bookKey,
  onShowMetaHashDialog,
  setIsDropdownOpen,
}) => {
  const { appService } = useEnv();

  return (
    <Menu
      className={clsx(
        'view-menu dropdown-content dropdown-right no-triangle z-20 mt-1.5 border',
        'bgcolor-base-200 shadow-2xl',
      )}
      style={{ marginRight: appService?.isMobile || window.innerWidth < 640 ? '-36px' : 0 }}
      onCancel={() => setIsDropdownOpen?.(false)}
    >
      <ReaderToolsMenuItems bookKey={bookKey} setIsDropdownOpen={setIsDropdownOpen} />
      <hr aria-hidden='true' className='border-base-300 my-1' />
      <ViewMenu
        bookKey={bookKey}
        bare
        setIsDropdownOpen={setIsDropdownOpen}
        onShowMetaHashDialog={onShowMetaHashDialog}
      />
    </Menu>
  );
};

export default ReaderMoreMenu;
