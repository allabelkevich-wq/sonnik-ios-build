import { createContext, useContext, useState, useRef, useCallback } from 'react';
import { CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/solid';

const ToastContext = createContext(null);

// In-app уведомление вместо браузерного alert() — VK-модератор отклонил
// заявку за использование браузерных алертов, требуя "элементы интерфейса
// самого сервиса".
export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  const showToast = useCallback((message, type = 'error') => {
    setToast({ message, type });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), type === 'success' ? 2200 : 4000);
  }, []);

  // Погасить тост вручную — App зовёт при навигации, чтобы уведомление не
  // «переезжало» с Профиля в другие разделы (репорт Ольги).
  const hideToast = useCallback(() => {
    clearTimeout(timerRef.current);
    setToast(null);
  }, []);

  const success = toast?.type === 'success';
  const Icon = success ? CheckCircleIcon : ExclamationTriangleIcon;

  return (
    <ToastContext.Provider value={{ show: showToast, hide: hideToast }}>
      {children}
      {toast && (
        <div
          onClick={() => setToast(null)}
          style={{
            // Нижняя плашка по эталону v3: растянута по ширине через left/right,
            // поэтому анимация не трогает translateX и тост не уезжает сбоку
            // (bug7438730). Отступ снизу учитывает safe-area.
            position: 'fixed', left: 18, right: 18,
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 22px)',
            zIndex: 1000,
            padding: '13px 16px', borderRadius: 16,
            background: 'var(--v3-toast)',
            display: 'flex', alignItems: 'center', gap: 10,
            boxShadow: '0 12px 30px rgba(0,0,0,.3)',
            color: 'var(--v3-fg)', fontSize: 13, fontWeight: 600,
            cursor: 'pointer',
            animation: 'v3Rise .2s ease',
          }}
        >
          <Icon
            style={{
              width: 18, height: 18, flexShrink: 0,
              color: success ? 'var(--v3-success)' : 'var(--v3-danger)',
            }}
          />
          <span style={{ overflowWrap: 'anywhere' }}>{toast.message}</span>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  // Обратная совместимость: как и раньше возвращаем функцию показа тоста.
  return useContext(ToastContext)?.show;
}

// Погасить активный тост (App зовёт при навигации между разделами).
export function useHideToast() {
  return useContext(ToastContext)?.hide;
}
