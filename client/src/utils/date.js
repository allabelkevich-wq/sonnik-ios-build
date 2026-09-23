// Дата «день + месяц» в родительном падеже для RU. Intl в части браузеров
// (замечено на Windows) отдаёт именительный «24 июль» вместо «24 июля» —
// поэтому для русского форматируем детерминированно. bug7438509.
const RU_MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

export function formatDayMonth(input, lang) {
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return '';
  if (lang === 'ru') return `${d.getDate()} ${RU_MONTHS_GEN[d.getMonth()]}`;
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'long' });
}

// «Луна в Стрелец» читалось как ошибка — нужен предложный падеж (отчёт 7444117).
// Знаки приходят с бэкенда в именительном; склоняем на клиенте, в одном месте:
// формулировка «Луна в …» встречается и на главной, и в календаре стрижек.
const ZODIAC_PREPOSITIONAL = {
  'Овен': 'Овне', 'Телец': 'Тельце', 'Близнецы': 'Близнецах', 'Рак': 'Раке',
  'Лев': 'Льве', 'Дева': 'Деве', 'Весы': 'Весах', 'Скорпион': 'Скорпионе',
  'Стрелец': 'Стрельце', 'Козерог': 'Козероге', 'Водолей': 'Водолее', 'Рыбы': 'Рыбах',
};

// Сервер отдаёт знак Луны по-русски намеренно: календарь стрижек сравнивает
// именно русские строки. Перевод — здесь, на клиенте.
const ZODIAC_EN = {
  'Овен': 'Aries', 'Телец': 'Taurus', 'Близнецы': 'Gemini', 'Рак': 'Cancer',
  'Лев': 'Leo', 'Дева': 'Virgo', 'Весы': 'Libra', 'Скорпион': 'Scorpio',
  'Стрелец': 'Sagittarius', 'Козерог': 'Capricorn', 'Водолей': 'Aquarius', 'Рыбы': 'Pisces',
};

/** Знак зодиака для оборота «Луна в …»: предложный падеж для RU, имя для EN. */
export function signPrepositional(sign, lang) {
  if (!sign) return '';
  const key = String(sign).trim();
  if (lang === 'ru') return ZODIAC_PREPOSITIONAL[key] || sign;
  return ZODIAC_EN[key] || sign;
}

const pad = (n) => String(n).padStart(2, '0');

/** Сегодняшняя дата ГГГГ-ММ-ДД по местному времени устройства (не UTC). */
export function localToday(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Текущее время ЧЧ:ММ по местному времени устройства. */
export function localNowTime(now = new Date()) {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * Момент рождения в будущем? Дату мы уже ограничиваем через max, но при
 * сегодняшней дате оставалось выставить час позже текущего — момент рождения
 * оказывался в будущем (отчёт 7438498, переоткрыт Анастасией Бондаренко).
 * Живёт в одном месте, потому что модалка рождения есть и на главной, и в профиле.
 */
export function isFutureBirthMoment(date, time, now = new Date()) {
  if (!date) return false;
  const today = localToday(now);
  if (date > today) return true;
  if (date < today || !time) return false;
  return time > localNowTime(now);
}

// Сервис заявлен как 16+ (экран согласия и оферта), но дату рождения принимали
// любую с 1900 года — подросток проходил насквозь (отчёт 7447465).
export const MIN_AGE_YEARS = 16;

/** Возраст в полных годах на дату `now` (null, если дата не разобрана). */
export function ageAt(date, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = now.getFullYear() - y;
  const hadBirthday = now.getMonth() + 1 > mo || (now.getMonth() + 1 === mo && now.getDate() >= d);
  if (!hadBirthday) age -= 1;
  return age;
}

/** Младше 16 полных лет? */
export function isUnderMinAge(date, now = new Date()) {
  const age = ageAt(date, now);
  return age != null && age < MIN_AGE_YEARS;
}
