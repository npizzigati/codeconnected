'use strict';

import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

function UserDashboard ({ options, title, callback, config }) {
  const [username, setUsername] = useState('Anonymous');
  const [email, setEmail] = useState('---------------------');
  const [showDashboard, setShowDashboard] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const avatar = useRef(null);
  const dashboard = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    document.addEventListener('pointerdown', (ev) => {
      if (!dashboard.current) {
        return;
      }
      const isPointerOutsideDashboard = ev.target !== avatar.current
            && !ev.target.classList.contains('user-dashboard');
      if (isPointerOutsideDashboard) {
        hideDashboard();
      }
    });

    let userInfo;
    (async () => {
      userInfo = await getUserInfo();
      if (userInfo.auth === false) {
        return;
      }
      setSignedIn(true);
      setUsername(userInfo.username);
      setEmail(userInfo.email);
    })();
  }, []);

  return (
    <>
      <img
        className='avatar'
        src='./blank_avatar.png'
        alt='avatar'
        ref={avatar}
        onPointerDown={toggleDashboard}
      />
      <div
        ref={dashboard}
        className={'user-dashboard main ' + (showDashboard ? 'visible' : 'hidden')}
      >
        <div className='user-dashboard item1'>
          <img
            className='user-dashboard avatar inline'
            src='./blank_avatar.png'
          />
          <span className='user-dashboard username'>{username}</span>
        </div>
        <div className='user-dashboard item2'>
          <img
            className='user-dashboard email-icon'
            src='./mail.png'
          />
          <span className='user-dashboard email'>{email}</span>
        </div>
        <button
          className={'user-dashboard sign-out-button' + (signedIn ? '' : ' hidden')}
          onPointerDown={signOut}
        >
          Sign out
        </button>
        <button
          className={'user-dashboard sign-in-button' + (signedIn ? ' hidden' : '')}
          onPointerDown={signOut}
        >
          Sign in
        </button>
      </div>
    </>
  );

  function signIn () {
    navigate('/');
  }

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
