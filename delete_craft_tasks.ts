/**
 * Script to delete all tasks from Craft
 * WARNING: This is a destructive operation that cannot be undone!
 */

import { CraftIntegration } from './src/craft';
import { getConfig } from './src/config';
import * as readline from 'readline';

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

async function deleteCraftTasks() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          DELETE ALL CRAFT TASKS                            ║');
  console.log('║          ⚠️  WARNING: DESTRUCTIVE OPERATION ⚠️             ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Initialize Craft client
  const config = getConfig();
  const craft = new CraftIntegration(config.craftApiBaseUrl, 100);

  // Fetch all tasks from task scopes
  console.log('Fetching all tasks from Craft task scopes...\n');
  const scopeTasks = await craft.getAllTasks(['active', 'upcoming', 'inbox', 'logbook']);
  console.log(`✓ Found ${scopeTasks.length} tasks from task scopes\n`);

  // Fetch tasks from all folders/documents
  console.log('Fetching all tasks from folders and documents...\n');
  const folderDocumentMap = await craft.buildFolderDocumentMap(true);
  const folderDocumentIds = Array.from(folderDocumentMap.keys());
  console.log(`✓ Found ${folderDocumentIds.length} documents in folders\n`);
  
  // Fetch documents from unsorted location
  console.log('Fetching documents from unsorted location...\n');
  const unsortedDocumentIds = await craft.getUnsortedDocuments();
  console.log(`✓ Found ${unsortedDocumentIds.length} documents in unsorted\n`);
  
  // Combine all document IDs
  const allDocumentIds = [...folderDocumentIds, ...unsortedDocumentIds];
  
  const documentTasks = await craft.scanAdditionalDocuments(allDocumentIds, folderDocumentMap);
  console.log(`✓ Found ${documentTasks.length} tasks from all documents\n`);

  // Merge and deduplicate tasks by ID
  const taskMap = new Map<string, any>();
  for (const task of [...scopeTasks, ...documentTasks]) {
    taskMap.set(task.id, task);
  }
  const allTasks = Array.from(taskMap.values());

  if (allTasks.length === 0) {
    console.log('✓ No tasks found in Craft.');
    rl.close();
    return;
  }

  console.log(`\nFound ${allTasks.length} tasks in Craft.\n`);

  // Show sample tasks
  console.log('Sample tasks:');
  const sampleTasks = allTasks.slice(0, 5);
  for (const task of sampleTasks) {
    console.log(`  - ${task.markdown} (${task.id})`);
  }
  if (allTasks.length > 5) {
    console.log(`  ... and ${allTasks.length - 5} more tasks\n`);
  }

  // Ask for confirmation
  const answer = await askQuestion(
    `\n⚠️  Are you sure you want to delete ALL ${allTasks.length} tasks? (y/n): `
  );

  if (answer.trim().toLowerCase() !== 'y') {
    console.log('\n✗ Deletion cancelled.');
    rl.close();
    return;
  }

  // Delete all tasks
  console.log('\n🗑️  Starting deletion process...\n');
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < allTasks.length; i++) {
    const task = allTasks[i];
    const progress = `[${i + 1}/${allTasks.length}]`;
    
    process.stdout.write(`${progress} Deleting: ${task.markdown.substring(0, 50)}... `);
    
    const success = await craft.deleteTask(task.id);
    
    if (success) {
      successCount++;
      console.log('✓');
    } else {
      failCount++;
      console.log('✗');
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Summary
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                    DELETION SUMMARY                        ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\n  Total tasks:     ${allTasks.length}`);
  console.log(`  ✓ Deleted:       ${successCount}`);
  console.log(`  ✗ Failed:        ${failCount}\n`);

  rl.close();
}

// Run the script
deleteCraftTasks()
  .then(() => {
    console.log('Done.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    rl.close();
    process.exit(1);
  });
