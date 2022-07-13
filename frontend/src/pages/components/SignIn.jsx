'use strict';

import React, { useState, useRef, useEffect } from 'react';

function SignIn ({ savedSignInStatus, setSavedSignInStatus }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordDup, setNewPasswordDup] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [emailValidationError, setEmailValidationError] = useState('');
  const [emailForgotPwValidationError, setEmailForgotPwValidationError] = useState('');
  const [passwordValidationError, setPasswordValidationError] = useState('');
  const [newPasswordValidationError, setNewPasswordValidationError] = useState('');
  const [newPasswordDupValidationError, setNewPasswordDupValidationError] = useState('');
  const [codeValidationError, setCodeValidationError] = useState('');
  const [popupMessage, setPopupMessage] = useState('');
  const [status, setStatus] = useState(savedSignInStatus);
  const forgotPasswordEmailInput = useRef(null);
  const emailInput = useRef(null);
  const passwordInput = useRef(null);
  const newPasswordInput = useRef(null);
  const newPasswordDupInput = useRef(null);
  const resetCodeInput = useRef(null);
  const inputs = [emailInput, passwordInput];
  const inputFieldSize = '20';

  // Update status saved in Auth component so that the
  // same information is displayed if the user switches back and
  // forth from the sign-up to the sign-in tabs, regardless of
  // user's stage in the sign-in process
  useEffect(() => {
    setSavedSignInStatus(status);
  }, [status]);

  return (
    <div className='sign-in'>
      <div className='popup-container'>
        <div className='popup'>{popupMessage}</div>
      </div>
      {status === 'pre' &&
        <form noValidate className='sign-in' onSubmit={handleSubmit}>
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
          <span
            className='bottom-link'
            onPointerDown={showForgotPassword}
          >
            Forgot your password?
          </span>
        </form>}
      {status === 'forgotPassword' &&
        <div className='forgot-password'>
          <div className='message'>
            To reset your password, please first verify your email address:
          </div>
          <form noValidate onSubmit={handleSubmitForgotPassword}>
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
                name='forgotPasswordEmail'
                type='email'
                size={inputFieldSize}
                value={forgotPasswordEmail}
                placeholder='Email'
                ref={forgotPasswordEmailInput}
                data-validation='Email'
                required
                onChange={handleForgotPasswordChange}
              />
            </p>
            <p className='error'>
              <span className='col-placeholder' />
              <span>{emailForgotPwValidationError}</span>
            </p>
            <button className='submit-button' type='submit'>Verify</button>
            <span
              className='bottom-link'
              onPointerDown={goBackToSignIn}
            >
              Go back to sign-in form
            </span>
          </form>
        </div>}
      {status === 'resetPassword' &&
        <div className='reset-password'>
          <div className='message'>
            An email with a reset code has been sent to you,&nbsp;
            if your account could be found.&nbsp;
            Please enter your new password below and provide the reset code.
          </div>
          <form noValidate className='sign-in' onSubmit={handleSubmitPasswordReset}>
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
                name='newPassword'
                type='password'
                size={inputFieldSize}
                value={newPassword}
                placeholder='Choose a new password'
                ref={newPasswordInput}
                data-validation='Password'
                required
                minLength='6'
                onChange={handlePasswordResetChange}
              />
            </p>
            <p className='error'>
              <span className='col-placeholder' />
              <span>{newPasswordValidationError}</span>
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
                name='newPasswordDup'
                type='password'
                size={inputFieldSize}
                value={newPasswordDup}
                placeholder='Repeat new password'
                ref={newPasswordDupInput}
                data-validation='Repeat password'
                required
                minLength='6'
                onChange={handlePasswordResetChange}
              />
            </p>
            <p className='error'>
              <span className='col-placeholder' />
              <span>{newPasswordDupValidationError}</span>
            </p>
            <div className='code-field'>
              <label htmlFor='resetCode'>
                Enter code:
              </label>
              <input
                id='resetCode'
                name='resetCode'
                type='text'
                size='5'
                value={resetCode}
                ref={resetCodeInput}
                data-validation='Code'
                required
                onChange={handlePasswordResetChange}
              />
              <div className='error'>{codeValidationError}</div>
            </div>
            <button className='submit-button' type='submit'>Reset password</button>
            <span
              className='bottom-link'
              onPointerDown={goBackToSignIn}
            >
              Go back to sign-in form
            </span>
          </form>
        </div>}
      {status === 'success' &&
        <div className='password-reset-success'>
          <span className='message'>Password successfully reset!</span>
          <span
            className='bottom-link'
            onPointerDown={goBackToSignIn}
          >
            Go to sign-in form
          </span>
        </div>}
    </div>
  );

  function goBackToSignIn () {
    setForgotPasswordEmail('');
    setStatus('pre');
  }

  function showForgotPassword () {
    setStatus('forgotPassword');
  }

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

  function handleForgotPasswordChange (ev) {
    setForgotPasswordEmail(ev.target.value);

    if (ev.target.classList.contains('invalid')) {
      validate(ev.target);
    }
  }

  function handlePasswordResetChange (ev) {
    switch (ev.target.name) {
    case 'newPassword':
      setNewPassword(ev.target.value);
      break;
    case 'newPasswordDup':
      setNewPasswordDup(ev.target.value);
      break;
    case 'resetCode':
      setResetCode(ev.target.value);
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
    case 'forgotPasswordEmail':
      setEmailForgotPwValidationError(errorMsg);
      break;
    case 'newPassword':
      setNewPasswordValidationError(errorMsg);
      break;
    case 'newPasswordDup':
      setNewPasswordDupValidationError(errorMsg);
      break;
    case 'resetCode':
      setCodeValidationError(errorMsg);
      break;
    }
  }

  function validate (input) {
    let passwordCheckPass = true;
    if (input.name === 'newPasswordDup' && input.value !== newPasswordInput.current.value) {
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

  function showPopup (message) {
    setPopupMessage(message);
    setTimeout(() => {
      setPopupMessage('');
    }, 5000);
  }

  function handleSubmitPasswordReset (ev) {
    ev.preventDefault();
    const passwordValid = validate(newPasswordInput.current);
    const passwordDupValid = validate(newPasswordDupInput.current);
    const codeValid = validate(resetCodeInput.current);
    if (!(passwordValid && passwordDupValid && codeValid)) {
      return;
    }

    console.log('"' + forgotPasswordEmail + '"');
    const body = JSON.stringify({ email: forgotPasswordEmail, code: resetCode, newPlaintextPW: newPassword });
    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: body
    };

    fetch('/api/reset-password', options)
      .then(response => {
        return response.json();
      })
      .then(json => {
        console.log(json);
        if (json.status === 'success') {
          console.log('Password changed successfully');
          setStatus('success');
        } else {
          showPopup('Incorrect or expired reset code');
          console.log('Password could not be changed because: ' + json.reason);
        }
      });
  }

  function handleSubmitForgotPassword (ev) {
    ev.preventDefault();
    if (!validate(forgotPasswordEmailInput.current)) {
      return;
    }

    console.log('*' + forgotPasswordEmail + '*');
    const body = JSON.stringify({ email: forgotPasswordEmail });
    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: body
    };

    fetch('/api/forgot-password', options)
      .then(response => response.json())
      .then(json => {
        console.log('forgotpassword status: ' + json.status);
        if (json.status === 'success') {
          console.log('email address found and reset email sent');
          setStatus('resetPassword');
        } else {
          console.log('email address not found and reset email not sent');
          setStatus('resetPassword');
        }
      });
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
          window.location.reload();
        } else {
          showPopup('Username and/or password incorrect');
        }
      });
  }
}

export { SignIn as default };
