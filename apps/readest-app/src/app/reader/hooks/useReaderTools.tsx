'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useNotebookStore } from '@/store/notebookStore';
import { eventDispatcher } from '@/utils/event';
import TranslationExpertPanel from '../components/TranslationExpertPanel';
import AskLocalPanel from '../components/AskLocalPanel';
import TypesetPanel from '../components/TypesetPanel';
import IdeasPanel from '../components/IdeasPanel';

/**
 * Open state for the four right-hand drawers and the notebook sidebar.
 *
 * They used to live inside the header's icon togglers. The right cluster now
 * folds into the `…` menu, so the state moves here: the toolbar buttons (kept
 * for any other surface) and the menu rows drive the same drawer.
 *
 * `ReaderToolsProvider` owns those hooks and mounts the four portals for the
 * header's whole life. A dropdown unmounts its subtree when it closes, so
 * rendering the panels inside the `…` menu made every row a no-op: the row
 * closed the menu, which took the panel it had just opened with it. The menu
 * rows now only call the toggles; the panels live outside it.
 */

interface DrawerOptions {
  bookKey: string;
  title: string;
}

const useMounted = () => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
};

export const useTranslationExpertPanel = ({ bookKey, title }: DrawerOptions) => {
  const [isOpen, setIsOpen] = useState(false);
  const mounted = useMounted();

  const toggle = () => {
    // All three drawers share the same fixed right-hand slot. Opening this one
    // announces through the channels the ask and ideas panels already listen
    // to, so only one drawer is ever visible.
    if (!isOpen) {
      eventDispatcher.dispatch('ask-local-close', { bookKey });
      eventDispatcher.dispatch('ideas-close', { bookKey });
    }
    setIsOpen(!isOpen);
  };

  const panel =
    mounted &&
    createPortal(
      <TranslationExpertPanel
        bookKey={bookKey}
        title={title}
        open={isOpen}
        onClose={() => setIsOpen(false)}
      />,
      document.body,
    );

  return { isOpen, toggle, panel };
};

export const useAskLocalPanel = ({ bookKey, title }: DrawerOptions) => {
  const { getView } = useReaderStore();
  const [isOpen, setIsOpen] = useState(false);
  const [selection, setSelection] = useState('');
  const mounted = useMounted();

  // The selection pill opens its own panel for the captured text. Close this
  // one first so two panels never share the fixed drawer.
  useEffect(() => {
    const close = (event: CustomEvent) => {
      if (event.detail?.bookKey === bookKey) setIsOpen(false);
    };
    eventDispatcher.on('ask-local-close', close);
    return () => eventDispatcher.off('ask-local-close', close);
  }, [bookKey]);

  const toggle = () => {
    if (!isOpen) {
      // The expert drawer shares this right-hand slot; `ideas-close` is the
      // signal it listens to when another drawer takes over.
      eventDispatcher.dispatch('ideas-close', { bookKey });
      const docs = getView(bookKey)?.renderer.getContents() ?? [];
      setSelection(
        docs.reduce((text, { doc }) => text || (doc?.getSelection()?.toString().trim() ?? ''), ''),
      );
    }
    setIsOpen(!isOpen);
  };

  const panel =
    mounted &&
    createPortal(
      <AskLocalPanel
        title={title}
        selection={selection}
        open={isOpen}
        onClose={() => setIsOpen(false)}
      />,
      document.body,
    );

  return { isOpen, toggle, panel };
};

export const useTypesetPanel = ({ bookKey, title }: DrawerOptions) => {
  const [isOpen, setIsOpen] = useState(false);
  const mounted = useMounted();

  const toggle = () => {
    // The ask, ideas and translation-expert drawers all sit in the same fixed
    // right-hand slot. Both announcement channels are dispatched so whichever
    // sibling is open yields before this one slides in.
    if (!isOpen) {
      eventDispatcher.dispatch('ask-local-close', { bookKey });
      eventDispatcher.dispatch('ideas-close', { bookKey });
    }
    setIsOpen(!isOpen);
  };

  const panel =
    mounted &&
    createPortal(
      <TypesetPanel
        bookKey={bookKey}
        title={title}
        open={isOpen}
        onClose={() => setIsOpen(false)}
      />,
      document.body,
    );

  return { isOpen, toggle, panel };
};

export const useIdeasPanel = ({ bookKey, title }: DrawerOptions) => {
  const [isOpen, setIsOpen] = useState(false);
  const mounted = useMounted();

  // `ideas-close` is the shared-slot signal the expert drawer also listens to,
  // so it closes this panel without a second event name. Events this panel
  // dispatches itself carry `from: 'ideas'` and are ignored.
  useEffect(() => {
    const close = (event: CustomEvent) => {
      const detail = event.detail as { bookKey?: string; from?: string } | undefined;
      if (detail?.from === 'ideas') return;
      if (detail?.bookKey && detail.bookKey !== bookKey) return;
      setIsOpen(false);
    };
    eventDispatcher.on('ideas-close', close);
    return () => eventDispatcher.off('ideas-close', close);
  }, [bookKey]);

  const toggle = () => {
    // Both panels own the same fixed right-hand slot, so opening this one
    // closes the ask and expert drawers through the channels their togglers
    // already listen to.
    if (!isOpen) {
      eventDispatcher.dispatch('ask-local-close', { bookKey });
      eventDispatcher.dispatch('ideas-close', { bookKey, from: 'ideas' });
    }
    setIsOpen(!isOpen);
  };

  const panel =
    mounted &&
    createPortal(
      <IdeasPanel title={title} open={isOpen} onClose={() => setIsOpen(false)} />,
      document.body,
    );

  return { isOpen, toggle, panel };
};

export const useNotebookToggle = (bookKey: string) => {
  const { appService } = useEnv();
  const { setHoveredBookKey } = useReaderStore();
  const { sideBarBookKey, setSideBarBookKey } = useSidebarStore();
  const { isNotebookVisible, toggleNotebook } = useNotebookStore();
  const isOpen = sideBarBookKey === bookKey && isNotebookVisible;

  const toggle = () => {
    if (appService?.isMobile) {
      setHoveredBookKey('');
    }
    if (sideBarBookKey === bookKey) {
      toggleNotebook();
    } else {
      setSideBarBookKey(bookKey);
      if (!isNotebookVisible) toggleNotebook();
    }
  };

  return { isOpen, toggle };
};

/** What a menu row can do with a drawer: open/close it and read its state. */
export interface ReaderToolPanelControls {
  isOpen: boolean;
  toggle: () => void;
}

export interface ReaderToolsPanelControls {
  translationExpert: ReaderToolPanelControls;
  askLocal: ReaderToolPanelControls;
  typeset: ReaderToolPanelControls;
  ideas: ReaderToolPanelControls;
}

const ReaderToolsContext = createContext<ReaderToolsPanelControls | null>(null);

interface ReaderToolsProviderProps {
  bookKey: string;
  title: string;
  children?: React.ReactNode;
}

/**
 * Mounts the four right-hand drawers once per header, alongside whatever it
 * wraps, and publishes their toggles to the menu rows.
 */
export const ReaderToolsProvider: React.FC<ReaderToolsProviderProps> = ({
  bookKey,
  title,
  children,
}) => {
  const translationExpert = useTranslationExpertPanel({ bookKey, title });
  const askLocal = useAskLocalPanel({ bookKey, title });
  const typeset = useTypesetPanel({ bookKey, title });
  const ideas = useIdeasPanel({ bookKey, title });

  const controls: ReaderToolsPanelControls = {
    translationExpert: { isOpen: translationExpert.isOpen, toggle: translationExpert.toggle },
    askLocal: { isOpen: askLocal.isOpen, toggle: askLocal.toggle },
    typeset: { isOpen: typeset.isOpen, toggle: typeset.toggle },
    ideas: { isOpen: ideas.isOpen, toggle: ideas.toggle },
  };

  return (
    <ReaderToolsContext.Provider value={controls}>
      {children}
      {translationExpert.panel}
      {askLocal.panel}
      {typeset.panel}
      {ideas.panel}
    </ReaderToolsContext.Provider>
  );
};

export const useReaderToolsPanels = (): ReaderToolsPanelControls => {
  const controls = useContext(ReaderToolsContext);
  if (!controls) {
    throw new Error('useReaderToolsPanels must be used inside <ReaderToolsProvider>');
  }
  return controls;
};
