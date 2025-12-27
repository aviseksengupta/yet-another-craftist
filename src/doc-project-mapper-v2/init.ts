/**
 * Initialize manual configuration template
 */

import { CraftIntegration } from '../craft';
import { TodoistIntegration } from '../todoist';
import { ManualConfig } from './types';
import * as fs from 'fs';

export class ConfigInitializer {
  constructor(
    private craft: CraftIntegration,
    private todoist: TodoistIntegration
  ) {}

  async initialize(outputPath: string): Promise<ManualConfig> {
    console.log('🚀 Initializing manual configuration template...\n');

    // Read existing config if it exists
    let existingConfig: ManualConfig | null = null;
    if (fs.existsSync(outputPath)) {
      try {
        const fileContent = fs.readFileSync(outputPath, 'utf-8');
        existingConfig = JSON.parse(fileContent);
        console.log('📂 Found existing configuration, merging with new data...\n');
      } catch (error) {
        console.warn('⚠️  Could not read existing config, creating new one\n');
      }
    }

    // Fetch Todoist projects
    console.log('Fetching Todoist projects...');
    const todoistProjects = await this.todoist.getAllProjects();
    console.log(`  Found ${todoistProjects.length} projects\n`);

    // Fetch Craft folders
    console.log('Fetching Craft folders...');
    const craftFolders = await this.fetchCraftFolders();
    console.log(`  Found ${craftFolders.length} folders\n`);

    // Build manual config template (start with existing or empty)
    const config: ManualConfig = {
      todoistProjects: existingConfig?.todoistProjects || {},
      craftFolders: existingConfig?.craftFolders || {},
      craftDocuments: existingConfig?.craftDocuments || {},
    };

    // Add new Todoist projects (only if not already present)
    let newProjectCount = 0;
    for (const project of todoistProjects) {
      if (!(project.name in config.todoistProjects)) {
        config.todoistProjects[project.name] = null;
        newProjectCount++;
      }
    }
    if (newProjectCount > 0) {
      console.log(`  ✓ Added ${newProjectCount} new Todoist projects`);
    }

    // Add new Craft folders (only if not already present)
    let newFolderCount = 0;
    for (const folder of craftFolders) {
      if (!(folder in config.craftFolders)) {
        config.craftFolders[folder] = null;
        newFolderCount++;
      }
    }
    if (newFolderCount > 0) {
      console.log(`  ✓ Added ${newFolderCount} new Craft folders`);
    }

    if (existingConfig && newProjectCount === 0 && newFolderCount === 0) {
      console.log('  ℹ️  No new projects or folders found\n');
    } else {
      console.log();
    }

    // Save to file
    fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
    console.log(`✅ Manual configuration template saved to: ${outputPath}\n`);
    console.log('📝 Next steps:');
    console.log('   1. Edit the file to map Todoist projects to Craft documents');
    console.log('   2. Map Craft folders to Todoist projects');
    console.log('   3. Run "npm run map:build" to generate the final mapping\n');

    return config;
  }

  private async fetchCraftFolders(): Promise<string[]> {
    const folders: string[] = [];

    try {
      const response = await (this.craft as any).client.get('/folders');
      const items = response.data.items || [];

      const extractFolders = (folderList: any[], parentPath: string = '') => {
        for (const folder of folderList) {
          // Skip system folders
          if (['unsorted', 'daily_notes', 'trash', 'templates'].includes(folder.id)) {
            continue;
          }

          const folderPath = parentPath ? `${parentPath} > ${folder.name}` : folder.name;
          folders.push(folderPath);

          // Recursively extract subfolders
          if (folder.folders && folder.folders.length > 0) {
            extractFolders(folder.folders, folderPath);
          }
        }
      };

      extractFolders(items);
    } catch (error) {
      console.error('Error fetching folders:', error);
    }

    return folders;
  }
}
