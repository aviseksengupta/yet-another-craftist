/**
 * Mapping System V2 - CLI Tool
 * Generate project-to-document/folder mappings
 */

import { CraftIntegration } from '../craft';
import { TodoistIntegration } from '../todoist';
import { getConfig } from '../config';
import { DocProjectMapper } from './index';

async function main() {
  console.log('📝 Generating mapping configuration...\n');

  const config = getConfig();
  const craft = new CraftIntegration(config.craftApiBaseUrl);
  const todoist = new TodoistIntegration(config.todoistToken);
  const mapper = new DocProjectMapper(craft, todoist, './doc-project-mapper.json');

  try {
    await mapper.createConfig();
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
