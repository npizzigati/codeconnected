'use strict';

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { requestRoom } from '../../helpers/launchUtils.js';
import { handlePointerDown } from '../../helpers/miscUtils.js';

function CodeSessions ({ authed }) {
  const [cSessions, setCSessions] = useState([]);
  const [showCSessions, setShowCSessions] = useState(true);
  const navigate = useNavigate();
  const isCanceled = useRef(false);
  let formattedSessions;
  useEffect(() => {
    return function cleanup () {
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
      <div>
        {showCSessions
          ? <div className='table-wrapper'>
              <div className='table'>
                <div className='table-row table-row--heading'>
                  <h4 className='table-cell table-cell--heading u-width-nano' />
                  <h4 className='table-cell table-cell--heading u-width-2' />
                  <h4 className='table-cell table-cell--heading u-width-1'>LOC</h4>
                  <h4 className='table-cell table-cell--heading'>Accessed</h4>
                </div>
                {cSessions}
              </div>
            </div>
          : <div className='u-pad-top-5'>
              <span className='message message--small'>No sessions yet</span>
            </div>}
      </div>
    </div>
  );

  function formatSessionList (codeSessions) {
    formattedSessions = codeSessions.map(cSession =>
      <p
        key={cSession.sessID}
        className='table-row table-row--items'
        onPointerDown={(ev) => handlePointerDown(ev, launch, cSession.lang, cSession.sessID, cSession.content)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <span className='table-cell u-center-text u-pad-right-nano'>{getLangIcon(cSession.lang)}</span>
        <span className='table-cell'>{langNameTrans(cSession.lang)}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
        <span className='table-cell'>{getLOC(cSession.content)}&nbsp;&nbsp;&nbsp;&nbsp;</span>
        <span className='table-cell'>{dateTrans(cSession.when_accessed)}&nbsp;&nbsp;&nbsp;&nbsp;</span>
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
    if (isCanceled.current) {
      return;
    }
    if (sessionCount === undefined || sessionCount === 0) {
      // Abort if there was a problem getting session data or if
      // there are no sessions. Also clear code sessions for the
      // unlikely case that a user has signed out of a session
      // with saved code sessions and signed in with another
      // username without saved code sessions.
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
        return;
      }
      setCSessions(formattedSessions);
    }, updateIntervalTime * 1000);
  }

  function calculateLines (langContent) {
    const lines = langContent.split('\n');

    // Remove trailing empty lines
    // First get last line number (index starts at 0)
    let lastLineNum;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i] !== '') {
        lastLineNum = i;
        break;
      }
    }
    return (lastLineNum === undefined) ? 0 : lastLineNum + 1;
  }

  function getLOC (allContentString) {
    // JSON.parse will choke on empty string, so manually return
    // value for that case
    if (allContentString === '') {
      return 0;
    }
    const allContent = JSON.parse(allContentString);
    const languageKeys = Object.keys(allContent);
    // If only one language has content, just return the number
    // of lines
    if (languageKeys.length === 1) {
      return calculateLines(allContent[languageKeys[0]]);
    }
    // Else return a span with language before
    // each count
    const LOCArray = [];
    Object.keys(allContent).forEach(lang => {
      const lines = calculateLines(allContent[lang]);
      if (lines === 0) {
        return;
      }
      LOCArray.push({ lang, LOC: lines.toString() });
    });
    // If multiple languages were present in content string, but
    // none of those languages had any lines, the array will be
    // empty; in this case return a 0
    if (LOCArray.length === 0) {
      return 0;
    }
    // Sort so languages appear in same order for each entry
    LOCArray.sort((a, b) => {
      if (a.lang > b.lang) {
        return -1;
      } else if (a.lang < b.lang) {
        return 1;
      }
      return 0;
    });
    // Use icons instead of language names
    const formattedLOC = LOCArray.map((entry, i) =>
      <span
        key={i}
      >
        {getLangIcon(entry.lang)}
        <span>{entry.LOC}&nbsp;</span>
      </span>
    );
    return formattedLOC;
  }

  function getLangIcon (lang) {
    switch (lang) {
    case 'ruby':
      return <img className='media__image media__image--nano u-pad-right-nano' src='./images/ruby.png' alt='Ruby icon' />;
    case 'node':
      return <img className='media__image media__image--nano u-pad-right-nano' src='./images/js.png' alt='Javascript icon' />;
    case 'postgres':
      return <img className='media__image media__image--nano u-pad-right-nano' src='./images/postgres.png' alt='Postgres icon' />;
    }
  }

  async function launch (language, sessID, content) {
    const roomID = await requestRoom(language, sessID, content);
    if (roomID === null) {
      // TODO: Handle this problem / try again
      return;
    }
    navigate(`/${roomID}`);
  }

  function dateTrans (unixTimestamp) {
    // Date/time unit constants in ms
    const sec = 1000;
    const min = 60 * sec;
    const hour = 60 * min;
    const day = 24 * hour;
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
      dateTimeString = `~ ${days} ${days > 1 ? 'days' : 'day'} ago`;
    } else if (hours > 0) {
      dateTimeString = `~ ${hours} ${hours > 1 ? 'hours' : 'hour'} ago`;
    } else if (minutes > 0) {
      dateTimeString = `~ ${minutes} ${minutes > 1 ? 'minutes' : 'minute'} ago`;
    } else {
      dateTimeString = '< 1 minute ago';
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
      newName = 'JavaScript';
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
      return {};
    }
  }
}

export { CodeSessions as default };
