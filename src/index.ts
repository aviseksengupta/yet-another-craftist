#!/usr/bin/env node

/**
 * Main entry point for the Craft-Todoist sync system
 */

import * as schedule from 'node-schedule';
import { getConfig, displayConfig } from './config';
import { DatabaseManager } from './database';
import { TodoistIntegration } from './todoist';
import { CraftIntegration } from './craft';
import { SyncEngine } from './syncEngine';

class SyncRunner {
  private db: DatabaseManager;
  private todoist: TodoistIntegration;
  private craft: CraftIntegration;
  private syncEngine: SyncEngine;
  private config: ReturnType<typeof getConfig>;
  private running: boolean = false;
  private scheduleJob?: schedule.Job;

  constructor() {
    // Load configuration
    this.config = getConfig();

    // Initialize components
    console.log('Initializing sync components...');
    this.db = new DatabaseManager(this.config.databasePath);
    this.todoist = new TodoistIntegration(this.config.todoistToken);
    this.craft = new CraftIntegration(this.config.craftApiBaseUrl, 1000); // 1000ms (1 second) delay between requests
    this.syncEngine = new SyncEngine(
      this.db,
      this.todoist,
      this.craft,
      this.config.conflictWindow,
      this.config.showPlanOnly
    );

    console.log('Sync runner initialized successfully');
    displayConfig(this.config);
  }

  /**
   * Initialize async components (must be called before running sync)
   */
  async initialize(): Promise<void> {
    await this.syncEngine.initialize();
  }

  async runOnce(): Promise<void> {
    try {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Starting sync at ${new Date().toISOString()}`);
      console.log('='.repeat(80) + '\n');

      await this.initialize();
      await this.syncEngine.fullSync();

      console.log(`\n${'='.repeat(80)}`);
      console.log(`Sync completed at ${new Date().toISOString()}`);
      console.log('='.repeat(80) + '\n');
    } catch (error) {
      console.error('Sync failed:', error);
      throw error;
    }
  }

  async runContinuous(): Promise<void> {
    console.log(`\nStarting continuous sync (interval: ${this.config.syncInterval}s)`);
    console.log('Press Ctrl+C to stop\n');

    this.running = true;

    // Set up signal handlers for graceful shutdown
    process.on('SIGINT', () => this.handleShutdown());
    process.on('SIGTERM', () => this.handleShutdown());

    // Run first sync immediately
    await this.runOnce();

    // Schedule recurring sync
    const intervalMinutes = Math.floor(this.config.syncInterval / 60);
    const rule = `*/${intervalMinutes} * * * *`; // Every N minutes

    this.scheduleJob = schedule.scheduleJob(rule, async () => {
      if (this.running) {
        await this.runOnce();
      }
    });

    // Keep process alive
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (!this.running) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 1000);
    });
  }

  async showStatus(): Promise<void> {
    console.log('\n' + '='.repeat(80));
    console.log('SYNC STATUS');
    console.log('='.repeat(80));

    // Get task counts
    const allTasks = this.db.getAllTasks();

    const synced = allTasks.filter(t => t.syncStatus === 'synced').length;
    const pending = allTasks.filter(t => t.syncStatus === 'pending').length;
    const conflicts = allTasks.filter(t => t.syncStatus === 'conflict').length;
    const errors = allTasks.filter(t => t.syncStatus === 'error').length;

    const completed = allTasks.filter(t => t.isCompleted).length;
    const active = allTasks.filter(t => !t.isCompleted).length;

    console.log('\nTask Statistics:');
    console.log(`  Total tasks: ${allTasks.length}`);
    console.log(`  Active: ${active}`);
    console.log(`  Completed: ${completed}`);
    console.log('\nSync Status:');
    console.log(`  Synced: ${synced}`);
    console.log(`  Pending: ${pending}`);
    console.log(`  Conflicts: ${conflicts}`);
    console.log(`  Errors: ${errors}`);

    // Show recent logs
    console.log('\nRecent Sync Operations:');
    const recentLogs = this.db.getRecentSyncLogs(10);
    for (const log of recentLogs) {
      const statusIcon = log.status === 'success' ? '✓' : log.status === 'error' ? '✗' : '⚠';
      console.log(`  ${statusIcon} ${log.timestamp} - ${log.operation} (${log.source})`);
    }

    console.log('='.repeat(80) + '\n');
  }

  private handleShutdown(): void {
    console.log('\nReceived shutdown signal, shutting down gracefully...');
    this.running = false;

    if (this.scheduleJob) {
      this.scheduleJob.cancel();
    }

    this.cleanup();
    process.exit(0);
  }

  private cleanup(): void {
    console.log('Cleaning up resources...');
    this.db.close();
    console.log('Shutdown complete');
  }
}

async function main() {
  const command = process.argv[2] || 'once';

  if (!['once', 'continuous', 'status'].includes(command)) {
    console.error('Usage: npm start [once|continuous|status]');
    console.error('  once       - Run a single sync cycle');
    console.error('  continuous - Run continuous sync on schedule');
    console.error('  status     - Show sync status and statistics');
    process.exit(1);
  }

  try {
    const runner = new SyncRunner();

    if (command === 'once') {
      await runner.runOnce();
    } else if (command === 'continuous') {
      await runner.runContinuous();
    } else if (command === 'status') {
      await runner.showStatus();
    }

    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { SyncRunner };
