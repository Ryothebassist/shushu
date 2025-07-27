// register.js
import fetch from 'node-fetch';
import config from './config.js';

// Define metadata fields for specific roles
const body = [
  {
    key: 'shu',
    name: 'uwu',
    description: 'hihi',
    type: 1, // string type to support comma-separated user IDs
  },
];

const url = `https://discord.com/api/v10/applications/${config.DISCORD_CLIENT_ID}/role-connections/metadata`;

const response = await fetch(url, {
  method: 'PUT',
  body: JSON.stringify(body),
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bot ${config.DISCORD_TOKEN}`,
  },
});
if (response.ok) {
  const data = await response.json();
  console.log(data);
} else {
  const data = await response.text();
  console.log(data);
}
