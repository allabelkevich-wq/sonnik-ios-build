import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MoonIcon, SparklesIcon, BookOpenIcon, CheckIcon } from '@heroicons/react/24/solid';
import { getPlatform, getUserId, providerCode, authHeader, isVkMobileNative } from '../platform.js';
import { useScrollLock } from '../hooks/useScrollLock.js';
import { usePremiumPurchase } from '../hooks/usePremiumPurchase.js';
import { pulsePay } from '../utils/pulse.js';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Порядок отображения пакетов Искр (выгодный — по центру, выделен).
const ISKRY_PACK_ORDER = ['iskry_pack_80', 'iskry_pack_240', 'iskry_pack_600', 'iskry_pack_1200'];

export default function Paywall({ userId, reason, onClose, onActivated, oneTime }) {
  const { t } = useTranslation();
  const PLAN_META = {
    // Разовая расшифровка одного сна — низкий порог входа, показывается только
    // на экране анализа (oneTime) и только вне VK (на VK разовый идёт за Искры).
    single_analysis: { label: t('paywall.planOneTime'), oneTime: true },
    premium_monthly: { label: t('paywall.planMonth'), period: t('paywall.planMonthPeriod') },
    premium_yearly: { label: t('paywall.planYear'), period: t('paywall.planYearPeriod'), badge: t('paywall.planYearBadge') },
  };
  const BENEFITS = t('paywall.benefits', { returnObjects: true });
  const [plans, setPlans] = useState(null);
  const [iskry, setIskry] = useState(null);       // { balance, packs, cost } — только VK
  const [selected, setSelected] = useState('premium_yearly');
  const [busyPack, setBusyPack] = useState('');   // sku пакета Искр в процессе оплаты
  // Окно заказа ВК сорвалось не по нашей вине — предлагаем пополнить голоса.
  // 08.09: на айфоне пакеты голосов внутри клиента ВК приходят с ошибкой вместо
  // цены, на андроиде ВК отдаёт «превышен лимит запросов». В обоих случаях
  // голоса покупаются на странице настроек ВК, и дальше заказ проходит.
  const [needVotes, setNeedVotes] = useState(false);
  // §5.4.1: в нативных клиентах iOS/Android нельзя ни платить, ни подсказывать,
  // где заплатить, — отказ ВК 10.07.2026 у Оракула пришёл ровно за подсказку.
  // Ссылку на пополнение показываем только в вебе ВК; платформа неизвестна —
  // молчим.
  const canShowVotesLink = getPlatform() === 'vk' && !isVkMobileNative();
  const [notice, setNotice] = useState('');       // нейтральное сообщение (не ошибка)
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoError, setPromoError] = useState('');
  const [promoDone, setPromoDone] = useState('');
  const [dragY, setDragY] = useState(0);          // свайп-закрытие шторки
  const [dragging, setDragging] = useState(false);
  const dragStartY = useRef(0);

  // Пока шторка открыта — блокируем прокрутку фона (bug7438798).
  useScrollLock(true);

  // Платформа определяется автоматически: Telegram / VK / web.
  const platform = getPlatform();
  const provider = providerCode();               // 'tg' | 'vk'
  const uid = userId || getUserId();              // telegram id или vk_user_id
  // На VK продаём ТОЛЬКО Искры (виртуальная валюта за Голоса, §5.2) — работает
  // на всех платформах VK включая нативные мобильные клиенты. Карты/подписки/
  // Stars на VK нет вообще (иначе §5.2.5 «двойная касса»). TG/Web — подписка.
  const isVk = platform === 'vk';
  // Приложение из App Store: платить можно только через App Store (правило
  // Apple 3.1.1) — ни Stars, ни карты, ни цен в рублях там быть не должно.
  const isIos = platform === 'ios';

  // Stars и карта Т-Банк — общий хук со шагом «Тариф» в онбординге.
  // Stars: openInvoice говорит 'paid' раньше, чем вебхук начислит подписку или
  // кредит разбора. Если закрыть стену сразу, форма тут же упрётся в неё снова.
  // Ждём подтверждения сервера, как VK-ветка ждёт роста Искр.
  const creditsRef = useRef(0);
  const waitForAccess = async (before, attempts) => {
    for (let i = 0; i < attempts; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const d = await fetchStatus().catch(() => null);
      if (d?.active || (d?.credits ?? 0) > before) return true;
    }
    return false;
  };
  const { buy, payCard, buyInApp, restoreInApp, storeProducts, loadStoreProducts, buying, cardBuying, error, setError } = usePremiumPurchase({
    uid,
    onPaid: async () => {
      await waitForAccess(creditsRef.current, 8);
      onActivated?.(); onClose?.();
    },
  });
  // Цены App Store — в валюте человека, их знает только StoreKit.
  useEffect(() => { if (isIos) loadStoreProducts(); }, [isIos, uid]); // eslint-disable-line react-hooks/exhaustive-deps
  const [restoring, setRestoring] = useState(false);
  const restore = async () => {
    setRestoring(true); setNotice(''); setError('');
    try {
      await restoreInApp();
      const d = await fetchStatus();
      if (d?.active) { onActivated?.(); onClose?.(); }
      else setNotice(t('paywall.restoreNone'));
    } catch (_) {
      setError(t('paywall.errorStore'));
    } finally {
      setRestoring(false);
    }
  };

  const fetchStatus = async () => {
    const headers = await authHeader();
    const d = await fetch(`${API_BASE}/api/user/${uid || 0}/subscription?provider=${provider}`, { headers }).then(r => r.json());
    if (d && d.plans) setPlans(d.plans);
    if (d && d.iskry) setIskry(d.iskry);
    if (d && typeof d.credits === 'number') creditsRef.current = d.credits;
    return d;
  };
  const loadCatalog = () => {
    setCatalogFailed(false);
    fetchStatus().then((d) => { if (!d || !d.iskry) setCatalogFailed(true); })
      .catch(() => setCatalogFailed(true));
  };
  useEffect(() => { loadCatalog(); }, [uid, provider]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Промокод: начисление Искр ───
  // Промокод даёт Искры, поэтому показываем его только там, где Искры тратятся
  // (VK). На TG/Web контент открывает подписка, и начисленные Искры пролежали бы
  // мёртвым грузом — обещать было бы нечестно.
  const applyPromo = async () => {
    const code = promoCode.trim().toUpperCase();
    if (!code || promoBusy) return;
    setPromoBusy(true);
    setPromoError('');
    setPromoDone('');
    try {
      const headers = await authHeader();
      const res = await fetch(`${API_BASE}/api/promo/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setPromoError(data.error || t('paywall.promoError')); return; }
      setPromoDone(t('paywall.promoOk', { n: data.iskry }));
      setPromoCode('');
      await fetchStatus().catch(() => {});
      onActivated?.();
    } catch (_) {
      setPromoError(t('paywall.promoError'));
    } finally {
      setPromoBusy(false);
    }
  };

  // Оплата уводит из приложения (нативное окно VK), и колбэк может дойти позже
  // нашего опроса. При возврате перечитываем баланс, чтобы не показывать старый
  // (отчёт 7443309).
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) fetchStatus().catch(() => {}); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [uid, provider]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ждём, пока серверный колбэк VK начислит Искры: баланс растёт не сразу.
  // Возвращает true, как только баланс превысил дооплатный.
  const waitForIskryGrowth = async (before, attempts) => {
    for (let i = 0; i < attempts; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const d = await fetchStatus().catch(() => null);
      if (d?.iskry && d.iskry.balance > before) return true;
    }
    return false;
  };

  // ─── VK: покупка пакета Искр за Голоса (§5.2, работает и на нативе) ───
  const buyIskryPack = async (sku) => {
    setError('');
    setNotice('');
    if (!uid) { setError(t('paywall.errorNoIdentity')); return; }
    setBusyPack(sku);
    setNeedVotes(false);
    const before = iskry?.balance ?? 0;
    try {
      const vkBridge = (await import('@vkontakte/vk-bridge')).default;
      // VK покажет нативное окно оплаты Голосами; цену вернёт наш get_item-колбэк.
      // Таймаут ДЛИННЫЙ (90с): промис висит, пока юзер думает в открытом окне, —
      // короткий race ломал бы легитимную оплату. Это страховка от мёртвого
      // бриджа, чтобы кнопки не остались заблокированными навсегда.
      pulsePay('окно', sku);
      const TIMEOUT = Symbol('orderbox-timeout');
      const r = await Promise.race([
        vkBridge.send('VKWebAppShowOrderBox', { type: 'item', item: sku }),
        new Promise((resolve) => setTimeout(() => resolve(TIMEOUT), 90000)),
      ]);
      if (r === TIMEOUT) {
        // Если оплата всё же завершится — колбэк начислит, баланс подтянется.
        setBusyPack('');
        setNotice(t('paywall.iskryPending'));
        return;
      }
      // Начисление Искр — серверным колбэком VK (order_status_change), он
      // асинхронен → поллим баланс, пока не вырастет.
      const grown = await waitForIskryGrowth(before, 12);
      setBusyPack('');
      pulsePay(grown ? 'начислено' : 'ждём-колбэк');
      if (grown) { onActivated?.(); onClose?.(); }
      else setNotice(t('paywall.iskryPending'));
    } catch (e) {
      setBusyPack('');
      // Отмену юзера (закрыл окно оплаты) не показываем как ошибку; реальный
      // сбой — показываем, иначе кнопка молча «мигает» (тема отказа 14.07).
      const reason = String(e?.error_data?.error_reason || e?.error_type || '');
      const code = e?.error_data?.error_code;
      pulsePay('отказ', `код=${code ?? '-'} ${reason.slice(0, 30)}`);
      if (code === 4 || /denied|cancel/i.test(reason)) {
        // «Отмена» ≠ платёж не прошёл: если закрыть окно обработки сразу после
        // «Оплатить», VK рапортует отмену, а оплата доходит и колбэк начисляет
        // Искры. Раньше мы молча выходили, и баланс оставался старым
        // (отчёт 7443309). Досматриваем баланс молча, без ошибок на экране.
        if (await waitForIskryGrowth(before, 8)) { onActivated?.(); onClose?.(); }
        return;
      }
      setError(t('paywall.errorIskryOrder'));
      setNeedVotes(true);
    }
  };

  // Свайп вниз закрывает шторку, но только когда её контент прокручен к верху
  // (иначе жест листает содержимое). Во время оплаты (busyPack) не закрываем.
  const onSheetTouchStart = (e) => {
    if (busyPack || e.currentTarget.scrollTop > 0) { setDragging(false); return; }
    dragStartY.current = e.touches[0].clientY;
    setDragging(true);
  };
  const onSheetTouchMove = (e) => {
    if (!dragging) return;
    const dy = e.touches[0].clientY - dragStartY.current;
    if (dy > 0) setDragY(dy);
  };
  const onSheetTouchEnd = () => {
    if (!dragging) return;
    setDragging(false);
    if (dragY > 90) onClose?.();
    setDragY(0);
  };

  const priceFor = (sku) => plans?.[sku]?.stars ?? '—';
  const rubFor = (sku) => plans?.[sku]?.rub ?? '—';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'var(--overlay-strong)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}
      onClick={busyPack ? undefined : onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        onTouchStart={onSheetTouchStart}
        onTouchMove={onSheetTouchMove}
        onTouchEnd={onSheetTouchEnd}
        style={{
          width: '100%', maxWidth: 480,
          background: 'linear-gradient(180deg, var(--sheet-top) 0%, var(--sheet-bot) 100%)',
          borderTopLeftRadius: 28, borderTopRightRadius: 28,
          border: '1px solid rgba(232,146,10,0.2)',
          borderBottom: 'none',
          padding: '10px 20px calc(env(safe-area-inset-bottom, 0px) + 24px)',
          maxHeight: '92vh', overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          animation: dragY ? 'none' : 'pageEnter 0.3s cubic-bezier(0.4,0,0.2,1)',
          // transform держим всегда (а не только при перетаскивании) вместе с
          // willChange: так шторка живёт на своём слое композитора. Иначе каждый
          // кадр скролла перерисовывал blur подложки, и на Android экран мерцал
          // (отчёт 7444139).
          transform: dragY ? `translateY(${dragY}px)` : 'translateY(0)',
          willChange: 'transform',
          transition: dragging ? 'none' : 'transform 0.25s ease',
        }}
      >
        {/* Хват */}
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(var(--fg-rgb),0.15)', margin: '0 auto 18px' }} />

        {/* Заголовок */}
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%', margin: '0 auto 14px',
            background: 'linear-gradient(135deg, #f5a623, #c97a10)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 32px rgba(232,146,10,0.4)',
          }}>
            <SparklesIcon style={{ width: 32, height: 32, color: '#1a0800' }} />
          </div>
          <h2 style={{
            fontSize: 22, fontWeight: 800, margin: '0 0 6px',
            background: 'linear-gradient(135deg, var(--fg), #f5a623)',
            WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
          }}>
            {isVk ? t('paywall.iskryTitle') : t('paywall.title')}
          </h2>
          <p style={{ fontSize: 14, color: 'rgba(var(--fg-rgb),0.6)', margin: 0, lineHeight: 1.5 }}>
            {reason || (isVk ? t('paywall.defaultReasonVk') : t('paywall.defaultReason'))}
          </p>
        </div>

        {isVk ? (
          // ─── VK: баланс + пакеты Искр ───
          <>
            {/* Текущий баланс */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '12px 16px', marginBottom: 16, borderRadius: 16,
              background: 'rgba(232,146,10,0.1)', border: '1px solid rgba(232,146,10,0.25)',
            }}>
              <SparklesIcon style={{ width: 18, height: 18, color: '#f5a623' }} />
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)' }}>
                {t('paywall.iskryBalance', { n: iskry?.balance ?? 0 })}
              </span>
            </div>

            {/* Что сколько стоит */}
            {iskry?.cost && (
              <p style={{ fontSize: 12.5, color: 'rgba(var(--fg-rgb),0.55)', textAlign: 'center', margin: '0 0 16px', lineHeight: 1.6 }}>
                {t('paywall.iskryCostHint', {
                  analysis: iskry.cost.analysis,
                  oracle: iskry.cost.oracle_message,
                  monthly: iskry.cost.monthly_summary,
                })}
              </p>
            )}

            {/* Каталог не загрузился / грузится — не оставляем пустой платёжный экран */}
            {!iskry && (
              <div style={{ textAlign: 'center', padding: '18px 0 22px' }}>
                <p style={{ fontSize: 13.5, color: 'rgba(var(--fg-rgb),0.55)', margin: '0 0 12px' }}>
                  {catalogFailed ? t('paywall.catalogError') : t('paywall.catalogLoading')}
                </p>
                {catalogFailed && (
                  <button
                    onClick={loadCatalog}
                    style={{
                      padding: '10px 24px', fontSize: 14, fontWeight: 700, borderRadius: 9999,
                      border: '1px solid rgba(232,146,10,0.5)', background: 'rgba(232,146,10,0.12)',
                      color: 'var(--fg)', cursor: 'pointer',
                    }}
                  >
                    {t('paywall.retry')}
                  </button>
                )}
              </div>
            )}

            {/* Пакеты Искр */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
              {ISKRY_PACK_ORDER.filter(sku => iskry?.packs?.[sku]).map(sku => {
                const p = iskry.packs[sku];
                const busy = busyPack === sku;
                const best = sku === 'iskry_pack_600';
                const approxAnalyses = Math.floor(p.iskry / (iskry.cost?.analysis || 40));
                return (
                  <button
                    key={sku}
                    onClick={() => buyIskryPack(sku)}
                    disabled={!!busyPack}
                    style={{
                      width: '100%', textAlign: 'left', cursor: busyPack ? 'default' : 'pointer',
                      padding: '16px 18px', borderRadius: 18,
                      background: best ? 'rgba(232,146,10,0.12)' : 'rgba(var(--fg-rgb),0.04)',
                      border: best ? '1.5px solid rgba(232,146,10,0.6)' : '1px solid rgba(var(--fg-rgb),0.1)',
                      boxShadow: best ? '0 0 20px rgba(232,146,10,0.2)' : 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      opacity: busy ? 0.6 : 1, transition: 'all 0.2s',
                    }}
                  >
                    {/* minWidth:0 — иначе на 320px левая колонка не ужимается,
                        бейдж «Выгодно» наезжает на цену, а название рвётся
                        на две строки. */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: '1 1 auto' }}>
                      <div style={{
                        width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                        background: 'rgba(232,146,10,0.15)', border: '1px solid rgba(232,146,10,0.3)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <SparklesIcon style={{ width: 18, height: 18, color: '#f5a623' }} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)' }}>
                            {t('paywall.iskryPackName', { n: p.iskry })}
                          </span>
                          {best && (
                            <span style={{
                              fontSize: 11, fontWeight: 700, color: '#1a0800',
                              background: 'linear-gradient(135deg, #f5a623, #e8920a)',
                              // Было 2px по вертикали — текст упирался в края пилюли
                              // (отчёт 7443009). Даём воздух и фиксируем интерлиньяж,
                              // чтобы подпись стояла ровно по центру бейджа.
                              padding: '4px 10px', borderRadius: 9999,
                              lineHeight: 1.2, whiteSpace: 'nowrap', display: 'inline-block',
                            }}>{t('paywall.iskryBest')}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: 'rgba(var(--fg-rgb),0.45)', marginTop: 2 }}>
                          {t('paywall.iskryApproxAnalyses', { count: approxAnalyses })}
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, paddingLeft: 10 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#f5a623', whiteSpace: 'nowrap' }}>
                        {busy ? t('paywall.awaitingPayment') : t('paywall.iskryPackVotes', { votes: p.vk_votes })}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Промокод — свёрнут по умолчанию: у большинства кода нет, и поле
                перед пакетами только отвлекало бы от покупки. */}
            <div style={{ marginBottom: 16 }}>
              {!promoOpen ? (
                <button
                  onClick={() => setPromoOpen(true)}
                  style={{
                    width: '100%', minHeight: 44, padding: '11px 12px', fontSize: 13.5,
                    background: 'none', border: 'none', boxShadow: 'none',
                    color: 'rgba(var(--fg-rgb),0.55)', cursor: 'pointer',
                  }}
                >
                  {t('paywall.promoToggle')}
                </button>
              ) : (
                <div>
                  <label
                    htmlFor="dw-promo"
                    style={{ display: 'block', fontSize: 12.5, color: 'rgba(var(--fg-rgb),0.55)', marginBottom: 7 }}
                  >
                    {t('paywall.promoLabel')}
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      id="dw-promo"
                      value={promoCode}
                      onChange={(e) => { setPromoCode(e.target.value); setPromoError(''); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') applyPromo(); }}
                      placeholder={t('paywall.promoPlaceholder')}
                      maxLength={32}
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      disabled={promoBusy}
                      aria-describedby={promoError ? 'dw-promo-err' : undefined}
                      style={{
                        flex: 1, minWidth: 0, minHeight: 46, padding: '0 14px',
                        fontSize: 15, letterSpacing: '0.06em', textTransform: 'uppercase',
                        borderRadius: 14, color: 'var(--fg)',
                        background: 'rgba(var(--fg-rgb),0.05)',
                        border: `1px solid ${promoError ? 'var(--danger)' : 'rgba(var(--fg-rgb),0.14)'}`,
                      }}
                    />
                    <button
                      onClick={applyPromo}
                      disabled={promoBusy || !promoCode.trim()}
                      style={{
                        // width:auto обязателен: в globals.css у button стоит
                        // width:100%, и кнопка выдавливала поле ввода до нуля.
                        flexShrink: 0, width: 'auto', minHeight: 46, padding: '0 18px',
                        fontSize: 14, fontWeight: 700, borderRadius: 14, border: 'none',
                        color: '#1a0800', background: 'linear-gradient(135deg, #f5a623, #e8920a)',
                        cursor: promoBusy || !promoCode.trim() ? 'default' : 'pointer',
                        opacity: promoBusy || !promoCode.trim() ? 0.45 : 1,
                      }}
                    >
                      {promoBusy ? t('paywall.promoApplying') : t('paywall.promoApply')}
                    </button>
                  </div>
                  {promoError && (
                    <p id="dw-promo-err" role="alert" style={{ fontSize: 12.5, color: 'var(--danger)', margin: '7px 0 0' }}>
                      {promoError}
                    </p>
                  )}
                  {promoDone && (
                    <p role="status" style={{ fontSize: 12.5, color: 'var(--success)', margin: '7px 0 0' }}>
                      {promoDone}
                    </p>
                  )}
                </div>
              )}
            </div>

            {error && (
              <p style={{ fontSize: 13, color: 'var(--danger)', textAlign: 'center', margin: '0 0 12px' }}>{error}</p>
            )}
            {needVotes && canShowVotesLink && (
              <div style={{
                margin: '0 0 12px', padding: '12px 14px', borderRadius: 14,
                background: 'rgba(var(--fg-rgb),0.05)', border: '1px solid rgba(var(--fg-rgb),0.1)',
              }}>
                <p style={{ fontSize: 12.5, lineHeight: 1.55, color: 'rgba(var(--fg-rgb),0.7)', margin: '0 0 10px' }}>
                  {t('paywall.votesHint')}
                </p>
                {/* Нативная ссылка внутри жеста: VKWebAppOpenLink срабатывает уже
                    вне жеста и режется как popup (та же история, что с офертой). */}
                <a
                  href="https://vk.com/settings?act=payments"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    minHeight: 44, borderRadius: 9999, textDecoration: 'none',
                    fontSize: 14, fontWeight: 600, color: 'var(--fg)',
                    background: 'rgba(var(--fg-rgb),0.08)', border: '1px solid rgba(var(--fg-rgb),0.14)',
                  }}
                >
                  {t('paywall.votesTopUp')}
                </a>
              </div>
            )}
            {notice && (
              <p style={{ fontSize: 13, color: 'rgba(var(--fg-rgb),0.7)', textAlign: 'center', margin: '0 0 12px' }}>{notice}</p>
            )}

            <button
              onClick={onClose}
              disabled={!!busyPack}
              style={{
                width: '100%', marginTop: 2, padding: '12px', fontSize: 14,
                background: 'none', border: 'none', boxShadow: 'none',
                color: 'rgba(var(--fg-rgb),0.4)', cursor: busyPack ? 'default' : 'pointer',
                opacity: busyPack ? 0.4 : 1,
              }}
            >
              {t('paywall.later')}
            </button>

            <p style={{ fontSize: 11, color: 'rgba(var(--fg-rgb),0.3)', textAlign: 'center', margin: '10px 0 0', lineHeight: 1.5 }}>
              {t('paywall.iskryDisclaimer')}
            </p>
          </>
        ) : (
          // ─── TG/Web: доступ (подписка) — Stars / карта ───
          <>
            {/* Преимущества */}
            <div style={{ marginBottom: 22 }}>
              {BENEFITS.map((b, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                    background: 'rgba(232,146,10,0.15)', border: '1px solid rgba(232,146,10,0.3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <CheckIcon style={{ width: 15, height: 15, color: '#f5a623' }} />
                  </div>
                  <span style={{ fontSize: 14, color: 'rgba(var(--fg-rgb),0.85)' }}>{b}</span>
                </div>
              ))}
            </div>

            {/* Тарифы */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
              {(oneTime ? ['single_analysis', 'premium_yearly', 'premium_monthly'] : ['premium_yearly', 'premium_monthly']).map(sku => {
                // Скидку года в App Store считаем из цен магазина: «−45%» посчитана
                // от рублей и в другой валюте может врать.
                const yearly = storeProducts?.premium_yearly;
                const monthly = storeProducts?.premium_monthly;
                const iosSaving = yearly && monthly ? Math.round((1 - yearly.price / (monthly.price * 12)) * 100) : 0;
                const meta = isIos && sku === 'premium_yearly'
                  ? { ...PLAN_META[sku], badge: iosSaving > 0 ? `−${iosSaving}%` : null }
                  : PLAN_META[sku];
                const active = selected === sku;
                return (
                  <button
                    key={sku}
                    onClick={() => setSelected(sku)}
                    style={{
                      width: '100%', textAlign: 'left', cursor: 'pointer',
                      padding: '16px 18px', borderRadius: 18,
                      background: active ? 'rgba(232,146,10,0.12)' : 'rgba(var(--fg-rgb),0.04)',
                      border: active ? '1.5px solid rgba(232,146,10,0.6)' : '1px solid rgba(var(--fg-rgb),0.1)',
                      boxShadow: active ? '0 0 20px rgba(232,146,10,0.2)' : 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      transition: 'all 0.2s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                        border: active ? '6px solid #f5a623' : '2px solid rgba(var(--fg-rgb),0.3)',
                        background: active ? '#1a0800' : 'transparent',
                        transition: 'all 0.2s',
                      }} />
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)' }}>{meta.label}</span>
                          {meta.badge && (
                            <span style={{
                              fontSize: 11, fontWeight: 700, color: '#1a0800',
                              background: 'linear-gradient(135deg, #f5a623, #e8920a)',
                              padding: '2px 8px', borderRadius: 9999,
                            }}>{meta.badge}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: 'rgba(var(--fg-rgb),0.45)', marginTop: 2 }}>
                          {isIos
                            ? (meta.oneTime ? t('paywall.planOneTimeNote') : t(sku === 'premium_yearly' ? 'paywall.periodYearIos' : 'paywall.periodMonthIos'))
                            : <>≈ {rubFor(sku)} ₽{meta.oneTime ? ` · ${t('paywall.planOneTimeNote')}` : meta.period}</>}
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#f5a623' }}>
                        {isIos ? (storeProducts?.[sku]?.priceString ?? '—') : `${priceFor(sku)} ⭐`}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {error && (
              <p style={{ fontSize: 13, color: 'var(--danger)', textAlign: 'center', margin: '0 0 12px' }}>{error}</p>
            )}
            {isIos && notice && (
              <p style={{ fontSize: 13, color: 'rgba(var(--fg-rgb),0.7)', textAlign: 'center', margin: '0 0 12px' }}>{notice}</p>
            )}

            <button
              onClick={() => (isIos ? buyInApp(selected) : buy(selected))}
              disabled={buying || (isIos && !storeProducts?.[selected])}
              style={{
                width: '100%', padding: '16px 20px', fontSize: 16, fontWeight: 700,
                borderRadius: 9999, border: 'none', color: '#1a0800',
                background: 'linear-gradient(135deg, #f5a623 0%, #e8920a 55%, #c97a10 100%)',
                boxShadow: '0 0 28px rgba(232,146,10,0.4), 0 4px 16px rgba(232,146,10,0.3), inset 0 1px 0 rgba(var(--fg-rgb),0.2)',
                opacity: buying || (isIos && !storeProducts?.[selected]) ? 0.6 : 1,
              }}
            >
              {buying
                ? t('paywall.openingPayment')
                : isIos
                  ? t(PLAN_META[selected]?.oneTime ? 'paywall.payOneTimeAppStore' : 'paywall.payAppStore', { price: storeProducts?.[selected]?.priceString ?? '' })
                  : t(PLAN_META[selected]?.oneTime ? 'paywall.payOneTimeStars' : 'paywall.payByStars', { price: priceFor(selected) })}
            </button>

            {isIos ? (
              // Покупки живут на аккаунте Apple — «восстановить» сверяет чеки и спрашивает сервер.
              <button
                onClick={restore}
                disabled={restoring}
                style={{
                  width: '100%', marginTop: 10, padding: '15px 20px', fontSize: 15, fontWeight: 600,
                  borderRadius: 9999,
                  background: 'rgba(var(--fg-rgb),0.07)', backdropFilter: 'blur(12px)',
                  border: '1px solid rgba(var(--fg-rgb),0.14)', color: 'rgba(var(--fg-rgb),0.9)',
                  boxShadow: 'none', opacity: restoring ? 0.6 : 1,
                }}
              >
                {t('paywall.restorePurchases')}
              </button>
            ) : (
              <button
                onClick={() => payCard(selected)}
                disabled={cardBuying}
                style={{
                  width: '100%', marginTop: 10, padding: '15px 20px', fontSize: 15, fontWeight: 600,
                  borderRadius: 9999,
                  background: 'rgba(var(--fg-rgb),0.07)', backdropFilter: 'blur(12px)',
                  border: '1px solid rgba(var(--fg-rgb),0.14)', color: 'rgba(var(--fg-rgb),0.9)',
                  boxShadow: 'none', opacity: cardBuying ? 0.6 : 1,
                }}
              >
                {cardBuying
                  ? t('paywall.awaitingPayment')
                  : t(PLAN_META[selected]?.oneTime ? 'paywall.payOneTimeCard' : 'paywall.payByCard', { price: rubFor(selected) })}
              </button>
            )}

            <button
              onClick={onClose}
              style={{
                width: '100%', marginTop: 10, padding: '12px', fontSize: 14,
                background: 'none', border: 'none', boxShadow: 'none',
                color: 'rgba(var(--fg-rgb),0.4)', cursor: 'pointer',
              }}
            >
              {t('paywall.later')}
            </button>

            <p style={{ fontSize: 11, color: 'rgba(var(--fg-rgb),0.3)', textAlign: 'center', margin: '10px 0 0', lineHeight: 1.5 }}>
              {isIos ? t('paywall.disclaimerIos') : t('paywall.disclaimerOther')} {t('paywall.disclaimerSuffix')}
            </p>
            {isIos && (
              <p style={{ fontSize: 11, textAlign: 'center', margin: '6px 0 0' }}>
                {/* Документы на английском: продавец в App Store — Yupland Digital Solutions, LLC,
                    а русские /terms и /privacy написаны от ИП для VK и Telegram. */}
                <a href={`${API_BASE}/terms-en`} target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(var(--fg-rgb),0.5)' }}>
                  {t('paywall.terms')}
                </a>
                <span style={{ color: 'rgba(var(--fg-rgb),0.3)' }}> · </span>
                <a href={`${API_BASE}/privacy-en`} target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(var(--fg-rgb),0.5)' }}>
                  {t('paywall.privacy')}
                </a>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
