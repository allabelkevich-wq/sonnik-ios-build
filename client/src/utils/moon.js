// Фаза луны по дате — чистая геометрия для рисования SVG-луны.
// Число лунного дня, название фазы и знак для текста берутся с бэкенда
// (/api/lunar/today, /api/lunar/:date — astronomy-engine, единственный
// источник астрономических расчётов по правилам проекта). Здесь только
// форма серпа и запасные значения для рендера до ответа API.

export const SYNODIC = 29.530588853;
// Новолуние 2000-01-06 18:14 UTC — эпоха отсчёта из макетов v3.
export const EPOCH = Date.UTC(2000, 0, 6, 18, 14) / 86400000;

// Доля синодического месяца: 0 — новолуние, 0.5 — полнолуние.
export function phaseFraction(date) {
  const t = date instanceof Date ? date.getTime() : new Date(date).getTime();
  const f = ((t / 86400000 - EPOCH) % SYNODIC) / SYNODIC;
  return f < 0 ? f + 1 : f;
}

// Освещённая часть диска радиуса R: внешняя полуокружность плюс
// терминатор — эллиптическая дуга с полуосью |cos(2πfrac)|·R.
export function moonPath(frac, R) {
  const cos = Math.cos(2 * Math.PI * frac);
  const rx = Math.abs(cos) * R;
  const waxing = frac < 0.5;
  const outer = waxing ? 1 : 0;
  const inner = cos < 0 ? (waxing ? 1 : 0) : (waxing ? 0 : 1);
  return `M 0 ${-R} A ${R} ${R} 0 0 ${outer} 0 ${R} A ${rx.toFixed(2)} ${R} 0 0 ${inner} 0 ${-R} Z`;
}

// Запасной номер лунного дня — только пока не ответил /api/lunar/*.
export function lunarDayApprox(frac) {
  return Math.floor(frac * SYNODIC) + 1;
}

// Индекс фазы 0..7 → ключ i18n lunar.phases.{index}.
export function phaseIndex(frac) {
  return Math.floor(((frac + 1 / 16) % 1) * 8);
}

// Освещённость в процентах.
export function illumination(frac) {
  return Math.round(((1 - Math.cos(2 * Math.PI * frac)) / 2) * 100);
}
