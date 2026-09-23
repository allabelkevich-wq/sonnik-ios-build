// Главное действие экрана — золотая кнопка 56px. Одна на экран.
export default function GoldButton({ children, onClick, icon, trailing, disabled, type = 'button', style, className }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={className ? `v3-btn-gold ${className}` : 'v3-btn-gold'}
      style={style}
    >
      {icon ? <span className="v3-btn-gold__icon">{icon}</span> : null}
      <span>{children}</span>
      {trailing}
    </button>
  );
}
