CREATE DATABASE codeconnected;

\c codeconnected;

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  email VARCHAR(50) NOT NULL,
  encrypted_pw VARCHAR(100) NOT NULL
);

