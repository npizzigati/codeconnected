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
  const newReplBytes = useRef([]);
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
    let timeoutID = null;
    ws.onmessage = function (ev) {
      (async () => {
        // First assemble blobs in an array and then process them
        // in order, to make sure the processing doesn't cause misordering
        const byteBuf = await ev.data.arrayBuffer();
        const byteView = new DataView(byteBuf);
        const charByte = byteView.getUint8(0);

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
        // replText.current += ev.data;
        newReplBytes.current.push(charByte);
        // Send bytes to be converted into utf8 and displayed in
        // complete bunches, e.g. only display repl text when
        // over 100 milliseconds have passed since last byte was
        // recieved
        if (timeoutID !== null) {
          clearTimeout(timeoutID);
        }
        // A timeout value of 400 or above seems to work well
        // Lower timeouts result in some corruption of utf
        // conversion or outright conversion failure on Firefox
        timeoutID = setTimeout(() => {
          (async () => {
            console.log('new Repl bytes: ' + newReplBytes.current);
            const arrayBuf = new Uint8Array(newReplBytes.current).buffer;
            const arrayView = new DataView(arrayBuf);
            const decoder = new TextDecoder('utf-8', { fatal: true });
            let newReplText;
            try {
              newReplText = decoder.decode(arrayView);
            } catch (err) {
              console.error(err);
              newReplBytes.current = [];
              displayReplText();
              return;
            }
            replText.current += newReplText;
            newReplBytes.current = [];
            displayReplText();
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
}

// async function bytesToString (data) {
//   let tries = 0;
//   while (true) {
//     const result = utf8ArrayToStr(data);
//     if (result !== null) {
//       return result;
//     }
//     // Sleep
//     if (tries > 100) {
//       return null;
//     }
//     await new Promise(r => setTimeout(r, 50));
//     tries += 1;
//   }
// }

// function utf8ArrayToStr (data) {
//   const extraByteMap = [1, 1, 1, 1, 2, 2, 3, 0];
//   var count = data.length;
//   var str = "";
//   for (var index = 0; index < count;)
//   {
//     var ch = data[index++];
//     if (ch & 0x80)
//     {
//       var extra = extraByteMap[(ch >> 3) & 0x07];
//       if (!(ch & 0x40) || !extra || ((index + extra) > count))
//         return null;
//       ch = ch & (0x3F >> extra);
//       for (;extra > 0; extra -= 1)
//       {
//         var chx = data[index++];
//         if ((chx & 0xC0) != 0x80)
//           return null;
//         ch = (ch << 6) | (chx & 0x3F);
//       }
//     }
//     str += String.fromCharCode(ch);
//   }
//   return str;
// }
// function utf8ArrayToStr (array) {
//   var out, i, len, c;
//   var char2, char3;

//   out = "";
//   len = array.length;
//   i = 0;
//   while (i < len) {
//     c = array[i++];
//     switch (c >> 4) {
//     case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
//       // 0xxxxxxx
//       out += String.fromCharCode(c);
//       break;
//     case 12: case 13:
//       // 110x xxxx   10xx xxxx
//       char2 = array[i++];
//       out += String.fromCharCode(((c & 0x1F) << 6) | (char2 & 0x3F));
//       break;
//     case 14:
//       // 1110 xxxx  10xx xxxx  10xx xxxx
//       char2 = array[i++];
//       char3 = array[i++];
//       out += String.fromCharCode(((c & 0x0F) << 12) |
//                                  ((char2 & 0x3F) << 6) |
//                                  ((char3 & 0x3F) << 0));
//       break;
//     }
//   }
//   return out;
// }

export { CodeArea as default };
