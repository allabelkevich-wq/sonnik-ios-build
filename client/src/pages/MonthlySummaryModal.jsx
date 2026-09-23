import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftIcon, ArrowUpTrayIcon, CheckCircleIcon,
  ExclamationTriangleIcon, MoonIcon, SparklesIcon,
} from '@heroicons/react/24/solid';
import axios from 'axios';
import YupSoulPromo from './YupSoulPromo.jsx';
import Paywall from './Paywall.jsx';
import RoundButton from '../components/RoundButton.jsx';
import PillButton from '../components/PillButton.jsx';
import GoldButton from '../components/GoldButton.jsx';
import EdgeCard from '../components/EdgeCard.jsx';
import Tile from '../components/Tile.jsx';
import Chip from '../components/Chip.jsx';
import SectionLabel from '../components/SectionLabel.jsx';
import Constellation from '../components/Constellation.jsx';
import Skeleton from '../components/Skeleton.jsx';
import { moonPath } from '../utils/moon.js';
import { formatDayMonth } from '../utils/date.js';
import { getUserId, providerCode, getPlatform, authHeader } from '../platform.js';
import { useToast } from '../components/Toast.jsx';
import { shareText } from '../utils/share.js';
import '../styles/monthly.css';

const API_BASE = import.meta.env.VITE_API_URL || '';
const DAY_MS = 86400000;
// Порог, о котором говорит экран «мало снов». Сервер отдаёт ai_summary: null
// пока снов нет вовсе; когда он начнёт отдавать null и при 1–2 снах, экран
// уже готов — цифра берётся из stats.total_dreams.
const MIN_DREAMS = 3;
// Заливка полос и столбиков — та же золотая рампа, что у CTA; в отличие от
// текста и поверхностей она одинакова в обеих темах (как в эталоне).
const GOLD_BAR = 'linear-gradient(90deg,#f5a623,#c97a10)';

// Дата приходит днём («2026-08-13») — читаем в полдень локального времени,
// чтобы сдвиг часового пояса не увёл её на сутки назад.
function parseDay(str) {
  return new Date(`${str}T12:00:00`);
}

function daysFromNow(ms) {
  return Math.max(1, Math.ceil((ms - Date.now()) / DAY_MS));
}

function formatMonthRange(start, end, locale) {
  try {
    const fmt = (d) => d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
    return `${fmt(parseDay(start))} — ${fmt(parseDay(end))}`;
  } catch { return `${start} — ${end}`; }
}

// Луна экрана: полная в герое и на скелетоне, новолуние — в «мало снов».
// Форма серпа считается тем же moonPath, что и на остальных экранах v3.
function MoonDisc({ size, frac, craters = false, glow = false, style }) {
  return (
    <svg
      className={glow ? 'v3-moon v3-moon--glow' : 'v3-moon'}
      viewBox="-50 -50 100 100"
      width={size}
      height={size}
      style={style}
      aria-hidden="true"
    >
      <circle r={48} fill="var(--v3-moon-dark)" stroke="var(--v3-moon-ring)" strokeWidth={1} />
      <path d={moonPath(frac, 48)} fill="var(--v3-moon-lit)" />
      {craters && (
        <>
          <circle cx={12} cy={-14} r={7} fill="rgba(120,72,10,.16)" />
          <circle cx={-8} cy={16} r={4.5} fill="rgba(120,72,10,.13)" />
        </>
      )}
    </svg>
  );
}

export default function MonthlySummaryModal({ onClose, onAnalyze }) {
  const { t, i18n } = useTranslation();
  const showToast = useToast();
  const locale = i18n.language === 'ru' ? 'ru-RU' : 'en-US';
  const loadingSteps = t('monthly.loadingSteps', { returnObjects: true });

  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null); // { hint, retry }
  const [showPaywall, setShowPaywall] = useState(false);
  // Сервер просит подтвердить цену перед списанием Искр: { cost, balance }.
  const [confirm, setConfirm] = useState(null);
  const timerRef = useRef(null);

  const userId = getUserId();

  const startSteps = () => {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setStep(s => (s + 1) % loadingSteps.length), 4000);
  };

  const load = async (confirmed = false) => {
    if (!userId) {
      // Гость в вебе: аналитика требует VK/TG, повтор ничего не изменит.
      setError({ hint: t('monthly.errorNoTelegram'), retry: false });
      setLoading(false);
      clearInterval(timerRef.current);
      return;
    }
    try {
      const res = await axios.post(
        `${API_BASE}/api/user/${userId}/monthly-summary?provider=${providerCode()}`,
        confirmed ? { confirm: true } : null,
        { headers: await authHeader() },
      );
      setData(res.data);
    } catch (e) {
      if (e.response?.data?.confirm_cost) {
        // Итоги платные: показываем цену и ждём согласия, списание только после него.
        setConfirm({ cost: e.response.data.cost, balance: e.response.data.balance });
      } else if (e.response?.status === 402) {
        setShowPaywall(true);
      } else {
        // 429 — сервер объясняет лимит человеческим языком, его и показываем.
        // Остальные коды прячем за общей подсказкой: технические детали
        // пользователю не нужны.
        const limit = e.response?.status === 429 ? e.response?.data?.error : null;
        setError({ hint: limit || t('monthly.errorHint'), retry: true });
      }
    } finally {
      setLoading(false);
      clearInterval(timerRef.current);
    }
  };

  useEffect(() => {
    startSteps();
    load();
    return () => clearInterval(timerRef.current);
  }, []);

  const retry = (confirmed = false) => {
    setError(null);
    setConfirm(null);
    setData(null);
    setStep(0);
    setLoading(true);
    startSteps();
    load(confirmed);
  };

  const shareSummary = async () => {
    if (!data?.ai_summary) return;
    // Одна цепочка попыток на оба экрана: без гонки с таймаутом (она рисовала
    // ложное «Скопировано» поверх успешной отправки — отчёт 7448082) и без
    // молчаливого провала, когда бридж отказал, а буфер закрыт (7449177).
    const s = data.ai_summary;
    // В VK текст уходит на стену — ссылки на Telegram в нём быть не должно.
    const key = getPlatform() === 'vk' ? 'monthly.shareTextVk' : 'monthly.shareText';
    const text = t(key, {
      insight: s.monthly_insight,
      transformation: s.key_transformation,
    });
    await shareText({ platform: getPlatform(), text, tgLink: 'https://t.me/tot_sonnic_bot', showToast, t });
  };

  const stats = data?.stats;
  const ai = data?.ai_summary;
  const month = data?.lunar_month;

  // Даты считаем от границ лунного месяца: точную дату полнолуния API не
  // отдаёт, но середина цикла даёт «через N дней» с точностью до полусуток.
  let daysToFullMoon = null;
  let nextSummaryDate = null;
  let daysToNextSummary = null;
  if (month?.start && month?.end) {
    const startMs = parseDay(month.start).getTime();
    const endMs = parseDay(month.end).getTime();
    const span = Math.max(DAY_MS, endMs - startMs);
    let full = startMs + span / 2;
    if (full < Date.now()) full += span;
    daysToFullMoon = daysFromNow(full);
    nextSummaryDate = formatDayMonth(parseDay(month.end), i18n.language);
    daysToNextSummary = daysFromNow(endMs);
  }

  const symbols = (stats?.top_symbols || []).slice(0, 5);
  const maxSymbol = symbols.length ? symbols[0][1] : 1;
  const patterns = stats?.top_patterns || [];
  const weeks = Array.isArray(stats?.weeks) ? stats.weeks : null;
  const maxWeek = weeks ? Math.max(1, ...weeks) : 1;
  const streak = stats?.streak_nights || 0;
  const delta = stats ? (stats.total_dreams - (stats.prev_month_dreams || 0)) : 0;
  const recommendations = ai?.recommendations_for_next_month || [];

  return (
    <div className="page">
      {/* Своего <header> у экрана нет — верхний отступ даёт .v3-safe-top:
          без него шапка уезжает под статус-бар и плавающие кнопки VK
          (iPhone 390×844, замер 01.09). */}
      <div className="page-scroll">
        <div className="v3-safe-top" style={{ paddingBottom: 28, display: 'flex', flexDirection: 'column', gap: 18 }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <RoundButton onClick={onClose} label={t('monthly.back')}>
              <ArrowLeftIcon style={{ width: 17, height: 17 }} />
            </RoundButton>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--v3-fg)', lineHeight: 1.2 }}>
                {t('monthly.title')}
              </div>
              {month && (
                <div style={{ fontSize: 12, color: 'var(--v3-fg-3)', marginTop: 2 }}>
                  {formatMonthRange(month.start, month.end, locale)}
                </div>
              )}
            </div>
          </div>

          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Tile radius={22} padding="26px 18px" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 15 }}>
                <MoonDisc size={88} frac={0.5} style={{ opacity: .45 }} />
                <Skeleton width={62} height={32} radius={9} />
                <Skeleton width={130} height={12} />
              </Tile>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <Skeleton />
                <Skeleton width="88%" />
                <Skeleton width="72%" />
              </div>
              <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'var(--v3-gold-txt)' }}>
                {loadingSteps[step]}
              </div>
              <div style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--v3-fg-4)' }}>
                {t('monthly.loadingHint')}
              </div>
            </div>
          )}

          {!loading && error && (
            <div style={{
              borderRadius: 22, border: '1px solid var(--v3-danger-br)', background: 'var(--v3-danger-bg)',
              padding: '28px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 13, textAlign: 'center',
            }}>
              <span style={{
                width: 52, height: 52, borderRadius: '50%', flexShrink: 0,
                background: 'var(--v3-danger-chip)', border: '1px solid var(--v3-danger-br)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <ExclamationTriangleIcon style={{ width: 26, height: 26, color: 'var(--v3-danger)' }} />
              </span>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--v3-fg)' }}>{t('monthly.errorTitle')}</div>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: 'var(--v3-fg-3)', maxWidth: 255 }}>
                {error.hint}
              </p>
              {error.retry && (
                <PillButton tone="violet" onClick={() => retry(false)} style={{ height: 46 }}>
                  {t('common.offlineRetry')}
                </PillButton>
              )}
              <PillButton tone="neutral" onClick={onClose} style={{ height: 46 }}>
                {t('monthly.backToJournal')}
              </PillButton>
            </div>
          )}

          {!loading && !error && confirm && (
            <Tile radius={22} padding="28px 18px" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 13, textAlign: 'center' }}>
              <MoonDisc size={72} frac={0.5} craters />
              <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--v3-fg)' }}>{t('monthly.confirmTitle')}</div>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--v3-fg-3)', maxWidth: 265 }}>
                {t('monthly.confirmText', { cost: confirm.cost, balance: confirm.balance })}
              </p>
              <GoldButton onClick={() => retry(true)} icon={<SparklesIcon style={{ width: 16, height: 16 }} />} style={{ marginTop: 4 }}>
                {t('monthly.confirmCta', { cost: confirm.cost })}
              </GoldButton>
              <PillButton tone="neutral" onClick={onClose} style={{ height: 46 }}>
                {t('monthly.backToJournal')}
              </PillButton>
            </Tile>
          )}

          {!loading && !error && data && !ai && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '34px 6px 0', textAlign: 'center' }}>
              <MoonDisc size={82} frac={0.02} />
              <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--v3-fg)' }}>{t('monthly.notEnoughTitle')}</div>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--v3-fg-3)', maxWidth: 265 }}>
                {t('monthly.notEnoughHint', { count: stats?.total_dreams || 0 })}
              </p>
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--v3-fg-4)' }}>
                  <span>{t('monthly.recorded', { count: stats?.total_dreams || 0 })}</span>
                  <span>{t('monthly.needDreams')}</span>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: 'var(--v3-inset)', overflow: 'hidden' }}>
                  <span style={{
                    display: 'block', height: '100%', borderRadius: 999, background: GOLD_BAR,
                    width: `${Math.round(Math.min(stats?.total_dreams || 0, MIN_DREAMS) / MIN_DREAMS * 100)}%`,
                  }} />
                </div>
              </div>
              {/* onAnalyze приходит от App через дневник; пока его не прокинули —
                  возвращаем в дневник, а не оставляем кнопку мёртвой. */}
              <GoldButton
                onClick={onAnalyze || onClose}
                icon={<MoonIcon style={{ width: 16, height: 16 }} />}
                style={{ marginTop: 4 }}
              >
                {t('home.analyzeDream')}
              </GoldButton>
              {daysToFullMoon !== null && (
                <div style={{ fontSize: 11.5, color: 'var(--v3-fg-4)' }}>
                  {t('monthly.nextFullMoon', { days: t('monthly.days', { count: daysToFullMoon }) })}
                </div>
              )}
            </div>
          )}

          {!loading && !error && ai && (
            <>
              {/* ── Цифра месяца ── */}
              <EdgeCard className="m-hero" radius={22} padding="22px 18px 18px">
                <MoonDisc size={84} frac={0.5} craters glow />
                <div style={{ textAlign: 'center' }}>
                  <div className="v3-num" style={{ lineHeight: 1 }}>{stats.total_dreams}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--v3-fg-3)', marginTop: 6 }}>
                    {t('monthly.dreams', { count: stats.total_dreams })}
                  </div>
                </div>
                {(streak > 1 || delta > 0) && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                    {streak > 1 && <Chip tone="violet">{t('monthly.streak', { count: streak })}</Chip>}
                    {delta > 0 && <Chip tone="gold">{t('monthly.delta', { n: delta })}</Chip>}
                  </div>
                )}
              </EdgeCard>

              {/* ── Послание месяца ── */}
              <EdgeCard className="m-quote" edge="quote" radius={22} padding="20px 18px">
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }} aria-hidden="true">
                  <span style={{ width: 20, height: 1, background: 'var(--v3-purple-line)' }} />
                  <SparklesIcon style={{ width: 16, height: 16, color: 'var(--v3-purple-txt)' }} />
                  <span style={{ width: 20, height: 1, background: 'var(--v3-purple-line2)' }} />
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--v3-purple-txt)' }}>
                  {t('monthly.monthlyInsight')}
                </div>
                <p style={{ margin: 0, fontSize: 15.5, fontWeight: 600, fontStyle: 'italic', lineHeight: 1.62, color: 'var(--v3-fg)', overflowWrap: 'anywhere' }}>
                  {t('monthly.quoted', { text: ai.monthly_insight })}
                </p>
              </EdgeCard>

              {/* ── Символы месяца ── */}
              {symbols.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  <SectionLabel
                    title={t('monthly.keySymbols')}
                    right={stats.unique_symbols ? t('monthly.symbolsCount', { shown: symbols.length, total: stats.unique_symbols }) : null}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {symbols.map(([symbol, count]) => (
                      <div key={symbol} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                        {/* Длинные названия усекаются — полное остаётся в title. */}
                        <span title={symbol} style={{
                          fontSize: 13, fontWeight: 600, color: 'var(--v3-fg-2)', width: 104, flexShrink: 0,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>{symbol}</span>
                        <span style={{ flex: 1, height: 8, borderRadius: 999, background: 'var(--v3-inset)', overflow: 'hidden' }}>
                          <span style={{
                            display: 'block', height: '100%', borderRadius: 999, background: GOLD_BAR,
                            width: `${Math.round(count / maxSymbol * 100)}%`,
                          }} />
                        </span>
                        <span style={{ fontSize: 11.5, color: 'var(--v3-fg-4)', width: 26, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                          {count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Повторяющиеся программы ── */}
              {patterns.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  <SectionLabel tone="danger" title={t('monthly.recurringPatterns')} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {patterns.map(([pattern, count], i) => (
                      <div key={i} style={{
                        display: 'flex', gap: 11, padding: '12px 14px', borderRadius: 14,
                        background: 'var(--v3-danger-bg)', border: '1px solid var(--v3-danger-br)',
                      }}>
                        <span aria-hidden="true" style={{ width: 2, flexShrink: 0, borderRadius: 2, alignSelf: 'stretch', background: 'var(--v3-danger)' }} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--v3-fg-2)' }}>{pattern}</div>
                          <div style={{ fontSize: 11, color: 'var(--v3-fg-4)', marginTop: 3 }}>
                            {t('monthly.patternMeta', { count, total: stats.total_dreams })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Динамика ── */}
              {ai.progress_report && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  <SectionLabel title={t('monthly.dynamics')} />
                  <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: 'var(--v3-fg-2)' }}>{ai.progress_report}</p>
                  {weeks && (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 52, paddingTop: 6 }}>
                      {weeks.map((n, i) => (
                        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                          <span style={{
                            display: 'block', width: '100%', borderRadius: 6,
                            height: Math.max(6, Math.round(n / maxWeek * 38)),
                            background: n === 0 ? 'var(--v3-inset)' : 'linear-gradient(180deg,#f5a623,#c97a10)',
                            opacity: n === 0 ? 1 : 0.55 + 0.45 * (n / maxWeek),
                          }} />
                          <span style={{ fontSize: 9.5, color: 'var(--v3-fg-4)' }}>{t('monthly.week', { n: i + 1 })}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Главная трансформация ── */}
              <div style={{
                borderRadius: 20, border: '1px solid var(--v3-chip-s-br)', background: 'var(--v3-practice)',
                padding: '17px 16px', display: 'flex', flexDirection: 'column', gap: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <CheckCircleIcon style={{ width: 17, height: 17, color: 'var(--v3-success)', flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--v3-success)' }}>
                    {t('monthly.keyTransformation')}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 600, lineHeight: 1.6, color: 'var(--v3-fg)' }}>
                  {ai.key_transformation}
                </p>
              </div>

              {/* ── На следующий месяц ── */}
              {recommendations.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  <SectionLabel title={t('monthly.recommendations')} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {recommendations.map((rec, i) => (
                      <Tile key={i} radius={14} padding="12px 14px" style={{ display: 'flex', gap: 11 }}>
                        <span style={{
                          width: 20, height: 20, borderRadius: 999, flexShrink: 0,
                          background: 'var(--v3-chip-g)', border: '1px solid var(--v3-chip-g-br)',
                          color: 'var(--v3-gold-txt)', fontSize: 11, fontWeight: 700,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>{i + 1}</span>
                        <span style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--v3-fg-2)' }}>{rec}</span>
                      </Tile>
                    ))}
                  </div>
                </div>
              )}

              <Constellation />

              {/* ── Поделиться ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <GoldButton onClick={shareSummary} icon={<ArrowUpTrayIcon style={{ width: 16, height: 16 }} />}>
                  {t('monthly.share')}
                </GoldButton>
                {nextSummaryDate && (
                  <div style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--v3-fg-4)' }}>
                    {t('monthly.nextSummary', {
                      date: nextSummaryDate,
                      days: t('monthly.days', { count: daysToNextSummary }),
                    })}
                  </div>
                )}
              </div>

              {/* Без обёртки: у карточки промо своя кромка и фон (ветка промо v3). */}
              <YupSoulPromo variant="monthly" style={{ marginBottom: 'var(--spacing-lg)' }} />
            </>
          )}
        </div>
      </div>

      {showPaywall && (
        <Paywall
          userId={userId}
          reason={t(getPlatform() === 'vk' ? 'paywall.reasonMonthlyVk' : 'paywall.reasonMonthly')}
          onClose={onClose}
        />
      )}
    </div>
  );
}
