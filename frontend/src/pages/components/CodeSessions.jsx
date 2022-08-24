'use strict';

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { requestRoom } from '../../helpers/launchUtils.js';

function CodeSessions ({ authed, setShowAuth }) {
  const [cSessions, setCSessions] = useState([]);
  const [showCSessions, setShowCSessions] = useState(true);
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
    <div className='flex-container flex-container--col'>
      {authed
        ? <div>
            <h1 className='u-center-text u-marg-top-3 u-marg-bot-2 '>Resume a session</h1>
            {showCSessions
              ? <div className='table-wrapper'>
                  <div className='table'>
                    <div className='table-row table-row--heading'>
                      <h4 className='table-cell table-cell--heading u-width-2'></h4>
                      <h4 className='table-cell table-cell--heading u-width-1'>Lines</h4>
                      <h4 className='table-cell table-cell--heading'>Last Accessed</h4>
                    </div>
                    {cSessions}
                  </div>
                </div>
              : <div className='u-center-text u-pad-top-4'>
                  <span className='flex-pane__message'>No sessions yet</span>
                </div>}
          </div>
       : <div className='u-center-text u-pad-top-4'>
           <span
             className='flex-pane__message'
           >
             <span className='flex-pane__sign-in-link' onPointerDown={() => setShowAuth(true)}>Sign in</span> to access previous sessions
           </span>
         </div>}
    </div>
  );

  function formatSessionList (codeSessions) {
    formattedSessions = codeSessions.map(cSession =>
      <p
        key={cSession.sessID}
        className='table-row table-row--items'
        onPointerDown={() => launch(cSession.lang, cSession.sessID, cSession.content)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <span className='table-cell'>{langNameTrans(cSession.lang)}</span>
        <span className='table-cell'>{getLOC(cSession.content)}</span>
        <span className='table-cell'>{dateTrans(cSession.when_accessed)}</span>
      </p>
    );
    return formattedSessions;
  }

  function handleMouseEnter (ev) {
    Array.from(ev.currentTarget.children).forEach((child) => {
      child.classList.add('shade');
    });
  }

  function handleMouseLeave (ev) {
    Array.from(ev.currentTarget.children).forEach((child) => {
      child.classList.remove('shade');
    });
  }

  async function buildSessionList () {
    const { sessionCount, codeSessions } = await getCodeSessions();
    console.log(JSON.stringify(codeSessions));
    if (isCanceled.current) {
      return;
    }
    if (sessionCount === 0) {
      // Clear code sessions for the unlikely case that a user
      // has signed out of a session with saved code sessions and
      // signed in with another username without saved code
      // sessions
      setCSessions([]);
      setShowCSessions(false);
      return;
    } else {
      setShowCSessions(true);
    }
    const formattedSessions = formatSessionList(codeSessions);
    setCSessions(formattedSessions);
    // Recalculate time since code session was accessed, at interval
    // Update interval in seconds
    const updateIntervalTime = 20;
    const intervalHandle = setInterval(() => {
      const formattedSessions = formatSessionList(codeSessions);
      if (isCanceled.current || !showCSessions) {
        clearInterval(intervalHandle);
        console.log('Clearing code sessions interval');
        return;
      }
      setCSessions(formattedSessions);
    }, updateIntervalTime * 1000);
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
      newName = 'Javascript';
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
