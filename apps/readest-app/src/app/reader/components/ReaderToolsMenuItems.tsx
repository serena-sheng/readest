import React from 'react';
import { MdOutlineLightbulb, MdOutlineQuestionAnswer, MdTextFields, MdTranslate } from 'react-icons/md';
import { RiQuillPenLine } from 'react-icons/ri';

import { useTranslation } from '@/hooks/useTranslation';
import MenuItem from '@/components/MenuItem';
import { useNotebookToggle, useReaderToolsPanels } from '../hooks/useReaderTools';

interface ReaderToolsMenuItemsProps {
  bookKey: string;
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

/**
 * The reader tools that used to crowd the right side of the header. They now
 * live as rows in the `…` menu — icon, label and a one-line description.
 *
 * The rows only call the toggles from the header's `ReaderToolsProvider`: the
 * dropdown unmounts this subtree when it closes, so a panel rendered here
 * would disappear the moment the row that opened it closed the menu.
 */
const ReaderToolsMenuItems: React.FC<ReaderToolsMenuItemsProps> = ({
  bookKey,
  setIsDropdownOpen,
}) => {
  const _ = useTranslation();
  const tools = useReaderToolsPanels();
  const notebook = useNotebookToggle(bookKey);

  return (
    <>
      <MenuItem
        label='译文设置'
        ariaLabel='译文设置'
        description='选择译员与译文样式'
        Icon={MdTranslate}
        onClick={tools.translationExpert.toggle}
        transient
        setIsDropdownOpen={setIsDropdownOpen}
      />
      <MenuItem
        label={_('问书')}
        ariaLabel={_('问书')}
        description='就当前内容向 AI 提问'
        Icon={MdOutlineQuestionAnswer}
        onClick={tools.askLocal.toggle}
        transient
        setIsDropdownOpen={setIsDropdownOpen}
      />
      <MenuItem
        label='排版'
        ariaLabel='排版'
        description='调整正文的字体与版式'
        Icon={MdTextFields}
        onClick={tools.typeset.toggle}
        transient
        setIsDropdownOpen={setIsDropdownOpen}
      />
      <MenuItem
        label='想法'
        ariaLabel='想法'
        description='记录并整理阅读中的灵感'
        Icon={MdOutlineLightbulb}
        onClick={tools.ideas.toggle}
        transient
        setIsDropdownOpen={setIsDropdownOpen}
      />
      <MenuItem
        label={_('Notebook')}
        ariaLabel={_('Notebook')}
        description='打开本书的笔记本'
        Icon={RiQuillPenLine}
        onClick={notebook.toggle}
        transient
        setIsDropdownOpen={setIsDropdownOpen}
      />
    </>
  );
};

export default ReaderToolsMenuItems;
