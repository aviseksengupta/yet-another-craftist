/**
 * Synchronization engine
 */

import { Task, SyncStatus, SyncOperations } from './types';
import { CONSTANTS } from './constants';
import { DatabaseManager } from './database';
import { TodoistIntegration } from './todoist';
import { CraftIntegration } from './craft';
import { TaskModel } from './models';
import { MapResolver } from './doc-project-mapper-v2';
import * as fs from 'fs';

export class SyncEngine {
  private mapper: MapResolver;
  private folderDocumentMap: Map<string, string[]> = new Map();

  constructor(
    private db: DatabaseManager,
    private todoist: TodoistIntegration,
    private craft: CraftIntegration,
    private conflictWindow: number = 3
  ) {
    // Verify mapping file exists
    if (!fs.existsSync('./doc-project-mapper-v2.json')) {
      throw new Error(
        'Mapping configuration not found: doc-project-mapper-v2.json\n' +
        'Please run "npm run map:build" first to generate the mapping configuration.'
      );
    }
    
    this.mapper = new MapResolver('./doc-project-mapper-v2.json');
    this.mapper.initialize();
  }

  /**
   * Initialize the sync engine (must be called before fullSync)
   */
  async initialize(): Promise<void> {
    await this.mapper.initialize();
  }

  /**
   * Perform a complete bidirectional synchronization
   */
  async fullSync(): Promise<void> {
    console.log('='.repeat(60));
    console.log('Starting full sync cycle');
    console.log('='.repeat(60));

    this.db.logSyncOperation({
      operation: 'sync_start',
      source: 'system',
      entityType: 'sync',
      status: 'success',
    });

    try {
      // Step 1: Build folder-document map from Craft
      console.log('\n[Step 1/6] Building folder-document map...');
      this.folderDocumentMap = await this.craft.buildFolderDocumentMap();
      
      // Step 2: Fetch data from both systems
      console.log('\n[Step 2/6] Fetching data from Todoist and Craft...');
      const { todoistTasks, projectHierarchy } = await this.fetchTodoistData();
      const craftTasks = await this.fetchCraftData();

      // Step 3: Sync projects/documents structure
      console.log('\n[Step 3/6] Syncing project hierarchy...');
      await this.syncProjects(projectHierarchy);

      // Step 4: Match and merge tasks
      console.log('\n[Step 4/6] Matching and merging tasks...');
      const mergedTasks = this.mergeTasks(todoistTasks, craftTasks);

      // Step 5: Determine sync operations
      console.log('\n[Step 5/6] Determining sync operations...');
      const operations = this.determineSyncOperations(mergedTasks);

      // Step 6: Execute sync operations
      console.log('\n[Step 6/6] Executing sync operations...');
      await this.executeSyncOperations(operations);

      console.log('\n' + '='.repeat(60));
      console.log('Sync cycle completed successfully');
      console.log('='.repeat(60));

      this.db.logSyncOperation({
        operation: 'sync_end',
        source: 'system',
        entityType: 'sync',
        status: 'success',
      });
    } catch (error) {
      console.error('Sync failed with error:', error);
      this.db.logSyncOperation({
        operation: 'sync_end',
        source: 'system',
        entityType: 'sync',
        status: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async fetchTodoistData(): Promise<{
    todoistTasks: Task[];
    projectHierarchy: Awaited<ReturnType<TodoistIntegration['getProjectHierarchy']>>;
  }> {
    const startTime = Date.now();
    console.log('  Fetching Todoist projects...');
    const projectHierarchy = await this.todoist.getProjectHierarchy();

    console.log('  Fetching Todoist tasks using Sync API...');
    
    // Get stored sync token (null for first sync, which uses '*' for full sync)
    const syncToken = this.db.getTodoistSyncToken() || '*';
    
    // Sync with Todoist
    const syncResult = await this.todoist.syncTasks(syncToken);
    
    // Convert Sync API items to TodoistTask format
    const todoistTaskData = this.todoist.convertSyncItemsToTasks(syncResult.items);
    
    // Store new sync token
    this.db.updateTodoistSyncToken(syncResult.syncToken);

    // Mark projects with tasks
    this.todoist.markProjectsWithTasks(projectHierarchy, todoistTaskData);

    // Convert to Task objects
    const todoistTasks = this.todoist.convertToTaskObjects(todoistTaskData);

    const elapsed = Date.now() - startTime;
    console.log(`  ✓ Fetched ${todoistTasks.length} tasks and ${projectHierarchy.projects.size} projects from Todoist (${(elapsed / 1000).toFixed(2)}s, ${syncResult.fullSync ? 'full sync' : 'incremental'})`);

    return { todoistTasks, projectHierarchy };
  }

  private async fetchCraftData(): Promise<Task[]> {
    const overallStart = Date.now();
    console.log('  Fetching Craft tasks...');
    
    // Fetch tasks from standard scopes (inbox, active, etc.)
    const craftTaskData = await this.craft.getAllTasks();

    // Search for recently modified documents (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    console.log('  Searching for recently modified documents...');
    const recentDocIds = await this.craft.findRecentlyModifiedDocuments(thirtyDaysAgo);
    
    // Scan those documents for tasks
    const documentTasks = recentDocIds.length > 0 
      ? await this.craft.scanAdditionalDocuments(recentDocIds, this.folderDocumentMap)
      : [];

    // Combine and deduplicate
    const allCraftTasks = [...craftTaskData, ...documentTasks];
    const seenIds = new Set<string>();
    const uniqueTasks = allCraftTasks.filter(task => {
      if (seenIds.has(task.id)) return false;
      seenIds.add(task.id);
      return true;
    });

    // Convert to Task objects
    const craftTasks = this.craft.convertToTaskObjects(uniqueTasks);

    const elapsed = Date.now() - overallStart;
    console.log(`  ✓ Fetched ${craftTasks.length} tasks from Craft (${(elapsed / 1000).toFixed(2)}s total)`);

    return craftTasks;
  }

  /**
   * Compare task fields to detect changes (for Todoist which lacks modification timestamps)
   */
  private hasTaskFieldsChanged(dbTask: Task, currentTask: Task): boolean {
    // Compare key fields that might have changed
    if (dbTask.title !== currentTask.title) return true;
    
    // Normalize descriptions for comparison (treat null/undefined/empty as same)
    const dbDesc = (dbTask.description || '').trim();
    const currentDesc = (currentTask.description || '').trim();
    if (dbDesc !== currentDesc) return true;
    
    if (dbTask.scheduleDate !== currentTask.scheduleDate) return true;
    if (dbTask.deadline !== currentTask.deadline) return true;
    if (dbTask.isCompleted !== currentTask.isCompleted) return true;
    
    // Compare labels (arrays)
    const dbLabels = (dbTask.labels || []).sort().join(',');
    const currentLabels = (currentTask.labels || []).sort().join(',');
    if (dbLabels !== currentLabels) return true;
    
    return false;
  }

  private async syncProjects(projectHierarchy: Awaited<ReturnType<TodoistIntegration['getProjectHierarchy']>>): Promise<void> {
    for (const [projectId, projectData] of projectHierarchy.projects) {
      const projectRecord = {
        todoistProjectId: projectId,
        name: projectData.name,
        parentProjectId: projectData.parent_id,
        isLeaf: projectData.isLeaf,
        hasTasks: projectData.hasTasks,
        lastSynced: new Date().toISOString(),
      };

      this.db.upsertProject(projectRecord);
    }

    console.log(`  ✓ Synced ${projectHierarchy.projects.size} projects to database`);
  }

  /**
   * 3-way merge: Compare DB, Todoist, and Craft timestamps
   * Pick the source with the highest timestamp as canonical
   * Return tasks marked with which source is newest
   */
  private mergeTasks(todoistTasks: Task[], craftTasks: Task[]): Task[] {
    const merged: Task[] = [];

    // Load existing mappings from database
    const dbTasks = this.db.getAllTasks();

    // Create maps for quick lookup
    const dbByTodoistId = new Map<string, Task>();
    const dbByCraftId = new Map<string, Task>();
    const todoistById = new Map<string, Task>();
    const craftById = new Map<string, Task>();

    // Index all tasks
    for (const dbTask of dbTasks) {
      if (dbTask.todoistId) dbByTodoistId.set(dbTask.todoistId, dbTask);
      if (dbTask.craftId) dbByCraftId.set(dbTask.craftId, dbTask);
    }

    for (const todoistTask of todoistTasks) {
      if (todoistTask.todoistId) todoistById.set(todoistTask.todoistId, todoistTask);
    }

    for (const craftTask of craftTasks) {
      if (craftTask.craftId) craftById.set(craftTask.craftId, craftTask);
    }

    // Track which tasks we've processed
    const processedTaskKeys = new Set<string>();

    // Process all unique task identities
    const allDbTasks = this.db.getAllTasks();

    for (const dbTask of allDbTasks) {
      const key = this.getTaskKey(dbTask);
      if (processedTaskKeys.has(key)) continue;
      processedTaskKeys.add(key);

      // Get all three versions
      const todoistTask = dbTask.todoistId ? todoistById.get(dbTask.todoistId) : undefined;
      const craftTask = dbTask.craftId ? craftById.get(dbTask.craftId) : undefined;

      // If any version (db, todoist, craft) has the nosync label/tag, skip syncing this task
      const hasNoSync = (arr?: string[]) => Array.isArray(arr) && arr.includes(CONSTANTS.NOSYNC_TAG);
      if (
        hasNoSync(dbTask.labels) ||
        (todoistTask && hasNoSync(todoistTask.labels)) ||
        (craftTask && hasNoSync(craftTask.labels))
      ) {
        // Mark as processed but do not add to merged
        if (todoistTask?.todoistId) processedTaskKeys.add(`todoist:${todoistTask.todoistId}`);
        if (craftTask?.craftId) processedTaskKeys.add(`craft:${craftTask.craftId}`);
        continue;
      }

      // Perform 3-way merge
      const mergedTask = this.merge3Way(dbTask, todoistTask, craftTask);
      merged.push(mergedTask);

      // Mark as processed
      if (todoistTask?.todoistId) processedTaskKeys.add(`todoist:${todoistTask.todoistId}`);
      if (craftTask?.craftId) processedTaskKeys.add(`craft:${craftTask.craftId}`);
    }

    // Process Todoist tasks not in DB
    for (const todoistTask of todoistTasks) {
      const key = `todoist:${todoistTask.todoistId}`;
      if (processedTaskKeys.has(key)) continue;
      processedTaskKeys.add(key);
      // Skip if nosync label present
      if (Array.isArray(todoistTask.labels) && todoistTask.labels.includes(CONSTANTS.NOSYNC_TAG)) continue;
      // New task from Todoist
      todoistTask.canonicalSource = 'todoist';
      merged.push(todoistTask);
    }

    // Process Craft tasks not in DB
    for (const craftTask of craftTasks) {
      const key = `craft:${craftTask.craftId}`;
      if (processedTaskKeys.has(key)) continue;
      processedTaskKeys.add(key);
      // Skip if nosync label present
      if (Array.isArray(craftTask.labels) && craftTask.labels.includes(CONSTANTS.NOSYNC_TAG)) continue;
      // New task from Craft
      craftTask.canonicalSource = 'craft';
      merged.push(craftTask);
    }

    console.log(`  ✓ Merged ${merged.length} tasks (${todoistTasks.length} from Todoist, ${craftTasks.length} from Craft, ${dbTasks.length} in DB)`);

    return merged;
  }

  /**
   * Get a unique key for a task based on its IDs
   */
  private getTaskKey(task: Task): string {
    if (task.todoistId && task.craftId) {
      return `both:${task.todoistId}:${task.craftId}`;
    } else if (task.todoistId) {
      return `todoist:${task.todoistId}`;
    } else if (task.craftId) {
      return `craft:${task.craftId}`;
    }
    return `unknown:${task.id || Math.random()}`;
  }

  /**
   * Perform 3-way merge: Compare timestamps from DB, Todoist, and Craft
   * Pick the source with the highest timestamp as the canonical source
   * Special case: Todoist doesn't provide modification timestamps, so we compare field values
   */
  private merge3Way(dbTask: Task, todoistTask?: Task, craftTask?: Task): Task {
    // Check if Todoist task has changes compared to DB (field-level comparison)
    const todoistChanged = todoistTask && this.hasTaskFieldsChanged(dbTask, todoistTask);
    
    // Collect all available timestamps
    const sources: Array<{ source: 'db' | 'todoist' | 'craft'; task: Task; timestamp: Date | null }> = [];

    // DB timestamp (use the latest of todoist or craft from DB)
    const dbTimestamp = TaskModel.getLatestModificationTime(dbTask);
    if (dbTimestamp) {
      sources.push({ source: 'db', task: dbTask, timestamp: dbTimestamp });
    }

    // Todoist: since it doesn't provide modification timestamps, use current time if changed
    if (todoistTask) {
      if (todoistChanged) {
        // Task has changed, treat as current time
        sources.push({
          source: 'todoist',
          task: todoistTask,
          timestamp: new Date(), // Use current time since it's newer than DB
        });
      } else if (todoistTask.lastModifiedTodoist) {
        // No change detected, use creation timestamp
        try {
          sources.push({
            source: 'todoist',
            task: todoistTask,
            timestamp: new Date(todoistTask.lastModifiedTodoist),
          });
        } catch (e) {
          // Invalid timestamp
        }
      }
    }

    // Craft timestamp
    if (craftTask?.lastModifiedCraft) {
      try {
        sources.push({
          source: 'craft',
          task: craftTask,
          timestamp: new Date(craftTask.lastModifiedCraft),
        });
      } catch (e) {
        // Invalid timestamp
      }
    }

    // If no timestamps available, default to DB or first available
    if (sources.length === 0) {
      const result = { ...dbTask };
      if (todoistTask) {
        result.todoistId = todoistTask.todoistId;
        result.projectId = todoistTask.projectId;
      }
      if (craftTask) {
        result.craftId = craftTask.craftId;
        result.craftDocumentId = craftTask.craftDocumentId;
      }
      result.canonicalSource = 'db';
      return result;
    }

    // Find the source with the highest timestamp
    sources.sort((a, b) => {
      if (!a.timestamp) return 1;
      if (!b.timestamp) return -1;
      return b.timestamp.getTime() - a.timestamp.getTime();
    });

    const canonical = sources[0];

    // Build merged task using canonical source as base
    const merged: Task = { ...canonical.task };

    // Preserve all ID mappings from all sources
    merged.todoistId = todoistTask?.todoistId || dbTask.todoistId;
    merged.craftId = craftTask?.craftId || dbTask.craftId;
    merged.projectId = todoistTask?.projectId || dbTask.projectId;
    merged.craftDocumentId = craftTask?.craftDocumentId || dbTask.craftDocumentId;

    // Preserve all timestamps
    merged.lastModifiedTodoist = todoistTask?.lastModifiedTodoist || dbTask.lastModifiedTodoist;
    merged.lastModifiedCraft = craftTask?.lastModifiedCraft || dbTask.lastModifiedCraft;

    // Merge labels from all sources (both Todoist labels and Craft hashtags)
    const allLabels = [
      ...(todoistTask?.labels || []),
      ...(craftTask?.labels || []),
      ...(dbTask.labels || []),
    ];
    // Remove duplicates and use as the single source of truth
    merged.labels = [...new Set(allLabels)];

    // Mark which source is canonical
    merged.canonicalSource = canonical.source;

    return merged;
  }

  /**
   * Determine sync operations based on canonical source
   * - If canonical source is 'todoist', update Craft
   * - If canonical source is 'craft', update Todoist
   * - If canonical source is 'db', both sides are outdated (sync based on last known state)
   */
  private determineSyncOperations(tasks: Task[]): SyncOperations {
    const operations: SyncOperations = {
      createTodoist: [],
      updateTodoist: [],
      completeTodoist: [],
      createCraft: [],
      updateCraft: [],
      completeCraft: [],
      conflicts: [],
    };

    for (const task of tasks) {
      // Check for conflicts (both sides changed within conflict window)
      if (TaskModel.hasConflict(task, this.conflictWindow)) {
        console.log(`  ⚠ Conflict detected for task: ${task.title}`);
        operations.conflicts.push(task);
        continue;
      }

      // Handle new tasks (only exist on one side)
      if (!task.todoistId && task.craftId) {
        // Task only exists in Craft, create in Todoist
        operations.createTodoist.push(task);
        continue;
      } else if (!task.craftId && task.todoistId) {
        // Task only exists in Todoist, create in Craft
        operations.createCraft.push(task);
        continue;
      }

      // Handle existing tasks (exist on both sides) - sync based on canonical source
      if (task.todoistId && task.craftId) {
        const source = task.canonicalSource || 'db';

        if (source === 'todoist') {
          // Todoist has the latest data, update Craft
          if (task.isCompleted) {
            operations.completeCraft.push(task);
          } else {
            operations.updateCraft.push(task);
          }
        } else if (source === 'craft') {
          // Craft has the latest data, update Todoist
          if (task.isCompleted) {
            operations.completeTodoist.push(task);
          } else {
            operations.updateTodoist.push(task);
          }
        }
        // If source === 'db', both sides are in sync (no operation needed)
      }
    }

    // Log summary
    console.log('  ✓ Sync operations determined:');
    console.log(`    - Create in Todoist: ${operations.createTodoist.length}`);
    console.log(`    - Update in Todoist: ${operations.updateTodoist.length}`);
    console.log(`    - Complete in Todoist: ${operations.completeTodoist.length}`);
    console.log(`    - Create in Craft: ${operations.createCraft.length}`);
    console.log(`    - Update in Craft: ${operations.updateCraft.length}`);
    console.log(`    - Complete in Craft: ${operations.completeCraft.length}`);
    console.log(`    - Conflicts: ${operations.conflicts.length}`);

    return operations;
  }

  private async executeSyncOperations(operations: SyncOperations): Promise<void> {
    // Create tasks in Todoist
    for (const task of operations.createTodoist) {
      try {
        // Skip tasks with empty titles
        if (!task.title || task.title.trim() === '') {
          console.log(`  ⚠ Skipping task with empty title (Craft ID: ${task.craftId})`);
          continue;
        }
        
        // Resolve project using mapping (if task has craftDocumentId)
        if (task.craftDocumentId && !task.projectId) {
          // Get folder hierarchy from the pre-built map
          const folderHierarchy = this.folderDocumentMap.get(task.craftDocumentId) || [];
          
          console.log(`\n🔍 Looking up folder hierarchy for doc ${task.craftDocumentId}`);
          console.log(`  Found in map: ${this.folderDocumentMap.has(task.craftDocumentId)}`);
          if (folderHierarchy.length > 0) {
            console.log(`  Hierarchy (${folderHierarchy.length} folders): [${folderHierarchy.join(' > ')}]`);
          } else {
            console.log(`  No folder hierarchy found for this document`);
          }
          
          const result = this.mapper.resolveTodoistProject(
            task.craftDocumentId,
            folderHierarchy
          );
          if (result.projectId) {
            task.projectId = result.projectId;
            const resolvedBy = result.isDefault ? 'default (inbox)' : 
                              folderHierarchy.length > 0 ? 'folder hierarchy' : 'document mapping';
            console.log(`  ✓ Resolved to project ${result.projectId} via ${resolvedBy}`);
          }
        }

        const createdTask = await this.todoist.createTask(task);
        task.todoistId = createdTask.id;
        task.lastModifiedTodoist = new Date().toISOString();
        task.syncStatus = SyncStatus.SYNCED;

        this.db.upsertTask(task);

        this.db.logSyncOperation({
          operation: 'task_created',
          source: 'todoist',
          entityType: 'task',
          entityId: task.todoistId,
          details: JSON.stringify({ title: task.title }),
          status: 'success',
        });
      } catch (error) {
        console.error(`  Failed to create task in Todoist:`, error);
        this.db.logSyncOperation({
          operation: 'task_created',
          source: 'todoist',
          entityType: 'task',
          status: 'error',
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Update tasks in Todoist
    for (const task of operations.updateTodoist) {
      try {
        console.log(`  Updating task in Todoist: ${task.title}`);

        await this.todoist.updateTask(task);
        task.lastModifiedTodoist = new Date().toISOString();
        task.lastSynced = new Date().toISOString();
        task.syncStatus = SyncStatus.SYNCED;

        this.db.upsertTask(task);
      } catch (error) {
        console.error(`  Failed to update task in Todoist:`, error);
      }
    }

    // Complete tasks in Todoist
    for (const task of operations.completeTodoist) {
      try {
        console.log(`  Completing task in Todoist: ${task.title}`);

        await this.todoist.completeTask(task.todoistId!);
        task.lastModifiedTodoist = new Date().toISOString();
        task.lastSynced = new Date().toISOString();

        this.db.upsertTask(task);
      } catch (error) {
        console.error(`  Failed to complete task in Todoist:`, error);
      }
    }

    // Create tasks in Craft (batch operation with chunking)
    if (operations.createCraft.length > 0) {
      const batchSize = 10; // Process 10 tasks at a time
      
      // Group tasks by target (document/folder/inbox) based on project mapping
      const tasksByTarget = new Map<string, Task[]>();
      
      for (const task of operations.createCraft) {
        // Resolve target using mapping (if task has projectId)
        let targetKey = 'inbox';
        if (task.projectId) {
          const result = this.mapper.resolveCraftDocument(task.projectId);
          if (result.nosync) {
            console.log(`  ⏭️  Skipping task for project ${task.projectId} (nosync)`);
            continue; // Skip this task
          }
          if (result.documentId) {
            targetKey = `doc:${result.documentId}`;
            task.craftDocumentId = result.documentId; // Store for reference
          } else {
            targetKey = 'inbox';
          }
        }
        
        if (!tasksByTarget.has(targetKey)) {
          tasksByTarget.set(targetKey, []);
        }
        tasksByTarget.get(targetKey)!.push(task);
      }

      console.log(`  Creating ${operations.createCraft.length} tasks in Craft (${tasksByTarget.size} targets)`);

      // Process each target group
      for (const [targetKey, targetTasks] of tasksByTarget) {
        const batches = [];
        for (let i = 0; i < targetTasks.length; i += batchSize) {
          batches.push(targetTasks.slice(i, i + batchSize));
        }

        for (const batch of batches) {
          try {
            let createdTasks;
            
            if (targetKey.startsWith('doc:')) {
              // Create in specific document
              const documentId = targetKey.substring(4);
              createdTasks = await this.craft.createTasksInDocument(batch, documentId);
            } else {
              // This should not happen as all tasks should have a document target
              // but if it does, it means mapping failed - throw error
              throw new Error('No valid target document found for tasks. Ensure Task Inbox document exists.');
            }
          
            // Map created tasks back to our task objects
            for (let i = 0; i < batch.length && i < createdTasks.length; i++) {
              const task = batch[i];
              const createdTask = createdTasks[i];
              
              task.craftId = createdTask.id;
              task.lastModifiedCraft = new Date().toISOString();
              task.syncStatus = SyncStatus.SYNCED;

              this.db.upsertTask(task);

              this.db.logSyncOperation({
                operation: 'task_created',
                source: 'craft',
                entityType: 'task',
                entityId: task.craftId,
                details: JSON.stringify({ title: task.title }),
                status: 'success',
              });
            }
            
            console.log(`    ✓ Batch created ${createdTasks.length} tasks`);
          } catch (error) {
            console.error(`  Failed to create batch in Craft:`, error);
            this.db.logSyncOperation({
              operation: 'task_created_batch',
              source: 'craft',
              entityType: 'task',
              status: 'error',
              errorMessage: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }

    // Update tasks in Craft
    for (const task of operations.updateCraft) {
      try {
        console.log(`  Updating task in Craft: ${task.title}`);

        await this.craft.updateTask(task);
        task.lastModifiedCraft = new Date().toISOString();
        task.lastSynced = new Date().toISOString();
        task.syncStatus = SyncStatus.SYNCED;

        this.db.upsertTask(task);
      } catch (error) {
        console.error(`  Failed to update task in Craft:`, error);
      }
    }

    // Complete tasks in Craft
    for (const task of operations.completeCraft) {
      try {
        console.log(`  Completing task in Craft: ${task.title}`);

        await this.craft.completeTask(task.craftId!);
        task.lastModifiedCraft = new Date().toISOString();
        task.lastSynced = new Date().toISOString();

        this.db.upsertTask(task);
      } catch (error) {
        console.error(`  Failed to complete task in Craft:`, error);
      }
    }

    // Log conflicts
    for (const task of operations.conflicts) {
      console.log(`  Conflict logged for task: ${task.title}`);
      task.syncStatus = SyncStatus.CONFLICT;
      this.db.upsertTask(task);

      this.db.logSyncOperation({
        operation: 'conflict_detected',
        source: 'system',
        entityType: 'task',
        entityId: task.todoistId || task.craftId,
        details: JSON.stringify({
          title: task.title,
          todoistModified: task.lastModifiedTodoist,
          craftModified: task.lastModifiedCraft,
        }),
        status: 'warning',
      });
    }
  }
}
