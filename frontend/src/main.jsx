import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';    // Tailwind + global styles
import App from './App.jsx';
import Achievements from './pages/Achievements.jsx';
import Leaderboard from './pages/Leaderboard.jsx';

const root = createRoot(document.getElementById('root'));

root.render(
  <StrictMode>
    {/* This wrapper enables DaisyUI dark theme */}
    <div className="dark">
      <BrowserRouter>
        <Routes>
          {/* Main Map Page */}
          <Route path="/" element={<App />} />
          
          {/* New Achievements Page */}
          <Route path="/achievements" element={<Achievements />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
        </Routes>
      </BrowserRouter>
    </div>
  </StrictMode>
);
