'use strict';

import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

function SignIn () {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  return (
    <>
      <form onSubmit={handleSubmit}>
        <label htmlFor='email'>Email:</label>
        <input id='email' name='email' className='sign-in-form' type='text' value={email} onChange={handleChange} />
        <label htmlFor='password'>Password:</label>
        <input id='password' className='sign-in-form' name='password' type='password' value={password} onChange={handleChange} />
        <input className='sign-in-form' type='submit' value='Submit' />
      </form>
      <div><Link to='/forgot-password'>Forgot your password?</Link></div>
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
