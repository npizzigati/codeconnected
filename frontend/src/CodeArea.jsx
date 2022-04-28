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
  // const replAreaDOMRef = useRef(null);
  // const replCaretDOMRef = useRef(null);
  // // const [sharedOutputRef, setSharedOutputRef] = useState('');
  // // const [outputDisplay, setOutputDisplay] = useState('');
  // const [replDisplayData, setReplDisplayData] = useState('');
  const [replData, setReplData] = useState('');
  const [replTextWithCmd, setReplTextWithCmd] = useState({});
  const [language, setLanguage] = useState(defaultLanguage);
  const [codeOptions, setCodeOptions] = useState(null);
  /* const [replFocused, setReplFocused] = useState(false); */
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
      console.log('term data: ' + data.toString());
      ws.current.send(data.toString());
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

    // Shared output text
    // setSharedOutputRef(ytextOutput);

    // Set listener to update output display on change in ytext
    // output variable
    // ytextOutput.observe(ev => {
    //   setOutputDisplay(ev.target.toString());
    // });

    const yCodeOptions = ydoc.getMap('code options');
    yCodeOptions.set('language', defaultLanguage);
    yCodeOptions.observe(ev => {
      const lang = ev.target.get('language');
      setLanguage(lang);
      cm.setOption('mode', lang);
      console.log('language is now: ' + lang);
    });

    setCodeOptions(yCodeOptions);

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
    // setReplDisplayData(yReplDisplayData);

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
      <button onClick={executeContent}>Run</button>
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
        {/*
        <div id='repl' ref={replAreaDOMRef} tabIndex='0' onKeyDown={handleKeyPress}>
          {replTextWithCmd.beforeCaret}
          <span id='repl-caret' ref={replCaretDOMRef}>{replTextWithCmd.underCaret}</span>
          {replTextWithCmd.afterCaret}
        </div>
        */}
      </div>
      {/* <textarea
        style={{ whiteSpace: 'pre-wrap' }}
        value={outputDisplay}
        readOnly
      />
      */}
    </>
  );

  function switchLanguage (ev) {
    codeOptions.set('language', ev.target.value);
  }

  function handleKeyPress (ev) {
    // console.log(`key: ${ev.key}`);
    // console.log(`keyCode: ${ev.keyCode}`);
    // Do not handle key if key value is not a single unicode
    // character or among select other keys
    // if (
    //   !/^.$/u.test(ev.key) &&

    //   !['Enter', 'Backspace', 'ArrowLeft', 'ArrowRight',
    //     'ArrowUp', 'ArrowDown', 'Delete',
    //     'Home', 'End'].includes(ev.key)
    // ) {
    //   return;
    // }
    // Also do not handle key-combo if ctrl or meta modifier
    // pressed
    // if (ev.ctrlKey === true || ev.metaKey === true) {
    //   return;
    // }
    // Ignore right alt key, to make it possible to try out
    //     unicode characters
    if (ev.key === 'AltGraph') {
      return;
    }

    ev.preventDefault();
    // Do handle the following cases
    switch (ev.key) {
    // case 'Enter':
    //   // Flag so that we remove current command when output is printed
    //   isReplPendingResponse.current = true;
    //   replData.set('caretOffset', 0);
    //   runCommand();
    //   break;
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
      // insertIntoCmd(ev.key);
      // testing this
      replData.set('cmd', ev.key);

      displayReplText();
      // Testing this to see if single key input works
      runCommand();
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

  // function clearRepl () {
  //   replData.set('text', '');
  //   replData.set('cmd', '');
  //   runCommand();
  //   replData.set('text', replData.get('text').replace('\n', ''));
  //   displayReplText();
  //   document.getElementById('repl').focus();
  // }

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
    ws.onmessage = handleIncomingBytes;
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

  // function openReplWs () {
  //   const ws = new WebSocket(window.location.origin.replace(/^http/, 'ws') +
  //                                       '/api/openreplws');
  //   ws.binaryType = 'arraybuffer';
  //   let extraBytesToRead = 0;
  //   let extraBytesRead = 0;
  //   let totalBytesRead = 0;
  //   let fullBuffer, fullView;
  //   ws.onmessage = function (ev) {
  //     (() => {
  //       const peek = new DataView(ev.data);
  //       const byte = peek.getUint8(0);
  //       console.log('byte: ' + byte);
  //       totalBytesRead++;
  //       if (extraBytesToRead === 0) {
  //         fullBuffer = new ArrayBuffer(4);
  //         fullView = new Uint8Array(fullBuffer);
  //         fullView[0] = byte;
  //         // Multi-byte unicode data is being sent if the first
  //         // byte starts with a "1"
  //         // use bitmask with 10000000 to find out if this is the case
  //         if ((128 & byte) === 128) {
  //           // bytesLeftToRead = 1;
  //           extraBytesToRead = 1;
  //           // populate(fullView, firstByte);
  //           // The next three digits in binary will tell us how
  //           // many bytes the character is
  //           if ((240 & byte) === 240) {
  //             // bytesLeftToRead = 3;
  //             extraBytesToRead = 3;
  //           } else if ((224 & byte) === 224) {
  //             // bytesLeftToRead = 2;
  //             extraBytesToRead = 2;
  //           }
  //         }
  //       } else {
  //         // Read next byte into array
  //         extraBytesRead++;
  //         console.log(`Inserting ${byte} at position ${extraBytesRead}`);
  //         fullView[extraBytesRead] = byte;
  //         if (extraBytesRead === extraBytesToRead) {
  //           extraBytesToRead = 0;
  //           extraBytesRead = 0;
  //         }
  //       }

  //       if (extraBytesToRead !== 0) {
  //         return;
  //       }

  //       const finalView = new Uint8Array(fullBuffer, 0, totalBytesRead);
  //       console.log('finalView: ' + finalView);
  //       totalBytesRead = 0;

  //       // Decoding and sending to terminal

  //       const decoder = new TextDecoder('utf-8', { fatal: true });
  //       let newReplText;
  //       try {
  //         // decoder may throw an error
  //         newReplText = decoder.decode(finalView);
  //         replData.set('text', replData.get('text') + newReplText);
  //       } catch (err) {
  //         console.error(err);
  //         return;
  //       } finally {
  //       }
  //     })();
  //   };

  //   return ws;
  // }

  function scrolltoReplCaret () {
    // if (isCaretVisible()) {
    //   return;
    // }
    // replCaretDOMRef.current.scrollIntoView();

    // function isCaretVisible () {
    //   const caret = replCaretDOMRef.current.getBoundingClientRect();
    //   const container = replAreaDOMRef.current.getBoundingClientRect();
    //   return caret.bottom < container.bottom;
    // }
  }

  function displayReplText () {
    // const textWithCmd = replData.get('text') + replData.get('cmd');
    // // Caret positioning
    // let beforeCaret, underCaret, afterCaret;
    // if (replData.get('caretOffset') === 0) {
    //   beforeCaret = textWithCmd;
    //   underCaret = ' ';
    //   afterCaret = '';
    // } else {
    //   const caretIdx = textWithCmd.length - replData.get('caretOffset');
    //   beforeCaret = textWithCmd.slice(0, caretIdx);
    //   underCaret = textWithCmd[caretIdx];
    //   afterCaret = textWithCmd.slice(caretIdx + 1);
    // }
    // replDisplayData.set('text', { beforeCaret, underCaret, afterCaret });
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
