import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/i18n';

import App from './app/App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('找不到 #root 挂载点');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
