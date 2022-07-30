'use strict';

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { requestRoom } from '../../helpers/launchUtils.js';

function CodeSessions ({ authed, setShowAuth }) {
  const [cSessions, setCSessions] = useState([]);
  const navigate = useNavigate();
  const isCanceled = useRef(false);
  let formattedSessions;
  useEffect(() => {
    (async () => {
      if (!authed) {
        return;
      }
      buildSessionList();
    })();

    return function cleanup () {
      console.log('Cleaning up after CodeSessions component');
      isCanceled.current = true;
    };
  }, []);

  useEffect(() => {
    (async () => {
      if (!authed) {
        return;
      }
      buildSessionList();
    })();
  }, [authed]);

  return (
    <div className='code-sessions'>
      {authed
        ? <div>
            <div className='pane-header'>
              Resume a session
            </div>
            <div className='pane-subheader'>
              Click on a session to start it up again
            </div>
            <div className='table'>
              <p className='header'>
                <span>Language</span><span>Lines of Code</span><span>Last Accessed</span>
              </p>
              {cSessions}
            </div>
          </div>
       : <div className='pane-message-unauthed'>
           <span
             className='sign-in-link'
             onPointerDown={() => setShowAuth(true)}
           >
             Sign in
           </span>
           <span>
             &nbsp;to save and access previous sessions
           </span>
         </div>}
    </div>
  );

  async function buildSessionList () {
    const { codeSessions } = await getCodeSessions();
    console.log(JSON.stringify(codeSessions));
    if (isCanceled.current) {
      return;
    }
    formattedSessions = formatSessionList(codeSessions);
    setCSessions(formattedSessions);
    // Recalculate time since code session was accessed, at interval
    // Update interval in seconds
    const updateIntervalTime = 20;
    const intervalHandle = setInterval(() => {
      const formattedSessions = formatSessionList(codeSessions);
      if (isCanceled.current) {
        clearInterval(intervalHandle);
        console.log('Clearing code sessions interval');
        return;
      }
      setCSessions(formattedSessions);
    }, updateIntervalTime * 1000);
  }

  function formatSessionList (codeSessions) {
    formattedSessions = codeSessions.map(cSession =>
      <p
        key={cSession.sessID}
        className='items'
        onPointerDown={() => launch(cSession.lang, cSession.sessID, cSession.content)}
      >
        <span className='lang'>{langNameTrans(cSession.lang)}</span>
        <span className='LOC'>{getLOC(cSession.content)}</span>
        <span className='timestamp'>{dateTrans(cSession.when_accessed)}</span>
      </p>
    );
    return formattedSessions;
  }

  function getLOC (content) {
    const lines = content.split('\n');

    // Remove trailing empty lines
    // First get last line number
    let lastLineNum;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i] !== '') {
        lastLineNum = i;
        break;
      }
    }
    return lines.slice(0, lastLineNum + 1).length;
  }

  async function launch (language, sessID, content) {
    const roomID = await requestRoom(language, sessID, content);
    if (roomID === null) {
      console.log('Could not create room');
      // TODO: Handle this problem / try again
      return;
    }
    console.log('RoomID: ' + roomID);
    navigate(`/${roomID}`);
  }


  function dateTrans (unixTimestamp) {
    // Date/time unit constants in ms
    const sec = 1000;
    const min = 60 * sec;
    const hour = 60 * min;
    const day = 24 * hour;
    // Other date constants
    const months = ['January', 'February', 'March', 'April', 'May',
                    'June', 'July', 'August', 'September', 'October',
                    'November', 'December'];
    // Javascript expects timestamp in ms
    const ms = unixTimestamp * 1000;
    // Calculate time delta
    const accessed = new Date(ms);
    const now = new Date();
    const delta = now - accessed;
    // Find number of days/hours/min elapsed
    const days = Math.trunc(delta / day);
    const hours = Math.trunc(delta / hour);
    const minutes = Math.trunc(delta / min);
    // Return largest unit elapsed. If days is greater than 10,
    // return actual date
    let dateTimeString;
    if (days > 10) {
      dateTimeString = accessed.toLocaleDateString();
    } else if (days > 0) {
      dateTimeString = `About ${days} ${days > 1 ? 'days' : 'day'} ago`;
    } else if (hours > 0) {
      dateTimeString = `About ${hours} ${hours > 1 ? 'hours' : 'hour'} ago`;
    } else if (minutes > 0) {
      dateTimeString = `About ${minutes} ${minutes > 1 ? 'minutes' : 'minute'} ago`;
    } else {
      dateTimeString = 'Less than 1 minute ago';
    }
    return dateTimeString;
  }

  function langNameTrans (name) {
    let newName;
    switch (name) {
    case 'ruby':
      newName = 'Ruby';
      break;
    case 'node':
      newName = 'Node.js';
      break;
    case 'postgres':
      newName = 'PostgreSQL';
      break;
    }
    return newName;
  }

  async function getCodeSessions () {
    const options = {
      method: 'GET',
      mode: 'cors'
    };

    try {
      const response = await fetch('/api/get-code-sessions', options);
      return await response.json();
    } catch (error) {
      console.log('Error fetching code sessions: ' + error);
      return {};
    }
  }
}

export { CodeSessions as default };
