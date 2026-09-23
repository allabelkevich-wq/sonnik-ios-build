import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { authHeader } from '../platform.js';

const API_BASE = import.meta.env.VITE_API_URL || '';

// ─── App Store (приложение iOS) ───
// Product ID в App Store Connect для наших SKU. Обратная карта — на сервере
// (src/backend/revenuecat.js): доступ выдаёт вебхук RevenueCat, держать в согласии.
const APP_STORE_PRODUCT_BY_SKU = {
  premium_monthly: 'com.yupsoul.sonnik.premium_month',
  premium_yearly: 'com.yupsoul.sonnik.premium_year',
  single_analysis: 'com.yupsoul.sonnik.single_reading',
};
// Публичный ключ SDK RevenueCat для iOS (appl_…) — подставляется при сборке приложения.
const REVENUECAT_IOS_KEY = import.meta.env.VITE_REVENUECAT_IOS_KEY || '';

// Плагин RevenueCat нативная часть Capacitor кладёт в window.Capacitor.Plugins.
// Настраиваем один раз за запуск и сразу под нашим пользователем: вебхук узнаёт
// покупателя по app_user_id 'apple:<sub>'.
let revenueCatUser = null;
async function revenueCat(uid) {
  const plugin = window.Capacitor?.Plugins?.Purchases;
  if (!plugin || !REVENUECAT_IOS_KEY || !uid) throw new Error('store_unavailable');
  const appUserID = `apple:${uid}`;
  if (!revenueCatUser) await plugin.configure({ apiKey: REVENUECAT_IOS_KEY, appUserID });
  else if (revenueCatUser !== appUserID) await plugin.logIn({ appUserID });
  revenueCatUser = appUserID;
  return plugin;
}

/**
 * Покупка премиум-доступа: Stars и карта Т-Банк (TG/Web), App Store (iOS).
 * Один источник для шторки Paywall и для шага «Тариф» в онбординге —
 * иначе один и тот же баг пришлось бы чинить в двух местах.
 */
export function usePremiumPurchase({ uid, onPaid }) {
  const { t } = useTranslation();
  const [buying, setBuying] = useState(false);
  const [cardBuying, setCardBuying] = useState(false);
  const [error, setError] = useState('');
  // Товары App Store с ценой в валюте человека: null — ещё не загружены, {} — не вышло.
  const [storeProducts, setStoreProducts] = useState(null);
  const pollRef = useRef(null);

  // Опрос статуса живёт до 5 минут — при уходе с экрана его надо гасить.
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // openInvoice не зовёт колбэк, если окно закрыли системным жестом, — кнопка
  // осталась бы заблокированной навсегда. Возврат в приложение снимает блок.
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) { setBuying(false); setCardBuying(false); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const buy = async (sku) => {
    setError('');
    if (!uid) { setError(t('paywall.errorPayTelegramOnly')); return; }
    setBuying(true);
    try {
      const res = await fetch(`${API_BASE}/api/payments/stars/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ plan_sku: sku }),
      });
      // Не-JSON (502 прокси, перезапуск) раньше показывался человеку как
      // «Unexpected token <» — теперь понятная фраза.
      const data = await res.json().catch(() => ({}));
      if (!data.pay_url) { setError(data.error || t('paywall.errorCreateInvoice')); setBuying(false); return; }
      const tg = window.Telegram?.WebApp;
      if (tg?.openInvoice) {
        tg.openInvoice(data.pay_url, (status) => {
          setBuying(false);
          if (status === 'paid') onPaid?.();
          else if (status === 'failed') setError(t('paywall.errorPaymentFailed'));
        });
      } else {
        window.open(data.pay_url, '_blank');
        setBuying(false);
      }
    } catch (_) {
      setError(t('paywall.errorCreateInvoice'));
      setBuying(false);
    }
  };

  const pollTbank = (orderId) => {
    let tries = 0;
    const iv = setInterval(async () => {
      tries += 1;
      try {
        const r = await fetch(`${API_BASE}/api/payments/tbank/status?order_id=${encodeURIComponent(orderId)}`).then((x) => x.json());
        if (r.paid) {
          clearInterval(iv);
          setCardBuying(false);
          onPaid?.();
        }
      } catch { /* ignore */ }
      if (tries > 50) { clearInterval(iv); setCardBuying(false); } // ~5 мин
    }, 6000);
    pollRef.current = iv;
  };

  const payCard = async (sku) => {
    setError('');
    if (!uid) { setError(t('paywall.errorPayCardUnavailable')); return; }
    setCardBuying(true);
    try {
      const res = await fetch(`${API_BASE}/api/payments/tbank/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ plan_sku: sku }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.payment_url) { setError(data.error || t('paywall.errorCreatePayment')); setCardBuying(false); return; }
      const tg = window.Telegram?.WebApp;
      if (tg?.openLink) tg.openLink(data.payment_url); else window.open(data.payment_url, '_blank');
      pollTbank(data.order_id);
      // Ссылка открыта — кнопки снова живые: закрыл банк без оплаты — пробуй
      // ещё раз или плати Stars. Опрос статуса продолжает работать сам.
      setCardBuying(false);
    } catch (_) {
      setError(t('paywall.errorCreatePayment'));
      setCardBuying(false);
    }
  };

  const loadStoreProducts = async () => {
    try {
      const plugin = await revenueCat(uid);
      const { products } = await plugin.getProducts({ productIdentifiers: Object.values(APP_STORE_PRODUCT_BY_SKU) });
      const bySku = {};
      for (const [sku, id] of Object.entries(APP_STORE_PRODUCT_BY_SKU)) {
        const product = (products || []).find((p) => p.identifier === id);
        if (product) bySku[sku] = product;
      }
      setStoreProducts(bySku);
    } catch (_) {
      setStoreProducts({});
    }
  };

  const buyInApp = async (sku) => {
    setError('');
    const product = storeProducts?.[sku];
    if (!product) { setError(t('paywall.errorStore')); return; }
    setBuying(true);
    try {
      const plugin = await revenueCat(uid);
      await plugin.purchaseStoreProduct({ product });
      // Доступ выдаёт вебхук RevenueCat — шторка дождётся его на сервере в onPaid.
      onPaid?.();
    } catch (e) {
      // Закрыть окно App Store — не ошибка.
      if (!(e?.userCancelled || String(e?.code) === '1')) setError(t('paywall.errorStore'));
    } finally {
      setBuying(false);
    }
  };

  // Покупки привязаны к аккаунту Apple на нашем сервере, поэтому восстановление —
  // это сверка чеков с RevenueCat; вернулся ли доступ, шторка спросит у сервера.
  const restoreInApp = async () => {
    const plugin = await revenueCat(uid);
    await plugin.restorePurchases();
  };

  return { buy, payCard, buyInApp, restoreInApp, storeProducts, loadStoreProducts, buying, cardBuying, error, setError };
}
