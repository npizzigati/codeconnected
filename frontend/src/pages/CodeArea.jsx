'use strict';

import React, { useRef, useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';

import * as Y from 'yjs';
import { CodemirrorBinding } from 'y-codemirror';
import { WebrtcProvider } from 'y-webrtc';
import { WebsocketProvider } from 'y-websocket';

import CodeMirror from 'codemirror/lib/codemirror.js';
import 'codemirror/addon/edit/closebrackets.js';
import 'codemirror/mode/ruby/ruby.js';
import 'codemirror/mode/javascript/javascript.js';
import 'codemirror/mode/sql/sql.js';

import { Terminal } from 'xterm';

import Select from './components/Select.jsx';
import UserDashboard from './components/UserDashboard.jsx';
import Auth from './components/Auth.jsx';

// TODO: Somehow ping the server to deal with the case where the
// room is closed with a client still attached, as in when I shut
// down the server with rooms still open. Currently the client's
// terminals just freeze.
function CodeArea () {
  const navigate = useNavigate();
  const params = useParams();
  const roomID = params.roomID;
  const codeAreaDOMRef = useRef(null);
  const termDomRef = useRef(null);
  const termContainerDomRef = useRef(null);
  const term = useRef(null);
  const ws = useRef(null);
  const flags = useRef(null);
  const codeOptions = useRef(null);
  const cmRef = useRef(null);
  const [language, setLanguage] = useState('');
  // FIXME: Do I need this? Am I using the ydocRef anywhere?
  const [ydocRef, setYdocRef] = useState(null);

  const resizeBarDOMRef = useRef(null);
  const initialX = useRef(null);
  const [cmWidth, setCmWidth] = useState('50%');
  const [termWidth, setTermWidth] = useState('50%');
  const [minCmWidth, minTermWidth] = [300, 200];
  const [replTitle, setReplTitle] = useState('');
  const [cmTitle, setCmTitle] = useState('');
  const [showMain, setShowMain] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [termEnabled, setTermEnabled] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [username, setUsername] = useState(null);
  const [timeLeftDisplay, setTimeLeftDisplay] = useState(null);
  const cmContainerDOMRef = useRef(null);

  useEffect(() => {
    (async () => {
      await setup();
    })();
  }, []);

  return (
    <div id='code-area' className={showMain ? 'visible' : 'hidden'}>
      {showAuth &&
        <Auth setShowAuth={setShowAuth} setAuthed={setAuthed} />}
      <div id='header-bar'>
        <div id='header-left-side'>
          <Link className='header-logo' to='/' />
        </div>
        <div id='header-right-side'>
          {timeLeftDisplay !== null &&
            <div className='time-remaining'>
              Time remaining: {timeLeftDisplay}
            </div>}
          {authed && <UserDashboard />}
        </div>
      </div>
      <div className='title-row'>
        <span className='editor-and-repl-title'>Code Editor</span>
        {termEnabled &&
          <>
            <span className='editor-lang-label'>Language:&nbsp;</span>
            <Select
              options={[{ value: 'ruby', label: 'Ruby' },
                        { value: 'node', label: 'Node.js' },
                        { value: 'postgres', label: 'PostgreSQL' }]}
              title={cmTitle}
              callback={(ev) => {
                const lang = ev.target.dataset.value;
                switchLanguage(lang);
              }}
              config={{ staticTitle: true }}
            />
            <button id='run-button' onClick={executeContent}>Run</button>
          </>}
      </div>
      <div id='main-container'>
        <div
          ref={cmContainerDOMRef}
          id='codemirror-container'
          style={{ width: cmWidth }}
        >
          <div id='codemirror-wrapper'>
            <textarea
              ref={codeAreaDOMRef}
            />
          </div>
        </div>
        <div
          ref={resizeBarDOMRef}
          id='resizer'
          onPointerDown={startResize}
          onPointerUp={stopResize}
        >
          <div id='resizer-handle' />
        </div>
        <div
          id='terminal-container'
          ref={termContainerDomRef}
          style={{ width: termWidth }}
        >
          {termEnabled &&
            <>
              <div className='title-row repl'>
                <span className='editor-and-repl-title'>{replTitle}</span>
                <Select
                  options={[{ value: 'clear', label: 'Clear' },
                            { value: 'reset', label: 'Reset' }]}
                  title='Actions'
                  callback={executeReplAction}
                  config={{ staticTitle: true }}
                />
              </div>
              <div
                ref={termDomRef}
                id='terminal-wrapper'
              />
            </>}
          {!termEnabled &&
            <div className='terminal-expired'>
              Terminal has expired.
            </div>}
        </div>
      </div>
    </div>
  );

  function executeReplAction (ev) {
    switch (ev.target.dataset.value) {
    case 'clear':
      setTerminalClearFlag();
      break;
    case 'reset':
      switchLanguage(language);
      break;
    }
  }

  function openAuth () {
    console.log('opening auth');
    setShowAuth(true);
  }

  function expiryCountDown (expiry) {
    let secondsToExpiry = expiry - (Math.round(Date.now() / 1000));
    const interval = setInterval(() => {
      const updatedSecondsToExpiry = expiry - (Math.round(Date.now() / 1000));
      if (updatedSecondsToExpiry >= 0 && updatedSecondsToExpiry !== secondsToExpiry) {
        secondsToExpiry = updatedSecondsToExpiry;
        displayTimeLeft(secondsToExpiry);
      }
      if (updatedSecondsToExpiry <= 0) {
        clearInterval(interval);
        disableTerminal();
      }
    }, 250);
  }

  function disableTerminal () {
    setTermEnabled(false);
  }

  function displayTimeLeft (secondsToExpiry) {
    const minutes = (Math.trunc(secondsToExpiry / 60)).toString().padStart(2, '0');
    const seconds = (secondsToExpiry % 60).toString().padStart(2, '0');
    setTimeLeftDisplay(`${minutes}:${seconds}`);
  }

  function resize (event, startEvent) {
    const initialCmWidth = cmContainerDOMRef.current.offsetWidth;
    const initialTermWidth = termContainerDomRef.current.offsetWidth;
    const resizeBarWidth = resizeBarDOMRef.current.offsetWidth;
    const deltaX = event.clientX - initialX.current;
    const leftBoundary = minCmWidth;
    const rightBoundary = (initialCmWidth + resizeBarWidth + initialTermWidth) - minTermWidth;
    let newCmWidth = initialCmWidth + deltaX;
    let newTermWidth = initialTermWidth - deltaX;

    if (event.clientX < leftBoundary || event.clientX > rightBoundary) {
      return;
    }
    if (newCmWidth < minCmWidth) {
      newCmWidth = minCmWidth;
    }
    if (newTermWidth < minTermWidth) {
      newTermWidth = minTermWidth;
    }
    const newCmWidthString = parseFloat(newCmWidth, 10) + 'px';
    setCmWidth(newCmWidthString);

    const newTermWidthString = parseFloat(newTermWidth, 10) + 'px';
    setTermWidth(newTermWidthString);

    initialX.current += deltaX;
  }

  function startResize (event) {
    const elem = resizeBarDOMRef.current;
    console.log('clientX: ' + event.clientX);
    initialX.current = event.clientX;
    elem.setPointerCapture(event.pointerId);

    elem.onpointermove = (moveEvent) => resize(moveEvent, event);
  }

  async function stopResize (event) {
    const elem = resizeBarDOMRef.current;
    elem.onpointermove = null;
    elem.releasePointerCapture(event.pointerId);
  }

  async function setup () {
    if (!(await roomExists(roomID))) {
      console.log('room does not exist');
      navigate('/');
      return;
    }

    // TODO: Set spinner while waiting, maybe
    // Get initial lang and terminal history from server
    const initialVars = await getInitialRoomData(roomID);
    const initialLang = initialVars.language;
    const initialHist = initialVars.history;
    const expiry = initialVars.expiry;
    if (expiry !== -1) {
      expiryCountDown(expiry);
    }

    const userInfo = await getUserInfo();
    if (userInfo.auth === true) {
      setAuthed(true);
      setUsername(userInfo.username);
      console.log('signed in as: ' + userInfo.username);
    }

    setLanguage(initialLang);
    showTitles(initialLang);
    term.current = new Terminal();
    term.current.open(termDomRef.current);
    term.current.write(initialHist);
    term.current.onData((data) => {
      ws.current.send(data.toString());
    });
    ws.current = openWs(roomID);

    const cm = CodeMirror.fromTextArea(codeAreaDOMRef.current, {
      mode: initialLang,
      value: '',
      lineNumbers: true,
      autoCloseBrackets: true,
      theme: 'tomorrow-night-bright'
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
    // offline can automatically return to home page if room
    // has closed.
    window.addEventListener('online', () => {
      console.log('now online');
      location.reload();
    });
    setShowMain(true);
  }

  async function getUserInfo () {
    const options = {
      method: 'GET',
      mode: 'cors'
    };

    try {
      const response = await fetch('/api/get-user-info', options);
      const json = await response.json();
      return json;
    } catch (error) {
      console.log('Error fetching auth status: ' + error);
      return false;
    }
  }

  async function getInitialRoomData (roomID) {
    const options = {
      method: 'GET',
      mode: 'cors'
    };

    // TODO: Check if successful (status code 200) before processing
    try {
      const response = await fetch(`/api/get-initial-room-data?roomID=${roomID}`, options);
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

  function showTitles (lang) {
    switch (lang) {
    case 'node':
      setReplTitle('Node.js REPL');
      setCmTitle('Node.js');
      break;
    case 'ruby':
      setReplTitle('Ruby REPL (Pry)');
      setCmTitle('Ruby');
      break;
    case 'postgres':
      setReplTitle('psql');
      setCmTitle('PostgreSQL');
      break;
    }
  }

  function switchLanguage (lang) {
    codeOptions.current.set('language', lang);

    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Length': '0' }
    };

    fetch(`/api/switchlanguage?roomID=${roomID}&lang=${lang}`, options)
      .then(response => {
        console.log(response);
        termDomRef.current.scroll({ top: 0, left: 0, behavior: 'smooth' });
        showTitles(lang);
      });
  }

  function setTerminalClearFlag () {
    flags.current.set('signal', 'clearTerminal');
  }

  // TODO: Make this work for Ctrl-L too
  function clearTerminal () {
    term.current.clear();
    termDomRef.current.scroll({ top: 0, left: 0, behavior: 'smooth' });
    const { lastLine } = getLastTermLineAndNumber();
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
        flags.current.set('signal', '');
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

  function getLastTermLineAndNumber () {
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
    return { lastLine: lines[lastLineNum], lastLineNum };
  }

  // TODO: Deactivate run button while this is in progress (among
  // other controls, such as language switcher)
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
      term.current.scrollToBottom();
      const { lastLineNum } = getLastTermLineAndNumber();
      const totalLines = term.current.rows;
      // If terminal is almost or totally full, make sure we
      // scroll all the way down when new text is entered
      if (lastLineNum > totalLines - 10) {
        termDomRef.current.scrollBy(0, 5000);
      }
    };

    return ws;
  }

  // TODO: This should be debounced so that it is only sent once
  // even if user clicks multiple times
  function executeContent () {

    // Check whether repl is at a prompt
    const prompt = /> $/;
    const { lastLine } = getLastTermLineAndNumber();
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
    case ('node'):
      filename = 'code.js';
      break;
    case ('postgres'):
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
