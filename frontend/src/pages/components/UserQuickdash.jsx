'use strict';

import React, { useState, useRef, useEffect } from 'react';

function UserQuickdash ({ setAuthed }) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [showQuickdash, setShowQuickdash] = useState(false);
  const avatar = useRef(null);
  const quickdash = useRef(null);

  useEffect(() => {
    function handleDocPointerDown (ev) {
      if (!quickdash.current) {
        return;
      }
      const isPointerOutsideQuickdash = ev.target !== avatar.current &&
            !ev.target.classList.contains('user-quickdash');
      if (isPointerOutsideQuickdash) {
        hideQuickdash();
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
    <div className='user-quickdash'>
      <img
        className='icon'
        src='./account_circle.png'
        alt='account circle'
        ref={avatar}
        onPointerDown={toggleQuickdash}
      />
      <main
        ref={quickdash}
        className={showQuickdash ? 'visible' : 'hidden'}
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

  function hideQuickdash () {
    setShowQuickdash(false);
  }

  function displayQuickdash () {
    setShowQuickdash(true);
  }

  function toggleQuickdash () {
    if (showQuickdash) {
      hideQuickdash();
    } else {
      displayQuickdash();
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

export { UserQuickdash as default };
