import { ChevronDownIcon } from '@heroicons/react/24/solid';

// Контролируемая раскрывающаяся секция (разбор на семь слоёв, ритуал, FAQ).
// Тело монтируется только при open: max-height-анимации на старых webview
// Telegram дают рывок и режут длинный текст.
export default function Disclosure({ open, onToggle, title, subtitle, icon, tone = 'gold', children }) {
  const cls = ['v3-disc'];
  if (tone !== 'gold') cls.push(`v3-disc--${tone}`);
  if (open) cls.push('v3-disc--open');

  return (
    <div className={cls.join(' ')}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="v3-disc__head">
        <span className="v3-disc__ico">{icon}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="v3-disc__t" style={{ display: 'block' }}>{title}</span>
          {subtitle ? <span className="v3-disc__s" style={{ display: 'block' }}>{subtitle}</span> : null}
        </span>
        <ChevronDownIcon className="v3-disc__chev" />
      </button>
      {open ? <div className="v3-disc__body">{children}</div> : null}
    </div>
  );
}
