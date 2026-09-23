import { phaseFraction, moonPath } from '../utils/moon.js';

// Палитра особых ночей. Обычная луна — тёплая кость; кровавая уходит в медь,
// голубая в холодную сталь, суперлуние ярче и золотистее, микролуние бледнее.
// Имя ночи считает сервер (lunar.js: moonEvent), сюда приходит его key.
const EVENT_PALETTE = {
  blood:     { lit: '#c2472e', dark: '#3a1410', glow: 'rgba(194,71,46,.55)',  rim: 'rgba(255,150,120,.34)' },
  eclipse:   { lit: '#d07a4a', dark: '#33180f', glow: 'rgba(208,122,74,.42)', rim: 'rgba(255,170,130,.3)' },
  penumbral: { lit: '#d9b98c', dark: '#241a12', glow: 'rgba(217,185,140,.34)', rim: 'rgba(255,215,170,.26)' },
  super:     { lit: '#ffd88a', dark: '#241704', glow: 'rgba(255,200,110,.6)',  rim: 'rgba(255,225,170,.42)' },
  blue:      { lit: '#b9cfe8', dark: '#131c2a', glow: 'rgba(150,185,225,.48)', rim: 'rgba(190,215,245,.34)' },
  micro:     { lit: '#ddd6c4', dark: '#1a1a1e', glow: 'rgba(210,205,190,.28)', rim: 'rgba(225,220,205,.24)' },
};

// Моря и кратеры настоящей Луны: тёмные пятна примерно там же, где на небе —
// Океан Бурь слева, Море Спокойствия справа сверху, Море Облаков снизу. Форма
// задаётся путями, а не кругами: ровные круги читались как дырки, а не как
// залитые лавой равнины. Координаты в системе viewBox (-50…50), радиус 48.
const SEAS = [
  { d: 'M6 -30 q16 -4 24 8 q6 12 -4 20 q-14 8 -24 -2 q-8 -12 4 -26 Z' },   // Море Ясности и Спокойствия
  { d: 'M-14 8 q14 -6 22 6 q4 12 -8 16 q-16 4 -20 -8 q-2 -8 6 -14 Z' },     // Море Облаков
  { d: 'M18 6 q12 -2 14 8 q0 10 -10 12 q-12 0 -12 -10 q0 -8 8 -10 Z' },     // Море Изобилия
];

/**
 * SVG-луна: форма серпа считается от даты (utils/moon.js), поверхность и цвет
 * зависят от того, что это за ночь.
 *
 * Мелкая луна (лента дней, карточка дневника) рисуется без рельефа — на 26px
 * моря превращаются в грязь.
 *
 * @param {string} [event] ключ особой ночи: blood | eclipse | penumbral | super | blue | micro
 */
export default function MoonPhase({ date, frac: fracProp, size = 132, glow = false, stars = false, event, style, className = '' }) {
  // frac от сервера точнее приближения по дате: его считает astronomy-engine.
  // Пока ответа нет (лента недели грузит даты по одной), frac приходит пустым —
  // рисуем тёмный диск без серпа: moonPath от NaN даёт битый путь и ошибку SVG.
  const raw = fracProp != null ? fracProp : (date ? phaseFraction(date) : null);
  const frac = Number.isFinite(raw) ? raw : null;
  const waxing = frac != null && frac < 0.5;
  const small = size < 40;
  const r = small ? 47 : 48;
  const pal = EVENT_PALETTE[event] || null;
  const lit = pal ? pal.lit : 'var(--v3-moon-lit)';
  const dark = pal ? pal.dark : 'var(--v3-moon-dark)';
  const rim = pal ? pal.rim : 'var(--v3-moon-ring)';
  // Уникальный суффикс: два градиента с одним id на странице подменяют друг друга.
  const uid = `${event || 'plain'}${small ? 's' : ''}${frac == null ? 'x' : Math.round(frac * 100)}`;

  return (
    <svg
      className={`${glow ? 'v3-moon v3-moon--glow' : 'v3-moon'}${pal ? ' v3-moon--event' : ''}${className ? ' ' + className : ''}`}
      viewBox={stars ? '-60 -60 120 120' : '-50 -50 100 100'}
      width={size}
      height={size}
      style={pal && glow ? { ...style, filter: `drop-shadow(0 0 22px ${pal.glow})` } : style}
      aria-hidden="true"
    >
      {!small && (
        <defs>
          {/* Свет идёт от внешнего края к линии терминатора: у настоящего серпа
              ярче всего лимб, а к границе тени свет гаснет. Радиальный градиент
              из прежней версии давал серое пятно посреди освещённой части. */}
          <linearGradient id={`m-lit-${uid}`} x1={waxing ? '0' : '1'} y1="0" x2={waxing ? '1' : '0'} y2="0">
            <stop offset="0%" stopColor={lit} stopOpacity="0.82" />
            <stop offset="55%" stopColor={lit} stopOpacity="1" />
            <stop offset="100%" stopColor={pal ? lit : 'var(--v3-moon-limb)'} stopOpacity={pal ? 1 : 0.92} />
          </linearGradient>
          <radialGradient id={`m-dark-${uid}`} cx="42%" cy="38%" r="76%">
            <stop offset="0%" stopColor={dark} stopOpacity="1" />
            <stop offset="100%" stopColor={dark} stopOpacity="0.78" />
          </radialGradient>
          <clipPath id={`m-disc-${uid}`}>
            <circle r={r} />
          </clipPath>
          {frac != null && (
            <clipPath id={`m-clip-${uid}`}>
              <path d={moonPath(frac, r)} />
            </clipPath>
          )}
          {/* Граница света размывается, но обрезается диском — внешний край
              остаётся чётким, иначе свет вылезал за круг. */}
          <filter id={`m-term-${uid}`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
          <filter id={`m-soft-${uid}`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
      )}

      <circle r={r} fill={small ? dark : `url(#m-dark-${uid})`} stroke={small ? rim : 'none'} strokeWidth={small ? 2 : 0} />
      {frac != null && (small
        ? <path d={moonPath(frac, r)} fill={lit} />
        : (
          <g clipPath={`url(#m-disc-${uid})`}>
            <path d={moonPath(frac, r)} fill={`url(#m-lit-${uid})`} filter={`url(#m-term-${uid})`} />
          </g>
        ))}

      {/* Моря проступают только на освещённой части и еле-еле: на 56 пикселях
          прежний рельеф читался как грязное пятно. */}
      {!small && frac != null && (
        <g clipPath={`url(#m-clip-${uid})`}>
          <g filter={`url(#m-soft-${uid})`}>
            {SEAS.map((sea, i) => (
              <path key={`s${i}`} d={sea.d} fill="#7a5a28" style={{ opacity: 'var(--v3-moon-sea)' }} />
            ))}
          </g>
        </g>
      )}

      {!small && <circle r={48} fill="none" stroke={rim} strokeWidth={1} />}

      {stars && (
        <>
          <circle cx={-52} cy={-38} r={1.6} fill="var(--v3-gold-txt)" opacity=".7" />
          <circle cx={49} cy={34} r={1.3} fill="var(--v3-purple-txt)" opacity=".7" />
          <circle cx={-44} cy={44} r={1.1} fill="var(--v3-gold-txt)" opacity=".5" />
        </>
      )}
    </svg>
  );
}
