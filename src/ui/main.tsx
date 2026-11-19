import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';

const rootEl = document.getElementById('root')!;
rootEl.dataset.mounted = '1';
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
