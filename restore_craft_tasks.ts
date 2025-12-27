/**
 * Script to restore deleted Craft tasks from SQLite database
 * Recreates tasks that exist in DB but were deleted from Craft
 */

import { CraftIntegration } from './src/craft';
import { DatabaseManager } from './src/database';
import { getConfig } from './src/config';
import { Task } from './src/types';
import * as readline from 'readline';
import * as fs from 'fs';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function restoreCraftTasks() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          RESTORE DELETED CRAFT TASKS                       ║');
  console.log('║          FROM SQLITE DATABASE                              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Initialize
  const config = getConfig();
  const craft = new CraftIntegration(config.craftApiBaseUrl, 100);
  const db = new DatabaseManager(config.databasePath);

  // Load project-document mapping
  let projectDocumentMap: Map<string, string> = new Map();
  const mappingFile = './doc-project-mapper-v2.json';
  
  if (fs.existsSync(mappingFile)) {
    console.log('Loading project-document mapping...');
    const mappingData = JSON.parse(fs.readFileSync(mappingFile, 'utf-8'));
    
    if (mappingData.projectDocumentMap) {
      projectDocumentMap = new Map(Object.entries(mappingData.projectDocumentMap));
      console.log(`✓ Loaded mapping for ${projectDocumentMap.size} projects\n`);
    }
  } else {
    console.log('⚠️  No project-document mapping found. All restored tasks will go to inbox.\n');
  }

  // Get all tasks from database that have both todoist_id and craft_id
  console.log('Fetching tasks from database...');
  const allDbTasks = db.getAllTasks();
  const syncedTasks = allDbTasks.filter(task => task.todoist_id && task.craft_id);
  console.log(`✓ Found ${syncedTasks.length} synced tasks in database\n`);

  if (syncedTasks.length === 0) {
    console.log('No synced tasks found in database.');
    rl.close();
    return;
  }

  // Check which tasks still exist in Craft
  console.log('Checking which tasks are missing from Craft...');
  const missingTasks: Task[] = [];
  let existingCount = 0;

  for (let i = 0; i < syncedTasks.length; i++) {
    const task = syncedTasks[i];
    const progress = `[${i + 1}/${syncedTasks.length}]`;
    
    process.stdout.write(`\r${progress} Checking: ${task.craft_id?.substring(0, 8)}...`);
    
    try {
      // Try to fetch the task as a block
      const response = await craft['client'].get('/blocks', {
        params: {
          id: task.craft_id,
          fetchMetadata: true,
        },
      });
      
      if (response.data) {
        existingCount++;
      }
    } catch (error: any) {
      // Task doesn't exist (404) or other error
      if (error.response?.status === 404) {
        missingTasks.push(task);
      } else {
        console.log(`\n  ⚠️  Error checking ${task.craft_id}: ${error.message}`);
      }
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log(`\n\n✓ Check complete:`);
  console.log(`  - ${existingCount} tasks exist in Craft`);
  console.log(`  - ${missingTasks.length} tasks are missing\n`);

  if (missingTasks.length === 0) {
    console.log('✓ No missing tasks to restore.');
    rl.close();
    return;
  }

  // Show sample missing tasks
  console.log('Sample missing tasks:');
  const sampleTasks = missingTasks.slice(0, 5);
  for (const task of sampleTasks) {
    const projectInfo = task.project_id ? ` [Project: ${task.project_id}]` : '';
    console.log(`  - ${task.title}${projectInfo}`);
  }
  if (missingTasks.length > 5) {
    console.log(`  ... and ${missingTasks.length - 5} more tasks\n`);
  }

  // Ask for confirmation
  const answer = await askQuestion(
    `\n⚠️  Restore ${missingTasks.length} missing tasks to Craft? (y/n): `
  );

  if (answer.trim().toLowerCase() !== 'y') {
    console.log('\n✗ Restoration cancelled.');
    rl.close();
    return;
  }

  // Restore missing tasks
  console.log('\n🔄 Starting restoration process...\n');
  let successCount = 0;
  let failCount = 0;
  const restoredTasks: Array<{ oldCraftId: string; newCraftId: string; title: string }> = [];

  for (let i = 0; i < missingTasks.length; i++) {
    const task = missingTasks[i];
    const progress = `[${i + 1}/${missingTasks.length}]`;
    
    process.stdout.write(`${progress} Restoring: ${task.title.substring(0, 50)}... `);
    
    try {
      // Determine location based on project mapping
      let location = 'inbox';
      let craftDocumentId: string | undefined;

      if (task.project_id && projectDocumentMap.has(task.project_id)) {
        craftDocumentId = projectDocumentMap.get(task.project_id);
        location = 'document';
      }

      // Create task in Craft
      const createdTask = await craft.createTask(
        task,
        location,
        craftDocumentId
      );

      // Update database with new craft_id
      db.updateTask(task.todoist_id!, { craft_id: createdTask.id });

      successCount++;
      restoredTasks.push({
        oldCraftId: task.craft_id!,
        newCraftId: createdTask.id,
        title: task.title,
      });
      console.log('✓');
    } catch (error: any) {
      failCount++;
      console.log(`✗ (${error.message})`);
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  // Summary
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                  RESTORATION SUMMARY                       ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\n  Total missing:   ${missingTasks.length}`);
  console.log(`  ✓ Restored:      ${successCount}`);
  console.log(`  ✗ Failed:        ${failCount}\n`);

  if (restoredTasks.length > 0) {
    console.log('Restored tasks (first 10):');
    for (const task of restoredTasks.slice(0, 10)) {
      console.log(`  ✓ ${task.title}`);
      console.log(`    Old ID: ${task.oldCraftId.substring(0, 8)}... → New ID: ${task.newCraftId.substring(0, 8)}...`);
    }
    if (restoredTasks.length > 10) {
      console.log(`  ... and ${restoredTasks.length - 10} more`);
    }
  }

  console.log('\n💡 Tip: Run a sync to ensure everything is up to date.\n');

  rl.close();
}

// Run the script
restoreCraftTasks()
  .then(() => {
    console.log('Done.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    rl.close();
    process.exit(1);
  });
