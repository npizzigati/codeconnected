'use strict';

import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

function UserDashboard ({ options, title, callback, config }) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [showDashboard, setShowDashboard] = useState(false);
  const avatar = useRef(null);
  const dashboard = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    document.addEventListener('pointerdown', (ev) => {
      if (!dashboard.current) {
        return;
      }
      const isPointerOutsideDashboard = ev.target !== avatar.current
        && ev.target !== dashboard.current
        && !(Array.from(dashboard.current.children).includes(ev.target));
      if (isPointerOutsideDashboard) {
        hideDashboard();
      }
    });

    let userInfo;
    (async () => {
      userInfo = await getUserInfo();
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
      <div
        id='user-dashboard'
        ref={dashboard}
        className={showDashboard ? 'visible' : 'hidden'}
      >
        <p className='username'>{username}</p>
        <p className='email'>{email}</p>
        <button
          className='sign-out'
          onPointerDown={signOut}
        >
          Sign out
        </button>
      </div>
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
      console.log(await response.json());
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
