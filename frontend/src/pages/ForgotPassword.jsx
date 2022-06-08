'use strict';

import React, { useState } from 'react';

function ForgotPassword () {
  const [email, setEmail] = useState('');

  return (
    <>
      <form onSubmit={handleSubmit}>
        <label htmlFor='email'>Email:</label>
        <input id='email' name='email' className='sign-up-form' type='text' value={email} onChange={handleChange} />
        <input className='forgot-password-form' type='submit' value='Submit' />
      </form>
    </>
  );

  function handleChange (ev) {
    switch (ev.target.name) {
    case 'email':
      setEmail(ev.target.value);
      break;
    }
  }

  function handleSubmit (ev) {
    // TODO: Validate fields
    ev.preventDefault();
    // Send the baseURL so that the password reset link can have the
    // proper address so we can, e.g., test on localhost
    const portString = (window.location.port === '') ? '' : `:${window.location.port}`;
    const baseURL = window.location.protocol + '//' + window.location.hostname + portString;
    console.log('baseURL: ' + baseURL);
    const body = JSON.stringify({ baseURL, email });
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
        } else {
          console.log('email address not found and reset email not sent');
        }
      });
  }
}

export { ForgotPassword as default };
