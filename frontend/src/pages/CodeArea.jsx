'use strict';

import React, { useRef, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

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
  const navigate = useNavigate();
  const params = useParams();
  const roomID = params.roomID;
  const codeAreaDOMRef = useRef(null);
  const mainTermDOMRef = useRef(null);
  const term = useRef(null);
  const ws = useRef(null);
  const flags = useRef(null);
  const codeOptions = useRef(null);
  const cmRef = useRef(null);
  const [language, setLanguage] = useState('');
  // FIXME: Do I need this? Am I using the ydocRef anywhere?
  const [ydocRef, setYdocRef] = useState(null);


  useEffect(() => {
    // Get initial lang and terminal history from server
    (async () => {
      // Check whether room exists
      if (!(await roomExists(roomID))) {
        console.log('room does not exist');
        navigate('/');
        return;
      }

      console.log('Getting initial lang and history');
      // TODO: Set spinner while waiting, maybe
      const initialVars = await getInitialLangAndHist(roomID);
      const initialLang = initialVars.language;
      const initialHist = initialVars.history;
      setLanguage(initialLang);
      console.log('initial lang: ' + initialLang);
      console.log('initial hist: ' + initialHist);
      term.current = new Terminal();
      term.current.open(mainTermDOMRef.current);
      term.current.write(initialHist);
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

      const yCodeOptions = ydoc.getMap('code options');
      yCodeOptions.observe(ev => {
        const lang = ev.target.get('language');
        setLanguage(lang);
        cm.setOption('mode', lang);
        console.log('language is now: ' + lang);
      });
      // Copy a reference to React state
      codeOptions.current = yCodeOptions;
      // Check whether room exists when user comes online. This
      // is so that users returning from sleep or otherwise being
      // offline can automatically return to home page.
      window.addEventListener('online', () => {
        console.log('now online');
        redirectIfNoRoom(roomID);
      });
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

  async function redirectIfNoRoom (roomID) {
    if (!(await roomExists(roomID))) {
      console.log('room does not exist');
      window.alert('The room no longer exists');
      navigate('/');
    }
  }

  async function getInitialLangAndHist (roomID) {
    const options = {
      method: 'GET',
      mode: 'cors'
    };

    // TODO: Check if successful (status code 200) before processing
    try {
      const response = await fetch(`/api/getlangandhist?roomID=${roomID}`, options);
      return await response.json();
    } catch (error) {
      console.error('Error fetching json:', error);
      return null;
    }
  }

  async function roomExists (roomID) {
    const options = {
      method: 'GET',
      mode: 'cors'
    };

    // TODO: Check if successful (status code 200) before processing
    try {
      const response = await fetch(`/api/does-room-exist?roomID=${roomID}`, options);
      const json = await response.json();
      return json.roomExists;
    } catch (error) {
      console.error('Error fetching json:', error);
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

  // TODO: Also implement reset
  // TODO: Make this work for Ctrl-L too
  function clearTerminal () {
    term.current.clear();
    const lastLine = getLastTermLine();
    const roomID = params.roomID;
    console.log('lastLine: ' + lastLine);
    // TODO: Send a post request to server with the last line in
    // xterm.js, for server to clear history and insert that last
    // line into history (the prompt line at the top of the screen)
    const body = JSON.stringify({ lastLine, roomID });
    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: body
    };

    fetch('/api/clientclearterm', options)
      .then(response => {
        console.log(response);
      });
  }

  function resetTerminal () {
    term.current.reset();
  }

  function getTerminalText () {
    term.current.selectAll();
    const text = term.current.getSelection();
    term.current.clearSelection();
    return text;
  }

  function getLastTermLine () {
    const text = getTerminalText();
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
    return lines[lastLineNum];
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
      if (ev.data === 'RESETTERMINAL') {
        resetTerminal();
        return;
      }
      term.current.write(ev.data);
    };

    return ws;
  }

  // TODO: This should be debounced so that it is only sent once
  // even if user clicks multiple times
  function executeContent () {

    // Check whether repl is at a prompt
    const prompt = /> $/;
    const lastLine = getLastTermLine();
    console.log('prompt ready? ' + prompt.test(lastLine));
    if (!prompt.test(lastLine)) {
      window.alert('REPL prompt must be empty before code can be run.');
      return;
    }

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
