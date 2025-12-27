/**
 * Resolution functions for mapping
 */

import { BuiltConfig, ResolutionResult } from './types';
import * as fs from 'fs';

export class MapResolver {
  private config: BuiltConfig | null = null;

  constructor(private configPath: string) {}

  initialize(): void {
    if (!fs.existsSync(this.configPath)) {
      throw new Error(
        `Built configuration not found: ${this.configPath}\n` +
        'Please run "npm run map:build" first to generate the mapping.'
      );
    }

    this.config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
  }

  /**
   * Resolve Craft task to Todoist project
   * 
   * Algorithm:
   * 1. Check if document D is in documentToProject map
   * 2. If not, traverse folder hierarchy from innermost to outermost
   * 3. Check each folder in folderToProject map
   * 4. Otherwise, return Inbox as default
   */
  resolveTodoistProject(documentId: string, folderHierarchy?: string[]): ResolutionResult {
    if (!this.config) {
      throw new Error('Resolver not initialized. Call initialize() first.');
    }

    console.log(`    [Resolver] Checking document ${documentId.substring(0, 8)} in documentToProject:`, !!this.config.documentToProject[documentId]);

    // Check document mapping first (most specific)
    if (documentId && this.config.documentToProject[documentId]) {
      const projectId = this.config.documentToProject[documentId];
      console.log(`    [Resolver] ✓ Found direct document mapping to project ${projectId}`);
      return {
        found: true,
        projectId,
        isDefault: false,
      };
    }

    // Check folder hierarchy from innermost (closest to document) to outermost
    // folderHierarchy is ordered: [innermost/closest folder, ..., outermost/root folder]
    if (folderHierarchy && folderHierarchy.length > 0) {
      console.log(`    [Resolver] 📂 Checking ${folderHierarchy.length} folders (innermost→outermost):`);
      for (let i = 0; i < folderHierarchy.length; i++) {
        const folderId = folderHierarchy[i];
        const folderName = this.config.metadata?.folders?.[folderId] || 'unknown';
        const depth = i === 0 ? 'innermost' : i === folderHierarchy.length - 1 ? 'outermost' : `level ${i}`;
        console.log(`      [${i}/${depth}] Folder ${folderId.substring(0, 8)} (${folderName})`);
        console.log(`          Exists in folderToProject: ${!!this.config.folderToProject[folderId]}`);
        
        if (this.config.folderToProject[folderId]) {
          const projectId = this.config.folderToProject[folderId];
          const projectName = this.config.metadata?.projects?.[projectId] || 'unknown';
          console.log(`    [Resolver] ✓ MATCH! Folder "${folderName}" (${depth}) -> project ${projectId} (${projectName})`);
          return {
            found: true,
            projectId,
            isDefault: false,
          };
        }
      }
      console.log(`    [Resolver] ❌ No folder in hierarchy matched folderToProject`);
    } else {
      console.log(`    [Resolver] ⚠️  No folder hierarchy provided (empty array or null)`);
    }

    // Default to Inbox
    console.log(`    [Resolver] Falling back to default inbox project`);
    return {
      found: false,
      projectId: this.config.defaults.todoistInboxProjectId,
      projectName: this.config.defaults.todoistInboxProjectName,
      isDefault: true,
    };
  }

  /**
   * Resolve Todoist task to Craft document
   * 
   * Algorithm:
   * 1. Check if project P is in projectToDocument map
   * 2. Otherwise, return Task Inbox as default
   */
  resolveCraftDocument(projectId: string): ResolutionResult {
    if (!this.config) {
      throw new Error('Resolver not initialized. Call initialize() first.');
    }

    // Check project mapping
    if (this.config.projectToDocument[projectId]) {
      const documentId = this.config.projectToDocument[projectId];
      if (documentId === 'nosync') {
        return {
          found: false,
          documentId: undefined,
          isDefault: false,
          nosync: true,
        };
      }
      return {
        found: true,
        documentId,
        isDefault: false,
      };
    }

    // Default to Task Inbox
    return {
      found: false,
      documentId: this.config.defaults.craftTaskInboxDocumentId,
      documentName: this.config.defaults.craftTaskInboxDocumentName,
      isDefault: true,
    };
  }

  getDefaults() {
    if (!this.config) {
      throw new Error('Resolver not initialized. Call initialize() first.');
    }
    return this.config.defaults;
  }
}
