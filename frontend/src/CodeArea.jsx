'use strict';

import React, { useRef, useEffect, useState } from 'react';
import * as Y from 'yjs';
import { Terminal } from 'xterm';
import CodeMirror from 'codemirror/lib/codemirror.js';
import 'codemirror/addon/edit/closebrackets.js';
import 'codemirror/mode/ruby/ruby.js';
import 'codemirror/mode/javascript/javascript.js';
import 'codemirror/mode/sql/sql.js';
import 'codemirror/theme/material.css';

import { CodemirrorBinding } from 'y-codemirror';
import { WebrtcProvider } from 'y-webrtc';
import { WebsocketProvider } from 'y-websocket';

const defaultLanguage = 'ruby';

function CodeArea ({ codeContent, setCodeContent }) {
  // const isReplPendingResponse = useRef(false);
  // const newReplBlobs = useRef([]);
  // This is the positive offset of the repl cursor from right to
  // left, from the right end cursor position
  const codeAreaDOMRef = useRef(null);
  const terminalDOMRef = useRef(null);
  const term = useRef(null);
  const ws = useRef(null);
  const flags = useRef(null);
  const terminalContent = useRef(null);
  // const replAreaDOMRef = useRef(null);
  // const replCaretDOMRef = useRef(null);
  // // const [sharedOutputRef, setSharedOutputRef] = useState('');
  // // const [outputDisplay, setOutputDisplay] = useState('');
  // const [replDisplayData, setReplDisplayData] = useState('');
  const [language, setLanguage] = useState(defaultLanguage);
  const [codeOptions, setCodeOptions] = useState(null);
  const [cmRef, setCmRef] = useState(null);
  const [ydocRef, setYdocRef] = useState(null);

  // Used in conversion of binary data from websocket to utf-8
  let extraBytesToRead = 0;
  let extraBytesRead = 0;
  let totalBytesRead = 0;
  let fullBuffer, fullView;

  useEffect(() => {
    term.current = new Terminal();
    term.current.open(terminalDOMRef.current);
    term.current.onData((data) => {
      ws.current.send(data.toString());
    });
    // Save terminal content to shared state, to be passed to new
    // users when they join
    let setTerminalState;
    term.current.onRender(() => {
      clearTimeout(setTerminalState);
      setTerminalState = setTimeout(() => {
        terminalContent.current.set('lines', getTerminalLines());
      }, 100);
    });
    ws.current = openWs();

    const cm = CodeMirror.fromTextArea(codeAreaDOMRef.current, {
      mode: defaultLanguage,
      value: '',
      lineNumbers: true,
      autoCloseBrackets: true
    });

    cm.setSize('100%', '100%');

    // Collaborative editing
    // Code editor
    const ydoc = new Y.Doc();
    setYdocRef(ydoc);

    const ytextCode = ydoc.getText('codemirror');

    // y.js connection providers
    const rtcProvider = new WebrtcProvider('nicks-cm-room-' + language, ydoc);
    // rtcProvider.awareness.setLocalStateField('user', { color: 'gray', name: 'me' });
    const wsProvider = new WebsocketProvider(
      window.location.origin.replace(/^http/, 'ws') + '/ywebsocketprovider', 'nicks-cm-room-' + language, ydoc
    );
    wsProvider.awareness.setLocalStateField('user', { color: 'gray', name: 'user' });

    const binding = new CodemirrorBinding(ytextCode, cm, wsProvider.awareness);
    // Copy a reference to code mirror editor to React state
    setCmRef(cm);

    const yCodeOptions = ydoc.getMap('code options');
    yCodeOptions.set('language', defaultLanguage);
    yCodeOptions.observe(ev => {
      const lang = ev.target.get('language');
      setLanguage(lang);
      cm.setOption('mode', lang);
      console.log('language is now: ' + lang);
    });
    // Copy a reference to code mirror editor to React state
    setCodeOptions(yCodeOptions);

    const yFlags = ydoc.getMap('flags');
    yFlags.observe(ev => {
      if (ev.target.get('signal') === 'clearTerminal') {
        clearTerminal();
      }
    });
    // Copy a reference to code mirror editor to React state
    flags.current = yFlags;

    // Repl content to be passed on to a new coder joining the
    // session as their initial repl content
    const yTerminalContent = ydoc.getMap('terminal content');
    // Copy a reference to code mirror editor to React state
    terminalContent.current = yTerminalContent;
    // Initially fill terminal with existing content from shared session
    // TODO: Should I be using timeout here, or is there a more
    // reliable way to determine when shared content is available
    // after loading page?
    setTimeout(() => {
      if (yTerminalContent.get('lines') !== undefined) {
        console.log('terminal content: ', yTerminalContent.get('lines').join('\r\n'));
        // We have to get the lines and join them with a CR and
        // LF. If we just get the entire text, it will just have
        // LFs, which won't display properly
        term.current.write(yTerminalContent.get('lines').join('\r\n'));
      }
    }, 1000);
  }, []);

  // Use a React ref for the code area since CodeMirror needs to see it
  // in the DOM in order to attach to it
  return (
    <>
      <button onClick={executeContent}>Run</button>
      <button onClick={setTerminalClearFlag}>Clear terminal</button>
      <select id='language-chooser' value={language} onChange={switchLanguage}>
        <option value='ruby'>Ruby</option>
        <option value='javascript'>Node.js</option>
        <option value='sql'>SQL</option>
      </select>
      <div id='main-container'>
        <div id='codemirror-wrapper'>
          <textarea ref={codeAreaDOMRef} />
        </div>
        <div id='terminal' ref={terminalDOMRef} />
      </div>
    </>
  );

  function switchLanguage (ev) {
    codeOptions.set('language', ev.target.value);
  }

  function setTerminalClearFlag () {
    flags.current.set('signal', 'clearTerminal');
  }

  function clearTerminal () {
    term.current.clear();
  }

  function getTerminalLines () {
    console.log('Getting terminal text');
    const lines = [];
    const numRows = term.current.rows;
    // Build array of lines
    for (let i = 0; i < numRows; i++) {
      term.current.selectLines(i, i);
      const line = term.current.getSelection();
      lines.push(line);
      term.current.clearSelection();
    }

    // Find last line with text before blank lines
    let lastLineNum;
    for (let i = numRows - 1; i >= 0; i--) {
      if (lines[i] !== '') {
        lastLineNum = i;
        break;
      }
    }
    const linesWithText = lines.slice(0, lastLineNum + 1);
    return linesWithText;
  }

  function runCommand (options = {}) {
    const cmd = options.cmd;
    // If ws is closed/closing, open it again before sending command
    if (ws.current === null || ws.current.readyState === WebSocket.CLOSED ||
        ws.current.readyState === WebSocket.CLOSING) {
      ws.current = openReplWs();
      ws.current.onopen = function () {
        console.log('Web socket is open');
        ws.current.send(cmd);
      };
      return;
    }

    ws.current.send(cmd);
  }

  function openWs () {
    const ws = new WebSocket(window.location.origin.replace(/^http/, 'ws') +
                                        '/api/openreplws');
    ws.binaryType = 'arraybuffer';
    ws.onmessage = ev => {
      handleIncomingBytes(ev);
    };
    // Need to ping at least once every 60 seconds, or else nginx
    // proxypass will time out
    const pingInterval = setInterval(() => ws.send('KEEPALIVE'), 50000);
    ws.onclose = ev => {
      clearInterval(pingInterval);
    };

    return ws;
  }

  function handleIncomingBytes (ev) {
    const peek = new DataView(ev.data);
    const byte = peek.getUint8(0);
    totalBytesRead++;
    if (extraBytesToRead === 0) {
      fullBuffer = new ArrayBuffer(4);
      fullView = new Uint8Array(fullBuffer);
      fullView[0] = byte;
      // Multi-byte unicode data is being sent if the first
      // byte starts with a "1"
      // use bitmask with 10000000 to find out if this is the case
      if ((128 & byte) === 128) {
        // bytesLeftToRead = 1;
        extraBytesToRead = 1;
        // populate(fullView, firstByte);
        // The next three digits in binary will tell us how
        // many bytes the character is
        if ((240 & byte) === 240) {
          // bytesLeftToRead = 3;
          extraBytesToRead = 3;
        } else if ((224 & byte) === 224) {
          // bytesLeftToRead = 2;
          extraBytesToRead = 2;
        }
      }
    } else {
      // Read next byte into array
      extraBytesRead++;
      fullView[extraBytesRead] = byte;
      if (extraBytesRead === extraBytesToRead) {
        extraBytesToRead = 0;
        extraBytesRead = 0;
      }
    }

    if (extraBytesToRead !== 0) {
      return;
    }

    const finalView = new Uint8Array(fullBuffer, 0, totalBytesRead);
    totalBytesRead = 0;

    // Decoding and sending to terminal

    const decoder = new TextDecoder('utf-8', { fatal: true });
    let newReplText;
    try {
      // decoder may throw an error
      newReplText = decoder.decode(finalView);
      term.current.write(newReplText);
    } catch (err) {
      console.error(err);
      return;
    } finally {
    }
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
        // ydocRef.transact(() => {
        //   sharedOutputRef.delete(0, sharedOutputRef.length);
        //   sharedOutputRef.insert(0, data.output);
        // });
        let cmd;
        switch (language) {
        case 'javascript':
          cmd = 'node code';
          break;
        case 'ruby':
          cmd = 'ruby code';
          break;
        }
        runCommand({ cmd, history: false });
      });
  }
}

export { CodeArea as default };
