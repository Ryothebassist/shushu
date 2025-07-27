import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import fetch from 'node-fetch';

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

// Ping route for keep-alive
app.get('/ping', (req, res) => {
  res.send('pong');
});

// Self-ping function to keep the instance alive
async function keepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 10000}`;
  try {
    const response = await fetch(`${url}/ping`);
    console.log(`[${new Date().toISOString()}] Keep-alive ping: ${response.status}`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Keep-alive ping failed:`, error.message);
  }
}

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

    // Add the user to the linked role
    await addUserToLinkedRole(userId);

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

// New endpoint to add a user to the linked role
app.post('/add-user', async (req, res) => {
  try {
    const { userId } = req.body;
    await addUserToLinkedRole(userId);
    res.json({ success: true, message: 'User added to linked role' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// New endpoint to remove a user from the linked role
app.post('/remove-user', async (req, res) => {
  try {
    const { userId } = req.body;
    await removeUserFromLinkedRole(userId);
    res.json({ success: true, message: 'User removed from linked role' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// New endpoint to get all users in the linked role
app.get('/linked-users', async (req, res) => {
  try {
    const users = await getLinkedUsers();
    res.json({ users });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// New endpoint to set linked users directly with flexible format
app.post('/set-linked-users', async (req, res) => {
  try {
    const { userIds } = req.body;
    
    if (!userIds) {
      return res.status(400).json({ success: false, error: 'userIds is required' });
    }
    
    let users;
    
    // Handle different input formats
    if (typeof userIds === 'string') {
      // Check if it contains commas, spaces, or other separators
      if (userIds.includes(',')) {
        // Comma-separated format
        users = userIds.split(',').map(id => id.trim()).filter(id => id.length > 0);
      } else if (userIds.includes(' ')) {
        // Space-separated format
        users = userIds.split(' ').map(id => id.trim()).filter(id => id.length > 0);
      } else {
        // Single user ID
        users = [userIds.trim()];
      }
    } else if (Array.isArray(userIds)) {
      // Array format
      users = userIds.map(id => String(id).trim()).filter(id => id.length > 0);
    } else {
      // Single user ID as number or other type
      users = [String(userIds).trim()];
    }
    
    // Validate that all user IDs are valid Discord IDs (18-19 digits)
    const validUsers = users.filter(id => /^\d{17,19}$/.test(id));
    
    if (validUsers.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid Discord user IDs found' });
    }
    
    await storage.storeLinkedUsers(validUsers);
    await updateLinkedRoleMetadata(validUsers);
    
    res.json({ success: true, message: 'Linked users updated', users: validUsers });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: e.message });
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

// Helper function to add a user to the linked role
async function addUserToLinkedRole(userId) {
  const linkedUsers = await getLinkedUsers();
  
  // Check if user is already in the list
  if (!linkedUsers.includes(userId)) {
    linkedUsers.push(userId);
    await storage.storeLinkedUsers(linkedUsers);
    
    // Update metadata for all users in the linked role
    await updateLinkedRoleMetadata(linkedUsers);
  }
}

// Helper function to remove a user from the linked role
async function removeUserFromLinkedRole(userId) {
  const linkedUsers = await getLinkedUsers();
  
  // Remove user from the list
  const updatedUsers = linkedUsers.filter(id => id !== userId);
  await storage.storeLinkedUsers(updatedUsers);
  
  // Update metadata for all remaining users
  await updateLinkedRoleMetadata(updatedUsers);
}

// Helper function to get all users in the linked role
async function getLinkedUsers() {
  const users = await storage.getLinkedUsers();
  return users || [];
}

// Helper function to update metadata for all users in the linked role
async function updateLinkedRoleMetadata(userIds) {
  const userIdsString = userIds.join(', ');
  
  for (const userId of userIds) {
    try {
      const tokens = await storage.getDiscordTokens(userId);
      if (tokens) {
        const metadata = {
          shu: userIdsString, // Store comma-separated list of user IDs
        };
        await discord.pushMetadata(userId, tokens, metadata);
      }
    } catch (error) {
      console.error(`Failed to update metadata for user ${userId}:`, error);
    }
  }
}

// Start the server on the designated port
const port = process.env.PORT || 10000;
app.listen(port, '0.0.0.0', (err) => {
  if (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
  console.log(`Tiệm cafe mèo Yumi's house listening at http://0.0.0.0:${port}`);
  
  // Start the keep-alive pings if we're on Render
  if (process.env.RENDER_EXTERNAL_URL) {
    setInterval(keepAlive, 5000); // Ping every 5 seconds
    console.log('Keep-alive pinger started');
  }
});
