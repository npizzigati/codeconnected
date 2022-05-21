'use strict';

import React, { useRef, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import * as Y from 'yjs';
import { CodemirrorBinding } from 'y-codemirror';
import { WebrtcProvider } from 'y-webrtc';
import { WebsocketProvider } from 'y-websocket';

import CodeMirror from 'codemirror/lib/codemirror.js';
import 'codemirror/addon/edit/closebrackets.js';
import 'codemirror/mode/ruby/ruby.js';
import 'codemirror/mode/javascript/javascript.js';
import 'codemirror/mode/sql/sql.js';
import 'codemirror/theme/material.css';

import { Terminal } from 'xterm';

function CodeArea () {
  const params = useParams();
  const roomID = params.roomID;
  const codeAreaDOMRef = useRef(null);
  const mainTermDOMRef = useRef(null);
  const term = useRef(null);
  const ws = useRef(null);
  const flags = useRef(null);
  const terminalData = useRef(null);
  const codeOptions = useRef(null);
  const cmRef = useRef(null);
  const [language, setLanguage] = useState('');
  // FIXME: Do I need this? Am I using the ydocRef anywhere?
  const [ydocRef, setYdocRef] = useState(null);

  // const promptReadyEvent = new Event('promptReady');

  useEffect(() => {
    // Get initial lang info (TODO: and terminal history maybe) from server
    console.log('Getting initial lang');
    (async () => {
      // TODO: Also get terminal history here;
      // TODO: Set spinner while waiting, maybe
      const initialLang = await getInitialLang(roomID);
      setLanguage(initialLang);
      term.current = new Terminal();
      term.current.open(mainTermDOMRef.current);
      term.current.onData((data) => {
        ws.current.send(data.toString());
      });
      ws.current = openWs(roomID);

      const cm = CodeMirror.fromTextArea(codeAreaDOMRef.current, {
        mode: initialLang,
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
      const rtcProvider = new WebrtcProvider('nicks-cm-room-' + roomID, ydoc);
      // rtcProvider.awareness.setLocalStateField('user', { color: 'gray', name: 'me' });
      const wsProvider = new WebsocketProvider(
        window.location.origin.replace(/^http/, 'ws') + '/ywebsocketprovider', 'nicks-cm-room-' + roomID, ydoc
      );
      wsProvider.awareness.setLocalStateField('user', { color: 'gray', name: 'user' });

      const binding = new CodemirrorBinding(ytextCode, cm, wsProvider.awareness);
      // Copy a reference to code mirror editor to React state
      cmRef.current = cm;

      const yFlags = ydoc.getMap('flags');
      yFlags.observe(ev => {
        if (ev.target.get('signal') === 'clearTerminal') {
          clearTerminal();
        }
      });
      // Copy a reference to React state
      flags.current = yFlags;

      const yTerminalData = ydoc.getMap('terminal data');
      // Copy a reference to React state
      terminalData.current = yTerminalData;
      // Initially fill terminal with existing content from shared session
      // TODO: Should I be using timeout here, or is there a more
      // reliable way to determine when shared content is available
      // after loading page?
      setTimeout(() => {
        if (yTerminalData.get('text') !== undefined) {
          console.log('loading terminal state');
          const text = yTerminalData.get('text');
          const lines = terminalLines(text);

          // Join with CRLF for proper display
          const formattedText = lines.join('\r\n');
          term.current.write(formattedText);
        }
      }, 300);
      // Save terminal content to shared state, to be passed to new
      // users when they join
      let setTerminalState;
      term.current.onRender(() => {
        clearTimeout(setTerminalState);
        setTerminalState = setTimeout(() => {
          console.log('saving terminal state');
          terminalData.current.set('text', getTerminalText(term));
        }, 500);
      });

      const yCodeOptions = ydoc.getMap('code options');
      yCodeOptions.observe(ev => {
        const lang = ev.target.get('language');
        setLanguage(lang);
        cm.setOption('mode', lang);
        console.log('language is now: ' + lang);
      });
      // Copy a reference to React state
      codeOptions.current = yCodeOptions;
    })();
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
        <option value='sql'>PostgreSQL</option>
      </select>
      <div id='main-container'>
        <div id='codemirror-wrapper'>
          <textarea ref={codeAreaDOMRef} />
        </div>
        <div id='terminal' ref={mainTermDOMRef} />
      </div>
    </>
  );

  async function getInitialLang (roomID) {
    const options = {
      method: 'GET',
      mode: 'cors'
    };

    // TODO: Check if successful (status code 200) before processing
    try {
      const response = await fetch(`/api/getlang?roomID=${roomID}`, options);
      const lang = await response.text();
      return lang;
    } catch (error) {
      console.error('Error fetching lang:', error);
      return null;
    }
  }

  function switchLanguage (ev) {
    console.log('switching language');
    const lang = ev.target.value;
    codeOptions.current.set('language', lang);

    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Length': '0' }
    };

    fetch(`/api/switchlanguage?roomID=${roomID}&lang=${lang}`, options)
      .then(response => {
        console.log(response);
      });
  }

  function setTerminalClearFlag () {
    flags.current.set('signal', 'clearTerminal');
  }

  function clearTerminal () {
    term.current.clear();
  }

  function getTerminalText (terminal) {
    terminal.current.selectAll();
    const text = terminal.current.getSelection();
    terminal.current.clearSelection();
    return text;
  }

  function terminalLines (text) {
    const lines = text.split('\n');

    // Remove blank lines at end
    // Find last line with text before blank lines
    let lastLineNum;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i] !== '') {
        lastLineNum = i;
        break;
      }
    }
    return lines.slice(0, lastLineNum + 1);
  }

  function runCode (filename, lines) {
    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Length': '0' }
    };
    fetch(`/api/runfile?roomID=${params.roomID}&lang=${language}&lines=${lines}`, options)
      .then(response => {
        console.log(response);
      });
  }

  function openWs (roomID) {
    // const ws = new WebSocket(window.location.origin.replace(/^http/, 'ws') +
    //                          `/api/openreplws?lang=${language}`);
    const ws = new WebSocket(window.location.origin.replace(/^http/, 'ws') +
                             '/api/openws?roomID=' + roomID);
    ws.onmessage = ev => {
      term.current.write(ev.data);
    };
    // Need to ping with a non-empty payload at least once every
    // 60 seconds, or else nginx proxypass will time out
    const pingInterval = setInterval(() => ws.send('KEEPALIVE'), 50000);
    ws.onclose = ev => {
      clearInterval(pingInterval);
    };

    return ws;
  }

  function executeContent () {
    const content = cmRef.current.getValue();
    const lines = cmRef.current.lineCount();
    let filename;
    switch (language) {
    case ('ruby'):
      filename = 'code.rb';
      break;
    case ('javascript'):
      filename = 'code.js';
      break;
    case ('sql'):
      filename = 'code.sql';
      break;
    }
    const body = JSON.stringify({ content, filename, roomID: params.roomID });
    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: body
    };

    fetch('/api/savecontent', options)
      .then(response => {
        console.log(response);
        runCode(filename, lines);
      });
  }
}

export { CodeArea as default };
