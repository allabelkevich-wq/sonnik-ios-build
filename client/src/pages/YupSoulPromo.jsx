import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MusicalNoteIcon,
  SparklesIcon,
  XMarkIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/solid';
import { getPlatform } from '../platform.js';
import {
  PARTNER, PARTNER_VK_LOCATION, PARTNER_VK_LINK, PARTNER_TG_LINK, PARTNER_WEB_LINK,
  partnerMode, partnerSurface,
} from '../utils/partner.js';
import { mark } from '../utils/pulse.js';
import '../styles/promo.css';

// Куда ведём и что обещаем — в utils/partner.js: в VK — на VK Mini App оракула
// (t.me внутри VK-версии не работает и запрещён правилами VK Mini Apps), на
// нативных клиентах VK у оракула нет песен — там зовём к самому оракулу.
const STORAGE_KEY = 'yupsoul_dismissed_at';
const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

function shouldShow() {
  try {
    const ts = localStorage.getItem(STORAGE_KEY);
    if (!ts) return true;
    return Date.now() - parseInt(ts, 10) > COOLDOWN_MS;
  } catch {
    return true;
  }
}

function recordDismiss() {
  try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch {}
}

function forgetDismiss() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

const DISCLAIMER_KEY = {
  vk: 'yupsoul.disclaimerVk',
  telegram: 'yupsoul.disclaimer',
  web: 'yupsoul.disclaimerWeb',
};

export default function YupSoulPromo({ variant = 'default', style }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setVisible(shouldShow());
  }, []);

  // В приложении из App Store ссылки на YupSoul в Telegram и ВК ведут к оплате
  // мимо App Store (правило Apple 3.1.1) — баннер там не показываем.
  if (!visible || getPlatform() === 'ios') return null;

  const variantKey = ['default', 'monthly', 'birth'].includes(variant) ? variant : 'default';
  const platform = getPlatform();
  // 'oracle' — у партнёра на этой поверхности нет песен: другие слова и кнопка.
  const mode = partnerMode();
  const copy = mode === 'oracle' ? `yupsoul.oracle.${variantKey}` : `yupsoul.${variantKey}`;
  const Icon = mode === 'oracle' ? SparklesIcon : MusicalNoteIcon;

  const handleOpen = async () => {
    // Сколько людей ушло к партнёру и с какой поверхности — иначе мост не измерить.
    mark('партнёр', `${partnerSurface()} ${mode === 'oracle' ? 'оракул' : 'музыка'}`);
    // НЕ прячем блок сразу: раньше setVisible(false) выполнялся до открытия
    // ссылки, и если на iOS VKWebAppOpenLink резолвился без открытия — блок
    // исчезал, а оракул не открывался, юзер застревал (bug7441714).
    if (platform === 'vk') {
      // send() зависает бессрочно, если родительский VK-фрейм не отвечает —
      // гоним с таймаутом; фолбэчим и когда бридж не подтвердил result:true.
      const timeout = () => new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 2000));
      let opened = false;
      try {
        const vkBridge = (await import('@vkontakte/vk-bridge')).default;
        // Другое мини-приложение открываем профильным методом: VKWebAppOpenLink
        // в приложении VK Мессенджер уводил на вкладку мессенджера вместо оракула
        // (отчёт 7444283). OpenApp остаётся внутри VK и открывает нужный апп.
        // location — хэш, который VK отдаст оракулу: по нему он запишет, что
        // человек пришёл из сонника.
        try {
          const r = await Promise.race([
            vkBridge.send('VKWebAppOpenApp', { app_id: PARTNER.vkAppId, location: PARTNER_VK_LOCATION }),
            timeout(),
          ]);
          opened = r?.result === true;
        } catch { /* не поддержан — пробуем ссылку ниже */ }
        if (!opened) {
          const res = await Promise.race([vkBridge.send('VKWebAppOpenLink', { link: PARTNER_VK_LINK }), timeout()]);
          opened = res?.result === true;
        }
      } catch { /* фолбэк ниже */ }
      if (!opened) window.open(PARTNER_VK_LINK, '_blank', 'noopener');
      recordDismiss(); // открыли — в следующий раз не показываем сразу
      return;
    }
    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(PARTNER_TG_LINK);
    } else {
      window.open(PARTNER_WEB_LINK, '_blank');
    }
    recordDismiss();
  };

  const handleDismiss = () => {
    recordDismiss();
    // Не убираем блок молча: на его месте остаётся строка с «Вернуть» —
    // случайное касание крестика должно быть отменяемым.
    setDismissed(true);
  };

  const handleRestore = () => {
    forgetDismiss();
    setDismissed(false);
  };

  if (dismissed) {
    return (
      <div style={{
        borderRadius: 16,
        border: '1px dashed var(--promo-tile-br)',
        background: 'var(--promo-tile)',
        padding: '14px 15px',
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        ...style,
      }}>
        <CheckCircleIcon aria-hidden="true" style={{ width: 16, height: 16, flexShrink: 0, color: 'var(--promo-fg-4)' }} />
        <span style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--promo-fg-3)', flex: 1 }}>
          {t('yupsoul.hidden')}
        </span>
        <button
          type="button"
          className="promo-plain"
          onClick={handleRestore}
          style={{
            fontSize: 12.5, fontWeight: 600, color: 'var(--promo-violet)',
            background: 'none', border: 'none', boxShadow: 'none',
            width: 'auto', minHeight: 44, padding: '0 0 0 8px',
            display: 'flex', alignItems: 'center', cursor: 'pointer',
            borderRadius: 0, letterSpacing: 'normal',
          }}
        >
          {t('yupsoul.restore')}
        </button>
      </div>
    );
  }

  return (
    <div style={{ borderRadius: 20, padding: 1, background: 'var(--promo-edge)', ...style }}>
      <div style={{
        borderRadius: 19,
        padding: 16,
        background: 'var(--promo-bg)',
        boxShadow: 'inset 0 1px 0 var(--promo-sheen)',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{
            width: 34, height: 34, borderRadius: 12, flexShrink: 0,
            background: 'var(--promo-chip)',
            border: '1px solid var(--promo-chip-br)',
            color: 'var(--promo-violet)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon aria-hidden="true" style={{ width: 17, height: 17 }} />
          </span>
          <div style={{ minWidth: 0, flex: 1, paddingTop: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.16em',
                textTransform: 'uppercase', color: 'var(--promo-violet)', whiteSpace: 'nowrap',
              }}>
                {t(mode === 'oracle' ? 'yupsoul.oracle.eyebrow' : 'yupsoul.eyebrow')}
              </span>
              <span style={{
                fontSize: 9.5, fontWeight: 600, padding: '3px 7px', borderRadius: 999,
                background: 'var(--promo-inset)', color: 'var(--promo-fg-4)', whiteSpace: 'nowrap',
              }}>
                {t('yupsoul.partner')}
              </span>
            </div>
            <p style={{
              fontSize: 14.5, fontWeight: 700, lineHeight: 1.42, color: 'var(--fg)',
              margin: '6px 0 0', paddingRight: 34,
            }}>
              {t(`${copy}.title`)}
            </p>
            <p style={{
              fontSize: 13, lineHeight: 1.5, color: 'var(--promo-fg-3)', margin: '4px 0 0',
            }}>
              {t(`${copy}.subtitle`)}
            </p>
          </div>
        </div>

        <button
          type="button"
          className="promo-plain promo-x"
          onClick={handleDismiss}
          aria-label={t('yupsoul.close')}
          style={{
            position: 'absolute', top: 4, right: 4,
            width: 44, height: 44, minWidth: 44, padding: 0,
            borderRadius: 999, background: 'none', border: 'none', boxShadow: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'inherit',
          }}
        >
          <span style={{
            width: 26, height: 26, borderRadius: 999, background: 'var(--promo-inset)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <XMarkIcon aria-hidden="true" style={{ width: 13, height: 13, color: 'var(--promo-fg-4)' }} />
          </span>
        </button>

        <button
          type="button"
          className="promo-plain"
          onClick={handleOpen}
          style={{
            width: '100%', minHeight: 48, padding: '10px 14px', borderRadius: 999,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
            background: 'var(--promo-chip)',
            border: '1px solid var(--promo-chip-br)',
            color: 'var(--promo-violet)',
            fontSize: 13.5, fontWeight: 600, boxShadow: 'none', letterSpacing: 'normal',
            cursor: 'pointer', whiteSpace: 'normal', lineHeight: 1.3, textAlign: 'center',
          }}
        >
          <span>{t(mode === 'oracle' ? 'yupsoul.oracle.openButton' : 'yupsoul.openButton')}</span>
          <ArrowTopRightOnSquareIcon aria-hidden="true" style={{ width: 14, height: 14, flexShrink: 0 }} />
        </button>

        <div style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--promo-fg-4)' }}>
          {t(DISCLAIMER_KEY[platform] || DISCLAIMER_KEY.web)}
        </div>
      </div>
    </div>
  );
}
