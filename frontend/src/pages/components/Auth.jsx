'use strict';

import React, { useState } from 'react';
import SignIn from './SignIn.jsx';
import SignUp from './SignUp.jsx';

function Auth () {
  const [selectedTab, setSelectedTab] = useState('signUp');
  const [savedActivationStatus, setSavedActivationStatus] = useState('pre');
  const [savedSignInStatus, setSavedSignInStatus] = useState('pre');
  return (
    <div className='auth-modal'>
      <div className='tabs'>
        <div
          id='sign-up-tab'
          className={((selectedTab === 'signUp') ? ' selected' : '')}
          onPointerDown={handleTabClick}
        >
          Sign up
        </div>
        <div
          id='sign-in-tab'
          className={((selectedTab === 'signIn') ? ' selected' : '')}
          onPointerDown={handleTabClick}
        >
          Sign in
        </div>
      </div>
      {selectedTab === 'signIn'
        ? <SignIn
            savedSignInStatus={savedSignInStatus}
            setSavedSignInStatus={setSavedSignInStatus}
          />
        : <SignUp
            savedActivationStatus={savedActivationStatus}
            setSavedActivationStatus={setSavedActivationStatus}
          />}
    </div>
  );

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
