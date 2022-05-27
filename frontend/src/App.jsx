'use strict';

import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home.jsx';
import CodeArea from './pages/CodeArea.jsx';
import SignUp from './pages/SignUp.jsx';

function App () {
  return (
    <React.StrictMode>
      <BrowserRouter>
        <Routes>
          <Route path='/' element={<Home />} />
          <Route path='/signup' element={<SignUp />} />
          <Route path='/:roomID' element={<CodeArea />} />
        </Routes>
      </BrowserRouter>
    </React.StrictMode>
  );
}

export { App as default };
