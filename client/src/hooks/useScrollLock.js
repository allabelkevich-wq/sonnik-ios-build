import { useEffect } from 'react';

// Блокирует прокрутку body, пока активна модалка/шторка — иначе фон скроллится
// «за» оверлеем (bug7438798 искры, 7438755 прогноз, 7438485 удаление аккаунта).
// Восстанавливает прежнее значение overflow при закрытии/размонтировании.
export function useScrollLock(active) {
  useEffect(() => {
    if (!active) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [active]);
}
