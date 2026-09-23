import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon, MoonIcon, MicrophoneIcon, StopCircleIcon, PencilSquareIcon, ClipboardDocumentIcon, CheckCircleIcon } from '@heroicons/react/24/solid';
import { getUserId, providerCode, getPlatform, getVkParams, authHeader, signInWithApple } from '../platform.js';
import Paywall from './Paywall.jsx';
import PageHeader from '../components/PageHeader.jsx';
import RoundButton from '../components/RoundButton.jsx';
import EdgeCard from '../components/EdgeCard.jsx';
import GoldButton from '../components/GoldButton.jsx';
import '../styles/form.css';
import { pulse, mark } from '../utils/pulse.js';
import { serverLang } from '../i18n/index.js';

const API_BASE = import.meta.env.VITE_API_URL || '';

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const MAX_DREAM_LENGTH = 5000;
const MIN_DREAM_LENGTH = 10;

// Подсказки-образы. Из формы до набора текста доходит треть: человек открывает
// пустое поле и уходит. При этом 40% записей — два-три слова («Выпали зубы», «Бывший
// парень»): в приложение приходят за значением образа, а не за рассказом.
// Кнопка ставит начало фразы — дальше человек дописывает сам. Порядок — по
// частоте тем в наших же 3 700 снах (дом 12%, родные 9%, бывший 8%).
const SEED_CHIPS = ['exPartner', 'deceased', 'child', 'home', 'cat', 'water', 'teeth', 'chase'];

// Осциллограмма декоративная: живых уровней громкости у нас нет и они
// не нужны — макет задаёт фиксированные высоты и разбег фаз.
const BARS = [
  { h: 16, a: 0.55, d: 0 }, { h: 30, a: 0.7, d: 0.1 }, { h: 42, a: 1, d: 0.2 },
  { h: 26, a: 0.7, d: 0.3 }, { h: 38, a: 1, d: 0.15 }, { h: 20, a: 0.55, d: 0.25 },
  { h: 34, a: 0.8, d: 0.05 }, { h: 22, a: 0.6, d: 0.35 }, { h: 40, a: 1, d: 0.12 },
  { h: 18, a: 0.5, d: 0.28 }, { h: 32, a: 0.75, d: 0.18 }, { h: 24, a: 0.6, d: 0.32 },
];

// Счётчик символов набивался одними пробелами, а подряд идущие пробелы уходили
// в промпт (отчёт 7443724). Схлопываем пробелы/табы в один и режем в начале;
// переводы строк не трогаем — абзацы в описании сна нужны.
function normalizeDreamInput(value) {
  return value.replace(/[^\S\n]{2,}/g, ' ').replace(/^[^\S\n]+/, '');
}

export default function FormPage({ onSuccess, onBack, onAnalysis }) {
  const { t } = useTranslation();
  const ANALYSIS_STEPS = t('form.analysisSteps', { returnObjects: true });

  const [dreamText, setDreamText] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [toast, setToast] = useState(null);
  const [showPaywall, setShowPaywall] = useState(false);
  // Остаток бесплатных разборов — показываем под кнопкой, чтобы стоимость была
  // видна до запуска (7441279) и было понятно, сколько подарка осталось.
  const [freeLeft, setFreeLeft] = useState(null);
  const [iskryCost, setIskryCost] = useState(null);
  const userId = getUserId();
  // Вход через Apple меняет getUserId() в обход React — форму после него
  // перерисовывает смена этого состояния.
  const [appleSignIn, setAppleSignIn] = useState('idle'); // 'idle' | 'busy' | 'error'
  const loadingTimerRef = useRef(null);
  const toastTimer = useRef(null);
  const taRef = useRef(null);

  // Отметка шага воронки (utils/pulse.js): только в лог сервера.
  useEffect(() => { pulse('форма'); }, []);
  useEffect(() => {
    if (!userId) return;
    let off = false;
    authHeader().then(headers =>
      fetch(`${API_BASE}/api/user/${userId}/subscription?provider=${providerCode()}`, { headers })
        .then(r => r.json())
        .then(d => {
          if (off) return;
          if (d?.free) setFreeLeft(d.free.remaining ?? null);
          // Цену разбора берём из ответа, а не зашиваем в текст: при смене
          // тарифа строка обновится сама.
          if (d?.iskry?.cost?.analysis) setIskryCost(d.iskry.cost.analysis);
        })
        .catch(() => {})
    );
    return () => { off = true; };
  }, [userId]);

  const showToast = (msg, type = 'error') => {
    setToast({ msg, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  // 'idle' | 'recording' | 'transcribing' | 'done' | 'error'
  const [recState, setRecState] = useState('idle');
  const [recSeconds, setRecSeconds] = useState(0);
  const [recError, setRecError] = useState('');
  // 'text' | 'voice'
  const [activeTab, setActiveTab] = useState('text');

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const startRecording = async () => {
    setRecError('');
    setRecState('idle');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        await transcribeBlob(blob);
      };

      recorder.start();
      setRecState('recording');
      setRecSeconds(0);
      timerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000);
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setRecError(t('form.errorVoice'));
      } else {
        setRecError(t('form.errorVoice'));
      }
    }
  };

  const stopRecording = () => {
    if (recState !== 'recording') return;
    setRecState('transcribing');
    clearInterval(timerRef.current);
    mediaRecorderRef.current?.stop();
  };

  const transcribeBlob = async (blob) => {
    try {
      const formData = new FormData();
      formData.append('file', blob, 'dream.webm');
      const res = await axios.post(`${API_BASE}/api/transcribe`, formData, {
        headers: { 'Content-Type': 'multipart/form-data', ...(await authHeader()) },
        timeout: 60000,
      });
      const text = res.data?.text?.trim();
      if (text) {
        // Дописываем к уже набранному, а не заменяем: раньше голос стирал
        // введённый текст без предупреждения (отчёт 7442962).
        setDreamText(prev => (prev.trim() ? `${prev.trim()} ${text}` : text).slice(0, MAX_DREAM_LENGTH));
        setRecState('done');
        setRecSeconds(0);
        // После успешной расшифровки переключаемся на текст чтобы пользователь видел результат
        setActiveTab('text');
      } else {
        mark('отказ', 'голос пусто');
        setRecError(t('form.errorTranscribe'));
        setRecState('error');
      }
    } catch (e) {
      mark('отказ', `голос ${e.response?.status || 'сеть'}`);
      setRecError(t('form.errorTranscribe'));
      setRecState('error');
    }
  };

  const analyzeDream = async () => {
    // Кнопка при коротком тексте неактивна, а строка статуса под полем говорит,
    // сколько символов не хватает — тосты про пустое/короткое больше не нужны.
    if (dreamText.trim().length < MIN_DREAM_LENGTH) return;
    pulse('отправка');
    setLoading(true);
    setLoadingStep(0);
    loadingTimerRef.current = setInterval(() => {
      setLoadingStep(s => (s + 1) % ANALYSIS_STEPS.length);
    }, 6000);
    try {
      const timezone = typeof Intl !== 'undefined' && Intl.DateTimeFormat
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : undefined;
      const { data } = await axios.post(`${API_BASE}/api/analyze`, {
        dream_text: dreamText.trim(),
        user_id: userId ?? undefined,
        provider: providerCode(),
        timezone: timezone || undefined,
        // Язык разбора: без него модель отвечала по-русски и англоязычному человеку.
        lang: serverLang(),
      }, { headers: await authHeader() });
      // Пользователь снова завёл данные после удаления аккаунта — снимаем признак
      // «удалён», профиль опять показывает имя и аватар VK (отчёт 7438688).
      try { localStorage.removeItem('dw_account_deleted'); } catch { /* приватный режим */ }
      if (onAnalysis) onAnalysis({ ...data, dream_text: dreamText.trim() });
      onSuccess();
    } catch (err) {
      if (err.response?.status === 402) {
        mark('отказ', 'разбор 402');
        setShowPaywall(true);
      } else {
        mark('отказ', `разбор ${err.response?.status || 'сеть'}`);
        const msg = err.response?.data?.error || t('form.errorAnalysis');
        showToast(msg);
        console.error(err);
      }
    } finally {
      clearInterval(loadingTimerRef.current);
      setLoading(false);
    }
  };

  const trimmed = dreamText.trim().length;
  const enough = trimmed >= MIN_DREAM_LENGTH;
  // Набрано достаточно — один раз за сеанс: отделяет «не начал писать» от
  // «написал и не нажал».
  useEffect(() => { if (enough) pulse('ввод'); }, [enough]);
  useEffect(() => { if (activeTab === 'voice') pulse('голос'); }, [activeTab]);

  const isRecording = recState === 'recording';
  const isTranscribing = recState === 'transcribing';
  const isDone = recState === 'done';
  const micAvailable = !!(navigator.mediaDevices?.getUserMedia);

  // Веб-гость (прямой заход на сайт вне VK/Telegram) не имеет личности — платная
  // расшифровка ему недоступна. Ведём в приложение VK, чтобы не абузили бесплатным
  // безлимитом без учёта (отчёт 7439057). Бэкенд то же закрывает жёстко (401).
  if (getPlatform() === 'web') {
    return (
      <div className="page">
        <PageHeader onBack={onBack} title={t('form.title')} />
        <div className="page-scroll">
          <div className="section" style={{ textAlign: 'center', padding: '36px 24px' }}>
            <MoonIcon style={{ width: 48, height: 48, color: 'var(--primary-color)', margin: '0 auto 16px' }} />
            <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg)', margin: '0 0 10px' }}>
              {t('form.webGate.title')}
            </h2>
            <p style={{ fontSize: 14, color: 'rgba(var(--fg-rgb),0.65)', lineHeight: 1.6, margin: '0 0 24px' }}>
              {t('form.webGate.desc')}
            </p>
            <a
              href="https://vk.com/app54661791"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                textDecoration: 'none', gap: 8,
                background: 'linear-gradient(135deg, var(--primary-color), var(--secondary-color))',
                color: '#08071a', fontWeight: 700, fontSize: 15,
                padding: '14px 28px', borderRadius: 9999,
                boxShadow: '0 6px 20px rgba(232,146,10,0.3)',
              }}
            >
              <MoonIcon style={{ width: 18, height: 18 }} />
              {t('form.webGate.button')}
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Приложение из App Store: разбор ложится в дневник и списывает бесплатные
  // попытки — нужна личность. Единственный вход в приложении — через Apple.
  if (getPlatform() === 'ios' && !userId) {
    const onAppleSignIn = async () => {
      setAppleSignIn('busy');
      try {
        await signInWithApple();
        setAppleSignIn('idle');
      } catch (e) {
        // Закрытое окно Apple (код 1001) — не ошибка: просто остаёмся на экране.
        setAppleSignIn(/1001|cancel/i.test(String(e?.message || e)) ? 'idle' : 'error');
      }
    };
    return (
      <div className="page">
        <PageHeader onBack={onBack} title={t('form.title')} />
        <div className="page-scroll">
          <div className="section" style={{ textAlign: 'center', padding: '36px 24px' }}>
            <MoonIcon style={{ width: 48, height: 48, color: 'var(--primary-color)', margin: '0 auto 16px' }} />
            <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg)', margin: '0 0 10px' }}>
              {t('form.appleGate.title')}
            </h2>
            <p style={{ fontSize: 14, color: 'rgba(var(--fg-rgb),0.65)', lineHeight: 1.6, margin: '0 0 24px' }}>
              {t('form.appleGate.desc')}
            </p>
            <button type="button" className="f-apple-btn" onClick={onAppleSignIn} disabled={appleSignIn === 'busy'}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
              </svg>
              {t('form.appleGate.button')}
            </button>
            {appleSignIn === 'error' && (
              <p style={{ fontSize: 13, color: 'rgba(var(--fg-rgb),0.65)', margin: '14px 0 0' }}>
                {t('form.appleGate.error')}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Полосы осциллограммы: красные при записи, аметистовые при расшифровке,
  // тусклые и неподвижные в покое.
  const barColor = (a) => {
    if (isRecording) return a === 1 ? 'var(--f-rec)' : `rgba(var(--f-rec-rgb),${a})`;
    if (isTranscribing) return `rgba(var(--v3-purple-rgb),${a})`;
    return 'rgba(var(--fg-rgb),.22)';
  };

  const voiceBody = (
    <div className="f-rec-body">
      <div className={`f-rec-label${isRecording ? ' f-rec-label--live' : isTranscribing ? ' f-rec-label--busy' : ''}`}>
        {isRecording && <span className="f-rec-dot" />}
        {isRecording ? t('form.recording') : isTranscribing ? t('form.transcribing') : t('form.voiceIdleLabel')}
      </div>

      <div className={`f-bars${isRecording || isTranscribing ? ' f-bars--live' : ''}`} aria-hidden>
        {BARS.map((b, i) => (
          <span key={i} className="f-bar" style={{ height: b.h, background: barColor(b.a), animationDelay: `${b.d}s` }} />
        ))}
      </div>

      {!isTranscribing && (
        <div className={`f-timer${isRecording ? '' : ' f-timer--idle'}`}>
          {isRecording ? formatTime(recSeconds) : formatTime(0)}
        </div>
      )}

      <div className={`f-rec-hint${recError && !isRecording && !isTranscribing ? ' f-rec-hint--err' : ''}`}>
        {isRecording
          ? `${t('form.voiceHint')} ${t('form.voiceEditHint')}`
          : isTranscribing
            ? t('form.transcribing')
            : recError || t('form.idleHint')}
      </div>

      <button
        type="button"
        className={`f-btn ${isRecording ? 'f-btn--stop' : 'f-btn--rec'}`}
        onClick={isRecording ? stopRecording : startRecording}
        disabled={isTranscribing || loading}
      >
        {isTranscribing
          ? t('form.transcribing')
          : isRecording
            ? <><StopCircleIcon style={{ width: 19, height: 19, flexShrink: 0 }} />{t('form.stopRecord')}</>
            : <><MicrophoneIcon style={{ width: 19, height: 19, flexShrink: 0 }} />{t('form.record')}</>}
      </button>
    </div>
  );

  return (
    <div className="page">
      {/* Toast уведомление */}
      {toast && (
        <div
          onClick={() => setToast(null)}
          style={{
            position: 'fixed', top: 'calc(env(safe-area-inset-top, 0px) + 16px)', left: '50%', transform: 'translateX(-50%)',
            zIndex: 1000, maxWidth: '90%',
            padding: '12px 20px', borderRadius: 12,
            background: toast.type === 'error' ? 'rgba(239,68,68,0.95)' : 'rgba(74,222,128,0.95)',
            color: '#fff', fontSize: 14, fontWeight: 600,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            cursor: 'pointer', textAlign: 'center',
            // toastIn сохраняет translateX(-50%); fadeIn затирал центрирование
            // (тост буфера появлялся сбоку и уезжал в центр, bug7438730).
            animation: 'toastIn 0.2s ease',
          }}
        >
          {toast.msg}
        </div>
      )}

      <div className="page-scroll">
        {/* Своей шапки-<header> у экрана нет, поэтому верхний отступ с safe-area
            даём здесь: иначе «Назад» и прогресс уезжают под плавающие кнопки VK
            на iPhone (коммит 7eb2f07, 01.09). */}
        <div style={{ padding: 'var(--v3-top) 0 30px', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* ── Шапка: назад, шаг, прогресс ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <RoundButton onClick={onBack} label={t('form.back')}>
              <ArrowLeftIcon style={{ width: 17, height: 17 }} />
            </RoundButton>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="f-title">{t('form.title')}</div>
              <div className="f-step">{t('form.stepOf', { n: 1, total: 2 })} · {t('form.stepTell')}</div>
            </div>
            <div style={{ flexShrink: 0, display: 'flex', gap: 4, alignItems: 'center' }} aria-hidden>
              <span className="f-seg f-seg--on" />
              <span className="f-seg" />
            </div>
          </div>

          {/* ── Табы: Текст / Голос ── */}
          <div className="f-tabs" style={{ opacity: loading ? 0.5 : 1 }}>
            <button
              type="button"
              className={`f-tab${activeTab === 'text' ? ' f-tab--on' : ''}`}
              onClick={() => setActiveTab('text')}
              disabled={loading}
            >
              <PencilSquareIcon className="f-tab__ico" />
              {t('form.tabText')}
            </button>
            {micAvailable && (
              <button
                type="button"
                className={`f-tab${activeTab === 'voice' ? ' f-tab--on' : ''}`}
                onClick={() => setActiveTab('voice')}
                disabled={loading}
              >
                <MicrophoneIcon className="f-tab__ico" />
                {t('form.tabVoice')}
              </button>
            )}
          </div>

          {/* ── Текстовый ввод ── */}
          {activeTab === 'text' && (
            <EdgeCard edge="violet" radius={20} padding="15px" sheen>
              <div>
                <textarea
                  ref={taRef}
                  className="f-ta"
                  value={dreamText}
                  onChange={(e) => {
                    const v = normalizeDreamInput(e.target.value);
                    if (v.length <= MAX_DREAM_LENGTH) setDreamText(v);
                    // Правка после голоса возвращает строку статуса в обычный вид.
                    if (isDone) setRecState('idle');
                  }}
                  placeholder={t('form.placeholder')}
                  // Блокируем поле на время анализа и записи: текст, введённый
                  // после запуска, в расшифровку не попадал (bug7441201).
                  disabled={isTranscribing || loading || isRecording}
                  maxLength={MAX_DREAM_LENGTH}
                />
                {/* Пик записей — 20:00–23:00, когда сегодняшний сон уже забыт:
                    из формы до разбора доходили 59%. Снимаем «мне нечего
                    написать» — подойдёт любой запомнившийся. */}
                {!dreamText && !isTranscribing && (
                  <p className="f-hint" style={{ margin: '8px 0 0', textAlign: 'center' }}>{t('form.anyDreamHint')}</p>
                )}

                {!dreamText && !isTranscribing && !isRecording && !loading && (
                  <div className="f-chips">
                    <span className="f-chips__cap">{t('form.seedsHint')}</span>
                    {SEED_CHIPS.map((key) => (
                      <button
                        key={key}
                        type="button"
                        className="f-chip"
                        onClick={() => {
                          setDreamText(t(`form.seeds.${key}.text`));
                          mark('подсказка', key);
                          requestAnimationFrame(() => taRef.current?.focus());
                        }}
                      >
                        {t(`form.seeds.${key}.label`)}
                      </button>
                    ))}
                  </div>
                )}

                {!dreamText && !isTranscribing && getVkParams().platform !== 'desktop_web' && (
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <button
                      type="button"
                      className="f-paste"
                      onClick={async () => {
                        try {
                          const text = await navigator.clipboard.readText();
                          if (text?.trim()) setDreamText(text.slice(0, MAX_DREAM_LENGTH));
                          else showToast(t('form.errorClipboardEmpty'));
                        } catch {
                          showToast(t('form.errorClipboard'));
                        }
                      }}
                    >
                      <ClipboardDocumentIcon style={{ width: 16, height: 16, flexShrink: 0 }} />
                      {t('form.pasteFromClipboard')}
                    </button>
                  </div>
                )}

                <div className="f-status">
                  <span className={`f-status__l${enough ? ' f-status__l--ok' : ''}`}>
                    {enough && <CheckCircleIcon className="f-status__ico" />}
                    {enough
                      ? (isDone ? t('form.doneTextHint') : t('form.enoughText'))
                      : t('form.needMoreChars', { n: MIN_DREAM_LENGTH - trimmed })}
                  </span>
                  <span className={`f-status__c${dreamText.length >= MAX_DREAM_LENGTH ? ' f-status__c--max' : ''}`}>
                    {dreamText.length} / {MAX_DREAM_LENGTH}
                  </span>
                </div>
              </div>
            </EdgeCard>
          )}

          {/* ── Голосовой ввод ── */}
          {activeTab === 'voice' && micAvailable && (
            <>
              {isRecording ? (
                <div className="f-rec-card">{voiceBody}</div>
              ) : (
                <EdgeCard edge="violet" radius={22} padding="22px 18px 18px" sheen>{voiceBody}</EdgeCard>
              )}
              {isRecording && (
                <div className="f-keep">
                  <span>{t('form.voiceKeepHint')}</span>
                  <span className="f-dot" />
                  <span>{t('form.voiceKeepHint2')}</span>
                </div>
              )}
            </>
          )}

          {/* ── Главное действие ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {loading ? (
              <div className="f-loading">
                <span className="f-loading__sweep" aria-hidden />
                {ANALYSIS_STEPS[loadingStep]}
              </div>
            ) : (
              <GoldButton
                onClick={analyzeDream}
                icon={<MoonIcon style={{ width: 15, height: 15, color: '#1a0800' }} />}
                // isRecording тоже блокирует: при активной записи анализ уходил
                // без ещё не расшифрованной части (отчёт 7442961).
                disabled={isRecording || isTranscribing || !enough}
              >
                {t('form.analyze')}
              </GoldButton>
            )}
            <div className="f-hint">
              <span>{t('form.analyzeHint')}</span>
              <span className="f-dot" />
              <span>{t('form.analyzeHintTime')}</span>
            </div>
          </div>

          {/* Стоимость видна до запуска, а не только в окне оплаты (bug7441279). */}
          {!loading && freeLeft != null && (
            <div className="f-free">
              <span className="f-free__line" />
              <span className="f-free__dot" />
              <span className="f-free__t">
                {getPlatform() === 'vk' ? t('form.costHintVk', { n: freeLeft, cost: iskryCost ?? 40 }) : t('form.costHintFree', { n: freeLeft })}
              </span>
              <span className="f-free__dot f-free__dot--b" />
              <span className="f-free__line" />
            </div>
          )}
        </div>
      </div>

      {showPaywall && (
        <Paywall
          userId={userId}
          reason={t(getPlatform() === 'vk' ? 'paywall.reasonAnalysesVk' : 'paywall.reasonAnalyses')}
          oneTime
          onClose={() => setShowPaywall(false)}
          onActivated={() => { setShowPaywall(false); analyzeDream(); }}
        />
      )}
    </div>
  );
}
