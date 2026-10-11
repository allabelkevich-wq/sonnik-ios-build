import { useState, useEffect } from 'react';
import { getPlatform } from '../platform.js';

import { API_BASE } from '../apiBase.js';

// Голосовой ввод включает сервер: в VK, Telegram и ОК голос есть, только пока
// работает свой распознаватель в Москве (STT_URL), в приложении App Store — пока
// задан ключ Groq. Площадку передаём, ответ — для неё. Спрашиваем один раз при запуске
// приложения — к открытию формы ответ уже на руках, и вкладки не прыгают.
// Не дозвонились — микрофона нет: текстом сон записать можно всегда.
// Запрос — при первом вызове, а не при импорте: адрес сервера (apiBase.js)
// выбирается до отрисовки, но после загрузки модулей.
let voiceOn = false;
let voiceReady = null;
function askVoice() {
  if (!voiceReady) {
    voiceReady = fetch(`${API_BASE}/api/transcribe?platform=${getPlatform()}`)
      .then((r) => r.json())
      .then((d) => { voiceOn = d?.enabled === true; return voiceOn; })
      .catch(() => false);
  }
  return voiceReady;
}

export function useVoiceInput() {
  const [enabled, setEnabled] = useState(voiceOn);
  useEffect(() => {
    let alive = true;
    askVoice().then((on) => { if (alive) setEnabled(on); });
    return () => { alive = false; };
  }, []);
  return enabled && !!navigator.mediaDevices?.getUserMedia;
}
