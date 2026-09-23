// Плоская поверхность без градиентной кромки: карточка записи дневника,
// строка профиля, блок загрузки. as="button" — кликабельная плитка.
export default function Tile({ children, as = 'div', radius = 20, padding = '14px 16px', onClick, style, className }) {
  const Tag = as;
  const props = {
    className: className ? `v3-tile ${className}` : 'v3-tile',
    style: { borderRadius: radius, padding, ...style },
    onClick,
  };
  if (as === 'button') props.type = 'button';
  return <Tag {...props}>{children}</Tag>;
}
