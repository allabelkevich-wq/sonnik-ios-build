// Адрес сервера. В приложении из App Store он зависит от страны магазина:
// российский App Store — сервер с базой в Москве (VITE_API_URL, как у VK и Telegram),
// остальные страны — вторая копия сервера с базой в Амстердаме (VITE_API_URL_INTL).
// Модули импортируют API_BASE и читают его в момент запроса, поэтому main.jsx
// выбирает адрес ДО отрисовки (resolveApiBase).

export let API_BASE = import.meta.env.VITE_API_URL || '';

const API_URL_INTL = import.meta.env.VITE_API_URL_INTL || '';
const REVENUECAT_IOS_KEY = import.meta.env.VITE_REVENUECAT_IOS_KEY || '';
const REGION_KEY = 'dw_store_region';
// Ключ сессии Apple — тот же, что в platform.js.
const APPLE_SESSION_KEY = 'dw_apple_session';

// RevenueCat настроен здесь (без пользователя) — usePremiumPurchase войдёт через logIn.
let storeConfigured = false;
export const isStoreConfigured = () => storeConfigured;

function isNativeIos() {
  const cap = window.Capacitor;
  return Boolean(cap?.isNativePlatform?.()) && cap.getPlatform?.() === 'ios';
}

// Страна магазина App Store (ISO-3166 alpha-3, напр. RUS) через RevenueCat.
async function storefrontCountry() {
  const plugin = window.Capacitor?.Plugins?.Purchases;
  if (!plugin || !REVENUECAT_IOS_KEY) return '';
  if (!storeConfigured) {
    await plugin.configure({ apiKey: REVENUECAT_IOS_KEY });
    storeConfigured = true;
  }
  const sf = await plugin.getStorefront();
  return String(sf?.countryCode || '').toUpperCase();
}

// Запасной признак, если магазин не ответил: регион устройства.
function deviceLooksRussian() {
  try {
    const o = Intl.DateTimeFormat().resolvedOptions();
    return /-RU\b/i.test(o.locale || '') || /^(Europe\/(Moscow|Kaliningrad|Samara|Volgograd|Saratov|Ulyanovsk|Astrakhan|Kirov)|Asia\/(Yekaterinburg|Omsk|Novosibirsk|Barnaul|Tomsk|Novokuznetsk|Krasnoyarsk|Irkutsk|Chita|Yakutsk|Khandyga|Vladivostok|Ust-Nera|Magadan|Sakhalin|Srednekolymsk|Kamchatka|Anadyr))$/.test(o.timeZone || '');
  } catch (_) {
    return false;
  }
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

export async function resolveApiBase() {
  if (!API_URL_INTL || !isNativeIos()) return;

  let saved = null;
  let hasSession = false;
  try {
    saved = localStorage.getItem(REGION_KEY);
    hasSession = Boolean(localStorage.getItem(APPLE_SESSION_KEY));
  } catch (_) {}

  let region = null;
  try {
    const country = await withTimeout(storefrontCountry(), 3000);
    if (country) region = country === 'RUS' ? 'ru' : 'intl';
  } catch (_) {}
  if (!region) region = saved || (deviceLooksRussian() ? 'ru' : 'intl');

  // Вход, сделанный до этой версии, был на московском сервере. Сессия одного
  // сервера на другом недействительна — при смене региона входим заново.
  const previous = saved || (hasSession ? 'ru' : null);
  try {
    if (previous && previous !== region) localStorage.removeItem(APPLE_SESSION_KEY);
    localStorage.setItem(REGION_KEY, region);
  } catch (_) {}

  if (region === 'intl') API_BASE = API_URL_INTL;
}
