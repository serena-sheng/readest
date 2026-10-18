'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MdClose } from 'react-icons/md';

import { askLocal, suggestLocal } from '@/services/ai/askLocal';
import type { AskSuggestion } from '@/services/ai/askLocal';

interface AskLocalPanelProps {
  title: string;
  selection: string;
  /**
   * Selection captured by a surface that opens the panel directly (the
   * reader's selection pill). When present it is the text the questions are
   * asked against, so a caller that only knows the selection at open time can
   * hand it over without keeping its own copy in `selection`.
   */
  initialSelection?: string;
  open: boolean;
  onClose: () => void;
}

interface Turn {
  question: string;
  answer: string;
  failed?: boolean;
}

const MAX_TURNS = 5;

const AskLocalPanel: React.FC<AskLocalPanelProps> = ({
  title,
  selection,
  initialSelection,
  open,
  onClose,
}) => {
  // A surface that opens the panel carries the text it was opened for; the
  // toggler keeps passing its snapshot through `selection` instead.
  const context = (initialSelection ?? selection).trim();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [suggestions, setSuggestions] = useState<AskSuggestion[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Opening the panel asks the service for three starter questions. Any
  // failure just leaves the chips out: the panel still works without them.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    suggestLocal({ text: context, title })
      .then((items) => {
        if (!cancelled) setSuggestions(items.slice(0, 3));
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, context, title]);

  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
    setStreaming(false);
  }, [open]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const send = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      if (!prompt || streaming) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setQuestion('');
      setTurns((prev) => [...prev, { question: prompt, answer: '' }].slice(-MAX_TURNS));
      setStreaming(true);

      try {
        await askLocal({
          question: prompt,
          selection: context,
          title,
          signal: controller.signal,
          onDelta: (delta) => {
            setTurns((prev) =>
              prev.map((turn, index) =>
                index === prev.length - 1 ? { ...turn, answer: turn.answer + delta } : turn,
              ),
            );
          },
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        setTurns((prev) =>
          prev.map((turn, index) =>
            index === prev.length - 1 ? { ...turn, answer: message, failed: true } : turn,
          ),
        );
      } finally {
        if (!controller.signal.aborted) setStreaming(false);
      }
    },
    [context, title, streaming],
  );

  return (
    <div
      role='dialog'
      aria-label='问书'
      aria-hidden={!open}
      inert={!open}
      className={clsx(
        'pointer-events-auto fixed bottom-0 right-0 top-0 z-50 flex w-[360px] max-w-full flex-col',
        'bg-base-100 rounded-box shadow-lg transition-transform duration-300',
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
      )}
    >
      <div className='flex items-start gap-2 border-b border-base-300 px-4 py-3'>
        <div className='min-w-0 flex-1'>
          <h2 className='text-base font-semibold'>问一个问题</h2>
          <p className='mt-1 truncate text-xs opacity-60'>{title}</p>
          <p className='mt-1 line-clamp-2 text-xs opacity-70'>
            {context || '未选中文本，将基于当前页提问'}
          </p>
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

      {suggestions.length > 0 && (
        <div className='flex flex-wrap gap-2 border-b border-base-300 px-4 py-3'>
          {suggestions.map((item) => (
            <button
              key={item.question}
              className='btn btn-xs btn-outline'
              onClick={() => void send(item.question)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <div ref={scrollRef} className='min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3'>
        {turns.length === 0 && (
          <p className='text-sm opacity-60'>就这本书提问，回答会基于当前阅读位置。</p>
        )}
        {turns.map((turn, index) => (
          <div key={index} className='rounded-box bg-base-200/60 p-3'>
            <p className='text-sm font-medium'>{turn.question}</p>
            <p
              className={clsx(
                'mt-2 whitespace-pre-wrap font-serif text-sm leading-relaxed',
                turn.failed && 'text-error',
              )}
            >
              {turn.answer || (streaming && index === turns.length - 1 ? '生成中…' : '')}
            </p>
          </div>
        ))}
      </div>

      <div className='border-t border-base-300 p-3'>
        <div className='flex items-end gap-2'>
          <textarea
            className='textarea textarea-bordered min-h-10 flex-1 resize-none text-sm'
            rows={2}
            placeholder='输入你的问题…'
            aria-label='问题'
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send(question);
              }
            }}
          />
          <button
            className='btn btn-primary btn-sm'
            disabled={!question.trim() || streaming}
            onClick={() => void send(question)}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
};

export default AskLocalPanel;
