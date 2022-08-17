'use strict';

import React, { useState } from 'react';
import SignIn from './SignIn.jsx';
import SignUp from './SignUp.jsx';

function Auth ({ setShowAuth, setAuthed, setPreLaunchLanguage, config }) {
  const [selectedTab, setSelectedTab] = useState('signIn');
  const [savedActivationStatus, setSavedActivationStatus] = useState('pre');
  const [savedSignInStatus, setSavedSignInStatus] = useState('pre');
  const [showTabSwitchDialog, setShowTabSwitchDialog] = useState(false);
  return (
    <>
      {showTabSwitchDialog &&
        <div>
          <div className='backdrop backdrop--level2' onPointerDown={closeTabSwitchDialog} />
          <div className='popup-dialog'>
            <div className='media'>
              <div className='media__image-container'>
                <img
                  className='media__image media__image--small'
                  src='./attention.png'
                  alt='Attention'
                />
              </div>
              <div className='media__text media__text--constrained'>
                <div>
                  <span className='popup-dialog__text'>
                    If you switch tabs now, the current process will be aborted
                  </span>
                </div>
              </div>
            </div>
            <div className='aligned-block'>
              <div
                className='aligned-block__row aligned-block__row--clickable'
                onPointerDown={closeTabSwitchDialog}
              >
                <div className='aligned-block__cell u-right-align-text'>
                  <img
                    className='aligned-block__image aligned-block__image--tinier u-pad-right-1'
                    src='./stay.png'
                    alt='Login'
                  />
                </div>
                <div className='aligned-block__cell u-pad-left-2 u-pad-top-1'>
                  <span className='popup-dialog__text popup-dialog__text--small'>
                    Stay on current tab
                  </span>
                </div>
              </div>
              <div
                className='aligned-block__row aligned-block__row--clickable'
                onPointerDown={switchTab}
              >
                <div className='aligned-block__cell u-right-align-text'>
                  <img
                    className='aligned-block__image aligned-block__image--tinier'
                    src='./switchTab.png'
                    alt='Time-limited'
                  />
                </div>
                <div className='aligned-block__cell u-pad-left-2 u-pad-top-1'>
                  <span className='popup-dialog__text popup-dialog__text--small'>
                    Switch tabs anyway&nbsp;&nbsp;
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>}

      <div className='backdrop' />
      <div className='tabbed-modal'>
        <div className='tabbed-modal__inner-wrapper'>
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
      </div>
    </>
  );

  function closeAuth () {
    setShowAuth(false);
    // Reset prelaunch language to null to abort any launching of
    // language room the next time user signs in.
    if (setPreLaunchLanguage !== undefined) {
      setPreLaunchLanguage(null);
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
