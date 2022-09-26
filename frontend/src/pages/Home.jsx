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
  const footerDomRef = useRef(null);
  const authDialogDomRef = useRef(null);
  const preLaunchDialogDomRef = useRef(null);
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
    console.log('Checking user authentication');
    let isCanceled = false;
    (async () => {
      const userInfo = await getUserInfo();
      if (isCanceled) {
        return;
      }
      setAuth(userInfo.auth);
      setAuthChecked(true);
      changeCSSInnerHeight();
      setupWindowResizeListener(fixViewport);
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
        icon: { path: './images/timer.png', alt: 'Time-limited' },
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
            <div className='flex-pane flex-container flex-container--vert-centered'>
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
            <div className='flex-pane flex-container flex-container--right-justified flex-container--vert-centered'>
              {auth
                ? <div><UserQuickdash setAuthed={setAuth} /></div>
                : <div
                    className='sign-in-link'
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
                  <h1 className='u-marg-top-3 u-marg-bot-2 u-center-text'>Start a new collaborative coding&nbsp;session</h1>
                </div>
                <div className='flex-container flex-container-wrap'>
                  <div
                    className='list-item'
                  >
                    <div
                      className='media media--with-background media--centered media--constrained u-cursor-pointer'
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
                      className='media media--with-background media--centered media--constrained u-cursor-pointer'
                      onPointerDown={(ev) => handlePointerDown(ev, preLaunch, 'node')}
                    >
                      <div className='media__image-container'>
                        <img className='media__image media__image--smaller' src='./images/node.png' alt='Node icon' />
                      </div>
                      <div className='media__text'>
                        <div className='u-pad-left-1'>
                          <span className='thin-font'>JavaScript</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div
                    className='list-item'
                  >
                    <div
                      className='media media--with-background media--centered media--constrained u-cursor-pointer'
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
          <footer ref={footerDomRef}>
            <div className='media u-pad-bot-1'>
              <div className='media__text'>
                <div className='u-no-wrap'>
                  <span className='site-name site-name--color1 site-name--small'>code</span>
                  <span className='site-name site-name--color2 site-name--small'>connected</span>
                  <span className='message'>&nbsp;is open source software</span>
                </div>
              </div>
              <div className='media__image-container'>
                <a className='image-link' href='https://github.com/npizzigati/codeconnected' />
              </div>
            </div>
          </footer>
        </div>}
    </>
  );

  /**
   * Fix to be passed in to setupWindowResizeListener
   * (Before fix, footer was not always fixed at bottom of
   * screen.) Hide quickly and then show (fade in) footer
   * when changing screen size, to avoid flickering
   * TODO: Check whether this fix is still necessary, since footer is now fixed
   */
  function fixViewport () {
    if (footerDomRef.current === null) {
      return;
    }
    footerDomRef.current.style.visibility = 'hidden';
    footerDomRef.current.style.opacity = 0;
    debounce(changeCSSInnerHeight, 100);
    debounce(() => {
      footerDomRef.current.style.visibility = 'visible';
      footerDomRef.current.style.opacity = 1;
    }, 250);
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
      console.log('Error fetching auth status: ' + error);
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
