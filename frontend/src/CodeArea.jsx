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
  const replCmd = useRef('');
  const replCmdStash = useRef('');
  const replText = useRef('');
  const replCmdHistory = useRef([]);
  const replCmdHistoryNum = useRef(0);
  // This is the positive offset of the repl cursor from right to
  // left, from the right end cursor position
  const replCaretOffset = useRef(0);
  const codeAreaDOMRef = useRef(null);
  const replAreaDOMRef = useRef(null);
  const replCaretDOMRef = useRef(null);
  const [sharedOutputRef, setSharedOutputRef] = useState('');
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
    console.log(`key: ${ev.key}`);
    console.log(`keyCode: ${ev.keyCode}`);
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
      replCaretOffset.current = 0;
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
    replCaretOffset.current = replCmd.current.length;
    displayReplText();
  }

  function goToEndOfCmd () {
    replCaretOffset.current = 0;
    displayReplText();
  }

  function cmdHistoryBack () {
    if (replCmdHistoryNum.current >= replCmdHistory.current.length) {
      return;
    }
    if (replCmdHistoryNum.current === 0) {
      replCmdStash.current = replCmd.current;
    }
    replCmdHistoryNum.current += 1;
    console.log('history offset: ' + replCmdHistoryNum.current);
    const idx = replCmdHistory.current.length - replCmdHistoryNum.current;
    replCmd.current = replCmdHistory.current[idx];
    displayReplText();
  }

  function cmdHistoryFwd () {
    if (replCmdHistoryNum.current <= 0) {
      return;
    }
    replCmdHistoryNum.current -= 1;
    console.log('history offset: ' + replCmdHistoryNum.current);
    if (replCmdHistoryNum.current === 0) {
      replCmd.current = replCmdStash.current;
    } else {
      const idx = replCmdHistory.current.length - replCmdHistoryNum.current;
      replCmd.current = replCmdHistory.current[idx];
    }
    displayReplText();
  }

  function insertIntoCmd (char) {
    const insertIdx = replCmd.current.length - replCaretOffset.current;
    replCmd.current = replCmd.current.slice(0, insertIdx) +
      char + replCmd.current.slice(insertIdx);
  }

  function backspace () {
    if (replCmd.current.length === replCaretOffset.current) {
      return;
    }
    const deleteIdx = (replCmd.current.length - replCaretOffset.current) - 1;
    replCmd.current = replCmd.current.slice(0, deleteIdx) +
      replCmd.current.slice(deleteIdx + 1);
    displayReplText();
  }

  function deleteChar () {
    if (replCaretOffset.current === 0) {
      return;
    }
    const deleteIdx = replCmd.current.length - replCaretOffset.current;
    replCmd.current = replCmd.current.slice(0, deleteIdx) +
      replCmd.current.slice(deleteIdx + 1);
    replCaretOffset.current -= 1;
    displayReplText();
  }

  function moveReplCaretLeft () {
    // if (replCaretPos.current === replTextWithCmd.content.length - replCmd.current.length) {
    if (replCmd.current.length <= replCaretOffset.current) {
      return;
    }
    replCaretOffset.current += 1;
    displayReplText();
  }

  function moveReplCaretRight () {
    if (replCaretOffset.current === 0) {
      return;
    }
    replCaretOffset.current -= 1;
    displayReplText();
  }

  function runCommand () {
    // If ws is closed/closing, open it again before sending command
    if (ws === null || ws.readyState === WebSocket.CLOSED ||
        ws.readyState === WebSocket.CLOSING) {
      const ws = openReplWs();
      ws.onopen = function () {
        console.log('Web socket is open');
        ws.send(replCmd.current);
        setWs(ws);
      };
      return;
    }
    ws.send(replCmd.current);
  }

  function openReplWs () {
    const ws = new WebSocket(window.location.origin.replace(/^http/, 'ws') +
                                        '/api/openreplws');
    let isFirstCharInBatch = true;
    ws.onmessage = function (ev) {
      // If this is the first message since command was sent, add
      // the command to repl history and reset the command to
      // empty
      if (isReplPendingResponse.current === true) {
        replCmdHistory.current.push(replCmd.current);
        replCmd.current = '';
        replCmdHistoryNum.current = 0;
        replCmdStash.current = '';
        isReplPendingResponse.current = false;
      }
      replText.current += ev.data;
      // Display characters in bunches, e.g.  only display repl
      // text when over 100 milliseconds have passed since first
      // char was recieved
      if (isFirstCharInBatch === true) {
        setTimeout(() => {
          displayReplText();
          isFirstCharInBatch = true;
          console.log('timeout running');
        }, 100);
        isFirstCharInBatch = false;
      }
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
    const textWithCmd = replText.current + replCmd.current;
    // Caret positioning
    let beforeCaret, underCaret, afterCaret;
    if (replCaretOffset.current === 0) {
      beforeCaret = textWithCmd;
      underCaret = ' ';
      afterCaret = '';
    } else {
      const caretIdx = textWithCmd.length - replCaretOffset.current;
      beforeCaret = textWithCmd.slice(0, caretIdx);
      underCaret = textWithCmd[caretIdx];
      afterCaret = textWithCmd.slice(caretIdx + 1);
    }
    setReplTextWithCmd({ beforeCaret, underCaret, afterCaret });
    scrolltoReplCaret();
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

  // function removeCommandFromDisplay (command, currentDisplay) {
  //   // Remove last command entered, since runner output will echo it
  //   // Remove letter by letter starting from end
  //   let newReplDisplay = currentDisplay;
  //   for (let i = 1; i <= command.length; i++) {
  //     if (command[command.length - i] === currentDisplay[currentDisplay.length - i]) {
  //       newReplDisplay = newReplDisplay.slice(0, currentDisplay.length - i);
  //     } else {
  //       break;
  //     }
  //   }
  //   return newReplDisplay;
  // }
}

export { CodeArea as default };
