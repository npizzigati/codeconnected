'use strict';

import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

function ResetPassword () {
  const [password, setPassword] = useState('');
  const [searchParams, _] = useSearchParams();
  const code = searchParams.get('code');
  const navigate = useNavigate();

  return (
    <>
      <form onSubmit={handleSubmit}>
        <label htmlFor='password'>Enter your new password:</label>
        <input id='password' className='reset-password-form' name='password' type='password' value={password} onChange={handleChange} />
        <input className='reset-password-form' type='submit' value='Submit' />
      </form>
    </>
  );

  function handleChange (ev) {
    switch (ev.target.name) {
    case 'password':
      setPassword(ev.target.value);
      break;
    }
  }

  function handleSubmit (ev) {
    ev.preventDefault();
    const body = JSON.stringify({ code, newPlaintextPW: password });
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
        } else {
          console.log('Password could not be changed because: ' + json.reason);
        }
      });
  }
}

export { ResetPassword as default };
