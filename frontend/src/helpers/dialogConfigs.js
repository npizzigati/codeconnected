'use strict';

const backToHomeDialogConfig = {
  message: {
    icon: { path: './images/attention.png', alt: 'Attention' },
    text: 'Do you really want to exit this session?'
  },
  options: [
    {
      number: 1,
      icon: { path: './images/run.png', alt: 'Login' },
      text: 'Yes, take me back to the home page.',
      callback: () => {
        // Don't use React's navigate here because the user
        // won't be removed from room participants
        window.location = window.location.origin;
      }
    },
    {
      number: 2,
      icon: { path: './images/stop.png', alt: 'Time-limited' },
      text: 'No, I want to stay here.',
      callback: abortBackToHome
    }
  ],
  abortCallback: abortBackToHome,
  theme: 'dark'
};

const roomClosedDialogConfig = {
  message: {
    icon: { path: './images/attention.png', alt: 'Attention' },
    text: 'This session was closed or could not be opened.'
  },
  options: [
    {
      number: 1,
      icon: { path: './images/run.png', alt: 'Login' },
      text: 'Take me back to the home page.',
      callback: () => {
        window.location = window.location.origin;
      }
    }
  ],
  theme: 'dark'
};

export { backToHomeDialogConfig, roomClosedDialogConfig };
