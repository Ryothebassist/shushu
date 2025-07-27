
const store = new Map();

export async function storeDiscordTokens(userId, tokens) {
  await store.set(`discord-${userId}`, tokens);
}

export async function getDiscordTokens(userId) {
  return store.get(`discord-${userId}`);
}

// Store the list of users in the linked role
export async function storeLinkedUsers(userIds) {
  await store.set('linked-users', userIds);
}

// Get the list of users in the linked role
export async function getLinkedUsers() {
  return store.get('linked-users') || [];
}
