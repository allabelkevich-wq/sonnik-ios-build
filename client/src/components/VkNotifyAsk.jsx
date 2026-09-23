// Запрос уведомлений у ВК-пользователя — единственный способ позвать его назад.
//
// Правила, которые тут соблюдены намеренно (и от совести, и от модерации ВК):
//   • спрашиваем ПОСЛЕ первого разбора, а не на входе — человек уже получил
//     пользу и понимает, о чём речь;
//   • спрашиваем ОДИН раз: ответ (любой) пишется в vk_notify_asked_at, и
//     карточка больше не появляется никогда;
//   • отказ равноправен: обе кнопки читаются одинаково, «Не надо» не спрятано
//     и не выкрашено серым в невидимость;
//   • карточка не перекрывает разбор и ничего не блокирует — её можно просто
//     пролистать;
//   • обещание конкретное и правдивое: одно напоминание в 8 утра. Ровно это
//     и делает рассылка (src/backend/vkNotify.js).
// Избранное предлагаем только тем, кто уже сказал «да» уведомлениям: второй
// вопрос после отказа — это давление.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BellAlertIcon } from '@heroicons/react/24/solid';
import { getUserId, authHeader } from '../platform.js';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function VkNotifyAsk({ onDone }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const save = async (patch) => {
    try {
      const headers = { 'Content-Type': 'application/json', ...(await authHeader()) };
      await fetch(`${API_BASE}/api/user/${getUserId()}/vk-permissions`, {
        method: 'POST', headers, body: JSON.stringify(patch),
      });
    } catch (_) {
      // Не сохранилось — переспросим в другой раз. Пользователю знать не о чем.
    }
  };

  const allow = async () => {
    if (busy) return;
    setBusy(true);
    let granted = false;
    let favorited = false;
    try {
      const vkBridge = (await import('@vkontakte/vk-bridge')).default;
      const res = await vkBridge.send('VKWebAppAllowNotifications', {});
      granted = Boolean(res?.result);
      if (granted) {
        try {
          const fav = await vkBridge.send('VKWebAppAddToFavorites', {});
          favorited = Boolean(fav?.result);
        } catch (_) {
          // От избранного отказался — на уведомления это не влияет.
        }
      }
    } catch (_) {
      // Закрыл окно ВК — это отказ, и он тоже записывается.
    }
    await save({ notify_allowed: granted, favorites_added: favorited });
    onDone(granted);
  };

  const decline = async () => {
    if (busy) return;
    setBusy(true);
    await save({ notify_allowed: false });
    onDone(false);
  };

  return (
    <div
      className="section"
      style={{
        background: 'linear-gradient(135deg, rgba(232,146,10,0.12), rgba(232,146,10,0.04))',
        border: '1px solid rgba(232,146,10,0.3)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 14, flexShrink: 0,
          background: 'linear-gradient(135deg, #f5a623, #c97a10)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 20px rgba(232,146,10,0.35)',
        }}>
          <BellAlertIcon style={{ width: 22, height: 22, color: '#1a0800' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)', margin: '0 0 4px' }}>
            {t('vkNotify.heading')}
          </p>
          <p style={{ fontSize: 13, color: 'rgba(var(--fg-rgb),0.6)', margin: 0, lineHeight: 1.55 }}>
            {t('vkNotify.body')}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={allow}
          disabled={busy}
          style={{ flex: 1, minHeight: 44, borderRadius: 9999, opacity: busy ? 0.6 : 1 }}
        >
          {t('vkNotify.allow')}
        </button>
        <button
          onClick={decline}
          disabled={busy}
          style={{
            flex: 1, minHeight: 44, borderRadius: 9999,
            background: 'rgba(var(--fg-rgb),0.07)',
            color: 'rgba(var(--fg-rgb),0.85)',
            border: '1px solid rgba(var(--fg-rgb),0.13)',
            boxShadow: 'none',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {t('vkNotify.decline')}
        </button>
      </div>
    </div>
  );
}
