'use strict';

import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

function UserDashboard ({ options, title, callback, config }) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [showDashboard, setShowDashboard] = useState(false);
  const avatar = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    document.addEventListener('pointerdown', (ev) => {
      if (ev.target !== avatar.current) {
        console.log('should hide dashboard');
        hideDashboard();
      }
    });

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
        ref={avatar}
        onPointerDown={toggleDashboard}
      />
      {showDashboard &&
        <div id='user-dashboard'>
          <p>{username}</p>
          <p>{email}</p>
          <button
            onPointerDown={signOut}
          >
            Sign out
          </button>
        </div>}
    </>
  );

  async function signOut () {
    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Length': '0' }
    };

    try {
      const response = await fetch('/api/sign-out', options);
      console.log( await response.json());
    } catch (error) {
      console.error('Error fetching json:', error, ' May not be signed out.');
    }
    navigate('/');
  }

  function hideDashboard () {
    setShowDashboard(false);
  }

  function displayDashboard () {
    setShowDashboard(true);
  }

  function toggleDashboard () {
    if (showDashboard) {
      hideDashboard();
    } else {
      displayDashboard();
    }
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
