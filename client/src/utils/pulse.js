import { getPlatform } from '../platform.js';

const API_BASE = import.meta.env.VITE_API_URL || '';
const sent = new Set();
// Новый человек или вернувшийся — решается один раз при загрузке, до того как
// онбординг поставит флаг: иначе «главная» и «форма» у новых и старых смешаны.
let fresh = true;
try { fresh = !localStorage.getItem('dw_onboarded'); } catch (_) { /* закрытое хранилище — считаем новым */ }

/**
 * Отметка шага воронки — один раз за сеанс на шаг.
 *
 * Между «человек открыл приложение» и «разобрал сон» не было ни одной точки
 * замера, и когда 04.09 доля первого сна упала с 26% до 15%, причину пришлось
 * угадывать. Отметка уходит на сервер и попадает только в его лог: ни базы,
 * ни персональных данных, ни идентификатора — имя шага и платформа.
 *
 * Ошибку глотаем молча: замер не должен мешать человеку смотреть сны.
 */
export function pulse(step, detail) {
  if (sent.has(step)) return;
  sent.add(step);
  send(step, detail);
}

/**
 * Событие оплаты — каждое, без дедупа: сколько человек открыли окно оплаты,
 * сколько получили отказ и с каким кодом. Иначе про сорванные оплаты мы
 * узнаём только из жалоб (08.09: экран ВК «превышен лимит запросов»).
 */
export function pulsePay(event, detail) {
  send('оплата', `${event}${detail != null && detail !== '' ? ' ' + detail : ''}`);
}

/**
 * Событие внутри формы — тоже без дедупа. 09.09: из 234 открывших форму до
 * разбора дошли 78, и где именно теряются остальные, было не видно: не начали
 * писать, не добрали десяти знаков, нажали и получили отказ, сорвался голос.
 */
export function mark(step, detail) {
  send(step, detail);
}

function send(step, detail) {
  try {
    const body = JSON.stringify({ step, platform: getPlatform(), fresh, detail });
    // sendBeacon переживает уход со страницы; fetch — запасной путь. Маяк
    // всегда идёт с куками, а сервер чужому адресу отвечает «*» — в приложении
    // iOS (API на другом домене) браузер отбрасывал каждый замер. Там только fetch.
    if (navigator.sendBeacon && !API_BASE) {
      navigator.sendBeacon(`${API_BASE}/api/pulse`, new Blob([body], { type: 'application/json' }));
      return;
    }
    fetch(`${API_BASE}/api/pulse`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true,
    }).catch(() => {});
  } catch (_) { /* замер молчит */ }
}
