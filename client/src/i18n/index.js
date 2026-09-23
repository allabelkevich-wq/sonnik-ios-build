import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ru from './ru.json';
import en from './en.json';

// Detect language from Telegram user data or saved preference
function detectLanguage() {
  const saved = typeof localStorage !== 'undefined' && localStorage.getItem('dw_lang');
  if (saved) return saved;
  const tgLang = typeof window !== 'undefined'
    ? window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code
    : null;
  if (tgLang) {
    if (tgLang.startsWith('ru')) return 'ru';
    if (tgLang.startsWith('uk')) return 'ru'; // Ukrainian users often prefer Russian content
    return 'en';
  }
  // vk_language — языковой код VK (строка вида 'ru'/'uk'/'en', НЕ числовой
  // индекс — прошлая версия ошибочно проверяла '0'/'1' по устаревшему
  // комментарию, из-за чего все VK-пользователи получали английский) по
  // §3.1.2 Правил VK Mini Apps (язык — по настройкам пользователя VK).
  const vkLang = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('vk_language')
    : null;
  if (vkLang) {
    if (vkLang.startsWith('ru') || vkLang.startsWith('uk')) return 'ru';
    return 'en';
  }
  const browserLang = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  if (browserLang.startsWith('ru') || browserLang.startsWith('uk')) return 'ru';
  return 'ru'; // default
}

i18n
  .use(initReactI18next)
  .init({
    resources: { ru: { translation: ru }, en: { translation: en } },
    lng: detectLanguage(),
    fallbackLng: 'ru',
    interpolation: { escapeValue: false },
  });

export function setLanguage(lang) {
  i18n.changeLanguage(lang);
  localStorage.setItem('dw_lang', lang);
}

/** Язык для сервера: он выбирает язык лунных текстов и язык ответа модели.
 *  До 19.09.2026 язык не передавался вовсе — разбор приходил по-русски всем. */
export function serverLang() {
  return String(i18n.language || 'ru').toLowerCase().startsWith('en') ? 'en' : 'ru';
}

export function getLanguage() {
  return i18n.language;
}

export default i18n;
