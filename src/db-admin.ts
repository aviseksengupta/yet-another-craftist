/**
 * Database admin CLI tool
 */

import { DatabaseManager } from './database';
import * as fs from 'fs';

const db = new DatabaseManager();

const command = process.argv[2];
const arg = process.argv[3];

function displayJSON(data: any): void {
  console.log(JSON.stringify(data, null, 2));
}

async function listTasks(projectName?: string): Promise<void> {
  const allTasks = db.getAllTasks();
  
  let tasks = allTasks;
  
  if (projectName) {
    // Get all projects to find the project ID
    const projects = db.getAllProjects();
    const project = projects.find(p => 
      p.name.toLowerCase().includes(projectName.toLowerCase())
    );
    
    if (!project) {
      console.error(`Project not found: ${projectName}`);
      console.error('\nAvailable projects:');
      displayJSON(projects.map(p => ({ id: p.todoistProjectId, name: p.name })));
      process.exit(1);
    }
    
    tasks = allTasks.filter(t => t.projectId === project.todoistProjectId);
  }
  
  const output = tasks.map(t => ({
    id: t.id,
    todoistId: t.todoistId,
    craftId: t.craftId,
    title: t.title,
    description: t.description?.substring(0, 100) + (t.description && t.description.length > 100 ? '...' : ''),
    labels: t.labels,
    projectId: t.projectId,
    craftDocumentId: t.craftDocumentId,
    scheduleDate: t.scheduleDate,
    deadline: t.deadline,
    isCompleted: t.isCompleted,
    syncStatus: t.syncStatus,
  }));
  
  console.log(`\nFound ${output.length} tasks${projectName ? ` in project "${projectName}"` : ''}\n`);
  displayJSON(output);
}

async function listProjects(): Promise<void> {
  const projects = db.getAllProjects();
  
  const output = projects.map(p => ({
    id: p.id,
    todoistProjectId: p.todoistProjectId,
    name: p.name,
    craftFolderId: p.craftFolderId,
    craftDocumentId: p.craftDocumentId,
    parentProjectId: p.parentProjectId,
    isLeaf: p.isLeaf,
    hasTasks: p.hasTasks,
  }));
  
  console.log(`\nFound ${output.length} projects\n`);
  displayJSON(output);
}

async function listTasksByDocument(documentName?: string): Promise<void> {
  const allTasks = db.getAllTasks();
  
  if (!documentName) {
    // Show all unique document IDs
    const uniqueDocIds = new Set<string>();
    allTasks.forEach(t => {
      if (t.craftDocumentId) uniqueDocIds.add(t.craftDocumentId);
    });
    
    console.log(`\nFound ${uniqueDocIds.size} unique Craft documents with tasks\n`);
    displayJSON(Array.from(uniqueDocIds).map(id => ({ craftDocumentId: id })));
    return;
  }
  
  // Filter by document name/ID (partial match)
  const tasks = allTasks.filter(t => 
    t.craftDocumentId && t.craftDocumentId.toLowerCase().includes(documentName.toLowerCase())
  );
  
  if (tasks.length === 0) {
    console.error(`No tasks found in document matching: ${documentName}`);
    process.exit(1);
  }
  
  const output = tasks.map(t => ({
    id: t.id,
    todoistId: t.todoistId,
    craftId: t.craftId,
    title: t.title,
    labels: t.labels,
    craftDocumentId: t.craftDocumentId,
    projectId: t.projectId,
    isCompleted: t.isCompleted,
  }));
  
  console.log(`\nFound ${output.length} tasks in document "${documentName}"\n`);
  displayJSON(output);
}

async function deleteTasksByProject(projectName: string): Promise<void> {
  if (!projectName) {
    console.error('Error: Project name is required');
    process.exit(1);
  }
  
  // Get all projects to find the project ID
  const projects = db.getAllProjects();
  const project = projects.find(p => 
    p.name.toLowerCase().includes(projectName.toLowerCase())
  );
  
  if (!project) {
    console.error(`Project not found: ${projectName}`);
    console.error('\nAvailable projects:');
    displayJSON(projects.map(p => ({ id: p.todoistProjectId, name: p.name })));
    process.exit(1);
  }
  
  // Get tasks for this project
  const allTasks = db.getAllTasks();
  const tasksToDelete = allTasks.filter(t => t.projectId === project.todoistProjectId);
  
  if (tasksToDelete.length === 0) {
    console.log(`No tasks found in project "${project.name}"`);
    return;
  }
  
  console.log(`\nFound ${tasksToDelete.length} tasks in project "${project.name}":`);
  displayJSON(tasksToDelete.map(t => ({ id: t.id, title: t.title })));
  
  // Delete tasks (using prepared statement for safety)
  const deleteStmt = (db as any).db.prepare('DELETE FROM tasks WHERE project_id = ?');
  const result = deleteStmt.run(project.todoistProjectId);
  
  console.log(`\n✓ Deleted ${result.changes} tasks from project "${project.name}"`);
}

async function main(): Promise<void> {
  try {
    switch (command) {
      case 'tasks':
        await listTasks(arg);
        break;
      
      case 'projects':
        await listProjects();
        break;
      
      case 'documents':
        await listTasksByDocument(arg);
        break;
      
      case 'delete-project':
        await deleteTasksByProject(arg);
        break;
      
      default:
        console.error('Unknown command:', command);
        console.error('\nAvailable commands:');
        console.error('  tasks [project_name]     - List all tasks or filter by project');
        console.error('  projects                 - List all projects');
        console.error('  documents [doc_name]     - List tasks by Craft document');
        console.error('  delete-project <project> - Delete all tasks from a project');
        process.exit(1);
    }
    
    db.close();
  } catch (error) {
    console.error('Error:', error);
    db.close();
    process.exit(1);
  }
}

main();
