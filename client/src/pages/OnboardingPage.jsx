import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftIcon, ArrowRightIcon, ArrowPathRoundedSquareIcon, BellIcon, BoltIcon,
  BookOpenIcon, CalendarIcon, ChatBubbleBottomCenterIcon, CheckIcon, CheckCircleIcon,
  ChartBarIcon, MoonIcon, SparklesIcon, SunIcon,
} from '@heroicons/react/24/solid';
import { getPlatform, getUserId, providerCode, authHeader } from '../platform.js';
import { useToast } from '../components/Toast.jsx';
import { usePremiumPurchase } from '../hooks/usePremiumPurchase.js';
import GoldButton from '../components/GoldButton.jsx';
import PillButton from '../components/PillButton.jsx';
import { moonPath } from '../utils/moon.js';
import { enableMorningReminder } from '../utils/reminders.js';
import { isFutureBirthMoment, isUnderMinAge, localToday, localNowTime, signPrepositional } from '../utils/date.js';
import '../styles/onboarding.css';
import { pulse } from '../utils/pulse.js';
import { serverLang } from '../i18n/index.js';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Поиск городов — тот же эндпоинт, что в модалке рождения на главной.
let _placesTimer = null;
let _placesAbort = null;
async function searchPlaces(q) {
  if (!q || q.trim().length < 2) return [];
  if (_placesAbort) _placesAbort.abort();
  _placesAbort = new AbortController();
  try {
    const res = await fetch(`${API_BASE}/api/places?q=${encodeURIComponent(q.trim())}`, { signal: _placesAbort.signal });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

// Трекер стоит вторым, сразу после разбора: один сон человек получит и
// бесплатно, а платит он за накопленную картину — какие символы возвращались
// и что за лунный месяц сдвинулось.
const PILLARS = [
  { key: 'layers', Icon: BookOpenIcon, tone: 'gold' },
  { key: 'tracker', Icon: ChartBarIcon, tone: 'purple' },
  { key: 'ritual', Icon: BoltIcon, tone: 'green' },
];
const GOALS = [
  { key: 'dreams', Icon: MoonIcon },
  { key: 'track', Icon: ChartBarIcon },
  { key: 'change', Icon: BoltIcon },
  { key: 'beauty', Icon: CalendarIcon },
];
const TIMES = [
  { key: 'mid', Icon: BellIcon },
  { key: 'off', Icon: ChatBubbleBottomCenterIcon },
];
const PREVIEW_LAYERS = ['symbol', 'body', 'lineage'];
const READING_LAYERS = ['symbols', 'body', 'lineage', 'ritual'];
// Иконки перков по выбранной цели; тон — по позиции в списке.
const PERK_ICONS = {
  dreams: [MoonIcon, BookOpenIcon, ChatBubbleBottomCenterIcon, SparklesIcon],
  change: [BoltIcon, ArrowPathRoundedSquareIcon, BookOpenIcon, ChatBubbleBottomCenterIcon],
  beauty: [CalendarIcon, SparklesIcon, BookOpenIcon, MoonIcon],
  sleep: [BellIcon, MoonIcon, BookOpenIcon, SparklesIcon],
};
const PERK_TONES = ['gold', 'green', 'purple', 'gold'];
const COUNTED = ['goal', 'birth', 'rhythm', 'first'];

// Угол фазы бэкенд не отдаёт (только название и номер дня), а считать
// астрономию на клиенте нельзя — astronomy-engine единственный источник.
// Приближаем долю синодического месяца по названию фазы.
function fracFromLunar(d) {
  const day = Number(d?.day_number) || 0;
  switch (d?.moon_phase) {
    case 'Новолуние': return 0.02;
    case 'Растущая Луна': return day <= 8 ? 0.14 : 0.37;
    case 'Первая четверть': return 0.25;
    case 'Полнолуние': return 0.5;
    case 'Убывающая Луна': return day <= 22 ? 0.62 : 0.87;
    case 'Последняя четверть': return 0.75;
    default: return 0.5;
  }
}

function Moon({ frac, size, variant }) {
  return (
    <svg
      className={`ob-moon ob-moon--${variant}`}
      viewBox="-60 -60 120 120"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <circle r="48" fill="var(--ob-moon-dark)" stroke="var(--ob-moon-ring)" strokeWidth="1" />
      <path d={moonPath(frac, 48)} fill="var(--ob-lit)" />
      {variant === 'promise' && (
        <>
          <circle cx="14" cy="-16" r="8" fill="rgba(120,72,10,.16)" />
          <circle cx="-9" cy="18" r="5" fill="rgba(120,72,10,.13)" />
          <circle cx="-52" cy="-38" r="1.6" fill="var(--ob-gold-txt)" opacity=".7" />
          <circle cx="49" cy="34" r="1.3" fill="var(--ob-purple-txt)" opacity=".7" />
          <circle cx="-44" cy="44" r="1.1" fill="var(--ob-gold-txt)" opacity=".5" />
        </>
      )}
      {variant === 'done' && (
        <>
          <circle cx="-50" cy="-40" r="1.6" fill="var(--ob-gold-txt)" opacity=".7" />
          <circle cx="52" cy="30" r="1.3" fill="var(--ob-purple-txt)" opacity=".7" />
        </>
      )}
    </svg>
  );
}

// Строка выбора: цель на шаге 2 и напоминание на шаге 3 выглядят одинаково.
function SelectRow({ Icon, title, sub, on, role, onClick }) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={on}
      onClick={onClick}
      className={on ? 'ob-row ob-row--on' : 'ob-row'}
    >
      <span className={`ob-sq ${on ? 'ob-sq--gold' : 'ob-sq--off'}`} style={{ width: 38, height: 38, borderRadius: 13 }}>
        <Icon width={18} height={18} />
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span className="ob-row-t" style={{ display: 'block' }}>{title}</span>
        <span className="ob-row-s" style={{ display: 'block' }}>{sub}</span>
      </span>
      <span className={on ? 'ob-tick ob-tick--on' : 'ob-tick'}>
        {on && <CheckIcon width={13} height={13} color="#1a0800" />}
      </span>
    </button>
  );
}

export default function OnboardingPage({ onNext }) {
  const { t, i18n } = useTranslation();
  const showToast = useToast();
  const platform = getPlatform();
  const uid = getUserId();
  // Пейвол-шаг — только Telegram: в VK продаются Искры за Голоса, в вебе нет
  // identity для requireAuth.
  const canSubscribe = platform === 'telegram' && !!uid;

  const [step, setStep] = useState('promise');
  const [goals, setGoals] = useState(['dreams']);
  const [moonFrac, setMoonFrac] = useState(0.5);

  const [birthDate, setBirthDate] = useState('');
  const [birthTime, setBirthTime] = useState('');
  const [birthCity, setBirthCity] = useState('');
  const [birthCoords, setBirthCoords] = useState(null);
  const [citySuggestions, setCitySuggestions] = useState([]);
  const [showCitySuggestions, setShowCitySuggestions] = useState(false);
  const [natal, setNatal] = useState({ state: 'hidden' });

  const [timeChoice, setTimeChoice] = useState('mid');
  const [reminderSaved, setReminderSaved] = useState(false);
  const [profileTz, setProfileTz] = useState(null);

  const [plans, setPlans] = useState(null);
  const [plansFailed, setPlansFailed] = useState(false);
  const [sessionStale, setSessionStale] = useState(false);
  const [subActive, setSubActive] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState('premium_yearly');
  const [premiumActivated, setPremiumActivated] = useState(false);

  const scrollRef = useRef(null);
  const cityInputRef = useRef(null);
  const calcIdRef = useRef(0);
  const calcSigRef = useRef('');

  const premium = premiumActivated || subActive === true;
  const { buy, payCard, buying, cardBuying, error: payError } = usePremiumPurchase({
    uid,
    onPaid: () => { setPremiumActivated(true); setStep('done'); },
  });

  // Поток шагов зависит от платформы и identity.
  // Путь до первого сна держим коротким. Замер 04.09: онбординг вырос с трёх
  // экранов до пяти, и доля разобравших первый сон у новых людей из ВК упала
  // с 27% до 16% в тот же день.
  //
  // Во ВКонтакте остался ОДИН экран — обещание, дальше сразу приложение.
  // Что убрано и почему: «Цель» нигде не сохранялась; «Дата рождения» — форма
  // до всякой пользы, её человек заполняет с главной («Персональный прогноз»);
  // «Первый сон бесплатно» — 150 слов чтения перед первым действием, а сам
  // разбор человек получит через сорок секунд; «Готово» обещало «ваш сонник
  // настроен», хотя настраивать после этих сокращений нечего.
  // Код всех экранов на месте — вернуть любой можно одной строкой.
  const steps = ['promise'];
  if (canSubscribe) steps.push('rhythm');
  if (canSubscribe && !premium) steps.push('paywall');

  const idx = Math.max(0, steps.indexOf(step));
  const counted = steps.filter((s) => COUNTED.includes(s));
  // Полоса и счётчик нужны, когда шагов правда несколько: «ШАГ 1 ИЗ 1» —
  // это шум. В ВК считаемый шаг сейчас один.
  const showProgress = COUNTED.includes(step) && counted.length > 1;
  // «Назад» нужен с любого шага после первого, даже когда полоса не считается:
  // с платной стены в Telegram нельзя было вернуться к напоминанию.
  const showBar = showProgress || idx > 0;
  const countIndex = counted.indexOf(step);

  // На последнем шаге «дальше» — это выход в приложение. Раньше за платной
  // стеной стоял экран «Готово», и «Продолжить бесплатно» вёл туда; 05.09 экран
  // убрали, и ссылка стала крутиться на месте — человек без Stars не мог выйти
  // никуда (Светлана, 07.09).
  const goNext = () => (idx >= steps.length - 1 ? onNext() : setStep(steps[idx + 1]));
  const goBack = () => setStep(steps[Math.max(idx - 1, 0)]);

  // Отметка шага воронки (utils/pulse.js): только в лог сервера.
  useEffect(() => { pulse('онбординг'); }, []);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [step]);

  // ─── Данные экрана: фаза луны, натальная карта, тарифы, профиль ───
  const loadPlans = () => {
    setPlansFailed(false);
    setSessionStale(false);
    authHeader().then((headers) => fetch(`${API_BASE}/api/user/${uid}/subscription?provider=${providerCode()}`, { headers }))
      .then(async (r) => {
        // 401 — это не сеть: Telegram отдал старую initData (окно висело днями).
        // «Проверьте соединение» тут врёт и «Повторить» не помогает — нужно
        // открыть приложение заново, тогда Telegram выдаст свежую подпись.
        if (r.status === 401) { setSessionStale(true); setPlansFailed(true); return null; }
        return r.json();
      })
      .then((d) => {
        if (!d) return;
        if (d.plans) setPlans(d.plans); else setPlansFailed(true);
        setSubActive(!!d.active);
      })
      .catch(() => setPlansFailed(true));
  };

  useEffect(() => {
    let cancelled = false;
    const tz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
    fetch(`${API_BASE}/api/lunar/today?lang=${serverLang()}${tz ? `&timezone=${encodeURIComponent(tz)}` : ''}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setMoonFrac(fracFromLunar(d)); })
      .catch(() => {});

    if (uid) {
      authHeader().then((headers) => {
        if (cancelled) return;
        fetch(`${API_BASE}/api/user/${uid}/natal?provider=${providerCode()}`, { headers })
          .then((r) => r.json())
          .then((d) => {
            if (cancelled || !d?.has_birth_data) return;
            // Предзаполнение уже посчитанного: пересчитывать нечего.
            calcSigRef.current = `${d.birth_date}|${(d.birth_time || '').slice(0, 5)}|${d.birth_place_lat}|${d.birth_place_lon}`;
            setBirthDate(d.birth_date || '');
            setBirthTime((d.birth_time || '').slice(0, 5));
            setBirthCity(d.birth_place_name || '');
            if (d.birth_place_lat != null) setBirthCoords({ lat: d.birth_place_lat, lon: d.birth_place_lon });
            const moon = d.natal_chart?.planets?.moon;
            if (moon) setNatal({ state: 'done', sign: pickSign(moon.sign), nakshatra: moon.dreamWord || '' });
          })
          .catch(() => {});
        if (platform === 'telegram') {
          fetch(`${API_BASE}/api/user/${uid}/profile?provider=${providerCode()}`, { headers })
            .then((r) => r.json())
            .then((d) => { if (!cancelled) setProfileTz(d?.user?.timezone || ''); })
            .catch(() => {});
        }
      });
      if (platform === 'telegram') loadPlans();
    }
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // «Мина (Рыбы)» → «Рыбы»: в карточке показываем привычное имя знака.
  function pickSign(raw) {
    const s = String(raw || '');
    const m = /\((.+)\)/.exec(s);
    return (m ? m[1] : s).trim();
  }

  // ─── Расчёт натальной карты по мере заполнения формы ───
  const runCalc = async () => {
    const id = ++calcIdRef.current;
    setNatal({ state: 'loading' });
    try {
      const res = await fetch(`${API_BASE}/api/user/${uid}/birth-data`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({
          birth_date: birthDate,
          birth_time: birthTime || null,
          birth_place_lat: birthCoords?.lat ?? null,
          birth_place_lon: birthCoords?.lon ?? null,
          birth_place_name: birthCity || null,
          provider: providerCode(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (id !== calcIdRef.current) return;
      const moon = data?.natal_chart?.planets?.moon;
      if (!res.ok || !moon) {
        setNatal({ state: 'error', error: data?.error || t('onboarding.birthError') });
        return;
      }
      setNatal({ state: 'done', sign: pickSign(moon.sign), nakshatra: moon.dreamWord || '' });
    } catch {
      if (id === calcIdRef.current) setNatal({ state: 'error', error: t('onboarding.birthError') });
    }
  };

  useEffect(() => {
    if (!uid || !birthDate || !birthCoords) {
      if (natal.state !== 'hidden' && (!birthDate || !birthCoords)) setNatal({ state: 'hidden' });
      return;
    }
    const sig = `${birthDate}|${birthTime}|${birthCoords.lat}|${birthCoords.lon}`;
    if (sig === calcSigRef.current) return;
    if (isUnderMinAge(birthDate)) { showToast(t('common.underMinAge')); return; }
    if (isFutureBirthMoment(birthDate, birthTime || null)) { showToast(t('common.futureBirthMoment')); return; }
    calcSigRef.current = sig;
    runCalc();
  }, [birthDate, birthTime, birthCoords]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Утреннее напоминание ───
  const saveReminder = async () => {
    const on = timeChoice === 'mid';
    try {
      const headers = await authHeader();
      const res = await fetch(`${API_BASE}/api/user/${uid}/notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ morning_notify: on }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.morning_notify) return;
      // На iOS сервер доставляет напоминания только через Telegram-бота, а у
      // Apple-пользователя telegram_id нет — рядом планируем локальное на
      // устройстве. Не дали разрешение — молча не показываем «включено» и
      // откатываем серверный флаг, чтобы он не обещал того, что не придёт.
      if (getPlatform() === 'ios') {
        const granted = await enableMorningReminder(serverLang());
        if (!granted) {
          fetch(`${API_BASE}/api/user/${uid}/notifications`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify({ morning_notify: false }),
          }).catch(() => {});
          return;
        }
      }
      setReminderSaved(true);
      // Без пояса рассылка ушла бы в 8:00 по Москве, а не по месту человека.
      if (!profileTz) {
        await fetch(`${API_BASE}/api/user/${uid}/profile`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
        }).catch(() => {});
      }
    } catch {
      // Молча: пункт «Напоминание на утро включено» просто не появится в финале.
    }
  };

  const toggleGoal = (key) => {
    setGoals((prev) => {
      if (!prev.includes(key)) return [key, ...prev];
      if (prev.length === 1) return prev;            // минимум одна цель
      return prev.filter((g) => g !== key);
    });
  };

  const goal = goals[0] || 'dreams';
  const todayStr = localToday();

  // ─── Главная кнопка ───
  const lastStep = step === steps[steps.length - 1];
  const ctaLabel = lastStep && step === 'promise' ? t('onboarding.cta') : {
    promise: t('onboarding.next'),
    goal: t('onboarding.continue'),
    birth: t('onboarding.continue'),
    rhythm: t('onboarding.continue'),
    first: t('onboarding.firstCta'),
    paywall: t('paywall.ctaOpen'),
    done: t('onboarding.cta'),
  }[step];
  const hasArrow = !lastStep && ['promise', 'goal', 'birth', 'rhythm'].includes(step);

  const onCta = async () => {
    if (step === 'birth') {
      if (birthCity && !birthCoords) { showToast(t('common.citySelectAlert')); return; }
      goNext();
      return;
    }
    // Сохранение напоминания не держит переход: на медленной сети кнопка
    // выглядела живой и «не нажималась», пока не вернётся сервер.
    if (step === 'rhythm') { saveReminder(); goNext(); return; }
    if (step === 'paywall') { buy(selectedPlan); return; }
    // «Готово» после оплаты не входит в steps — кнопка ведёт в приложение.
    if (step === 'done') { onNext(); return; }
    // Последний экран потока — кнопка ведёт в приложение, а не «дальше».
    if (idx >= steps.length - 1) { onNext(); return; }
    goNext();
  };

  const ctaDisabled = (step === 'birth' && natal.state === 'loading')
    || (step === 'paywall' && (!plans || buying || cardBuying));

  const skip = step === 'birth'
    ? { label: t('onboarding.birthLater'), onClick: goNext }
    : step === 'paywall'
      ? { label: t('paywall.continueFree'), onClick: goNext }
      : null;

  const planRub = plans?.[selectedPlan]?.rub;

  // ─── Список «Готово» ───
  const readyItems = [];
  const natalSign = natal.state === 'done' && natal.sign ? natal.sign : '';
  const natalItem = natalSign
    ? t('onboarding.doneReady.natal', { sign: signPrepositional(natalSign, i18n.language) })
    : null;
  if (goal === 'sleep' && reminderSaved) readyItems.push(t('onboarding.doneReady.reminder'));
  if (natalItem) readyItems.push(natalItem);
  if (goal === 'dreams') readyItems.push(t('onboarding.doneReady.journal'));
  if (goal === 'change') readyItems.push(t('onboarding.doneReady.rituals'));
  if (goal === 'beauty') readyItems.push(t('onboarding.doneReady.calendar'));
  readyItems.push(premium ? t('onboarding.doneReady.premium') : t('onboarding.doneReady.free'));

  const perks = t(`paywall.perks.${goal}`, { returnObjects: true });
  const outcomes = t(`paywall.outcomes.${goal}`, { returnObjects: true });

  return (
    <div className="page ob-page">
      <div className="ob-stars" aria-hidden="true" />
      <div className="ob-glow" aria-hidden="true" />

      {showBar && (
        <div className="ob-progress">
          {idx > 0 && (
            <button type="button" className="ob-back" onClick={goBack} aria-label={t('common.back')}>
              <ArrowLeftIcon width={16} height={16} />
            </button>
          )}
          {showProgress && (
            <div className="ob-segs">
              {counted.map((s, i) => (
                <span key={s} className={i <= countIndex ? 'ob-seg ob-seg--on' : 'ob-seg'} />
              ))}
            </div>
          )}
          {showProgress && (
            <span className="ob-count">
              {t('onboarding.progress', { n: countIndex + 1, total: counted.length })}
            </span>
          )}
        </div>
      )}

      <div ref={scrollRef} className={showBar ? 'ob-scroll' : 'ob-scroll ob-scroll--top'}>

        {step === 'promise' && (
          <div className="ob-step" style={{ gap: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10 }}>
              <Moon frac={moonFrac} size={132} variant="promise" />
            </div>
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
              <div className="ob-eyebrow">{t('onboarding.promise.eyebrow')}</div>
              <h1 className="ob-gold-title ob-h1">{t('onboarding.promise.title')}</h1>
              <div className="ob-hair" />
              <p className="ob-lead">{t('onboarding.promise.text')}</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {PILLARS.map(({ key, Icon, tone }) => (
                <div key={key} className="ob-pillar">
                  <span className={`ob-sq ob-sq--${tone}`} style={{ width: 40, height: 40 }}>
                    <Icon width={19} height={19} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="ob-pillar-t">{t(`onboarding.pillars.${key}.title`)}</div>
                    <div className="ob-pillar-s">{t(`onboarding.pillars.${key}.text`)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 'goal' && (
          <div className="ob-step" style={{ gap: 18 }}>
            <div className="ob-head">
              {showProgress && <div className="ob-label">{t('onboarding.stepOf', { n: countIndex + 1, total: counted.length })}</div>}
              <h2 className="ob-h2">{t('onboarding.goalTitle')}</h2>
              <p className="ob-sub">{t('onboarding.goalSub')}</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {GOALS.map(({ key, Icon }) => (
                <SelectRow
                  key={key}
                  Icon={Icon}
                  role="checkbox"
                  on={goals.includes(key)}
                  title={t(`onboarding.goals.${key}.title`)}
                  sub={t(`onboarding.goals.${key}.sub`)}
                  onClick={() => toggleGoal(key)}
                />
              ))}
            </div>
          </div>
        )}

        {step === 'birth' && (
          <div className="ob-step" style={{ gap: 18 }}>
            <div className="ob-head">
              {showProgress && <div className="ob-label">{t('onboarding.stepOf', { n: countIndex + 1, total: counted.length })}</div>}
              <h2 className="ob-h2">{t('onboarding.birthTitle')}</h2>
              <p className="ob-sub">{t('onboarding.birthSub')}</p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div>
                <label className="ob-field-label" htmlFor="ob-date">{t('profile.birthForm.date')}</label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="ob-date"
                    type="date"
                    className="ob-input ob-input--date"
                    value={birthDate}
                    min="1900-01-01"
                    max={todayStr}
                    onChange={(e) => setBirthDate(e.target.value)}
                  />
                  <CalendarIcon className="ob-cal-icon" />
                </div>
              </div>

              <div className="ob-grid2">
                <div>
                  <label className="ob-field-label" htmlFor="ob-time">{t('onboarding.birthTime')}</label>
                  <input
                    id="ob-time"
                    type="time"
                    className="ob-input ob-input--time"
                    value={birthTime}
                    max={birthDate === todayStr ? localNowTime() : undefined}
                    onChange={(e) => setBirthTime(e.target.value)}
                  />
                </div>
                <div style={{ position: 'relative' }}>
                  <label className="ob-field-label" htmlFor="ob-city">{t('onboarding.birthCity')}</label>
                  <input
                    id="ob-city"
                    ref={cityInputRef}
                    type="text"
                    autoComplete="off"
                    className="ob-input ob-input--city"
                    placeholder={t('common.cityPlaceholder')}
                    value={birthCity}
                    onChange={(e) => {
                      const val = e.target.value;
                      setBirthCity(val);
                      setBirthCoords(null);
                      clearTimeout(_placesTimer);
                      if (val.trim().length < 2) { setCitySuggestions([]); setShowCitySuggestions(false); return; }
                      _placesTimer = setTimeout(async () => {
                        const results = await searchPlaces(val);
                        setCitySuggestions(results);
                        setShowCitySuggestions(results.length > 0);
                      }, 300);
                    }}
                    onFocus={() => {
                      if (citySuggestions.length) setShowCitySuggestions(true);
                      // Клавиатура закрывает список подсказок — подтягиваем поле.
                      setTimeout(() => cityInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
                    }}
                    onBlur={() => setTimeout(() => setShowCitySuggestions(false), 200)}
                  />
                  {showCitySuggestions && citySuggestions.length > 0 && (
                    <div className="ob-sugg">
                      {citySuggestions.map((s, i) => (
                        <div
                          key={i}
                          className="ob-sugg-item"
                          onMouseDown={() => {
                            setBirthCity(s.display_name);
                            setBirthCoords({ lat: s.lat, lon: s.lon });
                            setShowCitySuggestions(false);
                          }}
                        >
                          {s.display_name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {birthCity.trim().length === 1 && <p className="ob-hint">{t('common.cityTypeMore')}</p>}
              <p className="ob-hint">{t('onboarding.birthHint')}</p>
            </div>

            {natal.state !== 'hidden' && (
              <div className="ob-edge ob-edge--quote">
                <div className="ob-edge-in ob-edge-in--quote">
                  <div className="ob-quote-head">
                    <SparklesIcon width={15} height={15} style={{ flexShrink: 0, color: 'var(--ob-purple-txt)' }} />
                    <span className="ob-quote-label">{t('onboarding.birthCalc')}</span>
                  </div>
                  {natal.state === 'loading' && (
                    <>
                      <div className="ob-mini">
                        <span className="ob-skel" style={{ height: 46, borderRadius: 13 }} />
                        <span className="ob-skel" style={{ height: 46, borderRadius: 13 }} />
                      </div>
                      <span className="ob-skel" style={{ height: 13 }} />
                      <span className="ob-skel" style={{ height: 13, width: '70%' }} />
                    </>
                  )}
                  {natal.state === 'done' && (
                    <>
                      <div className="ob-mini">
                        <div className="ob-mini-cell">
                          <div className="ob-mini-l">{t('onboarding.birthMoon')}</div>
                          <div className="ob-mini-v ob-mini-v--purple">{natal.sign}</div>
                        </div>
                        <div className="ob-mini-cell">
                          <div className="ob-mini-l">{t('onboarding.birthNakshatra')}</div>
                          <div className="ob-mini-v ob-mini-v--gold">{natal.nakshatra}</div>
                        </div>
                      </div>
                      <p className="ob-payoff">
                        {t('onboarding.birthPayoff', { sign: signPrepositional(natal.sign, i18n.language) })}
                      </p>
                    </>
                  )}
                  {natal.state === 'error' && (
                    <>
                      <p className="ob-card-err">{natal.error}</p>
                      <button type="button" className="ob-retry" onClick={runCalc}>{t('paywall.retry')}</button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {step === 'rhythm' && (
          <div className="ob-step" style={{ gap: 18 }}>
            <div className="ob-head">
              {showProgress && <div className="ob-label">{t('onboarding.stepOf', { n: countIndex + 1, total: counted.length })}</div>}
              <h2 className="ob-h2">{t('onboarding.rhythmTitle')}</h2>
              <p className="ob-sub">{t('onboarding.rhythmSub')}</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {TIMES.map(({ key, Icon }) => (
                <SelectRow
                  key={key}
                  Icon={Icon}
                  role="radio"
                  on={timeChoice === key}
                  title={t(`onboarding.times.${key}.title`)}
                  sub={t(`onboarding.times.${key}.sub`)}
                  onClick={() => setTimeChoice(key)}
                />
              ))}
            </div>
            <div className="ob-note">
              <CheckCircleIcon width={17} height={17} style={{ flexShrink: 0, marginTop: 1, color: 'var(--ob-success)' }} />
              <div className="ob-note-t">{t('onboarding.rhythmNote')}</div>
            </div>
          </div>
        )}

        {step === 'first' && (
          <div className="ob-step" style={{ gap: 18 }}>
            <div className="ob-head">
              {showProgress && <div className="ob-label">{t('onboarding.stepOf', { n: countIndex + 1, total: counted.length })}</div>}
              <h2 className="ob-h2">{t('onboarding.firstFree')}</h2>
              <p className="ob-sub">{t('onboarding.firstSub')}</p>
            </div>

            <div className="ob-edge ob-edge--card ob-edge--big">
              <div className="ob-edge-in ob-edge-in--big">
                <div className="ob-prev-head">
                  <span className="ob-prev-label">{t('onboarding.previewTitle')}</span>
                  <span className="ob-prev-badge">{t('onboarding.previewExample')}</span>
                </div>
                <p className="ob-prev-dream">{t('onboarding.previewDream')}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  {PREVIEW_LAYERS.map((key) => (
                    <div key={key} className="ob-layer">
                      <span className="ob-layer-bar" />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="ob-layer-l">{t(`onboarding.previewLayers.${key}.layer`)}</div>
                        <div className="ob-layer-t">{t(`onboarding.previewLayers.${key}.text`)}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="ob-note ob-note--in">
                  <BoltIcon width={16} height={16} style={{ flexShrink: 0, marginTop: 1, color: 'var(--ob-success)' }} />
                  <div style={{ minWidth: 0 }}>
                    <div className="ob-note-l">{t('onboarding.previewRitualLabel')}</div>
                    <div className="ob-note-b">{t('onboarding.previewRitual')}</div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div className="ob-label" style={{ letterSpacing: '.16em' }}>{t('onboarding.layersTitle')}</div>
              <div className="ob-checks">
                {READING_LAYERS.map((key) => (
                  <div key={key} className="ob-check">
                    <span className="ob-dot"><CheckIcon width={10} height={10} style={{ color: 'var(--ob-success)' }} /></span>
                    <span className="ob-check-t">{t(`onboarding.layers.${key}`)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 'paywall' && (
          <div className="ob-step" style={{ gap: 17 }}>
            <div className="ob-pw-head">
              <span className="ob-pw-badge"><SparklesIcon width={26} height={26} /></span>
              <h2 className="ob-gold-title ob-h1--paywall">{t(`paywall.titles.${goal}`)}</h2>
              <p className="ob-sub">{t(`paywall.subs.${goal}`)}</p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {(Array.isArray(perks) ? perks : []).map((p, i) => {
                const Icon = (PERK_ICONS[goal] || PERK_ICONS.dreams)[i] || SparklesIcon;
                return (
                  <div key={i} className="ob-perk">
                    <span className={`ob-sq ob-sq--${PERK_TONES[i] || 'gold'}`} style={{ width: 34, height: 34, borderRadius: 12 }}>
                      <Icon width={17} height={17} />
                    </span>
                    <div style={{ minWidth: 0, flex: 1, paddingTop: 2 }}>
                      <div className="ob-perk-t">{p.title}</div>
                      <div className="ob-perk-s">{p.text}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="ob-edge ob-edge--card">
              <div className="ob-edge-in ob-edge-in--card">
                <div className="ob-label">{t('paywall.outcomesTitle')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {(Array.isArray(outcomes) ? outcomes : []).map((o, i) => (
                    <div key={i} className="ob-outcome">
                      <span className="ob-outcome-f">{o.from}</span>
                      <ArrowRightIcon width={14} height={14} style={{ flexShrink: 0, color: 'var(--ob-gold-txt)' }} />
                      <span className="ob-outcome-t">{o.to}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { sku: 'premium_yearly', name: t('paywall.planYear'), badge: t('paywall.plans.yearBadge') },
                { sku: 'premium_monthly', name: t('paywall.planMonth') },
              ].map(({ sku, name, badge }) => {
                const stars = plans?.[sku]?.stars;
                const perMonth = sku === 'premium_yearly' && stars ? Math.round(stars / 12) : stars;
                const on = selectedPlan === sku;
                return (
                  <button
                    key={sku}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setSelectedPlan(sku)}
                    className={on ? 'ob-plan ob-plan--on' : 'ob-plan'}
                  >
                    <span className={on ? 'ob-radio ob-radio--on' : 'ob-radio'}>
                      {on && <span className="ob-radio-dot" />}
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="ob-plan-name">
                        <span className="ob-plan-n">{name}</span>
                        {badge && <span className="ob-badge">{badge}</span>}
                      </span>
                      <span className="ob-plan-s" style={{ display: 'block' }}>
                        {sku === 'premium_yearly'
                          ? t('paywall.plans.yearSub', { stars: (stars || 0).toLocaleString('ru-RU') })
                          : t('paywall.plans.monthSub')}
                      </span>
                    </span>
                    <span style={{ textAlign: 'right', flexShrink: 0 }}>
                      <span className="ob-price" style={{ display: 'block' }}>
                        {perMonth
                          ? t('paywall.plans.stars', { n: perMonth.toLocaleString('ru-RU') })
                          : <span className="ob-skel" style={{ width: 56, height: 18, display: 'inline-block' }} />}
                      </span>
                      <span className="ob-per" style={{ display: 'block' }}>{t('paywall.plans.perMonth')}</span>
                    </span>
                  </button>
                );
              })}
              {plansFailed && (
                <>
                  <p className="ob-error">{t(sessionStale ? 'paywall.sessionStale' : 'paywall.plansError')}</p>
                  {sessionStale ? (
                    // Свежую подпись Telegram выдаёт только при новом запуске —
                    // закрываем приложение, человек открывает его из чата.
                    <button
                      type="button"
                      className="ob-retry"
                      style={{ alignSelf: 'center' }}
                      onClick={() => { try { window.Telegram?.WebApp?.close(); } catch (_) { loadPlans(); } }}
                    >
                      {t('paywall.sessionStaleCta')}
                    </button>
                  ) : (
                    <button type="button" className="ob-retry" style={{ alignSelf: 'center' }} onClick={loadPlans}>
                      {t('paywall.retry')}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="ob-done">
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <Moon frac={moonFrac} size={124} variant="done" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div className="ob-label ob-label--success">{t('onboarding.doneLabel')}</div>
              <h1 className="ob-gold-title ob-h1--done">{t('onboarding.doneTitle')}</h1>
              <p className="ob-lead">{t('onboarding.doneText')}</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {readyItems.map((item, i) => (
                <div key={i} className="ob-ready">
                  <span className="ob-ready-dot"><CheckIcon width={12} height={12} style={{ color: 'var(--ob-success)' }} /></span>
                  <span className="ob-ready-t">{item}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="ob-footer">
        {step === 'paywall' && payError && <p className="ob-error" role="alert">{payError}</p>}

        <GoldButton
          onClick={onCta}
          disabled={ctaDisabled}
          trailing={hasArrow ? <ArrowRightIcon width={18} height={18} style={{ color: '#1a0800' }} /> : null}
        >
          {step === 'paywall' && buying ? t('paywall.openingPayment') : ctaLabel}
        </GoldButton>

        {/* Обещание бесплатного первого разбора раньше несли экраны «Первый сон»
            и «Готово». Экраны убраны, обещание осталось — оно и есть повод
            нажать кнопку. */}
        {lastStep && step === 'promise' && (
          <>
            <p className="ob-hint" style={{ textAlign: 'center' }}>{t('onboarding.promiseFree')}</p>
            {/* Согласие с офертой и политикой (§1.1.4 правил VK Mini Apps) и
                возрастная отметка (§2.1.5) живут под кнопкой, а не на отдельном
                экране: каждый лишний экран до первого сна стоит людей. Ссылки —
                нативные <a target="_blank">: внутри жеста VK их не режет. */}
            {/* В приложении из App Store страница открыта с capacitor://localhost,
                а продавец там — грузинская компания: ведём на английские документы
                живого сервера. Русские /terms и /privacy написаны от российского
                продавца для VK и Telegram. Подпись ссылки там тоже другая: слово
                «оферта» — название именно того договора, а в сторе документ
                называется «условия использования». */}
            <p className="ob-consent">
              {t('consent.byStarting')}{' '}
              <a href={platform === 'ios' ? `${API_BASE}/terms-en` : window.location.origin + '/terms'} target="_blank" rel="noopener noreferrer">{platform === 'ios' ? t('consent.termsLinkIos') : t('consent.termsLink')}</a>
              {' '}{t('consent.and')}{' '}
              <a href={platform === 'ios' ? `${API_BASE}/privacy-en` : window.location.origin + '/privacy'} target="_blank" rel="noopener noreferrer">{t('consent.privacyLink')}</a>
              {' · '}{t('consent.ageShort')}
            </p>
          </>
        )}

        {step === 'paywall' && planRub && (
          <PillButton
            tone="violet"
            size="sm"
            disabled={buying || cardBuying}
            onClick={() => payCard(selectedPlan)}
          >
            {cardBuying ? t('paywall.awaitingPayment') : t('paywall.payByCard', { price: planRub })}
          </PillButton>
        )}

        {skip && (
          <button type="button" className="ob-skip" onClick={skip.onClick}>{skip.label}</button>
        )}

        {step === 'paywall' && <p className="ob-foot">{t('paywall.terms')}</p>}
      </div>
    </div>
  );
}
