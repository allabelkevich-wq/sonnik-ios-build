import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MoonIcon, BookOpenIcon, UserIcon, CalendarDaysIcon, SparklesIcon, EyeIcon, UserGroupIcon, BoltIcon, ChevronRightIcon, ChevronDownIcon } from '@heroicons/react/24/solid';
import { getUserId, providerCode, authHeader, getPlatform } from '../platform.js';
import { useToast } from '../components/Toast.jsx';
import MoonPhase from '../components/MoonPhase.jsx';
import { useScrollLock } from '../hooks/useScrollLock.js';
import { localToday, localNowTime, isFutureBirthMoment, signPrepositional, isUnderMinAge, formatDayMonth } from '../utils/date.js';
import '../styles/home.css';
import { pulse } from '../utils/pulse.js';
import { serverLang } from '../i18n/index.js';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Поиск городов через Photon API (все города мира)
let _placesTimer = null;
let _placesAbort = null;
async function searchPlaces(q, apiBase) {
  if (!q || q.trim().length < 2) return [];
  if (_placesAbort) _placesAbort.abort();
  _placesAbort = new AbortController();
  try {
    const res = await fetch(`${apiBase}/api/places?q=${encodeURIComponent(q.trim())}`, {
      signal: _placesAbort.signal,
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}


// Короткие названия фаз для чипа: сервер отдаёт только полные русские
// («Растущая Луна»), а эталон и EN-версия просят короткое слово.
const PHASE_KEYS = {
  'Новолуние': 'new',
  'Растущая Луна': 'waxing',
  'Первая четверть': 'firstQuarter',
  'Полнолуние': 'full',
  'Убывающая Луна': 'waning',
  'Последняя четверть': 'lastQuarter',
};

// ── Мелкие части главной v3 ──────────────────────────────────────────
// Заголовок зоны: подпись, тонкая линия и необязательный правый элемент.
function SectionLabel({ title, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--home-label)' }}>{title}</span>
      <span style={{ flex: 1, height: 1, background: 'var(--home-label-line)' }} />
      {right}
    </div>
  );
}

// Чип лунного контекста: фаза, знак, значение дня.
function Chip({ children, tone = 'violet', icon }) {
  const gold = tone === 'gold';
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: icon ? '5px 11px 5px 8px' : '5px 11px', borderRadius: 9999,
      background: gold ? 'var(--home-chip-gold-bg)' : 'var(--home-chip-violet-bg)',
      border: `1px solid ${gold ? 'var(--home-chip-gold-br)' : 'var(--home-chip-violet-br)'}`,
      color: gold ? 'var(--home-gold-soft)' : 'var(--home-chip-violet-txt)',
      display: 'inline-flex', alignItems: 'center', gap: 6,
    }}>{icon}{children}</span>
  );
}

// Плитка раздела. Подпись приходит с переводом строки — держим её.
function Tile({ onClick, icon, label, hint, bg, br }) {
  return (
    <button onClick={onClick} className="home-btn home-tile" style={{
      borderRadius: 19, border: '1px solid var(--home-tile-br)', background: 'var(--home-tile)',
      padding: '15px 8px 13px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9,
      cursor: 'pointer', boxShadow: 'var(--home-tile-shadow)', color: 'inherit', width: '100%',
    }}>
      <span style={{ width: 36, height: 36, borderRadius: 12, background: bg, border: `1px solid ${br}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--home-tile-label)', textAlign: 'center', lineHeight: 1.25, whiteSpace: 'pre-line' }}>{label}</span>
      <span style={{ fontSize: 10, color: 'var(--home-tile-hint)', fontVariantNumeric: 'tabular-nums', minHeight: 13 }}>{hint}</span>
    </button>
  );
}

// Заглушка по форме контента: пока лунные данные едут, карточка держит
// свой размер и не «прыгает» при подстановке текста.
function Skel({ w, h, r = 8 }) {
  return <span className="skeleton" style={{ display: 'block', width: w, height: h, borderRadius: r }} />;
}

export default function HomePage({ onAnalyze, onProfile, onJournal, onHairCalendar, onLunarDay }) {
  const { t, i18n } = useTranslation();
  const showToast = useToast();
  // Местная дата, не UTC: вечером в Москве toISOString() отдавал вчерашнюю,
  // и сегодняшнее число нельзя было выбрать вовсе.
  const todayStr = localToday();
  const [lunar, setLunar] = useState(null);
  const [lunarError, setLunarError] = useState(false);
  const [personal, setPersonal] = useState(null);
  const [hasBirthData, setHasBirthData] = useState(null); // null = загружается
  const [birthDataSaved, setBirthDataSaved] = useState(false); // флаг: данные уже сохранены в этой сессии

  // Модалка рождения
  const [showBirthModal, setShowBirthModal] = useState(false);
  useScrollLock(showBirthModal); // фон не скроллится за модалкой прогноза (bug7438755-класс)
  const [birthDate, setBirthDate] = useState('');
  const [birthTime, setBirthTime] = useState('');
  const [noTime, setNoTime] = useState(false);
  const [birthCity, setBirthCity] = useState('');
  const [birthCityCoords, setBirthCityCoords] = useState(null);
  const [citySuggestions, setCitySuggestions] = useState([]);
  const [showCitySuggestions, setShowCitySuggestions] = useState(false);
  const cityInputRef = useRef(null);
  // Подтянуть поле города к центру модалки, чтобы список не оставался за
  // клавиатурой/краем (репорт Вячеслава: не было автоскролла к списку).
  const scrollCityIntoView = () => {
    setTimeout(() => cityInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
  };
  const [birthSaving, setBirthSaving] = useState(false);
  // Счётчик записей и статус доступа — подписи под плитками разделов.
  const [dreamCount, setDreamCount] = useState(null);
  const [hasAccess, setHasAccess] = useState(false);
  const [iskry, setIskry] = useState(0);
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  const userId = getUserId();

  // Лунные данные — единственный запрос главной, который нельзя проглотить
  // молча: без него карточка «Сегодня» пустая. Поэтому у него есть своё
  // состояние ошибки и повтор по кнопке.
  const loadLunar = () => {
    setLunarError(false);
    const tz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
    fetch(`${API_BASE}/api/lunar/today?lang=${serverLang()}${tz ? `&timezone=${encodeURIComponent(tz)}` : ''}`)
      .then(r => r.json())
      .then(d => { if (d.day_number) setLunar(d); else setLunarError(true); })
      .catch(() => setLunarError(true));
  };

  // Отметка шага воронки (utils/pulse.js). Новый человек сюда из онбординга
  // НЕ попадает — кнопка ведёт сразу в форму (App.jsx), так что для fresh=true
  // «главная» значит «вернулся домой после формы», а не шаг между онбордингом
  // и формой. Воронку новых читать как старт → онбординг → форма → первый сон.
  useEffect(() => { pulse('главная'); }, []);
  useEffect(() => {
    let cancelled = false;
    loadLunar();

    if (userId) {
      authHeader().then(headers => {
        fetch(`${API_BASE}/api/user/${userId}/natal?provider=${providerCode()}`, { headers })
          .then(r => r.json())
          .then(d => {
            if (cancelled) return;
            setHasBirthData(!!d.natal_chart);
            if (d.natal_chart) {
              fetch(`${API_BASE}/api/user/${userId}/vedic-today?provider=${providerCode()}`, { headers })
                .then(r => r.json())
                .then(v => { if (v.personal && !cancelled) setPersonal(v.personal); })
                .catch(() => {});
            }
          })
          .catch(() => { if (!cancelled) setHasBirthData(false); });
      });
    } else {
      setHasBirthData(false);
    }
    return () => { cancelled = true; };
  }, []);

  // Подписи плиток: сколько записей в дневнике и есть ли платный доступ.
  // Тихо: подпись просто останется пустой, если запрос не удался.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    authHeader().then((headers) => {
      fetch(`${API_BASE}/api/user/${userId}/stats?provider=${providerCode()}`, { headers })
        .then((r) => r.json())
        .then((d) => { if (!cancelled && typeof d.total_dreams === 'number') setDreamCount(d.total_dreams); })
        .catch(() => {});
      fetch(`${API_BASE}/api/user/${userId}/subscription?provider=${providerCode()}`, { headers })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          setHasAccess(!!d.active);
          // В VK подписок нет — там доступ меряется Искрами.
          setIskry(d.iskry?.balance ?? 0);
        })
        .catch(() => {});
    });
    return () => { cancelled = true; };
  }, [userId]);

  const saveBirthData = async () => {
    if (!birthDate || !userId) return;
    setBirthSaving(true);
    // Локальный флаг: finally читал birthSaving из замыкания (staлое false) и
    // затирал 'done' в том же батче — подтверждение «✓» не показывалось никогда.
    let succeeded = false;
    try {
      if (!birthCityCoords && birthCity) {
        showToast(t('common.citySelectAlert'));
        setBirthSaving(false);
        return;
      }
      // Android-пикеры игнорируют max у input[type=time], поэтому проверяем сами.
      // Сервис 16+ — заявлено на экране согласия и в оферте (отчёт 7447465).
      if (isUnderMinAge(birthDate)) {
        showToast(t('common.underMinAge'));
        setBirthSaving(false);
        return;
      }
      if (isFutureBirthMoment(birthDate, noTime ? null : birthTime)) {
        showToast(t('common.futureBirthMoment'));
        setBirthSaving(false);
        return;
      }
      const res = await fetch(`${API_BASE}/api/user/${userId}/birth-data`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({
          birth_date: birthDate,
          birth_time: noTime ? null : birthTime || null,
          birth_place_lat: birthCityCoords?.lat ?? null,
          birth_place_lon: birthCityCoords?.lon ?? null,
          birth_place_name: birthCity || null,
          provider: providerCode(),
          // Пояс устройства — чтобы сервер сравнивал момент рождения с «сейчас»
          // именно у пользователя, а не в UTC (отчёт 7438498).
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
        }),
      });
      const data = await res.json();
      if (data.natal_chart) {
        setBirthDataSaved(true);
        setHasBirthData(true);
        // Загрузить персональный прогноз
        authHeader().then(headers => {
          fetch(`${API_BASE}/api/user/${userId}/vedic-today?provider=${providerCode()}`, { headers })
            .then(r => r.json())
            .then(v => { if (v.personal) setPersonal(v.personal); })
            .catch(() => {});
        });
        // Показать подтверждение на 2 сек, потом закрыть модалку
        succeeded = true;
        setBirthSaving('done');
        setTimeout(() => setShowBirthModal(false), 2000);
        return;
      } else {
        showToast(data.error || t('home.birthModal.error'));
      }
    } catch (e) {
      console.error(e);
      showToast(t('home.birthModal.error'));
    }
    finally { if (!succeeded) setBirthSaving(false); }
  };

  // Дата справа от «Сегодня» — «1 сентября» на языке интерфейса. Через
  // formatDayMonth: toLocaleDateString на Windows отдаёт «1 сентябрь».
  const todayLabel = formatDayMonth(new Date(), i18n.language);
  const FEATURES = t('home.features', { returnObjects: true }) || [];
  const lunarLoading = !lunar && !lunarError;
  // Фаза: короткое слово из карты, а не серверная формулировка.
  const phaseKey = lunar?.moon_phase ? PHASE_KEYS[lunar.moon_phase.trim()] : null;
  const phaseLabel = phaseKey ? t(`home.phases.${phaseKey}`) : lunar?.moon_phase;
  const moonInSign = lunar?.moon_sign ? t('home.moonIn', { sign: signPrepositional(lunar.moon_sign, i18n.language) }) : '';
  const profileHint = hasAccess
    ? t('home.planPaid')
    : (getPlatform() === 'vk' && iskry > 0 ? t('home.iskryTile', { count: iskry }) : t('home.planFree'));

  // Текст карточки «Сегодня» и золотая врезка под ним. Персональный путь (натальная
  // карта есть) и безличный (её нет) берутся из разных источников, но собираются
  // в одну пару, чтобы дальше их можно было сверить между собой на повтор.
  const dreamBody = personal?.dream_tip || lunar?.dream_influence || '';
  const dreamHint = personal?.nakshatra_tip || lunar?.moon_sign_dream_hint || '';

  return (
    <div className="page" style={{ position: 'relative', overflow: 'hidden' }}>

      {/* Звёздная пыль и два световых пятна — глубина фона из макета v3 */}
      <div aria-hidden style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, opacity: 'var(--star-op)',
        backgroundImage: [
          'radial-gradient(1px 1px at 18% 12%, rgba(var(--fg-rgb),.5) 0, transparent 100%)',
          'radial-gradient(1.2px 1.2px at 74% 7%, rgba(var(--h-gold-rgb),.55) 0, transparent 100%)',
          'radial-gradient(1px 1px at 41% 34%, rgba(var(--fg-rgb),.32) 0, transparent 100%)',
          'radial-gradient(1px 1px at 89% 47%, rgba(var(--h-violet-rgb),.45) 0, transparent 100%)',
          'radial-gradient(1px 1px at 9% 62%, rgba(var(--fg-rgb),.28) 0, transparent 100%)',
          'radial-gradient(1.2px 1.2px at 62% 80%, rgba(var(--h-gold-rgb),.4) 0, transparent 100%)',
          'radial-gradient(1px 1px at 31% 91%, rgba(var(--fg-rgb),.22) 0, transparent 100%)',
        ].join(','),
      }} />
      <div aria-hidden style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: 'radial-gradient(760px 460px at 12% -6%, rgba(var(--h-gold-rgb),.10) 0%, transparent 65%), radial-gradient(680px 520px at 88% 18%, rgba(var(--h-violet-rgb),.10) 0%, transparent 65%)',
      }} />

      <div className="page-scroll" style={{ position: 'relative', zIndex: 1 }}>
        {/* Верхний отступ учитывает safe-area — на всех остальных экранах это делает
            правило `header` в globals.css (чёлка / Dynamic Island, bug7438681), а
            главная v3 своего <header> не имеет и уезжала под статус-бар.
            Замер по скрину Аллы (iPhone 390×844 в VK, 01.09): плавающие кнопки VK
            «⋯ ✕» кончаются на 78-й логической точке сверху, а шапка начиналась на
            10-й — название и «20 ЛУННЫЙ ДЕНЬ» оказывались прямо под ними.
            47 (инсет) + 40 = 87: девять точек воздуха под кнопками VK. Не 32, как у
            `header`: там первый элемент — кнопка «Назад» слева, где у VK ничего нет,
            а здесь под самым крестиком стоит счётчик лунного дня. */}
        {/* Боковые 18px по эталону: .page-scroll даёт 20px общего ритма. */}
        <div style={{ padding: 'var(--v3-top) 0 30px', margin: '0 -2px', display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* ── Шапка: луна, название, лунный день ── */}
          <div className="h-rise" style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
            {/* Настоящая луна с фазой и рельефом — та же, что на экране лунного
                дня. Раньше здесь стоял нарисованный кружок с градиентом: он не
                зависел ни от фазы, ни от того, что за ночь на дворе. */}
            <MoonPhase
              className="h-moon home-moon"
              date={new Date()}
              frac={lunar?.phase_angle != null ? lunar.phase_angle / 360 : undefined}
              event={lunar?.moon_event?.key}
              size={56}
              glow
              style={{ flexShrink: 0 }}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 19.5, fontWeight: 800, letterSpacing: '-.022em', color: 'var(--fg)', lineHeight: 1.15 }}>
                {t('home.appName')}
              </div>
              <div className="h-sub" style={{ fontSize: 12.5, color: 'var(--home-muted)', marginTop: 4, lineHeight: 1.4 }}>
                {t('home.subtitleShort')}
              </div>
            </div>
            {(lunar?.day_number || lunarLoading) && (
              <div style={{ flexShrink: 0, textAlign: 'right', paddingLeft: 8, borderLeft: '1px solid var(--home-daynum-line)' }}>
                {lunarLoading ? (
                  <div style={{ paddingLeft: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
                    <Skel w={34} h={27} />
                    <Skel w={60} h={9} r={5} />
                  </div>
                ) : (
                  <>
                    <div className="home-daynum" style={{
                      fontSize: 27, fontWeight: 800, lineHeight: 1, letterSpacing: '-.03em',
                      fontVariantNumeric: 'tabular-nums', paddingLeft: 10,
                    }}>{lunar.day_number}</div>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--home-daynum-label)', marginTop: 5, paddingLeft: 10 }}>
                      {t('home.lunarDayLabel')}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── Сегодня ── */}
          <div className="h-rise" style={{ display: 'flex', flexDirection: 'column', gap: 11, animationDelay: '.06s' }}>
            <SectionLabel title={t('home.sectionToday')} right={<span style={{ fontSize: 10.5, color: 'var(--home-date)', letterSpacing: '.03em' }}>{todayLabel}</span>} />
            {/* Карточка «Сегодня» — вход в «Лунный день»: там та же фаза,
                но с листанием дат, неделей и записями. */}
            <div
              role="button"
              tabIndex={0}
              aria-label={t('lunar.title')}
              onClick={onLunarDay}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLunarDay?.(); } }}
              style={{ borderRadius: 22, padding: 1, background: 'var(--home-card-edge)', cursor: 'pointer' }}
            >
              <div className="home-card" style={{ borderRadius: 21, padding: '17px 17px 15px', display: 'flex', flexDirection: 'column', gap: 13, background: 'var(--home-card)', boxShadow: 'var(--home-card-shadow)' }}>
                {lunarError ? (
                  <>
                    <div style={{ fontSize: 13.5, lineHeight: 1.62, color: 'var(--home-body)' }}>{t('home.lunarError')}</div>
                    <button onClick={loadLunar} className="home-btn" style={{
                      alignSelf: 'flex-start', width: 'auto', minHeight: 44, padding: '0 4px',
                      background: 'none', border: 'none', boxShadow: 'none', cursor: 'pointer',
                      fontSize: 12.5, fontWeight: 600, color: 'var(--home-gold-soft)',
                    }}>{t('common.offlineRetry')}</button>
                  </>
                ) : (
                <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {lunarLoading ? (
                    <>
                      <Skel w={92} h={26} r={999} />
                      <Skel w={96} h={26} r={999} />
                      <Skel w={150} h={26} r={999} />
                    </>
                  ) : (
                    <>
                      {phaseLabel && (
                        <Chip tone="violet" icon={<MoonIcon style={{ width: 12, height: 12, flexShrink: 0, color: 'var(--home-chip-violet-ico)' }} />}>{phaseLabel}</Chip>
                      )}
                      {moonInSign && <Chip tone="violet">{moonInSign}</Chip>}
                      {lunar?.day_meaning && <Chip tone="gold">{lunar.day_meaning}</Chip>}
                    </>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ flex: 1, height: 1, background: 'var(--home-rule)' }} />
                  <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--home-dot)', animation: 'hTwinkle 3.4s ease-in-out infinite' }} />
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--home-dot-mid)' }} />
                  <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--home-dot)', animation: 'hTwinkle 3.4s ease-in-out 1.2s infinite' }} />
                  <span style={{ flex: 1, height: 1, background: 'var(--home-rule)' }} />
                </div>

                {lunarLoading ? (
                  <div>
                    <div style={{ marginBottom: 8 }}><Skel w={150} h={10} r={5} /></div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <Skel w="100%" h={13} />
                      <Skel w="100%" h={13} />
                      <Skel w="60%" h={13} />
                    </div>
                  </div>
                ) : (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--home-card-title)', marginBottom: 8 }}>
                    {t('home.lunarDreamsTitle', { n: lunar?.day_number ?? '' })}
                  </div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.62, color: 'var(--home-body)' }}>
                    {dreamBody}
                  </div>
                </div>
                )}

                {/* Золотая врезка не повторяет то, что уже сказано абзацем выше.
                    В обычный день vedic.js собирает transitInfluence как
                    «Транзит Луны через <накшатра> — <dreamMeaning>» (vedic.js:535),
                    а nakshatra_tip — это тот же самый dreamMeaning. На главной v3 оба
                    поля показываются рядом, и человек читал одно и то же предложение
                    дважды подряд (скрин Аллы, 01.09). В особые дни — возвращение Луны
                    в натальную накшатру, трин, оппозиция — тексты РАЗНЫЕ, и врезка
                    остаётся на месте. Как и весь безличный путь (moon_sign_dream_hint). */}
                {(dreamHint && !dreamBody.includes(dreamHint)) && (
                  <div style={{ display: 'flex', gap: 11, padding: '11px 13px', borderRadius: 14, background: 'var(--home-inset-bg)' }}>
                    <span style={{ width: 2, flexShrink: 0, borderRadius: 2, background: 'var(--home-inset-bar)' }} />
                    <span style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--home-inset-txt)' }}>
                      {moonInSign && <b style={{ fontWeight: 700, color: 'var(--home-gold-soft)' }}>{moonInSign}: </b>}
                      {dreamHint}
                    </span>
                  </div>
                )}
                </>
                )}
              </div>
            </div>
          </div>

          {/* ── Главное действие ── */}
          <div className="h-rise" style={{ display: 'flex', flexDirection: 'column', gap: 9, animationDelay: '.12s' }}>
            <button onClick={onAnalyze} className="home-btn" style={{
              position: 'relative', overflow: 'hidden', width: '100%', border: 'none', cursor: 'pointer',
              padding: '0 22px', height: 56, borderRadius: 9999,
              background: 'linear-gradient(135deg,#ffc76b 0%,#f5a623 32%,#e8920a 62%,#c97a10 100%)',
              color: '#1a0800', fontFamily: 'inherit', fontSize: 15.5, fontWeight: 700, letterSpacing: '-.005em',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 11,
              boxShadow: 'var(--home-btn-shadow)',
            }}>
              <span aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                <span className="h-sweep" style={{ position: 'absolute', top: 0, left: '-60%', width: '48%', height: '100%', background: 'var(--home-btn-sweep)', transform: 'skewX(-18deg)', animation: 'hSweep 4.2s ease-in-out infinite' }} />
              </span>
              <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(26,8,0,.13)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <MoonIcon style={{ width: 15, height: 15, color: '#1a0800' }} />
              </span>
              {t('home.analyzeDream')}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 11.5, color: 'var(--home-btn-hint)' }}>
              <span>{t('home.analyzeHint')}</span>
              <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--home-btn-dot)' }} />
              <span>{t('home.analyzeHintTime')}</span>
            </div>
          </div>

          {/* ── Точнее для вас: показываем, пока данных рождения нет ── */}
          {hasBirthData === false && (
            <div className="h-rise" style={{ display: 'flex', flexDirection: 'column', gap: 11, animationDelay: '.18s' }}>
              <SectionLabel
                title={t('home.sectionPersonal')}
                right={<span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', padding: '3px 9px', borderRadius: 9999, background: 'var(--home-steps-bg)', border: '1px solid var(--home-steps-br)', color: 'var(--home-gold-soft)' }}>{t('home.stepsLeft')}</span>}
              />
              <button onClick={() => setShowBirthModal(true)} className="home-btn home-card" style={{
                width: '100%', textAlign: 'left', borderRadius: 20, border: '1px solid var(--home-personal-br)',
                background: 'var(--home-personal-bg)',
                padding: '15px 16px', display: 'flex', alignItems: 'center', gap: 13, cursor: 'pointer',
                boxShadow: 'var(--home-personal-shadow)', color: 'inherit',
              }}>
                <span style={{ width: 38, height: 38, borderRadius: 13, flexShrink: 0, background: 'var(--home-personal-ico-bg)', border: '1px solid var(--home-personal-ico-br)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <SparklesIcon style={{ width: 19, height: 19, color: 'var(--home-personal-ico)' }} />
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'rgba(var(--fg-rgb),.92)' }}>{t('home.personalCardTitle')}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--home-personal-hint)', marginTop: 3 }}>{t('home.personalCardHint')}</span>
                </span>
                <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 600, color: 'var(--home-gold-soft)' }}>
                  <span className="h-enable-label">{t('home.enableShort')}</span>
                  <ChevronRightIcon style={{ width: 13, height: 13 }} />
                </span>
              </button>
            </div>
          )}

          {/* ── Разделы ── */}
          <div className="h-rise" style={{ display: 'flex', flexDirection: 'column', gap: 11, animationDelay: '.24s' }}>
            <SectionLabel title={t('home.sectionNav')} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 9 }}>
              <Tile onClick={onJournal} bg="var(--home-ico-gold-bg)" br="var(--home-ico-gold-br)" icon={<BookOpenIcon style={{ width: 19, height: 19, color: 'var(--home-ico-gold)' }} />}
                    label={t('home.journalShort')} hint={dreamCount == null ? '' : t('home.journalCount', { count: dreamCount })} />
              <Tile onClick={onHairCalendar} bg="var(--home-ico-lilac-bg)" br="var(--home-ico-lilac-br)" icon={<CalendarDaysIcon style={{ width: 19, height: 19, color: 'var(--home-ico-lilac)' }} />}
                    label={t('home.hairCalendarShort')} hint={t('home.hairTileHint')} />
              <Tile onClick={onProfile} bg="var(--home-ico-green-bg)" br="var(--home-ico-green-br)" icon={<UserIcon style={{ width: 19, height: 19, color: 'var(--home-ico-green)' }} />}
                    label={t('home.profileShort')} hint={profileHint} />
            </div>
          </div>

          {/* ── Как это работает ── */}
          {/* minHeight 44 — хит-таргет: у эталона строка ~24px, пальцем не попасть. */}
          <button onClick={() => setShowHowItWorks(v => !v)} aria-expanded={showHowItWorks} className="h-rise home-btn" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
            padding: '6px 0 2px', minHeight: 44, cursor: 'pointer', background: 'none', border: 'none', boxShadow: 'none',
            animationDelay: '.3s', width: '100%',
          }}>
            <span style={{ width: 26, height: 1, background: 'linear-gradient(90deg,transparent,var(--home-how-line))' }} />
            <span style={{ fontSize: 11.5, color: 'var(--home-how)', letterSpacing: '.02em' }}>{t('home.howItWorks')}</span>
            <ChevronDownIcon style={{ width: 12, height: 12, color: 'var(--home-how-chev)', transform: showHowItWorks ? 'rotate(180deg)' : 'none', transition: 'transform .25s ease' }} />
            <span style={{ width: 26, height: 1, background: 'linear-gradient(90deg,var(--home-how-line),transparent)' }} />
          </button>

          {showHowItWorks && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: -12 }}>
              {FEATURES.map((item, i) => (
                <div key={i} className="home-tile" style={{ display: 'flex', gap: 12, padding: '13px 14px', borderRadius: 16, border: '1px solid var(--home-tile-br)', background: 'var(--home-tile)' }}>
                  <span style={{ width: 34, height: 34, borderRadius: 11, flexShrink: 0, background: 'var(--home-ico-gold-bg)', border: '1px solid var(--home-ico-gold-br)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {[<EyeIcon key="a" style={{ width: 17, height: 17, color: 'var(--home-ico-gold)' }} />,
                      <UserGroupIcon key="b" style={{ width: 17, height: 17, color: 'var(--home-ico-lilac)' }} />,
                      <BoltIcon key="c" style={{ width: 17, height: 17, color: 'var(--home-gold-soft)' }} />][i]}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'rgba(var(--fg-rgb),.92)' }}>{item.title}</span>
                    <span style={{ display: 'block', fontSize: 12.5, color: 'var(--home-personal-hint)', marginTop: 3, lineHeight: 1.5 }}>{item.text}</span>
                  </span>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>

      {/* Модалка даты рождения */}
      {showBirthModal && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'var(--overlay)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 100, padding: 20,
          }}
          onClick={() => setShowBirthModal(false)}
        >
          <div
            style={{
              background: 'linear-gradient(135deg, var(--surface-solid), var(--surface-solid-2))',
              border: '1px solid rgba(232,146,10,0.2)',
              borderRadius: 20,
              padding: '20px 18px',
              width: '100%', maxWidth: 380,
              maxHeight: '80vh', overflowY: 'auto',
              boxSizing: 'border-box',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{
              fontSize: 18, fontWeight: 700, margin: '0 0 6px',
              color: 'var(--primary-color)',
            }}>
              {t('home.birthModal.title')}
            </h3>
            <p style={{
              fontSize: 13, color: 'rgba(var(--fg-rgb),0.5)', margin: '0 0 20px', lineHeight: 1.5,
            }}>
              {t('home.birthModal.desc')}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: 'rgba(var(--fg-rgb),0.45)', marginBottom: 5, display: 'block' }}>
                  {t('home.birthModal.birthDate')}
                </label>
                <input
                  type="date"
                  value={birthDate}
                  min="1900-01-01"
                  max={todayStr}
                  onChange={e => setBirthDate(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 10,
                    background: 'rgba(var(--fg-rgb),0.07)', border: '1px solid rgba(var(--fg-rgb),0.15)',
                    color: 'var(--fg)', fontSize: 14, boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'rgba(var(--fg-rgb),0.45)', marginBottom: 5, display: 'block' }}>
                  {t('home.birthModal.birthTime')}
                </label>
                <input
                  type="time"
                  value={birthTime}
                  // При сегодняшней дате время дальше текущего — момент в будущем
                  // (отчёт 7438498). max подсказывает, сохранение проверяет строго.
                  max={birthDate === todayStr ? localNowTime() : undefined}
                  onChange={e => setBirthTime(e.target.value)}
                  disabled={noTime}
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 10,
                    background: 'rgba(var(--fg-rgb),0.07)', border: '1px solid rgba(var(--fg-rgb),0.15)',
                    color: 'var(--fg)', fontSize: 14, opacity: noTime ? 0.4 : 1,
                    boxSizing: 'border-box',
                  }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <input type="checkbox" checked={noTime} onChange={e => setNoTime(e.target.checked)} />
                  <span style={{ fontSize: 12, color: 'rgba(var(--fg-rgb),0.4)' }}>{t('common.noTime')}</span>
                </label>
              </div>

              <div style={{ position: 'relative' }}>
                <label style={{ fontSize: 12, color: 'rgba(var(--fg-rgb),0.45)', marginBottom: 5, display: 'block' }}>
                  {t('home.birthModal.birthCity')}
                </label>
                <input
                  ref={cityInputRef}
                  type="text"
                  placeholder={t('common.cityPlaceholder')}
                  value={birthCity}
                  autoComplete="off"
                  onChange={e => {
                    const val = e.target.value;
                    setBirthCity(val);
                    setBirthCityCoords(null);
                    clearTimeout(_placesTimer);
                    if (val.trim().length < 2) { setCitySuggestions([]); setShowCitySuggestions(false); return; }
                    _placesTimer = setTimeout(async () => {
                      const results = await searchPlaces(val, API_BASE);
                      setCitySuggestions(results);
                      setShowCitySuggestions(results.length > 0);
                      if (results.length) scrollCityIntoView();
                    }, 300);
                  }}
                  onFocus={() => { if (citySuggestions.length) setShowCitySuggestions(true); scrollCityIntoView(); }}
                  onBlur={() => setTimeout(() => setShowCitySuggestions(false), 200)}
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 10,
                    background: 'rgba(var(--fg-rgb),0.07)', border: '1px solid rgba(var(--fg-rgb),0.15)',
                    color: 'var(--fg)', fontSize: 14, boxSizing: 'border-box',
                  }}
                />
                {birthCity.trim().length === 1 && (
                  <p style={{ fontSize: 11, color: 'rgba(var(--fg-rgb),0.35)', margin: '4px 0 0' }}>
                    {t('common.cityTypeMore')}
                  </p>
                )}
                {showCitySuggestions && citySuggestions.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 150,
                    background: 'var(--surface-solid)', border: '1px solid rgba(var(--fg-rgb),0.15)',
                    borderRadius: 10, marginTop: 4, maxHeight: 220, overflowY: 'auto',
                  }}>
                    {citySuggestions.map((s, i) => (
                      <div
                        key={i}
                        onMouseDown={() => {
                          setBirthCity(s.display_name);
                          setBirthCityCoords({ lat: parseFloat(s.lat), lon: parseFloat(s.lon) });
                          setCitySuggestions([]);
                          setShowCitySuggestions(false);
                        }}
                        style={{
                          padding: '10px 14px', fontSize: 14, color: 'var(--fg)',
                          cursor: 'pointer', borderBottom: '1px solid rgba(var(--fg-rgb),0.06)',
                        }}
                      >
                        {s.display_name}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {birthSaving === 'done' ? (
                <div style={{
                  textAlign: 'center', padding: '16px 0',
                  color: 'var(--success)', fontSize: 15, fontWeight: 700,
                }}>
                  {t('home.birthModal.done')}
                </div>
              ) : (
                <button
                  onClick={saveBirthData}
                  disabled={!birthDate || birthSaving}
                  style={{
                    width: '100%', padding: '12px 18px', fontSize: 14, fontWeight: 600,
                    background: 'linear-gradient(135deg, #f5a623 0%, #e8920a 55%, #c97a10 100%)',
                    borderRadius: 9999, border: 'none', color: '#1a0800',
                    boxShadow: '0 0 28px rgba(232,146,10,0.35), 0 4px 16px rgba(232,146,10,0.25), inset 0 1px 0 rgba(var(--fg-rgb),0.2)',
                    opacity: (!birthDate || birthSaving) ? 0.5 : 1,
                    marginTop: 4,
                  }}
                >
                  {birthSaving ? t('home.birthModal.calculating') : <><SparklesIcon style={{ width: 20, height: 20, display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }} />{t('home.birthModal.enable')}</>}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
