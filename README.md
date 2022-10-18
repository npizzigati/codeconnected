![](https://user-images.githubusercontent.com/54257961/195213021-b774d384-d18e-43a2-8dd6-36a2189eb67c.png)

> A collaborative code editor, runner and REPL you can install on your own hardware

Try it out at [codeconnected.dev](https://codeconnected.dev).

Codeconnected is a collaborative web platform designed for:

- Coding schools and their students looking to practice coding problems online collaboratively.
- Organizations seeking an online whiteboard interviewing tool they can customize.
- Developers looking for a quick online sandbox to try out ideas.

Largely written in Go, it is designed to be fast and to work on very modest hardware.

## Languages

Users can code in Ruby, JavaScript (Node.js) and PostgreSQL.

More languages are planned for the future.

## Real-time collaboration

The collaborative editor uses [Yjs](https://github.com/yjs/yjs) to sync user changes in real time. Changes are relayed between the users through a built-in WebSocket server.

## Code is run in a REPL

Code execution happens in a REPL, which means that users have access to top-level functions and classes after each code run. This can be very useful for debugging. [See it in action](https://youtu.be/VM8BqIv8mUw).

## Modular architecture

The back-end runs on one server and user-submitted code runs on another. This:

- ensures the main application will run smoothly regardless of the load on the REPL server caused by user-submitted code.
- provides an extra layer of security, since user-submitted code runs in a physically separate environment.
- lets you scale up seamlessly to meet demand, simply by provisioning more resources to the REPL server or moving it to a better-specced home. A single environment variable tells the main application where it is.

## Hardened containers

In addition to the security-minded separation of servers, each Docker container where user code runs is hardened using [gVisor](https://gvisor.dev), a resource-efficient isolation layer.

## Modest server requirements

- Fast Go back-end.
- One Docker container is created per session, allowing users to quickly switch between languages in the coding environment without creating the overhead of multiple containers.
- User coding sessions are saved as text files instead of stopped Docker containers, saving storage space.

## Built-in authentication

Sign-in and sign-up functionality is provided, using Amazon SES for email verification. If needed, another email service can easily be swapped in.
