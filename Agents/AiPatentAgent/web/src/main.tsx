import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Intake, Shell, Workbench } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<Intake />} />
          <Route path="/analyses/:id" element={<Workbench />} />
          <Route path="*" element={<Intake />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  </StrictMode>,
);
