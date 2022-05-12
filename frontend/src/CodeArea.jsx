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
  const codeAreaDOMRef = useRef(null);
  const mainTermDOMRef = useRef(null);
  const term = useRef(null);
  const ws = useRef(null);
  const flags = useRef(null);
  const terminalData = useRef(null);
  const [language, setLanguage] = useState(defaultLanguage);
  const [codeOptions, setCodeOptions] = useState(null);
  const [cmRef, setCmRef] = useState(null);
  const [ydocRef, setYdocRef] = useState(null);

  const promptReadyEvent = new Event('promptReady');

  useEffect(() => {
    term.current = new Terminal();
    term.current.open(mainTermDOMRef.current);
    term.current.onData((data) => {
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
    // Copy a reference to code mirror editor to React state
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

  function switchLanguage (ev) {
    const lang = ev.target.value;
    codeOptions.set('language', lang);
    fetch(`/api/switchlanguage/${lang}`)
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

  async function runCode (filename) {
    // TODO: For Ruby, maybe need to make sure we're exiting from
    // any nested pry instances
    // reset repl with exec $0 then wait for prompt
    let resetCmd, runCmd;
    switch (language) {
    case 'ruby':
      resetCmd = 'exec $0 #--> Resetting REPL';
      runCmd = `load '${filename}' #--> Running code;`;
      break;
    case 'javascript':
      // resetCmd = 'exec $0 #--> Resetting REPL';
      console.log('executing javascript code');
      resetCmd = '.clear //--> Resetting REPL';
      runCmd = `.load ${filename}`;
      break;
    case 'sql':
      console.log('executing javascript code');
      resetCmd = null;
      runCmd = `\\i ./${filename}`;
      break;
    }
    let timeoutID;
    if (resetCmd !== null) {
      try {
        // exit Pry to shell
        timeoutID = await executeAndWait(resetCmd);
        clearTimeout(timeoutID);
        console.log('Successfully reset');
      } catch (error) {
        console.log('An error occurred: ' + error);
      } finally {
      }
    }
    executeRun(runCmd);

    // If ws is closed/closing, open it again before sending command
    // if (ws.current === null || ws.current.readyState === WebSocket.CLOSED ||
    //     ws.current.readyState === WebSocket.CLOSING) {
    // }
  }

  function executeAndWait (cmd) {
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
        console.log('promptReady event heard');
        resolve(timeoutID);
      }, { once: true });
    });
    return Promise.race([runPromise, timeout]);
  }

  function executeRun (cmd) {
    console.log('Going to execute: ' + cmd);
    const newline = '\n';
    const fullCmd = cmd + newline;
    ws.current.send(fullCmd);
  }


  function openWs () {
    const ws = new WebSocket(window.location.origin.replace(/^http/, 'ws') +
                             `/api/openreplws?lang=${language}`);
    ws.onmessage = ev => {
      handleIncomingChar(ev.data);
    };
    // Need to ping at least once every 60 seconds, or else nginx
    // proxypass will time out
    const pingInterval = setInterval(() => ws.send('KEEPALIVE'), 50000);
    ws.onclose = ev => {
      clearInterval(pingInterval);
    };

    return ws;
  }

  function handleIncomingChar (char) {
    let checkPromptTimeout;
    const termination = '> ';
    term.current.write(char, () => {
      checkPrompt();
    });

    function checkPrompt () {
      // Check whether prompt is ready by checking that at
      // least x milliseconds pass from when the indicated
      // termination appears in the terminal output
      clearTimeout(checkPromptTimeout);
      checkPromptTimeout = setTimeout(() => {
        const text = getTerminalText(term);
        const lines = terminalLines(text);
        const lastLine = lines[lines.length - 1];
        const terminationSlice = lastLine.slice(lastLine.length - 2);
        if (terminationSlice === termination) {
          console.log('Dispatching prompt ready event');
          document.dispatchEvent(promptReadyEvent);
        }
      }, 200);
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
