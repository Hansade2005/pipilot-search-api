#!/usr/bin/env node
/**
 * PiPilot Search API - Key Management Script
 *
 * Usage:
 *   node scripts/manage-keys.js create <name> [tier]
 *   node scripts/manage-keys.js list
 *   node scripts/manage-keys.js revoke <key>
 *   node scripts/manage-keys.js info <key>
 *
 * Examples:
 *   node scripts/manage-keys.js create "My App" free
 *   node scripts/manage-keys.js list
 *   node scripts/manage-keys.js revoke pk_test_abc123
 */

const { execSync } = require('child_process');
const crypto = require('crypto');

const BINDING = 'API_KEYS';

// Generate a secure random API key
function generateApiKey(tier = 'free') {
  const prefix = tier === 'free' ? 'pk_test_' : 'pk_live_';
  const randomBytes = crypto.randomBytes(16).toString('hex');
  return prefix + randomBytes;
}

// Create a new API key
function createKey(name, tier = 'free') {
  const apiKey = generateApiKey(tier);
  const keyData = {
    name,
    tier,
    createdAt: new Date().toISOString(),
    totalRequests: 0,
    lastUsedAt: null,
    revoked: false,
    rateLimit: tier === 'free' ? 1000 : tier === 'pro' ? 5000 : 10000
  };

  const jsonData = JSON.stringify(keyData);
  const escapedJson = jsonData.replace(/"/g, '\\"');

  try {
    execSync(
      `npx wrangler kv:key put --binding=${BINDING} "${apiKey}" "${escapedJson}"`,
      { stdio: 'inherit' }
    );

    console.log('\n✅ API Key created successfully!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🔑 API Key: ${apiKey}`);
    console.log(`📝 Name:    ${name}`);
    console.log(`🎯 Tier:    ${tier}`);
    console.log(`⏱️  Limit:   ${keyData.rateLimit} requests/hour`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n💡 Use this key in your requests:');
    console.log(`   curl -H "Authorization: Bearer ${apiKey}" \\`);
    console.log(`        https://pipilot-search-api.hanscadx8.workers.dev/search\n`);

    return apiKey;
  } catch (err) {
    console.error('❌ Failed to create API key:', err.message);
    process.exit(1);
  }
}

// List all API keys
function listKeys() {
  try {
    const output = execSync(
      `npx wrangler kv:key list --binding=${BINDING}`,
      { encoding: 'utf-8' }
    );

    const keys = JSON.parse(output);

    console.log('\n📋 API Keys List\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (keys.length === 0) {
      console.log('No API keys found.');
    } else {
      keys.forEach((key, index) => {
        console.log(`${index + 1}. ${key.name}`);
      });
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`Total: ${keys.length} key(s)\n`);

  } catch (err) {
    console.error('❌ Failed to list keys:', err.message);
    process.exit(1);
  }
}

// Get key info
function getKeyInfo(apiKey) {
  try {
    const output = execSync(
      `npx wrangler kv:key get --binding=${BINDING} "${apiKey}"`,
      { encoding: 'utf-8' }
    );

    const keyData = JSON.parse(output);

    console.log('\n📊 API Key Information\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🔑 Key:      ${apiKey}`);
    console.log(`📝 Name:     ${keyData.name}`);
    console.log(`🎯 Tier:     ${keyData.tier}`);
    console.log(`📈 Requests: ${keyData.totalRequests || 0}`);
    console.log(`⏱️  Limit:    ${keyData.rateLimit || 1000} req/hour`);
    console.log(`🔒 Revoked:  ${keyData.revoked ? 'Yes' : 'No'}`);
    console.log(`📅 Created:  ${keyData.createdAt}`);
    console.log(`🕐 Last use: ${keyData.lastUsedAt || 'Never'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (err) {
    console.error('❌ Key not found or error:', err.message);
    process.exit(1);
  }
}

// Revoke an API key
function revokeKey(apiKey) {
  try {
    // Get existing key data
    const output = execSync(
      `npx wrangler kv:key get --binding=${BINDING} "${apiKey}"`,
      { encoding: 'utf-8' }
    );

    const keyData = JSON.parse(output);
    keyData.revoked = true;
    keyData.revokedAt = new Date().toISOString();

    const jsonData = JSON.stringify(keyData);
    const escapedJson = jsonData.replace(/"/g, '\\"');

    execSync(
      `npx wrangler kv:key put --binding=${BINDING} "${apiKey}" "${escapedJson}"`,
      { stdio: 'inherit' }
    );

    console.log('\n✅ API Key revoked successfully!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🔑 Key:     ${apiKey}`);
    console.log(`📝 Name:    ${keyData.name}`);
    console.log(`🔒 Status:  REVOKED`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (err) {
    console.error('❌ Failed to revoke key:', err.message);
    process.exit(1);
  }
}

// Main CLI
const [,, command, ...args] = process.argv;

switch (command) {
  case 'create':
    const [name, tier = 'free'] = args;
    if (!name) {
      console.error('❌ Usage: node scripts/manage-keys.js create <name> [tier]');
      process.exit(1);
    }
    createKey(name, tier);
    break;

  case 'list':
    listKeys();
    break;

  case 'info':
    const [infoKey] = args;
    if (!infoKey) {
      console.error('❌ Usage: node scripts/manage-keys.js info <key>');
      process.exit(1);
    }
    getKeyInfo(infoKey);
    break;

  case 'revoke':
    const [revokeKeyArg] = args;
    if (!revokeKeyArg) {
      console.error('❌ Usage: node scripts/manage-keys.js revoke <key>');
      process.exit(1);
    }
    revokeKey(revokeKeyArg);
    break;

  default:
    console.log(`
PiPilot Search API - Key Management

Usage:
  node scripts/manage-keys.js create <name> [tier]    Create a new API key
  node scripts/manage-keys.js list                     List all API keys
  node scripts/manage-keys.js info <key>               Show key details
  node scripts/manage-keys.js revoke <key>             Revoke an API key

Examples:
  node scripts/manage-keys.js create "My App" free
  node scripts/manage-keys.js create "Production" pro
  node scripts/manage-keys.js list
  node scripts/manage-keys.js info pk_test_abc123
  node scripts/manage-keys.js revoke pk_test_abc123

Tiers:
  free - 1,000 requests/hour (default)
  pro  - 5,000 requests/hour
  enterprise - 10,000 requests/hour
`);
    process.exit(1);
}
