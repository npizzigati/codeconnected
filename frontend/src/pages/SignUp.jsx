'use strict';

import React, { useState, useRef, useEffect } from 'react';

function SignUp () {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordDup, setPasswordDup] = useState('');
  const [username, setUsername] = useState('');
  const [emailUsed, setEmailUsed] = useState(false);
  const [displayVerifyMessage, setDisplayVerifyMessage] = useState(false);

  const emailInput = useRef(null);

  useEffect(() => {
    if (emailUsed === true) {
      emailInput.current.focus();
    }
  }, [emailUsed]);
  return (
    <>
      <form onSubmit={handleSubmit}>
        <label htmlFor='username'>Username:</label>
        <input id='username' className='sign-up-form' name='username' type='text' value={username} onChange={handleChange} />
        <label htmlFor='email'>Email:</label>
        <input id='email' name='email' className='sign-up-form' type='text' value={email} onChange={handleChange} ref={emailInput} />
        <label htmlFor='password'>Password:</label>
        <input id='password' className='sign-up-form' name='password' type='password' value={password} onChange={handleChange} />
        <label htmlFor='passwordDup'>Enter your password again:</label>
        <input id='passwordDup' className='sign-up-form' name='passwordDup' type='password' value={passwordDup} onChange={handleChange} />
        <input className='sign-up-form' type='submit' value='Submit' />
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
  }

  function handleSubmit (ev) {
    // TODO: Validate fields
    ev.preventDefault();

    // Check password entered same twice
    if (password !== passwordDup) {
      window.alert('Please make sure you enter the same password in both fields.');
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
