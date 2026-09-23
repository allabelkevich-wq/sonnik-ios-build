// Подпись зоны: «СЕГОДНЯ ————— 3 сентября».
export default function SectionLabel({ title, right, tone = 'gold', style }) {
  return (
    <div className={tone === 'gold' ? 'v3-label' : `v3-label v3-label--${tone}`} style={style}>
      <span className="v3-label__t">{title}</span>
      <span className="v3-label__line" />
      {right ? <span className="v3-label__r">{right}</span> : null}
    </div>
  );
}
