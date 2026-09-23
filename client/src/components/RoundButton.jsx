// Круглая иконка-кнопка 44px: «Назад», «Поделиться», стрелки дней.
export default function RoundButton({ children, onClick, label, disabled, style }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className="v3-round" style={style}>
      {children}
    </button>
  );
}
