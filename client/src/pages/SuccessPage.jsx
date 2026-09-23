import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftIcon, ArrowUpTrayIcon, CheckCircleIcon, SparklesIcon, ChevronRightIcon,
  ChatBubbleLeftRightIcon, BookOpenIcon, MoonIcon, CameraIcon,
} from '@heroicons/react/24/solid';
import AnalysisView from './AnalysisView.jsx';
import YupSoulPromo from './YupSoulPromo.jsx';
import Paywall from './Paywall.jsx';
import VkGroupInvite from '../components/VkGroupInvite.jsx';
import VkNotifyAsk from '../components/VkNotifyAsk.jsx';
import RoundButton from '../components/RoundButton.jsx';
import SectionLabel from '../components/SectionLabel.jsx';
import GoldButton from '../components/GoldButton.jsx';
import PillButton from '../components/PillButton.jsx';
import { getUserId, providerCode, getPlatform, authHeader } from '../platform.js';
import { useToast } from '../components/Toast.jsx';
import { shareText } from '../utils/share.js';
import '../styles/result.css';

const API_BASE = import.meta.env.VITE_API_URL || '';
// Итоги лунного месяца собираются от трёх снов (README) — единственная
// константа для фразы «Ещё N снов». Бэкенд числа снов за лунный месяц не
// отдаёт, считаем от общего счётчика: для первых трёх это точно.
const SUMMARY_FROM = 3;

export default function SuccessPage({ analysis, onNewDream, onHome, onJournal, onChat }) {
  const { t } = useTranslation();
  const showToast = useToast();
  const userId = getUserId();
  const [subActive, setSubActive] = useState(true); // по умолчанию true — не мигать апселлом до ответа
  const [showPaywall, setShowPaywall] = useState(false);
  // Просить уведомления только на ВК и только если ещё ни разу не спрашивали.
  const [askNotify, setAskNotify] = useState(false);
  const [totalDreams, setTotalDreams] = useState(null);

  useEffect(() => {
    if (!userId) { setSubActive(false); return; }
    authHeader().then(headers => {
      fetch(`${API_BASE}/api/user/${userId}/subscription?provider=${providerCode()}`, { headers })
        .then(r => r.json())
        .then(d => {
          setSubActive(Boolean(d.active));
          setAskNotify(getPlatform() === 'vk' && !d.vk_notify_asked);
        })
        .catch(() => setSubActive(false));
    });
  }, [userId]);

  // Номер записи в дневнике: сон сохраняется до ответа /api/analyze, поэтому
  // счётчик уже включает текущий. Не ответил — покажем строку без номера.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    authHeader().then(headers => {
      fetch(`${API_BASE}/api/user/${userId}/stats?provider=${providerCode()}`, { headers })
        .then(r => r.json())
        .then(d => { if (!cancelled) setTotalDreams(d.total_dreams ?? null); })
        .catch(() => {});
    });
    return () => { cancelled = true; };
  }, [userId]);

  // История ВК картинкой. Снаружи клиента ВК (прямая ссылка) карточку не
  // отправить — уходим в обычный шаринг текстом.
  const shareStory = async () => {
    try {
      const { shareStoryCard } = await import('../utils/storyCard.js');
      const r = await shareStoryCard({ analysis, t });
      if (r === 'unavailable') return shareAnalysis();
      if (r === 'failed') showToast(t('success.shareFailed'), 'error');
    } catch (_) {
      showToast(t('success.shareFailed'), 'error');
    }
  };

  const shareAnalysis = async () => {
    if (!analysis) return;

    const lunar = analysis.lunar_data;
    const lunarText = lunar?.day_number ? t('success.shareLunarDay', { n: lunar.day_number }) : '';
    const patterns = analysis.destructive_patterns?.length
      ? t('success.sharePatterns', { count: analysis.destructive_patterns.length })
      : '';

    // VKWebAppShare умеет только ссылку — она открывала приложение без разбора
    // (bug7438516), поэтому во ВКонтакте несём текст через запись на стене.
    // Всю цепочку попыток и обратную связь держит shareText: раньше при отказе
    // бриджа и закрытом буфере обмена кнопка не делала ровно ничего (7449177).
    const platform = getPlatform();
    const key = platform === 'vk' ? 'success.shareTextVk' : 'success.shareText';
    const text = t(key, {
      brief: analysis.brief_analysis || '',
      lunar: lunarText ? `\n\n🌙 ${lunarText}` : '',
      patterns,
    });
    await shareText({ platform, text, tgLink: 'https://t.me/tot_sonnic_bot', showToast, t });
  };

  const lunarDay = analysis?.lunar_data?.day_number;
  const remaining = totalDreams != null ? Math.max(0, SUMMARY_FROM - totalDreams) : 0;
  const savedParts = [
    totalDreams != null ? t('success.recordNumber', { count: totalDreams }) : '',
    lunarDay ? t('success.shareLunarDay', { n: lunarDay }) : '',
  ].filter(Boolean);
  const savedSub = savedParts.length
    ? `${savedParts.join(' · ')}.${remaining > 0 ? ` ${t('success.untilSummary', { count: remaining })}` : ''}`
    : '';

  return (
    <div className="page">
      <div className="page-scroll" style={{ padding: '0 18px calc(env(safe-area-inset-bottom, 0px) + 28px)' }}>
        {/* Своего <header> у экрана нет: верхний отступ ставим руками, иначе
            кнопка «Поделиться» окажется под крестиком VK на iPhone (замер
            01.09: плавающие кнопки VK кончаются на 78pt, 47 + 40 = 87). */}
        <div style={{
          padding: 'var(--v3-top) 0 0',
          display: 'flex', flexDirection: 'column', gap: 18,
        }}>

          {/* ── Шапка ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <RoundButton onClick={onHome} label={t('success.home')}>
              <ArrowLeftIcon style={{ width: 17, height: 17 }} />
            </RoundButton>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--v3-fg)', lineHeight: 1.2 }}>
                {t('success.title')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--v3-fg-3)', marginTop: 2 }}>
                {t('success.stepDone')}
              </div>
            </div>
            <RoundButton onClick={shareAnalysis} label={t('success.share')}>
              <ArrowUpTrayIcon style={{ width: 17, height: 17 }} />
            </RoundButton>
          </div>

          {/* ── Сон записан в дневник (только для авторизованных: гостю сон не сохраняют) ── */}
          {userId && analysis && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '2px 0 0' }}>
              <div style={{
                width: 52, height: 52, borderRadius: '50%',
                background: 'var(--v3-chip-s)', border: '1px solid var(--v3-chip-s-br)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <CheckCircleIcon style={{ width: 28, height: 28, color: 'var(--v3-success)' }} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--v3-fg)' }}>{t('success.savedToJournal')}</div>
              {/* Место под две строки зарезервировано: текст дописывается ответом /stats */}
              <div style={{
                fontSize: 12.5, color: 'var(--v3-fg-3)', textAlign: 'center',
                maxWidth: 270, lineHeight: 1.5, minHeight: 38,
              }}>
                {savedSub}
              </div>
            </div>
          )}

          {/* Карточка стоит до разбора, а не после: под разбором в четыре
              экрана её видели 48 человек из 1254 (04–07.09). Кто увидел —
              соглашался каждый третий. */}
          {askNotify && (
            <div className="r-legacy">
              <VkNotifyAsk
                onDone={(granted) => {
                  setAskNotify(false);
                  if (granted) showToast(t('vkNotify.thanks'));
                }}
              />
            </div>
          )}

          <AnalysisView analysis={analysis} onRetry={onNewDream} onJournal={onJournal} onChat={onChat} />

          {/* ── Премиум-апселл: цен и валют на экране нет, суммы живут в Paywall ── */}
          {!subActive && (
            <button type="button" className="r-upsell" onClick={() => setShowPaywall(true)}>
              <span style={{
                width: 40, height: 40, borderRadius: 13, flexShrink: 0,
                background: 'linear-gradient(135deg,#f5a623,#c97a10)',
                boxShadow: '0 0 18px rgba(232,146,10,.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <SparklesIcon style={{ width: 20, height: 20, color: '#1a0800' }} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--v3-fg)' }}>
                  {t('success.upsellTitle')}
                </span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--v3-fg-3)', marginTop: 2 }}>
                  {getPlatform() === 'vk' ? t('success.upsellDescVk') : t('success.upsellDesc')}
                </span>
              </span>
              <ChevronRightIcon style={{ width: 14, height: 14, flexShrink: 0, color: 'var(--v3-gold-txt)' }} />
            </button>
          )}

          {/* ── Что дальше ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <SectionLabel title={t('success.nextSteps')} />
            {onChat && (
              <GoldButton onClick={onChat} icon={<ChatBubbleLeftRightIcon style={{ width: 15, height: 15 }} />}>
                {t('success.oracle')}
              </GoldButton>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
              {onJournal && (
                <PillButton tone="violet" onClick={onJournal} icon={<BookOpenIcon style={{ width: 17, height: 17 }} />}>
                  {t('success.journalShort')}
                </PillButton>
              )}
              <PillButton tone="neutral" onClick={onNewDream} icon={<MoonIcon style={{ width: 17, height: 17 }} />}>
                {t('success.moreDream')}
              </PillButton>
            </div>
            {getPlatform() === 'vk' && analysis && (
              <PillButton tone="neutral" onClick={shareStory} icon={<CameraIcon style={{ width: 17, height: 17 }} />}>
                {t('success.story')}
              </PillButton>
            )}
          </div>

          <div className="r-legacy">
            <VkGroupInvite />
          </div>

          {/* Без обёртки: у карточки промо своя кромка и фон, вторая рамка
              вокруг неё дублировалась (ветка промо v3). Отступ отдаём пропом. */}
          <YupSoulPromo variant="default" style={{ marginBottom: 'var(--spacing-lg)' }} />
        </div>
      </div>

      {showPaywall && (
        <Paywall
          userId={userId}
          onClose={() => setShowPaywall(false)}
          onActivated={() => setSubActive(true)}
        />
      )}
    </div>
  );
}
