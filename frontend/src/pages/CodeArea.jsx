'use strict';

import React, { useRef, useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import PuffLoader from 'react-spinners/PuffLoader';

import * as Y from 'yjs';
import { CodemirrorBinding } from 'y-codemirror';
import { WebrtcProvider } from 'y-webrtc';
import { WebsocketProvider } from 'y-websocket';

import CodeMirror from 'codemirror/lib/codemirror.js';
import 'codemirror/addon/edit/closebrackets.js';
import 'codemirror/addon/comment/comment.js';
import 'codemirror/addon/scroll/simplescrollbars.js';
import 'codemirror/mode/ruby/ruby.js';
import 'codemirror/mode/javascript/javascript.js';
import 'codemirror/mode/sql/sql.js';
import 'codemirror/keymap/sublime.js';

import { Terminal } from 'xterm';

import Select from './components/Select.jsx';
import UserQuickdash from './components/UserQuickdash.jsx';
import Auth from './components/Auth.jsx';

// TODO: Somehow ping the server to deal with the case where the
// room is closed with a client still attached, as in when I shut
// down the server with rooms still open. Currently the client's
// terminals just freeze.
function CodeArea () {
  const navigate = useNavigate();
  const params = useParams();
  const roomID = params.roomID;
  const initialTermRows = 200;
  const fakeScrollHeight = 100000;
  const fakeScrollMidpoint = 50000;
  const codeAreaDOMRef = useRef(null);
  const termDomRef = useRef(null);
  const termContainerDomRef = useRef(null);
  const termScrollportDomRef = useRef(null);
  const termScrollLayerDomRef = useRef(null);
  const prevTermClientHeight = useRef(0);
  const term = useRef(null);
  const ws = useRef(null);
  const wsProvider = useRef(null);
  const flags = useRef(null);
  const codeOptions = useRef(null);
  const cmRef = useRef(null);
  const lang = useRef(null);
  const username = useRef(null);
  const codeSessionID = useRef(-1);
  const [language, setLanguage] = useState('');
  // FIXME: Do I need this? Am I using the ydocRef anywhere?
  const [ydocRef, setYdocRef] = useState(null);
  const resizeBarDOMRef = useRef(null);
  const initialX = useRef(null);
  const [cmWidth, setCmWidth] = useState('50%');
  const [termWidth, setTermWidth] = useState('50%');
  const [minCmWidth, minTermWidth] = [450, 350];
  const [replTitle, setReplTitle] = useState('');
  const [cmTitle, setCmTitle] = useState('');
  const [showContent, setShowContent] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showCodeMirror, setShowCodeMirror] = useState(false);
  const [runnerReady, setRunnerReady] = useState(false);
  const [termEnabled, setTermEnabled] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [timeLeftDisplay, setTimeLeftDisplay] = useState(null);
  const cmContainerDOMRef = useRef(null);
  let termWriteTimeout;

  useEffect(() => {
    let isCanceled = false;
    function onlineEventHandler () {
      console.log('now online');
      location.reload();
    }
    // Check whether room exists when user comes online. This
    // is so that users returning from sleep or otherwise being
    // offline can automatically return to home page if room
    // has closed.
    window.addEventListener('online', onlineEventHandler);

    (async () => {
      await setup(isCanceled);
    })();

    return function cleanup () {
      window.removeEventListener('online', onlineEventHandler);
      isCanceled = true;
    };
  }, []);

  useEffect(() => {
    (async () => {
      const userInfo = await getUserInfo();
      if (userInfo.auth === true) {
        username.current = userInfo.username;
      } else {
        username.current = 'Guest';
      }
      if (wsProvider.current !== null) {
        wsProvider.current.awareness.setLocalStateField('user', { color: 'rgba(228, 228, 288, 0.5)', name: username.current });
      }
    })();
  }, [authed]);

  return (
    <>
      {!runnerReady &&
        <div>
          <div className='spinner-container'>
            <PuffLoader
              color='#369999'
              loading={!runnerReady}
              size={150}
            />
          </div>
          <div className='backdrop' />
        </div>}
      <div
        id='code-area'
        className={showContent ? 'visible' : 'hidden'}
      >
        {timeLeftDisplay !== null &&
          <div className='time-remaining'>
            Time remaining: {timeLeftDisplay}
          </div>}
        {showAuth &&
          <Auth setShowAuth={setShowAuth} setAuthed={setAuthed} config={{}} />}
        <header>
          <div className='flex-pane'>
            <div className='media u-marg-left-1'>
              <div className='media__image-container'>
                <img className='media__image media__image--tinier' src='./codeconnected.png' alt='Logo' />
              </div>
              <div className='media__text'>
                <div className='site-name site-name--small'>
                  <span className='site-name--color1'>code</span>
                  <span className='site-name--color2'>connected</span>
                </div>
              </div>
            </div>
          </div>
          <div className='flex-pane flex-pane--right-justified u-marg-right-1 u-marg-top-1'>
            {authed
              ? <div className='u-marg-left-auto'><UserQuickdash setAuthed={setAuthed} /></div>
              : <div
                  className='sign-in-link u-marg-left-auto'
                  onPointerDown={() => setShowAuth(true)}
                >
                  Sign in
                </div>}
          </div>
        </header>
        <main>
          <div
            ref={cmContainerDOMRef}
            id='codemirror-container'
            style={{ width: cmWidth }}
          >
            <div className={'title-row' + (runnerReady ? '' : ' hidden')}>
              <span className='editor-and-repl-title'>Code Editor</span>
              <span className='editor-lang-label'>Language:&nbsp;</span>
              <Select
                options={[{ value: 'ruby', label: 'Ruby' },
                          { value: 'node', label: 'Node.js' },
                          { value: 'postgres', label: 'PostgreSQL' }]}
                title={cmTitle}
                callback={(ev) => {
                  lang.current = ev.target.dataset.value;
                  switchLanguage(lang.current);
                  updateCodeSession();
                }}
                config={{ staticTitle: true }}
              />
              <button id='run-button' onClick={executeContent}>Run</button>
            </div>
            <div id='codemirror-wrapper'>
              {showCodeMirror &&
                <textarea
                  ref={codeAreaDOMRef}
                />}
            </div>
          </div>
          <div
            ref={resizeBarDOMRef}
            className='resizer'
            onPointerDown={startResize}
            onPointerUp={stopResize}
          >
            <div className='resizer__handle' />
          </div>
          <div
            id='terminal-container'
            ref={termContainerDomRef}
            style={{ width: termWidth }}
          >
            <div className={'title-row' + (runnerReady ? '' : ' hidden')}>
              <span className='editor-and-repl-title'>{replTitle}</span>
              <Select
                options={[{ value: 'clear', label: 'Clear' },
                          { value: 'reset', label: 'Reset' }]}
                title='Actions'
                callback={executeReplAction}
                config={{ staticTitle: true }}
              />
            </div>
            {termEnabled &&
              <div className='terminal-scrollport-container'>
                <div
                  className='terminal-scrollport'
                  ref={termScrollportDomRef}
                  onScroll={handleTerminalScroll}
                >
                  <div
                    className='terminal-scroll-layer'
                    ref={termScrollLayerDomRef}
                    onPointerDown={focusTerminal}
                  />
                </div>
                <div
                  ref={termDomRef}
                  id='terminal-wrapper'
                />
              </div>}
            {!termEnabled &&
              <div className='terminal-expired'>
                Terminal has expired.
              </div>}
          </div>
        </main>
      </div>
    </>
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
    // Prevent any elements from being selected (causing flicker)
    // when resizing (a webkit browser problem)
    document.body.classList.add('is-resizing');

    const elem = resizeBarDOMRef.current;
    initialX.current = event.clientX;
    elem.setPointerCapture(event.pointerId);
    elem.onpointermove = (moveEvent) => resize(moveEvent, event);
  }

  async function stopResize (event) {
    document.body.classList.remove('is-resizing');
    const elem = resizeBarDOMRef.current;
    elem.onpointermove = null;
    elem.releasePointerCapture(event.pointerId);
  }

  async function getCodeSessionID (roomID) {
    const body = JSON.stringify({ roomID });
    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: body
    };

    try {
      const response = await fetch('/api/get-code-session-id', options);
      const json = await response.json();
      console.log(JSON.stringify(json));
      return json.codeSessionID;
    } catch (error) {
      console.error('Error preparing room: ', error);
    }
    return -1;
  }

  function setRoomStatusOpen (roomID) {
    const body = JSON.stringify({ roomID });
    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: body
    };

    try {
      fetch('/api/set-room-status-open', options);
    } catch (error) {
      console.error('Error preparing room: ', error);
    }
  }

  async function prepareRoom (roomID, isCanceled) {
    const body = JSON.stringify({ roomID, rows: initialTermRows });
    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: body
    };

    try {
      const response = await fetch('/api/prepare-room', options);
      if (isCanceled) {
        return;
      }
      const json = await response.json();
      console.log(JSON.stringify(json));
      const status = json.status;
      if (status === 'ready') {
        console.log('Room successfully prepared');
        return json;
      } else {
        console.error('Error preparing room.');
      }
    } catch (error) {
      console.error('Error preparing room: ', error);
    }
    return -1;
  }

  async function setup (isCanceled) {
    if (!(await roomExists(roomID))) {
      if (isCanceled) {
        return;
      }
      console.log('room does not exist');
      navigate('/');
      return;
    }

    // Get room status. If room isn't ready (connected to
    // container), send request for it to be made ready.
    setShowContent(true);
    const { status } = await getRoomStatus(roomID);
    console.log(status);
    let initialContent = '';
    if (status === 'created') {
      console.log('Will prepare room');
      const json = await prepareRoom(roomID, isCanceled);
      codeSessionID.current = json.codeSessionID;
      initialContent = json.initialContent;
      console.log('codeSessionID: ' + codeSessionID.current);
      if (isCanceled) {
        return;
      }
    } else if (status === 'preparing') {
      console.log('Room is being prepared');
      // TODO: Show modal message that room is being prepared and
      // maybe retry at intervals
      return;
    }

    // Get initial lang and terminal history from server
    const initialVars = await getInitialRoomData(roomID);
    if (isCanceled) {
      return;
    }
    const initialLang = initialVars.language;
    const initialHist = initialVars.history;
    const expiry = initialVars.expiry;
    // isAuthedCreator will be true if this user is signed in and is
    // the creator of the room
    const isAuthedCreator = initialVars.isAuthedCreator;
    // If codeSessionID has not yet been set and user is the room
    // creator, that's because we restarted a session where the
    // room was still open (and ready). We need to get the
    // codeSessionID now for purposes of saving the session
    if (isAuthedCreator && codeSessionID.current === -1) {
      codeSessionID.current = await getCodeSessionID(roomID);
    }
    if (expiry !== -1) {
      expiryCountDown(expiry);
    }

    setShowCodeMirror(true);

    const cm = CodeMirror.fromTextArea(codeAreaDOMRef.current, {
      value: '',
      lineNumbers: true,
      autoCloseBrackets: true,
      theme: 'tomorrow-night-bright',
      keyMap: 'sublime',
      scrollbarStyle: 'overlay'
    });

    cm.setSize('100%', '100%');

    // Use Ctrl-Enter to run code
    cm.setOption('extraKeys', {
      'Ctrl-Enter': executeContent
    });

    // Copy a reference to code mirror editor to React state
    cmRef.current = cm;

    const userInfo = await getUserInfo();
    if (isCanceled) {
      return;
    }
    if (userInfo.auth === true) {
      setAuthed(true);
      username.current = userInfo.username;
      console.log('signed in as: ' + userInfo.username);
    }

    setLanguage(initialLang);
    lang.current = initialLang;
    setCmLanguage();
    showTitles(initialLang);
    term.current = new Terminal({
      fontSize: 12,
      fontFamily: 'courier, monospace'
    });
    term.current.open(termDomRef.current);
    term.current.resize(term.current.cols, initialTermRows);

    writeToTerminal(initialHist);
    term.current.onData((data) => {
      ws.current.send(data.toString());
    });

    ws.current = openWs(roomID);

    // Collaborative editing
    // Code editor
    const ydoc = new Y.Doc();
    setYdocRef(ydoc);

    const ytextCode = ydoc.getText('codemirror');

    // y.js connection providers
    const rtcProvider = new WebrtcProvider('nicks-cm-room-' + roomID, ydoc);
    // rtcProvider.awareness.setLocalStateField('user', { color: 'gray', name: 'me' });
    wsProvider.current = new WebsocketProvider(
      window.location.origin.replace(/^http/, 'ws') + '/ywebsocketprovider', 'nicks-cm-room-' + roomID, ydoc
    );
    wsProvider.current.awareness.setLocalStateField('user', { color: 'rgba(228, 228, 288, 0.5)', name: username.current });

    const binding = new CodemirrorBinding(ytextCode, cm, wsProvider.current.awareness);

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
      lang.current = ev.target.get('language');
      setLanguage(lang.current);
      setCmLanguage();
    });
    // Copy a reference to React state
    codeOptions.current = yCodeOptions;

    // If this is the creating user and they are signed in, send
    // code editor content to server at intervals to be saved
    if (isAuthedCreator) {
      // save delay in ms
      const saveDelay = 2000;
      // Update x (saveDelay) seconds after any changes in shared code editor
      let saveTimeout;
      ytextCode.observe(() => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => updateCodeSession(), saveDelay);
      });
    }

    if (initialContent.length > 0) {
      cm.setValue(initialContent);
    }
    setRunnerReady(true);
    setRoomStatusOpen(roomID);
    setupTerminalScroll();
    setupResizeEventListener();
    setPrevTermClientHeight();
  }

  function setPrevTermClientHeight () {
    // termDomRef.current.clientHeight may initially be
    // "undefined", so try until it is a number
    const interval = setInterval(() => {
      const clientHeight = termDomRef.current.clientHeight;
      if (typeof clientHeight !== 'number') {
        return;
      }
      prevTermClientHeight.current = clientHeight;
      clearInterval(interval);
    }, 100);
  }

  function focusTerminal (ev) {
    ev.preventDefault();
    term.current?.focus();
  }

  function setupResizeEventListener () {
    window.addEventListener('resize', () => {
      handleResize();
    });
  }

  function setupTerminalScroll () {
    termScrollLayerDomRef.current.style.height = fakeScrollHeight + 'px';
    const xtermViewportEl = document.querySelector('.xterm-viewport');
    termScrollLayerDomRef.current.style.width = xtermViewportEl.style.width;
    termScrollportDomRef.current.scrollTop = fakeScrollMidpoint;
  }

  function handleTerminalScroll (ev) {
    ev.preventDefault();
    // Horizontal scroll
    termDomRef.current.scrollLeft = termScrollportDomRef.current.scrollLeft;

    // Vertical scroll
    const delta = termScrollportDomRef.current.scrollTop - fakeScrollMidpoint;
    // Do not respond to very small deltas, to avoid noise
    if (delta > -1 && delta < 1) {
      return;
    }
    const direction = (delta > 0) ? 'down' : 'up';
    // Subtract 1 from scrollHeight - clientHeight to provide a
    // range threshold, to account for fact that these properties
    // are integers and scrollTop is fractional
    const maxScrollTop = (termDomRef.current.scrollHeight - termDomRef.current.clientHeight) - 1;
    if (direction === 'up' && termDomRef.current.scrollTop === 0) {
      term.current.scrollLines(getLinesToScroll(delta));
    } else if (direction === 'down' && termDomRef.current.scrollTop > maxScrollTop) {
      term.current.scrollLines(getLinesToScroll(delta));
    } else if (direction === 'down') {
      // Do not allow scrolling below point where last line is visible
      termDomRef.current.scrollBy(0, getAdjustedScrollDownDelta(delta));
    } else {
      // Default case
      termDomRef.current.scrollBy(0, delta);
    }
    // Reset fake scroll bar back to midpoint
    termScrollportDomRef.current.scrollTop = fakeScrollMidpoint;

    function getLinesToScroll (delta) {
      const lines = Math.round(delta / 2);
      return lines;
    }
  }

  function setCmLanguage () {
    let cmLangMode;
    switch (lang.current) {
    case 'node':
      cmLangMode = 'javascript';
      break;
    case 'ruby':
      cmLangMode = 'ruby';
      break;
    case 'postgres':
      cmLangMode = 'sql';
      break;
    }
    cmRef.current.setOption('mode', cmLangMode);
  }

  async function updateCodeSession () {
    const content = cmRef.current.getValue();
    const body = JSON.stringify({ codeSessionID: codeSessionID.current, language: lang.current, content });
    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: body
    };
    try {
      const response = await fetch('/api/update-code-session', options);
      const json = await response.json();
      const status = json.status;
      if (status === 'success') {
      } else {
        console.error('Error updating code session.');
      }
    } catch (error) {
      console.error('Error updating code session: ', error);
    }
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

  async function getRoomStatus (roomID) {
    const options = {
      method: 'GET',
      mode: 'cors'
    };

    try {
      const response = await fetch(`/api/get-room-status?roomID=${roomID}`, options);
      return await response.json();
    } catch (error) {
      console.error('Error fetching json:', error);
      return null;
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

  // Returns the distance in pixels from tne last line with code
  // to the bottom edge of the xterm viewport
  function getDistancePastBottom () {
    const { lastLineNum } = getLastTermLineAndNumber();
    // Last line num is zero indexed, so add one
    let heightRatio = (lastLineNum + 1) / initialTermRows;
    if (heightRatio > 1) {
      heightRatio = 1;
    }
    const lastLineHeight = heightRatio * termDomRef.current.scrollHeight;
    const lastLineScreenHeight = lastLineHeight - termDomRef.current.scrollTop;
    const bottomEdge = termDomRef.current.clientHeight;
    return lastLineScreenHeight - bottomEdge;
  }

  // Get the remainder to scroll down to the point where the line
  // in question is visible on the screen
  function getAdjustedScrollDownDelta (delta) {
    const distancePastBottom = getDistancePastBottom();
    let modifiedDelta;
    if (delta < distancePastBottom) {
      modifiedDelta = delta;
    } else if (distancePastBottom > 0) {
      // Limit scroll down
      modifiedDelta = distancePastBottom;
    } else {
      // Prevent scroll down
      modifiedDelta = 0;
    }
    return modifiedDelta;
  }

  function handleResize () {
    const threshold = 10;
    const delta = termDomRef.current.clientHeight - prevTermClientHeight.current;
    const distancePastBottom = getDistancePastBottom();
    // If last line was previously aligned to bottom, keep it that way
    if (distancePastBottom + delta > -threshold && distancePastBottom + delta < threshold) {
      alignLastLineToBottom();
    // Else if resize makes last line float above bottom, align
    // it to bottom
    } else if (distancePastBottom < -threshold) {
      alignLastLineToBottom();
    }
    prevTermClientHeight.current = termDomRef.current.clientHeight;
  }

  function alignLastLineToBottom () {
    // Do nothing if termainal has expired
    if (termDomRef.current === null) {
      return;
    }
    const bottomMargin = 5;
    const distancePastBottom = getDistancePastBottom();
    termDomRef.current.scrollBy(0, distancePastBottom + bottomMargin);
    if (distancePastBottom > 0) {
      // Also scroll xterm.js internal scrolling to bottom
      term.current.scrollToBottom();
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
    const { lastLine } = getLastTermLineAndNumber();
    const roomID = params.roomID;
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

    termDomRef.current.scroll({ top: 0, left: 0, behavior: 'smooth' });
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
    fetch(`/api/runfile?roomID=${params.roomID}&lang=${lang.current}&lines=${lines}`, options)
      .then(response => {
        console.log(response);
      });
  }

  function writeToTerminal (data) {
    term.current.write(data);
    clearTimeout(termWriteTimeout);
    termWriteTimeout = setTimeout(() => {
      alignLastLineToBottom();
    }, 100);
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
      writeToTerminal(ev.data);
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
    switch (lang.current) {
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
