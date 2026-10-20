import React from 'react';
import { MdOutlineLightbulb, MdOutlineQuestionAnswer, MdTextFields, MdTranslate } from 'react-icons/md';
import { RiQuillPenLine } from 'react-icons/ri';

import { useTranslation } from '@/hooks/useTranslation';
import MenuItem from '@/components/MenuItem';
import {
  useAskLocalPanel,
  useIdeasPanel,
  useNotebookToggle,
  useTranslationExpertPanel,
  useTypesetPanel,
} from '../hooks/useReaderTools';

interface ReaderToolsMenuItemsProps {
  bookKey: string;
  title: string;
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

/**
 * The reader tools that used to crowd the right side of the header. They now
 * live as rows in the `…` menu — icon, label and a one-line description — with
 * their panels still owned by the same hooks the old icon buttons used, so
 * nothing was reduced to a dead entry.
 */
const ReaderToolsMenuItems: React.FC<ReaderToolsMenuItemsProps> = ({
  bookKey,
  title,
  setIsDropdownOpen,
}) => {
  const _ = useTranslation();
  const translationExpert = useTranslationExpertPanel({ bookKey, title });
  const askLocal = useAskLocalPanel({ bookKey, title });
  const typeset = useTypesetPanel({ bookKey, title });
  const ideas = useIdeasPanel({ bookKey, title });
  const notebook = useNotebookToggle(bookKey);

  return (
    <>
      <MenuItem
        label='译文设置'
        ariaLabel='译文设置'
        description='选择译员与译文样式'
        Icon={MdTranslate}
        onClick={translationExpert.toggle}
        transient
        setIsDropdownOpen={setIsDropdownOpen}
      />
      <MenuItem
        label={_('问书')}
        ariaLabel={_('问书')}
        description='就当前内容向 AI 提问'
        Icon={MdOutlineQuestionAnswer}
        onClick={askLocal.toggle}
        transient
        setIsDropdownOpen={setIsDropdownOpen}
      />
      <MenuItem
        label='排版'
        ariaLabel='排版'
        description='调整正文的字体与版式'
        Icon={MdTextFields}
        onClick={typeset.toggle}
        transient
        setIsDropdownOpen={setIsDropdownOpen}
      />
      <MenuItem
        label='想法'
        ariaLabel='想法'
        description='记录并整理阅读中的灵感'
        Icon={MdOutlineLightbulb}
        onClick={ideas.toggle}
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
      {translationExpert.panel}
      {askLocal.panel}
      {typeset.panel}
      {ideas.panel}
    </>
  );
};

export default ReaderToolsMenuItems;
