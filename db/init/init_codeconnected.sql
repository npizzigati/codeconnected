CREATE DATABASE codeconnected;

\c codeconnected;

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  email VARCHAR(50) NOT NULL,
  encrypted_pw VARCHAR(100) NOT NULL
);

CREATE TABLE pending_activations (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  email VARCHAR(50) NOT NULL,
  encrypted_pw VARCHAR(100) NOT NULL,
  activation_code VARCHAR(100) NOT NULL,
  expiry BIGINT NOT NULL,
  code_resends INT NOT NULL,
  code_attempts INT NOT NULL
);

CREATE TABLE password_reset_requests (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  reset_code VARCHAR(100) NOT NULL,
  expiry BIGINT NOT NULL,
  code_attempts INT NOT NULL
);

CREATE TABLE coding_sessions (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  lang VARCHAR(20) NOT NULL,
  editor_contents TEXT,
  when_created BIGINT NOT NULL,
  when_accessed BIGINT NOT NULL
);
