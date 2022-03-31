'use strict';

import React, { useState } from 'react';
import CodeArea from './CodeArea.jsx';
// import ResultsArea from './ResultsArea.jsx';

function App () {
  const [codeContent, setCodeContent] = useState('');
  console.log(codeContent);

  return (
    <React.StrictMode>
      <CodeArea setCodeContent={setCodeContent} />
    </React.StrictMode>
  );
}

export { App as default };
