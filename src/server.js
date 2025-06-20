import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';

import config from './config.js';
import * as discord from './discord.js';
import * as storage from './storage.js';

const app = express();

// Middleware to parse JSON bodies (for POST requests)
app.use(express.json());

// Use cookie parser with the configured secret
app.use(cookieParser(config.COOKIE_SECRET));

// Serve static files from the "public" directory (including success.html)
app.use(express.static('public'));

// Health check route
app.get('/', (req, res) => {
  res.send('👋');
});

// Route to initiate the Discord OAuth2 flow
app.get('/linked-role', async (req, res) => {
  const { url, state } = discord.getOAuthUrl();

  // Store the state parameter in a signed cookie to verify it later
  res.cookie('clientState', state, { maxAge: 1000 * 60 * 5, signed: true });

  // Redirect the user to Discord's OAuth2 authorization endpoint
  res.redirect(url);
});

// OAuth2 callback route that Discord redirects to after authorization
app.get('/discord-oauth-callback', async (req, res) => {
  try {
    // Retrieve code and state from query parameters
    const code = req.query['code'];
    const discordState = req.query['state'];

    // Verify the state parameter using the signed cookie
    const { clientState } = req.signedCookies;
    if (clientState !== discordState) {
      console.error('State verification failed.');
      return res.sendStatus(403);
    }

    // Exchange the authorization code for access tokens
    const tokens = await discord.getOAuthTokens(code);

    // Use the access token to fetch user profile data from Discord
    const meData = await discord.getUserData(tokens);
    const userId = meData.user.id;

    // Store tokens (access, refresh, and expiry) in your storage solution
    await storage.storeDiscordTokens(userId, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
    });

    // Push the integer metadata field 'shu' equal to the user ID
    await updateMetadata(userId);

    // Serve the custom success page (success.html) from the public folder
    res.sendFile(path.join(process.cwd(), 'public', 'success.html'));
  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

// Example endpoint to update metadata when external data changes
app.post('/update-metadata', async (req, res) => {
  try {
    const { userId } = req.body;
    await updateMetadata(userId);
    res.sendStatus(204);
  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

// Helper function to update Discord metadata for a given user
async function updateMetadata(userId) {
  // Retrieve stored tokens
  const tokens = await storage.getDiscordTokens(userId);

  // Build metadata: set 'shu' to the user's Discord ID (as an integer)
  const metadata = {
    shu: Number(userId),
  };

  // Push the metadata to Discord
  await discord.pushMetadata(userId, tokens, metadata);
}

// Start the server on the designated port
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Tiệm cafe mèo Yumi's house ${port}`);
});