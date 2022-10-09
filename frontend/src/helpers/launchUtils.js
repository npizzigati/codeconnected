'use strict';

async function requestRoom (language, codeSessionID = -1, initialContent = '') {
  console.log(`Starting ${language} room`);

  const body = JSON.stringify({ language, codeSessionID, initialContent });
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
    const response = await fetch('/api/create-room', options);
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

export { requestRoom };
