'use strict';

import React, { useRef, useEffect, useState } from 'react';
import * as Y from 'yjs';
import CodeMirror from 'codemirror/lib/codemirror.js';
import 'codemirror/addon/edit/closebrackets.js';
import 'codemirror/mode/javascript/javascript.js';
import 'codemirror/theme/material.css';

import { CodemirrorBinding } from 'y-codemirror';
import { WebrtcProvider } from 'y-webrtc';

function CodeArea ({ codeContent, setCodeContent }) {
  const codeAreaDOMRef = useRef(null);
  const [sharedOutputRef, setSharedOutputRef] = useState('');
  const [outputDisplay, setOutputDisplay] = useState('');
  const [cmRef, setCmRef] = useState(null);
  const [ydocRef, setYdocRef] = useState(null);
  useEffect(() => {
    const cm = CodeMirror.fromTextArea(codeAreaDOMRef.current, {
      mode: 'javascript',
      value: 'function myScript(){return 100;}\n',
      lineNumbers: true,
      autoCloseBrackets: true
    });

    // Collaborative editing
    // Code editor
    const ydoc = new Y.Doc();
    setYdocRef(ydoc);
    const ytextCode = ydoc.getText('codemirror');
    const provider = new WebrtcProvider('nicks-cm-room', ydoc);
    provider.awareness.setLocalStateField('user', { color: 'gray', name: 'me' });
    const binding = new CodemirrorBinding(ytextCode, cm, provider.awareness);
    // Copy a reference to code mirror editor to React state
    setCmRef(cm);

    // Shared output text
    const ytextOutput = ydoc.getText('output text');
    // Copy a reference to the shared output to React state
    setSharedOutputRef(ytextOutput);

    // Update output display on change in ytext output variable
    ytextOutput.observe(ev => {
      setOutputDisplay(ev.target.toString());
    });
  }, []);

  // Use a React ref for the code area since CodeMirror needs to see it
  // in the DOM in order to attach to it
  // TODO: Sanitize program output pane contents
  return (
    <>
      <textarea ref={codeAreaDOMRef} />
      <button onClick={executeContent}>Run</button>
      <textarea style={{ whiteSpace: 'pre-wrap' }} value={outputDisplay} readOnly />
    </>
  );

  function executeContent () {
    const content = cmRef.getValue();
    const body = JSON.stringify({ content });
    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: body
    };
    fetch('/api/executecontent', options)
      .then(response => response.json())
      .then(data => {
        ydocRef.transact(() => {
          sharedOutputRef.delete(0, sharedOutputRef.length);
          sharedOutputRef.insert(0, data.output);
        });
      });
  }
}

export { CodeArea as default };
