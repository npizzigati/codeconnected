'use strict';

import React, { useState, useRef, useEffect } from 'react';
import { handlePointerDown } from '../../helpers/miscUtils.js';
import FadeLoader from 'react-spinners/FadeLoader';

function SignUp ({ setShowAuth, setAuthed, setSavedActivationStatus, config }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordDup, setPasswordDup] = useState('');
  const [username, setUsername] = useState('');
  const [emailValidationError, setEmailValidationError] = useState('');
  const [usernameValidationError, setUsernameValidationError] = useState('');
  const [passwordValidationError, setPasswordValidationError] = useState('');
  const [passwordDupValidationError, setPasswordDupValidationError] = useState('');
  const [codeValidationError, setCodeValidationError] = useState('');
  const [activationStatus, setActivationStatus] = useState('pre');
  const [activationCode, setActivationCode] = useState('');
  const [popupMessage, setPopupMessage] = useState('');
  const [failureMessage, setFailureMessage] = useState('');
  const [showSpinner, setShowSpinner] = useState(false);
  const [showBackdrop, setShowBackdrop] = useState(false);
  const usernameInput = useRef(null);
  const emailInput = useRef(null);
  const passwordInput = useRef(null);
  const passwordDupInput = useRef(null);
  const codeInput = useRef(null);
  const form = useRef(null);
  const popupTimeout = useRef(null);
  const spinnerStartTimeout = useRef(null);
  const inputFieldSize = '25';
  const inputs = [usernameInput, emailInput, passwordInput, passwordDupInput];

  // Update activation status saved in Auth component so that the
  // same information is displayed if the user switches back and
  // forth from the sign-up to the sign-in tabs, regardless of
  // user's stage in the sign up process
  useEffect(() => {
    setSavedActivationStatus(activationStatus);
  }, [activationStatus]);

  return (
    <>
      <div className='popup-container'>
        <div className='popup'>{popupMessage}</div>
      </div>
      {activationStatus === 'pre' &&
        <form noValidate className='form' ref={form} onSubmit={handleSubmit}>
          {showBackdrop && <div className='backdrop backdrop--transparent backdrop--level2' />}
          {showSpinner &&
            <div>
              <div className='spinner-container spinner-container--small'>
                <FadeLoader
                  color='#369999'
                  loading={showSpinner}
                  size={50}
                />
              </div>
            </div>}
          <p className='form__subheading u-marg-bot-4'>Create a free account</p>
          <p className='form__row'>
            <label className='form__label' htmlFor='username'>
              <img
                className='form__label-img'
                src='./images/blank_avatar.png'
                alt='avatar'
              />
            </label>
            <input
              className='form__input'
              id='username'
              name='username'
              type='text'
              size={inputFieldSize}
              value={username}
              placeholder='Choose a username'
              ref={usernameInput}
              data-validation='Username'
              required
              maxLength='30'
              onChange={handleChange}
            />
          </p>
          <p className='form__row form__row--error'>
            <span className='form__blank-item' />
            <span className='form__error-item'>{usernameValidationError}</span>
          </p>
          <p className='form__row'>
            <label className='form__label' htmlFor='email'>
              <img
                className='form__label-img'
                src='./images/mail.png'
                alt='email icon'
              />
            </label>
            <input
              className='form__input'
              id='email'
              name='email'
              type='email'
              size={inputFieldSize}
              value={email}
              placeholder='Email'
              ref={emailInput}
              data-validation='Email'
              required
              maxLength='70'
              onChange={handleChange}
            />
          </p>
          <p className='form__row form__row--error'>
            <span className='form__blank-item' />
            <span className='form__error-item'>{emailValidationError}</span>
          </p>
          <p className='form__row'>
            <label className='form__label' htmlFor='password'>
              <img
                className='form__label-img'
                src='./images/key_icon.png'
                alt='password icon'
              />
            </label>
            <input
              className='form__input'
              id='password'
              name='password'
              type='password'
              size={inputFieldSize}
              value={password}
              placeholder='Choose a password'
              ref={passwordInput}
              data-validation='Password'
              required
              minLength='6'
              maxLength='70'
              onChange={handleChange}
            />
          </p>
          <p className='form__row form__row--error'>
            <span className='form__blank-item' />
            <span className='form__error-item'>{passwordValidationError}</span>
          </p>
          <p className='form__row'>
            <label className='form__label' htmlFor='passwordDup'>
              <img
                className='form__label-img'
                src='./images/key_icon.png'
                alt='password icon'
              />
            </label>
            <input
              className='form__input'
              id='passwordDup'
              name='passwordDup'
              type='password'
              size={inputFieldSize}
              value={passwordDup}
              ref={passwordDupInput}
              placeholder='Repeat password'
              data-validation='Repeated password'
              required
              onChange={handleChange}
            />
          </p>
          <p className='form__row form__row--error'>
            <span className='form__blank-item' />
            <span className='form__error-item'>{passwordDupValidationError}</span>
          </p>
          <button className='form__submit-button u-center-block u-marg-top-1 u-marg-bot-2' type='submit'>Sign up</button>
        </form>}
      {activationStatus === 'underway' &&
        <div className='activation'>
          <form className='form' noValidate onSubmit={handleCodeSubmit}>
            {showBackdrop && <div className='backdrop backdrop--transparent backdrop--level2' />}
            {showSpinner &&
              <div>
                <div className='spinner-container spinner-container--small'>
                  <FadeLoader
                    color='#369999'
                    loading={showSpinner}
                    size={50}
                  />
                </div>
              </div>}
            <div className='form__subheading u-pad-bot-1'>
              A verification code has been sent to your email address:
            </div>
            <div className='form__subheading form__subheading-medium u-center-text u-marg-bot-3'>
              {email}
            </div>
            <div>
              <label className='form__label form__label--code u-center-text u-marg-top-2 u-marg-bot-1' htmlFor='activationCode'>
                Enter code:
              </label>
              <input
                id='activationCode'
                className='form__input form__input--code u-center-block'
                name='activationCode'
                type='text'
                size='5'
                value={activationCode}
                ref={codeInput}
                data-validation='Code'
                required
                onChange={handleCodeChange}
              />
              <div className='form__error-item form__error-item--code u-center-text'>{codeValidationError}</div>
            </div>
            <button className='form__submit-button u-center-block u-marg-top-1' type='submit'>Complete Registration</button>
            <span
              className='form__bottom-link u-marg-top-3'
              onPointerDown={(ev) => handlePointerDown(ev, resendEmail, ev)}
            >
              Resend activation code
            </span>
            <span
              className='form__bottom-link u-marg-top-1'
              onPointerDown={(ev) => handlePointerDown(ev, goBackToSignUp, ev)}
            >
              Go back to sign-up form
            </span>
          </form>
        </div>}
      {activationStatus === 'success' &&
        <div>
          <form noValidate className='form' onSubmit={handleGetStartedSubmit}>
            <div className='form__subheading form__subheading--medium'>You are now registered and signed&nbsp;in!</div>
            <button className='form__submit-button u-center-block u-marg-top-3' type='submit'>Continue</button>
          </form>
        </div>}

      {activationStatus === 'failure' &&
        <div className='u-pad-top-3 u-pad-bot-3'>
          <div className='form__subheading'>{failureMessage}</div>
          <span
            className='form__bottom-link u-marg-top-3 u-marg-bot-3'
            onPointerDown={(ev) => handlePointerDown(ev, goBackToSignUp, ev)}
          >
            Go back to sign-up form
          </span>
        </div>}
    </>
  );

  function displaySpinnerAndBackdrop () {
    setShowBackdrop(true);
    // Delay before starting spinner so that it doesn't show if
    // response is received quickly
    spinnerStartTimeout.current = setTimeout(() => setShowSpinner(true), 250);
  }

  function hideSpinnerAndBackdrop () {
    setShowBackdrop(false);
    clearTimeout(spinnerStartTimeout.current);
    setShowSpinner(false);
  }


  function handleGetStartedSubmit (ev) {
    ev.preventDefault();
    setShowAuth(false);
    setAuthed(true);
    if (config.successCallback) {
      config.successCallback();
    }
  }

  function handleCodeChange (ev) {
    setActivationCode(ev.target.value);

    if (ev.target.classList.contains('invalid')) {
      validate(ev.target);
    }
  }

  async function handleCodeSubmit (ev) {
    ev.preventDefault();
    setCodeValidationError('');
    codeInput.current.classList.remove('invalid');

    const valid = validate(codeInput.current);
    if (!valid) {
      return;
    }

    const body = JSON.stringify({ code: activationCode, email });
    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: body
    };

    displaySpinnerAndBackdrop();
    try {
      const response = await fetch('/api/activate-user', options);
      const json = await response.json();
      hideSpinnerAndBackdrop();
      if (json.status === 'success') {
        setActivationStatus('success');
        return;
      }
      if (json.isFatal) {
        setFailureMessage(json.message);
        setActivationStatus('failure');
        return;
      }
      showPopup(json.message);
    } catch (error) {
      showPopup('Something went wrong — please try again');
    }
  }

  function handleChange (ev) {
    switch (ev.target.name) {
    case 'username':
      setUsername(ev.target.value);
      break;
    case 'email':
      setEmail(ev.target.value);
      break;
    case 'password':
      setPassword(ev.target.value);
      break;
    case 'passwordDup':
      setPasswordDup(ev.target.value);
      break;
    }

    // Validate input if it was invalid before key entered (to
    // provide message to user to help enter correct value)
    if (ev.target.classList.contains('invalid')) {
      validate(ev.target);
    }

    // Do no other validation unless field is password or
    // password duplicate
    if (ev.target !== passwordInput.current &&
        ev.target !== passwordDupInput.current) {
      return;
    }

    // Validate both password fields if either password field
    // was invalid before key entered, since the validation of
    // one depends on the other (they must match)
    if (passwordInput.current.classList.contains('invalid') ||
        passwordDupInput.current.classList.contains('invalid')) {
      validate(passwordInput.current);
      validate(passwordDupInput.current);
    }
  }

  // FIXME: Is this ev arg really necessary here, along with the preventDefault?
  function goBackToSignUp (ev) {
    ev.preventDefault();
    setActivationCode('');
    setCodeValidationError('');
    clearPreFormInputs();
    setActivationStatus('pre');
  }

  function clearPreFormInputs () {
    setUsername('');
    setEmail('');
    setPassword('');
    setPasswordDup('');
  }

  function showPopup (message) {
    setPopupMessage(message);
    clearTimeout(popupTimeout.current);
    popupTimeout.current = setTimeout(() => {
      setPopupMessage('');
    }, 5000);
  }

  async function resendEmail () {
    const body = JSON.stringify({ email, username });
    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: body
    };
    displaySpinnerAndBackdrop();
    try {
      const response = await fetch('/api/resend-verification-email', options);
      const json = await response.json();
      hideSpinnerAndBackdrop();
      if (json.status === 'success') {
        showPopup('A new code was sent to your email');
        return;
      }
      if (json.isFatal) {
        setFailureMessage(json.message);
        setActivationStatus('failure');
        return;
      }
      showPopup(json.message);
    } catch (error) {
      showPopup('Something went wrong — please try again');
    }
  }

  function validate (input) {
    let passwordCheckPass = true;
    if (input.name === 'passwordDup' && input.value !== passwordInput.current.value) {
      passwordCheckPass = false;
    }

    if (input.validity.valid && passwordCheckPass) {
      input.classList.remove('invalid');
      setErrorMessage(input, '');
      return true;
    }

    input.classList.add('invalid');
    let errorMsg = 'Invalid input.';
    const field = input.dataset.validation;
    if (!passwordCheckPass) {
      errorMsg = 'Passwords must match.';
    } else if (input.validity.tooShort) {
      errorMsg = `${field} must be at least ${input.minLength} characters.`;
    } else if (input.validity.valueMissing) {
      errorMsg = `${field} is required.`;
    } else if (input.validity.typeMismatch) {
      errorMsg = `Please enter a valid ${field.toLowerCase()}.`;
    }

    setErrorMessage(input, errorMsg);

    return false;
  }

  function setErrorMessage (input, errorMsg) {
    switch (input.name) {
    case 'username':
      setUsernameValidationError(errorMsg);
      break;
    case 'email':
      setEmailValidationError(errorMsg);
      break;
    case 'password':
      setPasswordValidationError(errorMsg);
      break;
    case 'passwordDup':
      setPasswordDupValidationError(errorMsg);
      break;
    case 'activationCode':
      setCodeValidationError(errorMsg);
      break;
    }
  }

  function resetValidation (ev) {
    setUsernameValidationError('');
    setEmailValidationError('');
    setPasswordValidationError('');
    setPasswordDupValidationError('');
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i].current;
      input.classList.remove('invalid');
    }
  }

  async function handleSubmit (ev) {
    ev.preventDefault();
    resetValidation();
    let allFieldsValid = true;
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i].current;
      const valid = validate(input);
      if (!valid) {
        allFieldsValid = false;
      }
    }

    if (allFieldsValid === false) {
      return;
    }

    // TODO: The base url is no longer necessary since I only
    // send the user a code and not a link now. Remove this from
    // here and from go app.
    // Send the baseURL so that the activation link can have the
    // proper address so we can, e.g., test on localhost
    const portString = (window.location.port === '') ? '' : `:${window.location.port}`;
    const baseURL = window.location.protocol + '//' + window.location.hostname + portString;
    const body = JSON.stringify({ baseURL, username, email, plainTextPW: password });
    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: body
    };

    displaySpinnerAndBackdrop();
    try {
      const response = await fetch('/api/sign-up', options);
      const json = await response.json();
      hideSpinnerAndBackdrop();
      if (json.status !== 'success') {
        showPopup('Error in processing sign-up request');
      } else if (json.emailUsed) {
        setErrorMessage(emailInput.current, 'Email in use or pending activation.');
        emailInput.current.classList.add('invalid');
      } else {
        setActivationStatus('underway');
      }
    } catch (error) {
      showPopup('Error in processing sign-up request');
    }
  }
}

export { SignUp as default };
