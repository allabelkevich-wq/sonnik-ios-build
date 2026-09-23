import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftIcon, CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon,
  MoonIcon, BookOpenIcon, ExclamationTriangleIcon,
} from '@heroicons/react/24/solid';
import GoldButton from '../components/GoldButton.jsx';
import PillButton from '../components/PillButton.jsx';
import EdgeCard from '../components/EdgeCard.jsx';
import Tile from '../components/Tile.jsx';
import SectionLabel from '../components/SectionLabel.jsx';
import Chip from '../components/Chip.jsx';
import Constellation from '../components/Constellation.jsx';
import Skeleton from '../components/Skeleton.jsx';
import RoundButton from '../components/RoundButton.jsx';
import MonthlySummaryModal from './MonthlySummaryModal.jsx';
import { phaseIndex } from '../utils/moon.js';
import MoonPhase from '../components/MoonPhase.jsx';
import { localToday, formatDayMonth, signPrepositional } from '../utils/date.js';
import { getUserId, providerCode, authHeader } from '../platform.js';
import '../styles/lunarday.css';
import { serverLang } from '../i18n/index.js';

const API_BASE = import.meta.env.VITE_API_URL || '';
const PAGE = 50; // максимум, который отдаёт GET /api/user/:id/dreams


// Формат сна как в дневнике: analyses[0] + JSONB-поля, приходящие строками.
function withAnalysis(d) {
  let analysis = Array.isArray(d.analyses) ? (d.analyses[0] || null) : (d.analysis || null);
  if (analysis) {
    for (const field of ['symbols', 'destructive_patterns', 'transformations', 'recommendations', 'lunar_data', 'ritual_reprogramming']) {
      if (typeof analysis[field] === 'string') {
        try { analysis[field] = JSON.parse(analysis[field]); } catch (_) {}
      }
    }
  }
  return { ...d, analysis };
}

export default function LunarDayPage({ onBack, onAnalyze, onOpenDream }) {
  const { t, i18n } = useTranslation();
  const userId = getUserId();

  // Местная дата, не UTC: вечером в Москве toISOString() отдаёт вчерашнюю.
  const todayStr = localToday();
  const todayBase = useMemo(() => {
    const [y, m, d] = todayStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }, [todayStr]);
  const dayAt = useCallback(
    (off) => new Date(todayBase.getFullYear(), todayBase.getMonth(), todayBase.getDate() + off),
    [todayBase]
  );

  const [offset, setOffset] = useState(0); // дней от сегодня, всегда ≤ 0
  const [picker, setPicker] = useState(false);
  const [monthShift, setMonthShift] = useState(0);
  const [cache, setCache] = useState({}); // дата → ответ /api/lunar
  const [failed, setFailed] = useState({});
  const [dreams, setDreams] = useState([]);
  const [dreamsReady, setDreamsReady] = useState(!userId);
  const [dreamsMore, setDreamsMore] = useState(true);
  const [showSummary, setShowSummary] = useState(false);

  const selectedDate = dayAt(offset);
  const selectedStr = localToday(selectedDate);

  const mounted = useRef(true);
  // Флаг поднимаем НА каждом монтировании, а не только гасим при размонтировании:
  // React в режиме разработки монтирует дважды (mount → unmount → remount), и
  // после первой уборки флаг оставался false навсегда — ответы /api/lunar
  // отбрасывались, экран висел в скелетоне «Считаю лунный день…».
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // ── Лунные данные по датам ────────────────────────────────────────
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const inFlight = useRef(new Set());

  const loadLunar = useCallback((dateStr) => {
    if (cacheRef.current[dateStr] || inFlight.current.has(dateStr)) return;
    inFlight.current.add(dateStr);
    // Сегодняшний лунный день меняется в астрономический момент, а не в
    // полночь, — поэтому у сегодня свой эндпоинт с поясом устройства.
    const tz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
    const url = dateStr === todayStr
      ? `${API_BASE}/api/lunar/today?lang=${serverLang()}${tz ? `&timezone=${encodeURIComponent(tz)}` : ''}`
      : `${API_BASE}/api/lunar/${dateStr}?lang=${serverLang()}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((d) => {
        if (!d?.day_number) throw new Error('empty');
        if (mounted.current) setCache((c) => ({ ...c, [dateStr]: d }));
      })
      .catch(() => { if (mounted.current) setFailed((f) => ({ ...f, [dateStr]: true })); })
      .finally(() => { inFlight.current.delete(dateStr); });
  }, [todayStr]);

  // Выбранный день — первым, дальше сегодня (для карточки месяца) и шесть
  // предыдущих дат ленты недели. Ответы кладутся в кэш, рендер берёт из него,
  // поэтому опоздавший ответ соседней даты экран не перерисует.
  useEffect(() => {
    loadLunar(selectedStr);
    loadLunar(todayStr);
    for (let i = 1; i <= 6; i++) loadLunar(localToday(dayAt(offset - i)));
  }, [offset, selectedStr, todayStr, dayAt, loadLunar]);

  const retryDay = () => {
    setFailed((f) => ({ ...f, [selectedStr]: false }));
    loadLunar(selectedStr);
  };

  // ── Записи дневника ───────────────────────────────────────────────
  const loadingDreams = useRef(false);
  const loadDreams = useCallback(async (from) => {
    if (!userId || loadingDreams.current) return;
    loadingDreams.current = true;
    try {
      const res = await fetch(
        `${API_BASE}/api/user/${userId}/dreams?limit=${PAGE}&offset=${from}&provider=${providerCode()}`,
        { headers: await authHeader() }
      );
      if (!res.ok) throw new Error('http');
      const raw = await res.json();
      if (!mounted.current) return;
      const data = raw.map(withAnalysis);
      setDreams((prev) => (from === 0 ? data : [...prev, ...data]));
      setDreamsMore(data.length === PAGE);
    } catch (_) {
      // Тихо: счётчик и точки просто не появятся, лунные данные экрану важнее.
      if (mounted.current) setDreamsMore(false);
    } finally {
      loadingDreams.current = false;
      if (mounted.current) setDreamsReady(true);
    }
  }, [userId]);

  useEffect(() => { loadDreams(0); }, [loadDreams]);

  // Эндпоинт снов не умеет фильтровать по дате и отдаёт максимум 50 последних:
  // если самая старая загруженная запись новее начала видимого диапазона —
  // догружаем следующую страницу.
  const weekStartStr = localToday(dayAt(offset - 6));
  const monthBase = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + monthShift, 1);
  const earliestVisibleStr = picker
    ? [weekStartStr, localToday(monthBase)].sort()[0]
    : weekStartStr;

  useEffect(() => {
    if (!dreamsMore || !dreams.length) return;
    const oldest = dreams[dreams.length - 1]?.created_at;
    if (oldest && localToday(new Date(oldest)) > earliestVisibleStr) loadDreams(dreams.length);
  }, [dreams, dreamsMore, earliestVisibleStr, loadDreams]);

  const dreamsByDate = useMemo(() => {
    const map = {};
    for (const d of dreams) {
      if (!d.created_at) continue;
      const key = localToday(new Date(d.created_at));
      if (!map[key]) map[key] = [];
      map[key].push(d);
    }
    return map;
  }, [dreams]);

  // ── Производные значения ──────────────────────────────────────────
  const lunar = cache[selectedStr] || null;
  const dayFailed = !lunar && !!failed[selectedStr];
  const dayLoading = !lunar && !dayFailed;
  const fracOf = (d) => (d?.phase_angle != null ? d.phase_angle / 360 : null);
  const frac = fracOf(lunar);

  const dow = t('lunar.dow', { returnObjects: true }) || [];
  const months = t('lunar.months', { returnObjects: true }) || [];

  const relLabel = offset === 0
    ? t('lunar.today')
    : offset === -1
      ? t('lunar.yesterday')
      : t('lunar.daysAgo', { count: -offset });

  const signLabel = lunar?.moon_sign
    ? t('home.moonIn', { sign: signPrepositional(lunar.moon_sign, i18n.language) })
    : '';
  const dreamText = lunar?.dream_influence || '';
  const dreamHint = lunar?.moon_sign_dream_hint || '';
  // Та же защита от дубля, что на главной: в обычный день подсказка по знаку
  // повторяла абзац влияния слово в слово (скрин Аллы, 01.09).
  const showHint = !!dreamHint && !dreamText.includes(dreamHint);

  const dayDreams = dreamsByDate[selectedStr] || [];

  const todayLunar = cache[todayStr] || null;
  const monthStartStr = todayLunar?.day_number
    ? localToday(dayAt(-(todayLunar.day_number - 1)))
    : null;
  const monthDreams = monthStartStr
    ? dreams.filter((d) => d.created_at && localToday(new Date(d.created_at)) >= monthStartStr).length
    : 0;
  const todayDay = todayLunar?.day_number ?? null;
  const countdown = todayDay == null
    ? ''
    : todayDay < 15
      ? t('lunar.toFullMoon', { count: 15 - todayDay })
      : t('lunar.toNewMoon', { count: Math.max(1, 30 - todayDay) });

  const step = (d) => setOffset((o) => Math.min(0, o + d));
  const togglePicker = () => { setPicker((p) => !p); setMonthShift(0); };

  // Свайп по карточке дня. Касания у левого края отдаём свайпу-назад VK iOS.
  const touch = useRef(null);
  const onTouchStart = (e) => {
    const p = e.touches[0];
    touch.current = p.clientX < 24 ? null : { x: p.clientX, y: p.clientY };
  };
  const onTouchEnd = (e) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const p = e.changedTouches[0];
    const dx = p.clientX - start.x;
    const dy = p.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dy) > 40) return;
    step(dx < 0 ? -1 : 1);
  };

  // Месячная сетка
  const monthAhead = monthBase.getFullYear() > todayBase.getFullYear()
    || (monthBase.getFullYear() === todayBase.getFullYear() && monthBase.getMonth() >= todayBase.getMonth());
  const leading = (monthBase.getDay() + 6) % 7;
  const daysInMonth = new Date(monthBase.getFullYear(), monthBase.getMonth() + 1, 0).getDate();

  if (showSummary) {
    return <MonthlySummaryModal onClose={() => setShowSummary(false)} />;
  }

  return (
    <div className="page">
      <div className="page-scroll" style={{ position: 'relative', zIndex: 1 }}>
        <div className="ld-root">

          {/* ── 1. Шапка ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <RoundButton onClick={onBack} label={t('common.back')}>
              <ArrowLeftIcon style={{ width: 17, height: 17 }} />
            </RoundButton>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--v3-fg)', lineHeight: 1.2 }}>
                {t('lunar.title')}
              </div>
              <div className="h-sub" style={{ fontSize: 12, color: 'var(--v3-fg-3)', marginTop: 2 }}>
                {t('lunar.subtitle')}
              </div>
            </div>
            <RoundButton onClick={togglePicker} label={t('lunar.title')}>
              <CalendarDaysIcon style={{ width: 17, height: 17 }} />
            </RoundButton>
          </div>

          {/* ── 2. Навигация по дате ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RoundButton onClick={() => step(-1)} label={t('lunar.yesterday')}>
              <ChevronLeftIcon style={{ width: 15, height: 15 }} />
            </RoundButton>
            <button type="button" className="ld-btn" onClick={togglePicker} style={{ flex: 1, textAlign: 'center', minHeight: 44 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--v3-fg)' }}>
                {formatDayMonth(selectedDate, i18n.language)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--v3-fg-4)', marginTop: 2 }}>{relLabel}</div>
            </button>
            <RoundButton onClick={() => step(1)} disabled={offset === 0} label={t('lunar.today')}>
              <ChevronRightIcon style={{ width: 15, height: 15 }} />
            </RoundButton>
          </div>

          {/* ── 3. Месячная сетка ── */}
          {picker && (
            <Tile radius={20} padding="14px 13px" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <button type="button" className="ld-btn ld-mbtn" onClick={() => setMonthShift((m) => m - 1)} aria-label={t('lunar.prevMonth')}>
                  <ChevronLeftIcon style={{ width: 13, height: 13 }} />
                </button>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--v3-fg-2)' }}>
                  {`${months[monthBase.getMonth()] || ''} ${monthBase.getFullYear()}`}
                </div>
                <button type="button" className="ld-btn ld-mbtn" onClick={() => setMonthShift((m) => m + 1)} disabled={monthAhead} aria-label={t('lunar.nextMonth')}>
                  <ChevronRightIcon style={{ width: 13, height: 13 }} />
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3 }}>
                {dow.map((w) => (
                  <span key={w} style={{ fontSize: 9.5, fontWeight: 600, textAlign: 'center', color: 'var(--v3-fg-4)', paddingBottom: 2 }}>{w}</span>
                ))}
                {Array.from({ length: leading }, (_, i) => <span key={`e${i}`} style={{ height: 34 }} />)}
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const cell = new Date(monthBase.getFullYear(), monthBase.getMonth(), i + 1);
                  const cellStr = localToday(cell);
                  const future = cellStr > todayStr;
                  const active = cellStr === selectedStr;
                  const marked = !!dreamsByDate[cellStr];
                  return (
                    <button
                      key={cellStr}
                      type="button"
                      className="ld-btn ld-cell"
                      disabled={future}
                      onClick={() => {
                        setOffset(Math.round((cell.getTime() - todayBase.getTime()) / 86400000));
                        setPicker(false);
                        setMonthShift(0);
                      }}
                      style={{
                        fontWeight: active ? 700 : 500,
                        color: future ? 'var(--v3-fg-4)' : active ? '#1a0800' : 'var(--v3-fg-2)',
                        background: active
                          ? 'linear-gradient(135deg,#f5a623,#c97a10)'
                          : marked ? 'var(--v3-chip-g)' : 'transparent',
                        borderColor: marked && !active ? 'var(--v3-chip-g-br)' : 'transparent',
                      }}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
            </Tile>
          )}

          {/* ── 4. Загрузка ── */}
          {dayLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Tile radius={22} padding="26px 18px" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <Skeleton width={110} height={110} radius="50%" />
                <Skeleton width={64} height={30} radius={8} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <Skeleton width={86} height={22} radius={999} />
                  <Skeleton width={104} height={22} radius={999} />
                </div>
                <Skeleton width="100%" height={14} />
                <Skeleton width="72%" height={14} />
              </Tile>
              <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--v3-fg-4)' }}>{t('lunar.loading')}</div>
            </div>
          )}

          {/* ── 5. Ошибка ── */}
          {dayFailed && (
            <div style={{
              borderRadius: 22, border: '1px solid var(--v3-danger-br)', background: 'var(--v3-danger-bg)',
              padding: '26px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 13, textAlign: 'center',
            }}>
              <span style={{
                width: 52, height: 52, borderRadius: '50%', background: 'var(--v3-danger-chip)',
                border: '1px solid var(--v3-danger-br)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <ExclamationTriangleIcon style={{ width: 26, height: 26, color: 'var(--v3-danger)' }} />
              </span>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--v3-fg)' }}>{t('lunar.errorTitle')}</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--v3-fg-3)', maxWidth: 250 }}>{t('lunar.errorHint')}</div>
              <PillButton tone="violet" onClick={retryDay} style={{ height: 46 }}>{t('common.offlineRetry')}</PillButton>
            </div>
          )}

          {lunar && (
            <>
              {/* ── 6. Карточка дня ── */}
              <EdgeCard edge="violet" radius={22} padding="22px 18px 18px" style={{ touchAction: 'pan-y' }}>
                <div
                  onTouchStart={onTouchStart}
                  onTouchEnd={onTouchEnd}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}
                >
                  <MoonPhase frac={frac} size={132} glow event={lunar.moon_event?.key} />
                  <div style={{ textAlign: 'center' }}>
                    <div style={{
                      fontSize: 32, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1,
                      color: 'var(--v3-gold-txt)', fontVariantNumeric: 'tabular-nums',
                    }}>{lunar.day_number}</div>
                    <div style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase',
                      color: 'var(--v3-gold-label)', marginTop: 6,
                    }}>{t('home.lunarDayLabel')}</div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 6 }}>
                    {frac != null
                      ? <Chip tone="violet">{t(`lunar.phases.${phaseIndex(frac)}`)}</Chip>
                      : lunar.moon_phase && <Chip tone="violet">{lunar.moon_phase}</Chip>}
                    {lunar.illumination != null && (
                      <Chip tone="violet">{t('lunar.illuminated', { pct: Math.round(lunar.illumination * 100) })}</Chip>
                    )}
                    {signLabel && <Chip tone="gold">{signLabel}</Chip>}
                    {/* Имя особой ночи: кровавая, суперлуние, голубая. Обычно его нет. */}
                    {lunar.moon_event?.title && <Chip tone="danger">{lunar.moon_event.title}</Chip>}
                  </div>
                  {lunar.moon_event?.hint && (
                    <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--v3-fg-3)', textAlign: 'center', maxWidth: 290 }}>
                      {lunar.moon_event.hint}
                    </div>
                  )}
                  {lunar.day_meaning && (
                    <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--v3-fg-2)', textAlign: 'center', maxWidth: 290 }}>
                      {lunar.day_meaning}
                    </div>
                  )}
                </div>
              </EdgeCard>

              {/* ── 7. Главное действие ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <GoldButton onClick={onAnalyze} icon={<MoonIcon style={{ width: 15, height: 15, color: '#1a0800' }} />}>
                  {t('home.analyzeDream')}
                </GoldButton>
                <div style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--v3-fg-4)' }}>
                  {`${t('home.analyzeHint')} · ${t('home.analyzeHintTime')}`}
                </div>
              </div>

              {/* ── 8. Неделя ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <SectionLabel title={t('lunar.week')} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 5 }}>
                  {Array.from({ length: 7 }, (_, i) => {
                    const off = offset - 6 + i;
                    const d = dayAt(off);
                    const str = localToday(d);
                    const active = str === selectedStr;
                    return (
                      <button
                        key={str}
                        type="button"
                        className="ld-btn ld-day"
                        onClick={() => setOffset(off)}
                        style={{
                          background: active ? 'var(--v3-sel)' : 'transparent',
                          borderColor: active ? 'var(--v3-sel-br)' : 'transparent',
                        }}
                      >
                        <span style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--v3-fg-4)' }}>{dow[(d.getDay() + 6) % 7]}</span>
                        <MoonPhase frac={fracOf(cache[str])} size={26} />
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--v3-fg-2)', fontVariantNumeric: 'tabular-nums' }}>{d.getDate()}</span>
                        <span style={{
                          width: 4, height: 4, borderRadius: 999, marginTop: 1,
                          background: dreamsByDate[str] ? 'var(--v3-gold-txt)' : 'transparent',
                        }} />
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── 9. Сны в этот день ── */}
              {(dreamText || showHint) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <SectionLabel title={t('lunar.dreamsThisDay')} />
                  <Tile radius={20} padding="15px 16px" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                    {dreamText && (
                      <div style={{ fontSize: 13.5, lineHeight: 1.62, color: 'var(--v3-fg-2)' }}>{dreamText}</div>
                    )}
                    {showHint && (
                      <div style={{ display: 'flex', gap: 11, padding: '11px 13px', borderRadius: 13, background: 'var(--v3-chip-g)' }}>
                        <span style={{ width: 2, flexShrink: 0, borderRadius: 2, background: 'var(--v3-gold-txt)' }} />
                        <span style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--v3-gold-txt)' }}>
                          {signLabel ? `${signLabel}: ${dreamHint}` : dreamHint}
                        </span>
                      </div>
                    )}
                  </Tile>
                </div>
              )}

              {/* ── 10. Ваши записи ── */}
              {userId && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <SectionLabel
                    title={t('lunar.yourRecords')}
                    right={!dreamsReady ? null : dayDreams.length
                      ? t('journal.records', { count: dayDreams.length })
                      : t('lunar.noRecords')}
                  />
                  {dayDreams.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {dayDreams.map((d) => (
                        <Tile
                          key={d.id}
                          as="button"
                          radius={18}
                          padding="14px 15px"
                          onClick={() => onOpenDream?.(d)}
                          style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                        >
                          <span style={{
                            width: 34, height: 34, borderRadius: 12, flexShrink: 0, background: 'var(--v3-chip-g)',
                            border: '1px solid var(--v3-chip-g-br)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <BookOpenIcon style={{ width: 17, height: 17, color: 'var(--v3-gold-txt)' }} />
                          </span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{
                              display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--v3-fg)',
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>{d.dream_text}</span>
                            <span style={{ display: 'block', fontSize: 11.5, color: 'var(--v3-fg-4)', marginTop: 2 }}>
                              {d.analysis
                                ? `${t('lunar.symbols', { count: d.analysis.symbols?.length || 0 })} · ${t('lunar.programs', { count: d.analysis.destructive_patterns?.length || 0 })}`
                                : t('journal.noAnalysis')}
                            </span>
                          </span>
                          <ChevronRightIcon style={{ width: 14, height: 14, flexShrink: 0, color: 'var(--v3-fg-4)' }} />
                        </Tile>
                      ))}
                    </div>
                  )}
                  {dreamsReady && dayDreams.length === 0 && (
                    <div style={{
                      borderRadius: 18, border: '1px dashed var(--v3-tile-br)', padding: '18px 16px',
                      textAlign: 'center', fontSize: 13, lineHeight: 1.55, color: 'var(--v3-fg-3)',
                    }}>
                      {t('lunar.emptyDay')}
                      {offset === 0 && <><br />{t('lunar.emptyDayToday')}</>}
                    </div>
                  )}
                </div>
              )}

              {/* ── 11–12. Финал: лунный месяц ── */}
              {userId && todayLunar && (
                <>
                  <Constellation twinkle={false} />
                  <Tile
                    as="button"
                    radius={20}
                    padding="16px"
                    onClick={() => setShowSummary(true)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 13, cursor: 'pointer',
                      background: 'var(--v3-closing)', borderColor: 'var(--v3-chip-g-br)',
                    }}
                  >
                    <MoonPhase frac={0.5} size={38} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--v3-fg)' }}>
                        {t('lunar.monthTitle', { count: monthDreams })}
                      </span>
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--v3-fg-3)', marginTop: 2 }}>
                        {t('lunar.monthSub', { countdown })}
                      </span>
                    </span>
                    <ChevronRightIcon style={{ width: 14, height: 14, flexShrink: 0, color: 'var(--v3-gold-txt)' }} />
                  </Tile>
                </>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  );
}
