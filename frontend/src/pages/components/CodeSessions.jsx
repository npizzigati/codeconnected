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
      // Reverse array so that it displays in correct order
      codeSessions.reverse();
      if (isCanceled) {
        return;
      }
      formattedSessions = codeSessions.map(cSession =>
        <p key={cSession.sessID}
           onPointerDown={() => launch(cSession.lang, cSession.sessID, cSession.content)}
        >
          <span>{langNameTrans(cSession.lang)}</span><span>{dateTrans(cSession.when_accessed)}</span>
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
      <p>
        <span>Language</span><span>Last Accessed</span>
      </p>
      {cSessions}
    </div>
  );

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
    // Javascript expects timestamp in ms
    const ms = unixTimestamp * 1000;
    const dateTime = new Date(ms);
    return dateTime.toLocaleString();
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
