/**
 * Task model with conversion utilities
 */

import { Task, TaskStatus, SyncStatus, TodoistTask, CraftTask, CraftBlock } from './types';

export class TaskModel {
  /**
   * Create Task from Todoist API response
   */
  static fromTodoist(todoistTask: TodoistTask): Task {
    const scheduleDate = todoistTask.due?.date;  // Todoist 'due' → our 'scheduleDate'
    const deadline = todoistTask.deadline;        // Todoist 'deadline' → our 'deadline'
    const isCompleted = todoistTask.is_completed || false;
    const completedAt = todoistTask.completed_at;

    // Use updated_at from Sync API if available, otherwise fall back to completed_at or created_at
    const lastModified = todoistTask.updated_at || todoistTask.completed_at || todoistTask.created_at;

    return {
      title: todoistTask.content,
      description: todoistTask.description || '',
      todoistId: todoistTask.id,
      scheduleDate,
      deadline,
      isCompleted,
      completedAt,
      labels: todoistTask.labels || [],
      projectId: todoistTask.project_id,
      lastModifiedTodoist: lastModified,
      syncStatus: SyncStatus.PENDING,
    };
  }

  /**
   * Create Task from Craft API response
   */
  static fromCraft(craftBlock: CraftBlock, documentId?: string): Task {
    const taskInfo = craftBlock.taskInfo;
    const metadata = craftBlock.metadata;

    // Extract title from markdown (remove HTML tags first, then checkbox syntax)
    let title = craftBlock.markdown?.trim() || '';
    // Remove HTML tags from beginning and end first (e.g., <callout>content</callout>)
    title = title.replace(/^<[^>]+>/, '').replace(/<\/[^>]+>$/, '').trim();
    // Then remove markdown task syntax: "- [ ] " or "- [x] " or "- [X] "
    title = title.replace(/^-\s*\[[\sxX]\]\s*/, '');

    // Parse task state
    const state = taskInfo?.state || 'todo';
    const isCompleted = state === 'done';

    // Get completion timestamp
    const completedAt = taskInfo?.completedAt;

    // Extract dates
    const scheduleDate = taskInfo?.scheduleDate;   // Craft 'scheduleDate' → our 'scheduleDate'
    const deadline = taskInfo?.deadlineDate;       // Craft 'deadlineDate' → our 'deadline'

    // Extract description from content blocks
    let description = '';
    if (craftBlock.content && craftBlock.content.length > 0) {
      // Concatenate all text blocks in content as description
      description = craftBlock.content
        .filter(block => block.type === 'text' && block.markdown)
        .map(block => block.markdown?.replace(/^-\s*\[[\sxX]\]\s*/, '').trim())
        .filter(text => text)
        .join('\n');
    }

    // Get last modified time
    const lastModified = metadata?.lastModifiedAt;

    // Extract hashtags from markdown as labels
    const labels: string[] = [];
    const markdownText = craftBlock.markdown || '';
    const hashtagRegex = /#([\w-]+)/g;
    let match;
    while ((match = hashtagRegex.exec(markdownText)) !== null) {
      labels.push(match[1]);
    }

    // Remove hashtags from title after extracting them as labels
    title = title.replace(/#[\w-]+/g, '').replace(/\s+/g, ' ').trim();

    return {
      title,
      description,
      craftId: craftBlock.id,
      craftDocumentId: documentId,
      scheduleDate,
      deadline,
      isCompleted,
      completedAt,
      labels,
      lastModifiedCraft: lastModified,
      syncStatus: SyncStatus.PENDING,
    };
  }

  /**
   * Convert Task to Todoist API format
   */
  static toTodoist(task: Task): Partial<TodoistTask> {
    const todoistData: any = {
      content: task.title,
    };

    if (task.description) {
      todoistData.description = task.description;
    }

    if (task.scheduleDate) {
      todoistData.due_string = task.scheduleDate;  // Our 'scheduleDate' → Todoist 'due'
    }

    // Note: Todoist API doesn't support 'deadline' field - removing it
    // if (task.deadline) {
    //   todoistData.deadline = task.deadline;
    // }

    // Use labels field for Todoist labels - sanitize label names
    if (task.labels && task.labels.length > 0) {
      // Todoist labels must be alphanumeric, underscore, or hyphen only
      todoistData.labels = task.labels.map(label => 
        label.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
      );
    }

    if (task.projectId) {
      todoistData.project_id = task.projectId;
    }

    return todoistData;
  }

  /**
   * Convert Task to Craft API format
   */
  static toCraft(task: Task): any {
    // Convert labels to hashtags and append to title
    let markdown = task.title;
    
    if (task.labels && task.labels.length > 0) {
      const hashtags = task.labels.map(label => `#${label}`).join(' ');
      markdown = `${markdown} ${hashtags}`;
    }

    const craftData: any = {
      type: 'text',
      markdown,
      taskInfo: {
        state: task.isCompleted ? 'done' : 'todo',
      },
    };

    // Add schedule date if available
    if (task.scheduleDate) {
      craftData.taskInfo.scheduleDate = task.scheduleDate;  // Our 'scheduleDate' → Craft 'scheduleDate'
    }

    // Add deadline if available
    if (task.deadline) {
      craftData.taskInfo.deadlineDate = task.deadline;      // Our 'deadline' → Craft 'deadlineDate'
    }

    // Add description as content blocks
    if (task.description && task.description.trim()) {
      craftData.content = [
        {
          type: 'text',
          markdown: task.description.trim(),
        },
      ];
    }

    return craftData;
  }

  /**
   * Get the most recent modification time
   */
  static getLatestModificationTime(task: Task): Date | null {
    const times: Date[] = [];

    if (task.lastModifiedTodoist) {
      try {
        times.push(new Date(task.lastModifiedTodoist));
      } catch (e) {
        // Ignore invalid dates
      }
    }

    if (task.lastModifiedCraft) {
      try {
        times.push(new Date(task.lastModifiedCraft));
      } catch (e) {
        // Ignore invalid dates
      }
    }

    return times.length > 0 ? new Date(Math.max(...times.map(d => d.getTime()))) : null;
  }

  /**
   * Check if task needs sync to Todoist
   */
  static needsSyncToTodoist(task: Task): boolean {
    if (!task.craftId) return false;
    if (!task.todoistId) return true; // New task

    // Compare timestamps
    if (!task.lastModifiedTodoist && task.lastModifiedCraft) {
      return true;
    }

    if (task.lastModifiedCraft && task.lastModifiedTodoist) {
      try {
        const craftTime = new Date(task.lastModifiedCraft);
        const todoistTime = new Date(task.lastModifiedTodoist);
        return craftTime > todoistTime;
      } catch (e) {
        return false;
      }
    }

    return false;
  }

  /**
   * Check if task needs sync to Craft
   */
  static needsSyncToCraft(task: Task): boolean {
    if (!task.todoistId) return false;
    if (!task.craftId) return true; // New task

    // Compare timestamps
    if (!task.lastModifiedCraft && task.lastModifiedTodoist) {
      return true;
    }

    if (task.lastModifiedTodoist && task.lastModifiedCraft) {
      try {
        const todoistTime = new Date(task.lastModifiedTodoist);
        const craftTime = new Date(task.lastModifiedCraft);
        return todoistTime > craftTime;
      } catch (e) {
        return false;
      }
    }

    return false;
  }

  /**
   * Check for sync conflict
   */
  static hasConflict(task: Task, conflictWindowSeconds: number = 3): boolean {
    if (!task.lastModifiedTodoist || !task.lastModifiedCraft) {
      return false;
    }

    try {
      const todoistTime = new Date(task.lastModifiedTodoist);
      const craftTime = new Date(task.lastModifiedCraft);

      const timeDiff = Math.abs(todoistTime.getTime() - craftTime.getTime()) / 1000;
      return timeDiff <= conflictWindowSeconds;
    } catch (e) {
      return false;
    }
  }
}
