// Определение платформы и идентичности юзера для мульти-платформенного мини-аппа.
// Telegram: user id из Telegram.WebApp. VK: из launch-параметров URL (vk_user_id),
// которые VK подставляет сам; их подпись (sign) проверяется на бэке.
// iOS (приложение из App Store): личность — вход через Apple; токен сессии,
// выданный сервером после проверки, хранится в самом приложении.

const API_BASE = import.meta.env.VITE_API_URL || '';
const APPLE_BUNDLE_ID = 'com.yupsoul.sonnik';
const APPLE_SESSION_KEY = 'dw_apple_session';
// Имя с Apple сервер не хранит (см. signInWithApple) — держим на устройстве.
const DISPLAY_NAME_KEY = 'dw_display_name';
// Лунный аватар из профиля (индекс фазы 0..7) — тоже только на устройстве.
const AVATAR_MOON_KEY = 'dw_avatar_moon';
// Переписки с оракулом (ChatPage) — по одной на сон, ключ = префикс + dream_id.
// Экспортируем префикс, чтобы удаление аккаунта (ProfilePage) могло стереть их,
// не подгружая саму (ленивую) страницу чата.
export const ORACLE_CHAT_KEY_PREFIX = 'dw_oracle_chat_';

function params() {
  if (typeof window === 'undefined') return new URLSearchParams();
  const live = new URLSearchParams(window.location.search);
  if (live.get('vk_app_id')) return live;
  // Нативный VK-WebView перезагружает страницу БЕЗ launch-параметров →
  // терялись vk_user_id и sign: профиль падал в «Гость», а тексты — в
  // телеграмные ветки. Восстанавливаем последний сохранённый launch-набор
  // (index.html, блок 2 пишет dw_vk_search при каждом «настоящем» запуске).
  if (window.__DW_IS_VK) {
    try {
      const saved = localStorage.getItem('dw_vk_search');
      if (saved) return new URLSearchParams(saved);
    } catch (_) {}
  }
  return live;
}

/** Приложение «Лунный сонник» из App Store (обёртка Capacitor на iOS). */
export function isNativeIos() {
  if (typeof window === 'undefined') return false;
  const cap = window.Capacitor;
  return Boolean(cap?.isNativePlatform?.()) && cap.getPlatform?.() === 'ios';
}

export function getPlatform() {
  if (typeof window === 'undefined') return 'web';
  // Приложение — первым: внутри него нет ни VK-параметров, ни Telegram.
  if (isNativeIos()) return 'ios';
  // window.__DW_IS_VK выставляется ранним детектом в index.html: либо есть
  // vk_app_id, либо нативный VK-WebView перезагрузил страницу без launch-
  // параметров и мы восстановили факт VK по VK-UA (см. index.html, блок 2).
  if (params().get('vk_app_id') || window.__DW_IS_VK) return 'vk';
  if (window.Telegram?.WebApp?.initDataUnsafe?.user) return 'telegram';
  return 'web';
}

export function getVkParams() {
  const p = params();
  return {
    appId: p.get('vk_app_id'),
    userId: p.get('vk_user_id'),
    platform: p.get('vk_platform') || '', // mobile_iphone | mobile_android | mobile_web | desktop_web
    // Откуда открыли: catalog, group_menu, snippet, search… Пишем в отметку «старт».
    ref: p.get('vk_ref') || '',
  };
}

/** Мобильный нативный VK-клиент (iOS/Android) — по §5.4.1 любой платёжный UI запрещён. */
export function isVkMobileNative() {
  let plat = getVkParams().platform;
  // При перезагрузке нативного VK-WebView без launch-параметров vk_platform
  // теряется — берём персистнутое значение (index.html, блок 2). Иначе на
  // нативном мобильном клиенте показался бы платёжный UI (§5.4.1).
  if (!plat && typeof localStorage !== 'undefined') {
    try { plat = localStorage.getItem('dw_vk_platform') || ''; } catch (_) { plat = ''; }
  }
  return plat === 'mobile_iphone' || plat === 'mobile_android';
}

/** Провайдер для namespaced-ключа подписки: 'vk' | 'apple' | 'tg'. */
export function providerCode() {
  const platform = getPlatform();
  if (platform === 'vk') return 'vk';
  if (platform === 'ios') return 'apple';
  return 'tg';
}

/** Идентификатор юзера в его платформе (для передачи на бэк как user_id). */
export function getUserId() {
  const platform = getPlatform();
  if (platform === 'vk') return getVkParams().userId || null;
  if (platform === 'ios') return appleSession()?.userId ?? null;
  return window.Telegram?.WebApp?.initDataUnsafe?.user?.id ?? null;
}

/** Все vk_*-параметры + sign (сырые, для верификации подписи на бэке). */
function getRawVkParams() {
  const p = params();
  const obj = {};
  for (const [k, v] of p.entries()) {
    if (k.startsWith('vk_') || k === 'sign') obj[k] = v;
  }
  return obj;
}

// ─── Сессия: identity подтверждается ОДИН раз за загрузку приложения
// (initData/vk-sign), дальше носим подписанный токен и прикладываем
// его к каждому запросу — а не пере-проверяем крипто-подпись на бэке
// на каждый запрос.
let sessionTokenPromise = null;

async function verifySession() {
  // В приложении iOS подпись Apple проверена при входе — токен уже на руках.
  if (getPlatform() === 'ios') return appleSession()?.token || null;
  try {
    if (getPlatform() === 'telegram') {
      const initData = window.Telegram?.WebApp?.initData;
      if (!initData) return null;
      const res = await fetch(`${API_BASE}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'tg', initData }),
      });
      if (!res.ok) return null;
      return (await res.json()).token || null;
    }
    if (getPlatform() === 'vk') {
      const vkParams = getRawVkParams();
      if (!vkParams.sign) return null;
      const res = await fetch(`${API_BASE}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'vk', vkParams }),
      });
      if (!res.ok) return null;
      return (await res.json()).token || null;
    }
  } catch {
    return null;
  }
  return null;
}

function getSessionToken() {
  if (!sessionTokenPromise) {
    sessionTokenPromise = verifySession().then((token) => {
      // Неудачу не кэшируем: единичный сетевой сбой на старте иначе оставил
      // бы ВСЕ последующие запросы без Authorization до перезагрузки.
      if (!token) sessionTokenPromise = null;
      return token;
    });
  }
  return sessionTokenPromise;
}

/** Заголовок Authorization с подписанным токеном сессии ({} для гостя без identity). */
export async function authHeader() {
  const token = await getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ─── Вход через Apple (только iOS) ───
// Срок сессии читаем из самого токена сервера (base64url(payload).подпись):
// протухший не шлём, а просим войти заново — иначе каждый запрос падал бы в 401.
function appleSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(APPLE_SESSION_KEY) || 'null');
    if (!saved?.token || !saved.userId) return null;
    const body = saved.token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(atob(body));
    return exp > Date.now() / 1000 + 60 ? saved : null;
  } catch {
    return null;
  }
}

let appleReady = false;

/** Имя, сохранённое на устройстве (с первого входа через Apple или правки в профиле). */
export function getDisplayName() {
  try { return localStorage.getItem(DISPLAY_NAME_KEY) || ''; } catch { return ''; }
}

/** Сохранить/сбросить отображаемое имя — только на этом устройстве, сервер его не видит. */
export function setDisplayName(name) {
  try {
    const trimmed = (name || '').trim().slice(0, 40);
    if (trimmed) localStorage.setItem(DISPLAY_NAME_KEY, trimmed);
    else localStorage.removeItem(DISPLAY_NAME_KEY);
  } catch { /* приватный режим */ }
}

/** Индекс выбранного лунного аватара (0..7) или null — тогда кружок с инициалами. */
export function getAvatarMoon() {
  try {
    const v = localStorage.getItem(AVATAR_MOON_KEY);
    return v === null ? null : Number(v);
  } catch { return null; }
}

export function setAvatarMoon(index) {
  try {
    if (index === null || index === undefined) localStorage.removeItem(AVATAR_MOON_KEY);
    else localStorage.setItem(AVATAR_MOON_KEY, String(index));
  } catch { /* приватный режим */ }
}

/** Системное окно «Вход с Apple» → сессия нашего сервера. Бросает при отмене и отказе. */
export async function signInWithApple() {
  // Плагины нативная часть Capacitor сама кладёт в window.Capacitor.Plugins —
  // npm-пакет плагина клиенту не нужен, он живёт только внутри приложения.
  const plugin = window.Capacitor?.Plugins?.SocialLogin;
  if (!plugin) throw new Error('no_plugin');
  if (!appleReady) {
    // redirectUrl пустой: на iOS плагин открывает системное окно, а не браузер.
    await plugin.initialize({ apple: { clientId: APPLE_BUNDLE_ID, redirectUrl: '' } });
    appleReady = true;
  }
  // Почту не просим. Имя просим (scope 'name') только чтобы показать его в
  // профиле — сервер по-прежнему узнаёт человека по sub и имя не хранит.
  const res = await plugin.login({ provider: 'apple', options: { scopes: ['name'] } });
  const identityToken = res?.result?.idToken;
  if (!identityToken) throw new Error('no_identity_token');
  // Apple отдаёт givenName только при самом первом согласии на этот scope —
  // при повторных входах профиль пустой. Сохраняем сразу, пока не потеряли.
  const givenName = res?.result?.profile?.givenName;
  if (givenName) setDisplayName(givenName);
  const r = await fetch(`${API_BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'apple', identityToken }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.token) throw new Error(data.error || 'auth_failed');
  localStorage.setItem(APPLE_SESSION_KEY, JSON.stringify({ token: data.token, userId: data.userId }));
  sessionTokenPromise = null;
  return data.userId;
}

/** Выход на этом устройстве — после удаления аккаунта. */
export function signOutApple() {
  try { localStorage.removeItem(APPLE_SESSION_KEY); } catch { /* приватный режим */ }
  try { localStorage.removeItem(DISPLAY_NAME_KEY); } catch { /* приватный режим */ }
  try { localStorage.removeItem(AVATAR_MOON_KEY); } catch { /* приватный режим */ }
  sessionTokenPromise = null;
}

/** Стереть переписки с оракулом на устройстве (все сны сразу) — вызывается
 * при удалении аккаунта на любой платформе: сервер их не хранит (ChatPage),
 * поэтому без этого текст о снах пережил бы удаление. */
export function clearAllOracleChats() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(ORACLE_CHAT_KEY_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch { /* приватный режим */ }
}
