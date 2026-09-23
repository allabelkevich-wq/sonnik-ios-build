// Карточка с градиентной кромкой: внешний слой в 1px — сама кромка,
// внутренний — фон. Радиус внутреннего на 1px меньше внешнего.
export default function EdgeCard({
  children,
  edge = 'gold',
  radius = 22,
  padding = '17px 17px 15px',
  sheen,
  onClick,
  style,
  className,
}) {
  const cls = ['v3-card'];
  if (edge !== 'gold') cls.push(`v3-card--${edge}`);
  if (sheen === undefined ? edge === 'lux' : sheen) cls.push('v3-card--sheen');
  if (className) cls.push(className);

  return (
    <div className={cls.join(' ')} style={{ borderRadius: radius, ...style }} onClick={onClick}>
      <div className="v3-card__in" style={{ borderRadius: radius - 1, padding }}>
        {children}
      </div>
    </div>
  );
}
