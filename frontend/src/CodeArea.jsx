'use strict';

import React, { useRef, useEffect, useState, useReducer } from 'react';
import * as Y from 'yjs';
import CodeMirror from 'codemirror/lib/codemirror.js';
import 'codemirror/addon/edit/closebrackets.js';
import 'codemirror/mode/javascript/javascript.js';
import 'codemirror/theme/material.css';

import { CodemirrorBinding } from 'y-codemirror';
import { WebrtcProvider } from 'y-webrtc';
import { WebsocketProvider } from 'y-websocket';

function CodeArea ({ codeContent, setCodeContent }) {
  const isReplPendingResponse = useRef(false);
  const newReplBlobs = useRef([]);
  // This is the positive offset of the repl cursor from right to
  // left, from the right end cursor position
  const codeAreaDOMRef = useRef(null);
  const replAreaDOMRef = useRef(null);
  const replCaretDOMRef = useRef(null);
  const [sharedOutputRef, setSharedOutputRef] = useState('');
  const [replDisplayData, setReplDisplayData] = useState('');
  const [replData, setReplData] = useState('');
  const [outputDisplay, setOutputDisplay] = useState('');
  const [replTextWithCmd, setReplTextWithCmd] = useState({});
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

    // y.js connection providers
    const rtcProvider = new WebrtcProvider('nicks-cm-room', ydoc);
    // rtcProvider.awareness.setLocalStateField('user', { color: 'gray', name: 'me' });
    const wsProvider = new WebsocketProvider(
      window.location.origin.replace(/^http/, 'ws') + '/ywebsocketprovider', 'myroom', ydoc
    );
    wsProvider.awareness.setLocalStateField('user', { color: 'gray', name: 'me' });

    const binding = new CodemirrorBinding(ytextCode, cm, wsProvider.awareness);
    // Copy a reference to code mirror editor to React state
    setCmRef(cm);

    // Shared output text
    const ytextOutput = ydoc.getText('output text');
    // Copy a reference to the shared output to React state
    // TODO: Change these refs to use useRef instead of useState
    // and maybe drop the Ref suffix on the identifier
    setSharedOutputRef(ytextOutput);

    // Set listener to update output display on change in ytext
    // output variable
    ytextOutput.observe(ev => {
      setOutputDisplay(ev.target.toString());
    });

    // Shared repl data
    const yReplData = ydoc.getMap('repl data');
    yReplData.set('text', '');
    yReplData.set('caretOffset', 0);
    yReplData.set('cmd', '');
    yReplData.set('cmdStash', '');
    yReplData.set('cmdHistory', []);
    yReplData.set('cmdHistoryNum', 0);
    // yReplData.set('displayText', {});
    // Set reference for use in React
    setReplData(yReplData);

    // Shared repl display state
    const yReplDisplayData = ydoc.getMap('repl display');
    yReplDisplayData.set('text', {});
    setReplDisplayData(yReplDisplayData);

    yReplDisplayData.observe(ev => {
      const beforeCaret = ev.target.get('text').beforeCaret;
      const afterCaret = ev.target.get('text').afterCaret;
      const underCaret = ev.target.get('text').underCaret;

      setReplTextWithCmd({ beforeCaret, afterCaret, underCaret });
      scrolltoReplCaret();
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
      <button onClick={clearRepl}>Clear Repl</button>
      <div id='repl' ref={replAreaDOMRef} tabIndex='0' onKeyDown={handleKeyPress}>
        {replTextWithCmd.beforeCaret}
        <span id='repl-caret' ref={replCaretDOMRef}>{replTextWithCmd.underCaret}</span>
        {replTextWithCmd.afterCaret}
      </div>
      <textarea
        style={{ whiteSpace: 'pre-wrap' }}
        value={outputDisplay}
        readOnly
      />
    </>
  );

  function handleKeyPress (ev) {
    // console.log(`key: ${ev.key}`);
    // console.log(`keyCode: ${ev.keyCode}`);
    // Do not handle key if key value is not a single unicode
    // character or among select other keys
    if (
      !/^.$/u.test(ev.key) &&

      !['Enter', 'Backspace', 'ArrowLeft', 'ArrowRight',
        'ArrowUp', 'ArrowDown', 'Delete',
        'Home', 'End'].includes(ev.key)
    ) {
      return;
    }
    // Also do not handle key-combo if ctrl or meta modifier
    // pressed
    if (ev.ctrlKey === true || ev.metaKey === true) {
      return;
    }

    ev.preventDefault();
    // Do handle the following cases
    switch (ev.key) {
    case 'Enter':
      // Flag so that we remove current command when output is printed
      isReplPendingResponse.current = true;
      replData.set('caretOffset', 0);
      runCommand();
      break;
    case 'Backspace':
      backspace();
      break;
    case 'ArrowLeft':
      moveReplCaretLeft();
      break;
    case 'ArrowRight':
      moveReplCaretRight();
      break;
    case 'ArrowUp':
      cmdHistoryBack();
      break;
    case 'ArrowDown':
      cmdHistoryFwd();
      break;
    case 'Delete':
      deleteChar();
      break;
    case 'Home':
      goToStartOfCmd();
      break;
    case 'End':
      goToEndOfCmd();
      break;
    default:
      insertIntoCmd(ev.key);
      displayReplText();
    }
  }

  function goToStartOfCmd () {
    replData.set('caretOffset', replData.get('cmd').length);
    displayReplText();
  }

  function goToEndOfCmd () {
    replData.set('caretOffset', 0);
    displayReplText();
  }

  function cmdHistoryBack () {
    if (replData.get('cmdHistoryNum') >= replData.get('cmdHistory').length) {
      return;
    }
    if (replData.get('cmdHistoryNum') === 0) {
      replData.set('cmdStash', replData.get('cmd'));
    }
    replData.set('cmdHistoryNum', replData.get('cmdHistoryNum') + 1);
    const idx = replData.get('cmdHistory').length - replData.get('cmdHistoryNum');
    replData.set('cmd', replData.get('cmdHistory')[idx]);
    replData.set('caretOffset', 0);
    displayReplText();
  }

  function cmdHistoryFwd () {
    if (replData.get('cmdHistoryNum') <= 0) {
      return;
    }
    replData.set('cmdHistoryNum', replData.get('cmdHistoryNum') - 1);
    if (replData.get('cmdHistoryNum') === 0) {
      replData.set('cmd', replData.get('cmdStash'));
    } else {
      const idx = replData.get('cmdHistory').length - replData.get('cmdHistoryNum');
      replData.set('cmd', replData.get('cmdHistory')[idx]);
    }
    replData.set('caretOffset', 0);
    displayReplText();
  }

  function insertIntoCmd (char) {
    const insertIdx = replData.get('cmd').length - replData.get('caretOffset');
    replData.set('cmd', replData.get('cmd').slice(0, insertIdx) +
                          char + replData.get('cmd').slice(insertIdx));
  }

  function backspace () {
    if (replData.get('cmd').length === replData.get('caretOffset')) {
      return;
    }
    const deleteIdx = (replData.get('cmd').length - replData.get('caretOffset')) - 1;
    replData.set('cmd', replData.get('cmd').slice(0, deleteIdx) +
                          replData.get('cmd').slice(deleteIdx + 1));
    displayReplText();
  }

  function deleteChar () {
    if (replData.get('caretOffset') === 0) {
      return;
    }
    const deleteIdx = replData.get('cmd').length - replData.get('caretOffset');
    replData.set('cmd', replData.get('cmd').slice(0, deleteIdx) +
                          replData.get('cmd').slice(deleteIdx + 1));
    replData.set('caretOffset', replData.get('caretOffset') - 1);
    displayReplText();
  }

  function moveReplCaretLeft () {
    if (replData.get('cmd').length <= replData.get('caretOffset')) {
      return;
    }
    replData.set('caretOffset', replData.get('caretOffset') + 1);
    displayReplText();
  }

  function moveReplCaretRight () {
    if (replData.get('caretOffset') === 0) {
      return;
    }
    replData.set('caretOffset', replData.get('caretOffset') - 1);
    displayReplText();
  }

  function clearRepl () {
    replData.set('text', '');
    replData.set('cmd', '');
    runCommand();
    replData.set('text', replData.get('text').replace('\n', ''));
    displayReplText();
    document.getElementById('repl').focus();
  }

  function runCommand () {
    console.log('running command: ' + replData.get('cmd'));

    replData.set('cmdHistory', replData.get('cmdHistory').concat(replData.get('cmd')));
    replData.set('cmdHistoryNum', 0);
    replData.set('cmdStash', '');

    // If ws is closed/closing, open it again before sending command
    if (ws === null || ws.readyState === WebSocket.CLOSED ||
        ws.readyState === WebSocket.CLOSING) {
      const ws = openReplWs();
      ws.onopen = function () {
        console.log('Web socket is open');
        ws.send(replData.get('cmd'));
        setWs(ws);
      };
      return;
    }

    ws.send(replData.get('cmd'));
  }

  function openReplWs () {
    const ws = new WebSocket(window.location.origin.replace(/^http/, 'ws') +
                                        '/api/openreplws');

    let timeoutID = null;
    // TODO: set connection.binaryType to 'arraybuffer' to see if
    // we can remove the conversion happening below
    ws.onmessage = function (ev) {
      (() => {
        // First assemble blobs in an array and then process them
        // in order, to make sure the processing doesn't cause
        // misordering as the blobs arrive
        newReplBlobs.current.push(ev.data);
        // If this is the first message since command was sent,
        // reset command to empty.
        if (isReplPendingResponse.current === true) {
          replData.set('cmd', '');
          isReplPendingResponse.current = false;
        }
        if (timeoutID !== null) {
          clearTimeout(timeoutID);
        }
        // newReplBytes.current.push(charByte);
        // Send bytes to be converted into utf8 and displayed in
        // complete bunches, e.g. only display repl text when
        // over 100 milliseconds have passed since last byte was
        // recieved
        timeoutID = setTimeout(() => {
          (async () => {
            // Build byte array
            const byteArray = [];
            for (let i = 0; i < newReplBlobs.current.length; i++) {
              const byteBuf = await newReplBlobs.current[i].arrayBuffer();
              const byteView = new DataView(byteBuf);
              const byte = byteView.getUint8(0);
              byteArray.push(byte);
            }
            // convert to utf-8 string
            const arrayBuf = new Uint8Array(byteArray).buffer;
            const arrayView = new DataView(arrayBuf);
            const decoder = new TextDecoder('utf-8', { fatal: true });
            let newReplText;
            try {
              // decoder may throw an error
              newReplText = decoder.decode(arrayView);
              replData.set('text', replData.get('text') + newReplText);
              console.log('newReplText: ' + newReplText);
            } catch (err) {
              console.error(err);
              return;
            } finally {
              newReplBlobs.current = [];
              displayReplText();
            }
          })();
        }, 100);
      })();
    };
    return ws;
  }

  function scrolltoReplCaret () {
    if (isCaretVisible()) {
      return;
    }
    replCaretDOMRef.current.scrollIntoView();

    function isCaretVisible () {
      const caret = replCaretDOMRef.current.getBoundingClientRect();
      const container = replAreaDOMRef.current.getBoundingClientRect();
      return caret.bottom < container.bottom;
    }
  }

  function displayReplText () {
    console.log('displaying repl text');
    const textWithCmd = replData.get('text') + replData.get('cmd');
    // Caret positioning
    let beforeCaret, underCaret, afterCaret;
    if (replData.get('caretOffset') === 0) {
      beforeCaret = textWithCmd;
      underCaret = ' ';
      afterCaret = '';
    } else {
      const caretIdx = textWithCmd.length - replData.get('caretOffset');
      beforeCaret = textWithCmd.slice(0, caretIdx);
      underCaret = textWithCmd[caretIdx];
      afterCaret = textWithCmd.slice(caretIdx + 1);
    }
    replDisplayData.set('text', { beforeCaret, underCaret, afterCaret });
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
}

export { CodeArea as default };
