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
  const mainTermDOMRef = useRef(null);
  const altTermDOMRef = useRef(null);
  const altTerm = useRef(null);
  const mainTerm = useRef(null);
  // const activeTerm = useRef(null);
  const ws = useRef(null);
  const flags = useRef(null);
  const terminalData = useRef(null);
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
    mainTerm.current = new Terminal();
    mainTerm.current.open(mainTermDOMRef.current);
    altTerm.current = new Terminal();
    altTerm.current.open(altTermDOMRef.current);
    mainTerm.current.onData((data) => {
      ws.current.send(data.toString());
    });
    // Save terminal content to shared state, to be passed to new
    // users when they join
    let setTerminalState;
    mainTerm.current.onRender(() => {
      clearTimeout(setTerminalState);
      setTerminalState = setTimeout(() => {
        terminalData.current.set('text', getTerminalText(mainTerm));
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

    const yTerminalData = ydoc.getMap('terminal data');
    // Whether to redirect terminal echo/output to alternate
    // terminal (when running commands we don't want the user to see)
    yTerminalData.set('redirect', false);
    yTerminalData.observe((ev) => {
      console.log('redirect: ' + ev.target.get('redirect'));
    });
    // Copy a reference to code mirror editor to React state
    terminalData.current = yTerminalData;
    // Initially fill terminal with existing content from shared session
    // TODO: Should I be using timeout here, or is there a more
    // reliable way to determine when shared content is available
    // after loading page?
    setTimeout(() => {
      if (yTerminalData.get('text') !== undefined) {
        const text = yTerminalData.get('text');
        const lines = terminalLines(text);

        // Join with CRLF for proper display
        const formattedText = lines.join('\r\n');
        mainTerm.current.write(formattedText);
      }
    }, 2000);
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
        <div id='alt-terminal' ref={altTermDOMRef} />
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
    mainTerm.current.clear();
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

  async function runCode (path) {
    altTerm.current.clear();
    if (language === 'ruby') {
      // reset repl with exec $0 then wait for prompt
      const reset = 'exec $0';
      const runCmd = `load '${path}'`;
      terminalData.current.set('redirect', true);
      let timeoutID;
      try {
        timeoutID = await executeRun(reset);
        clearTimeout(timeoutID);
        console.log('Successfully executed reset');
        timeoutID = await executeRun(runCmd);
        clearTimeout(timeoutID);
        console.log('Successfully executed command to run');
      } catch (error) {
        console.log('An error occurred: ' + error);
      } finally {
        terminalData.current.set('redirect', false);
      }
    }

    const lines = terminalLines(getTerminalText(altTerm));
    // Omit first line (command) and second to last line (throwaway
    // return value)
    const output = lines.slice(2, -2).join('\r\n');
    const prompt = lines[lines.length - 1];
    // Add padding before and after output and add prompt
    const padding = '\r\n'.repeat(2);
    const text = padding + output + padding + prompt;
    // Write to real terminal
    mainTerm.current.write(text);
    // Sync terminals
    

    // If ws is closed/closing, open it again before sending command
    // if (ws.current === null || ws.current.readyState === WebSocket.CLOSED ||
    //     ws.current.readyState === WebSocket.CLOSING) {
    // }
  }

  function executeRun (cmd) {
    const timeoutSeconds = 3;
    console.log('Going to execute: ' + cmd);
    let timeoutID;
    const timeout = new Promise(function (resolve, reject) {
      timeoutID = setTimeout(reject, timeoutSeconds * 1000,
                             new Error('Code execution timed out'));
    });
    const runPromise = new Promise(function (resolve, reject) {
      ws.current.send(cmd + '\n');
      document.addEventListener('promptReady', () => {
        resolve(timeoutID);
      });
    });
    return Promise.race([runPromise, timeout]);
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
    let newText;
    let checkPromptTimeout;
    try {
      // decoder may throw an error
      newText = decoder.decode(finalView);
      // Send the output to the correct buffer, depending on
      // whether input came from terminal or from cmd execution
      // if (activeTerm.current === mainTerm.current) {
      if (terminalData.current.get('redirect') === false) {
        mainTerm.current.write(newText);
      } else {
        // TODO: Need to make the terminal choice shared, or else
        // other users will see alt terminal output on their
        // regular terminals
        altTerm.current.write(newText, checkPrompt);

        function checkPrompt () {
          const text = getTerminalText(altTerm);
          const lines = terminalLines(text);
          const lastLine = lines[lines.length - 1];

          // const lastLine = lines[lastLineNum];
          const termination = '> ';
          // Check whether prompt is ready by checking that at
          // least x milliseconds pass from when the indicated
          // termination appears in the terminal output
          clearTimeout(checkPromptTimeout);
          checkPromptTimeout = setTimeout(() => {
            if (lastLine.slice(lastLine.length - 2) === termination) {
              console.log('Dispatching event');
              document.dispatchEvent(new Event('promptReady'));
            }
          }, 100);
        }
      }
    } catch (err) {
      console.error(err);
      return;
    } finally {
    }
  }

  function executeContent () {
    const content = cmRef.getValue();
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
    const body = JSON.stringify({ content, filename });
    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: body
    };
    fetch('/api/savecontent', options)
      .then(response => {
        console.log(response);
        runCode(filename);
      });
  }
}

export { CodeArea as default };
