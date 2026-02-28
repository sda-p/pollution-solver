// src/main.jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';    // Tailwind + global styles
import App from './App.jsx';

const root = createRoot(document.getElementById('root'));

root.render(
  <StrictMode>
    {/* This wrapper enables DaisyUI dark theme */}
    <div className="dark">
      <App />
    </div>
  </StrictMode>
);