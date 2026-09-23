import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftIcon, BellIcon, ClockIcon, MoonIcon, SparklesIcon, TrashIcon,
  ChatBubbleLeftRightIcon, ChevronDownIcon, ChevronRightIcon, XMarkIcon, CheckIcon,
} from '@heroicons/react/24/solid';
import axios from 'axios';
import YupSoulPromo from './YupSoulPromo.jsx';
import Paywall from './Paywall.jsx';
import {
  getUserId, getPlatform, providerCode, authHeader, signOutApple,
  getDisplayName, setDisplayName, getAvatarMoon, setAvatarMoon,
} from '../platform.js';
import { useTheme } from '../theme/useTheme.js';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmModal.jsx';
import VkGroupInvite from '../components/VkGroupInvite.jsx';
import RoundButton from '../components/RoundButton.jsx';
import GoldButton from '../components/GoldButton.jsx';
import PillButton from '../components/PillButton.jsx';
import EdgeCard from '../components/EdgeCard.jsx';
import Tile from '../components/Tile.jsx';
import Chip from '../components/Chip.jsx';
import SectionLabel from '../components/SectionLabel.jsx';
import Constellation from '../components/Constellation.jsx';
import Skeleton from '../components/Skeleton.jsx';
import MoonPhase from '../components/MoonPhase.jsx';
import { localToday, localNowTime, isFutureBirthMoment, isUnderMinAge } from '../utils/date.js';
import { tzLabel } from '../utils/timezones.js';
import { enableMorningReminder, disableMorningReminder, reconcileMorningReminder } from '../utils/reminders.js';
import '../styles/profile.css';

// 8 фаз Луны как аватары (только приложение App Store) — доля синодического
// месяца равномерно по кругу, см. MoonPhase/moonPath.
const AVATAR_MOON_PHASES = [0, 1, 2, 3, 4, 5, 6, 7];

// Официальное сообщество VK / бот Telegram — единственные каналы поддержки.
// t.me-ссылки внутри VK запрещены правилами VK Mini Apps.
// vk.me открывает ЧАТ с сообществом. Ссылка на страницу сообщества в приложении
// VK Мессенджер уводила на вкладку мессенджера вместо диалога (отчёт 7444937).
const SUPPORT_URL_VK = 'https://vk.me/club240008741';
const SUPPORT_URL_TG = 'https://t.me/tot_sonnic_bot';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Признак «аккаунт удалён»: свои данные обезличены на сервере, но VK продолжает
// отдавать имя и аватар в каждом запуске. Пока флаг стоит — не показываем их,
// иначе удаление выглядит несработавшим (отчёт 7438688). Снимается, когда
// пользователь заводит данные заново (первая расшифровка сна).
const DELETED_KEY = 'dw_account_deleted';
function accountDeleted() {
  try { return localStorage.getItem(DELETED_KEY) === '1'; } catch { return false; }
}

function getBrowserTimezone() {
  try {
    return typeof Intl !== 'undefined' && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;
  } catch (_) {
    return null;
  }
}

// Русские названия + смещение от Москвы — тестер отметил, что сырые IANA
// («Europe/Moscow») не локализованы. Значение остаётся IANA-строкой.
// Подписи берём из tzLabel — там же, где их получает автоопределение,
// иначе список и тост расходятся (в тосте была латиница, отчёт 7450254).
const COMMON_TIMEZONES = [
  'Europe/Kaliningrad', 'Europe/Moscow', 'Europe/Samara', 'Asia/Yekaterinburg',
  'Asia/Omsk', 'Asia/Novosibirsk', 'Asia/Irkutsk', 'Asia/Yakutsk',
  'Asia/Vladivostok', 'Asia/Magadan', 'Asia/Kamchatka',
  'Asia/Almaty', 'Asia/Tashkent', 'Europe/Minsk',
];

function computeStats(dreams) {
  const symbolCount = {};
  const patternCount = {};
  for (const d of dreams) {
    const a = Array.isArray(d.analyses) ? d.analyses[0] : d.analysis;
    if (!a) continue;
    for (const s of (a.symbols || [])) {
      if (s.symbol) symbolCount[s.symbol] = (symbolCount[s.symbol] || 0) + 1;
    }
    for (const p of (a.destructive_patterns || [])) {
      if (p) patternCount[p] = (patternCount[p] || 0) + 1;
    }
  }
  const topSymbols = Object.entries(symbolCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topPatterns = Object.entries(patternCount).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return { topSymbols, topPatterns };
}

// Длина серии ночей подряд. На бэкенде её нет, а последние 20 снов уже
// загружены — считаем по местным датам записей (не UTC, см. localToday).
// Серия ведётся от сегодня, а если сегодня записи ещё нет — от вчера.
function computeStreak(dreams) {
  const days = new Set();
  for (const d of dreams) {
    if (d.created_at) days.add(localToday(new Date(d.created_at)));
  }
  if (!days.size) return 0;
  const cursor = new Date();
  if (!days.has(localToday(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(localToday(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// Поиск городов (локальная база + Nominatim)
let _placesTimer = null;
let _placesAbort = null;
async function searchPlaces(q) {
  if (!q || q.trim().length < 2) return [];
  if (_placesAbort) _placesAbort.abort();
  _placesAbort = new AbortController();
  try {
    const res = await fetch(`${API_BASE}/api/places?q=${encodeURIComponent(q.trim())}`, {
      signal: _placesAbort.signal,
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export default function ProfilePage({ onBack }) {
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const showToast = useToast();
  // Реквизиты поддержки приходят с сервера и только не-VK сессиям: держать
  // номера карт в бандле нельзя, модерация VK читает исходник скрейпом.
  const [supportCards, setSupportCards] = useState([]);
  const [cardsOpen, setCardsOpen] = useState(false);
  const confirmDialog = useConfirm();
  const [userData, setUserData] = useState(null);
  const [dreamsCount, setDreamsCount] = useState(0);
  const [dreams, setDreams] = useState([]);
  const [timezone, setTimezone] = useState('');
  // Что реально сохранено на сервере — к нему откатываемся, если PATCH упал.
  const [savedTimezone, setSavedTimezone] = useState('');
  const [locationSaving, setLocationSaving] = useState(false);
  const [tzOpen, setTzOpen] = useState(false);
  // Быстрые тапы по нескольким чипам подряд — гонка PATCH: учитываем только
  // ответ на последний запрос, иначе поздний ответ откатил бы свежий выбор.
  const tzSeqRef = useRef(0);
  const [morningNotify, setMorningNotify] = useState(false);
  const [notifyLoading, setNotifyLoading] = useState(false);

  // Имя и аватар в приложении App Store — сервер их не хранит (см. platform.js),
  // живут только на устройстве.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [avatarMoon, setAvatarMoonState] = useState(() => getAvatarMoon());
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  // Vedic birth data
  const [natalChart, setNatalChart] = useState(null);
  const [birthDate, setBirthDate] = useState('');
  const [birthTime, setBirthTime] = useState('');
  const [noTime, setNoTime] = useState(false);
  const [birthCity, setBirthCity] = useState('');
  const [birthCityCoords, setBirthCityCoords] = useState(null); // {lat, lon}
  const [citySuggestions, setCitySuggestions] = useState([]);
  const cityInputRef = useRef(null);
  // Подтянуть поле города к центру, чтобы выпадающий список не оставался за
  // клавиатурой/краем экрана (репорт Вячеслава: не было автоскролла к списку).
  const scrollCityIntoView = () => {
    setTimeout(() => cityInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
  };
  const [showCitySuggestions, setShowCitySuggestions] = useState(false);
  const [birthSaving, setBirthSaving] = useState(false);
  const [showBirthForm, setShowBirthForm] = useState(false);

  // Подписка
  const [subInfo, setSubInfo] = useState(null); // { active, subscription, free }
  const [showPaywall, setShowPaywall] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const userId = getUserId();
  const platform = getPlatform();
  // Местная дата, не UTC (см. комментарий в HomePage).
  const todayStr = localToday();

  const loadSubscription = () => {
    if (!userId) return;
    authHeader().then(headers => {
      axios.get(`${API_BASE}/api/user/${userId}/subscription`, { headers })
        .then(r => setSubInfo(r.data))
        .catch(() => {});
    });
  };

  useEffect(() => {
    if (!userId || getPlatform() === 'vk') return;
    let cancelled = false;
    authHeader().then((headers) => {
      fetch(`${API_BASE}/api/support-details`, { headers })
        .then((r) => r.json())
        .then((d) => { if (!cancelled && Array.isArray(d.cards)) setSupportCards(d.cards); })
        .catch(() => {});
    });
    return () => { cancelled = true; };
  }, [userId]);

  // VK не хранит имя пользователя на бэке (см. privacy — только числовой id),
  // поэтому реальное имя/аватар для VK берём напрямую из VK Bridge —
  // единственный источник, без него VK-юзер всегда видел бы "Гость"
  // (найдено VK-модератором: п.1.1.2 требует бесшовную идентификацию по vk_user_id).
  useEffect(() => {
    if (getPlatform() !== 'vk') return;
    // После удаления аккаунта личность у VK не запрашиваем: свои данные мы стёрли,
    // но VK отдаёт имя и аватар при каждом входе — и при повторном заходе в профиль
    // пользователь снова видел себя, будто удаления не было (отчёт 7438688).
    if (accountDeleted()) return;
    import('@vkontakte/vk-bridge').then(({ default: vkBridge }) => {
      vkBridge.send('VKWebAppGetUserInfo').then((info) => {
        setUserData((prev) => ({
          ...prev,
          first_name: [info.first_name, info.last_name].filter(Boolean).join(' ') || prev?.first_name,
          photo_200: info.photo_200,
        }));
      }).catch(() => {});
    });
  }, []);

  // В Telegram аватар и имя берём у клиента: бэкенд фотографию не хранит
  // (в profile только telegram_id, username, имя), поэтому кружок оставался
  // с одной буквой. photo_url приходит не во всех клиентах — тогда буква.
  useEffect(() => {
    if (getPlatform() !== 'telegram') return;
    const u = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (!u) return;
    setUserData((prev) => ({
      ...prev,
      first_name: [u.first_name, u.last_name].filter(Boolean).join(' ') || prev?.first_name,
      photo_200: u.photo_url || prev?.photo_200,
    }));
  }, []);

  // В приложении App Store сервер имя не хранит (вход только по sub, см.
  // platform.js) — берём его с устройства: то, что дал Apple при первом
  // входе (scope 'name'), либо то, что человек ввёл сам в профиле.
  useEffect(() => {
    if (getPlatform() !== 'ios') return;
    const name = getDisplayName();
    if (name) setUserData((prev) => ({ ...prev, first_name: name }));
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!userId) {
        // Не затираем имя из VK Bridge, если оно уже пришло (мёрж, не замена).
        setUserData((prev) => prev || { first_name: t('common.guest') });
        setTimezone(getBrowserTimezone() || '');
        return;
      }
      try {
        const headers = await authHeader();
        const [profileRes, dreamsRes] = await Promise.all([
          axios.get(`${API_BASE}/api/user/${userId}/profile?provider=${providerCode()}`, { headers }),
          axios.get(`${API_BASE}/api/user/${userId}/dreams?limit=20`, { headers }),
        ]);
        const user = profileRes.data.user || { first_name: t('common.guest') };
        // На VK имя/аватар приходят из VK Bridge (эффект выше) — бэк их не хранит
        // (только числовой id, см. приватность). Мёржим, НЕ заменяем: иначе гонка
        // сети/bridge затёрла бы имя VK на null → профиль показал бы «Гость»
        // (§1.1.2, прошлый отказ модератора). На TG/Web prev пуст → берётся бэк.
        setUserData((prev) => ({
          ...user,
          // После обезличивания бэк отдаёт null — показываем «Гость», а не пустоту.
          first_name: prev?.first_name || user.first_name || t('common.guest'),
          photo_200: prev?.photo_200 || user.photo_200,
        }));
        setDreamsCount(profileRes.data.dreams_count ?? 0);
        const notifyOn = profileRes.data.morning_notify ?? false;
        setMorningNotify(notifyOn);
        // Сервер мог хранить morning_notify=true ещё с прошлой сессии, пока
        // локальный флаг/расписание потеряны (переустановка, очистка
        // localStorage) — сверяем локальное напоминание с сервером сразу,
        // не дожидаясь следующего запуска (см. reminders.js).
        if (platform === 'ios') reconcileMorningReminder(notifyOn, i18n.language);
        setDreams(Array.isArray(dreamsRes.data) ? dreamsRes.data : []);
        setTimezone(user.timezone || getBrowserTimezone() || '');
        setSavedTimezone(user.timezone || ''); // эталон для отката, если PATCH упадёт
        // Natal chart
        try {
          const natalRes = await axios.get(`${API_BASE}/api/user/${userId}/natal?provider=${providerCode()}`, { headers });
          if (natalRes.data.natal_chart) {
            setNatalChart(natalRes.data.natal_chart);
            // Для предзаполнения формы редактирования — иначе "Изменить дату
            // рождения" открывала бы пустую форму, будто данные потерялись.
            if (natalRes.data.birth_date) setBirthDate(natalRes.data.birth_date);
            if (natalRes.data.birth_time) setBirthTime(natalRes.data.birth_time);
            else setNoTime(true);
            if (natalRes.data.birth_place_name) setBirthCity(natalRes.data.birth_place_name);
            if (natalRes.data.birth_place_lat && natalRes.data.birth_place_lon) {
              setBirthCityCoords({ lat: natalRes.data.birth_place_lat, lon: natalRes.data.birth_place_lon });
            }
          }
        } catch (_) {}
        loadSubscription();
      } catch (e) {
        console.error(e);
        // Не затираем имя/аватар VK из Bridge при сетевом сбое (иначе «Гость»).
        setUserData((prev) => ({ first_name: prev?.first_name || t('common.guest'), photo_200: prev?.photo_200 }));
        setTimezone(getBrowserTimezone() || '');
      }
    };
    load();
  }, []);

  const toggleNotify = async () => {
    if (!userId) return;
    setNotifyLoading(true);
    try {
      const nextOn = !morningNotify;
      const res = await axios.post(`${API_BASE}/api/user/${userId}/notifications`, { morning_notify: nextOn }, { headers: await authHeader() });
      let confirmed = res.data.morning_notify;
      // На iOS сервер шлёт напоминания только через Telegram-бота, которого
      // у Apple-пользователя нет (telegram_id всегда null) — рядом со флагом
      // на сервере планируем/снимаем локальное уведомление на устройстве.
      if (platform === 'ios') {
        if (confirmed) {
          const granted = await enableMorningReminder(i18n.language);
          if (!granted) {
            confirmed = false;
            // Держим серверный флаг в согласии с реальным разрешением на
            // устройстве — иначе тумблер обещал бы то, что не придёт.
            axios.post(`${API_BASE}/api/user/${userId}/notifications`, { morning_notify: false }, { headers: await authHeader() }).catch(() => {});
            showToast(t('profile.notifications.permissionDenied'));
          }
        } else {
          await disableMorningReminder();
        }
      }
      setMorningNotify(confirmed);
    } catch (e) { console.error(e); }
    finally { setNotifyLoading(false); }
  };

  // ─── Имя и аватар в приложении App Store (только устройство, см. platform.js) ───
  const startEditName = () => {
    const current = userData?.first_name;
    setNameDraft(current && current !== t('common.guest') ? current : '');
    setEditingName(true);
  };
  const saveName = () => {
    const trimmed = nameDraft.trim();
    setDisplayName(trimmed);
    setUserData((prev) => ({ ...prev, first_name: trimmed || t('common.guest') }));
    setEditingName(false);
  };
  const pickAvatar = (index) => {
    setAvatarMoon(index);
    setAvatarMoonState(index);
    setShowAvatarPicker(false);
  };
  const resetAvatar = () => {
    setAvatarMoon(null);
    setAvatarMoonState(null);
    setShowAvatarPicker(false);
  };

  // Часовой пояс сохраняется сразу по тапу — отдельной кнопки «Сохранить» нет.
  const pickTimezone = async (tz) => {
    const previous = savedTimezone;
    const seq = ++tzSeqRef.current;
    setTimezone(tz);
    setLocationSaving(true);
    try {
      await axios.patch(`${API_BASE}/api/user/${userId}/profile`, { timezone: tz, provider: providerCode() }, { headers: await authHeader() });
      if (seq !== tzSeqRef.current) return;
      setSavedTimezone(tz);
      showToast(t('profile.timezone.saved'), 'success');
    } catch (e) {
      console.error(e);
      if (seq !== tzSeqRef.current) return;
      setTimezone(previous || getBrowserTimezone() || '');
      showToast(t('profile.timezone.saveFail'));
    } finally {
      if (seq === tzSeqRef.current) setLocationSaving(false);
    }
  };

  const saveBirthData = async () => {
    if (!birthDate || !userId) return;
    setBirthSaving(true);
    try {
      if (!birthCityCoords) {
        // Натальная карта требует координаты — без выбранного из списка города
        // бэкенд вернёт 400. Просим выбрать город (или ввести и выбрать подсказку).
        showToast(t('common.citySelectAlert'));
        setBirthSaving(false);
        return;
      }
      // Android-пикеры игнорируют max у input[type=time], поэтому проверяем сами
      // (отчёт 7438498: дату в будущее уже нельзя, а время — можно было).
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
      const res = await axios.patch(`${API_BASE}/api/user/${userId}/birth-data`, {
        birth_date: birthDate,
        birth_time: noTime ? null : birthTime || null,
        birth_place_lat: birthCityCoords?.lat ?? null,
        birth_place_lon: birthCityCoords?.lon ?? null,
        birth_place_name: birthCity || null,
        provider: providerCode(),
        // Пояс устройства — см. комментарий в HomePage (отчёт 7438498).
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
      }, { headers: await authHeader() });
      if (res.data.natal_chart) {
        setNatalChart(res.data.natal_chart);
        setShowBirthForm(false);
      } else {
        showToast(res.data?.error || t('home.birthModal.error'));
      }
    } catch (e) {
      console.error(e);
      // Показываем реальную причину с бэка (например «Проверьте дату рождения»),
      // а не общий текст — тестеры просили конкретику (bug7438684).
      showToast(e.response?.data?.error || t('home.birthModal.error'));
    }
    finally { setBirthSaving(false); }
  };

  const deleteAccount = async () => {
    if (!userId) return;
    if (!(await confirmDialog(t('profile.delete.confirm')))) return;
    setDeleting(true);
    try {
      await axios.delete(`${API_BASE}/api/user/${userId}/account?provider=${providerCode()}`, { headers: await authHeader() });
      showToast(t('profile.delete.done'), 'success');
      // НЕ перезагружаем страницу: reload заново дёргает VK Bridge и возвращает
      // имя/аватар, из-за чего обезличивание было бы не видно (bug7438688).
      // Флаг переживает уход со страницы и перезапуск — при повторном заходе
      // в профиль личность у VK больше не запрашивается.
      try { localStorage.setItem(DELETED_KEY, '1'); } catch { /* приватный режим */ }
      // В приложении из App Store аккаунт — это вход через Apple: после удаления
      // выходим, и следующий разбор снова попросит войти. Локальное утреннее
      // напоминание (reminders.js) живёт на устройстве отдельно от Apple-сессии —
      // без явной отмены оно продолжало бы приходить после удаления аккаунта и
      // ensureMorningReminder переставляло бы его на каждом запуске (флаг
      // dw_morning_notify signOutApple не трогает).
      if (platform === 'ios') { signOutApple(); await disableMorningReminder(); }
      setUserData({ first_name: t('common.guest'), photo_200: null });
      setDreams([]); setDreamsCount(0); setNatalChart(null); setSubInfo(null);
      setTimeout(() => { onBack?.(); }, 1500);
    } catch (e) {
      console.error(e);
      showToast(t('profile.delete.error'));
      setDeleting(false);
    }
  };

  // Поддержка: в VK — открываем сообщество через нативный UI (не t.me,
  // запрещено правилами VK Mini Apps), с fallback на копирование ссылки,
  // если бридж не ответил. В Telegram — открываем бота напрямую.
  const openSupport = async () => {
    if (getPlatform() === 'vk') {
      // На iOS VKWebAppOpenLink иногда РЕЗОЛВИТСЯ, но ссылку не открывает — тогда
      // Promise.race «успешно» проходил и фолбэка не было → «ничего не происходит»
      // (bug7439407, Виталий iOS). Поэтому фолбэчим не только на ошибке/таймауте,
      // но и когда бридж не подтвердил result:true.
      const timeout = new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 2500));
      let opened = false;
      try {
        const vkBridge = (await import('@vkontakte/vk-bridge')).default;
        const res = await Promise.race([vkBridge.send('VKWebAppOpenLink', { link: SUPPORT_URL_VK }), timeout]);
        opened = res?.result === true;
      } catch { /* фолбэк ниже */ }
      // Бридж не открыл ссылку — открываем сообщество новой вкладкой.
      // (Раньше здесь копировалась ссылка с тостом «скопировано» — это сбивало
      //  с толку, тестер ждал перехода в чат, bug7438523.)
      if (!opened) window.open(SUPPORT_URL_VK, '_blank', 'noopener');
      return;
    }
    // В приложении из App Store — письмо: бот в Telegram продаёт доступ за Stars,
    // а ссылка к оплате мимо App Store нарушает правило Apple 3.1.1.
    if (platform === 'ios') {
      window.location.href = 'mailto:yupsoulmusic@gmail.com';
      return;
    }
    // Поддержка в Telegram — это чат нашего же бота, из которого человек и
    // открыл мини-приложение. openTelegramLink на «сам себя» ничего не делает:
    // на десктопе кнопка выглядела сломанной. Просто закрываем окно — человек
    // оказывается ровно в том чате, где может написать.
    const tg = window.Telegram?.WebApp;
    if (tg?.close) {
      tg.close();
    } else if (tg?.openTelegramLink) {
      tg.openTelegramLink(SUPPORT_URL_TG);
    } else {
      window.open(SUPPORT_URL_TG, '_blank');
    }
  };

  const copyCard = (number) => {
    navigator.clipboard?.writeText(number);
    showToast(t('profile.copied'), 'success');
  };

  const { topSymbols, topPatterns } = computeStats(dreams);
  const streak = computeStreak(dreams);
  const symbolsMax = topSymbols.length ? topSymbols[0][1] : 1;
  // Пока userData не пришли — скелетон, а не «?»: знак вопроса мелькал вместо
  // аватарки при загрузке вкладки профиля (репорт Вячеслава). Как и с именем ниже.
  const initials = userData?.first_name?.charAt(0)?.toUpperCase() || '';
  const dreamsLabel = t('profile.dreams', { count: dreamsCount });
  // На VK тарифов нет — в подписи только число снов (Искры живут в карточке ниже).
  const headerSub = platform === 'vk'
    ? (userData ? dreamsLabel : '')
    : (subInfo ? `${subInfo.active ? t('profile.headerPremium') : t('profile.headerFree')} · ${dreamsLabel}` : '');

  // «Мина (Рыбы)» — для русского берём привычное название из скобок,
  // для английского показываем строку целиком: перевода у бэка нет.
  const moonSign = natalChart?.planets?.moon?.sign || '';
  const moonSignLabel = i18n.language === 'ru' ? (moonSign.match(/\(([^)]+)\)/)?.[1] || moonSign) : moonSign;
  const tzList = timezone && !COMMON_TIMEZONES.includes(timezone) ? [...COMMON_TIMEZONES, timezone] : COMMON_TIMEZONES;
  const showCards = platform !== 'vk' && supportCards.length > 0;

  return (
    <div className="page">
      <div className="page-scroll" style={{ padding: '0 18px calc(env(safe-area-inset-bottom, 0px) + 28px)' }}>
        {/* Своего <header> у экрана нет, поэтому safe-area задаём вручную:
            плавающие кнопки VK «ещё» и «закрыть» на iPhone 390×844 кончаются на 78-й точке,
            47 (инсет) + 40 даёт девять точек воздуха под ними (коммит 7eb2f07). */}
        <div style={{ padding: 'var(--v3-top) 0 0', display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* ── Шапка ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <RoundButton onClick={onBack} label={t('common.back')}>
              <ArrowLeftIcon style={{ width: 17, height: 17 }} />
            </RoundButton>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--v3-fg)', lineHeight: 1.2 }}>
                {t('profile.title')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--v3-fg-3)', marginTop: 2, minHeight: 15, overflowWrap: 'anywhere' }}>
                {headerSub}
              </div>
            </div>
          </div>

          {/* ── Карточка человека ── */}
          <EdgeCard padding="20px 18px">
            <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
              {userData ? (
                platform === 'ios' ? (
                  // В приложении App Store кружок — вход в выбор лунного аватара
                  // (набор MoonPhase, хранится на устройстве). По умолчанию инициалы.
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setShowAvatarPicker((v) => !v)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowAvatarPicker((v) => !v); } }}
                    aria-label={t('profile.avatarPicker.title')}
                    style={{
                      width: 62, height: 62, borderRadius: 999, flexShrink: 0, overflow: 'hidden',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                      fontSize: 26, fontWeight: 800, color: '#1a0800',
                      background: avatarMoon != null ? 'var(--v3-inset)' : 'linear-gradient(135deg,#f5a623,#c97a10)',
                      boxShadow: avatarMoon != null ? 'none' : '0 6px 18px rgba(201,122,16,.32)',
                    }}
                  >
                    {avatarMoon != null ? <MoonPhase frac={avatarMoon / 8} size={62} /> : initials}
                  </div>
                ) : (
                  <div style={{
                    width: 62, height: 62, borderRadius: 999, flexShrink: 0, overflow: 'hidden',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 26, fontWeight: 800, color: '#1a0800',
                    background: userData.photo_200 ? 'transparent' : 'linear-gradient(135deg,#f5a623,#c97a10)',
                    boxShadow: userData.photo_200 ? 'none' : '0 6px 18px rgba(201,122,16,.32)',
                  }}>
                    {userData.photo_200
                      ? <img src={userData.photo_200} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : initials}
                  </div>
                )
              ) : (
                <Skeleton width={62} height={62} radius={999} style={{ flexShrink: 0 }} />
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                {userData ? (
                  editingName ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <input
                        className="pf-input"
                        style={{ height: 40, fontSize: 15 }}
                        value={nameDraft}
                        maxLength={40}
                        autoFocus
                        placeholder={t('profile.nameForm.placeholder')}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false); }}
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <PillButton size="sm" tone="gold" onClick={saveName} style={{ width: 'auto', padding: '0 16px' }}>
                          {t('profile.nameForm.save')}
                        </PillButton>
                        <PillButton size="sm" onClick={() => setEditingName(false)} style={{ width: 'auto', padding: '0 16px' }}>
                          {t('common.cancel')}
                        </PillButton>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{
                        fontSize: 18, fontWeight: 800, color: 'var(--v3-fg)', letterSpacing: '-.015em',
                        // Длинное ФИО (по лимитам ВК) переносим, а не ломаем вёрстку (репорт Дарьи).
                        overflowWrap: 'anywhere', wordBreak: 'break-word',
                      }}>
                        {userData.first_name || t('common.guest')}
                      </div>
                      {userData.username && (
                        <div style={{ fontSize: 12, color: 'var(--v3-fg-4)', marginTop: 2 }}>@{userData.username}</div>
                      )}
                      <div style={{ display: 'flex', gap: 6, marginTop: 9, flexWrap: 'wrap', alignItems: 'center' }}>
                        <Chip tone="gold">{dreamsLabel}</Chip>
                        {streak >= 2 && <Chip tone="violet">{t('profile.streak', { count: streak })}</Chip>}
                        {platform === 'ios' && (
                          <button
                            type="button"
                            className="pf-ghost"
                            style={{ width: 'auto', height: 26, padding: '0 11px', fontSize: 11 }}
                            onClick={startEditName}
                          >
                            {t('profile.editName')}
                          </button>
                        )}
                      </div>
                    </>
                  )
                ) : (
                  <>
                    <Skeleton width={120} height={18} />
                    <Skeleton width={80} height={12} style={{ marginTop: 8 }} />
                  </>
                )}
              </div>
            </div>
          </EdgeCard>

          {/* ── Выбор лунного аватара (только приложение App Store) ── */}
          {platform === 'ios' && showAvatarPicker && (
            <div style={{
              borderRadius: 20, border: '1px solid var(--v3-chip-g-br)', background: 'var(--v3-tile)',
              padding: 16, display: 'flex', flexDirection: 'column', gap: 13,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--v3-fg)' }}>{t('profile.avatarPicker.title')}</div>
                <button type="button" className="pf-x" onClick={() => setShowAvatarPicker(false)} aria-label={t('common.cancel')}>
                  <span className="pf-x__in"><XMarkIcon style={{ width: 13, height: 13 }} /></span>
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {AVATAR_MOON_PHASES.map((i) => (
                  <button
                    key={i}
                    type="button"
                    className="pf-moon"
                    onClick={() => pickAvatar(i)}
                    aria-label={t('profile.avatarPicker.phase', { n: i + 1 })}
                  >
                    <span className={avatarMoon === i ? 'pf-moon__in pf-moon__in--on' : 'pf-moon__in'}>
                      <MoonPhase frac={i / 8} size={40} />
                    </span>
                  </button>
                ))}
              </div>
              <PillButton size="sm" onClick={resetAvatar} style={{ width: 'auto', padding: '0 16px' }}>
                {t('profile.avatarPicker.reset')}
              </PillButton>
            </div>
          )}

          {/* ── Подписка ── */}
          {subInfo && (subInfo.active ? (
            <div style={{
              borderRadius: 20, border: '1px solid var(--v3-chip-g-br)', background: 'var(--v3-upsell)',
              padding: '15px 16px', display: 'flex', alignItems: 'center', gap: 13,
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 13, flexShrink: 0,
                background: 'linear-gradient(135deg,#f5a623,#c97a10)', boxShadow: '0 0 18px rgba(232,146,10,.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <SparklesIcon style={{ width: 20, height: 20, color: '#1a0800' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--v3-gold-txt)' }}>{t('profile.premium.active')}</div>
                <div style={{ fontSize: 12, color: 'var(--v3-fg-3)', marginTop: 2 }}>
                  {subInfo.subscription?.plan_sku === 'premium_yearly' ? t('profile.premium.planYearly') : t('profile.premium.planMonthly')}
                  {subInfo.subscription?.renew_at ? t('profile.premium.renewUntil', { date: new Date(subInfo.subscription.renew_at).toLocaleDateString(i18n.language === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' }) }) : ''}
                </div>
              </div>
            </div>
          ) : (
            <div style={{
              borderRadius: 20, border: '1px solid var(--v3-chip-g-br)', background: 'var(--v3-upsell)',
              padding: 16, display: 'flex', flexDirection: 'column', gap: 13,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 13, flexShrink: 0,
                  background: 'var(--v3-chip-g)', border: '1px solid var(--v3-chip-g-br)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <SparklesIcon style={{ width: 20, height: 20, color: 'var(--v3-gold-txt)' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--v3-fg)' }}>
                    {platform === 'vk' ? t('profile.premium.titleVk') : t('profile.premium.title')}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--v3-fg-3)', marginTop: 2 }}>
                    {platform === 'vk'
                      ? t('paywall.iskryBalance', { n: subInfo.iskry?.balance ?? 0 })
                      : (subInfo.free
                        ? t('profile.freeLeft', { remaining: subInfo.free.remaining, limit: subInfo.free.limit })
                        : t('profile.premium.unlimitedDesc'))}
                  </div>
                </div>
              </div>
              {/* Полоса остатка — только там, где есть бесплатный лимит: на VK
                  анализы покупаются Искрами, шкалы «осталось из пяти» там нет. */}
              {platform !== 'vk' && subInfo.free && (
                <div style={{ height: 7, borderRadius: 999, background: 'var(--v3-inset)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 999, transition: 'width .3s',
                    width: `${subInfo.free.limit ? Math.round((subInfo.free.remaining / subInfo.free.limit) * 100) : 0}%`,
                    background: 'linear-gradient(90deg,#f5a623,#c97a10)',
                  }} />
                </div>
              )}
              <GoldButton
                onClick={() => setShowPaywall(true)}
                icon={<SparklesIcon style={{ width: 15, height: 15, color: '#1a0800' }} />}
              >
                {platform === 'vk' ? t('profile.premium.topUpIskry') : t('profile.premium.upgradeButton')}
              </GoldButton>
            </div>
          ))}

          {/* ── Персональный прогноз ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <SectionLabel
              title={t('profile.forecastLabel')}
              right={
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
                  color: natalChart ? 'var(--v3-success)' : 'var(--v3-gold-txt)',
                  background: natalChart ? 'transparent' : 'var(--v3-chip-g)',
                  border: `1px solid ${natalChart ? 'var(--v3-success)' : 'var(--v3-chip-g-br)'}`,
                }}>
                  {natalChart ? t('profile.forecastOn') : t('profile.forecastOff')}
                </span>
              }
            />

            {showBirthForm ? (
              // Подсказки городов рисуются поверх соседних зон, поэтому карточка
              // формы поднята над ними (bug7438512).
              <div style={{
                borderRadius: 20, border: '1px solid var(--v3-chip-g-br)', background: 'var(--v3-tile)',
                padding: 16, display: 'flex', flexDirection: 'column', gap: 13,
                position: 'relative', zIndex: 5,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--v3-fg)' }}>{t('profile.birthFormTitle')}</div>
                  <button type="button" className="pf-x" onClick={() => setShowBirthForm(false)} aria-label={t('common.cancel')}>
                    <span className="pf-x__in"><XMarkIcon style={{ width: 13, height: 13 }} /></span>
                  </button>
                </div>

                <div>
                  <label className="pf-field__l" htmlFor="pf-birth-date">{t('profile.birthForm.date')}</label>
                  <input
                    id="pf-birth-date"
                    className="pf-input"
                    type="date"
                    value={birthDate}
                    min="1900-01-01"
                    max={todayStr}
                    onChange={e => setBirthDate(e.target.value)}
                  />
                </div>

                <div>
                  <label className="pf-field__l" htmlFor="pf-birth-time">{t('profile.birthForm.time')}</label>
                  <input
                    id="pf-birth-time"
                    className="pf-input"
                    type="time"
                    value={birthTime}
                    // При сегодняшней дате время не может быть позже текущего (7438498).
                    max={birthDate === todayStr ? localNowTime() : undefined}
                    onChange={e => setBirthTime(e.target.value)}
                    disabled={noTime}
                  />
                  <label className="pf-check">
                    <input className="pf-check__i" type="checkbox" checked={noTime} onChange={e => setNoTime(e.target.checked)} />
                    <span className={noTime ? 'pf-check__box pf-check__box--on' : 'pf-check__box'}>
                      <CheckIcon style={{ width: 12, height: 12, opacity: noTime ? 1 : 0 }} />
                    </span>
                    <span className="pf-check__t">{t('common.noTime')}</span>
                  </label>
                  {/* Своя кнопка очистки: «Сбросить» в системном пикере Android поле
                      не очищала, и отменить введённое время было нечем (отчёт 7447837). */}
                  {!noTime && birthTime && (
                    <PillButton size="sm" onClick={() => setBirthTime('')} style={{ width: 'auto', marginTop: 9, padding: '0 16px' }}>
                      {t('common.clearTime')}
                    </PillButton>
                  )}
                </div>

                <div style={{ position: 'relative' }}>
                  <label className="pf-field__l" htmlFor="pf-birth-city">{t('profile.birthForm.city')}</label>
                  <input
                    id="pf-birth-city"
                    className="pf-input"
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
                        const results = await searchPlaces(val);
                        setCitySuggestions(results);
                        setShowCitySuggestions(results.length > 0);
                        if (results.length) scrollCityIntoView(); // подтянуть список в зону видимости
                      }, 300);
                    }}
                    onFocus={() => { if (citySuggestions.length) setShowCitySuggestions(true); scrollCityIntoView(); }}
                    onBlur={() => setTimeout(() => setShowCitySuggestions(false), 200)}
                  />
                  {birthCity.trim().length === 1 && (
                    <p style={{ fontSize: 11.5, color: 'var(--v3-fg-4)', margin: '7px 0 0', lineHeight: 1.45 }}>
                      {t('common.cityTypeMore')}
                    </p>
                  )}
                  <p style={{ fontSize: 11.5, color: 'var(--v3-fg-4)', margin: '7px 0 0', lineHeight: 1.45 }}>
                    {t('profile.cityHint')}
                  </p>
                  {showCitySuggestions && citySuggestions.length > 0 && (
                    <div className="pf-suggest">
                      {citySuggestions.map((s, i) => (
                        <div
                          key={i}
                          className="pf-suggest__i"
                          onMouseDown={() => {
                            setBirthCity(s.display_name);
                            setBirthCityCoords({ lat: parseFloat(s.lat), lon: parseFloat(s.lon) });
                            setCitySuggestions([]);
                            setShowCitySuggestions(false);
                          }}
                        >
                          {s.display_name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <GoldButton onClick={saveBirthData} disabled={!birthDate || !birthCityCoords || birthSaving}>
                  {birthSaving ? t('profile.birthForm.calculating') : t('home.birthModal.enable')}
                </GoldButton>
              </div>
            ) : natalChart ? (
              <>
                <Tile padding="16px" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <p style={{ fontSize: 13.5, lineHeight: 1.62, color: 'var(--v3-fg-2)', margin: 0 }}>
                    {t('profile.personalForecast.activeDesc')}
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div style={{ padding: '11px 13px', borderRadius: 13, background: 'var(--v3-inset)' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--v3-fg-4)' }}>
                        {t('profile.natalMoon')}
                      </div>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--v3-purple-txt)', marginTop: 4 }}>{moonSignLabel}</div>
                    </div>
                    {natalChart.planets?.moon?.dreamWord ? (
                      <div style={{ padding: '11px 13px', borderRadius: 13, background: 'var(--v3-inset)' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--v3-fg-4)' }}>
                        {t('profile.dreamSignature')}
                      </div>
                      {/* Санскритское имя (Рохини) человеку ничего не говорит —
                          показываем «почерк снов» словами. */}
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--v3-gold-txt)', marginTop: 4 }}>
                        {natalChart.planets?.moon?.dreamWord || ''}
                      </div>
                    </div>
                    ) : null}
                  </div>
                  <button type="button" className="pf-ghost" onClick={() => setShowBirthForm(true)}>
                    {t('profile.personalForecast.change')}
                  </button>
                </Tile>
                <YupSoulPromo variant="birth" />
              </>
            ) : (
              <div style={{
                borderRadius: 20, border: '1px dashed var(--v3-chip-g-br)', background: 'var(--v3-gold-wash)',
                padding: 16, display: 'flex', flexDirection: 'column', gap: 13,
              }}>
                <p style={{ fontSize: 13.5, lineHeight: 1.62, color: 'var(--v3-fg-2)', margin: 0 }}>
                  {t('profile.personalForecast.inactive')}
                </p>
                <PillButton
                  tone="gold"
                  onClick={() => setShowBirthForm(true)}
                  icon={<SparklesIcon style={{ width: 17, height: 17 }} />}
                >
                  {t('profile.personalForecast.enable')}
                </PillButton>
              </div>
            )}
          </div>

          {/* ── Ваша динамика ── */}
          {(topSymbols.length > 0 || topPatterns.length > 0) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <SectionLabel title={t('profile.stats.title')} right={t('profile.stats.byDreams', { count: dreams.length })} />
              {topSymbols.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {topSymbols.map(([sym, cnt]) => (
                    <div key={sym} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <span style={{
                        fontSize: 13, fontWeight: 600, color: 'var(--v3-fg-2)', width: 96, flexShrink: 0,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{sym}</span>
                      <span style={{ flex: 1, height: 8, borderRadius: 999, background: 'var(--v3-inset)', overflow: 'hidden' }}>
                        <span style={{
                          display: 'block', height: '100%', borderRadius: 999,
                          width: `${Math.round((cnt / symbolsMax) * 100)}%`,
                          background: 'linear-gradient(90deg,#f5a623,#c97a10)',
                        }} />
                      </span>
                      <span style={{ fontSize: 11.5, color: 'var(--v3-fg-4)', width: 22, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                        {cnt}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {topPatterns.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2 }}>
                  {topPatterns.map(([pat, cnt]) => (
                    <div key={pat} style={{
                      display: 'flex', gap: 11, padding: '12px 14px', borderRadius: 14,
                      background: 'var(--v3-danger-bg)', border: '1px solid var(--v3-danger-br)',
                    }}>
                      <span style={{ width: 2, flexShrink: 0, borderRadius: 2, background: 'var(--v3-danger)' }} />
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--v3-danger)', marginBottom: 4 }}>
                          {t('profile.stats.pattern')}
                        </div>
                        <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--v3-fg-2)' }}>
                          {pat} · {t('profile.stats.inDreams', { count: cnt })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Настройки ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <SectionLabel title={t('profile.settings')} />
            <div className="pf-list">

              <div className="pf-row">
                <div className="pf-ico pf-ico--purple"><MoonIcon style={{ width: 18, height: 18 }} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="pf-row__t">{t('profile.theme')}</div>
                  <div className="pf-row__s">
                    {platform === 'vk' ? t('profile.themeHintVk') : platform === 'telegram' ? t('profile.themeHint') : t('profile.themeHintWeb')}
                  </div>
                </div>
                <button type="button" className="pf-seg" onClick={toggleTheme} aria-label={t('profile.theme')}>
                  <span className="pf-seg__in">
                    <span className={theme === 'dark' ? 'pf-pill pf-pill--on' : 'pf-pill'}>{t('profile.themeNight')}</span>
                    <span className={theme === 'light' ? 'pf-pill pf-pill--on' : 'pf-pill'}>{t('profile.themeDay')}</span>
                  </span>
                </button>
              </div>

              {/* Утренние напоминания. На VK строки нет (§2.3.6): доставка идёт
                  только через Telegram-бота — VK-юзеру тумблер ничего бы не включал. */}
              {userId && platform !== 'vk' && (
                <>
                  <div className="pf-sep" />
                  <div className="pf-row">
                    <div className="pf-ico pf-ico--gold"><BellIcon style={{ width: 18, height: 18 }} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="pf-row__t">{t('profile.notifications.title')}</div>
                      <div className="pf-row__s">
                        {morningNotify ? t('profile.notifications.desc') : t('profile.notifications.offHint')}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="pf-switch-btn"
                      onClick={toggleNotify}
                      disabled={notifyLoading}
                      role="switch"
                      aria-checked={morningNotify}
                      aria-label={t('profile.notifications.title')}
                      style={{ opacity: notifyLoading ? 0.6 : 1 }}
                    >
                      <span className={morningNotify ? 'pf-switch pf-switch--on' : 'pf-switch'}>
                        <span className="pf-knob" />
                      </span>
                    </button>
                  </div>
                </>
              )}

              {userId && (
                <>
                  <div className="pf-sep" />
                  <button type="button" className="pf-row" onClick={() => setTzOpen(o => !o)} aria-expanded={tzOpen}>
                    <div className="pf-ico pf-ico--neutral"><ClockIcon style={{ width: 18, height: 18 }} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="pf-row__t">{t('profile.timezone.title')}</div>
                      <div className="pf-row__s">{t('profile.timezone.hint')}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0, maxWidth: '42%' }}>
                      <span style={{
                        fontSize: 12.5, fontWeight: 600, color: 'var(--v3-gold-txt)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {timezone ? tzLabel(timezone, i18n.language) : t('profile.timezone.none')}
                      </span>
                      <ChevronDownIcon style={{
                        width: 13, height: 13, flexShrink: 0, color: 'var(--v3-fg-4)',
                        transform: tzOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s',
                      }} />
                    </div>
                  </button>
                  {tzOpen && (
                    <div style={{ padding: '0 16px 15px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {tzList.map((tz) => (
                          <button
                            key={tz}
                            type="button"
                            className="pf-tz"
                            disabled={locationSaving}
                            onClick={() => pickTimezone(tz)}
                          >
                            <span className={tz === timezone ? 'pf-tz__in pf-tz__in--on' : 'pf-tz__in'}>
                              {tzLabel(tz, i18n.language)}
                            </span>
                          </button>
                        ))}
                      </div>
                      <p style={{ fontSize: 11.5, color: 'var(--v3-fg-4)', lineHeight: 1.45, margin: 0 }}>
                        {t('profile.timezone.autoHint')}
                      </p>
                    </div>
                  )}
                </>
              )}

              <div className="pf-sep" />
              <button type="button" className="pf-row" onClick={openSupport}>
                <div className="pf-ico pf-ico--neutral"><ChatBubbleLeftRightIcon style={{ width: 18, height: 18 }} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="pf-row__t">{t('profile.support.title')}</div>
                  <div className="pf-row__s">{t('profile.support.desc')}</div>
                </div>
                <ChevronRightIcon style={{ width: 13, height: 13, flexShrink: 0, color: 'var(--v3-fg-4)' }} />
              </button>

            </div>
          </div>

          {/* Приглашение в сообщество (только VK, только не участникам).
              Без обёртки: когда компонент возвращает null, лишнего элемента в
              колонке не появляется и промежуток не двоится. */}
          <VkGroupInvite />

          {(showCards || userId) && <Constellation />}

          {/* Поддержка проекта — прямой перевод на карту. В VK запрещено
              правилами (§5.4.1, обход платёжной системы), поэтому платформа
              проверяется здесь так же, как проверялась на экране разбора. */}
          {showCards && (
            <div style={{
              borderRadius: 20, border: '1px solid var(--v3-chip-p-br)', background: 'var(--v3-closing)',
              padding: 16, display: 'flex', flexDirection: 'column', gap: 11, textAlign: 'center',
            }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--v3-fg)' }}>{t('profile.supportProject')}</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--v3-fg-3)' }}>{t('profile.supportProjectDesc')}</div>
              <PillButton size="sm" onClick={() => setCardsOpen(o => !o)}>
                {t('profile.cardDetails')}
                <ChevronDownIcon style={{
                  width: 13, height: 13, color: 'var(--v3-fg-4)',
                  transform: cardsOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s',
                }} />
              </PillButton>
              {cardsOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
                  {supportCards.map(({ bank, number: card }) => (
                    <button key={bank} type="button" className="pf-card" onClick={() => copyCard(card)}>
                      <div style={{ fontSize: 10.5, color: 'var(--v3-fg-4)' }}>{bank}</div>
                      <div style={{ fontSize: 14, color: 'var(--v3-fg)', fontFamily: 'ui-monospace,Menlo,monospace', marginTop: 3 }}>{card}</div>
                    </button>
                  ))}
                  <p style={{ fontSize: 11, color: 'var(--v3-fg-4)', textAlign: 'center', lineHeight: 1.45, margin: 0 }}>
                    {t('profile.cardHint')}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Удаление аккаунта — требование модерации VK §1.1.10. */}
          {userId && (
            <button type="button" className="pf-delete" onClick={deleteAccount} disabled={deleting}>
              <TrashIcon style={{ width: 16, height: 16 }} />
              {deleting ? t('common.saving') : t('profile.delete.button')}
            </button>
          )}

        </div>
      </div>

      {showPaywall && (
        <Paywall
          userId={userId}
          onClose={() => setShowPaywall(false)}
          onActivated={loadSubscription}
        />
      )}
    </div>
  );
}
