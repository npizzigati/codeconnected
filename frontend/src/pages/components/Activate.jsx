'use strict';

import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

function Activate () {
  const [status, setStatus] = useState('in progress');
  const [searchParams, _] = useSearchParams();
  const code = searchParams.get('code');
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const body = JSON.stringify({ code });
      const options = {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json;charset=utf-8' },
        body: body
      };

      try {
        const response = await fetch('/api/activate-user', options);
        const results = await response.json();
        setStatus(results.status);
        if (results.status === 'success') {
          setTimeout(() => {
            navigate('/');
          }, 3000);
        }
      } catch (error) {
        console.error('Error fetching json:', error);
      }
    })();
  }, []);

  return (
    <>
      <p>Registration status: {status}.
        {(status === 'failure') ? ' Your activation request has expired. Please sign up again.' : ''}
        {(status === 'success') ? ' Signing you in now...' : ''}
      </p>
    </>
  );
}

export { Activate as default };
