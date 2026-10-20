'use client';

import { useEffect, useState } from 'react';
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
 * for any other surface) and the menu rows drive the same drawer, and each
 * renders the returned `panel` portal exactly once.
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
