// Мост в приложение партнёра — «Музыкальный оракул» (YupSoul).
//
// Куда ведём и что обещаем, зависит от поверхности. Оракул сам прячет песни
// везде, кроме vk.ru и m.vk.ru: его правило _vkPayMode считает «деньгами» только
// desktop_web и mobile_web, а всё остальное — нативные iOS/Android, планшеты,
// VK Мессенджер, внешние браузеры и неизвестную платформу — заглушкой без
// песен (fail-closed). Обещать песню там, где её не будет, нельзя: на таких
// поверхностях зовём к оракулу — вопросы по дате рождения, разборы карты,
// аскеза на 21 день. В Telegram и на сайте песни есть.
import { getPlatform, getVkParams } from '../platform.js';

export const PARTNER = {
  vkAppId: 54531891,
  vkUrl: 'https://vk.com/app54531891',
  tgUrl: 'https://t.me/Yup_Soul_bot/app',
  webUrl: 'https://www.yupsoul.ru',
};

// Код кампании: оракул читает его из #camp= (VK), startapp=camp_ (Telegram) и
// ?campaign= (сайт) и пишет в профиль пришедшего — в его админке видно, сколько
// людей и оплат дал сонник (строка blogger_campaigns.code = 'sonnik').
const CAMP = 'sonnik';
export const PARTNER_VK_LOCATION = `camp=${CAMP}`;
export const PARTNER_VK_LINK = `${PARTNER.vkUrl}#${PARTNER_VK_LOCATION}`;
export const PARTNER_TG_LINK = `${PARTNER.tgUrl}?startapp=camp_${CAMP}`;
export const PARTNER_WEB_LINK = `${PARTNER.webUrl}/?campaign=${CAMP}`;

function vkPlatform() {
  let p = getVkParams().platform;
  // Нативный VK-WebView может перезагрузить страницу без launch-параметров —
  // берём сохранённое значение (index.html, блок 2), как isVkMobileNative.
  if (!p) { try { p = localStorage.getItem('dw_vk_platform') || ''; } catch (_) { p = ''; } }
  return p;
}

/** 'music' — у партнёра есть песни; 'oracle' — только оракул (натив VK и всё неясное). */
export function partnerMode() {
  if (getPlatform() !== 'vk') return 'music';
  const p = vkPlatform();
  return (p === 'desktop_web' || p === 'mobile_web') ? 'music' : 'oracle';
}

/** Подпись для замера: с какой поверхности ушли к партнёру. */
export function partnerSurface() {
  const platform = getPlatform();
  if (platform !== 'vk') return platform;
  return `vk ${vkPlatform() || 'unknown'}`;
}
