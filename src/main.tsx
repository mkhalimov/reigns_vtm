import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

// Устройства игроков грузят только свой маленький бандл: колоды, заметок и кода пульта в нём нет.
// Два отдельных import(): иначе сборщик подгружает зависимости обеих веток сразу.
const JoinRoot = lazy(() => import('./ui/JoinApp').then((m) => ({ default: m.JoinApp })));
const GmRoot = lazy(() => import('./App'));
const Root = location.hash.startsWith('#/join') ? JoinRoot : GmRoot;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div className="loading">Загрузка…</div>}>
      <Root />
    </Suspense>
  </StrictMode>,
);

// Оффлайн: после первой загрузки одноэкранный режим работает без сети.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
