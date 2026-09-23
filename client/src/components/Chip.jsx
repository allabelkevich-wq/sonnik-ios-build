export default function Chip({ children, tone = 'violet', icon, size = 'md', style }) {
  const cls = ['v3-chip', `v3-chip--${tone}`];
  if (size === 'sm') cls.push('v3-chip--sm');
  if (icon) cls.push('v3-chip--icon');
  return (
    <span className={cls.join(' ')} style={style}>
      {icon}
      {children}
    </span>
  );
}
