import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import HomePage from './pages/HomePage.jsx';
import FormPage from './pages/FormPage.jsx';
import SuccessPage from './pages/SuccessPage.jsx';
import OnboardingPage from './pages/OnboardingPage.jsx';

// Путь до первого сна — согласие, онбординг, главная, форма, разбор — грузится
// сразу. Остальные экраны приезжают, когда человек на них заходит: после
// редизайна бандл вырос с 433 до 631 КБ (стили в семь раз), а на мобильном
// интернете каждые лишние 200 КБ — это примерно четыре секунды до первой
// кнопки. Замер 06.09: до кнопки 6,4 с на 3G.
const ProfilePage = lazy(() => import('./pages/ProfilePage.jsx'));
const JournalPage = lazy(() => import('./pages/JournalPage.jsx'));
const HairCalendarPage = lazy(() => import('./pages/HairCalendarPage.jsx'));
const LunarDayPage = lazy(() => import('./pages/LunarDayPage.jsx'));
const ChatPage = lazy(() => import('./pages/ChatPage.jsx'));
import { setLanguage } from './i18n/index.js';
import { useTheme } from './theme/useTheme.js';
import { getPlatform, isVkMobileNative, getVkParams } from './platform.js';
import { useHideToast } from './components/Toast.jsx';
import { pulse } from './utils/pulse.js';
import { ensureMorningReminder } from './utils/reminders.js';

export default function App() {
  useTheme();
  const { t, i18n } = useTranslation();
  const hideToast = useHideToast();
  const sawOnboarding = typeof localStorage !== 'undefined' && localStorage.getItem('dw_onboarded');
  // Стек экранов вместо одного «текущего»: «назад» обязан возвращать туда,
  // откуда пришли. Раньше каждый экран сам решал, куда уйти по «назад», и почти
  // все были прибиты к главной — из дневника, открытого с результата анализа,
  // «назад» уводил на главную (отчёт 7451943).
  const [pageStack, setPageStack] = useState([sawOnboarding ? 'home' : 'onboarding']);
  const currentPage = pageStack[pageStack.length - 1];
  const [userData, setUserData] = useState(null);
  const [lastAnalysis, setLastAnalysis] = useState(null);
  const [chatDreamData, setChatDreamData] = useState(null);
  const [pageKey, setPageKey] = useState(0);
  const [isVkTablet, setIsVkTablet] = useState(false);
  // Не доверяем navigator.onLine на старте: в вебвью VK он врёт и показывал
  // «нет интернета» при живом 4G, полностью закрывая приложение (отчёт 7443458).
  const [isOffline, setIsOffline] = useState(false);
  const retryRef = useRef(null); // проверка связи — дёргается кнопкой «Повторить»
  const [journalDream, setJournalDream] = useState(null); // сон, открытый перед уходом к оракулу

  useEffect(() => {
    if (getPlatform() !== 'vk' || !isVkMobileNative()) return;
    // Планшеты (iPad/Android ≥768px по меньшей стороне) внутри VK нативных
    // клиентов — макет под них не оптимизирован, показываем заглушку.
    const check = () => setIsVkTablet(Math.min(window.innerWidth, window.innerHeight) >= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    // Событие 'offline' — только повод перепроверить, а не приговор: в вебвью VK
    // оно приходит при живой сети. Решает реальный запрос к своему серверу.
    // Пока оверлей висит, опрашиваем дальше и снимаем его сами, как только связь
    // вернулась, — короткий обрыв не должен требовать перезапуска (правила VK 2.2.4).
    let stopped = false;
    let timer = null;

    const reachable = async () => {
      try {
        const ctrl = new AbortController();
        const kill = setTimeout(() => ctrl.abort(), 4000);
        await fetch(`${import.meta.env.VITE_API_URL || ''}/health?t=${Date.now()}`,
          { cache: 'no-store', signal: ctrl.signal });
        clearTimeout(kill);
        return true;
      } catch {
        return false;
      }
    };

    const recheck = async () => {
      if (stopped) return;
      const ok = await reachable();
      if (stopped) return;
      setIsOffline(!ok);
      // Не достучались — продолжаем проверять, чтобы снять оверлей самим.
      timer = ok ? null : setTimeout(recheck, 5000);
    };

    retryRef.current = () => { clearTimeout(timer); recheck(); };
    const onOffline = () => { clearTimeout(timer); recheck(); };
    const onOnline = () => { clearTimeout(timer); setIsOffline(false); };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    // Стартовый navigator.onLine=false тоже перепроверяем, а не верим на слово.
    if (typeof navigator !== 'undefined' && !navigator.onLine) recheck();
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;
      tg.ready();
      tg.expand();
      const init = tg.initDataUnsafe;
      if (init?.user) {
        setUserData(init.user);
        // Sync language with Telegram user's language
        const tgLang = init.user.language_code || '';
        const lang = tgLang.startsWith('en') ? 'en' : 'ru';
        if (lang !== i18n.language && !localStorage.getItem('dw_lang')) {
          setLanguage(lang);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (getPlatform() !== 'vk') return;
    // Класс для VK-специфичных CSS-правил из чек-листа модерации
    // (user-select: none и т.п. — см. globals.css).
    document.documentElement.classList.add('is-vk');
    import('@vkontakte/vk-bridge').then(({ default: vkBridge }) => {
      // VKWebAppInit сигнализирует VK, что приложение загрузилось — до этого
      // вызова VK держит собственный загрузочный спиннер поверх приложения.
      vkBridge.send('VKWebAppInit').catch(() => {});
      // Свайп-назад на iOS внутри VK работает только если явно включить его
      // через VK Bridge — иначе жест конфликтует с навигацией VK-клиента.
      vkBridge.send('VKWebAppSetSwipeSettings', { history: true }).catch(() => {});
    });
  }, []);

  // Откуда человек пришёл: ВК кладёт источник в vk_ref (каталог, меню
  // сообщества, сниппет, поиск). Без него падение входов с 1800 до 110 в день
  // (11.09) нечем объяснить: в базе видно только «пришёл из ВК».
  useEffect(() => { pulse('старт', getVkParams().ref.slice(0, 24) || undefined); }, []);

  // На iOS локальное напоминание — не серверная рассылка (Telegram-бот
  // Apple-пользователей не видит, см. utils/reminders.js). На каждом запуске
  // переставляем его заново (идемпотентно), если оно было включено и
  // разрешение всё ещё есть — иначе оно могло бы потеряться молча.
  useEffect(() => {
    if (getPlatform() === 'ios') ensureMorningReminder(i18n.language);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const navigateTo = (page) => {
    setPageStack((s) => (s[s.length - 1] === page ? s : [...s, page]));
    setPageKey(k => k + 1);
    hideToast?.(); // тост не должен «переезжать» между разделами (репорт Ольги)
    window.scrollTo(0, 0);
  };

  // Назад — только по своему стеку. К истории браузера не обращаемся: вызов
  // history.back() на iOS уводил вебвью за пределы приложения, и вместо
  // предыдущего экрана оставался чёрный лист (отчёт 7457238).
  const goBack = () => {
    setPageStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
    setPageKey(k => k + 1);
    window.scrollTo(0, 0);
  };

  // Одна «страховочная» запись в истории на всё приложение. Свайп-назад
  // (SetSwipeSettings history:true) съедает её — мы возвращаем экран и кладём
  // запись обратно. На корневом экране не возвращаем: пусть VK закроет
  // приложение, как и ждёт пользователь.
  const stackRef = useRef(pageStack);
  stackRef.current = pageStack;

  useEffect(() => {
    try { window.history.pushState({ dw: 1 }, ''); } catch (_) {}
    const onPop = () => {
      if (stackRef.current.length <= 1) return;
      try { window.history.pushState({ dw: 1 }, ''); } catch (_) {}
      setPageStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
      setPageKey(k => k + 1);
      window.scrollTo(0, 0);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Результат анализа и чат оракула живут на данных из состояния. Если экран
  // всплыл без них (перезапуск приложения, восстановление истории) — не держим
  // пустой экран, а снимаем его со стека.
  useEffect(() => {
    const orphan = (currentPage === 'success' && !lastAnalysis)
      || (currentPage === 'chat' && !chatDreamData);
    if (orphan) setPageStack((s) => (s.length > 1 ? s.slice(0, -1) : ['home']));
  }, [currentPage, lastAnalysis, chatDreamData]);

  const openChat = (dreamData) => {
    setChatDreamData(dreamData);
    navigateTo('chat');
  };

  // Сон, из которого ушли к оракулу: по «назад» дневник открывает его разбор,
  // а не список (отчёт 7443387). При обычном заходе в дневник — сбрасываем.
  const openJournal = (dream = null) => {
    setJournalDream(dream);
    navigateTo('journal');
  };

  if (isVkTablet) {
    return (
      <div className="App" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', padding: 24 }}>
        <p style={{ textAlign: 'center', fontSize: 15, color: 'rgba(var(--fg-rgb),0.6)', lineHeight: 1.6 }}>
          {t('common.tabletStub')}
        </p>
      </div>
    );
  }

  return (
    <div className="App">
      {isOffline && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 999,
          background: 'var(--overlay-strong)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div style={{
            maxWidth: 320, width: '100%', textAlign: 'center',
            background: 'var(--card-bg, rgba(var(--fg-rgb),0.06))',
            border: '1px solid rgba(var(--fg-rgb),0.12)',
            borderRadius: 18, padding: '26px 22px',
          }}>
            <p style={{ fontSize: 15, color: 'var(--fg)', lineHeight: 1.6, margin: '0 0 18px' }}>
              {t('common.offline')}
            </p>
            <button
              onClick={() => retryRef.current?.()}
              style={{
                width: '100%', padding: '13px 20px', borderRadius: 999, border: 'none',
                background: 'linear-gradient(135deg, var(--primary-color), var(--secondary-color))',
                color: 'var(--on-primary, #1a1a1a)', fontSize: 15, fontWeight: 600,
                fontFamily: 'inherit', cursor: 'pointer',
              }}
            >
              {t('common.offlineRetry')}
            </button>
          </div>
        </div>
      )}
      {/* Пока отложенный экран едет по сети, держим пустой фон того же цвета:
          спиннер на долю секунды мигает хуже, чем тишина. */}
      <Suspense fallback={<div className="page" aria-busy="true" />}>
      <div key={pageKey} className="page-transition">
        {/* Кнопка онбординга обещает «Начать расшифровку» — и ведёт прямо в форму,
            минуя главную: за сутки 07.09 из 570 человек на главной до формы дошли
            306. «Назад» из формы — на главную, как и у всех. Согласие с офертой
            и политикой даёт та же кнопка (подпись под ней), отдельного экрана нет. */}
        {currentPage === 'onboarding' && <OnboardingPage onNext={() => {
          localStorage.setItem('dw_onboarded', '1');
          localStorage.setItem('dw_consent_accepted', '1');
          setPageStack(['home', 'form']);
          setPageKey(k => k + 1);
          window.scrollTo(0, 0);
        }} />}
        {currentPage === 'home' && <HomePage onAnalyze={() => navigateTo('form')} onProfile={() => navigateTo('profile')} onJournal={() => openJournal()} onHairCalendar={() => navigateTo('hair-calendar')} onLunarDay={() => navigateTo('lunarday')} />}
        {currentPage === 'form' && (
          <FormPage
            onSuccess={() => navigateTo('success')}
            onBack={goBack}
            onAnalysis={setLastAnalysis}
          />
        )}
        {currentPage === 'profile' && <ProfilePage onBack={goBack} />}
        {currentPage === 'journal' && (
          <JournalPage
            initialDream={journalDream}
            onBack={goBack}
            onAnalyze={() => navigateTo('form')}
            onChat={(dream) => { setJournalDream(dream); openChat({ dream_text: dream.dream_text, analysis: dream.analysis, dream_id: dream.id, created_at: dream.created_at }); }}
          />
        )}
        {currentPage === 'hair-calendar' && <HairCalendarPage onBack={goBack} onProfile={() => navigateTo('profile')} />}
        {currentPage === 'lunarday' && (
          <LunarDayPage
            onBack={goBack}
            onAnalyze={() => navigateTo('form')}
            onOpenDream={(dream) => openJournal(dream)}
          />
        )}
        {currentPage === 'chat' && chatDreamData && (
          <ChatPage dreamData={chatDreamData} onBack={goBack} />
        )}
        {currentPage === 'success' && (
          <SuccessPage
            analysis={lastAnalysis}
            onNewDream={() => navigateTo('form')}
            onHome={() => navigateTo('home')}
            onJournal={() => openJournal()}
            onChat={() => openChat({ dream_text: lastAnalysis?.dream_text || '', analysis: lastAnalysis, dream_id: null, created_at: new Date().toISOString() })}
          />
        )}
      </div>
      </Suspense>
    </div>
  );
}
