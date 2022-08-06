'use strict';

import React, { useState } from 'react';
import SignIn from './SignIn.jsx';
import SignUp from './SignUp.jsx';

function Auth ({ setShowAuth, setAuthed, setPreLaunchLanguage, config }) {
  const [selectedTab, setSelectedTab] = useState('signIn');
  const [savedActivationStatus, setSavedActivationStatus] = useState('pre');
  const [savedSignInStatus, setSavedSignInStatus] = useState('pre');
  return (
    <>
      <div className='backdrop' />
      <div className='tabbed-modal'>
        <div className='close-button__container'>
          <div className='close-button' onPointerDown={closeAuth} />
        </div>
        <div className='tabbed-modal__tab-container'>
          <div
            id='sign-in-tab'
            className={'tabbed-modal__tab u-no-select' + ((selectedTab === 'signIn') ? ' selected' : '')}
            onPointerDown={handleTabClick}
          >
            Sign in
          </div>
          <div
            id='sign-up-tab'
            className={'tabbed-modal__tab u-no-select' + ((selectedTab === 'signUp') ? ' selected' : '')}
            onPointerDown={handleTabClick}
          >
            Sign up
          </div>
        </div>
        <div className='tabbed-modal__content'>
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
    </>
  );

  function closeAuth () {
    setShowAuth(false);
    // Reset prelaunch language to null to abort any launching of
    // language room the next time user signs in.
    setPreLaunchLanguage(null);
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
