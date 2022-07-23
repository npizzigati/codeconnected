'use strict';

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import UserDashboard from './components/UserDashboard.jsx';
import Auth from './components/Auth.jsx';
import CodeSessions from './components/CodeSessions.jsx';

import { requestRoom } from '../helpers/launchUtils.js';

function Home () {
  const [auth, setAuth] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [preLaunchLanguage, setPreLaunchLanguage] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [showPreLaunchDialog, setShowPreLaunchDialog] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    console.log('Checking user authentication');
    let isCanceled = false;
    (async () => {
      const userInfo = await getUserInfo();
      if (isCanceled) {
        return;
      }
      setAuth(userInfo.auth);
      setAuthChecked(true);
    })();

    return function cleanup () {
      isCanceled = true;
    };
  }, []);

  return (
    <>
      {authChecked &&
        <div className='home'>
          {showAuth &&
            <Auth
              setShowAuth={setShowAuth}
              setAuthed={setAuth}
              config={preLaunchLanguage === null ? {} : { successCallback: () => launch(preLaunchLanguage) }}
            />}
          {showPreLaunchDialog &&
            <div className='pre-launch-dialog-container'>
              <div className='backdrop' onPointerDown={closePreLaunchDialog} />
              <div className='pre-launch-dialog'>
                <div className='message-container'>
                  <div className='attention-image' />
                  <div className='message'>
                    Rooms created by unregistered users have a 15-minute time limit.
                  </div>
                </div>
                <div className='options'>
                  <p className='option-row'>
                    <img
                      className='arrow'
                      src='./arrow_forward.png'
                    />
                    <span className='option' onPointerDown={preLaunchSignIn}>
                      Sign in to remove time limit
                    </span>
                  </p>
                  <p className='option-row'>
                    <img
                      className='arrow'
                      src='./arrow_forward.png'
                    />
                    <span className='option' onPointerDown={continueAnyway}>
                      Continue to time-limited room
                    </span>
                  </p>
                </div>
              </div>
            </div>}
          <div className='header-bar'>
            <div className='logo' />
            <div className='logo-text'>
              <span className='site-name'>
                <span className='color1'>code</span>
                <span className='color2'>connected</span>
              </span>
              <span className='tagline'>Collaborative code editor, runner and REPL</span>
            </div>
            <div className='right-side'>
              {auth
                ? <div className='user-dashboard-container'>
                    <UserDashboard setAuthed={setAuth} />
                  </div>
                : <div
                    className='sign-in'
                    onPointerDown={() => setShowAuth(true)}
                  >
                    Sign in
                  </div>}
            </div>
          </div>
          <main>
            <div className='language-chooser-container'>
              <div className='heading-text'>
                Choose a language to start coding:
              </div>
              <ul className='language-chooser'>
                <li onPointerDown={() => preLaunch('ruby')}>
                  &gt; Ruby
                </li>
                <li onPointerDown={() => preLaunch('node')}>
                  &gt; Node.js
                </li>
                <li onPointerDown={() => preLaunch('postgres')}>
                  &gt; PostgreSQL
                </li>
              </ul>
            </div>
            <div className='code-session-container'>
              <CodeSessions />
            </div>
          </main>
        </div>}
    </>
  );

  async function getUserInfo () {
    const options = {
      method: 'GET',
      mode: 'cors'
    };

    try {
      const response = await fetch('/api/get-user-info', options);
      return await response.json();
    } catch (error) {
      console.log('Error fetching auth status: ' + error);
      return { auth: false };
    }
  }

  function closePreLaunchDialog () {
    setShowPreLaunchDialog(false);
  }

  function continueAnyway () {
    setShowPreLaunchDialog(false);
    launch(preLaunchLanguage);
  }

  function preLaunchSignIn () {
    setShowPreLaunchDialog(false);
    setShowAuth(true);
  }

  async function launch (language) {
    const roomID = await requestRoom(language);
    if (roomID === null) {
      console.log('Could not create room');
      // TODO: Handle this problem / try again
      return;
    }
    console.log('RoomID: ' + roomID);
    navigate(`/${roomID}`);
  }

  function preLaunch (language) {
    if (auth) {
      launch(language);
      return;
    }

    setPreLaunchLanguage(language);
    setShowPreLaunchDialog(true);
  }
}

export { Home as default };
