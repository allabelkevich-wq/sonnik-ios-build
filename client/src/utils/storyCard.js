import { moonPath } from './moon.js';

// Карточка сна для истории ВК. Текстовый шаринг на стену никто не нажимал:
// сон — личное, на стену его не выносят. История живёт сутки и уходит
// картинкой, без текста сна: луна, лунный день, символы и послание.
// Формат 1080×1920 и способ отправки (background_type: image, blob: dataURL)
// те же, что в Музыкальном оракуле — там он прошёл модерацию и работает.
const W = 1080;
const H = 1920;
const SYNODIC = 29.53;
const FONT = '-apple-system, "Helvetica Neue", Roboto, Arial, sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Разбивает текст на строки по ширине; лишние строки режет с многоточием. */
function wrap(ctx, text, maxWidth, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const probe = line ? `${line} ${w}` : w;
    if (ctx.measureText(probe).width <= maxWidth || !line) {
      line = probe;
    } else {
      lines.push(line);
      line = w;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last.replace(/[\s,.;:—-]+$/, '')}…`;
  }
  return lines;
}

/**
 * Рисует карточку и отдаёт data-URL PNG.
 * @param {{ lunarDay?: number, symbols?: string[], quote?: string, eyebrow: string, dayLabel: string, footer: string }} card
 */
export function drawStoryCard(card) {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');

  // Фон: ночное небо сверху, тёплая земля снизу — как на экранах приложения.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#06080d');
  bg.addColorStop(0.55, '#0b0d14');
  bg.addColorStop(1, '#17120a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Звёзды — по сетке со сдвигом, чтобы не сбивались в кучу.
  for (let i = 0; i < 70; i++) {
    const x = ((i * 137) % W) + ((i * 31) % 40);
    const y = ((i * 211) % 1500) + 60;
    const r = 1 + ((i * 7) % 3) * 0.7;
    ctx.fillStyle = i % 4 === 0 ? 'rgba(245,200,120,.75)' : 'rgba(255,255,255,.55)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Луна: сияние, тёмный диск, освещённая часть по фазе лунного дня.
  const cx = W / 2;
  const cy = 470;
  const R = 190;
  const glow = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 2.4);
  glow.addColorStop(0, 'rgba(245,200,110,.32)');
  glow.addColorStop(1, 'rgba(245,200,110,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, cy + R * 3);

  ctx.fillStyle = '#1a1d27';
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  const frac = card.lunarDay ? Math.max(0.02, Math.min(0.98, (card.lunarDay - 0.5) / SYNODIC)) : 0.5;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(R / 48, R / 48);
  const lit = ctx.createLinearGradient(-48, -48, 48, 48);
  lit.addColorStop(0, '#fff1c9');
  lit.addColorStop(1, '#e9b45a');
  ctx.fillStyle = lit;
  ctx.fill(new Path2D(moonPath(frac, 48)));
  ctx.restore();
  ctx.strokeStyle = 'rgba(245,200,110,.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, R + 2, 0, Math.PI * 2);
  ctx.stroke();

  // Подпись и лунный день.
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e9b45a';
  ctx.font = `600 30px ${FONT}`;
  ctx.fillText(card.eyebrow.toUpperCase().split('').join(' '), cx, 760);
  ctx.fillStyle = '#fff6e6';
  ctx.font = `800 74px ${FONT}`;
  ctx.fillText(card.dayLabel, cx, 860);

  // Символы: до четырёх плашек, по центру, переносятся на вторую строку.
  let y = 960;
  const chips = (card.symbols || []).slice(0, 4);
  if (chips.length) {
    ctx.font = `600 36px ${FONT}`;
    const pad = 34;
    const gap = 18;
    const rows = [[]];
    let rowW = 0;
    for (const s of chips) {
      const w = ctx.measureText(s).width + pad * 2;
      if (rowW + w + (rows[rows.length - 1].length ? gap : 0) > W - 120 && rows[rows.length - 1].length) {
        rows.push([]);
        rowW = 0;
      }
      rows[rows.length - 1].push({ s, w });
      rowW += w + gap;
    }
    for (const row of rows) {
      const total = row.reduce((a, c) => a + c.w, 0) + gap * (row.length - 1);
      let x = cx - total / 2;
      for (const c of row) {
        roundRect(ctx, x, y, c.w, 76, 38);
        ctx.fillStyle = 'rgba(255,255,255,.07)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(233,180,90,.45)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#f5e6c8';
        ctx.fillText(c.s, x + c.w / 2, y + 51);
        x += c.w + gap;
      }
      y += 96;
    }
    y += 40;
  }

  // Послание сна — курсивом, до шести строк.
  if (card.quote) {
    ctx.fillStyle = 'rgba(245,200,110,.5)';
    ctx.fillRect(cx - 60, y, 120, 2);
    y += 80;
    ctx.font = `italic 500 46px ${FONT}`;
    ctx.fillStyle = '#f7efe0';
    const lines = wrap(ctx, `«${card.quote}»`, W - 160, 6);
    for (const l of lines) {
      ctx.fillText(l, cx, y);
      y += 68;
    }
  }

  // Подвал: имя приложения и приглашение.
  ctx.font = `600 34px ${FONT}`;
  ctx.fillStyle = 'rgba(255,246,230,.8)';
  ctx.fillText(card.footer, cx, H - 150);

  return cv.toDataURL('image/png');
}

/**
 * Собирает карточку из разбора и открывает редактор истории ВК.
 * Возвращает 'shared' | 'cancelled' | 'unavailable' | 'failed'.
 * 'unavailable' — приложение открыто не в клиенте ВК: снаружи vkBridge.send
 * молчит вечно (см. utils/share.js), туда даже не ходим.
 */
export async function shareStoryCard({ analysis, t }) {
  const vkBridge = (await import('@vkontakte/vk-bridge')).default;
  if (typeof vkBridge.isEmbedded === 'function' && !vkBridge.isEmbedded()) return 'unavailable';
  const lunarDay = analysis?.lunar_data?.day_number;
  const blob = drawStoryCard({
    lunarDay,
    symbols: (analysis?.symbols || []).map((s) => s?.symbol).filter(Boolean),
    quote: analysis?.final_message || analysis?.brief_analysis || '',
    eyebrow: t('success.storyEyebrow'),
    dayLabel: lunarDay ? t('success.storyDay', { n: lunarDay }) : t('success.storyDayless'),
    footer: t('success.storyFooter'),
  });
  try {
    await vkBridge.send('VKWebAppShowStoryBox', {
      background_type: 'image',
      blob,
      attachment: { type: 'url', url: 'https://vk.com/app54661791', text: 'open' },
    });
    return 'shared';
  } catch (e) {
    const reason = String(e?.error_data?.error_reason || e?.error_type || '');
    if (e?.error_data?.error_code === 4 || /denied|cancel/i.test(reason)) return 'cancelled';
    return 'failed';
  }
}
