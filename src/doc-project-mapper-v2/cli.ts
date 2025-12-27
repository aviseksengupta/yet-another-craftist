/**
 * CLI for Doc-Project Mapper V2
 */

import * as dotenv from 'dotenv';
import { CraftIntegration } from '../craft';
import { TodoistIntegration } from '../todoist';
import { ConfigInitializer } from './init';
import { ConfigBuilder } from './builder';

dotenv.config();

const MANUAL_CONFIG_PATH = './doc-project-mapping-manual.json';
const BUILT_CONFIG_PATH = './doc-project-mapper-v2.json';

async function main() {
  const command = process.argv[2];

  if (!command || !['init', 'build'].includes(command)) {
    console.log('Usage:');
    console.log('  npm run map:init   - Initialize manual configuration template');
    console.log('  npm run map:build  - Build final mapping from manual configuration');
    process.exit(1);
  }

  try {
    const craftApiBaseUrl = process.env.CRAFT_API_BASE_URL || '';
    const todoistToken = process.env.TODOIST_TOKEN || '';

    if (!craftApiBaseUrl || !todoistToken) {
      throw new Error('Missing CRAFT_API_BASE_URL or TODOIST_TOKEN environment variables');
    }

    const craft = new CraftIntegration(craftApiBaseUrl);
    const todoist = new TodoistIntegration(todoistToken);

    if (command === 'init') {
      const initializer = new ConfigInitializer(craft, todoist);
      await initializer.initialize(MANUAL_CONFIG_PATH);
    } else if (command === 'build') {
      const builder = new ConfigBuilder(craft, todoist);
      await builder.build(MANUAL_CONFIG_PATH, BUILT_CONFIG_PATH);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
