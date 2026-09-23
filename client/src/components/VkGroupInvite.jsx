import { useTranslation } from 'react-i18next';
import { UserGroupIcon } from '@heroicons/react/24/solid';
import { useVkGroupInvite } from '../utils/vkGroup.js';
import { useToast } from './Toast.jsx';

/** Приглашение в сообщество VK. Само решает, показываться ли (VK, не участник). */
export default function VkGroupInvite() {
  const { t } = useTranslation();
  const showToast = useToast();
  const { show, join } = useVkGroupInvite();
  if (!show) return null;

  const onJoin = async () => {
    if (await join()) showToast(t('vkGroup.joined'), 'success');
  };

  return (
    <div className="section">
      <h3 style={{ color: 'var(--primary-color)', fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
        <UserGroupIcon style={{ width: 18, height: 18, display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }} />
        {t('vkGroup.title')}
      </h3>
      <p style={{ fontSize: 13, color: 'rgba(var(--fg-rgb),0.5)', marginBottom: 14, lineHeight: 1.5 }}>
        {t('vkGroup.desc')}
      </p>
      <button
        type="button"
        onClick={onJoin}
        style={{
          width: '100%', fontSize: 14, padding: '12px 14px',
          borderRadius: 9999,
          background: 'rgba(var(--fg-rgb),0.07)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(var(--fg-rgb),0.13)',
          color: 'rgba(var(--fg-rgb),0.85)',
          boxShadow: 'none',
        }}
      >
        {t('vkGroup.join')}
      </button>
    </div>
  );
}
