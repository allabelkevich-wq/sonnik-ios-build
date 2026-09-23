// Вторичное действие: «Повторить», «Открыть дневник», «Ещё сон».
// Глобальное правило `button` в globals.css красит любую кнопку золотом —
// класс .v3-pill перебивает фон, цвет, тень и прячет бегущий блик.
export default function PillButton({ children, onClick, tone = 'neutral', size = 'md', icon, disabled, style }) {
  const cls = `v3-pill v3-pill--${tone}${size === 'md' ? '' : ` v3-pill--${size}`}`;
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls} style={style}>
      {icon}
      <span>{children}</span>
    </button>
  );
}
