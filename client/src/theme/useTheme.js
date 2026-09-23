// ============================================================
// Лунный сонник — управление темой
// Разместить: client/src/theme/useTheme.js
//
// Приоритет выбора темы при загрузке:
//   1. Сохранённый выбор пользователя (localStorage 'dw_theme')
//   2. Тема Telegram (WebApp.colorScheme: 'light' | 'dark')
//   3. Тёмная по умолчанию
//
// Атрибут выставляется на <html> — так тема доступна ДО отрисовки React
// (см. сниппет для index.html ниже, чтобы не было «мигания» тёмной темы).
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { getPlatform } from '../platform.js';

const STORAGE_KEY = 'dw_theme';

/** Определить стартовую тему без React (для index.html и хука). */
export function resolveInitialTheme() {
  // Инлайн-скрипт в index.html уже разрешил тему (dw_theme → vk_appearance →
  // Telegram colorScheme → dark) и выставил data-theme ДО монтирования React.
  // Берём этот атрибут как источник истины — иначе React пере-разрешал бы тему
  // без учёта vk_appearance и перебивал бы её (flash + неверная тема в VK).
  try {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'light' || attr === 'dark') return attr;
  } catch (_) { /* нет document */ }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch (_) { /* приватный режим */ }

  const tg = typeof window !== 'undefined' && window.Telegram?.WebApp;
  if (tg && (tg.colorScheme === 'light' || tg.colorScheme === 'dark')) {
    return tg.colorScheme;
  }
  return 'dark';
}

/** Применить тему к документу. */
export function applyTheme(theme) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

/**
 * Хук темы.
 * @param {boolean} followTelegram — если true и пользователь НЕ выбирал тему
 *   вручную, тема следует за системной темой Telegram (событие themeChanged).
 */
export function useTheme(followTelegram = true) {
  const [theme, setThemeState] = useState(resolveInitialTheme);

  // Применяем тему при каждом изменении
  useEffect(() => { applyTheme(theme); }, [theme]);

  // Цвета status/action/navigation bar VK — иначе нативный chrome VK
  // остаётся в цветах VK по умолчанию и не совпадает с темой приложения.
  useEffect(() => {
    if (getPlatform() !== 'vk') return;
    const isLight = theme === 'light';
    import('@vkontakte/vk-bridge').then(({ default: vkBridge }) => {
      vkBridge.send('VKWebAppSetViewSettings', {
        status_bar_style: isLight ? 'dark' : 'light',
        action_bar_color: isLight ? '#efe7d6' : '#080d10',
        navigation_bar_color: isLight ? '#efe7d6' : '#080d10',
      }).catch(() => {});
    });
  }, [theme]);

  // Синхронизация с Telegram, пока пользователь не выбрал тему сам
  useEffect(() => {
    if (!followTelegram) return;
    const tg = window.Telegram?.WebApp;
    if (!tg) return;
    const onChange = () => {
      const userChose = (() => {
        try { return !!localStorage.getItem(STORAGE_KEY); } catch (_) { return false; }
      })();
      if (!userChose && (tg.colorScheme === 'light' || tg.colorScheme === 'dark')) {
        setThemeState(tg.colorScheme);
      }
    };
    tg.onEvent?.('themeChanged', onChange);
    return () => tg.offEvent?.('themeChanged', onChange);
  }, [followTelegram]);

  // Синхронизация с VK (VKWebAppUpdateConfig), пока пользователь не выбрал
  // тему сам. Раньше тема в VK не читалась вообще — только ручной тоггл.
  useEffect(() => {
    if (!followTelegram || getPlatform() !== 'vk') return;
    let vkBridge;
    let onEvent;
    import('@vkontakte/vk-bridge').then((mod) => {
      vkBridge = mod.default;
      onEvent = (e) => {
        if (e.detail?.type !== 'VKWebAppUpdateConfig') return;
        const scheme = e.detail.data?.scheme || '';
        const userChose = (() => {
          try { return !!localStorage.getItem(STORAGE_KEY); } catch (_) { return false; }
        })();
        if (!userChose) setThemeState(scheme.includes('light') ? 'light' : 'dark');
      };
      vkBridge.subscribe(onEvent);
    });
    return () => { if (vkBridge && onEvent) vkBridge.unsubscribe(onEvent); };
  }, [followTelegram]);

  const setTheme = useCallback((next) => {
    setThemeState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch (_) { /* noop */ }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(STORAGE_KEY, next); } catch (_) { /* noop */ }
      return next;
    });
  }, []);

  return { theme, setTheme, toggleTheme };
}
