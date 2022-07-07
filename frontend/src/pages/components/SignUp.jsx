'use strict';

import React, { useState, useRef, useEffect } from 'react';

function SignUp () {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordDup, setPasswordDup] = useState('');
  const [username, setUsername] = useState('');
  const [emailUsed, setEmailUsed] = useState(false);
  const [displayVerifyMessage, setDisplayVerifyMessage] = useState(false);
  const [emailValidationError, setEmailValidationError] = useState('');
  const [usernameValidationError, setUsernameValidationError] = useState('');
  const [passwordValidationError, setPasswordValidationError] = useState('');
  const [passwordDupValidationError, setPasswordDupValidationError] = useState('');
  const usernameInput = useRef(null);
  const emailInput = useRef(null);
  const passwordInput = useRef(null);
  const passwordDupInput = useRef(null);
  const form = useRef(null);
  const inputFieldSize = '20';
  const inputs = [usernameInput, emailInput, passwordInput, passwordDupInput];

  useEffect(() => {
    if (emailUsed === true) {
      emailInput.current.focus();
    }
  }, [emailUsed]);

  return (
    <>
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
            minLength='6'
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
      </form>

      {emailUsed ? 'That email has already been used.' : ''}
      {displayVerifyMessage ? 'Please check your email to verify and complete registration.' : ''}
    </>
  );

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

    if (ev.target.classList.contains('invalid')) {
      validate(ev.target);
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
    let errorMsg = 'Invalid input';
    const field = input.dataset.validation;
    if (!passwordCheckPass) {
      errorMsg = 'Passwords must match';
    } else if (input.validity.tooShort) {
      errorMsg = `${field} must be at least ${input.minLength} characters`;
    } else if (input.validity.valueMissing) {
      errorMsg = `${field} is required`;
    } else if (input.validity.typeMismatch) {
      errorMsg = `Please enter a valid ${field.toLowerCase()}`;
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
          setEmailUsed(true);
        } else {
          setDisplayVerifyMessage(true);
        }
      });
  }

}

export { SignUp as default };
