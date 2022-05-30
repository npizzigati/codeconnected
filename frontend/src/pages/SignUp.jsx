'use strict';

import React, { useState } from 'react';

function SignUp () {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  return (
    <>
      <form onSubmit={handleSubmit}>
        <label htmlFor='username'>Username:</label>
        <input id='username' className='sign-up-form' name='username' type='text' value={username} onChange={handleChange} />
        <label htmlFor='email'>Email:</label>
        <input id='email' name='email' className='sign-up-form' type='text' value={email} onChange={handleChange} />
        <label htmlFor='password'>Password:</label>
        <input id='password' className='sign-up-form' name='password' type='password' value={password} onChange={handleChange} />
        <input className='sign-up-form' type='submit' value='Submit' />
      </form>
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
    }
  }

  function handleSubmit (ev) {
    ev.preventDefault();
    const body = JSON.stringify({ username, email, plainTextPW: password });
    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: body
    };

    fetch('/api/signup', options)
      .then(response => {
        console.log(response);
      });
  }
}

export { SignUp as default };
