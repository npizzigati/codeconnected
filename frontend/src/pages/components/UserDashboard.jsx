'use strict';

import React, { useState, useRef, useEffect } from 'react';

function UserDashboard ({ setAuthed }) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [showDashboard, setShowDashboard] = useState(false);
  const avatar = useRef(null);
  const dashboard = useRef(null);

  useEffect(() => {
    function handleDocPointerDown (ev) {
      if (!dashboard.current) {
        return;
      }
      const isPointerOutsideDashboard = ev.target !== avatar.current &&
            !ev.target.classList.contains('user-dashboard');
      if (isPointerOutsideDashboard) {
        hideDashboard();
      }
    }

    document.addEventListener('pointerdown', handleDocPointerDown);

    let userInfo;
    let isCanceled = false;
    (async () => {
      userInfo = await getUserInfo();
      if (isCanceled) {
        return;
      }
      if (userInfo.auth === false) {
        return;
      }
      setUsername(userInfo.username);
      setEmail(userInfo.email);
    })();

    return function cleanup () {
      document.removeEventListener('pointerdown', handleDocPointerDown);
      isCanceled = true;
    };
  }, []);

  return (
    <div className='user-dashboard'>
      <img
        className='account-circle'
        src='./account_circle.png'
        alt='account circle'
        ref={avatar}
        onPointerDown={toggleDashboard}
      />
      <main
        ref={dashboard}
        className={showDashboard ? 'visible' : 'hidden'}
      >
        <div className='heading'>
          Signed in as:
        </div>
        <div className='items'>
          <p>
            <img
              className='user-icon'
              src='./blank_avatar.png'
            />
            <span className='username-text'>{username}</span>
          </p>
          <p>
            <img
              className='email-icon'
              src='./mail.png'
            />
            <span className='email-text'>{email}</span>
          </p>
        </div>
        <button
          className='sign-out-button'
          onPointerDown={signOut}
        >
          Sign out
        </button>
      </main>
    </div>
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
      setAuthed(false);
    } catch (error) {
      console.error('Error fetching json:', error, ' May not be signed out.');
    }
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
