// ============================================================
// Лунный сонник — переключатель темы
// Разместить: client/src/theme/ThemeToggle.jsx
//
// Пример использования (например, в ProfilePage или в шапке):
//   import { useTheme } from '../theme/useTheme.js';
//   import ThemeToggle from '../theme/ThemeToggle.jsx';
//   const { theme, toggleTheme } = useTheme();
//   <ThemeToggle theme={theme} onToggle={toggleTheme} />
//
// Стили — инлайн и на CSS-переменных, поэтому сам переключатель
// корректно выглядит в обеих темах.
// ============================================================

import { useTranslation } from 'react-i18next';

export default function ThemeToggle({ theme, onToggle }) {
  const { t } = useTranslation();
  const isLight = theme === 'light';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={isLight ? t('theme.toDark') : t('theme.toLight')}
      style={{
        position: 'relative',
        width: 132,
        height: 38,
        padding: 4,
        borderRadius: 9999,
        border: '1px solid rgba(var(--fg-rgb), 0.14)',
        background: 'rgba(var(--fg-rgb), 0.06)',
        boxShadow: 'none',
        cursor: 'pointer',
        overflow: 'hidden',
      }}
    >
      {/* Бегунок */}
      <span
        style={{
          position: 'absolute',
          top: 4,
          bottom: 4,
          left: isLight ? 'calc(50% )' : 4,
          width: 'calc(50% - 4px)',
          borderRadius: 9999,
          background: 'linear-gradient(135deg, #f5a623 0%, #e8920a 55%, #c97a10 100%)',
          boxShadow: '0 0 16px rgba(232,146,10,0.4), inset 0 1px 0 rgba(255,255,255,0.25)',
          transition: 'left .3s cubic-bezier(.4,0,.2,1)',
        }}
      />
      <span style={{ position: 'relative', display: 'flex', height: '100%' }}>
        <span style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          fontSize: 12.5, fontWeight: 600,
          color: isLight ? 'rgba(var(--fg-rgb),0.5)' : '#1a0800',
          zIndex: 1,
        }}>{t('theme.night')}</span>
        <span style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          fontSize: 12.5, fontWeight: 600,
          color: isLight ? '#1a0800' : 'rgba(var(--fg-rgb),0.5)',
          zIndex: 1,
        }}>{t('theme.day')}</span>
      </span>
    </button>
  );
}
