'use strict';

import React, { useState, useEffect } from 'react';

import { useNavigate, Link } from 'react-router-dom';

const defaultLanguage = 'javascript';

function Home () {
  const [language, setLanguage] = useState(defaultLanguage);
  const [auth, setAuth] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    console.log('Checking user authentication');
    (async () => {
      const serverAuth = await isAuth();
      setAuth(serverAuth);
      console.log('auth in useEffect: ' + serverAuth);
    })();
  });

  if (auth) {
    return (
      <>
        <form onSubmit={handleSubmit}>
          <label>
            Choose the language for your coding session:
            <select
              value={language}
              onChange={ev => setLanguage(ev.target.value)}
            >
              <option value='javascript'>Javascript(Node)</option>
              <option value='ruby'>Ruby</option>
              <option value='sql'>PostgreSQL</option>
            </select>
          </label>
          <input type='submit' value='Start Session' />
        </form>
      </>
    );
  } else {
    return (
      <>
        <div><Link to='/sign-up'>Sign up</Link></div>
        <div><Link to='/sign-in'>Sign in</Link></div>
      </>
    );
  }

  async function isAuth () {
    const options = {
      method: 'GET',
      mode: 'cors'
    };

    try {
      const response = await fetch('/api/check-auth', options);
      const json = await response.json();
      return json.auth;
    } catch (error) {
      console.log('Error fetching auth status: ' + error);
      return false;
    }
  }

  async function handleSubmit (ev) {
    ev.preventDefault();
    const roomID = await requestRoom();
    if (roomID === null) {
      console.log('Could not create room');
      // TODO: Handle this problem / try again
      return;
    }
    console.log('RoomID: ' + roomID);
    navigate(`/${roomID}`);
  }

  async function requestRoom () {
    console.log(`Starting ${language} room`);

    const body = JSON.stringify({ language });
    const options = {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: body
    };

    // TODO: Check if successful (status code 201) before processing
    // (If room is not created successfully, console.log spits
    // out the error from go, but we don't handle the error (we
    // just display our fake prompt and pretend everything went ok))
    try {
      const response = await fetch('/api/createroom', options);
      const json = await response.json();
      console.log(JSON.stringify(json));
      const roomID = json.roomID;
      if (roomID === undefined) {
        console.error('Error fetching room ID');
        return null;
      }
      return roomID;
    } catch (error) {
      console.error('Error fetching room ID:', error);
      return null;
    }
  }
}

export { Home as default };
