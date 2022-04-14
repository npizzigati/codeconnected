'use strict';

import React, { useRef, useEffect, useState, useReducer } from 'react';
import * as Y from 'yjs';
import CodeMirror from 'codemirror/lib/codemirror.js';
import 'codemirror/addon/edit/closebrackets.js';
import 'codemirror/mode/javascript/javascript.js';
import 'codemirror/theme/material.css';

import { CodemirrorBinding } from 'y-codemirror';
import { WebrtcProvider } from 'y-webrtc';

function CodeArea ({ codeContent, setCodeContent }) {
  const isReplPendingResponse = useRef(false);
  const replCommand = useRef('');
  const codeAreaDOMRef = useRef(null);
  const [sharedOutputRef, setSharedOutputRef] = useState('');
  const [outputDisplay, setOutputDisplay] = useState('');
  const [replDisplay, setReplDisplay] =
    useReducer((state, change) => {
      switch (change.action) {
      case 'add':
        return state + change.char;
      case 'remove':
        return removeCommandFromDisplay(change.command, state);
      }
    }, '');
  const [ws, setWs] = useState(null);
  /* const [replFocused, setReplFocused] = useState(false); */
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

    // Set listener to update output display on change in ytext
    // output variable
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
      <button onClick={openReplWs}>Open My Repl</button>
      <div id='repl' tabIndex='0' onKeyPress={handleKeyPress}>
        {replDisplay}
      </div>
      <textarea
        style={{ whiteSpace: 'pre-wrap' }}
        value={outputDisplay}
        readOnly
      />
    </>
  );

  function handleKeyPress (ev) {
    ev.preventDefault();
    if (ev.key === 'Enter') {
      isReplPendingResponse.current = true;
      sendCommand();
      return;
    }

    replCommand.current = replCommand.current + ev.key;
    setReplDisplay({ action: 'add', char: ev.key });
  }

  function sendCommand () {
    if (ws === null || ws.readyState === WebSocket.CLOSED ||
        ws.readyState === WebSocket.CLOSING) {
      const ws = openReplWs();
      ws.onopen = function () {
        console.log('Web socket is open');
        ws.send(replCommand.current);
        setWs(ws);
      };
      return;
    }
    ws.send(replCommand.current);
  }

  function openReplWs () {
    const ws = new WebSocket(window.location.origin.replace(/^http/, 'ws') +
                                        '/api/openreplws');

    ws.onmessage = function (ev) {
      if (isReplPendingResponse.current === true) {
        setReplDisplay({ action: 'remove', command: replCommand.current });
        replCommand.current = '';
        isReplPendingResponse.current = false;
      }
      setReplDisplay({ action: 'add', char: ev.data });
    };
    return ws;
  }

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

  function removeCommandFromDisplay (command, currentDisplay) {
    // Remove last command entered, since runner output will echo it
    // Remove letter by letter starting from end
    let newReplDisplay = currentDisplay;
    for (let i = 1; i <= command.length; i++) {
      if (command[command.length - i] === currentDisplay[currentDisplay.length - i]) {
        newReplDisplay = newReplDisplay.slice(0, currentDisplay.length - i);
      } else {
        break;
      }
    }
    return newReplDisplay;
  }
}

export { CodeArea as default };
