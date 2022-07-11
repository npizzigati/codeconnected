'use strict';

import React, { useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';

function SignIn () {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailValidationError, setEmailValidationError] = useState('');
  const [passwordValidationError, setPasswordValidationError] = useState('');
  const [popupMessage, setPopupMessage] = useState('');
  const emailInput = useRef(null);
  const passwordInput = useRef(null);
  const inputs = [emailInput, passwordInput];
  const navigate = useNavigate();
  const inputFieldSize = '20';

  return (
    <>
      <form noValidate className='sign-in' onSubmit={handleSubmit}>
        <div className='popup'>{popupMessage}</div>
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
            placeholder='Password'
            ref={passwordInput}
            data-validation='Password'
            required
            onChange={handleChange}
          />
        </p>
        <p className='error'>
          <span className='col-placeholder' />
          <span>{passwordValidationError}</span>
        </p>
        <button className='submit-button' type='submit'>Sign me in!</button>
        <Link className='forgot-password' to='/forgot-password'>Forgot your password?</Link>
      </form>
    </>
  );

  function handleChange (ev) {
    switch (ev.target.name) {
    case 'email':
      setEmail(ev.target.value);
      break;
    case 'password':
      setPassword(ev.target.value);
      break;
    }

    if (ev.target.classList.contains('invalid')) {
      validate(ev.target);
    }
  }

  function setErrorMessage (input, errorMsg) {
    switch (input.name) {
    case 'email':
      setEmailValidationError(errorMsg);
      break;
    case 'password':
      setPasswordValidationError(errorMsg);
      break;
    }
  }

  function validate (input) {
    console.log('validating ' + input.name);
    if (input.validity.valid) {
      input.classList.remove('invalid');
      setErrorMessage(input, '');
      return true;
    }

    input.classList.add('invalid');
    let errorMsg = 'Invalid input.';
    const field = input.dataset.validation;
    if (input.validity.tooShort) {
      errorMsg = `${field} must be at least ${input.minLength} characters.`;
    } else if (input.validity.valueMissing) {
      errorMsg = `${field} is required.`;
    } else if (input.validity.typeMismatch) {
      errorMsg = `Please enter a valid ${field.toLowerCase()}.`;
    }

    setErrorMessage(input, errorMsg);

    return false;
  }

  function showPopup (message) {
    setPopupMessage(message);
    setTimeout(() => {
      setPopupMessage('');
    }, 5000);
  }

  function handleSubmit (ev) {
    ev.preventDefault();
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

    const body = JSON.stringify({ email, plainTextPW: password });
    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: body
    };

    fetch('/api/sign-in', options)
      .then(response => {
        return response.json();
      })
      .then(json => {
        console.log(json);
        if (json.signedIn === true) {
          navigate('/');
        } else {
          showPopup('Username and/or password incorrect');
        }
      });
  }
}

export { SignIn as default };
