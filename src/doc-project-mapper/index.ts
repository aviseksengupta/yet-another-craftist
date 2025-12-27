/**
 * Mapping System V2 - Main Facade
 * 
 * Single entry point for all mapping operations:
 * - Initialize new configuration
 * - Resolve Craft→Todoist
 * - Resolve Todoist→Craft
 * - Manage mappings
 * - Import from V1
 */

import { CraftIntegration } from '../craft';
import { TodoistIntegration } from '../todoist';
import {
  MappingConfig,
  CraftResolutionResult,
  TodoistResolutionResult,
  CraftDocument,
} from './types';
import { MappingConfigManager } from './config';
import { MappingResolver } from './resolver';
import { MappingHelper } from './helper';

export class DocProjectMapper {
  private craft: CraftIntegration;
  private todoist: TodoistIntegration;
  private configPath: string;
  private configManager: MappingConfigManager;
  private resolver: MappingResolver;
  private helper: MappingHelper;
  private initialized: boolean = false;

  constructor(
    craft: CraftIntegration,
    todoist: TodoistIntegration,
    configPath: string = './doc-project-mapper.json'
  ) {
    this.craft = craft;
    this.todoist = todoist;
    this.configPath = configPath;
    this.configManager = new MappingConfigManager(configPath);
    this.resolver = new MappingResolver(this.configManager);
    this.helper = new MappingHelper(craft, todoist, this.configManager);
  }

  /**
   * Initialize the mapping system
   * Must be called before using resolve methods
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.log('🚀 Initializing Document-Project Mapper...');

    try {
      this.resolver.initialize();
      this.initialized = true;
      console.log('✅ Document-Project Mapper initialized\n');
    } catch (error) {
      console.error('❌ Failed to initialize Document-Project Mapper:', error);
      throw error;
    }
  }

  /**
   * Create a new configuration file
   * This will find Task Inbox and create an empty config
   */
  async createConfig(): Promise<MappingConfig> {
    console.log('📝 Creating new mapping configuration...\n');
    
    const config = await this.helper.initializeConfig();
    
    // Ensure all Todoist projects are mapped
    const completeConfig = await this.helper.ensureAllTodoistProjectsMapped(config);
    
    this.configManager.save(completeConfig);
    this.helper.printSummary(completeConfig);
    
    console.log(`✅ Configuration saved to: ${this.configPath}\n`);
    
    return completeConfig;
  }

  /**
   * Import configuration from V1 format
   */
  async importFromV1(v1ConfigPath: string): Promise<MappingConfig> {
    const config = await this.helper.importFromV1(v1ConfigPath);
    this.configManager.save(config);
    
    console.log(`✅ V1 configuration imported and saved to: ${this.configPath}\n`);
    
    return config;
  }

  /**
   * Resolve Craft task to Todoist project
   * 
   * Use this when creating a Todoist task from a Craft task
   * 
   * @param craftDocumentId - Document ID containing the task
   * @param craftDocumentPath - Full path of the document (e.g., "Space > Folder > Document")
   * @param craftFolderHierarchy - Optional: Array of folder IDs from root to document
   * @returns Resolution result with Todoist project to use
   */
  resolveCraftToTodoist(
    craftDocumentId: string,
    craftDocumentPath: string,
    craftFolderHierarchy?: string[]
  ): CraftResolutionResult {
    this.ensureInitialized();
    return this.resolver.resolveCraftToTodoist(
      craftDocumentId,
      craftDocumentPath,
      craftFolderHierarchy
    );
  }

  /**
   * Resolve Todoist project to Craft document
   * 
   * Use this when creating a Craft task from a Todoist task
   * 
   * @param todoistProjectId - Todoist project ID
   * @returns Resolution result with Craft document(s) to use
   */
  resolveTodoistToCraft(todoistProjectId: string): TodoistResolutionResult {
    this.ensureInitialized();
    return this.resolver.resolveTodoistToCraft(todoistProjectId);
  }

  /**
   * Get all mappings
   */
  getAllMappings() {
    const config = this.configManager.load();
    return config.projects;
  }

  /**
   * Print configuration summary
   */
  printSummary(): void {
    const config = this.configManager.load();
    this.helper.printSummary(config);
  }

  /**
   * Ensure all Todoist projects have mappings
   * This should be called periodically to keep mappings in sync
   */
  async syncTodoistProjects(): Promise<void> {
    console.log('🔄 Syncing Todoist projects...\n');
    
    let config = this.configManager.load();
    config = await this.helper.ensureAllTodoistProjectsMapped(config);
    this.configManager.save(config);
    
    console.log('✅ Todoist projects synced\n');
  }

  /**
   * Ensure the system is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'Mapping System V2 not initialized. Call initialize() first.'
      );
    }
  }
}

// Export all types for convenience
export * from './types';
export { MappingConfigManager } from './config';
export { MappingResolver } from './resolver';
export { MappingHelper } from './helper';
