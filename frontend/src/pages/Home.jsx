'use strict';

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import UserQuickdash from './components/UserQuickdash.jsx';
import PopupDialog from './components/PopupDialog.jsx';
import Auth from './components/Auth.jsx';
import CodeSessions from './components/CodeSessions.jsx';

import { requestRoom } from '../helpers/launchUtils.js';
import { handlePointerDown } from '../helpers/miscUtils.js';

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

    // Escape key to close modal dialogs
    document.addEventListener('keydown', closeModals);

    return function cleanup () {
      isCanceled = true;
      document.removeEventListener('keydown', closeModals);
    };
  }, []);

  const popupDialogConfig = {
    message: {
      icon: { path: './images/attention.png', alt: 'Attention' },
      text: 'Sessions created by unregistered users have a 15-minute time limit'
    },
    options: [
      {
        number: 1,
        icon: { path: './images/login.png', alt: 'Login' },
        text: 'Sign in to remove time limit',
        callback: preLaunchSignIn
      },
      {
        number: 2,
        icon: { path: './images/run.png', alt: 'Time-limited' },
        text: 'Continue to time-limited session',
        callback: continueAnyway
      }
    ],
    abortCallback: abortPreLaunch
  };

  return (
    <>
      {authChecked &&
        <div id='home'>
          {showAuth &&
            <Auth
              setShowAuth={setShowAuth}
              setAuthed={setAuth}
              setPreLaunchLanguage={setPreLaunchLanguage}
              config={preLaunchLanguage === null ? {} : { successCallback: () => launch(preLaunchLanguage) }}
            />}
          {showPreLaunchDialog &&
            <div>
              <PopupDialog config={popupDialogConfig} />
            </div>}
          <header>
            <div className='flex-pane'>
              <div className='media u-marg-left-1'>
                <div className='media__image-container'>
                  <img className='media__image media__image--small u-marg-top-2' src='./images/codeconnected.png' alt='Logo' />
                </div>
                <div className='media__text'>
                  <div>
                    <div className='site-name'>
                      <span className='site-name--color1'>code</span>
                      <span className='site-name--color2'>connected</span>
                    </div>
                    <div className='tagline'>Collaborative code editor, runner and REPL</div>
                  </div>
                </div>
              </div>
            </div>
            <div className='flex-pane flex-pane--right-justified flex-pane--vert-centered u-marg-right-2'>
              {auth
                ? <div className='u-marg-left-auto'><UserQuickdash setAuthed={setAuth} /></div>
                : <div
                    className='sign-in-link u-marg-left-auto'
                    onPointerDown={(ev) => handlePointerDown(ev, setShowAuth, true)}
                  >
                    Sign in
                  </div>}
            </div>
          </header>
          <main>
            <div className='flex-pane flex-pane--narrow'>
              <div className='flex-container flex-container--col'>
                <div>
                  <h1 className='u-marg-top-3 u-marg-bot-2 u-center-text'>Start a new collaborative coding session</h1>
                </div>
                <div className='flex-container flex-container-wrap'>
                  <div
                    className='list-item'
                  >
                    <div
                      className='media media--with-background media--centered media--constrained'
                      onPointerDown={(ev) => handlePointerDown(ev, preLaunch, 'ruby')}
                    >
                      <div className='media__image-container u-marg-top-2 u-marg-bot-2'>
                        <img className='media__image media__image--smaller' src='./images/ruby.png' alt='Ruby icon' />
                      </div>
                      <div className='media__text'>
                        <div className='u-pad-left-1'>
                          <span className='thin-font'>Ruby</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div
                    className='list-item'
                  >
                    <div
                      className='media media--with-background media--centered media--constrained'
                      onPointerDown={(ev) => handlePointerDown(ev, preLaunch, 'node')}
                    >
                      <div className='media__image-container'>
                        <img className='media__image media__image--smaller' src='./images/node.png' alt='Node icon' />
                      </div>
                      <div className='media__text'>
                        <div className='u-pad-left-1'>
                          <span className='thin-font'>Javascript</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div
                    className='list-item'
                  >
                    <div
                      className='media media--with-background media--centered media--constrained'
                      onPointerDown={(ev) => handlePointerDown(ev, preLaunch, 'postgres')}
                    >
                      <div className='media__image-container'>
                        <img className='media__image media__image--smaller' src='./images/postgres.png' alt='Postgres icon' />
                      </div>
                      <div className='media__text'>
                        <div className='u-pad-left-1'>
                          <span className='thin-font'>PostgreSQL</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className='flex-pane flex-pane--wide'>
              <div>
                <CodeSessions authed={auth} setShowAuth={setShowAuth} />
              </div>
            </div>
          </main>
          <footer>
            <div className='media u-pad-bot-4'>
              <div className='media__text'>
                <div className='site-name'>
                  <span className='site-name site-name--color1 site-name--micro'>code</span>
                  <span className='site-name site-name--color2 site-name--micro'>connected</span>
                  <span className='message--micro'>&nbsp;is open source software</span>
                </div>
              </div>
              <div className='media__image-container u-pad-top-2'>
                <a className='image-link' href='https://github.com/npizzigati/codeconnected' />
              </div>
            </div>
          </footer>
        </div>}
    </>
  );

  function closeModals (event) {
    console.log(event.keyCode);
    if (event.keyCode !== 27) {
      return;
    }
    setShowPreLaunchDialog(false);
  }

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

  function abortPreLaunch () {
    setShowPreLaunchDialog(false);
    setPreLaunchLanguage(null);
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
