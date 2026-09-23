import { useCallback, useEffect, useState } from 'react';
import { getPlatform } from '../platform.js';

/** Сообщество «Лунный сонник» — vk.com/lunnyy_sonnik. Каждое утро там выходит
 *  разбор лунного дня; это единственный ежедневный канал возврата в приложение
 *  (уведомления из кабинета VK — не чаще 4 в месяц). */
export const VK_GROUP_ID = 240008741;
const JOINED_KEY = 'vk_group_joined';

// null — ещё не узнавали; true/false — ответ VK на эту сессию.
let memberCache = null;

// Вне клиента VK bridge не отвечает никогда (см. share.js) — не зовём его.
async function bridge() {
  const vkBridge = (await import('@vkontakte/vk-bridge')).default;
  if (typeof vkBridge.isEmbedded === 'function' && !vkBridge.isEmbedded()) return null;
  return vkBridge;
}

async function isMember() {
  if (memberCache !== null) return memberCache;
  try { if (localStorage.getItem(JOINED_KEY)) return (memberCache = true); } catch (_) { /* приватный режим */ }
  try {
    const vk = await bridge();
    if (!vk) return true;
    const info = await vk.send('VKWebAppGetGroupInfo', { group_id: VK_GROUP_ID });
    memberCache = Boolean(info?.is_member);
  } catch (_) {
    memberCache = true; // не смогли узнать — не навязываемся
  }
  return memberCache;
}

export async function joinVkGroup() {
  try {
    const vk = await bridge();
    if (!vk) return false;
    const res = await vk.send('VKWebAppJoinGroup', { group_id: VK_GROUP_ID });
    if (!res?.result) return false;
    memberCache = true;
    try { localStorage.setItem(JOINED_KEY, '1'); } catch (_) { /* приватный режим */ }
    return true;
  } catch (_) {
    return false; // отказ пользователя — штатный исход
  }
}

/** Показывать ли приглашение в сообщество: только внутри VK и только не участникам. */
export function useVkGroupInvite() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (getPlatform() !== 'vk') return undefined;
    let alive = true;
    isMember().then((member) => { if (alive) setShow(!member); });
    return () => { alive = false; };
  }, []);
  const join = useCallback(async () => {
    const ok = await joinVkGroup();
    if (ok) setShow(false);
    return ok;
  }, []);
  return { show, join };
}
