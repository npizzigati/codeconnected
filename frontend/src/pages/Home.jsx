'use strict';

import React, { useState } from 'react';

import { useNavigate } from 'react-router-dom';

const defaultLanguage = 'javascript';

function Home () {
  const [language, setLanguage] = useState(defaultLanguage);
  const navigate = useNavigate();

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

  async function handleSubmit (ev) {
    ev.preventDefault();
    const roomID = await requestRoom();
    if (roomID === null) {
      // TODO: Handle this problem / try again
    }
    console.log('RoomID: ' + roomID);
    navigate(`/${language}/${roomID}`);
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
    try {
      const response = await fetch('/api/createroom', options);
      const roomID = await response.text();
      return roomID;
    } catch (error) {
      console.error('Error fetching room ID:', error);
      return null;
    }
  }
}

export { Home as default };
