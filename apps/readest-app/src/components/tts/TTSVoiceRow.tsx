import clsx from 'clsx';
import { MdCheck, MdStop, MdVolumeUp } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import type { TTSVoice, TTSVoicesGroup } from '@/services/tts/types';
import { getVoiceMetaLine } from '@/services/tts/voiceMeta';

type TTSVoiceRowProps = {
  group: TTSVoicesGroup;
  voice: TTSVoice;
  selected: boolean;
  previewing: boolean;
  previewable: boolean;
  onSelect: () => void;
  onTogglePreview: () => void;
};

// One picker row: name, then language · gender · engine underneath, with the
// sample button kept outside the selection button so tapping it never changes
// the reading voice.
const TTSVoiceRow = ({
  group,
  voice,
  selected,
  previewing,
  previewable,
  onSelect,
  onTogglePreview,
}: TTSVoiceRowProps) => {
  const _ = useTranslation();
  const meta = getVoiceMetaLine(_, group, voice);

  return (
    <div
      className={clsx(
        'flex w-full items-center gap-2 rounded-lg px-2 py-2',
        voice.disabled && 'text-base-content/40',
      )}
    >
      <button
        type='button'
        aria-label={_(voice.name)}
        aria-pressed={selected}
        onClick={onSelect}
        className={clsx(
          'flex min-w-0 flex-1 items-center gap-2 text-start',
          voice.disabled && 'text-base-content/40',
        )}
      >
        <span className='flex h-6 w-6 shrink-0 items-center justify-center'>
          {selected && <MdCheck className='text-base-content' />}
        </span>
        <span className='flex min-w-0 flex-col'>
          <span className='truncate text-base sm:text-sm'>{_(voice.name)}</span>
          {meta && <span className='text-base-content/60 truncate text-xs'>{meta}</span>}
        </span>
        {voice.variant && (
          <span className='badge badge-sm badge-ghost ms-auto shrink-0'>
            {voice.variant === 'multilingual' ? _('Multilingual') : _('Expressive')}
          </span>
        )}
        {voice.tier && (
          <span
            className={clsx('badge badge-sm badge-ghost shrink-0', !voice.variant && 'ms-auto')}
          >
            {voice.tier === 'pro' ? _('Pro') : _('Plus')}
          </span>
        )}
      </button>
      {previewable && (
        <button
          type='button'
          aria-label={previewing ? _('Stop Preview') : _('Preview')}
          aria-pressed={previewing}
          onClick={onTogglePreview}
          disabled={voice.disabled}
          className='btn btn-ghost btn-xs eink-bordered shrink-0 gap-1 px-2'
        >
          {previewing ? <MdStop size={16} /> : <MdVolumeUp size={16} />}
          <span>{previewing ? _('Stop') : _('Preview')}</span>
        </button>
      )}
    </div>
  );
};

export default TTSVoiceRow;
