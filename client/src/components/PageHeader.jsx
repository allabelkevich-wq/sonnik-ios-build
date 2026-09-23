import { ArrowLeftIcon } from '@heroicons/react/24/solid';

// Единая шапка всех внутренних экранов — по принципу эталона Музыкального оракула
// (#heroesPage .topbar + .header-back-btn): кнопка «Назад» — компактный круг 40×40
// с иконкой (flex-shrink:0), заголовок и действие — в один flex-ряд по сетке.
// Круг никогда не налезает на заголовок (в отличие от прежних absolute-раскладок,
// где длинный заголовок уходил под кнопки — bug7438513/7438495 и новые на календаре/чате).
export default function PageHeader({ onBack, title, subtitle, action, style }) {
  return (
    // paddingX = 20 совпадает с горизонтальным padding у `.page-scroll`, поэтому
    // кнопка «Назад», заголовок и все карточки контента стоят на одной сетке
    // (эталон Оракула: шапка не прижата к краю экрана — bug: «никакого отступа нет»).
    <header style={{ textAlign: 'left', paddingLeft: 20, paddingRight: 20, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44 }}>
        <button type="button" onClick={onBack} aria-label="Назад" className="page-back-btn">
          <ArrowLeftIcon style={{ width: 20, height: 20 }} />
        </button>
        <h1 style={{ flex: 1, minWidth: 0, margin: 0, textAlign: 'left', fontSize: 'var(--fluid-xl)' }}>{title}</h1>
        {action ? <div style={{ flexShrink: 0 }}>{action}</div> : null}
      </div>
      {subtitle ? (
        <p className="subtitle" style={{ fontSize: 13, margin: '4px 0 0', textAlign: 'left', paddingLeft: 52 }}>{subtitle}</p>
      ) : null}
    </header>
  );
}
