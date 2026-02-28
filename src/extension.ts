import * as vscode from 'vscode';
import { execSync } from 'child_process';

const BTM_TASK_TYPE = 'btm';

function getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }
  return folders[0];
}

function listBtmTasks(cwd: string): string[] {
  try {
    const out = execSync('task list -a', {
      encoding: 'utf8',
      cwd,
      timeout: 5000,
    });
    const lines = out.split(/\s+/);
    return lines.filter(
      (name) =>
        name.length > 0 &&
        !/^Available$/i.test(name) &&
        !/^Running$/i.test(name)
    );
  } catch {
    return [];
  }
}

class BtmTaskProvider implements vscode.TaskProvider<vscode.Task> {
  constructor(private workspaceFolder: vscode.WorkspaceFolder) {}

  provideTasks(): vscode.Task[] {
    const cwd = this.workspaceFolder.uri.fsPath;
    const names = listBtmTasks(cwd);
    return names.map((taskName) => {
      const task = new vscode.Task(
        { type: BTM_TASK_TYPE, task: taskName },
        this.workspaceFolder,
        taskName,
        'Bash Task Master'
      );
      task.execution = new vscode.ShellExecution(`task ${taskName}`, {
        cwd,
      });
      return task;
    });
  }

  resolveTask(_task: vscode.Task): vscode.Task | undefined {
    return undefined;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const folder = getWorkspaceFolder();
  if (!folder) {
    return;
  }
  const provider = new BtmTaskProvider(folder);
  context.subscriptions.push(
    vscode.tasks.registerTaskProvider(BTM_TASK_TYPE, provider)
  );
}

export function deactivate(): void {}
