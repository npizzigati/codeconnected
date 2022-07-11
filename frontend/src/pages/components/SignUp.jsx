'use strict';

import React, { useState, useRef } from 'react';

function SignUp () {
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
  const usernameInput = useRef(null);
  const emailInput = useRef(null);
  const passwordInput = useRef(null);
  const passwordDupInput = useRef(null);
  const codeInput = useRef(null);
  const form = useRef(null);
  const inputFieldSize = '20';
  const inputs = [usernameInput, emailInput, passwordInput, passwordDupInput];

  return (
    <>
      {activationStatus === 'pre' &&
        <form noValidate className='sign-up' ref={form} onSubmit={handleSubmit}>
          <p>
            <label htmlFor='username'>
              <img
                className='avatar'
                src='./blank_avatar.png'
                alt='avatar'
              />
            </label>
            <input
              id='username'
              name='username'
              type='text'
              size={inputFieldSize}
              value={username}
              placeholder='Choose a username'
              ref={usernameInput}
              data-validation='Username'
              required
              onChange={handleChange}
            />
          </p>
          <p className='error'>
            <span className='col-placeholder' />
            <span>{usernameValidationError}</span>
          </p>
          <p>
            <label htmlFor='email'>
              <img
                className='email-icon'
                src='./mail.png'
                alt='email icon'
              />
            </label>
            <input
              id='email'
              name='email'
              type='email'
              size={inputFieldSize}
              value={email}
              placeholder='Email'
              ref={emailInput}
              data-validation='Email'
              required
              onChange={handleChange}
            />
          </p>
          <p className='error'>
            <span className='col-placeholder' />
            <span>{emailValidationError}</span>
          </p>
          <p>
            <label htmlFor='password'>
              <img
                className='password-icon'
                src='./key_icon.png'
                alt='password icon'
              />
            </label>
            <input
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
              onChange={handleChange}
            />
          </p>
          <p className='error'>
            <span className='col-placeholder' />
            <span>{passwordValidationError}</span>
          </p>
          <p>
            <label htmlFor='passwordDup'>
              <img
                className='password-icon'
                src='./key_icon.png'
                alt='password icon'
              />
            </label>
            <input
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
          <p className='error'>
            <span className='col-placeholder' />
            <span>{passwordDupValidationError}</span>
          </p>
          <p>
            <span className='col-placeholder' />
            <button className='submit-button' type='submit'>Sign me up!</button>
          </p>
        </form>}
      {activationStatus === 'underway' &&
        <div className='activation'>
          <form noValidate onSubmit={handleCodeSubmit}>
            <div className='message'>
              A verification code has been sent to:
            </div>
            <div className='email'>
              {email}
            </div>
            <div className='code-field'>
              <label htmlFor='username'>
                Enter code:
              </label>
              <input
                id='activationCode'
                name='activationCode'
                type='text'
                size='5'
                value={activationCode}
                ref={codeInput}
                data-validation='Code'
                required
                onChange={handleCodeChange}
              />
              <div className='error'>{codeValidationError}</div>
            </div>
            <button className='submit-button' type='submit'>Complete Registration</button>
            <span
              className='bottom-link'
              onPointerDown={resendEmail}
            >
              Resend activation code
            </span>
            <span
              className='bottom-link'
              onPointerDown={goBackToSignUp}
            >
              Go back to sign-up form
            </span>
          </form>
        </div>}
      {activationStatus === 'success' &&
        <div className='activation-success'>
          <form noValidate onSubmit={handleGetStartedSubmit}>
            <span className='message'>Activation successful!</span>
            <button className='submit-button' type='submit'>Get started!</button>
          </form>
        </div>}
    </>
  );

  function handleGetStartedSubmit (ev) {
    ev.preventDefault();
    window.location.reload();
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

    const body = JSON.stringify({ code: activationCode });
    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: body
    };

    try {
      const response = await fetch('/api/activateuser', options);
      const results = await response.json();
      console.log('activation status: ' + results.status);
      if (results.status === 'success') {
        console.log('activation successful');
        setActivationStatus('success');
      } else {
        setErrorMessage(codeInput.current, 'Invalid or expired activation code.');
        codeInput.current.classList.add('invalid');
      }
    } catch (error) {
      console.error('Error fetching json:', error);
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

  function goBackToSignUp (ev) {
    ev.preventDefault();
    setActivationCode('');
    setCodeValidationError('');
    setActivationStatus('pre');
  }

  function resendEmail () {
    const body = JSON.stringify({ email });
    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: body
    };

    fetch('/api/resend-verification-email', options)
      .then(response => response.json())
      .then(json => {
        console.log(json);
        if (json.status === 'success') {
          // TODO: show 'email resent' popup
          console.log('email resent');
        } else {
          // TODO: show 'resend failed' popup
          console.log('email NOT resent');
        }
      });
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

  function handleSubmit (ev) {
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
    console.log('baseURL: ' + baseURL);
    const body = JSON.stringify({ baseURL, username, email, plainTextPW: password });
    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: body
    };

    fetch('/api/sign-up', options)
      .then(response => response.json())
      .then(json => {
        if (json.emailUsed) {
          setErrorMessage(emailInput.current, 'Email already taken. Try signing in?');
          emailInput.current.classList.add('invalid');
        } else {
          setActivationStatus('underway');
        }
      });
  }


}

export { SignUp as default };
