import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftIcon, SparklesIcon, GlobeEuropeAfricaIcon, ScissorsIcon, PaintBrushIcon,
  BeakerIcon, SunIcon, HeartIcon, FireIcon, HandRaisedIcon, LockClosedIcon, ScaleIcon,
} from '@heroicons/react/24/solid';
import EdgeCard from '../components/EdgeCard.jsx';
import Tile from '../components/Tile.jsx';
import Chip from '../components/Chip.jsx';
import SectionLabel from '../components/SectionLabel.jsx';
import MoonPhase from '../components/MoonPhase.jsx';
import Constellation from '../components/Constellation.jsx';
import GoldButton from '../components/GoldButton.jsx';
import PillButton from '../components/PillButton.jsx';
import Skeleton from '../components/Skeleton.jsx';
import { useScrollLock } from '../hooks/useScrollLock.js';
import { getUserId, providerCode, authHeader } from '../platform.js';
import { formatDayMonth, signPrepositional } from '../utils/date.js';
import { EPOCH } from '../utils/moon.js';
import '../styles/calendar.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Фазы приходят строками бэкенда (MOON_PHASE_HAIR в server.js) — переводим их
// через уже существующие ключи lunar.phases.{0..7} (индексы utils/moon.js).
const PHASE_INDEX = {
  'Новолуние': 0, 'Первая четверть': 2, 'Растущая Луна': 3,
  'Полнолуние': 4, 'Убывающая Луна': 5, 'Последняя четверть': 6,
};
const WAXING_PHASES = ['Новолуние', 'Растущая Луна', 'Первая четверть'];
const isWaxing = (phase) => WAXING_PHASES.includes(phase);
const isEdgePhase = (phase) => phase === 'Новолуние' || phase === 'Полнолуние';

const CATEGORIES = [
  { id: 'cut', group: 'hair', Icon: ScissorsIcon },
  { id: 'color', group: 'hair', Icon: PaintBrushIcon },
  { id: 'skin', group: 'skin', Icon: SparklesIcon, waxing: true },
  { id: 'cosm', group: 'skin', Icon: BeakerIcon, waxing: false },
  { id: 'epil', group: 'body', Icon: SunIcon, waxing: false },
  { id: 'mass', group: 'body', Icon: HeartIcon, waxing: false },
  { id: 'bath', group: 'body', Icon: FireIcon, waxing: false },
  { id: 'nails', group: 'nails', Icon: HandRaisedIcon, waxing: true },
];
const GROUPS = ['hair', 'skin', 'body', 'nails'];

// Оценки стрижки и окрашивания считает бэкенд (четыре слоя + персональный бонус).
// Остальные шесть категорий он пока не отдаёт — до появления полей в days[i]
// считаем их на клиенте по фазе Луны: своя фаза — 4, противоположная — 2,
// новолуние и полнолуние — 3 (баня в полнолуние — 2, реакция сердца).
// Как только API начнёт присылать оценки категорий, правило заменяется чтением поля.
function scoreFor(cat, day) {
  if (!day) return 3;
  // Оценка приходит с сервера числом 1–5. Если поля вдруг нет, показываем
  // нейтральное «Можно», а не ключ перевода calendar.score прямо на экране.
  const rating = (v) => (Number.isFinite(v) ? v : 3);
  if (cat.id === 'cut') return rating(day.cut_rating);
  if (cat.id === 'color') return rating(day.color_rating);
  if (isEdgePhase(day.moon_phase)) {
    return cat.id === 'bath' && day.moon_phase === 'Полнолуние' ? 2 : 3;
  }
  return isWaxing(day.moon_phase) === cat.waxing ? 4 : 2;
}

const TONE_GOOD = { fg: 'var(--v3-success)', bg: 'var(--v3-chip-s)', br: 'var(--v3-chip-s-br)', chip: 'success' };
const TONE_MID = { fg: 'var(--v3-gold-txt)', bg: 'var(--v3-chip-g)', br: 'var(--v3-chip-g-br)', chip: 'gold' };
const TONE_BAD = { fg: 'var(--v3-danger)', bg: 'var(--v3-danger-chip)', br: 'var(--v3-danger-br)', chip: 'danger' };
const toneFor = (score) => (score >= 4 ? TONE_GOOD : score <= 2 ? TONE_BAD : TONE_MID);

// 'ГГГГ-ММ-ДД' → полдень по местному времени: голая дата разбирается как UTC,
// и западнее Гринвича день съезжал на предыдущий.
const toDate = (s) => new Date(`${s}T12:00:00`);

// MoonPhase рисует серп от даты, а номер лунного дня считает сервер
// (astronomy-engine). Чтобы картинка сходилась с подписью, подставляем дату
// той же фазы: frac = (день − 0.5) / синодический месяц.
const dateForLunarDay = (n) => new Date((EPOCH + n - 0.5) * 86400000);

// «3 сен» — короткая дата для строк разгрузки.
function dayMonthShort(date, lang) {
  if (lang === 'ru') {
    const [day, month] = formatDayMonth(date, 'ru').split(' ');
    return `${day} ${month.slice(0, 3)}`;
  }
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

const CAPTION = {
  fontSize: 10, fontWeight: 700, letterSpacing: '.18em',
  textTransform: 'uppercase', color: 'var(--v3-gold-label)',
};

export default function HairCalendarPage({ onBack, onProfile }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'ru' ? 'ru' : 'en';
  const locale = lang === 'ru' ? 'ru-RU' : 'en-US';

  const [tab, setTab] = useState('beauty');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(null);
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [hasBirthData, setHasBirthData] = useState(null);
  const [natalMoonSign, setNatalMoonSign] = useState('');
  const [dragY, setDragY] = useState(0);
  const dragging = useRef(false);
  const dragStartY = useRef(0);
  const sheetRef = useRef(null);

  const userId = getUserId();

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const tz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
        let url = `${API_BASE}/api/lunar/hair-calendar?days=14`;
        if (tz) url += `&timezone=${encodeURIComponent(tz)}`;
        // Персональный слой сервер отдаёт по сессии из Authorization,
        // user_id в query больше не принимается (чужую персонализацию
        // нельзя было бы читать перебором id).
        const res = await fetch(url, { headers: await authHeader() });
        if (res.ok) {
          const data = await res.json();
          setDays(data.days || []);
        } else {
          setDays([]);
        }
      } catch (e) {
        console.error(e);
        setDays([]);
      } finally {
        setLoading(false);
      }

      if (userId) {
        try {
          const natalRes = await fetch(`${API_BASE}/api/user/${userId}/natal?provider=${providerCode()}`, {
            headers: await authHeader(),
          });
          if (natalRes.ok) {
            const natalData = await natalRes.json();
            setHasBirthData(natalData.has_birth_data === true);
            // Знак приходит как «Стрелец (Сагиттариус)» — чистим так же, как сервер.
            const raw = natalData.natal_chart?.planets?.moon?.sign || '';
            // Из «Мина (Рыбы)» берём привычное «Рыбы», а не санскрит: строка вида
            // «Мина (Рыбы)» раньше резалась ровно наоборот.
            setNatalMoonSign((raw.match(/\(([^)]+)\)/)?.[1] || raw).trim());
          } else {
            setHasBirthData(false);
          }
        } catch {
          setHasBirthData(false);
        }
      } else {
        setHasBirthData(false);
      }
    };
    load();
  }, [attempt]);

  useScrollLock(!!open);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('keydown', onKey);
    sheetRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const beauty = tab === 'beauty';
  const day = days[offset] || null;
  const waxing = day ? isWaxing(day.moon_phase) : true;
  const failed = !loading && days.length === 0;

  const phaseLine = (d) => `${t(`lunar.phases.${PHASE_INDEX[d.moon_phase] ?? 3}`)} · ${t('calendar.moonIn', { sign: signPrepositional(d.moon_sign, lang) })}`;
  const scoreWord = (score) => t(`calendar.score.${score}`);

  const headerDate = formatDayMonth(day ? toDate(day.date) : new Date(), lang);

  // Вердикт красоты берёт тон от стрижки — она опорная категория экрана.
  const verdict = beauty
    ? (day && day.cut_rating >= 4
      ? {
        title: t('calendar.verdict.hairGood'),
        text: t('calendar.verdict.hairGoodText') + (day.color_rating <= 2 ? t('calendar.verdict.colorPostpone') : ''),
        tone: toneFor(day.cut_rating),
      }
      : {
        title: t('calendar.verdict.calm'),
        text: t('calendar.verdict.calmText'),
        tone: toneFor(day ? day.cut_rating : 3),
      })
    : (waxing
      ? { title: t('calendar.verdict.bodyGains'), text: t('calendar.verdict.bodyGainsText'), tone: TONE_GOOD }
      : { title: t('calendar.verdict.bodyReleases'), text: t('calendar.verdict.bodyReleasesText'), tone: TONE_GOOD });

  const openCat = CATEGORIES.find(c => c.id === open) || null;
  const openScore = openCat ? scoreFor(openCat, day) : 3;
  const openTone = toneFor(openScore);
  const nextGood = openCat ? days.find((d, i) => i > offset && scoreFor(openCat, d) >= 4) : null;

  const fastDay = days.find((d, i) => i > offset && (d.moon_phase === 'Убывающая Луна' || d.moon_phase === 'Последняя четверть'));
  const dietStart = days.find((d, i) => i > 0 && days[i - 1].moon_phase === 'Полнолуние');

  const onSheetTouchStart = (e) => {
    if (e.currentTarget.scrollTop > 0) { dragging.current = false; return; }
    dragStartY.current = e.touches[0].clientY;
    dragging.current = true;
  };
  const onSheetTouchMove = (e) => {
    if (!dragging.current) return;
    const dy = e.touches[0].clientY - dragStartY.current;
    if (dy > 0) setDragY(dy);
  };
  const onSheetTouchEnd = () => {
    if (!dragging.current) return;
    dragging.current = false;
    if (dragY > 90) setOpen(null);
    setDragY(0);
  };

  const tabStyle = (on) => ({
    flex: 1, minHeight: 44, borderRadius: 999, display: 'flex',
    alignItems: 'center', justifyContent: 'center', gap: 7,
    fontSize: 13.5, fontWeight: 700,
    color: on ? '#1a0800' : 'var(--v3-fg-3)',
    background: on ? 'linear-gradient(135deg,#f5a623,#c97a10)' : 'transparent',
    transition: 'background .2s, color .2s',
  });

  const iconBox = (tone, size, radius, icon) => (
    <span style={{
      width: size, height: size, borderRadius: radius, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: tone.bg, border: `1px solid ${tone.br}`, color: tone.fg,
    }}>{icon}</span>
  );

  const fastRow = (d, title, sub) => (
    <Tile radius={15} padding="13px 15px" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{
        width: 36, height: 36, borderRadius: 11, flexShrink: 0,
        background: 'var(--v3-chip-g)', border: '1px solid var(--v3-chip-g-br)',
        color: 'var(--v3-gold-txt)', fontSize: 14, fontWeight: 800,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{d.lunar_day}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{title}</div>
        <div style={{ fontSize: 11.5, color: 'var(--v3-fg-4)', marginTop: 2 }}>{sub}</div>
      </div>
      <span style={{ fontSize: 11.5, color: 'var(--v3-fg-4)', flexShrink: 0 }}>
        {dayMonthShort(toDate(d.date), lang)}
      </span>
    </Tile>
  );

  return (
    <div className="page">
      {/* Шапка в <header> — правило globals.css даёт отступ под чёлку и кнопки VK. */}
      <header style={{
        textAlign: 'left',
        margin: 'var(--v3-top) 0 0',
        padding: '4px 20px 12px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button
          type="button"
          onClick={onBack}
          aria-label={t('common.back')}
          className="cal-btn"
          style={{
            width: 44, height: 44, borderRadius: 999, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--v3-tile)', border: '1px solid var(--v3-tile-br)',
          }}
        >
          <ArrowLeftIcon style={{ width: 17, height: 17, color: 'var(--v3-fg-2)' }} />
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--fg)', lineHeight: 1.2 }}>
            {t('calendar.title')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--v3-fg-3)', marginTop: 2 }}>
            {`${t(beauty ? 'calendar.tabBeauty' : 'calendar.tabFood')} · ${headerDate}`}
          </div>
        </div>
      </header>

      {/* Вкладки «Красота» / «Питание» */}
      <div style={{ flexShrink: 0, padding: '0 20px 12px' }}>
        <div style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 999, background: 'var(--v3-inset)' }}>
          <button
            type="button" className="cal-btn" aria-pressed={beauty}
            onClick={() => { setTab('beauty'); setOpen(null); }}
            style={tabStyle(beauty)}
          >
            <SparklesIcon style={{ width: 15, height: 15 }} />
            {t('calendar.tabBeauty')}
          </button>
          <button
            type="button" className="cal-btn" aria-pressed={!beauty}
            onClick={() => { setTab('food'); setOpen(null); }}
            style={tabStyle(!beauty)}
          >
            <GlobeEuropeAfricaIcon style={{ width: 15, height: 15 }} />
            {t('calendar.tabFood')}
          </button>
        </div>
      </div>

      <div className="page-scroll" style={{
        paddingTop: 2,
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 28px)',
        display: 'flex', flexDirection: 'column', gap: 18,
      }}>

        {loading && (
          <>
            <EdgeCard radius={22} padding="20px 18px">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
                  <Skeleton width={64} height={64} radius={32} style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Skeleton width="60%" height={14} />
                    <Skeleton width="40%" height={12} style={{ marginTop: 8 }} />
                  </div>
                </div>
                <Skeleton height={58} radius={16} />
              </div>
            </EdgeCard>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Skeleton width={80} height={10} />
              {[0, 1, 2, 3].map(i => <Skeleton key={i} height={56} radius={16} />)}
            </div>
          </>
        )}

        {failed && (
          <EdgeCard radius={22} padding="20px 18px">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)' }}>{t('calendar.errorTitle')}</div>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--v3-fg-3)' }}>{t('calendar.errorHint')}</div>
              <PillButton onClick={() => setAttempt(a => a + 1)}>{t('common.retry')}</PillButton>
            </div>
          </EdgeCard>
        )}

        {!loading && day && (
          <>
            {/* ── Карточка выбранного дня ── */}
            <EdgeCard radius={22} padding="20px 18px">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
                  <MoonPhase
                    date={dateForLunarDay(day.lunar_day)}
                    size={64}
                    style={{ filter: 'drop-shadow(0 0 18px rgba(232,146,10,.2))' }}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={CAPTION}>
                      {offset === 0 ? t('calendar.today')
                        : offset === 1 ? t('calendar.tomorrow')
                          : formatDayMonth(toDate(day.date), lang)}
                    </div>
                    <div style={{
                      fontSize: 20, fontWeight: 800, letterSpacing: '-.02em',
                      color: 'var(--fg)', marginTop: 4, lineHeight: 1.2,
                    }}>
                      {t('calendar.lunarDay', { n: day.lunar_day })}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--v3-fg-3)', marginTop: 3 }}>{phaseLine(day)}</div>
                  </div>
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 11, padding: '13px 15px',
                  borderRadius: 16, background: verdict.tone.bg, border: `1px solid ${verdict.tone.br}`,
                }}>
                  <span style={{
                    display: 'block', width: 10, height: 10, borderRadius: '50%',
                    flexShrink: 0, background: verdict.tone.fg,
                  }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: verdict.tone.fg }}>{verdict.title}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--v3-fg-3)', marginTop: 2, lineHeight: 1.45 }}>{verdict.text}</div>
                  </div>
                </div>
              </div>
            </EdgeCard>

            {/* ── Красота: четыре группы категорий ── */}
            {beauty && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {GROUPS.map(group => (
                  <div key={group} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <SectionLabel title={t(`calendar.groups.${group}`)} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {CATEGORIES.filter(c => c.group === group).map(cat => {
                        const score = scoreFor(cat, day);
                        const tone = toneFor(score);
                        return (
                          <Tile
                            key={cat.id}
                            as="button"
                            radius={16}
                            padding="11px 14px"
                            onClick={() => setOpen(cat.id)}
                            className="cal-btn"
                            style={{
                              display: 'flex', alignItems: 'center', gap: 12, minHeight: 56,
                              width: '100%', background: 'var(--v3-tile)', border: '1px solid var(--v3-tile-br)',
                            }}
                          >
                            {iconBox(tone, 36, 12, <cat.Icon style={{ width: 17, height: 17 }} />)}
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>
                                {t(`calendar.categories.${cat.id}.name`)}
                              </div>
                              <div style={{ fontSize: 11.5, color: 'var(--v3-fg-4)', marginTop: 2 }}>
                                {t(`calendar.categories.${cat.id}.hint`)}
                              </div>
                            </div>
                            <Chip tone={tone.chip} style={{ fontSize: 11.5, fontWeight: 700, flexShrink: 0 }}>
                              {scoreWord(score)}
                            </Chip>
                          </Tile>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Питание ── */}
            {!beauty && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 17 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <SectionLabel title={t('calendar.eat')} tone="success" />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                    {t('calendar.eatItems', { returnObjects: true }).map(item => (
                      <Chip key={item} tone="success" style={{ fontSize: 12.5, padding: '7px 13px' }}>{item}</Chip>
                    ))}
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--v3-fg-3)' }}>
                    {t(waxing ? 'calendar.eatWhyWaxing' : 'calendar.eatWhyWaning')}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <SectionLabel title={t('calendar.avoid')} tone="danger" />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                    {t('calendar.avoidItems', { returnObjects: true }).map(item => (
                      <Chip key={item} tone="danger" style={{ fontSize: 12.5, padding: '7px 13px' }}>{item}</Chip>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
                  <Tile radius={17} padding="14px 15px">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      {/* Капли в heroicons 2.2 нет — путь из референса. */}
                      <svg viewBox="0 0 24 24" fill="var(--v3-purple-txt)" style={{ width: 15, height: 15 }} aria-hidden="true">
                        <path d="M12 2.25c-.414 0-.75.336-.75.75 0 3.75-4.5 6.75-4.5 11.25a5.25 5.25 0 1 0 10.5 0c0-4.5-4.5-7.5-4.5-11.25a.75.75 0 0 0-.75-.75Z" />
                      </svg>
                      <span style={{ ...CAPTION, letterSpacing: '.14em', color: 'var(--v3-fg-4)' }}>{t('calendar.water')}</span>
                    </div>
                    <div style={{
                      fontSize: 19, fontWeight: 800, marginTop: 7,
                      color: 'var(--v3-purple-txt)', fontVariantNumeric: 'tabular-nums',
                    }}>
                      {t(waxing ? 'calendar.waterWaxing' : 'calendar.waterWaning')}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--v3-fg-4)', marginTop: 2, lineHeight: 1.4 }}>
                      {t(waxing ? 'calendar.waterWaxingHint' : 'calendar.waterWaningHint')}
                    </div>
                  </Tile>
                  <Tile radius={17} padding="14px 15px">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <ScaleIcon style={{ width: 15, height: 15, color: 'var(--v3-gold-txt)' }} />
                      <span style={{ ...CAPTION, letterSpacing: '.14em', color: 'var(--v3-fg-4)' }}>{t('calendar.vitamins')}</span>
                    </div>
                    <div style={{ fontSize: 19, fontWeight: 800, marginTop: 7, color: 'var(--v3-gold-txt)' }}>
                      {t(waxing ? 'calendar.vitaminsYes' : 'calendar.vitaminsNo')}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--v3-fg-4)', marginTop: 2, lineHeight: 1.4 }}>
                      {t(waxing ? 'calendar.vitaminsYesHint' : 'calendar.vitaminsNoHint')}
                    </div>
                  </Tile>
                </div>

                {(fastDay || dietStart) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <SectionLabel title={t('calendar.fasting')} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {fastDay && fastRow(fastDay, t('calendar.fastDay'), t('calendar.fastDaySub'))}
                      {dietStart && fastRow(dietStart, t('calendar.dietStart'), t('calendar.dietStartSub'))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Ближайшие две недели ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <SectionLabel title={t('calendar.twoWeeks')} />
              <div className="cal-strip" style={{
                display: 'flex', gap: 6, paddingBottom: 4,
                margin: '0 -20px', paddingLeft: 20, paddingRight: 20,
              }}>
                {days.map((d, i) => {
                  const selected = i === offset;
                  // В «Красоте» точка — тон стрижки (опорная категория), в «Питании»
                  // красной точки нет: убывающая — зелёная, остальное — золотая.
                  const dotTone = beauty
                    ? toneFor(d.cut_rating)
                    : (!isWaxing(d.moon_phase) && !isEdgePhase(d.moon_phase) ? TONE_GOOD : TONE_MID);
                  return (
                    <button
                      key={d.date}
                      type="button"
                      className="cal-btn"
                      onClick={() => setOffset(i)}
                      aria-pressed={selected}
                      style={{
                        width: 52, flexShrink: 0, minHeight: 66, borderRadius: 15,
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center',
                        background: selected ? 'linear-gradient(150deg,#f5a623,#c97a10)' : 'var(--v3-tile)',
                        border: `1px solid ${selected ? 'transparent' : 'var(--v3-tile-br)'}`,
                        color: selected ? '#1a0800' : 'var(--v3-fg-2)',
                      }}
                    >
                      <span style={{
                        fontSize: 9.5, fontWeight: 600, letterSpacing: '.06em',
                        textTransform: 'uppercase', opacity: .65,
                      }}>
                        {toDate(d.date).toLocaleDateString(locale, { weekday: 'short' })}
                      </span>
                      <span style={{
                        fontSize: 16, fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginTop: 3,
                      }}>
                        {toDate(d.date).getDate()}
                      </span>
                      <span style={{
                        display: 'block', width: 6, height: 6, borderRadius: '50%', marginTop: 5,
                        background: selected ? 'rgba(26,8,0,.55)' : dotTone.fg,
                      }} />
                    </button>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', paddingTop: 2 }}>
                {[
                  { key: 'calendar.legendBest', color: 'var(--v3-success)' },
                  { key: 'calendar.legendNeutral', color: 'var(--v3-gold-txt)' },
                  { key: 'calendar.legendSkip', color: 'var(--v3-danger)' },
                ].map(item => (
                  <span key={item.key} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    fontSize: 11, color: 'var(--v3-fg-4)',
                  }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: item.color, display: 'block' }} />
                    {t(item.key)}
                  </span>
                ))}
              </div>
            </div>

            {/* ── Персональный календарь: нет даты рождения ── */}
            {hasBirthData === false && (
              <div style={{
                borderRadius: 20, border: '1px solid var(--v3-chip-g-br)',
                background: 'var(--v3-upsell)', padding: '17px 16px',
                display: 'flex', flexDirection: 'column', gap: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <span style={{
                    width: 38, height: 38, borderRadius: 12, flexShrink: 0,
                    background: 'var(--v3-chip-g)', border: '1px solid var(--v3-chip-g-br)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <LockClosedIcon style={{ width: 18, height: 18, color: 'var(--v3-gold-txt)' }} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)' }}>{t('calendar.needBirthTitle')}</div>
                    <div style={{ fontSize: 12, color: 'var(--v3-fg-3)', marginTop: 2, lineHeight: 1.45 }}>
                      {t('calendar.needBirthText')}
                    </div>
                  </div>
                </div>
                {onProfile && <GoldButton onClick={onProfile}>{t('calendar.needBirthCta')}</GoldButton>}
              </div>
            )}

            {/* ── Для вас: персональные советы дня ── */}
            {hasBirthData === true && day.personal?.tips?.length > 0 && (
              <EdgeCard edge="quote" radius={22} padding="19px 17px">
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <SparklesIcon style={{ width: 16, height: 16, flexShrink: 0, color: 'var(--v3-purple-txt)' }} />
                  <span style={{ ...CAPTION, color: 'var(--v3-purple-txt)' }}>
                    {natalMoonSign
                      ? t('calendar.forYou', { sign: signPrepositional(natalMoonSign, lang) })
                      : t('calendar.forYouShort')}
                  </span>
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--v3-fg-2)' }}>
                  {day.personal.tips.map((tip, i) => (
                    <p key={i} style={{ margin: i === 0 ? 0 : '6px 0 0' }}>{tip}</p>
                  ))}
                </div>
              </EdgeCard>
            )}

            <Constellation />

            <div style={{ textAlign: 'center', fontSize: 11.5, lineHeight: 1.5, color: 'var(--v3-fg-4)' }}>
              {t('calendar.footer')}
            </div>
          </>
        )}
      </div>

      {/* ── Шторка категории ── */}
      {openCat && day && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 900,
            background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-end',
          }}
          onClick={() => setOpen(null)}
        >
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={t(`calendar.categories.${openCat.id}.name`)}
            tabIndex={-1}
            onClick={e => e.stopPropagation()}
            onTouchStart={onSheetTouchStart}
            onTouchMove={onSheetTouchMove}
            onTouchEnd={onSheetTouchEnd}
            style={{
              position: 'relative', width: '100%', outline: 'none',
              background: 'var(--v3-sheet)',
              borderRadius: '28px 28px 0 0',
              padding: '14px 20px calc(env(safe-area-inset-bottom, 0px) + 26px)',
              boxShadow: 'var(--cal-sheet-shadow)',
              maxHeight: '88vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch',
              animation: dragY ? 'none' : 'pageEnter .3s cubic-bezier(.4,0,.2,1)',
              transform: dragY ? `translateY(${dragY}px)` : 'translateY(0)',
              willChange: 'transform',
              transition: dragging.current ? 'none' : 'transform .25s ease',
            }}
          >
            <div style={{ width: 38, height: 4, borderRadius: 999, background: 'var(--v3-tile-br)', margin: '0 auto 16px' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              {iconBox(openTone, 42, 13, <openCat.Icon style={{ width: 19, height: 19 }} />)}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--fg)', letterSpacing: '-.015em' }}>
                  {t(`calendar.categories.${openCat.id}.name`)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--v3-fg-3)', marginTop: 2 }}>{phaseLine(day)}</div>
              </div>
              <Chip tone={openTone.chip} style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', flexShrink: 0 }}>
                {scoreWord(openScore)}
              </Chip>
            </div>

            <div style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--v3-fg-2)', marginBottom: 14 }}>
              {t(`calendar.categories.${openCat.id}.about`)}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              <div style={CAPTION}>{t('calendar.nextGood')}</div>
              {nextGood ? (
                <Tile radius={15} padding="13px 15px" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{
                    width: 36, height: 36, borderRadius: 11, flexShrink: 0,
                    background: 'var(--v3-chip-s)', border: '1px solid var(--v3-chip-s-br)',
                    color: 'var(--v3-success)', fontSize: 14, fontWeight: 800,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{nextGood.lunar_day}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>
                      {`${formatDayMonth(toDate(nextGood.date), lang)}, ${toDate(nextGood.date).toLocaleDateString(locale, { weekday: 'short' })}`}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--v3-fg-4)', marginTop: 2 }}>
                      {t(`lunar.phases.${PHASE_INDEX[nextGood.moon_phase] ?? 3}`)}
                    </div>
                  </div>
                </Tile>
              ) : (
                <div style={{ fontSize: 12.5, color: 'var(--v3-fg-3)' }}>{t('calendar.noGoodDay')}</div>
              )}
            </div>

            <PillButton onClick={() => setOpen(null)}>{t('calendar.close')}</PillButton>
          </div>
        </div>
      )}
    </div>
  );
}
