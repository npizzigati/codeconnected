'use strict';

import React, { useState, useEffect, useRef } from 'react';
import { handlePointerDown } from '../../helpers/miscUtils.js';

function Invite () {
  const [popupMessage, setPopupMessage] = useState('');
  const inviteDialogDomRef = useRef(null);
  const inviteButtonDomRef = useRef(null);

  useEffect(() => {
    document.addEventListener('pointerdown', inviteHandleDocPointerDown);
    // If escape key custom event fires, close this component's modal dialog
    document.addEventListener('escapePressed', hideInviteDialog);

    return function cleanup () {
      document.removeEventListener('escapePressed', hideInviteDialog);
      document.removeEventListener('pointerdown', inviteHandleDocPointerDown);
    }
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
        <span>Invite</span>
      </div>
      <div className='invite__dialog hidden' ref={inviteDialogDomRef}>
        <div className='u-marg-bot-1'>
          <span className='invite__instructions'>
            Send this link to a friend to join this code session:
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
    </>
  );

  function inviteHandleDocPointerDown (ev) {
    if (!inviteDialogDomRef.current) {
      return;
    }
    if (!inviteDialogDomRef.current.contains(ev.target) && !inviteButtonDomRef.current.contains(ev.target)) {
      hideInviteDialog();
    }
  }

  function toggleInviteDialog () {
    if (inviteDialogDomRef.current.classList.contains('hidden')) {
      inviteDialogDomRef.current.classList.remove('hidden');
    } else {
      inviteDialogDomRef.current.classList.add('hidden');
    }
  }

  function hideInviteDialog () {
    inviteDialogDomRef.current.classList.add('hidden');
  }

  function copyLinkToClipboard () {
    navigator.clipboard.writeText(window.location.href);
    showPopup('Invite link copied to your clipboard');
    hideInviteDialog();
  }

  function showPopup (message) {
    setPopupMessage(message);
    setTimeout(() => {
      setPopupMessage('');
    }, 2000);
  }
}

export { Invite as default };
