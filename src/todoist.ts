/**
 * Todoist integration module
 */

import { TodoistApi } from '@doist/todoist-api-typescript';
import { Task, TodoistTask, TodoistProject } from './types';
import { CONSTANTS } from './constants';
import { TaskModel } from './models';
import axios from 'axios';

export class TodoistIntegration {
  private api: TodoistApi;
  private apiToken: string;
  private syncApiUrl = 'https://api.todoist.com/sync/v9/sync';

  constructor(apiToken: string) {
    this.api = new TodoistApi(apiToken);
    this.apiToken = apiToken;
  }

  /**
   * Fetch all projects from Todoist
   */
  async getAllProjects(): Promise<TodoistProject[]> {
    console.log('Fetching all projects from Todoist...');
    const projects = await this.api.getProjects();
    console.log(`Retrieved ${projects.length} projects`);
    return projects as TodoistProject[];
  }

  /**
   * Build project hierarchy
   */
  async getProjectHierarchy(): Promise<{
    projects: Map<string, TodoistProject & { children: string[]; hasTasks: boolean; isLeaf: boolean }>;
    roots: string[];
  }> {
    const projects = await this.getAllProjects();

    const projectMap = new Map<string, TodoistProject & { children: string[]; hasTasks: boolean; isLeaf: boolean }>();

    for (const project of projects) {
      projectMap.set(project.id, {
        ...project,
        children: [],
        hasTasks: false,
        isLeaf: true,
      });
    }

    // Build hierarchy
    const roots: string[] = [];
    for (const project of projects) {
      if (project.parent_id && projectMap.has(project.parent_id)) {
        projectMap.get(project.parent_id)!.children.push(project.id);
      } else {
        roots.push(project.id);
      }
    }

    // Mark leaf status
    for (const [id, project] of projectMap) {
      if (project.children.length > 0) {
        project.isLeaf = false;
      }
    }

    return { projects: projectMap, roots };
  }

  /**
   * Fetch tasks using Sync API (incremental updates)
   */
  async syncTasks(syncToken: string = '*'): Promise<{ items: any[]; syncToken: string; fullSync: boolean }> {
    console.log('Syncing tasks from Todoist using Sync API...');
    
    try {
      const response = await axios.post(
        this.syncApiUrl,
        {
          sync_token: syncToken,
          resource_types: ['items', 'projects']
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const items = response.data.items || [];
      const newSyncToken = response.data.sync_token;
      const fullSync = response.data.full_sync || false;

      console.log(`  Retrieved ${items.length} items (full_sync: ${fullSync})`);
      
      return {
        items,
        syncToken: newSyncToken,
        fullSync
      };
    } catch (error) {
      console.error('Error syncing with Todoist:', error);
      throw error;
    }
  }

  /**
   * Convert Sync API items to TodoistTask format
   */
  convertSyncItemsToTasks(items: any[]): TodoistTask[] {
    return items
      .filter(item => !item.is_deleted)
      .filter(item => {
        // Exclude tasks with the nosync label
        if (Array.isArray(item.labels)) {
          return !item.labels.includes(CONSTANTS.NOSYNC_TAG);
        }
        return true;
      })
      .map(item => ({
        id: item.id,
        content: item.content,
        description: item.description || '',
        project_id: item.project_id,
        section_id: item.section_id,
        parent_id: item.parent_id,
        labels: item.labels || [],
        priority: item.priority,
        is_completed: item.checked,
        completed_at: item.completed_at,
        created_at: item.added_at,
        due: item.due ? {
          date: item.due.date,
          string: item.due.string,
          lang: item.due.lang,
          is_recurring: item.due.is_recurring
        } : undefined,
        // Key addition: updated_at from Sync API!
        updated_at: item.updated_at,
      } as TodoistTask));
  }

  /**
   * Fetch all tasks (including completed) - Legacy method kept for compatibility
   */
  async getAllTasks(includeCompleted: boolean = true): Promise<TodoistTask[]> {
    console.log('Fetching all tasks from Todoist...');
    
    const activeTasks = await this.api.getTasks();
    let allTasks = [...activeTasks] as TodoistTask[];
    // Filter out tasks with the nosync label
    const filteredTasks = allTasks.filter(task => {
      if (Array.isArray(task.labels)) {
        return !task.labels.includes(CONSTANTS.NOSYNC_TAG);
      }
      return true;
    });
    console.log(`Retrieved ${filteredTasks.length} tasks (filtered)`);
    return filteredTasks;
  }

  /**
   * Get tasks for a specific project
   */
  async getTasksForProject(projectId: string): Promise<TodoistTask[]> {
    console.log(`Fetching tasks for project ${projectId}...`);
    const tasks = await this.api.getTasks({ projectId });
    return tasks as TodoistTask[];
  }

  /**
   * Create a new task in Todoist
   */
  async createTask(task: Task): Promise<TodoistTask> {
    // Validate task has a non-empty title
    if (!task.title || task.title.trim() === '') {
      throw new Error(`Cannot create task with empty title. Task ID: ${task.craftId || task.id}`);
    }
    
    console.log(`Creating task in Todoist: ${task.title}`);
    
    const taskData = TaskModel.toTodoist(task);
    console.log(`  Task data being sent:`, JSON.stringify(taskData, null, 2));
    
    try {
      const createdTask = await this.api.addTask(taskData as any);
      console.log(`Task created with ID: ${createdTask.id}`);
      return createdTask as TodoistTask;
    } catch (error: any) {
      console.error(`  Failed with data:`, JSON.stringify(taskData, null, 2));
      console.error(`  Error details:`, error.message, error.responseData);
      throw error;
    }
  }

  /**
   * Update an existing task
   */
  async updateTask(task: Task): Promise<TodoistTask> {
    if (!task.todoistId) {
      throw new Error('Task must have todoistId to update');
    }

    console.log(`Updating Todoist task ${task.todoistId}: ${task.title}`);
    
    const taskData = TaskModel.toTodoist(task);
    const updatedTask = await this.api.updateTask(task.todoistId, taskData as any);
    
    return updatedTask as TodoistTask;
  }

  /**
   * Complete a task
   */
  async completeTask(todoistId: string): Promise<boolean> {
    console.log(`Completing Todoist task ${todoistId}`);
    
    try {
      await this.api.closeTask(todoistId);
      return true;
    } catch (error) {
      console.error(`Failed to complete task ${todoistId}:`, error);
      return false;
    }
  }

  /**
   * Reopen a completed task
   */
  async reopenTask(todoistId: string): Promise<boolean> {
    console.log(`Reopening Todoist task ${todoistId}`);
    
    try {
      await this.api.reopenTask(todoistId);
      return true;
    } catch (error) {
      console.error(`Failed to reopen task ${todoistId}:`, error);
      return false;
    }
  }

  /**
   * Delete a task
   */
  async deleteTask(todoistId: string): Promise<boolean> {
    console.log(`Deleting Todoist task ${todoistId}`);
    
    try {
      await this.api.deleteTask(todoistId);
      return true;
    } catch (error) {
      console.error(`Failed to delete task ${todoistId}:`, error);
      return false;
    }
  }

  /**
   * Convert Todoist tasks to Task objects
   */
  convertToTaskObjects(todoistTasks: TodoistTask[]): Task[] {
    const tasks: Task[] = [];
    let skippedEmptyTasks = 0;
    
    for (const todoistTask of todoistTasks) {
      try {
        const task = TaskModel.fromTodoist(todoistTask);
        
        // Validate task has a non-empty title
        if (!task.title || task.title.trim() === '') {
          skippedEmptyTasks++;
          continue;
        }
        
        tasks.push(task);
      } catch (error) {
        console.error(`Failed to convert Todoist task ${todoistTask.id}:`, error);
      }
    }
    
    if (skippedEmptyTasks > 0) {
      console.log(`  ⚠ Skipped ${skippedEmptyTasks} tasks with empty titles from Todoist`);
    }
    
    return tasks;
  }

  /**
   * Mark which projects have tasks
   */
  markProjectsWithTasks(
    projectHierarchy: ReturnType<typeof this.getProjectHierarchy> extends Promise<infer T> ? T : never,
    tasks: TodoistTask[]
  ): void {
    for (const task of tasks) {
      if (task.project_id && projectHierarchy.projects.has(task.project_id)) {
        projectHierarchy.projects.get(task.project_id)!.hasTasks = true;
      }
    }
  }
}
