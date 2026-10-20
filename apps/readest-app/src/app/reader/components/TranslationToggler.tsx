import { useEffect, useState } from 'react';
import { RiTranslate } from 'react-icons/ri';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { saveViewSettings } from '@/helpers/settings';
import { isTranslationAvailable } from '@/services/translators/utils';
import { getLanguageName, isSameLang } from '@/utils/lang';
import { getLocale } from '@/utils/misc';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';

/**
 * Why the current book cannot translate its body text. Mirrors the checks in
 * `isTranslationAvailable` so the button and the explanation never disagree.
 */
export const getTranslationBlockedReason = (
  book: { format?: string; primaryLanguage?: string } | null | undefined,
  targetLanguage: string | null | undefined,
) => {
  if (!book || book.format === 'PDF') return 'pdf';
  const primaryLanguage = book.primaryLanguage || '';
  if (isSameLang(primaryLanguage, targetLanguage || getLocale())) return 'same-language';
  return 'unknown-language';
};

const TranslationToggler = ({ bookKey }: { bookKey: string }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { getBookData } = useBookDataStore();
  const { getViewSettings, setViewSettings, setHoveredBookKey } = useReaderStore();
  const setSettingsDialogOpen = useSettingsStore((s) => s.setSettingsDialogOpen);
  const setSettingsDialogBookKey = useSettingsStore((s) => s.setSettingsDialogBookKey);
  const setActiveSettingsItemId = useSettingsStore((s) => s.setActiveSettingsItemId);

  const iconSize20 = useResponsiveSize(20);
  const bookData = getBookData(bookKey);
  const viewSettings = getViewSettings(bookKey)!;
  const [translationEnabled, setTranslationEnabled] = useState(viewSettings.translationEnabled!);
  const [translationAvailable, setTranslationAvailable] = useState(
    isTranslationAvailable(bookData?.book, viewSettings.translateTargetLang),
  );
  const [blockedOpen, setBlockedOpen] = useState(false);

  useEffect(() => {
    if (translationEnabled === viewSettings.translationEnabled) return;
    if (appService?.isMobile) {
      setHoveredBookKey('');
    }
    saveViewSettings(envConfig, bookKey, 'translationEnabled', translationEnabled, true, false);
    viewSettings.translationEnabled = translationEnabled;
    setViewSettings(bookKey, { ...viewSettings });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translationEnabled]);

  useEffect(() => {
    setTranslationEnabled(viewSettings.translationEnabled);
    setTranslationAvailable(
      isTranslationAvailable(bookData?.book, viewSettings.translateTargetLang),
    );
  }, [bookData, viewSettings.translationEnabled, viewSettings.translateTargetLang]);

  const toggle = () => {
    if (!translationAvailable && !translationEnabled) {
      setBlockedOpen(true);
      return;
    }
    setTranslationEnabled(!translationEnabled);
  };

  const openTargetLanguageSettings = () => {
    setBlockedOpen(false);
    setSettingsDialogBookKey(bookKey);
    setActiveSettingsItemId('settings.language.targetLanguage');
    setSettingsDialogOpen(true);
  };

  const blockedReason = getTranslationBlockedReason(
    bookData?.book,
    viewSettings.translateTargetLang,
  );
  const reason =
    blockedReason === 'pdf'
      ? _('PDF 只支持整页阅读，不能翻译正文')
      : blockedReason === 'same-language'
        ? _('这本书已经是{{language}}，不需要翻译', {
            language: getLanguageName(viewSettings.translateTargetLang || getLocale()),
          })
        : _('这本书没有标注语言，无法确定翻译方向');

  return (
    <>
      <Button
        icon={
          <RiTranslate
            className={translationEnabled ? 'text-primary' : 'text-base-content'}
            size={iconSize20}
          />
        }
        aria-label={_('Toggle Translation')}
        title={translationAvailable ? undefined : _('为什么不能翻译')}
        ariaDisabled={false}
        onClick={toggle}
        label={
          !translationAvailable
            ? _('为什么不能翻译')
            : translationEnabled
              ? _('Disable Translation')
              : _('Enable Translation')
        }
      ></Button>
      {blockedOpen && (
        <Dialog
          isOpen={blockedOpen}
          title={_('这本书不能翻译正文')}
          onClose={() => setBlockedOpen(false)}
          boxClassName='sm:h-auto! sm:w-[420px]! sm:max-w-[90vw]!'
        >
          <div className='flex flex-col gap-4 pb-4'>
            <p className='text-base-content/70 text-sm'>{reason}</p>
            <div className='flex justify-end gap-2'>
              <button
                type='button'
                className='btn btn-ghost btn-sm'
                onClick={() => setBlockedOpen(false)}
              >
                {_('取消')}
              </button>
              <button
                type='button'
                className='btn btn-primary btn-sm'
                onClick={openTargetLanguageSettings}
              >
                {_('更换目标语言')}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
};

export default TranslationToggler;
