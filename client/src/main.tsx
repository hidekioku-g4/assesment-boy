import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  // StrictMode一時無効（Live2D初期化の競合回避）
  // <React.StrictMode>
    <App />
  // </React.StrictMode>,
);
