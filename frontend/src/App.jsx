'use strict';

import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home.jsx';
import CodeArea from './pages/CodeArea.jsx';

function App () {
  return (
    <React.StrictMode>
      <BrowserRouter>
        <Routes>
          <Route path='/' element={<Home />} />
          <Route path='/:lang/:roomID' element={<CodeArea />} />
        </Routes>
      </BrowserRouter>
    </React.StrictMode>

  );
}

export { App as default };
