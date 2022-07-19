'use strict';

import React, { useState } from 'react';
import SignIn from './SignIn.jsx';
import SignUp from './SignUp.jsx';

function Auth ({ setShowAuth, setAuthed, config }) {
  const [selectedTab, setSelectedTab] = useState('signIn');
  const [savedActivationStatus, setSavedActivationStatus] = useState('pre');
  const [savedSignInStatus, setSavedSignInStatus] = useState('pre');
  return (
    <div className='auth-modal-container'>
      <div className='backdrop' />
      <div className='auth-modal'>
        <div className='close-button' onPointerDown={closeAuth} />
        <div className='tabs'>
          <div
            id='sign-in-tab'
            className={((selectedTab === 'signIn') ? ' selected' : '')}
            onPointerDown={handleTabClick}
          >
            Sign in
          </div>
          <div
            id='sign-up-tab'
            className={((selectedTab === 'signUp') ? ' selected' : '')}
            onPointerDown={handleTabClick}
          >
            Sign up
          </div>
        </div>
        <div className='content'>
          {selectedTab === 'signIn'
            ? <SignIn
                setShowAuth={setShowAuth}
                setAuthed={setAuthed}
                savedSignInStatus={savedSignInStatus}
                setSavedSignInStatus={setSavedSignInStatus}
                config={config}
              />
            : <SignUp
                setShowAuth={setShowAuth}
                setAuthed={setAuthed}
                savedActivationStatus={savedActivationStatus}
                setSavedActivationStatus={setSavedActivationStatus}
                config={config}
              />}
        </div>
      </div>
    </div>
  );

  function closeAuth () {
    setShowAuth(false);
  }

  function handleTabClick (ev) {
    switch (ev.target.id) {
    case 'sign-up-tab':
      setSelectedTab('signUp');
      break;
    case 'sign-in-tab':
      setSelectedTab('signIn');
      break;
    }
  }
}

export { Auth as default };
