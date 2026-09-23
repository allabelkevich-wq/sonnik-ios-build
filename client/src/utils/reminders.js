// Утреннее напоминание — только для приложения из App Store (ios). На
// остальных платформах доставка идёт через Telegram-бота (server.js,
// sendMorningNotifications) — там для Apple-пользователей telegram_id всегда
// null, письмо некому слать, поэтому на iOS напоминание планируем локально
// через @capacitor/local-notifications, а не ждём сервер.
import { isNativeIos } from '../platform.js';

// Фиксированный id: schedule всегда идёт через cancel(id)+schedule(id) —
// иначе повторные включения плодили бы дубликаты одного и того же напоминания.
const REMINDER_ID = 4171;
// Локальное зеркало серверного morning_notify — на нём At Launch решаем,
// нужно ли переставить напоминание (ensureMorningReminder), не дожидаясь
// профиля с сервера.
const NOTIFY_FLAG_KEY = 'dw_morning_notify';

// 1-2 фразы из server.js MORNING_MESSAGES (2118-2125), переведённые на язык
// интерфейса — сервер эти уведомления на iOS никогда не шлёт, поэтому текст
// не может прийти оттуда, берём константой на клиенте.
const TEXTS = {
  ru: { title: 'Доброе утро 🌙', body: 'Помнишь свой сон? Пока образы свежи — самое время их расшифровать.' },
  en: { title: 'Good morning 🌙', body: 'Remember your dream? While it is still fresh, this is the best time to decode it.' },
};

function textFor(lang) {
  return String(lang || 'ru').toLowerCase().startsWith('en') ? TEXTS.en : TEXTS.ru;
}

function plugin() {
  return typeof window !== 'undefined' ? window.Capacitor?.Plugins?.LocalNotifications : null;
}

function setLocalFlag(on) {
  try {
    if (on) localStorage.setItem(NOTIFY_FLAG_KEY, '1');
    else localStorage.removeItem(NOTIFY_FLAG_KEY);
  } catch { /* приватный режим */ }
}

/** Локально запомненное состояние тумблера — для переустановки напоминания при запуске. */
export function localReminderFlag() {
  try { return localStorage.getItem(NOTIFY_FLAG_KEY) === '1'; } catch { return false; }
}

async function scheduleAt8(ln, lang) {
  const text = textFor(lang);
  // cancel перед каждым schedule — фиксированный id и так не даёт дублей,
  // но повторный schedule без отмены на некоторых версиях плагина не
  // переносит время, если оно не поменялось.
  await ln.cancel({ notifications: [{ id: REMINDER_ID }] });
  await ln.schedule({
    notifications: [{
      id: REMINDER_ID,
      title: text.title,
      body: text.body,
      schedule: { on: { hour: 8, minute: 0 }, repeats: true, allowWhileIdle: true },
    }],
  });
}

/**
 * Включить утреннее напоминание: спросить разрешение (если ещё не спрашивали)
 * и поставить его на 8:00 по времени телефона. Возвращает false, если
 * разрешение не дали или плагина нет — тумблер тогда остаётся выключенным.
 */
export async function enableMorningReminder(lang) {
  if (!isNativeIos()) return false;
  const ln = plugin();
  if (!ln) return false;
  try {
    let perm = await ln.checkPermissions();
    if (perm?.display !== 'granted') perm = await ln.requestPermissions();
    if (perm?.display !== 'granted') return false;
    await scheduleAt8(ln, lang);
    setLocalFlag(true);
    return true;
  } catch {
    return false;
  }
}

/** Выключить — отменяет запланированное напоминание и снимает локальный флаг. */
export async function disableMorningReminder() {
  setLocalFlag(false);
  if (!isNativeIos()) return;
  const ln = plugin();
  if (!ln) return;
  try { await ln.cancel({ notifications: [{ id: REMINDER_ID }] }); } catch { /* нет плагина/разрешения — нечего отменять */ }
}

/**
 * Загрузка профиля: серверный morning_notify может быть true, пока локальный
 * флаг и расписание потеряны (переустановка, очистка localStorage) — тумблер
 * тогда рисовался бы включённым, а уведомление никогда бы не пришло. Сверяем
 * локальное состояние с сервером здесь же, не дожидаясь следующего запуска
 * приложения (ensureMorningReminder смотрит только на localReminderFlag).
 * Разрешение не запрашиваем (это делает только явный тумблер) — если его ещё
 * нет, просто выравниваем флаг и ждём.
 */
export async function reconcileMorningReminder(serverOn, lang) {
  if (!isNativeIos()) return;
  if (!serverOn) { await disableMorningReminder(); return; }
  setLocalFlag(true);
  const ln = plugin();
  if (!ln) return;
  try {
    const perm = await ln.checkPermissions();
    if (perm?.display !== 'granted') return;
    await scheduleAt8(ln, lang);
  } catch { /* закон №37 — молча, без текста об ошибке */ }
}

/**
 * Запуск приложения: если напоминание было включено и разрешение всё ещё
 * есть — переставить его заново (идемпотентно), чтобы оно не потерялось.
 * Разрешение забрали в Настройках — тихо ничего не делаем, тумблер сам
 * покажет актуальное состояние при следующем открытии профиля.
 */
export async function ensureMorningReminder(lang) {
  if (!isNativeIos() || !localReminderFlag()) return;
  const ln = plugin();
  if (!ln) return;
  try {
    const perm = await ln.checkPermissions();
    if (perm?.display !== 'granted') return;
    await scheduleAt8(ln, lang);
  } catch { /* закон №37 — молча, без текста об ошибке */ }
}
