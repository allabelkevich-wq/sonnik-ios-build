import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftIcon, ArrowPathIcon, ChartPieIcon, ChatBubbleLeftRightIcon, ChevronRightIcon,
  ExclamationTriangleIcon, MagnifyingGlassIcon, MoonIcon, XMarkIcon,
} from '@heroicons/react/24/solid';
import AnalysisView from './AnalysisView.jsx';
import MonthlySummaryModal from './MonthlySummaryModal.jsx';
import Chip from '../components/Chip.jsx';
import Constellation from '../components/Constellation.jsx';
import GoldButton from '../components/GoldButton.jsx';
import MoonPhase from '../components/MoonPhase.jsx';
import PillButton from '../components/PillButton.jsx';
import RoundButton from '../components/RoundButton.jsx';
import SectionLabel from '../components/SectionLabel.jsx';
import Skeleton from '../components/Skeleton.jsx';
import Tile from '../components/Tile.jsx';
import { useToast } from '../components/Toast.jsx';
import { useScrollLock } from '../hooks/useScrollLock.js';
import { formatDayMonth } from '../utils/date.js';
import { getUserId, providerCode, authHeader } from '../platform.js';
import '../styles/journal.css';
import { serverLang } from '../i18n/index.js';

const API_BASE = import.meta.env.VITE_API_URL || '';
const PAGE_SIZE = 10;
// README: итоги лунного месяца собираются от трёх снов. 15 в макете — демо-данные.
const GOAL = 3;

function formatDate(dateStr, language) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString(language === 'ru' ? 'ru-RU' : 'en-US', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

// Осмысленного заголовка записи бэкенд не отдаёт — берём первую фразу сна.
function dreamTitle(text, t) {
  const raw = (text || '').trim();
  if (!raw) return t('journal.untitled');
  const first = (raw.split(/[.!?\n]/)[0] || raw).trim() || raw;
  return first.length > 42 ? `${first.slice(0, 42).trim()}…` : first;
}

const lunarDayOf = (dream) => dream.analysis?.lunar_data?.day_number ?? dream.analysis?.lunar_data?.tithi ?? null;

function DreamCard({ dream, onClick }) {
  const { t, i18n } = useTranslation();
  const analysis = dream.analysis;
  const symbols = analysis?.symbols?.slice(0, 3) || [];
  const patternCount = analysis?.destructive_patterns?.length || 0;
  const noAnalysis = !analysis || !analysis.brief_analysis;
  const day = lunarDayOf(dream);
  const meta = formatDayMonth(dream.created_at, i18n.language)
    + (day != null ? ` · ${t('journal.lunarDayShort', { n: day })}` : '');

  return (
    <Tile
      as="button"
      onClick={onClick}
      style={{ display: 'flex', flexDirection: 'column', gap: 9, cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
        <MoonPhase date={dream.created_at} size={26} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--v3-fg)', lineHeight: 1.3, overflowWrap: 'anywhere' }}>
            {dreamTitle(dream.dream_text, t)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--v3-fg-4)', marginTop: 2 }}>{meta}</div>
        </div>
        {noAnalysis && (
          <Chip tone="neutral" size="sm" style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--v3-fg-4)', flexShrink: 0 }}>
            {t('journal.noAnalysis')}
          </Chip>
        )}
        {!noAnalysis && patternCount > 0 && (
          <Chip tone="danger" size="sm" style={{ fontSize: 10.5, fontWeight: 600, flexShrink: 0 }}>
            {t('journal.patterns', { count: patternCount })}
          </Chip>
        )}
      </div>

      {/* Реальный brief_analysis — 3–4 предложения; без обрезки карточка снова
          становится «тяжёлой». Целиком он виден в шторке. */}
      <div style={{
        fontSize: 12.5, lineHeight: 1.55, color: 'var(--v3-fg-3)',
        overflowWrap: 'anywhere', wordBreak: 'break-word',
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {analysis?.brief_analysis || t('journal.noAnalysisBrief')}
      </div>

      {symbols.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {symbols.map((s, i) => (
            <Chip key={i} tone="neutral" size="sm">{s.symbol}</Chip>
          ))}
        </div>
      )}
    </Tile>
  );
}

function DreamSheet({ dream, onClose, onChat, onFull, onRetry }) {
  const { t, i18n } = useTranslation();
  useScrollLock(true);
  const analysis = dream.analysis;
  const analysed = !!analysis?.brief_analysis;
  const day = lunarDayOf(dream);
  const meta = formatDayMonth(dream.created_at, i18n.language)
    + (day != null ? ` · ${t('journal.lunarDayLong', { n: day })}` : '');

  return (
    <div className="j-overlay" onClick={onClose}>
      <div className="j-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="j-sheet__handle" />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <MoonPhase date={dream.created_at} size={34} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15.5, fontWeight: 800, color: 'var(--v3-fg)', letterSpacing: '-.01em', overflowWrap: 'anywhere' }}>
              {dreamTitle(dream.dream_text, t)}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--v3-fg-4)', marginTop: 2 }}>{meta}</div>
          </div>
        </div>

        <div style={{ padding: '13px 14px', borderRadius: 14, background: 'var(--v3-inset)' }}>
          <div className="j-sheet__label">{t('journal.dreamText')}</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--v3-fg-2)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {dream.dream_text}
          </div>
        </div>

        <div>
          <div className="j-sheet__label j-sheet__label--gold">{t('analysis.whatSays')}</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.62, color: 'var(--v3-fg-2)', overflowWrap: 'anywhere' }}>
            {analysed ? analysis.brief_analysis : t('journal.noAnalysisDetail')}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 2 }}>
          {analysed ? (
            <>
              {onChat && (
                <PillButton
                  tone="violet"
                  size="lg"
                  onClick={() => onChat(dream)}
                  icon={<ChatBubbleLeftRightIcon style={{ width: 17, height: 17, flexShrink: 0 }} />}
                >
                  {t('journal.askOracle')}
                </PillButton>
              )}
              <PillButton size="lg" onClick={onFull}>{t('journal.openFull')}</PillButton>
            </>
          ) : (
            <>
              <GoldButton
                onClick={onRetry}
                icon={<ArrowPathIcon style={{ width: 19, height: 19 }} />}
              >
                {t('journal.retryAnalysis')}
              </GoldButton>
              <PillButton size="lg" onClick={onClose}>{t('journal.close')}</PillButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DreamDetailView({ dream, onBack, onChat }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="page">
      <header style={{ position: 'relative' }}>
        <button
          onClick={onBack}
          style={{
            position: 'absolute',
            left: 16,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'rgba(var(--fg-rgb),0.07)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(var(--fg-rgb),0.13)',
            color: 'rgba(var(--fg-rgb),0.85)',
            borderRadius: 9999,
            padding: '6px 14px',
            fontSize: 14,
            cursor: 'pointer',
            boxShadow: 'none',
            width: 'auto',
          }}
        >
          <ArrowLeftIcon style={{ width: 18, height: 18, display: 'inline-block', verticalAlign: 'middle', marginRight: 5 }} />{t('journal.back')}
        </button>
        <h1>{t('journal.dreamAnalysis')}</h1>
        <p className="subtitle">{formatDate(dream.created_at, i18n.language)}</p>
      </header>
      <div className="page-scroll">
        {/* Текст сна */}
        <div className="section" style={{
          background: 'rgba(var(--fg-rgb),0.04)',
          border: '1px solid rgba(var(--fg-rgb),0.08)',
          borderRadius: 14,
        }}>
          <p style={{ fontSize: 13, color: 'rgba(var(--fg-rgb),0.65)', marginBottom: 6, fontWeight: 600 }}>
            {t('journal.dreamText')}
          </p>
          <p style={{ fontSize: 14, color: 'rgba(var(--fg-rgb),0.85)', lineHeight: 1.6, overflowWrap: 'anywhere', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
            {dream.dream_text}
          </p>
        </div>

        <AnalysisView analysis={dream.analysis} />

        {dream.analysis && onChat && (
          <div className="section" style={{ textAlign: 'center' }}>
            <button
              onClick={() => onChat(dream)}
              style={{
                background: 'rgba(147,51,234,0.1)',
                backdropFilter: 'blur(16px)',
                color: 'var(--purple-text)',
                border: '1px solid rgba(147,51,234,0.35)',
                borderRadius: 9999,
                boxShadow: 'none',
              }}
            >
              <ChatBubbleLeftRightIcon style={{ width: 20, height: 20, display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }} />
              {t('journal.askOracle')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function JournalPage({ onBack, onChat, onAnalyze, initialDream }) {
  const { t, i18n } = useTranslation();
  const showToast = useToast();
  const [dreams, setDreams] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  // Первая страница ещё не отвечала — держим скелетоны, иначе между первым
  // кадром и стартом эффекта мигает «Дневник пока пуст».
  const [fetched, setFetched] = useState(false);
  const [error, setError] = useState(false);
  const [total, setTotal] = useState(null);
  const [lunar, setLunar] = useState(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  // initialDream — сон, из которого ушли к оракулу: при возврате открываем его
  // шторку, а не голый список (отчёт 7443387). Передаём объект, а не id: сон
  // может быть за пределами первой загруженной страницы.
  const [detail, setDetail] = useState(initialDream || null);
  const [selectedDream, setSelectedDream] = useState(null);
  const [showSummary, setShowSummary] = useState(false);

  const userId = getUserId();

  const loadDreams = async (fromOffset) => {
    if (!userId || loading) return;
    setLoading(true);
    if (fromOffset === 0) setError(false);
    try {
      const res = await fetch(`${API_BASE}/api/user/${userId}/dreams?limit=${PAGE_SIZE}&offset=${fromOffset}&provider=${providerCode()}`, {
        headers: await authHeader(),
      });
      if (!res.ok) throw new Error('Ошибка загрузки');
      const raw = await res.json();
      // API возвращает analyses[] — берём первый элемент как analysis
      // JSONB-поля Supabase может вернуть строками — парсим при необходимости
      const data = raw.map(d => {
        let analysis = Array.isArray(d.analyses) ? (d.analyses[0] || null) : (d.analysis || null);
        if (analysis) {
          const jsonFields = ['symbols', 'destructive_patterns', 'transformations', 'recommendations', 'lunar_data', 'ritual_reprogramming'];
          for (const field of jsonFields) {
            if (typeof analysis[field] === 'string') {
              try { analysis[field] = JSON.parse(analysis[field]); } catch {}
            }
          }
        }
        return { ...d, analysis };
      });
      setDreams(prev => fromOffset === 0 ? data : [...prev, ...data]);
      if (data.length < PAGE_SIZE) setHasMore(false);
    } catch (e) {
      console.error('Ошибка загрузки снов:', e);
      // Первая страница — карточка ошибки на весь экран, догрузка — тост:
      // список уже на месте и никуда не пропал.
      if (fromOffset === 0) setError(true);
      else showToast(t('journal.errorTitle'));
    } finally {
      setLoading(false);
      setFetched(true);
    }
  };

  useEffect(() => {
    loadDreams(0);
  }, []);

  // Общее число записей — из существующей статистики (в ответе /dreams его нет).
  // Тихо: подпись просто останется по загруженным страницам, если запрос не удался.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    authHeader().then((headers) => {
      fetch(`${API_BASE}/api/user/${userId}/stats?provider=${providerCode()}`, { headers })
        .then(r => r.json())
        .then(d => { if (!cancelled && typeof d.total_dreams === 'number') setTotal(d.total_dreams); })
        .catch(() => {});
    });
    return () => { cancelled = true; };
  }, [userId]);

  // Лунный день сегодня — чтобы отсчитать начало текущего лунного месяца
  // для полосы прогресса в закрывающей карточке. Эндпоинт публичный.
  useEffect(() => {
    let cancelled = false;
    const tz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
    fetch(`${API_BASE}/api/lunar/today?lang=${serverLang()}${tz ? `&timezone=${encodeURIComponent(tz)}` : ''}`)
      .then(r => r.json())
      .then(d => { if (!cancelled && d.day_number) setLunar(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const q = query.trim().toLowerCase();

  const matched = useMemo(() => dreams.filter(d => {
    const a = d.analysis;
    if (filter === 'patterns' && !(a?.destructive_patterns?.length > 0)) return false;
    if (filter === 'none' && a?.brief_analysis) return false;
    if (!q) return true;
    const hay = [
      dreamTitle(d.dream_text, t),
      d.dream_text,
      a?.brief_analysis,
      ...(a?.symbols || []).map(s => s.symbol),
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }), [dreams, filter, q, t]);

  // Группировка по календарному месяцу created_at; сервер отдаёт записи по
  // убыванию даты, поэтому месяц идёт сплошным куском.
  const groups = useMemo(() => {
    const out = [];
    matched.forEach(d => {
      const date = new Date(d.created_at);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(d);
      else out.push({ key, date, items: [d] });
    });
    return out;
  }, [matched]);

  // Начало лунного месяца ≈ полночь (сегодня − (лунный день − 1)); без ответа
  // /lunar/today считаем за последние 30 дней. Точности хватает для полосы.
  const recorded = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((lunar?.day_number || 30) - 1));
    return dreams.filter(d => new Date(d.created_at) >= start).length;
  }, [dreams, lunar]);

  const totalKnown = total ?? dreams.length;
  const firstLoad = !!userId && !fetched && dreams.length === 0;
  const isEmpty = !!userId && fetched && !error && dreams.length === 0;
  const noMatch = dreams.length > 0 && matched.length === 0;
  const showControls = !!userId && dreams.length > 0;

  const countLabel = !userId ? ''
    : firstLoad ? t('common.loading')
    : error && dreams.length === 0 ? t('journal.loadFailed')
    : isEmpty ? t('journal.noRecords')
    : (q || filter !== 'all') ? t('journal.found', { count: matched.length })
    : t('journal.records', { count: totalKnown });

  const monthName = (date) => date.toLocaleDateString(i18n.language === 'ru' ? 'ru-RU' : 'en-US', { month: 'long' });

  if (showSummary) {
    return <MonthlySummaryModal onClose={() => setShowSummary(false)} />;
  }

  if (selectedDream) {
    return <DreamDetailView dream={selectedDream} onBack={() => setSelectedDream(null)} onChat={onChat} />;
  }

  const filters = [
    ['all', t('journal.filterAll')],
    ['patterns', t('journal.filterPatterns')],
    ['none', t('journal.filterNoAnalysis')],
  ];

  const loadMoreButton = hasMore && !firstLoad && (
    <PillButton
      onClick={() => loadDreams(dreams.length)}
      disabled={loading}
      style={{ marginTop: 2 }}
    >
      {loading ? t('common.loading') : (
        <>
          {t('journal.loadMore')}
          {total != null && (
            <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--v3-fg-4)', marginLeft: 8 }}>
              {t('journal.shownOf', { shown: dreams.length, total })}
            </span>
          )}
        </>
      )}
    </PillButton>
  );

  return (
    <div className="page">
      {/* Экран без <header>: верхний отступ safe-area обязан быть свой, иначе
          «назад» и лупа уезжают под статус-бар и плавающие кнопки VK на
          iPhone (грабли 01.09) — 47 инсета + 40 дают 9pt воздуха. */}
      <div style={{
        flexShrink: 0,
        padding: 'var(--v3-top) 18px 12px',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <RoundButton onClick={onBack} label={t('journal.back')}>
            <ArrowLeftIcon style={{ width: 17, height: 17 }} />
          </RoundButton>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--v3-fg)', lineHeight: 1.2 }}>
              {t('journal.title')}
            </div>
            {countLabel && (
              <div style={{ fontSize: 12, color: 'var(--v3-fg-3)', marginTop: 2 }}>{countLabel}</div>
            )}
          </div>
          {showControls && (
            <RoundButton
              label={t('journal.search')}
              onClick={() => {
                setSearchOpen(open => {
                  if (open) setQuery('');
                  return !open;
                });
              }}
              style={searchOpen ? {
                background: 'var(--v3-chip-g)',
                borderColor: 'var(--v3-chip-g-br)',
                color: 'var(--v3-gold-txt)',
              } : undefined}
            >
              <MagnifyingGlassIcon style={{ width: 17, height: 17 }} />
            </RoundButton>
          )}
        </div>

        {showControls && searchOpen && (
          <div className="j-search">
            <MagnifyingGlassIcon style={{ width: 16, height: 16, flexShrink: 0, color: 'var(--v3-fg-4)' }} />
            <input
              className="j-search__input"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('journal.searchPlaceholder')}
            />
            {query && (
              <button type="button" className="j-clear" aria-label={t('journal.clearSearch')} onClick={() => setQuery('')}>
                <span className="j-clear__in"><XMarkIcon style={{ width: 12, height: 12 }} /></span>
              </button>
            )}
          </div>
        )}

        {showControls && (
          <div className="j-filters">
            {filters.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={filter === key ? 'j-filter j-filter--on' : 'j-filter'}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="page-scroll" style={{ padding: '0 18px calc(env(safe-area-inset-bottom, 0px) + 26px)' }}>
        {!userId && (
          <p style={{ padding: '44px 18px 0', textAlign: 'center', fontSize: 14, color: 'var(--v3-fg-3)' }}>
            {t('journal.onlyTelegram')}
          </p>
        )}

        {firstLoad && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                borderRadius: 20, border: '1px solid var(--v3-tile-br)', background: 'var(--v3-tile)',
                padding: '15px 16px', display: 'flex', flexDirection: 'column', gap: 10,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Skeleton width={96} height={11} radius={5} />
                  <Skeleton width={64} height={11} radius={5} />
                </div>
                <Skeleton height={13} />
                <Skeleton width="78%" height={13} />
                <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                  <Skeleton width={58} height={20} radius={999} />
                  <Skeleton width={72} height={20} radius={999} />
                </div>
              </div>
            ))}
          </div>
        )}

        {error && dreams.length === 0 && (
          <div style={{
            borderRadius: 22, border: '1px solid var(--v3-danger-br)', background: 'var(--v3-danger-bg)',
            padding: '28px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 13, textAlign: 'center',
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: '50%', flexShrink: 0,
              background: 'var(--v3-danger-chip)', border: '1px solid var(--v3-danger-br)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <ExclamationTriangleIcon style={{ width: 26, height: 26, color: 'var(--v3-danger)' }} />
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--v3-fg)' }}>{t('journal.errorTitle')}</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--v3-fg-3)', maxWidth: 255 }}>
              {t('journal.errorHint')}
            </div>
            <PillButton tone="violet" onClick={() => loadDreams(0)} style={{ height: 46 }}>
              {t('common.offlineRetry')}
            </PillButton>
          </div>
        )}

        {isEmpty && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
            padding: '44px 18px 0', textAlign: 'center',
          }}>
            <MoonPhase date={new Date()} size={78} style={{ opacity: .9 }} />
            <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--v3-fg)' }}>{t('journal.empty')}</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--v3-fg-3)', maxWidth: 260 }}>
              {t('journal.emptyHint')}
            </div>
            <GoldButton
              onClick={onAnalyze}
              icon={<MoonIcon style={{ width: 19, height: 19 }} />}
              style={{ marginTop: 4 }}
            >
              {t('home.analyzeDream')}
            </GoldButton>
            <div style={{ fontSize: 11.5, color: 'var(--v3-fg-4)' }}>
              {`${t('home.analyzeHint')} · ${t('home.analyzeHintTime')}`}
            </div>
          </div>
        )}

        {noMatch && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 11,
              padding: '40px 18px 0', textAlign: 'center',
            }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--v3-fg)' }}>{t('journal.nothingFound')}</div>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--v3-fg-3)', maxWidth: 250 }}>
                {q ? t('journal.noMatchQuery', { q: query.trim() }) : t('journal.noMatchFilter')}
              </div>
              <PillButton
                size="sm"
                onClick={() => { setQuery(''); setFilter('all'); }}
                style={{ width: 'auto', padding: '0 20px' }}
              >
                {t('journal.resetFilters')}
              </PillButton>
            </div>
            {/* Поиск идёт только по загруженным страницам: без догрузки старый
                сон не найти, и подсказка становится тупиковой. */}
            {loadMoreButton}
          </div>
        )}

        {matched.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {groups.map(group => (
              <div key={group.key} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <SectionLabel
                  title={monthName(group.date)}
                  right={t('journal.records', { count: group.items.length })}
                  style={{ padding: '6px 0 2px' }}
                />
                {group.items.map(d => (
                  <DreamCard key={d.id} dream={d} onClick={() => setDetail(d)} />
                ))}
              </div>
            ))}

            {loadMoreButton}

            <Constellation twinkle={false} style={{ marginTop: 4 }} />

            <Tile
              as="button"
              onClick={() => setShowSummary(true)}
              padding="16px"
              style={{
                background: 'var(--v3-closing)', borderColor: 'var(--v3-chip-g-br)',
                display: 'flex', flexDirection: 'column', gap: 12, cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 13, flexShrink: 0,
                  background: 'var(--v3-chip-p)', border: '1px solid var(--v3-chip-p-br)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <ChartPieIcon style={{ width: 19, height: 19, color: 'var(--v3-purple-txt)' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--v3-fg)' }}>{t('journal.summaryTitle')}</div>
                  <div style={{ fontSize: 12, color: 'var(--v3-fg-3)', marginTop: 2 }}>
                    {recorded >= GOAL
                      ? t('journal.summaryReady')
                      : t('journal.summaryProgress', { n: recorded, goal: GOAL, count: GOAL - recorded })}
                  </div>
                </div>
                <ChevronRightIcon style={{ width: 14, height: 14, flexShrink: 0, color: 'var(--v3-gold-txt)' }} />
              </div>
              <div style={{ height: 6, width: '100%', borderRadius: 999, background: 'var(--v3-inset)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 999,
                  width: `${Math.min(100, Math.round(recorded / GOAL * 100))}%`,
                  background: 'linear-gradient(90deg,#f5a623,#c97a10)',
                }} />
              </div>
            </Tile>
          </div>
        )}
      </div>

      {detail && (
        <DreamSheet
          dream={detail}
          onClose={() => setDetail(null)}
          onChat={onChat}
          onFull={() => { setSelectedDream(detail); setDetail(null); }}
          onRetry={onAnalyze}
        />
      )}
    </div>
  );
}
