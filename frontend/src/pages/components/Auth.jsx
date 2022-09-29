'use strict';

import React, { useState } from 'react';
import SignIn from './SignIn.jsx';
import SignUp from './SignUp.jsx';
import PopupDialog from './PopupDialog.jsx';
import { handlePointerDown } from '../../helpers/miscUtils.js';

function Auth ({ setShowAuth, setAuthed, setPreLaunchLanguage, config }) {
  const [selectedTab, setSelectedTab] = useState('signIn');
  const [savedActivationStatus, setSavedActivationStatus] = useState('pre');
  const [savedSignInStatus, setSavedSignInStatus] = useState('pre');
  const [showTabSwitchDialog, setShowTabSwitchDialog] = useState(false);

  const popupDialogConfig = {
    message: {
      icon: { path: './images/attention.png', alt: 'Attention' },
      text: 'If you switch tabs now, the current process will be aborted'
    },
    options: [
      {
        number: 1,
        icon: { path: './images/stay.png', alt: 'Stay' },
        text: 'Stay on the current tab',
        callback: closeTabSwitchDialog
      },
      {
        number: 2,
        icon: { path: './images/switchTab.png', alt: 'Switch tab' },
        text: 'Switch tabs anyway',
        callback: switchTab
      }
    ],
    abortCallback: closeTabSwitchDialog
  };

  return (
    <>
      {showTabSwitchDialog &&
        <div>
          <div
            className='backdrop backdrop--level2'
            onPointerDown={(ev) => handlePointerDown(ev, closeTabSwitchDialog, ev)}
          />
          <PopupDialog config={popupDialogConfig} />
        </div>}
      <div className='backdrop' />
      <div className='tabbed-modal'>
        <div className='close-button__container'>
          <div
            className='close-button'
            onPointerDown={(ev) => handlePointerDown(ev, closeAuth, ev)}
          />
        </div>
        <div className='tabbed-modal__tab-container'>
          <div
            id='sign-in-tab'
            className={'tabbed-modal__tab u-no-select' + ((selectedTab === 'signIn') ? ' selected' : '')}
            onPointerDown={(ev) => handlePointerDown(ev, handleTabClick, ev)}
          >
            Sign in
          </div>
          <div
            id='sign-up-tab'
            className={'tabbed-modal__tab u-no-select' + ((selectedTab === 'signUp') ? ' selected' : '')}
            onPointerDown={(ev) => handlePointerDown(ev, handleTabClick, ev)}
          >
            Sign up
          </div>
        </div>
        <div className='tabbed-modal__content'>
          {selectedTab === 'signIn'
            ? <SignIn
                setShowAuth={setShowAuth}
                setAuthed={setAuthed}
                setSavedSignInStatus={setSavedSignInStatus}
                config={config}
              />
            : <SignUp
                setShowAuth={setShowAuth}
                setAuthed={setAuthed}
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
    if (setPreLaunchLanguage !== undefined) {
      setPreLaunchLanguage('');
    }
  }

  function closeTabSwitchDialog () {
    setShowTabSwitchDialog(false);
  }

  function switchTab () {
    if (selectedTab === 'signIn') {
      setSelectedTab('signUp');
    } else {
      setSelectedTab('signIn');
    }
    closeTabSwitchDialog();
  }

  function isSignInUnderway() {
    return savedSignInStatus === 'resetPassword';
  }

  function isSignUpUnderway() {
    return savedActivationStatus === 'underway';
  }

  function handleTabClick (ev) {
    switch (ev.target.id) {
    case 'sign-up-tab':
      if (selectedTab !== 'signIn') {
        return;
      }
      if (isSignInUnderway()) {
        setShowTabSwitchDialog(true);
        return;
      }
      break;
    case 'sign-in-tab':
      if (selectedTab !== 'signUp') {
        return;
      }
      if (isSignUpUnderway()) {
        setShowTabSwitchDialog(true);
        return;
      }
      break;
    }
    switchTab();
  }
}

export { Auth as default };
