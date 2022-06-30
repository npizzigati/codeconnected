'use strict';

import React, { useState, useRef, useEffect } from 'react';

function UserDashboard ({ options, title, callback, config }) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [showDashboard, setShowDashboard] = useState(false);

  useEffect(() => {
    let userInfo;
    (async () => {
      userInfo = await getUserInfo();
      console.log(JSON.stringify(userInfo));
      setUsername(userInfo.username);
      setEmail(userInfo.email);
    })();
  }, []);

  return (
    <>
      <img
        id='avatar'
        src='./blank_avatar.png'
        alt='avatar'
        onPointerDown={handlePointerDown}
      />
      {showDashboard &&
        <div id='user-dashboard'>
          {username}
          {email}
        </div>}
    </>
  );

  function handlePointerDown () {
    setShowDashboard(true);
  }

  async function getUserInfo () {
    const options = {
      method: 'GET',
      mode: 'cors'
    };

    try {
      const response = await fetch('/api/get-user-info', options);
      const json = await response.json();
      return json;
    } catch (error) {
      console.log('Error fetching auth status: ' + error);
      return false;
    }
  }
}

export { UserDashboard as default };
