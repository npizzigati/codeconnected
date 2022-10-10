'use strict';

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { CSSTransition } from 'react-transition-group';

import UserQuickdash from './components/UserQuickdash.jsx';
import PopupDialog from './components/PopupDialog.jsx';
import Auth from './components/Auth.jsx';
import CodeSessions from './components/CodeSessions.jsx';

import { requestRoom } from '../helpers/launchUtils.js';
import { handlePointerDown, debounce, setupWindowResizeListener, changeCSSInnerHeight } from '../helpers/miscUtils.js';

function Home () {
  const [auth, setAuth] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [preLaunchLanguage, setPreLaunchLanguage] = useState('');
  const [showPreLaunchDialog, setShowPreLaunchDialog] = useState(false);
  const isPreLaunchDialogVisible = useRef(false);
  const [authChecked, setAuthChecked] = useState(false);
  const mainDomRef = useRef(null);
  const authDialogDomRef = useRef(null);
  const preLaunchDialogDomRef = useRef(null);
  const initialAuthTab = useRef('SignIn');
  const navigate = useNavigate();
  const escapeEvent = new Event('escapePressed');

  // This use effect makes it possible for our 'escapePressed'
  // event listener to know about the appropriate state
  useEffect(() => {
    isPreLaunchDialogVisible.current = showPreLaunchDialog;
  }, [showPreLaunchDialog]);

  useEffect(() => {
    // When resizing screen, it's useful to have the body be the
    // same color as the content background, to avoid background
    // artifacts
    document.body.style.backgroundColor = 'white';
    let isCanceled = false;
    (async () => {
      const userInfo = await getUserInfo();
      if (isCanceled) {
        return;
      }
      setAuth(userInfo.auth);
      setAuthChecked(true);

      setupWindowResizeListener(() => {
        debounce(changeCSSInnerHeight, 100);
      });

      const resizeObserver = new ResizeObserver(() => {
        debounce(changeCSSInnerHeight, 100);
      });
      resizeObserver.observe(mainDomRef.current);
    })();

    // Fire custom events on keydown
    document.addEventListener('keydown', fireKeydownEvents);

    // If escape custom event fires, close this component's modal dialogs
    document.addEventListener('escapePressed', closeModals);

    return function cleanup () {
      isCanceled = true;
      document.removeEventListener('escapePressed', closeModals);
      document.removeEventListener('keydown', fireKeydownEvents);
    };
  }, []);

  const popupDialogConfig = {
    message: {
      icon: { path: './images/attention.png', alt: 'Attention' },
      text: 'Sessions created by unregistered users have a 20-minute time limit'
    },
    options: [
      {
        number: 1,
        icon: { path: './images/login.png', alt: 'Login' },
        text: 'Sign in/up to remove time limit',
        callback: preLaunchSignIn
      },
      {
        number: 2,
        icon: { path: './images/timer.png', alt: 'Time-limited' },
        text: 'Continue to time-limited session',
        callback: continueAnyway
      }
    ],
    abortCallback: abortPreLaunch,
    theme: 'dark'
  };

  return (
    <>
      {authChecked &&
        <div id='home'>
          <CSSTransition
            in={showAuth}
            timeout={300}
            classNames='react-css-transition-auth-dialog'
            nodeRef={authDialogDomRef}
            mountOnEnter
            unmountOnExit
          >
            <div ref={authDialogDomRef}>
              <Auth
                setShowAuth={setShowAuth}
                setAuthed={setAuth}
                setPreLaunchLanguage={setPreLaunchLanguage}
                initialTab={initialAuthTab.current}
                config={preLaunchLanguage === '' ? {} : { successCallback: () => launch(preLaunchLanguage) }}
              />
            </div>
          </CSSTransition>
          <CSSTransition
            in={showPreLaunchDialog}
            timeout={300}
            classNames='react-css-transition-popup-dialog'
            nodeRef={preLaunchDialogDomRef}
            mountOnEnter
            unmountOnExit
          >
            <div ref={preLaunchDialogDomRef}>
              <PopupDialog config={popupDialogConfig} />
            </div>
          </CSSTransition>
          <header>
              <div className='flex-pane'>
                <div className='flex-pane flex-container'>
                  <div className='media u-marg-left-1'>
                    <div className='media__image-container'>
                      <img className='media__image media__image--tinier' src='./images/codeconnected.png' alt='Logo' />
                      </div>
                    <div className='media__text'>
                      <div className='site-name site-name--medium'>
                        <span className='site-name--color1'>code</span>
                        <span className='site-name--color2'>connected</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className='flex-pane flex-container flex-container--main-end u-pad-top-1 u-pad-right-2'>
                {auth
                ? <div><UserQuickdash setAuthed={setAuth} /></div>
                : <div className='header-text u-pad-top-1'>
                    <span className='sign-in-link' onPointerDown={(ev) => handlePointerDown(ev, displaySignIn)}>Sign in</span>
                    <span> / </span>
                    <span className='sign-in-link' onPointerDown={(ev) => handlePointerDown(ev, displaySignUp)}>Sign up</span>
                  </div>}
              </div>
          </header>
          <main ref={mainDomRef}>
            <div className='side-pane' />
            <div className='center-pane'>
              <div className='content-block-1'>
                <div className='flex-pane flex-pane--medium flex-container flex-container--col'>
                  <h1>Start a new coding&nbsp;session&nbsp;&nbsp;&nbsp;</h1>
                  <div>
                    <div className='aligned-block u-pad-top-2 u-pad-bot-4 u-pad-left'>
                      <div
                        className='aligned-block__row aligned-block__row--wide-spaced aligned-block__row--clickable aligned-block__row--changeable'
                        onPointerDown={(ev) => handlePointerDown(ev, preLaunch, 'ruby')}
                      >
                        <div className='aligned-block__cell u-center-text'>
                          <img
                            className='aligned-block__image aligned-block__image--tiny'
                            src='./images/ruby.png'
                            alt='Ruby icon'
                          />
                        </div>
                        <div className='aligned-block__cell u-pad-left-2 u-pad-top-1'>
                          <span className='thin-font'>Ruby</span>
                        </div>
                      </div>
                      <div
                        className='aligned-block__row aligned-block__row--wide-spaced aligned-block__row--clickable aligned-block__row--changeable'
                        onPointerDown={(ev) => handlePointerDown(ev, preLaunch, 'node')}
                      >
                        <div className='aligned-block__cell u-center-text'>
                          <img
                            className='aligned-block__image aligned-block__image--tiny'
                            src='./images/js.png'
                            alt='JS icon'
                          />
                        </div>
                        <div className='aligned-block__cell u-pad-left-2 u-pad-top-1'>
                          <span className='thin-font'>JavaScript</span>
                        </div>
                      </div>
                      <div
                        className='aligned-block__row aligned-block__row--wide-spaced aligned-block__row--clickable aligned-block__row--changeable'
                        onPointerDown={(ev) => handlePointerDown(ev, preLaunch, 'postgres')}
                      >
                        <div className='aligned-block__cell u-center-text'>
                          <img
                            className='aligned-block__image aligned-block__image--tiny'
                            src='./images/postgres.png'
                            alt='Postgres icon'
                          />
                        </div>
                        <div className='aligned-block__cell u-pad-left-2 u-pad-top-1'>
                          <span className='thin-font'>PostgreSQL</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className='content-block-2'>
                <div>
                  <div className='content-block-header'>
                    <h1>Resume a&nbsp;session&nbsp;&nbsp;&nbsp;</h1>
                  </div>
                </div>
                <div className='flex-pane flex-container u-marg-bot-3'>
                  {auth
                    ? <div className='code-sessions-container'>
                        <CodeSessions authed={auth} />
                      </div>
                    : <div className='u-pad-top-5'>
                        <p className='message message--small'>
                          <span className='u-clickable u-underlined' onPointerDown={(ev) => handlePointerDown(ev, displaySignIn)}>Sign in</span>
                          <span> / </span>
                          <span className='u-clickable u-underlined' onPointerDown={(ev) => handlePointerDown(ev, displaySignUp)}>sign up</span>
                          <span> to access previous&nbsp;sessions&nbsp;&nbsp;&nbsp;&nbsp;</span>
                        </p>
                      </div>}
                </div>
              </div>
              <div className='flex-pane flex-container flex-container--main-centered'>
                <div><img className='content-block-image' src='./images/monster.png' alt='Monster' /></div>
              </div>
            </div>
            <div className='side-pane' />
          </main>
          <footer />
        </div>}
    </>
  );

  function displaySignIn () {
    initialAuthTab.current = 'signIn';
    setShowAuth(true);
  }

  function displaySignUp () {
    initialAuthTab.current = 'signUp';
    setShowAuth(true);
  }

  function fireKeydownEvents (event) {
    // Escape is keyCode 27
    if (event.keyCode === 27) {
      document.dispatchEvent(escapeEvent);
    }
  }

  function closeModals () {
    if (isPreLaunchDialogVisible.current) {
      abortPreLaunch();
    }
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
      return { auth: false };
    }
  }

  function abortPreLaunch () {
    setShowPreLaunchDialog(false);
    setPreLaunchLanguage('');
  }

  function continueAnyway () {
    setShowPreLaunchDialog(false);
    launch(preLaunchLanguage);
  }

  function preLaunchSignIn () {
    initialAuthTab.current = 'signIn';
    setShowPreLaunchDialog(false);
    setShowAuth(true);
  }

  async function launch (language) {
    const roomID = await requestRoom(language);
    if (roomID === null) {
      // Could not create room
      // TODO: Handle this problem / try again
      return;
    }
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
