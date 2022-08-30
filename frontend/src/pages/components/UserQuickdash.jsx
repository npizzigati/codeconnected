'use strict';

import React, { useState, useRef, useEffect } from 'react';
import { handlePointerDown } from '../../helpers/miscUtils.js';

function UserQuickdash ({ setAuthed }) {
  const [username, setUsername] = useState('');
  const [showQuickdash, setShowQuickdash] = useState(false);
  const avatar = useRef(null);
  const quickdash = useRef(null);

  useEffect(() => {
    function handleDocPointerDown (ev) {
      if (!quickdash.current) {
        return;
      }
      if (!quickdash.current.contains(ev.target) && ev.target !== avatar.current) {
        hideQuickdash();
      }
    }

    document.addEventListener('pointerdown', handleDocPointerDown);

    // If escape key custom event fires, close this component's modal dialog
    document.addEventListener('escapePressed', hideQuickdash);

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
    })();

    return function cleanup () {
      document.removeEventListener('pointerdown', handleDocPointerDown);
      isCanceled = true;
    };
  }, []);

  return (
    <>
      <img
        className='account-circle'
        src='./images/account_circle.png'
        alt='account circle'
        ref={avatar}
        onPointerDown={(ev) => handlePointerDown(ev, toggleQuickdash, ev)}
      />
      <div
        ref={quickdash}
        className={'user-quickdash ' + (showQuickdash ? 'visible' : 'hidden')}
      >
        <div className='user-quickdash__heading'>
          Signed in as:
        </div>
        <span className='user-quickdash__text'>{username}</span>
        <button
          className='user-quickdash__sign-out-button'
          onPointerDown={(ev) => handlePointerDown(ev, signOut, ev)}
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
