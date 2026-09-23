// Общий «поделиться» для результата анализа и итогов месяца.
//
// Раньше каждый экран собирал свою цепочку, и обе молчали при провале:
// если бридж VK отказал, а буфер обмена недоступен, пользователь видел
// ровно ничего — нажал и не понял, сработало или нет (отчёт 7449177).
// Здесь один порядок попыток и обязательная обратная связь в конце.

const VK_APP_LINK = 'https://vk.com/app54661791';

/** Пользователь сам закрыл окно шаринга — молчим, это не ошибка. */
function isCancelled(e) {
  const reason = String(e?.error_data?.error_reason || e?.error_type || '');
  return e?.error_data?.error_code === 4 || /denied|cancel/i.test(reason);
}

/**
 * Идёт ли приложение внутри клиента VK. Проверять обязательно: снаружи
 * (прямая ссылка, обычная вкладка) vkBridge.send НЕ отвечает никогда —
 * ни успехом, ни отказом, — и кнопка «поделиться» молчала навсегда.
 * vkBridge.supports() для этого не годится: снаружи он всё равно даёт true.
 */
async function inVkClient() {
  try {
    const vkBridge = (await import('@vkontakte/vk-bridge')).default;
    return typeof vkBridge.isEmbedded === 'function' ? vkBridge.isEmbedded() : true;
  } catch (_) {
    return false;
  }
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) { /* закрытый буфер — пробуем запасной путь */ }
  // Вебвью без Clipboard API: старый приём через скрытое поле.
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (_) {
    return false;
  }
}

/**
 * Делится текстом. Возвращает 'shared' | 'copied' | 'cancelled' | 'failed'.
 * Тосты показывает сам: успех шаринга комментирует платформа, а копирование
 * и отказ обязаны отозваться в интерфейсе.
 */
export async function shareText({ platform, text, tgLink, showToast, t }) {
  if (platform === 'vk' && await inVkClient()) {
    try {
      // Стена несёт текст целиком; если клиент метод не умеет — бридж
      // ответит отказом, и мы уходим на обычный шаринг ссылки.
      const vkBridge = (await import('@vkontakte/vk-bridge')).default;
      await vkBridge.send('VKWebAppShowWallPostBox', { message: text, attachments: VK_APP_LINK });
      return 'shared';
    } catch (e) {
      if (isCancelled(e)) return 'cancelled';
      try {
        const vkBridge = (await import('@vkontakte/vk-bridge')).default;
        await vkBridge.send('VKWebAppShare', { link: VK_APP_LINK });
        return 'shared';
      } catch (e2) {
        if (isCancelled(e2)) return 'cancelled';
      }
    }
  } else if (window.Telegram?.WebApp?.openTelegramLink) {
    window.Telegram.WebApp.openTelegramLink(
      `https://t.me/share/url?url=${encodeURIComponent(tgLink)}&text=${encodeURIComponent(text)}`
    );
    return 'shared';
  } else if (navigator.share) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
    }
  }

  if (await copyToClipboard(text)) {
    showToast?.(t('success.copied'), 'success');
    return 'copied';
  }
  showToast?.(t('success.shareFailed'), 'error');
  return 'failed';
}
