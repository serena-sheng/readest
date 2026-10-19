import React, { useEffect, useState } from 'react';
import { MdVisibility, MdVisibilityOff } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { DEFAULT_DOUBAO_CLUSTER } from '@/services/tts/providers/doubao';
import { BoxedList } from './primitives';

// Volcano Engine (豆包语音) credentials, kept in the device's settings file.
// The token field is masked by default: it is a per-account secret and must
// never reach a log or an error message.
const TTSDoubaoSection: React.FC<{ onSaved?: () => void }> = ({ onSaved }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const [appId, setAppId] = useState(settings.ttsDoubaoAppId ?? '');
  const [accessToken, setAccessToken] = useState(settings.ttsDoubaoAccessToken ?? '');
  const [cluster, setCluster] = useState(settings.ttsDoubaoCluster ?? DEFAULT_DOUBAO_CLUSTER);
  const [showToken, setShowToken] = useState(false);

  // Settings load after the panel mounts on a cold start; adopt the stored
  // values once they arrive, without clobbering in-progress edits.
  useEffect(() => {
    setAppId(settings.ttsDoubaoAppId ?? '');
    setAccessToken(settings.ttsDoubaoAccessToken ?? '');
    setCluster(settings.ttsDoubaoCluster ?? DEFAULT_DOUBAO_CLUSTER);
  }, [settings.ttsDoubaoAppId, settings.ttsDoubaoAccessToken, settings.ttsDoubaoCluster]);

  const configured = appId.trim().length > 0 && accessToken.trim().length > 0;

  const handleSave = () => {
    const next = {
      ...settings,
      ttsDoubaoAppId: appId.trim(),
      ttsDoubaoAccessToken: accessToken.trim(),
      ttsDoubaoCluster: cluster.trim() || DEFAULT_DOUBAO_CLUSTER,
    };
    setSettings(next);
    void saveSettings(envConfig, next);
    onSaved?.();
  };

  const inputClass = 'input input-sm eink-bordered w-full';

  return (
    <BoxedList
      title={_('豆包语音')}
      description={_('火山引擎语音合成，使用自己的 App ID 与 Access Token')}
      data-setting-id='settings.tts.doubao'
    >
      <div className='space-y-3 py-3 pe-4'>
        <label className='flex flex-col gap-1 text-sm'>
          <span>{_('App ID')}</span>
          <input
            className={inputClass}
            value={appId}
            onChange={(event) => setAppId(event.target.value)}
            autoComplete='off'
            spellCheck={false}
          />
        </label>
        <label className='flex flex-col gap-1 text-sm'>
          <span>{_('Access Token')}</span>
          <div className='flex items-center gap-2'>
            <input
              type={showToken ? 'text' : 'password'}
              className={inputClass}
              value={accessToken}
              onChange={(event) => setAccessToken(event.target.value)}
              autoComplete='off'
              spellCheck={false}
            />
            <button
              type='button'
              className='btn btn-ghost btn-sm eink-bordered shrink-0'
              aria-label={showToken ? _('Hide Access Token') : _('Show Access Token')}
              aria-pressed={showToken}
              onClick={() => setShowToken((visible) => !visible)}
            >
              {showToken ? <MdVisibilityOff size={18} /> : <MdVisibility size={18} />}
            </button>
          </div>
        </label>
        <label className='flex flex-col gap-1 text-sm'>
          <span>{_('Cluster')}</span>
          <input
            className={inputClass}
            value={cluster}
            onChange={(event) => setCluster(event.target.value)}
            placeholder={DEFAULT_DOUBAO_CLUSTER}
            autoComplete='off'
            spellCheck={false}
          />
        </label>

        {!configured && (
          <p className='text-base-content/65 text-sm'>
            {_('填入火山引擎语音合成的 App ID 与 Access Token 后可用')}
          </p>
        )}

        <div className='flex justify-end'>
          <button
            type='button'
            className='btn btn-contrast btn-sm'
            aria-label={_('Save Doubao Settings')}
            onClick={handleSave}
          >
            {_('Save')}
          </button>
        </div>
      </div>
    </BoxedList>
  );
};

export default TTSDoubaoSection;
