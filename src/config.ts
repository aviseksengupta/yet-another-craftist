/**
 * Configuration management
 */

import * as dotenv from 'dotenv';
import { Config } from './types';

dotenv.config();

export function getConfig(): Config {
  const config: Config = {
    todoistToken: process.env.TODOIST_TOKEN || '',
    craftApiBaseUrl: process.env.CRAFT_API_BASE_URL || '',
    databasePath: process.env.DATABASE_PATH || './sync_data.db',
    syncInterval: parseInt(process.env.SYNC_INTERVAL || '300', 10),
    conflictWindow: parseInt(process.env.CONFLICT_WINDOW || '3', 10),
  };

  // Validate required settings
  const missing: string[] = [];
  if (!config.todoistToken) missing.push('TODOIST_TOKEN');
  if (!config.craftApiBaseUrl) missing.push('CRAFT_API_BASE_URL');

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please check your .env file.'
    );
  }

  return config;
}

export function displayConfig(config: Config): void {
  console.log('\nConfiguration:');
  console.log(`  Database: ${config.databasePath}`);
  console.log(`  Sync interval: ${config.syncInterval} seconds`);
  console.log(`  Conflict window: ${config.conflictWindow} seconds`);
  console.log(`  Todoist configured: ${!!config.todoistToken}`);
  console.log(`  Craft configured: ${!!config.craftApiBaseUrl}`);
  console.log('');
}
