![](https://user-images.githubusercontent.com/54257961/195213021-b774d384-d18e-43a2-8dd6-36a2189eb67c.png)

> A collaborative code editor, runner and REPL you can install on your own hardware

Try it out at [codeconnected.dev](https://codeconnected.dev).

Codeconnected is a collaborative web platform designed for:

- Coding schools and their students looking to practice coding problems online collaboratively.

- Organizations seeking an online whiteboard interviewing tool they can customize.

- Developers looking for a quick online sandbox to try out ideas.

Largely written in Go, it is designed to be fast and to work on very modest hardware.

## Modular architecture

Codeconnected consists of a front-end interface written in JS/React, a back-end main application server written in Go, and a separate code runner/REPL server where each REPL instance is a separate Docker container.

The separation of the main server from the REPL server ensures the main application will always run smoothly regardless of the load on the REPL server caused by user-generated code. It also provides an extra layer of security, since in the unlikely event that malicious user code breaches a Docker container sandbox, this breach will stop at the hard limit of the physical server and have no access to the main application or user data.

## Speaking of security

In addition to this security-minded separation of servers, each Docker container where user code runs is hardened using [gVisor](https://gvisor.dev), a resource-efficient isolation layer.

## Keeping server requirements modest

User coding sessions are saved as text files instead of as stopped Docker containers, making it possible for us to save as many sessions as we'd like with negligible resource impact.

## Real-time collaboration

The collaborative editor uses [Yjs](https://github.com/yjs/yjs) to sync user changes in real time. Changes are relayed between the users through a built-in WebSocket server.

## Built-in authentication

Sign-in and sign-up functionality is provided, leveraging Amazon SES for email verification. If needed, another email service can easily be swapped in.
