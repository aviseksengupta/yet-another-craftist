/**
 * Craft.do integration module
 */

import axios, { AxiosInstance } from 'axios';
import { Task, CraftTask, CraftBlock } from './types';
import { CONSTANTS } from './constants';
import { TaskModel } from './models';

/**
 * Sleep utility for rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class CraftIntegration {
  private client: AxiosInstance;
  private requestDelay: number; // Delay between API requests in milliseconds

  constructor(apiBaseUrl: string, requestDelay: number = 200) {
    this.client = axios.create({
      baseURL: apiBaseUrl.replace(/\/$/, ''),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
    this.requestDelay = requestDelay;
  }

  /**
   * Fetch all tasks from Craft across different scopes
   * Note: /tasks endpoint doesn't include modification timestamps,
   * so we fetch each task as a block with metadata to get lastModifiedAt
   */
  async getAllTasks(scopes: string[] = ['active', 'upcoming', 'inbox', 'logbook']): Promise<CraftTask[]> {
    const startTime = Date.now();
    console.log('Fetching tasks from Craft scopes...');
    const allTasks: CraftTask[] = [];

    for (const scope of scopes) {
      console.log(`  Scope: ${scope}`);
      
      try {
        const response = await this.client.get('/tasks', {
          params: { scope },
        });

        const tasks = response.data.items || [];
        
        // Fetch metadata for each task by getting it as a block
        const tasksWithMetadata: CraftTask[] = [];
        for (const task of tasks) {
          try {
            const blockResponse = await this.client.get('/blocks', {
              params: {
                id: task.id,
                fetchMetadata: true,
              },
            });
            
            const blockData = blockResponse.data;
            // Merge the full block data (including metadata AND content) into the task
            // This is important for page-type blocks which may have description content
            tasksWithMetadata.push({
              ...task,
              metadata: blockData.metadata,
              content: blockData.content, // Include content blocks for descriptions
              type: blockData.type, // Include block type (page vs body)
            });
            
            // Small delay to avoid rate limiting
            await sleep(50);
          } catch (error) {
            console.error(`Failed to fetch metadata for task ${task.id}:`, error);
            // Add task without metadata as fallback
            tasksWithMetadata.push(task);
          }
        }
        
        allTasks.push(...tasksWithMetadata);
        
        console.log(`    Retrieved ${tasksWithMetadata.length} tasks`);
        
        // Rate limiting delay
        await sleep(this.requestDelay);
      } catch (error) {
        console.error(`    Failed: ${error instanceof Error ? error.message : error}`);
      }
    }

    const elapsed = Date.now() - startTime;
    // Filter out tasks with the nosync hashtag
    const filteredTasks = allTasks.filter(task => {
      // Check for hashtag in markdown (e.g., #nosync)
      if (typeof task.markdown === 'string') {
        const tag = `#${CONSTANTS.NOSYNC_TAG}`;
        return !task.markdown.includes(tag);
      }
      return true;
    });
    console.log(`  ✓ Fetched ${filteredTasks.length} tasks from ${scopes.length} scopes (${(elapsed / 1000).toFixed(2)}s) (filtered)`);
    return filteredTasks;
  }

  /**
   * Fetch blocks from a daily note or specific block
   */
  async getBlocks(params: {
    date?: string;
    blockId?: string;
    maxDepth?: number;
    fetchMetadata?: boolean;
  }): Promise<CraftBlock[]> {
    console.log('Fetching blocks from Craft...');
    
    try {
      const response = await this.client.get('/blocks', {
        params: {
          date: params.date,
          id: params.blockId,
          maxDepth: params.maxDepth ?? -1,
          fetchMetadata: params.fetchMetadata ?? true,
        },
      });

      const blocks = Array.isArray(response.data) ? response.data : [response.data];
      return blocks;
    } catch (error) {
      console.error('Failed to fetch blocks:', error);
      return [];
    }
  }

  /**
   * Fetch all folders and build document-to-folder hierarchy map
   * Uses /folders to get tree structure, then /documents?folderId={id} for documents
   */
  async buildFolderDocumentMap(skipSystemFolders: boolean = true): Promise<Map<string, string[]>> {
    console.log('  Building folder-document map from Craft...');
    const documentToFolders = new Map<string, string[]>();
    
    try {
      const response = await this.client.get('/folders');
      const items = response.data.items || [];
      console.log(`    📡 Fetched ${items.length} top-level folders`);
      
      // Recursively traverse folders and fetch documents
      const traverseFolders = async (folderList: any[], parentHierarchy: Array<{id: string, name: string}> = [], depth: number = 0) => {
        for (const folder of folderList) {
          // Skip system folders if requested (but always skip trash)
          if (skipSystemFolders && ['unsorted', 'daily_notes', 'templates'].includes(folder.id)) {
            continue;
          }
          if (folder.id === 'trash') {
            continue;
          }
          
          const currentHierarchy = [...parentHierarchy, { id: folder.id, name: folder.name }];
          // Reverse to get innermost-first order (closest to document first)
          const folderIds = currentHierarchy.map(f => f.id).reverse();
          const indent = '  '.repeat(depth);
          
          console.log(`    ${indent}📁 ${folder.name} (${folder.id.substring(0, 8)}) - ${folder.documentCount || 0} docs`);
          
          // If this folder has documents, fetch them using /documents?folderId={id}
          if (folder.documentCount && folder.documentCount > 0) {
            try {
              const docsResponse = await this.client.get('/documents', {
                params: {
                  fetchMetadata: true,
                  folderId: folder.id
                }
              });
              
              const documents = docsResponse.data.items || [];
              console.log(`    ${indent}   ✓ Fetched ${documents.length} documents`);
              
              for (const doc of documents) {
                documentToFolders.set(doc.id, folderIds);
                console.log(`    ${indent}   📄 ${doc.name?.substring(0, 40) || doc.id.substring(0, 8)} -> [${folderIds.map(f => f.substring(0, 8)).join(' < ')}] (innermost first)`);
              }
              
              await sleep(100); // Rate limiting delay
            } catch (error) {
              console.log(`    ${indent}   ❌ Error fetching documents:`, error instanceof Error ? error.message : error);
            }
          }
          
          // Recursively process subfolders
          if (folder.folders && folder.folders.length > 0) {
            await traverseFolders(folder.folders, currentHierarchy, depth + 1);
          }
        }
      };
      
      await traverseFolders(items);
      console.log(`    ✓ Mapped ${documentToFolders.size} documents to their folder hierarchies`);
      
      // Log the complete folder-document tree for debugging
      console.log('\n📁 === Complete Folder-Document Map (Innermost → Outermost) ===');
      for (const [docId, hierarchy] of documentToFolders.entries()) {
        console.log(`  Document ${docId.substring(0, 8)}: [${hierarchy.map(f => f.substring(0, 8)).join(' < ')}]`);
      }
      console.log('='.repeat(50) + '\n');
      
    } catch (error) {
      console.error('    Error building folder-document map:', error instanceof Error ? error.message : error);
    }
    
    return documentToFolders;
  }

  /**
   * Fetch documents from unsorted location
   */
  async getUnsortedDocuments(): Promise<string[]> {
    console.log('  Fetching documents from unsorted location...');
    
    try {
      const response = await this.client.get('/documents', {
        params: {
          fetchMetadata: true,
          location: 'unsorted'
        }
      });
      
      const documents = response.data.items || [];
      console.log(`    ✓ Fetched ${documents.length} documents from unsorted`);
      
      const documentIds = documents.map((doc: any) => doc.id);
      return documentIds;
    } catch (error) {
      console.error('    Error fetching unsorted documents:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  /**
   * Search for recently modified documents using the /documents/search endpoint
   * This is more efficient than scanning all dates
   */
  async findRecentlyModifiedDocuments(since: Date): Promise<string[]> {
    const startTime = Date.now();
    const sinceStr = since.toISOString().split('T')[0]; // Format: YYYY-MM-DD
    
    console.log(`Searching for documents modified since ${sinceStr}...`);
    
    try {
      // Use a simple wildcard pattern to get all documents
      const response = await this.client.get('/documents/search', {
        params: {
          include: ' ', // Space character to match all documents with content
          lastModifiedDate: sinceStr,
        },
      });
      
      const items = response.data.items || [];
      
      // Extract unique document IDs
      const documentIds = [...new Set(items.map((item: any) => item.documentId))] as string[];
      
      const elapsed = Date.now() - startTime;
      console.log(`  ✓ Found ${documentIds.length} documents modified since ${sinceStr} (${elapsed}ms)`);
      
      return documentIds;
    } catch (error) {
      console.error('Failed to search documents:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  /**
   * Scan additional specified documents for tasks
   */
  async scanAdditionalDocuments(documentIds: string[], folderDocumentMap: Map<string, string[]>): Promise<CraftTask[]> {
    const startTime = Date.now();
    console.log(`Scanning ${documentIds.length} documents for tasks...`);
    
    const tasksFound: CraftTask[] = [];
    
    for (const docId of documentIds) {
      try {
        // Get folder hierarchy from the pre-built map
        const folderHierarchy = folderDocumentMap.get(docId) || [];
        
        const blocks = await this.getBlocks({ blockId: docId, fetchMetadata: true, maxDepth: -1 });
        const documentTasks = this.extractTasksFromBlocks(blocks, docId, folderHierarchy);
        tasksFound.push(...documentTasks);
        if (documentTasks.length > 0) {
          console.log(`  Found ${documentTasks.length} tasks in document ${docId.substring(0, 8)}...`);
        }
        
        // Small delay to avoid rate limiting
        await sleep(50);
      } catch (error) {
        console.error(`  Failed to scan document ${docId.substring(0, 8)}...:`, error instanceof Error ? error.message : error);
      }
    }
    
    const elapsed = Date.now() - startTime;
    // Filter out tasks with the nosync hashtag
    const filteredTasks = tasksFound.filter(task => {
      if (typeof task.markdown === 'string') {
        const tag = `#${CONSTANTS.NOSYNC_TAG}`;
        return !task.markdown.includes(tag);
      }
      return true;
    });
    console.log(`  ✓ Scanned ${documentIds.length} documents in ${(elapsed / 1000).toFixed(2)}s, found ${filteredTasks.length} tasks (filtered)`);
    return filteredTasks;
  }

  /**
   * Search for tasks in documents across date range and additional lookback
   */
  async findAllTasksInDocuments(): Promise<CraftTask[]> {
    const startTime = Date.now();
    console.log('Searching for all tasks across Craft daily notes...');
    
    const tasksFound: CraftTask[] = [];
    
    // Check last 90 days of daily notes for tasks (increased from 30)
    const today = new Date();
    
    for (let i = 0; i < 90; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      try {
        const blocks = await this.getBlocks({ date: dateStr, fetchMetadata: true });
        const documentTasks = this.extractTasksFromBlocks(blocks, dateStr);
        tasksFound.push(...documentTasks);
      } catch (error) {
        // Silently skip dates without daily notes
      }
    }
    
    const elapsed = Date.now() - startTime;
    console.log(`✓ Scanned daily notes in ${elapsed}ms, found ${tasksFound.length} tasks`);
    return tasksFound;
  }

  /**
   * Extract tasks from block structure recursively
   */
  private extractTasksFromBlocks(blocks: CraftBlock[], documentId?: string, folderHierarchy?: string[]): CraftTask[] {
    const tasks: CraftTask[] = [];
    
    for (const block of blocks) {
      // Check if this block is a task
      if (block.taskInfo) {
        const task = {
          ...block,
          _documentId: documentId,
          _folderHierarchy: folderHierarchy,
        } as CraftTask;
        tasks.push(task);
      }
      
      // Recursively check nested content
      if (block.content && block.content.length > 0) {
        const nestedTasks = this.extractTasksFromBlocks(block.content, documentId, folderHierarchy);
        tasks.push(...nestedTasks);
      }
    }
    
    return tasks;
  }

  /**
   * Create a new task in Craft
   */
  async createTask(task: Task, locationType: string = 'inbox', date?: string): Promise<CraftTask> {
    console.log(`Creating task in Craft (${locationType}): ${task.title}`);
    
    const craftData = TaskModel.toCraft(task);
    
    const taskData = {
      tasks: [{
        markdown: craftData.markdown,  // Use markdown with hashtags
        taskInfo: craftData.taskInfo,
        location: {
          type: locationType,
          ...(date && { date }),
        },
      }],
    };

    console.log(`  Sending to Craft: ${craftData.markdown}`);
    const response = await this.client.post('/tasks', taskData);
    const createdTasks = response.data.items || [];
    
    // Rate limiting delay
    await sleep(this.requestDelay);
    
    if (createdTasks.length > 0) {
      console.log(`Task created with ID: ${createdTasks[0].id}`);
      return createdTasks[0];
    } else {
      throw new Error('Task creation failed - no task returned');
    }
  }

  /**
   * Create multiple tasks in Craft in one batch request
   */
  async createTasksBatch(tasks: Task[], locationType: string = 'inbox', date?: string): Promise<CraftTask[]> {
    if (tasks.length === 0) return [];
    
    console.log(`Creating ${tasks.length} tasks in Craft (${locationType}) in one batch request`);
    
    const taskData = {
      tasks: tasks.map(task => {
        const craftData = TaskModel.toCraft(task);
        return {
          markdown: craftData.markdown,  // Use markdown with hashtags
          taskInfo: craftData.taskInfo,
          location: {
            type: locationType,
            ...(date && { date }),
          },
        };
      }),
    };

    const response = await this.client.post('/tasks', taskData);
    const createdTasks = response.data.items || [];
    
    // Rate limiting delay
    await sleep(this.requestDelay);
    
    console.log(`Successfully created ${createdTasks.length} tasks in Craft`);
    return createdTasks;
  }

  /**
   * Create multiple tasks in a specific Craft document
   */
  async createTasksInDocument(tasks: Task[], documentId: string): Promise<CraftTask[]> {
    if (tasks.length === 0) return [];
    
    console.log(`Creating ${tasks.length} tasks in document ${documentId.substring(0, 8)}...`);
    
    const createdTasks: CraftTask[] = [];
    
    // Create tasks as text blocks with listStyle: task using the /blocks API
    for (const task of tasks) {
      try {
        const craftData = TaskModel.toCraft(task);
        
        const block: any = {
          type: 'text',
          listStyle: 'task',
          markdown: craftData.markdown,  // Use markdown with hashtags
          taskInfo: craftData.taskInfo,
        };
        
        // Add description as content if available
        if (craftData.content) {
          block.content = craftData.content;
        }
        
        const blockData = {
          blocks: [block],
          position: {
            position: 'start',
            pageId: documentId,
          },
        };

        const response = await this.client.post('/blocks', blockData);
        const insertedBlocks = response.data.items || [];
        
        if (insertedBlocks.length > 0) {
          createdTasks.push(insertedBlocks[0]);
        }
        
        // Small delay to avoid rate limiting
        await sleep(50);
      } catch (error) {
        console.error(`  Failed to create task in document:`, error instanceof Error ? error.message : error);
      }
    }
    
    // Rate limiting delay
    await sleep(this.requestDelay);
    
    console.log(`Successfully created ${createdTasks.length} tasks in document`);
    return createdTasks;
  }

  /**
   * Insert a task block into a document
   */
  async insertTaskBlock(task: Task, documentDate: string = 'today', position: string = 'end'): Promise<CraftBlock> {
    console.log(`Inserting task block: ${task.title}`);
    
    const craftBlock = TaskModel.toCraft(task);
    
    const blockData = {
      blocks: [craftBlock],
      position: {
        position,
        date: documentDate,
      },
    };

    const response = await this.client.post('/blocks', blockData);
    const insertedBlocks = response.data.items || [];
    
    if (insertedBlocks.length > 0) {
      return insertedBlocks[0];
    } else {
      throw new Error('Block insertion failed');
    }
  }

  /**
   * Update an existing task
   */
  async updateTask(task: Task): Promise<CraftTask> {
    if (!task.craftId) {
      throw new Error('Task must have craftId to update');
    }

    console.log(`Updating Craft task ${task.craftId}: ${task.title}`);
    
    const craftData = TaskModel.toCraft(task);
    
    // Fetch existing task to check for HTML tags that need to be preserved
    let markdownToSend = craftData.markdown;
    try {
      const existingBlock = await this.getBlocks({ blockId: task.craftId, fetchMetadata: false });
      if (existingBlock[0]?.markdown) {
        const existingMarkdown = existingBlock[0].markdown.trim();
        // Check if existing markdown has HTML tags wrapping the content
        const htmlTagMatch = existingMarkdown.match(/^(<[^>]+>).*(<\/[^>]+>)$/);
        if (htmlTagMatch) {
          // Preserve the HTML tags, only replace the content inside
          const openTag = htmlTagMatch[1];
          const closeTag = htmlTagMatch[2];
          markdownToSend = `${openTag}${craftData.markdown}${closeTag}`;
          console.log(`  Preserving HTML tags: ${openTag}...${closeTag}`);
        }
      }
    } catch (error) {
      console.log(`  Note: Could not fetch existing task for HTML tag preservation:`, error instanceof Error ? error.message : error);
      // Continue with normal update if we can't fetch existing task
    }
    
    // Update task using /tasks endpoint for task properties
    const taskData = {
      tasksToUpdate: [{
        id: task.craftId,
        markdown: markdownToSend,  // Use markdown with preserved HTML tags
        taskInfo: craftData.taskInfo,
      }],
    };
    
    console.log(`  Sending to Craft: ${markdownToSend}`);

    const response = await this.client.put('/tasks', taskData);
    const updatedTasks = response.data.items || [];
    
    // If there's a description, update it by managing sub-blocks
    if (task.description && task.description.trim()) {
      try {
        // First, try to get existing content to see if we need to add or update
        const existingBlock = await this.getBlocks({ blockId: task.craftId });
        const hasContent = existingBlock[0]?.content && existingBlock[0].content.length > 0;
        
        if (hasContent && existingBlock[0]?.content) {
          // Delete existing content blocks first
          await this.client.delete('/blocks', {
            data: {
              blockIds: existingBlock[0].content.map((b: any) => b.id),
            },
          });
        }
        
        // Add new description block as a child using correct API format
        await this.client.post('/blocks', {
          blocks: [{
            type: 'text',
            markdown: task.description.trim(),
          }],
          position: {
            position: 'end',
            pageId: task.craftId,
          },
        });
      } catch (error) {
        console.log(`Note: Could not sync description for task ${task.craftId}:`, error instanceof Error ? error.message : error);
      }
    }
    
    // Rate limiting delay
    await sleep(this.requestDelay);
    
    if (updatedTasks.length > 0) {
      return updatedTasks[0];
    } else {
      throw new Error(`Task update failed for ${task.craftId}`);
    }
  }

  /**
   * Update task status
   */
  async updateTaskStatus(taskId: string, state: 'todo' | 'done' | 'cancelled'): Promise<CraftTask> {
    console.log(`Updating task ${taskId} status to ${state}`);
    
    const taskData = {
      tasksToUpdate: [{
        id: taskId,
        taskInfo: {
          state,
        },
      }],
    };

    const response = await this.client.put('/tasks', taskData);
    const updatedTasks = response.data.items || [];
    
    // Rate limiting delay
    await sleep(this.requestDelay);
    
    if (updatedTasks.length > 0) {
      return updatedTasks[0];
    } else {
      throw new Error(`Task status update failed for ${taskId}`);
    }
  }

  /**
   * Complete a task
   */
  async completeTask(taskId: string): Promise<boolean> {
    try {
      await this.updateTaskStatus(taskId, 'done');
      return true;
    } catch (error) {
      console.error(`Failed to complete task ${taskId}:`, error);
      return false;
    }
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId: string): Promise<boolean> {
    console.log(`Deleting Craft task ${taskId}`);
    
    try {
      await this.client.delete('/tasks', {
        data: { idsToDelete: [taskId] },
      });
      return true;
    } catch (error) {
      console.error(`Failed to delete task ${taskId}:`, error);
      return false;
    }
  }

  /**
   * Convert Craft tasks to Task objects
   */
  convertToTaskObjects(craftTasks: (CraftTask | CraftBlock)[]): Task[] {
    const tasks: Task[] = [];
    let skippedEmptyTasks = 0;
    
    for (const craftTask of craftTasks) {
      try {
        const documentId = (craftTask as any)._documentId || (craftTask as any).location?.blockId;
        const folderHierarchy = (craftTask as any)._folderHierarchy;
        const task = TaskModel.fromCraft(craftTask as CraftBlock, documentId);
        
        // Validate task has a non-empty title
        if (!task.title || task.title.trim() === '') {
          skippedEmptyTasks++;
          continue;
        }
        
        // Store folder hierarchy in task for later use
        (task as any)._folderHierarchy = folderHierarchy;
        tasks.push(task);
      } catch (error) {
        console.error(`Failed to convert Craft task ${craftTask.id}:`, error);
      }
    }
    
    if (skippedEmptyTasks > 0) {
      console.log(`  ⚠ Skipped ${skippedEmptyTasks} tasks with empty titles from Craft`);
    }
    
    return tasks;
  }

  /**
   * Search daily notes
   */
  async searchDailyNotes(params: {
    searchTerms?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<any[]> {
    console.log('Searching daily notes...');
    
    try {
      const response = await this.client.get('/daily-notes/search', {
        params: {
          include: params.searchTerms,
          startDate: params.startDate,
          endDate: params.endDate,
        },
      });

      const items = response.data.items || [];
      console.log(`Found ${items.length} search results`);
      return items;
    } catch (error) {
      console.error('Search failed:', error);
      return [];
    }
  }
}
