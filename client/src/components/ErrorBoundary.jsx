import { Component } from 'react';

// Последний рубеж: если что-то падает при рендере, показываем аккуратный
// экран с кнопкой перезагрузки, а не чёрный/пустой экран (частая причина
// «приложение не запускается» на VK-мобильных). Текст простой русский —
// это fallback на случай, когда даже i18n мог не подняться.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{
        minHeight: '100dvh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', textAlign: 'center',
        padding: '40px 28px', gap: 18,
      }}>
        <div style={{ fontSize: 44, lineHeight: 1 }}>🌙</div>
        <p style={{ fontSize: 15, color: 'rgba(var(--fg-rgb),0.75)', lineHeight: 1.6, margin: 0, maxWidth: 320 }}>
          Что-то пошло не так. Попробуйте перезапустить приложение.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{ maxWidth: 260 }}
        >
          Перезагрузить
        </button>
      </div>
    );
  }
}
