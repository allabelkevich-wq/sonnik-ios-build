import { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftIcon, BookOpenIcon, ChevronRightIcon, CheckCircleIcon,
  ExclamationTriangleIcon, MicrophoneIcon, PaperAirplaneIcon,
} from '@heroicons/react/24/solid';
import { getUserId, providerCode, getPlatform, authHeader } from '../platform.js';
import Paywall from './Paywall.jsx';
import { formatDayMonth } from '../utils/date.js';
import RoundButton from '../components/RoundButton.jsx';
import Constellation from '../components/Constellation.jsx';
import '../styles/oracle.css';
import { serverLang } from '../i18n/index.js';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Лёгкий рендер Markdown: **жирный** → <strong>, чтобы в ответе оракула не
// торчали звёздочки (отчёт Тамары). Остальной текст — как есть (pre-wrap).
function renderRich(text) {
  return String(text).split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    const m = /^\*\*([^*]+)\*\*$/.exec(part);
    return m ? <strong key={i}>{m[1]}</strong> : part;
  });
}

// Переписка с оракулом жила только в состоянии React: выход с экрана стирал её,
// хотя за каждое сообщение списаны Искры (отчёт 7448422). Храним по конкретному
// сну на устройстве — возврат к тому же сну открывает диалог как оставили.
const CHAT_KEY_PREFIX = 'dw_oracle_chat_';
const CHAT_KEEP = 60; // хвост переписки; больше в localStorage держать незачем

function chatKey(dreamData) {
  const id = dreamData?.dream_id;
  return id ? `${CHAT_KEY_PREFIX}${id}` : null;
}

function loadChat(dreamData) {
  const key = chatKey(dreamData);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || !arr.length) return null;
    return arr.map((m) => ({ ...m, timestamp: m.timestamp ? new Date(m.timestamp) : new Date() }));
  } catch { return null; }
}

function saveChat(dreamData, messages) {
  const key = chatKey(dreamData);
  if (!key || !Array.isArray(messages) || !messages.length) return;
  try {
    localStorage.setItem(key, JSON.stringify(messages.slice(-CHAT_KEEP)));
  } catch { /* приватный режим или переполнение — переписка просто не сохранится */ }
}

// Длинная деструктивная программа бывает фразой в 6–10 слов: в плитку-вопрос
// такая подстановка не влезает, режем по спецификации.
function clip(value, max) {
  const v = String(value).trim();
  return v.length > max ? `${v.slice(0, max).trim()}…` : v;
}

function mmss(seconds) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

// Подпись зоны: 10px/700 uppercase — как .v3-label__t, но без линии.
const labelStyle = {
  fontSize: 10, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase',
};

export default function ChatPage({ dreamData, onBack }) {
  const { t, i18n } = useTranslation();

  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [ctxOpen, setCtxOpen] = useState(false);

  // Voice recording
  const [recState, setRecState] = useState('idle');
  const [recSeconds, setRecSeconds] = useState(0);
  const [recError, setRecError] = useState('');
  const [recErrorHint, setRecErrorHint] = useState('');

  const messagesContainerRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const streamRef = useRef(null);
  const inputRef = useRef(null);

  const userId = getUserId();

  // Initial welcome message
  useEffect(() => {
    // Есть сохранённая переписка по этому сну — открываем её, а не начинаем заново.
    const saved = loadChat(dreamData);
    setMessages(saved || [{
      role: 'oracle',
      content: t('chat.oracleWelcome'),
      timestamp: new Date(),
    }]);
  }, []);

  // Сохраняем после каждого изменения — выход с экрана больше не теряет диалог.
  useEffect(() => {
    if (messages.length > 1) saveChat(dreamData, messages);
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll: прокручиваем сам список сообщений, а не весь вьюпорт — иначе
  // scrollIntoView двигал всю страницу в VK WebView (страница «прыгала» вниз
  // после отправки и после ответа, bug7438704).
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, loading, ctxOpen]);

  // Cleanup voice
  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  const analysis = dreamData?.analysis;

  // Build analysis summary for API context
  const buildAnalysisSummary = () => {
    const a = analysis;
    if (!a) return '';
    return [
      a.brief_analysis,
      a.psychosomatic && `Психосоматика: ${a.psychosomatic}`,
      a.family_context && `Родовой контекст: ${a.family_context}`,
      a.destructive_patterns?.length && `Деструктивные программы: ${a.destructive_patterns.join('; ')}`,
      a.final_message && `Послание: ${a.final_message}`,
    ].filter(Boolean).join('\n\n');
  };

  // Один запрос к оракулу. history — лента, по которой собирается контекст;
  // failIndex — индекс пользовательского пузыря, который этим запросом
  // доставляется (его и помечаем, если запрос не дошёл).
  const runChat = async (history, failIndex) => {
    setLoading(true);
    try {
      const tz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
      const apiMessages = history
        .filter((m, i) => i > 0 || m.role !== 'oracle') // skip welcome msg from API
        .filter(m => !m.failed) // недоставленное в контекст не уходит
        .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));

      const { data } = await axios.post(`${API_BASE}/api/dream-chat`, {
        dream_text: dreamData?.dream_text || '',
        analysis_summary: buildAnalysisSummary(),
        messages: apiMessages,
        user_id: userId ?? undefined,
        provider: providerCode(),
        timezone: tz || undefined,
        lang: serverLang(),
      }, { headers: await authHeader() });

      setMessages(prev => prev
        .map((m, i) => (i === failIndex ? { ...m, failed: false, failedText: '' } : m))
        .concat([{ role: 'oracle', content: data.reply, timestamp: new Date() }]));
    } catch (err) {
      if (err.response?.status === 402) {
        // Ничего не теряется: пузырь снимаем, текст возвращаем в поле, дальше — пейвол.
        setMessages(prev => prev.filter((_, i) => i !== failIndex));
        setInputText(history[failIndex]?.content || '');
        setShowPaywall(true);
      } else {
        // Ошибка больше не улетает тостом мимо ленты: она живёт в самом
        // сообщении, вместе с кнопкой «Повторить».
        const reason = err.response?.data?.error || t('chat.notDelivered');
        setMessages(prev => prev.map((m, i) => (i === failIndex ? { ...m, failed: true, failedText: reason } : m)));
      }
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = (text) => {
    const clean = text?.trim();
    if (!clean || loading) return;
    const updated = [...messages, { role: 'user', content: clean, timestamp: new Date() }];
    setMessages(updated);
    setInputText('');
    setRecError('');
    setRecErrorHint('');
    runChat(updated, updated.length - 1);
  };

  // Повтор не дублирует сообщение в ленте: снимаем метку и шлём ту же историю.
  const retry = (index) => {
    if (loading) return;
    const history = messages
      .slice(0, index + 1)
      .map((m, i) => (i === index ? { ...m, failed: false } : m));
    setMessages(prev => prev.map((m, i) => (i === index ? { ...m, failed: false, failedText: '' } : m)));
    runChat(history, index);
  };

  const handleSend = () => {
    if (inputText.trim()) sendMessage(inputText);
  };

  // Voice recording (same pattern as FormPage)
  const startRecording = async () => {
    setRecError('');
    setRecErrorHint('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setRecState('transcribing');
        try {
          const formData = new FormData();
          formData.append('file', blob, 'dream-chat.webm');
          const res = await axios.post(`${API_BASE}/api/transcribe`, formData, {
            // Токен обязателен: транскрибация закрыта авторизацией (отчёт 7443497).
            // Без него оракул отвечал «не удалось записать голос» (отчёт 7444330).
            headers: { 'Content-Type': 'multipart/form-data', ...(await authHeader()) },
            timeout: 60000,
          });
          const text = res.data?.text?.trim();
          if (text) {
            setRecState('idle');
            sendMessage(text);
          } else {
            setRecError(t('chat.errorTranscribeRetryText'));
            setRecState('idle');
          }
        } catch {
          setRecError(t('chat.errorVoice'));
          setRecState('idle');
        }
      };
      recorder.start();
      setRecState('recording');
      setRecSeconds(0);
      timerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000);
    } catch (err) {
      const denied = err.name === 'NotAllowedError';
      const app = getPlatform() === 'telegram' ? 'Telegram'
        : getPlatform() === 'vk' ? 'VK'
          : t('chat.micAppBrowser');
      setRecError(denied ? t('chat.errorMicDenied') : t('chat.errorMicUnavailable'));
      setRecErrorHint(denied ? t('chat.micDeniedHint', { app }) : t('chat.micUnavailableHint'));
    }
  };

  const stopRecording = () => {
    if (recState !== 'recording') return;
    clearInterval(timerRef.current);
    mediaRecorderRef.current?.stop();
  };

  const isRecording = recState === 'recording';
  const isTranscribing = recState === 'transcribing';
  const micAvailable = !!(navigator.mediaDevices?.getUserMedia);

  const dreamDate = dreamData?.created_at
    ? formatDayMonth(dreamData.created_at, i18n.language)
    : null;

  // Первые слова сна в «ёлочках» — чтобы было видно, о каком сне разговор.
  const dreamRef = dreamData?.dream_text
    ? `«${clip(dreamData.dream_text, 40)}»`
    : t('chat.yourDream');

  // Что ушло в контекст: те же поля, что собирает buildAnalysisSummary().
  const ctxBody = useMemo(() => {
    const a = analysis;
    const parts = [t('chat.ctxDream')];
    if (a?.brief_analysis) parts.push(t('chat.ctxBrief'));
    if (a?.psychosomatic) parts.push(t('chat.ctxPsy'));
    if (a?.family_context) parts.push(t('chat.ctxFamily'));
    if (a?.destructive_patterns?.length) parts.push(t('chat.ctxPatterns', { count: a.destructive_patterns.length }));
    if (a?.final_message) parts.push(t('chat.ctxMessage'));
    const line = parts.join(', ');
    return t('chat.contextBody', {
      parts: line.charAt(0).toUpperCase() + line.slice(1),
      date: dreamDate || '',
    });
  }, [analysis, dreamDate, i18n.language]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctxChips = (analysis?.symbols || []).map(s => s?.symbol).filter(Boolean).slice(0, 3);

  // Вопросы-подсказки собираем на клиенте: /api/analyze не отдаёт их вместе
  // с разбором, а пустое поле — главная причина, по которой разговор не
  // начинается. Шаблоны подставляют реальные символы и программы этого сна.
  const suggestions = useMemo(() => {
    const a = analysis;
    const symbols = (a?.symbols || []).map(s => s?.symbol).filter(Boolean);
    const pattern = a?.destructive_patterns?.[0];
    const list = [];
    if (symbols[0]) list.push(t('chat.qSymbol', { symbol: clip(symbols[0], 40) }));
    if (pattern) list.push(t('chat.qPattern', { pattern: clip(pattern, 40) }));
    if (symbols[1]) list.push(t('chat.qSymbol', { symbol: clip(symbols[1], 40) }));
    list.push(t('chat.qDetail'));
    if (a?.family_context) list.push(t('chat.qFamily'));
    list.push(t('chat.qPractice'));
    return list.slice(0, 5);
  }, [analysis, i18n.language]); // eslint-disable-line react-hooks/exhaustive-deps

  // Сравнение по тексту: восстановленная из localStorage переписка так же
  // правильно прячет уже заданные вопросы.
  const asked = messages.filter(m => m.role === 'user').map(m => m.content);
  const openQuestions = suggestions.filter(q => !asked.includes(q)).slice(0, 3);

  // Разговор закрываем только там, где он действительно сохранится: без
  // dream_id (чат сразу после разбора) переписка в дневник не попадёт.
  const answered = messages.filter(m => m.role === 'oracle').length - 1;
  const closing = answered >= 3 && !loading && !!dreamData?.dream_id;
  const showQuestions = !loading && !closing && !isRecording && !isTranscribing && openQuestions.length > 0;

  const sendActive = !!inputText.trim() && !loading;

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      {/* Шапка. Экран без <header>, поэтому safe-area + 40px руками: на iPhone
          в VK плавающие кнопки «ещё/закрыть» кончаются на 78pt, и кнопка-книга
          справа иначе ложится прямо под них (грабли 01.09). */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        padding: 'var(--v3-top) 18px 14px',
        borderBottom: '1px solid var(--v3-tile-br)',
      }}>
        <RoundButton onClick={onBack} label={t('chat.back')}>
          <ArrowLeftIcon style={{ width: 17, height: 17 }} />
        </RoundButton>

        <div style={{ minWidth: 0, flex: 1 }}>
          {/* div, а не h1: глобальный h1 красится золотым градиентом. */}
          <div style={{
            fontSize: 16.5, fontWeight: 800, letterSpacing: '-.02em',
            color: 'var(--v3-fg)', lineHeight: 1.2,
          }}>
            {t('chat.title')}
          </div>
          <div style={{
            fontSize: 11.5, color: 'var(--v3-fg-3)', marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {dreamRef}
          </div>
        </div>

        <button
          type="button"
          className="o-iconbtn"
          onClick={() => setCtxOpen(v => !v)}
          aria-expanded={ctxOpen}
          aria-label={t('chat.contextTitle')}
        >
          <span className="o-iconbtn__in">
            <BookOpenIcon style={{ width: 17, height: 17 }} />
          </span>
        </button>
      </div>

      {/* Что оракул уже знает */}
      {ctxOpen && (
        <div style={{
          flexShrink: 0, padding: '14px 18px', background: 'var(--o-ctx)',
          borderBottom: '1px solid var(--v3-tile-br)',
          display: 'flex', flexDirection: 'column', gap: 9,
        }}>
          <div style={{ ...labelStyle, color: 'var(--v3-purple-txt)' }}>{t('chat.contextTitle')}</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--v3-fg-2)' }}>{ctxBody}</div>
          {ctxChips.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {ctxChips.map((s, i) => (
                <span key={i} style={{
                  fontSize: 11, padding: '4px 9px', borderRadius: 999,
                  background: 'var(--v3-inset)', color: 'var(--v3-fg-3)',
                }}>
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Лента */}
      <div ref={messagesContainerRef} style={{
        flex: 1, overflowY: 'auto', padding: '16px 18px 10px',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        {/* Дата один раз разделителем: время под каждым пузырём в разговоре
            на пять реплик только шумит. */}
        {dreamDate && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ flex: 1, height: 1, background: 'var(--v3-rule-c)' }} />
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '.16em',
              textTransform: 'uppercase', color: 'var(--v3-fg-4)',
            }}>
              {dreamDate}
            </span>
            <span style={{ flex: 1, height: 1, background: 'var(--v3-rule-c)' }} />
          </div>
        )}

        {messages.map((msg, i) => {
          const isUser = msg.role === 'user';
          return (
            <div key={i} className="o-row" style={{
              display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start',
            }}>
              <div style={{
                maxWidth: '84%', padding: '13px 16px',
                borderRadius: isUser ? '19px 19px 6px 19px' : '19px 19px 19px 6px',
                background: msg.failed ? 'var(--v3-danger-bg)' : (isUser ? 'var(--o-mine)' : 'var(--o-oracle)'),
                border: `1px solid ${msg.failed ? 'var(--v3-danger-br)' : (isUser ? 'var(--o-mine-br)' : 'var(--v3-chip-p-br)')}`,
                forcedColorAdjust: 'none',
              }}>
                <div style={{
                  fontSize: 14, lineHeight: 1.62, color: 'var(--v3-fg-2)',
                  whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                }}>
                  {renderRich(msg.content)}
                </div>
                {msg.failed && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    marginTop: 9, paddingTop: 9, borderTop: '1px solid var(--v3-danger-br)',
                  }}>
                    <ExclamationTriangleIcon style={{ width: 14, height: 14, color: 'var(--v3-danger)', flexShrink: 0 }} />
                    <span style={{ fontSize: 11.5, color: 'var(--v3-danger)', flex: 1, overflowWrap: 'anywhere' }}>
                      {msg.failedText || t('chat.notDelivered')}
                    </span>
                    <button type="button" className="o-tap" onClick={() => retry(i)} disabled={loading}>
                      <span className="o-tap__retry">{t('common.retry')}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{
              padding: '14px 18px', borderRadius: '19px 19px 19px 6px',
              background: 'var(--o-oracle)', border: '1px solid var(--v3-chip-p-br)',
              display: 'flex', gap: 6, alignItems: 'center',
            }}>
              {[0, 1, 2].map(i => (
                <span key={i} className="o-dot" style={{ animationDelay: `${i * 0.2}s` }} />
              ))}
            </div>
          </div>
        )}

        {showQuestions && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, paddingTop: 4 }}>
            <div style={{ ...labelStyle, color: 'var(--v3-gold-label)' }}>{t('chat.suggested')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {openQuestions.map((q) => (
                <div
                  key={q}
                  role="button"
                  tabIndex={0}
                  className="o-ask"
                  onClick={() => sendMessage(q)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sendMessage(q); }
                  }}
                >
                  <span style={{ flex: 1 }}>{q}</span>
                  <ChevronRightIcon style={{ width: 14, height: 14, color: 'var(--v3-fg-4)', flexShrink: 0 }} />
                </div>
              ))}
            </div>
          </div>
        )}

        {closing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11, paddingTop: 6 }}>
            <Constellation />
            <div style={{
              borderRadius: 18, border: '1px solid var(--v3-chip-s-br)',
              background: 'var(--v3-practice)', padding: '15px 16px',
              display: 'flex', flexDirection: 'column', gap: 10,
              forcedColorAdjust: 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircleIcon style={{ width: 16, height: 16, color: 'var(--v3-success)', flexShrink: 0 }} />
                <span style={{ ...labelStyle, letterSpacing: '.16em', color: 'var(--v3-success)' }}>
                  {t('chat.saved')}
                </span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--v3-fg-2)' }}>
                {t('chat.savedHint', { date: dreamDate || '' })}
              </div>
              <div
                role="button"
                tabIndex={0}
                className="o-finish"
                onClick={onBack}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onBack(); }
                }}
              >
                {t('chat.finish')}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Панель ввода */}
      <div style={{
        flexShrink: 0,
        padding: '11px 18px calc(env(safe-area-inset-bottom, 0px) + 12px)',
        borderTop: '1px solid var(--v3-tile-br)',
        background: 'var(--bar-bg)',
      }}>
        {isRecording && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 11, marginBottom: 10,
            padding: '11px 14px', borderRadius: 15,
            background: 'var(--v3-danger-bg)', border: '1px solid var(--v3-danger-br)',
          }}>
            <span className="o-recdot" />
            <span style={{
              fontSize: 13, fontWeight: 700, color: 'var(--v3-danger)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {mmss(recSeconds)}
            </span>
            <span className="o-wave" aria-hidden="true">
              {Array.from({ length: 18 }, (_, i) => (
                <span key={i} style={{ animationDelay: `${(i * 0.07).toFixed(2)}s` }} />
              ))}
            </span>
            <button type="button" className="o-tap" onClick={stopRecording}>
              <span className="o-tap__stop">{t('chat.stopButton')}</span>
            </button>
          </div>
        )}

        {isTranscribing && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
            padding: '11px 14px', borderRadius: 15,
            background: 'var(--v3-chip-p)', border: '1px solid var(--v3-chip-p-br)',
          }}>
            <span className="o-dot" />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--v3-purple-txt)', flex: 1 }}>
              {t('chat.transcribing', { count: recSeconds })}
            </span>
          </div>
        )}

        {recError && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 9, marginBottom: 10,
            padding: '11px 14px', borderRadius: 15,
            background: 'var(--v3-danger-bg)', border: '1px solid var(--v3-danger-br)',
          }}>
            <ExclamationTriangleIcon style={{ width: 15, height: 15, color: 'var(--v3-danger)', flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--v3-fg-2)' }}>{recError}</div>
              {recErrorHint && (
                <div style={{ fontSize: 11.5, color: 'var(--v3-fg-3)', marginTop: 2, lineHeight: 1.45 }}>
                  {recErrorHint}
                </div>
              )}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-end' }}>
          {micAvailable && (
            <button
              type="button"
              className="o-mic"
              onClick={startRecording}
              disabled={loading || isRecording || isTranscribing}
              aria-label={t('chat.voiceInput')}
            >
              <MicrophoneIcon style={{ width: 19, height: 19 }} />
            </button>
          )}

          <input
            ref={inputRef}
            className="o-field"
            value={inputText}
            maxLength={2000}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={t('chat.placeholder')}
            disabled={loading || isRecording || isTranscribing}
          />

          <button
            type="button"
            className={sendActive ? 'o-send o-send--on' : 'o-send o-send--off'}
            onClick={handleSend}
            disabled={!sendActive}
            aria-label={t('chat.send')}
          >
            <PaperAirplaneIcon style={{ width: 19, height: 19 }} />
          </button>
        </div>

        <div style={{ fontSize: 10.5, color: 'var(--v3-fg-4)', textAlign: 'center', marginTop: 8 }}>
          {isRecording ? t('chat.hintRecording') : t('chat.hintDefault')}
        </div>
      </div>

      {showPaywall && (
        <Paywall
          userId={userId}
          reason={t(getPlatform() === 'vk' ? 'paywall.reasonOracleVk' : 'paywall.reasonOracle')}
          onClose={() => setShowPaywall(false)}
        />
      )}
    </div>
  );
}
