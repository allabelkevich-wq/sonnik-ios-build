import { createContext, useContext, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useScrollLock } from '../hooks/useScrollLock.js';

const ConfirmContext = createContext(null);

// In-app подтверждение вместо window.confirm() — VK Bridge не имеет метода
// для нативного confirm-диалога (VKWebAppShowAlert не существует в SDK),
// а VK-модератор в любом случае требует "элементы интерфейса самого сервиса".
export function ConfirmProvider({ children }) {
  const { t } = useTranslation();
  const [state, setState] = useState(null);

  const confirm = useCallback((message) => {
    return new Promise((resolve) => setState({ message, resolve }));
  }, []);

  const handle = (result) => {
    state?.resolve(result);
    setState(null);
  };

  useScrollLock(!!state);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          onClick={() => handle(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'var(--overlay-strong)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface-solid)', borderRadius: 20, padding: 24,
              maxWidth: 320, width: '100%',
            }}
          >
            <p style={{ fontSize: 15, color: 'var(--fg)', margin: '0 0 20px', lineHeight: 1.5, textAlign: 'center' }}>
              {state.message}
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => handle(false)}
                style={{ flex: 1, background: 'rgba(var(--fg-rgb),0.07)', color: 'var(--fg)', boxShadow: 'none' }}
              >
                {t('common.cancel')}
              </button>
              <button onClick={() => handle(true)} style={{ flex: 1 }}>
                {t('common.yes')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
