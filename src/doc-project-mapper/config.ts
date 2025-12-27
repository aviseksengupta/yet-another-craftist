/**
 * Mapping Configuration Manager V2
 * 
 * Manages the sparse mapping configuration:
 * - Loads and validates configuration
 * - Provides CRUD operations for mappings
 * - Ensures at least one primary document per Todoist project
 */

import * as fs from 'fs';
import * as path from 'path';
import { MappingConfig } from './types';

export class MappingConfigManager {
  private configPath: string;
  private config: MappingConfig | null = null;

  constructor(configPath: string = './mapping-v2.json') {
    this.configPath = configPath;
  }

  /**
   * Load the mapping configuration from file
   */
  load(): MappingConfig {
    if (this.config) {
      return this.config;
    }

    if (!fs.existsSync(this.configPath)) {
      throw new Error(
        `Mapping configuration not found at: ${this.configPath}\n` +
        `Please create the configuration file first.`
      );
    }

    const data = fs.readFileSync(this.configPath, 'utf-8');
    this.config = JSON.parse(data) as MappingConfig;
    
    this.validate(this.config);
    return this.config;
  }

  /**
   * Save the mapping configuration to file
   */
  save(config: MappingConfig): void {
    this.validate(config);
    
    config.lastUpdated = new Date().toISOString();
    
    fs.writeFileSync(
      this.configPath,
      JSON.stringify(config, null, 2),
      'utf-8'
    );
    
    this.config = config;
  }

  /**
   * Validate the configuration structure
   */
  private validate(config: MappingConfig): void {
    // Check required fields
    if (!config.version) {
      throw new Error('Configuration missing version field');
    }
    
    if (!config.taskInbox || !config.taskInbox.documentId) {
      throw new Error('Configuration missing Task Inbox document ID');
    }
    
    if (!Array.isArray(config.projects)) {
      throw new Error('Configuration missing projects array');
    }
    
    // Validate each project has at least one document and exactly one primary
    for (const project of config.projects) {
      if (!project.craftDocuments || project.craftDocuments.length === 0) {
        throw new Error(
          `Todoist project ${project.todoistProjectName} has no Craft documents. ` +
          `Each project must have at least one document.`
        );
      }
      
      const primaryCount = project.craftDocuments.filter(d => d.isPrimary).length;
      if (primaryCount !== 1) {
        throw new Error(
          `Todoist project ${project.todoistProjectName} must have exactly one primary document.`
        );
      }
    }
  }

  /**
   * Create a new empty configuration with Task Inbox
   */
  createEmpty(taskInboxId: string, taskInboxName: string, taskInboxPath: string): MappingConfig {
    return {
      version: '2.0',
      lastUpdated: new Date().toISOString(),
      taskInbox: {
        documentId: taskInboxId,
        documentName: taskInboxName,
        documentPath: taskInboxPath,
      },
      projects: [],
    };
  }



  /**
   * Get Task Inbox configuration
   */
  getTaskInbox(config: MappingConfig): { documentId: string; documentName: string; documentPath: string } {
    return config.taskInbox;
  }
}
