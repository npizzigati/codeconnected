'use strict';

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { requestRoom } from '../../helpers/launchUtils.js';

function CodeSessions () {
  const [cSessions, setCSessions] = useState([]);
  const navigate = useNavigate();
  let formattedSessions;
  useEffect(() => {
    let isCanceled = false;
    (async () => {
      console.log('Going to get code sessions');
      const { codeSessions } = await getCodeSessions();
      console.log(JSON.stringify(codeSessions));
      if (isCanceled) {
        return;
      }
      formattedSessions = codeSessions.map(cSession =>
        <p key={cSession.sessID}
           className='items'
           onPointerDown={() => launch(cSession.lang, cSession.sessID, cSession.content)}
        >
          <span className='lang'>{langNameTrans(cSession.lang)}</span>
          <span className='LOC'>{getLOC(cSession.content)}</span>
          <span className='timestamp'>{dateTrans(cSession.when_accessed)}</span>
        </p>
      );
      setCSessions(formattedSessions);
    })();

    return function cleanup () {
      isCanceled = true;
    };
  }, []);

  return (
    <div className='code-sessions'>
      <div className='header'>
        Resume session
      </div>
      <div className='table'>
        <p className='header'>
          <span>Language</span><span>Lines of Code</span><span>Last Accessed</span>
        </p>
        {cSessions}
      </div>
    </div>
  );

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
      dateTimeString = `Approx. ${days} ${days > 1 ? 'days' : 'day'} ago`;
    } else if (hours > 0) {
      dateTimeString = `Approx. ${hours} ${hours > 1 ? 'hours' : 'hour'} ago`;
    } else if (minutes > 1) {
      dateTimeString = `${minutes} ${minutes > 1 ? 'minutes' : 'minute'} ago`;
    } else {
      dateTimeString = '1 minute ago';
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
