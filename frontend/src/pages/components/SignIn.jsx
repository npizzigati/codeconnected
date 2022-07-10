'use strict';

import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

function SignIn () {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const inputFieldSize = '20';

  return (
    <>
      <form className='sign-in' onSubmit={handleSubmit}>
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
            type='text'
            size={inputFieldSize}
            value={email}
            placeholder='Email'
            onChange={handleChange}
          />
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
            onChange={handleChange}
          />
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
  }

  function handleSubmit (ev) {
    ev.preventDefault();
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
        }
      });
  }
}

export { SignIn as default };
