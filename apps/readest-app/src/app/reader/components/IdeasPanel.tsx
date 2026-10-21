'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useState } from 'react';
import { MdClose, MdMoreHoriz } from 'react-icons/md';

import { deleteNote, listNotes } from '@/services/ai/localNotes';
import type { LocalNote } from '@/services/ai/localNotes';

interface IdeasPanelProps {
  /** Book title, used both as the subtitle and as the `/notes` query key. */
  title: string;
  open: boolean;
  onClose: () => void;
}

type Status = 'idle' | 'loading' | 'ready' | 'error';

/**
 * "刚刚" for the first minute, minutes up to an hour, then a calendar date.
 * The service stores `created_at` as Unix seconds; ISO strings are accepted
 * so the formatter also handles other payloads without a second code path.
 */
export const formatNoteTime = (value: number | string, now = Date.now()): string => {
  const time =
    typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
  if (!Number.isFinite(time)) return '';
  const elapsed = Math.max(0, now - time);
  if (elapsed < 60_000) return '刚刚';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  const date = new Date(time);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
};

const IdeasPanel: React.FC<IdeasPanelProps> = ({ title, open, onClose }) => {
  const [notes, setNotes] = useState<LocalNote[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setNotes(await listNotes(title));
      setStatus('ready');
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setStatus('error');
    }
  }, [title]);

  // Opening reads the book's notes; the service has no push channel, so a
  // save from the selection pill is announced on `window` and refreshes here.
  useEffect(() => {
    if (!open) return;
    void load();
    const refresh = () => void load();
    window.addEventListener('emm-note-saved', refresh);
    return () => window.removeEventListener('emm-note-saved', refresh);
  }, [open, load]);

  // A press anywhere outside the open card menu dismisses it.
  useEffect(() => {
    if (!menuFor) return;
    const dismiss = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-ideas-menu]')) return;
      setMenuFor(null);
      setConfirmFor(null);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [menuFor]);

  const remove = async (uuid: string) => {
    setDeleting(uuid);
    try {
      await deleteNote(uuid);
      setNotes((prev) => prev.filter((note) => note.uuid !== uuid));
      setConfirmFor(null);
      setMenuFor(null);
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setStatus('error');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div
      role='dialog'
      aria-label='想法'
      aria-hidden={!open}
      inert={!open}
      className={clsx(
        'pointer-events-auto fixed bottom-0 right-0 top-0 z-50 flex w-[360px] max-w-full flex-col',
        'bg-base-100 rounded-box border border-base-content/10 shadow-lg',
        'transition-transform duration-300',
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
      )}
    >
      <div className='flex items-start gap-2 border-b border-base-content/10 px-4 py-3'>
        <div className='min-w-0 flex-1'>
          <h2 className='font-serif text-base font-semibold'>想法</h2>
          <p className='mt-1 truncate text-xs opacity-60'>{title}</p>
        </div>
        <button
          className='btn btn-ghost btn-sm btn-circle'
          title='关闭'
          aria-label='关闭'
          onClick={onClose}
        >
          <MdClose size={18} />
        </button>
      </div>

      <div className='min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4'>
        {status === 'loading' && notes.length === 0 && (
          <p className='text-sm opacity-60'>正在读取…</p>
        )}

        {status === 'error' && (
          <div className='space-y-2'>
            <p className='text-sm text-error'>读取失败：{error}</p>
            <button className='btn btn-ghost btn-xs' onClick={() => void load()}>
              重试
            </button>
          </div>
        )}

        {(status === 'idle' || status === 'ready') && notes.length === 0 && (
          <p className='pt-10 text-center text-sm opacity-60'>还没有想法，划线试试</p>
        )}

        {notes.map((note) => {
          const stamp = formatNoteTime(note.created_at);
          const footer = [note.locator, stamp].filter(Boolean).join(' · ');
          return (
            <article key={note.uuid} className='rounded-box bg-base-200/60 p-3.5'>
              <p className='line-clamp-3 border-s-2 border-primary/70 ps-2.5 font-serif text-[15px] leading-relaxed'>
                {note.quote}
              </p>
              {note.note && (
                <p className='mt-2.5 whitespace-pre-wrap text-sm leading-relaxed opacity-80'>
                  {note.note}
                </p>
              )}
              <div className='mt-3 flex items-center gap-2 text-caption opacity-60'>
                <span className='min-w-0 flex-1 truncate'>{footer}</span>
                <div className='relative' data-ideas-menu>
                  <button
                    className='btn btn-ghost btn-xs h-6 min-h-6 w-6 p-0'
                    title='更多'
                    aria-label='更多'
                    onClick={() => {
                      setMenuFor(menuFor === note.uuid ? null : note.uuid);
                      setConfirmFor(null);
                    }}
                  >
                    <MdMoreHoriz size={16} />
                  </button>
                  {menuFor === note.uuid && (
                    <div className='absolute bottom-7 right-0 z-10 w-32 rounded-field border border-base-content/10 bg-base-100 p-1 shadow-lg'>
                      {confirmFor === note.uuid ? (
                        <div className='px-2 py-1.5'>
                          <p className='text-caption opacity-70'>确定删除？</p>
                          <div className='mt-1.5 flex justify-end gap-1'>
                            <button
                              className='btn btn-ghost btn-xs'
                              onClick={() => setConfirmFor(null)}
                            >
                              取消
                            </button>
                            <button
                              className='btn btn-ghost btn-xs text-error'
                              aria-label='确认删除'
                              disabled={deleting === note.uuid}
                              onClick={() => void remove(note.uuid)}
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          className='btn btn-ghost btn-xs w-full justify-start text-error'
                          aria-label='删除想法'
                          onClick={() => setConfirmFor(note.uuid)}
                        >
                          删除
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};

export default IdeasPanel;
