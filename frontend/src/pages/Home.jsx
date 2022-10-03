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
  const footerDomRef = useRef(null);
  const headerDomRef = useRef(null);
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
      // changeCSSInnerHeight();
      setupWindowResizeListener(() => {
        fixViewport();
        debounce(hideOrShowScrollbar, 300);
      });

      const resizeObserver = new ResizeObserver(() => {
        hideOrShowScrollbar();
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
          <header ref={headerDomRef}>
            <div className='flex-pane flex-container flex-container--vert-centered'>
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
          <main ref={mainDomRef}>
            <div className='flex-pane' />
            <div className='flex-pane'>
              <div className='content-block-1'>
                <div className='flex-pane flex-pane--medium flex-container flex-container--col u-pad-top-5'>
                  <div className='content-block-header'>
                    <h1>&gt;&gt; Start a new collaborative coding&nbsp;session</h1>
                  </div>
                  <div>
                    <div className='aligned-block u-pad-top-5'>
                      <div
                        className='aligned-block__row aligned-block__row--wide-spaced aligned-block__row--clickable'
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
                        <div className='aligned-block__underline' />
                      </div>
                      <div
                        className='aligned-block__row aligned-block__row--wide-spaced aligned-block__row--clickable'
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
                        <div className='aligned-block__underline' />
                      </div>
                      <div
                        className='aligned-block__row aligned-block__row--wide-spaced aligned-block__row--clickable'
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
                        <div className='aligned-block__underline' />
                      </div>
                    </div>
                    <div className='main-image-container'>
                      <img className='main-image-1' src='./images/start_session.png' alt='start session' />
                    </div>
                  </div>
                </div>
              </div>
              <div className='content-block-2'>
                <div>
                  <div className='content-block-header'>
                    <h1>&gt;&gt; Resume a session</h1>
                  </div>
                </div>
                <div className='flex-pane flex-container'>
                  <div className='u-pad-top-6'>
                    <img className='main-image-2' src='./images/launch_saved_session.png' alt='start session' />
                  </div>
                  {auth
                    ? <div className='code-sessions-container'>
                        <CodeSessions authed={auth} />
                      </div>
                    : <div className='flex-pane u-pad-top-8 u-pad-left-5'>
                        <p className='flex-pane__message flex-pane__message--small'><span className='flex-pane__sign-in-link' onPointerDown={(ev) => handlePointerDown(ev, setShowAuth, true)}>Sign&nbsp;in</span>&nbsp;to&nbsp;access previous&nbsp;sessions</p>
                      </div>}
                </div>
              </div>
            </div>
            <div className='flex-pane' />
          </main>
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

  /**
   * Since we add a margin to the top and bottom of the text area
   * of the page so that the viewable area will never be under
   * the fixed header or footer, there is always overflow. This
   * function will show the scrollbar if necessary (when there is
   * really text that needs to be scrolled to, and hide it otherwise)
   */
  function hideOrShowScrollbar () {
    if (window === null || footerDomRef.current === null || headerDomRef.current === null || mainDomRef.current === null) {
      return;
    }
    if (window.innerHeight - footerDomRef.current.clientHeight - headerDomRef.current.clientHeight < mainDomRef.current.clientHeight) {
      document.body.style.overflow = 'scroll';
    } else {
      document.body.style.overflow = 'hidden';
      // Scroll to top to avoid any text being hidden under header
      window.scrollTo({ top: 0 });
    }
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
