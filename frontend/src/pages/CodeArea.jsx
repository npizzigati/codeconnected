'use strict';

import React, { useRef, useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { CSSTransition } from 'react-transition-group';
import PuffLoader from 'react-spinners/PuffLoader';

import * as Y from 'yjs';
// Import custom y-codemirror.js
import { CodemirrorBinding } from '../utilities/y-codemirror.js';
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
import PopupDialog from './components/PopupDialog.jsx';
import Participants from './components/Participants.jsx';
import Invite from './components/Invite.jsx';

import { handlePointerDown, debounce, changeCSSInnerHeight, setupWindowResizeListener } from '../helpers/miscUtils.js';

// TODO: Somehow ping the server to deal with the case where the
// room is closed with a client still attached, as in when I shut
// down the server with rooms still open. Currently the client's
// terminals just freeze.
function CodeArea () {
  const navigate = useNavigate();
  const params = useParams();
  const roomID = params.roomID;
  const initialTermRows = 200;
  const initialTermCols = 80;
  const fakeScrollHeight = 100000;
  const fakeScrollMidpoint = 50000;
  const runButtonDomRef = useRef(null);
  const stopButtonDomRef = useRef(null);
  const authDomRef = useRef(null);
  const codeAreaDomRef = useRef(null);
  const cmContainerDomRef = useRef(null);
  const termDomRef = useRef(null);
  const termContainerDomRef = useRef(null);
  const termScrollportDomRef = useRef(null);
  const termScrollLayerDomRef = useRef(null);
  const editorTitleDomRef = useRef(null);
  const replTitleDomRef = useRef(null);
  const editorTitleRowDomRef = useRef(null);
  const replTitleRowDomRef = useRef(null);
  const backToHomeDialogDomRef = useRef(null);
  const prevTermClientHeight = useRef(0);
  const term = useRef(null);
  const setupDone = useRef(false);
  const ws = useRef(null);
  const wsProvider = useRef(null);
  const flagClear = useRef(null);
  const codeOptions = useRef(null);
  const cmRef = useRef(null);
  const lang = useRef(null);
  const username = useRef(null);
  const participants = useRef(null);
  const [participantNames, setParticipantNames] = useState(null);
  const codeSessionID = useRef(-1);
  const running = useRef(false);
  const [language, setLanguage] = useState('');
  const ydoc = useRef(null);
  const resizeBarDomRef = useRef(null);
  const resizerOverlayDomRef = useRef(null);
  const initialX = useRef(null);
  const [cmWidth, setCmWidth] = useState('50%');
  const [termWidth, setTermWidth] = useState('50%');
  const [minCmWidth, minTermWidth] = [150, 150];
  const [replTitle, setReplTitle] = useState('');
  const [cmTitle, setCmTitle] = useState('');
  const [showContent, setShowContent] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showCodeMirror, setShowCodeMirror] = useState(false);
  const [runnerReady, setRunnerReady] = useState(false);
  const [termEnabled, setTermEnabled] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [timeLeftDisplay, setTimeLeftDisplay] = useState(null);
  const [showBackToHomeDialog, setShowBackToHomeDialog] = useState(false);
  const [popupMessage, setPopupMessage] = useState('');
  let termWriteTimeout;

  const popupDialogConfig = {
    message: {
      icon: { path: './images/attention.png', alt: 'Attention' },
      text: 'Do you really want to exit this session?'
    },
    options: [
      {
        number: 1,
        icon: { path: './images/run.png', alt: 'Login' },
        text: 'Yes, take me back to the home page.',
        callback: () => navigate('/')
      },
      {
        number: 2,
        icon: { path: './images/stop.png', alt: 'Time-limited' },
        text: 'No, I want to stay here.',
        callback: abortBackToHome
      }
    ],
    abortCallback: abortBackToHome,
    theme: 'dark'
  };

  function abortBackToHome () {
    setShowBackToHomeDialog(false);
  }

  function closeModals () {
    setShowBackToHomeDialog(false);
  }

  useEffect(() => {
    let isCanceled = false;
    function onlineEventHandler () {
      console.log('now online');
      location.reload();
    }
    // When resizing screen, it's useful to have the body be the
    // same color as the content background, to avoid background
    // artifacts
    document.body.style.backgroundColor = '#0d1117';
    // Check whether room exists when user comes online. This
    // is so that users returning from sleep or otherwise being
    // offline can automatically return to home page if room
    // has closed.
    window.addEventListener('online', onlineEventHandler);

    // Fire custom events on keydown
    document.addEventListener('keydown', fireKeydownEvents);

    // If escape custom event fires, close this component's modal dialogs
    document.addEventListener('escapePressed', closeModals);

    // Fix to solve viewport problem on iOS devices
    // (Before fix, footer was not always fixed at bottom of
    // screen.)
    setupWindowResizeListener(() => {
      debounce(changeCSSInnerHeight, 100);
      debounce(adjustHeaderDisplay, 100);
      debounce(sanelyAdjustPanelWidths, 300);
    });

    (async () => {
      await setup(isCanceled);
    })();

    return function cleanup () {
      window.removeEventListener('online', onlineEventHandler);
      document.removeEventListener('keydown', fireKeydownEvents);
      document.removeEventListener('escapePressed', closeModals);
      removeUserFromParticipants();
      isCanceled = true;
    };
  }, []);

  useEffect(() => {
    if (!setupDone.current) {
      return;
    }
    (async () => {
      await setupUser();
    })();
  }, [authed]);

  return (
    <>
      <div className='popup-container'>
        <div className='popup'>{popupMessage}</div>
      </div>
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
        <CSSTransition
          in={showAuth}
          timeout={300}
          classNames='react-css-transition-auth-dialog'
          nodeRef={authDomRef}
          mountOnEnter
          unmountOnExit
        >
          <div className='auth' ref={authDomRef}>
            <Auth setShowAuth={setShowAuth} setAuthed={setAuthed} config={{}} />
          </div>
        </CSSTransition>
        <CSSTransition
          in={showBackToHomeDialog}
          timeout={300}
          classNames='react-css-transition-popup-dialog'
          nodeRef={backToHomeDialogDomRef}
          mountOnEnter
          unmountOnExit
        >
          <div ref={backToHomeDialogDomRef}>
            <PopupDialog config={popupDialogConfig} />
          </div>
        </CSSTransition>
        <header>
          <div className='flex-pane flex-container flex-container--constrained flex-container--vert-top flex-container--spread-out'>
            <div
              className='media u-marg-left-1'
            >
              <div
                className='media__image-container u-clickable'
                onPointerDown={(ev) => handlePointerDown(ev, setShowBackToHomeDialog, true)}
              >
                <img className='media__image media__image--tinier' src='./images/codeconnected.png' alt='Logo' />
              </div>
              <div
                className='media__text'
                onPointerDown={(ev) => handlePointerDown(ev, setShowBackToHomeDialog, true)}
              >
                <div className='site-name site-name--small u-clickable'>
                  <span className='site-name--color1'>code</span>
                  <span className='site-name--color2'>connected</span>
                </div>
              </div>
            </div>
            {timeLeftDisplay !== null &&
              <div className='time-remaining u-marg-top-1'>
                Time remaining: {timeLeftDisplay}
              </div>}
          </div>
          <div className='flex-pane flex-container flex-container--right-justified flex-container--vert-centered flex-container--gap u-marg-right-1 u-marg-bot-5'>
            <Participants participantNames={participantNames} />
            <Invite />
            <div className='sign-in-block'>
              {authed
                ? <div><UserQuickdash setAuthed={setAuthed} /></div>
                : <div
                    className='sign-in-link'
                    onPointerDown={(ev) => handlePointerDown(ev, setShowAuth, true)}
                  >
                    Sign in
                  </div>}
            </div>
          </div>
        </header>
        <main>
          <div
            ref={cmContainerDomRef}
            className='codemirror-container'
            style={{ width: cmWidth }}
          >
            <div className={'editor-title-row' + (runnerReady ? '' : ' hidden')} ref={editorTitleRowDomRef}>
              <div className='editor-title flex-pane' ref={editorTitleDomRef}>Code Editor</div>
              <Select
                options={[{ value: 'ruby', label: 'Ruby' },
                          { value: 'node', label: 'JavaScript' },
                          { value: 'postgres', label: 'PostgreSQL' }]}
                title={cmTitle}
                callback={(ev) => {
                  lang.current = ev.target.dataset.value;
                  switchLanguage(lang.current);
                  updateCodeSession();
                }}
                config={{ staticTitle: true }}
              />
              <div className='run-button' ref={runButtonDomRef} onClick={executeContent}>Run</div>
              <div className='stop-button hidden' ref={stopButtonDomRef} onClick={stopRun}>Stop</div>
            </div>
            <div className='codemirror-wrapper'>
              {showCodeMirror &&
                <textarea
                  ref={codeAreaDomRef}
                />}
            </div>
          </div>
          <div
            ref={resizeBarDomRef}
            className='resizer'
          >
            <div className='resizer__handle' />
            <div
              className='resizer__overlay'
              ref={resizerOverlayDomRef}
              onPointerDown={(ev) => handlePointerDown(ev, startResize, ev)}
              onPointerUp={stopResize}
            />
          </div>
          <div
            className='terminal-container'
            ref={termContainerDomRef}
            style={{ width: termWidth }}
          >
            <div className={'repl-title-row' + (runnerReady ? '' : ' hidden')} ref={replTitleRowDomRef}>
              <div className='repl-title' ref={replTitleDomRef}>{replTitle}</div>
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
                    onPointerDown={(ev) => handlePointerDown(ev, focusTerminal, ev)}
                  />
                </div>
                <div
                  ref={termDomRef}
                  className='terminal-wrapper'
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

  /**
   * Reset codemirror, terminal panes to sane widths
   */
  function sanelyAdjustPanelWidths () {
    if (cmContainerDomRef.current === null || termContainerDomRef === null) {
      return;
    }
    const currentCmWidth = cmContainerDomRef.current.offsetWidth;
    const currentTermWidth = termContainerDomRef.current.offsetWidth;
    const totalWidth = currentCmWidth + currentTermWidth;
    const totalMinWidth = minCmWidth + minTermWidth;
    // If no user-resizing is possible (panel widths total more
    // than total possible minimum widths), set panels to equal
    // half width
    if (totalWidth < totalMinWidth) {
      const halfWidthString = pixelfy((currentCmWidth + currentTermWidth) / 2, true);
      cmContainerDomRef.current.style.width = halfWidthString;
      termContainerDomRef.current.style.width = halfWidthString;
    } else if (currentCmWidth < minCmWidth) {
      // Otherwise set either pane that is below the minimum to its
      // minimum width
      const delta = minCmWidth - currentCmWidth;
      termContainerDomRef.current.style.width = pixelfy(currentTermWidth - delta, true);
      cmContainerDomRef.current.style.width = pixelfy(minCmWidth, true);
    } else if (currentTermWidth < minTermWidth) {
      const delta = minTermWidth - currentTermWidth;
      cmContainerDomRef.current.style.width = pixelfy(currentCmWidth - delta, true);
      termContainerDomRef.current.style.width = pixelfy(minTermWidth, true);
    }
  }

  /**
   * return a pixel unit as a string for a number
   */
  function pixelfy (number, round) {
    if (round) {
      number = Math.round(number);
    }
    return number.toString() + 'px';
  }

  function removeUserFromParticipants () {
    if (participants.current === null) {
      return;
    }
    participants.current.delete(ydoc.current?.clientID.toString());
  }

  async function setupUser () {
    const userInfo = await getUserInfo();
    if (userInfo.auth) {
      setAuthed(true);
      username.current = userInfo.username;
    } else {
      username.current = 'Guest';
    }
    wsProvider.current.awareness.setLocalStateField('user', { color: 'rgba(228, 228, 288, 0.5)', name: username.current });
    const currentTime = Date.now();
    const participantDetails = new Y.Map();
    participantDetails.set('name', username.current);
    participantDetails.set('lastRollCall', currentTime);
    participantDetails.set('joinTime', currentTime);
    const stringID = ydoc.current.clientID.toString();
    // Only add participant if they are not in the map already
    if (participants.current.get(stringID) === undefined) {
      participants.current.set(stringID, participantDetails);
    }
    // Remove participant immediately if user leaves room. Note
    // that this doesn't handle the case of a user leaving room
    // because of losing the connection or device sleeping --
    // that is handled by the roll call/prune interval procedure
    window.addEventListener('beforeunload', () => removeUserFromParticipants());
    // For iOS
    window.addEventListener('pagehide', () => removeUserFromParticipants());
  }

  function fireKeydownEvents (event) {
    // Escape is keyCode 27
    if (event.keyCode === 27) {
      document.dispatchEvent(new Event('escapePressed'));
    }
    // If focus is on codemirror and key is pressed, trigger Yjs
    // awareness change to signal to y-codeimrror.js to show
    // remote caret and name tooltip (because user is typing)
    if (cmContainerDomRef.current.contains(document.activeElement)) {
      wsProvider.current.awareness.setLocalStateField('keyPing', Date.now());
    }
  }

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

  /**
   * Hide or show codemirror and repl header items depending on
   * pane width
   */
  function adjustHeaderDisplay () {
    if (cmContainerDomRef.current === null || termContainerDomRef.current === null) {
      return;
    }
    const cmWidth = cmContainerDomRef.current.offsetWidth;
    if (cmWidth < 270) {
      editorTitleDomRef.current.classList.add('hidden');
    } else {
      editorTitleDomRef.current.classList.remove('hidden');
    }

    const termWidth = termContainerDomRef.current.offsetWidth;
    if (termWidth < 220) {
      replTitleDomRef.current.classList.add('hidden');
    } else {
      replTitleDomRef.current.classList.remove('hidden');
    }
  }

  /**
   * Resize codemirror and terminal panes, proportionally
   */
  function resize (event) {
    const initialCmWidth = cmContainerDomRef.current.offsetWidth;
    const initialTermWidth = termContainerDomRef.current.offsetWidth;
    const resizeBarWidth = resizeBarDomRef.current.offsetWidth;
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
    setCmWidth(pixelfy(newCmWidth, true));
    setTermWidth(pixelfy(newTermWidth, true));
    debounce(adjustHeaderDisplay, 20);

    initialX.current += deltaX;
  }

  function startResize (event) {
    // Prevent any elements from being selected (causing flicker)
    // when resizing (a webkit browser problem)
    document.body.classList.add('is-resizing');
    const elem = event.target;
    if (event.pointerType === 'touch') {
      // Temporarily increase resizer overlay width, to make it
      // less likely that pointer will leave the area
      elem.classList.add('resizer__overlay-wide');
      // On iOS, the pointer can leave the resizer overlay with the
      // tap still down, which stops the resize, but we need to
      // call stopResize
      elem.onpointerleave = (leaveEvent) => {
        stopResize(event);
      };
    }
    initialX.current = event.clientX;
    elem.setPointerCapture(event.pointerId);
    elem.onpointermove = (moveEvent) => resize(moveEvent);
  }

  function showPopup (message) {
    setPopupMessage(message);
    setTimeout(() => {
      setPopupMessage('');
    }, 2000);
  }

  async function stopResize (event) {
    const elem = event.target;
    elem.classList.remove('resizer__overlay--wide');
    document.body.classList.remove('is-resizing');
    elem.onpointermove = null;
    elem.onpointerleave = null;
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
    const body = JSON.stringify({ roomID, rows: initialTermRows, cols: initialTermCols });
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

    cmRef.current = setupCodeMirror();

    if (isCanceled) {
      return;
    }

    setLanguage(initialLang);
    lang.current = initialLang;
    setCmLanguage(initialLang);
    showTitles(initialLang);

    setupTerminal(initialHist);

    ws.current = openWs(roomID);

    // Collaborative editing
    // Code editor
    ydoc.current = new Y.Doc();

    const ytextCode = ydoc.current.getText('codemirror');

    // y.js connection provider
    wsProvider.current = new WebsocketProvider(
      window.location.origin.replace(/^http/, 'ws') + '/ywebsocketprovider', 'nicks-cm-room-' + roomID, ydoc.current
    );

    const binding = new CodemirrorBinding(ytextCode, cmRef.current, wsProvider.current.awareness);

    participants.current = ydoc.current.getMap('participants');
    participants.current.observe(ev => {
      buildParticipantNameList();
    });

    const rollCallIntervalSeconds = 2;
    const pruneIntervalSeconds = 10;
    const participantRollCallInterval = setInterval(() => {
      if (isCanceled) {
        clearInterval(participantRollCallInterval);
        return;
      }
      const id = ydoc.current?.clientID.toString();
      if (id === undefined) {
        return;
      }
      const participant = participants.current.get(id);
      // Participant will be undefined if device wakes up and
      // reconnects to site
      if (participant === undefined) {
        setupUser();
      }
      participant?.set('lastRollCall', Date.now());
    }, rollCallIntervalSeconds * 1000);

    const participantPruneInterval = setInterval(() => {
      if (isCanceled) {
        clearInterval(participantPruneInterval);
        return;
      }
      const thisUserId = ydoc.current?.clientID.toString();
      // If user has just joined (or rejoined), they shouldn't
      // run the prune
      if (participants.current.get(thisUserId) === undefined ||
          Date.now() - participants.current.get(thisUserId).get('joinTime') < pruneIntervalSeconds * 1000) {
        return;
      }
      const toRemove = [];
      participants.current.forEach((details, id) => {
        // If self, do nothing
        if (id === thisUserId) {
          return;
        }
        // If more than x ms have passed since a successful roll
        // call, mark participant for removal
        if ((Date.now() - details.get('lastRollCall')) > rollCallIntervalSeconds * 2 * 1000) {
          toRemove.push(id);
        }
      });
      // Remove marked participants
      toRemove.forEach(id => {
        participants.current.delete(id);
      });
    }, pruneIntervalSeconds * 1000);

    flagClear.current = ydoc.current.getArray('flag-clear');
    flagClear.current.observe(ev => {
      clearTerminal();
    });

    const yCodeOptions = ydoc.current.getMap('code options');
    yCodeOptions.observe(ev => {
      const newLang = ev.target.get('language');
      lang.current = newLang;
      setLanguage(newLang);
      setCmLanguage(newLang);
      showTitles(newLang);
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
      cmRef.current.setValue(initialContent);
    }
    setRunnerReady(true);
    setRoomStatusOpen(roomID);
    setupTerminalScroll();
    setupResizeEventListener();
    setPrevTermClientHeight();
    await setupUser();
    setupDone.current = true;
  }

  function buildParticipantNameList () {
    // Put this user's name first on list and append with '(you)'
    const nameList = [];
    participants.current.forEach((details, clientID) => {
      if (clientID === ydoc.current.clientID.toString()) {
        nameList.unshift(details.get('name') + ' (you)');
      } else {
        nameList.push(details.get('name'));
      }
    });
    setParticipantNames(nameList);
  }

  function setupTerminal (initialHist) {
    term.current = new Terminal({
      fontSize: 12,
      fontFamily: 'courier, monospace'
    });
    term.current.open(termDomRef.current);
    term.current.resize(term.current.cols, initialTermRows);
    writeToTerminal(initialHist);
    term.current.onData((data) => {
      // If ctrl-l (lowecase L) pressed
      if (data.charCodeAt() === 12) {
        setTerminalClearFlag();
      } else {
        ws.current.send(data.toString());
      }
    });
  }

  function setupCodeMirror () {
    const cm = CodeMirror.fromTextArea(codeAreaDomRef.current, {
      inputStyle: 'textarea',
      value: '',
      lineNumbers: true,
      autoCloseBrackets: true,
      lineWrapping: true,
      indentUnit: 2,
      tabSize: 2,
      theme: 'tomorrow-night-bright',
      keyMap: 'sublime',
      scrollbarStyle: 'overlay',
    });

    cm.setSize('100%', '100%');

    // Use Ctrl-Enter to run code
    cm.setOption('extraKeys', {
      'Ctrl-Enter': executeContent,
      Tab: betterTab
    });

    // // Make wrapped lines indent
    // // This is commented out because it causes a bug in
    // // y-codemirror that makes the remote caret name lag
    // // behind the cursor on a new line started with spaces
    // const charWidth = cm.defaultCharWidth();
    // const basePadding = 4;
    // cm.on('renderLine', function (editor, line, elt) {
    //   const off = CodeMirror.countColumn(line.text, null, editor.getOption('tabSize')) * charWidth;
    //   elt.style.textIndent = '-' + off + 'px';
    //   elt.style.paddingLeft = (basePadding + off) + 'px';
    // });

    return cm;
  }

  function betterTab (editor) {
    if (editor.somethingSelected()) {
      editor.indentSelection('add');
    } else {
      const spaces = Array(editor.getOption('indentUnit') + 1).join(' ');
      editor.replaceSelection(spaces);
    }
  }

  function setPrevTermClientHeight () {
    // termDomRef.current.clientHeight may initially be
    // "undefined", so try until it is a number
    const interval = setInterval(() => {
      const clientHeight = termDomRef.current?.clientHeight;
      if (typeof clientHeight !== 'number') {
        return;
      }
      prevTermClientHeight.current = clientHeight;
      clearInterval(interval);
    }, 100);
  }

  function focusTerminal (ev) {
    ev.preventDefault();
    if (ev.pointerType === 'mouse') {
      term.current?.focus();
    } else {
      // Wait a fraction of a second before focusing, since focus
      // won't stick in some mobile browsers (i.e., pointerType
      // not mouse) if we apply it immediately
      setTimeout(() => {
        term.current?.focus();
      }, 500);
    }
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
    // Set contentEditable and inputMode so that keyboard will
    // pop up on ipad when tapping on the area (focus will be
    // passed to xterm.js through event listener)
    termScrollLayerDomRef.current.setAttribute('contentEditable', true);
    termScrollLayerDomRef.current.setAttribute('inputMode', 'text');
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

  function setCmLanguage (newLang) {
    let cmLangMode;
    switch (newLang) {
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
      setCmTitle('JavaScript');
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
    if (termDomRef.current === null) {
      return;
    }
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
    // We don't care about the value added, we just want to
    // trigger the observe event
    flagClear.current.push([1]);
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

  // xterm.js returns long lines intact when getting the text
  // from a selection, regardless of how it looks on the screen
  // (i.e., there are no hard line breaks where the terminal
  // visually breaks at the max column number).
  // Insert a hard line break in each line over max columns at
  // each max column interval
  function insertHardLineBreaks (text) {
    let cnt = 0;
    const newArr = [];
    for (let i = 0; i < text.length; i++) {
      cnt++;
      if (cnt > initialTermCols) {
        newArr.push('\n' + text[i]);
        cnt = 1;
        continue;
      } else if (text[i] === '\n') {
        newArr.push('\n');
        cnt = 0;
        continue;
      } else {
        newArr.push(text[i]);
      }
    }
    return newArr.join('');
  }

  function getLastTermLineAndNumber () {
    let text = getTerminalText();
    text = insertHardLineBreaks(text);
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
  function runCode (filename, lines, promptLineEmpty) {
    const body = JSON.stringify({ roomID: params.roomID, lang: lang.current, filename, lines, promptLineEmpty });
    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: body
    };
    console.log('promptLineEmpty: ' + promptLineEmpty);
    fetch('/api/runfile', options)
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
      } else if (ev.data === 'RUNTIMEOUT') {
        console.log('RUN TIMEOUT!!!!!!!!!!');
      } else if (ev.data === 'RUNDONE' || ev.data === 'CANCELRUN') {
        running.current = false;
        runButtonDone();
        deleteReplHistory();
      } else {
        writeToTerminal(ev.data);
      }
    };

    return ws;
  }

  function deleteReplHistory () {
    const body = JSON.stringify({ roomID: params.roomID, lang: lang.current });
    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: body
    };
    fetch('/api/delete-repl-history', options)
      .then(response => {
        console.log(response);
      });
  }

  function runButtonStart () {
    // Check whether repl is at a prompt
    runButtonDomRef.current.classList.add('running');
    // Seconds to wait before showing stop button
    const stopDisplayWait = 2;
    setTimeout(() => {
      if (!running.current) {
        return;
      }
      stopButtonDomRef.current.classList.remove('hidden');
      runButtonDomRef.current.classList.add('hidden');
    }, stopDisplayWait * 1000);
  }

  function runButtonDone () {
    stopButtonDomRef.current.classList.add('hidden');
    runButtonDomRef.current.classList.remove('hidden');
    runButtonDomRef.current.classList.remove('running');
  }

  function stopRun () {
    // Send ctrl-c
    ws.current.send('\x03');
  }

  function executeContent () {
    running.current = true;
    runButtonStart();
    const prompt = /> $/;
    const { lastLine } = getLastTermLineAndNumber();
    console.log('prompt ready? ' + prompt.test(lastLine));
    let promptLineEmpty = true;
    if (!prompt.test(lastLine)) {
      promptLineEmpty = false;
      console.log('Last line is not empty');
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
        runCode(filename, lines, promptLineEmpty);
      });
  }
}

export { CodeArea as default };
