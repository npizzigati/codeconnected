'use strict';

import React, { useState, useEffect, useRef } from 'react';
import { handlePointerDown } from '../../helpers/miscUtils.js';

function Invite () {
  const [showDialog, setShowDialog] = useState(false);
  const [popupMessage, setPopupMessage] = useState('');
  const inviteDialogDomRef = useRef(null);
  const inviteButtonDomRef = useRef(null);

  useEffect(() => {
    function handleDocPointerDown (ev) {
      if (!inviteDialogDomRef.current) {
        return;
      }
      if (!inviteDialogDomRef.current.contains(ev.target) && !inviteButtonDomRef.current.contains(ev.target)) {
        console.log(ev.target);
        console.log('hiding dialog');
        setShowDialog(false);
      }
    }

    document.addEventListener('pointerdown', handleDocPointerDown);

    // If escape key custom event fires, close this component's modal dialog
    document.addEventListener('escapePressed', () => setShowDialog(false));
  });

  return (
    <>
      <div className='popup-container'>
        <div className='popup'>{popupMessage}</div>
      </div>
      <div
        className='invite__button'
        ref={inviteButtonDomRef}
        onPointerDown={ev => handlePointerDown(ev, toggleInviteDialog)}
      >
        <span>Invite&nbsp;Link</span>
      </div>
      {showDialog &&
        <div className='invite__dialog' ref={inviteDialogDomRef}>
          <div className='u-marg-bot-1'>
            <span className='invite__instructions'>
              Visitors to this url will join this code session:
            </span>
          </div>
          <div className='media'>
            <div className='media__text'>
              <span className='invite__text'>{window.location.href}</span>
            </div>
            <div className='media__image-container'>
              <img
                className='media__image--micro media__image--clickable'
                src='./images/copy.png'
                onPointerDown={ev => handlePointerDown(ev, copyLinkToClipboard)}
              />
            </div>
          </div>
        </div>
      }
    </>
  );

  function toggleInviteDialog () {
    setShowDialog(!showDialog);
  }

  function copyLinkToClipboard () {
    navigator.clipboard.writeText(window.location.href);
    showPopup('Invite link copied to your clipboard');
  }

  function showPopup (message) {
    setPopupMessage(message);
    setTimeout(() => {
      setPopupMessage('');
      setShowDialog(false);
    }, 2000);
  }
}

export { Invite as default };
