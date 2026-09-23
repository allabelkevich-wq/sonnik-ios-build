// Русские названия часовых поясов.
//
// Автоопределение возвращает сырой IANA-идентификатор ("Asia/Yekaterinburg"),
// и он же уходил в выпадающий список и в тост — латиницей (отчёт 7450254).
// Здесь единственная точка перевода: ей пользуются и список, и тост.

const CITY_RU = {
  // Россия — все зоны из базы IANA
  'Europe/Kaliningrad': 'Калининград',
  'Europe/Moscow': 'Москва',
  'Europe/Simferopol': 'Симферополь',
  'Europe/Kirov': 'Киров',
  'Europe/Volgograd': 'Волгоград',
  'Europe/Astrakhan': 'Астрахань',
  'Europe/Saratov': 'Саратов',
  'Europe/Ulyanovsk': 'Ульяновск',
  'Europe/Samara': 'Самара',
  'Asia/Yekaterinburg': 'Екатеринбург',
  'Asia/Omsk': 'Омск',
  'Asia/Novosibirsk': 'Новосибирск',
  'Asia/Barnaul': 'Барнаул',
  'Asia/Tomsk': 'Томск',
  'Asia/Novokuznetsk': 'Новокузнецк',
  'Asia/Krasnoyarsk': 'Красноярск',
  'Asia/Irkutsk': 'Иркутск',
  'Asia/Chita': 'Чита',
  'Asia/Yakutsk': 'Якутск',
  'Asia/Khandyga': 'Хандыга',
  'Asia/Vladivostok': 'Владивосток',
  'Asia/Ust-Nera': 'Усть-Нера',
  'Asia/Magadan': 'Магадан',
  'Asia/Sakhalin': 'Южно-Сахалинск',
  'Asia/Srednekolymsk': 'Среднеколымск',
  'Asia/Kamchatka': 'Петропавловск-Камчатский',
  'Asia/Anadyr': 'Анадырь',
  // СНГ и соседи
  'Europe/Minsk': 'Минск',
  'Europe/Kyiv': 'Киев',
  'Europe/Kiev': 'Киев',
  'Europe/Chisinau': 'Кишинёв',
  'Europe/Riga': 'Рига',
  'Europe/Vilnius': 'Вильнюс',
  'Europe/Tallinn': 'Таллин',
  'Asia/Almaty': 'Алматы',
  'Asia/Aqtobe': 'Актобе',
  'Asia/Aqtau': 'Актау',
  'Asia/Atyrau': 'Атырау',
  'Asia/Oral': 'Уральск',
  'Asia/Qostanay': 'Костанай',
  'Asia/Qyzylorda': 'Кызылорда',
  'Asia/Tashkent': 'Ташкент',
  'Asia/Samarkand': 'Самарканд',
  'Asia/Bishkek': 'Бишкек',
  'Asia/Dushanbe': 'Душанбе',
  'Asia/Ashgabat': 'Ашхабад',
  'Asia/Baku': 'Баку',
  'Asia/Yerevan': 'Ереван',
  'Asia/Tbilisi': 'Тбилиси',
  // Куда чаще всего уезжают
  'Europe/Istanbul': 'Стамбул',
  'Europe/Belgrade': 'Белград',
  'Europe/Berlin': 'Берлин',
  'Europe/Warsaw': 'Варшава',
  'Europe/Prague': 'Прага',
  'Europe/Paris': 'Париж',
  'Europe/Madrid': 'Мадрид',
  'Europe/Rome': 'Рим',
  'Europe/Lisbon': 'Лиссабон',
  'Europe/London': 'Лондон',
  'Europe/Amsterdam': 'Амстердам',
  'Europe/Athens': 'Афины',
  'Europe/Bucharest': 'Бухарест',
  'Europe/Budapest': 'Будапешт',
  'Europe/Helsinki': 'Хельсинки',
  'Europe/Zurich': 'Цюрих',
  'Asia/Dubai': 'Дубай',
  'Asia/Jerusalem': 'Иерусалим',
  'Asia/Tel_Aviv': 'Тель-Авив',
  'Asia/Bangkok': 'Бангкок',
  'Asia/Ho_Chi_Minh': 'Хошимин',
  'Asia/Shanghai': 'Шанхай',
  'Asia/Hong_Kong': 'Гонконг',
  'Asia/Seoul': 'Сеул',
  'Asia/Tokyo': 'Токио',
  'Asia/Colombo': 'Коломбо',
  'Asia/Kolkata': 'Калькутта',
  'Asia/Tehran': 'Тегеран',
  'Africa/Cairo': 'Каир',
  'America/New_York': 'Нью-Йорк',
  'America/Chicago': 'Чикаго',
  'America/Denver': 'Денвер',
  'America/Los_Angeles': 'Лос-Анджелес',
  'America/Sao_Paulo': 'Сан-Паулу',
  'America/Argentina/Buenos_Aires': 'Буэнос-Айрес',
  'Australia/Sydney': 'Сидней',
  'Pacific/Auckland': 'Окленд',
};

/** Смещение зоны от UTC в минутах на заданный момент. */
function offsetMinutes(tz, at = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
  } catch {
    return null;
  }
}

/** «МСК+2» / «МСК» / «МСК−1» — привычная для России шкала. */
function moscowOffsetLabel(tz, at = new Date()) {
  const mine = offsetMinutes(tz, at);
  const msk = offsetMinutes('Europe/Moscow', at);
  if (mine == null || msk == null) return null;
  const diff = (mine - msk) / 60;
  if (diff === 0) return 'МСК';
  const sign = diff > 0 ? '+' : '−';
  const abs = Math.abs(diff);
  return `МСК${sign}${Number.isInteger(abs) ? abs : abs.toFixed(1).replace('.', ',')}`;
}

/** «UTC+5:30» — запасная подпись, когда города нет в справочнике. */
function utcLabel(tz, at = new Date()) {
  const m = offsetMinutes(tz, at);
  if (m == null) return tz;
  if (m === 0) return 'UTC';
  const sign = m < 0 ? '−' : '+';
  const h = Math.floor(Math.abs(m) / 60);
  const min = Math.abs(m) % 60;
  return `UTC${sign}${h}${min ? ':' + String(min).padStart(2, '0') : ''}`;
}

/**
 * Читаемая подпись часового пояса: «Екатеринбург (МСК+2)».
 * Для английской локали оставляем идентификатор — он и так на латинице.
 * Незнакомую зону подписываем смещением, а не сырым «Asia/Foo».
 */
export function tzLabel(tz, lang = 'ru') {
  if (!tz || typeof tz !== 'string') return '';
  if (lang !== 'ru') return tz.split('/').pop().replace(/_/g, ' ');
  const city = CITY_RU[tz];
  if (!city) return utcLabel(tz);
  const msk = moscowOffsetLabel(tz);
  return msk ? `${city} (${msk})` : city;
}
