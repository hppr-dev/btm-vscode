import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as path from 'path';
import * as os from 'os';

const BTM_TASK_TYPE = 'btm';

function getBtmHome(): string {
  const setting = vscode.workspace.getConfiguration('btm').get<string>('taskMasterHome');
  if (setting !== undefined && setting !== null && setting.trim() !== '') {
    const expanded = setting.trim().replace(/^~($|\/)/, `${os.homedir()}$1`);
    return path.normalize(expanded);
  }
  return process.env.TASK_MASTER_HOME || os.homedir();
}

function runBtmInCwd(cwd: string, taskArgs: string): string {
  const btmHome = getBtmHome();
  const runnerPath = path.join(btmHome, 'task-runner.sh');
  const cmd = `source ${JSON.stringify(runnerPath)} && task ${taskArgs}`;
  return execSync(`bash -c ${JSON.stringify(cmd)}`, {
    encoding: 'utf8',
    cwd,
    timeout: 5000,
    env: { ...process.env, TASK_MASTER_HOME: btmHome },
  });
}

function listBtmTasks(cwd: string): string[] {
  const out = runBtmInCwd(cwd, '+s list --json');
  const trimmed = out.trim();
  if (trimmed.startsWith('[')) {
    const arr = JSON.parse(trimmed) as string[];
    return Array.isArray(arr) ? arr.filter((name) => typeof name === 'string' && name.length > 0) : [];
  }
  console.error(`Failed to parse BTM tasks list as JSON: ${trimmed}`);
  return [];
}

function listBtmTasksGlobal(cwd: string): string[] {
  try {
    const out = runBtmInCwd(cwd, '+s list --global --json');
    const trimmed = out.trim();
    if (trimmed.startsWith('[')) {
      const arr = JSON.parse(trimmed) as string[];
      return Array.isArray(arr) ? arr.filter((name) => typeof name === 'string' && name.length > 0) : [];
    }
    return [];
  } catch {
    return [];
  }
}

function listBtmModules(cwd: string): string[] {
  try {
    const out = runBtmInCwd(cwd, 'list --modules --json');
    const trimmed = out.trim();
    if (trimmed.startsWith('[')) {
      const arr = JSON.parse(trimmed) as string[];
      return Array.isArray(arr) ? arr.filter((name) => typeof name === 'string' && name.length > 0) : [];
    }
    const lines = trimmed.split(/\n/).map((s) => s.trim()).filter((s) => s.length > 0);
    return lines;
  } catch {
    return [];
  }
}

export type BtmArg = { long: string; short: string; type: string };
export type BtmSubcommand = { name: string; description: string; required: BtmArg[]; optional: BtmArg[] };
export type BtmTaskHelp = {
  description: string;
  required: BtmArg[];
  optional: BtmArg[];
  subcommands: BtmSubcommand[];
};

function parseBtmHelpJson(json: string): BtmTaskHelp | null {
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    if (!o || typeof o !== 'object') return null;
    const description = typeof o.description === 'string' ? o.description : '';
    const required = Array.isArray(o.required) ? (o.required as BtmArg[]).filter(isBtmArg) : [];
    const optional = Array.isArray(o.optional) ? (o.optional as BtmArg[]).filter(isBtmArg) : [];
    const subcommands = Array.isArray(o.subcommands) ? (o.subcommands as BtmSubcommand[]).filter(isBtmSubcommand) : [];
    return { description, required, optional, subcommands };
  } catch {
    return null;
  }
}
function isBtmArg(x: unknown): x is BtmArg {
  return typeof x === 'object' && x !== null && 'long' in x && typeof (x as BtmArg).long === 'string';
}
function isBtmSubcommand(x: unknown): x is BtmSubcommand {
  return (
    typeof x === 'object' &&
    x !== null &&
    'name' in x &&
    typeof (x as BtmSubcommand).name === 'string' &&
    Array.isArray((x as BtmSubcommand).required) &&
    Array.isArray((x as BtmSubcommand).optional)
  );
}

type BtmTaskHelpText = { description: string; required: string[]; optional: string[]; subcommands: string[] };
function parseBtmTaskHelpText(output: string): BtmTaskHelpText {
  const result: BtmTaskHelpText = { description: '', required: [], optional: [], subcommands: [] };
  const lines = output.split(/\n/);
  let section: 'description' | 'required' | 'optional' | null = null;
  for (const line of lines) {
    if (/^Command: task /.test(line)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4) result.subcommands.push(parts[3]);
      section = 'description';
      continue;
    }
    if (line.startsWith('  Required:')) { section = 'required'; continue; }
    if (line.startsWith('  Optional:')) { section = 'optional'; continue; }
    if (section === 'description' && line.startsWith('  ') && !line.startsWith('    ')) {
      const desc = line.replace(/^\s+/, '').trim();
      if (desc && desc !== 'Required:' && desc !== 'Optional:') result.description = desc;
      continue;
    }
    if (section === 'required' && line.startsWith('    ')) result.required.push(line.replace(/^\s+/, '').trim());
    if (section === 'optional' && line.startsWith('    ')) result.optional.push(line.replace(/^\s+/, '').trim());
    if (line.trim() === '') section = null;
  }
  return result;
}
function helpTextToStructured(text: BtmTaskHelpText): BtmTaskHelp {
  const toArg = (s: string): BtmArg => {
    const m = s.match(/--([^\s,]+)(?:\s*,\s*-(\S+))?(?:\s+(\S+))?/);
    if (m) return { long: '--' + m[1], short: m[2] ? '-' + m[2] : '', type: m[3] ?? '' };
    return { long: s, short: '', type: '' };
  };
  return {
    description: text.description,
    required: text.required.map(toArg),
    optional: text.optional.map(toArg),
    subcommands: text.subcommands.map((name) => ({ name, description: '', required: [], optional: [] })),
  };
}

function formatArgForTooltip(a: BtmArg): string {
  return a.type === 'bool' ? `${a.long}${a.short ? `, ${a.short}` : ''}` : `${a.long}${a.short ? `, ${a.short}` : ''} (${a.type})`;
}

function buildTaskTooltip(help: BtmTaskHelp | null): string {
  if (!help) return 'No description provided.';
  const parts: string[] = [];
  const desc = help.description?.trim();
  parts.push(desc ? desc : 'No description provided.');
  if (help.required.length > 0) parts.push('Required: ' + help.required.map(formatArgForTooltip).join(', '));
  if (help.optional.length > 0) parts.push('Optional: ' + help.optional.map(formatArgForTooltip).join(', '));
  return parts.join('\n\n');
}

function buildSubcommandTooltip(sub: BtmSubcommand): string {
  const parts: string[] = [];
  parts.push(sub.description?.trim() ? sub.description.trim() : 'No description provided.');
  if (sub.required.length > 0) parts.push('Required: ' + sub.required.map(formatArgForTooltip).join(', '));
  if (sub.optional.length > 0) parts.push('Optional: ' + sub.optional.map(formatArgForTooltip).join(', '));
  return parts.join('\n\n');
}

const DOUBLE_CLICK_MS = 400;
let _lastClickKey: string | null = null;
let _lastClickTime = 0;

function getRunNodeKey(node: BtmTaskNode | BtmSubcommandNode): string {
  const g = node.isGlobal ? '1' : '0';
  const m = node.isModule ? '1' : '0';
  const cwd = node.btmCwd;
  const folder = node.folder.uri.fsPath;
  if (node.kind === 'task') return `task:${g}:${m}:${cwd}:${folder}:${node.taskName}`;
  return `sub:${g}:${m}:${cwd}:${folder}:${node.taskName}:${node.subcommandName}`;
}

function shouldRunOnClick(node: BtmTaskNode | BtmSubcommandNode): boolean {
  const key = getRunNodeKey(node);
  const now = Date.now();
  if (_lastClickKey === key && now - _lastClickTime < DOUBLE_CLICK_MS) {
    _lastClickKey = null;
    return true;
  }
  _lastClickKey = key;
  _lastClickTime = now;
  return false;
}

function getBtmTaskHelp(cwd: string, taskName: string): BtmTaskHelp | null {
  try {
    const out = runBtmInCwd(cwd, `+s help ${JSON.stringify(taskName)} --json`);
    const trimmed = out.trim();
    if (trimmed.startsWith('{')) {
      const help = parseBtmHelpJson(trimmed);
      if (help) return help;
    }
    const text = parseBtmTaskHelpText(out);
    return helpTextToStructured(text);
  } catch {
    return null;
  }
}

const TASKS_FILE_GLOBS = ['**/.tasks.sh', '**/tasks.sh'];
const BTM_TERMINAL_NAME = 'BTM';

let _btmTerminalSourced = false;

function useDedicatedTerminal(): boolean {
  return vscode.workspace.getConfiguration('btm').get<boolean>('useDedicatedTerminal') ?? true;
}

function isTaskMasterHomeCustom(): boolean {
  const setting = vscode.workspace.getConfiguration('btm').get<string>('taskMasterHome');
  return setting !== undefined && setting !== null && setting.trim() !== '';
}

function getWorkspaceHome(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders[0].uri.fsPath;
  }
  return os.homedir();
}

function isCwdOutsideProject(cwd: string, workspaceHome: string): boolean {
  const resolvedCwd = path.resolve(cwd);
  const resolvedHome = path.resolve(workspaceHome);
  return resolvedCwd !== resolvedHome && !resolvedCwd.startsWith(resolvedHome + path.sep);
}

function buildBtmTerminalCommand(
  taskName: string,
  opts?: { subcommand?: string; args?: string[] }
): string {
  let cmd = `task ${JSON.stringify(taskName)}`;
  if (opts?.subcommand) cmd += ` ${JSON.stringify(opts.subcommand)}`;
  if (opts?.args && opts.args.length > 0) cmd += ' ' + opts.args.map((a) => JSON.stringify(a)).join(' ');
  return cmd;
}

function getOrCreateBtmTerminal(workspaceHome: string): vscode.Terminal {
  const btmHome = getBtmHome();
  const existing = vscode.window.terminals.find((t) => t.name === BTM_TERMINAL_NAME);
  if (existing) return existing;
  const terminal = vscode.window.createTerminal({
    name: BTM_TERMINAL_NAME,
    cwd: workspaceHome,
    env: { ...process.env, TASK_MASTER_HOME: btmHome },
  });
  terminal.show();
  return terminal;
}

function runInDedicatedTerminal(
  taskName: string,
  cwd: string,
  workspaceHome: string,
  opts?: { subcommand?: string; args?: string[] }
): void {
  const terminal = getOrCreateBtmTerminal(workspaceHome);
  if (isTaskMasterHomeCustom() && !_btmTerminalSourced) {
    const btmHome = getBtmHome();
    const runnerPath = path.join(btmHome, 'task-runner.sh');
    terminal.sendText(`source ${JSON.stringify(runnerPath)}`);
    _btmTerminalSourced = true;
  }
  const cmd = buildBtmTerminalCommand(taskName, opts);
  const needCd = isCwdOutsideProject(cwd, workspaceHome);
  const fullCmd = needCd ? `cd ${JSON.stringify(workspaceHome)} && ${cmd}` : cmd;
  terminal.sendText(fullCmd);
}

function createBtmShellExecution(
  taskName: string,
  cwd: string,
  opts?: { subcommand?: string; args?: string[] }
): vscode.ShellExecution {
  const btmHome = getBtmHome();
  const runnerPath = path.join(btmHome, 'task-runner.sh');
  let cmd = `task ${JSON.stringify(taskName)}`;
  if (opts?.subcommand) cmd += ` ${JSON.stringify(opts.subcommand)}`;
  if (opts?.args && opts.args.length > 0) cmd += ' ' + opts.args.map((a) => JSON.stringify(a)).join(' ');
  const innerScript = `source ${JSON.stringify(runnerPath)} && ${cmd}`;
  return new vscode.ShellExecution('bash', ['-c', innerScript], {
    cwd,
    env: { ...process.env, TASK_MASTER_HOME: btmHome },
  });
}

async function getBtmCwdForFolder(
  folder: vscode.WorkspaceFolder
): Promise<string> {
  for (const glob of TASKS_FILE_GLOBS) {
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, glob),
      null,
      1
    );
    if (files.length > 0) {
      return path.dirname(files[0].fsPath);
    }
  }
  return folder.uri.fsPath;
}

type BtmFolderNode = {
  kind: 'folder';
  folder: vscode.WorkspaceFolder;
  btmCwd: string;
};

type BtmTaskNode = {
  kind: 'task';
  taskName: string;
  btmCwd: string;
  folder: vscode.WorkspaceFolder;
  isGlobal?: boolean;
  isModule?: boolean;
};

type BtmGlobalRootNode = {
  kind: 'globalRoot';
  btmCwd: string;
  folder: vscode.WorkspaceFolder;
};

type BtmModulesRootNode = {
  kind: 'modulesRoot';
  btmCwd: string;
  folder: vscode.WorkspaceFolder;
};

type BtmTaskInfoSectionNode = {
  kind: 'taskInfoSection';
  section: 'description' | 'required' | 'optional' | 'subcommands';
  label: string;
  content: string;
};

type BtmSubcommandNode = {
  kind: 'subcommand';
  taskName: string;
  subcommandName: string;
  subcommand: BtmSubcommand;
  btmCwd: string;
  folder: vscode.WorkspaceFolder;
  isGlobal?: boolean;
  isModule?: boolean;
};

type BtmTreeNode = BtmFolderNode | BtmTaskNode | BtmTaskInfoSectionNode | BtmSubcommandNode | BtmGlobalRootNode | BtmModulesRootNode;

class BtmTasksTreeProvider implements vscode.TreeDataProvider<BtmTreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getChildren(element?: BtmTreeNode): BtmTreeNode[] | Thenable<BtmTreeNode[]> {
    if (!element) {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) return [];
      return Promise.all(
        folders.map(async (folder) => {
          const btmCwd = await getBtmCwdForFolder(folder);
          return { kind: 'folder' as const, folder, btmCwd };
        })
      ).then(async (nodes) => {
        const folderNodes = nodes.filter((n) => listBtmTasks(n.btmCwd).length > 0);
        const workspaceCwd = nodes[0]?.btmCwd ?? folders![0].uri.fsPath;
        const moduleNames = listBtmModules(workspaceCwd);
        const globalNames = listBtmTasksGlobal(workspaceCwd);
        const result: BtmTreeNode[] = [];
        if (moduleNames.length > 0) {
          result.push({
            kind: 'modulesRoot',
            btmCwd: workspaceCwd,
            folder: folders![0],
          });
        }
        result.push(...folderNodes);
        if (globalNames.length > 0) {
          result.push({
            kind: 'globalRoot',
            btmCwd: workspaceCwd,
            folder: folders![0],
          });
        }
        return result;
      });
    }
    if (element.kind === 'modulesRoot') {
      const names = listBtmModules(element.btmCwd);
      return names.map((taskName) => ({
        kind: 'task' as const,
        taskName,
        btmCwd: element.btmCwd,
        folder: element.folder,
        isModule: true,
      }));
    }
    if (element.kind === 'globalRoot') {
      const names = listBtmTasksGlobal(element.btmCwd);
      return names.map((taskName) => ({
        kind: 'task' as const,
        taskName,
        btmCwd: element.btmCwd,
        folder: element.folder,
        isGlobal: true,
      }));
    }
    if (element.kind === 'folder') {
      const names = listBtmTasks(element.btmCwd);
      return names.map((taskName) => ({
        kind: 'task' as const,
        taskName,
        btmCwd: element.btmCwd,
        folder: element.folder,
      }));
    }
    if (element.kind === 'task') {
      const help = getBtmTaskHelp(element.btmCwd, element.taskName);
      if (!help) return [];
      if (help.subcommands.length > 0) {
        return help.subcommands.map((sub) => ({
          kind: 'subcommand' as const,
          taskName: element.taskName,
          subcommandName: sub.name,
          subcommand: sub,
          btmCwd: element.btmCwd,
          folder: element.folder,
          isGlobal: element.isGlobal,
          isModule: element.isModule,
        }));
      }
      if (element.isGlobal || element.isModule) return [];
      const sections: BtmTaskInfoSectionNode[] = [];
      const formatArg = (a: BtmArg): string =>
        a.type === 'bool' ? `${a.long}${a.short ? `, ${a.short}` : ''}` : `${a.long}${a.short ? `, ${a.short}` : ''} (${a.type})`;
      if (help.description) {
        sections.push({ kind: 'taskInfoSection', section: 'description', label: 'Description', content: help.description });
      }
      if (help.required.length > 0) {
        sections.push({
          kind: 'taskInfoSection',
          section: 'required',
          label: 'Required',
          content: help.required.map(formatArg).join('\n'),
        });
      }
      if (help.optional.length > 0) {
        sections.push({
          kind: 'taskInfoSection',
          section: 'optional',
          label: 'Optional',
          content: help.optional.map(formatArg).join('\n'),
        });
      }
      return sections;
    }
    return [];
  }

  getTreeItem(element: BtmTreeNode): vscode.TreeItem {
    if (element.kind === 'folder') {
      const item = new vscode.TreeItem(
        element.folder.name,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.contextValue = 'btm-folder';
      item.iconPath = new vscode.ThemeIcon('folder');
      return item;
    }
    if (element.kind === 'globalRoot') {
      const item = new vscode.TreeItem(
        'Global',
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.contextValue = 'btm-global-root';
      item.iconPath = new vscode.ThemeIcon('folder');
      return item;
    }
    if (element.kind === 'modulesRoot') {
      const item = new vscode.TreeItem(
        'Modules',
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.contextValue = 'btm-modules-root';
      item.iconPath = new vscode.ThemeIcon('folder');
      return item;
    }
    if (element.kind === 'task') {
      const help = getBtmTaskHelp(element.btmCwd, element.taskName);
      const hasSubcommands = (help?.subcommands.length ?? 0) > 0;
      const item = new vscode.TreeItem(
        element.taskName,
        hasSubcommands ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
      );
      item.contextValue = element.isGlobal ? 'btm-global-task' : element.isModule ? 'btm-module-task' : 'btm-task';
      item.iconPath = new vscode.ThemeIcon('symbol-method');
      item.command = element.isGlobal
        ? { command: 'btm.runGlobalTaskFromTreeClick', arguments: [element], title: 'Run' }
        : element.isModule
          ? { command: 'btm.runModuleTaskFromTreeClick', arguments: [element], title: 'Run' }
          : { command: 'btm.runTaskFromTreeClick', arguments: [element], title: 'Run' };
      item.tooltip = buildTaskTooltip(help);
      return item;
    }
    if (element.kind === 'subcommand') {
      const item = new vscode.TreeItem(
        `${element.taskName} ${element.subcommandName}`,
        vscode.TreeItemCollapsibleState.None
      );
      item.contextValue = element.isGlobal ? 'btm-global-subcommand' : element.isModule ? 'btm-module-subcommand' : 'btm-subcommand';
      item.iconPath = new vscode.ThemeIcon('play');
      item.command = element.isGlobal
        ? { command: 'btm.runGlobalSubcommandFromTreeClick', arguments: [element], title: 'Run' }
        : element.isModule
          ? { command: 'btm.runModuleSubcommandFromTreeClick', arguments: [element], title: 'Run' }
          : { command: 'btm.runSubcommandFromTreeClick', arguments: [element], title: 'Run' };
      item.tooltip = buildSubcommandTooltip(element.subcommand);
      return item;
    }
    const sectionItem = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None
    );
    sectionItem.description = element.content.split(/\n/)[0]?.slice(0, 60) ?? '';
    sectionItem.tooltip = element.content;
    sectionItem.iconPath = new vscode.ThemeIcon('info');
    return sectionItem;
  }
}

async function promptRequiredArgs(required: BtmArg[]): Promise<string[] | undefined> {
  const flatArgs: string[] = [];
  for (const arg of required) {
    const val = await vscode.window.showInputBox({ prompt: `Required: ${arg.long}`, placeHolder: arg.type });
    if (val === undefined) return undefined;
    flatArgs.push(arg.long, val);
  }
  return flatArgs;
}

async function promptOptionalArgs(optional: BtmArg[]): Promise<string[]> {
  const flatArgs: string[] = [];
  const optionalDone = { label: 'Done', description: 'No more optional arguments' };
  while (optional.length > 0) {
    const optPick = await vscode.window.showQuickPick(
      [optionalDone, ...optional.map((a) => ({ label: a.long, description: a.type === 'bool' ? 'flag' : a.type }))],
      { placeHolder: 'Add optional argument?' }
    );
    if (optPick === undefined) return flatArgs;
    if (optPick.label === 'Done') break;
    const arg = optional.find((a) => a.long === optPick!.label);
    if (!arg) continue;
    if (arg.type === 'bool') {
      flatArgs.push(arg.long);
    } else {
      const val = await vscode.window.showInputBox({ prompt: `Value for ${arg.long}`, placeHolder: arg.type });
      if (val === undefined) return flatArgs;
      flatArgs.push(arg.long, val);
    }
  }
  return flatArgs;
}

async function runBtmTaskNoSubcommand(
  taskName: string,
  cwd: string,
  folder: vscode.WorkspaceFolder,
  opts: { withOptionalArgs: boolean }
): Promise<void> {
  const help = getBtmTaskHelp(cwd, taskName);
  const required = help?.required ?? [];
  const optional = opts.withOptionalArgs ? (help?.optional ?? []) : [];
  const requiredArgs = await promptRequiredArgs(required);
  if (requiredArgs === undefined) return;
  const optionalArgs = await promptOptionalArgs(optional);
  const flatArgs = [...requiredArgs, ...optionalArgs];

  if (useDedicatedTerminal()) {
    runInDedicatedTerminal(taskName, cwd, folder.uri.fsPath, {
      args: flatArgs.length > 0 ? flatArgs : undefined,
    });
    return;
  }

  const task = new vscode.Task(
    { type: BTM_TASK_TYPE, task: taskName },
    folder,
    taskName,
    'Bash Task Master'
  );
  task.execution = createBtmShellExecution(taskName, cwd, {
    args: flatArgs.length > 0 ? flatArgs : undefined,
  });
  await vscode.tasks.executeTask(task);
}

async function runBtmTaskNoSubcommandGlobal(
  taskName: string,
  cwd: string,
  opts: { withOptionalArgs: boolean }
): Promise<void> {
  const help = getBtmTaskHelp(cwd, taskName);
  const required = help?.required ?? [];
  const optional = opts.withOptionalArgs ? (help?.optional ?? []) : [];
  const requiredArgs = await promptRequiredArgs(required);
  if (requiredArgs === undefined) return;
  const optionalArgs = await promptOptionalArgs(optional);
  const flatArgs = [...requiredArgs, ...optionalArgs];

  if (useDedicatedTerminal()) {
    const workspaceHome = getWorkspaceHome();
    runInDedicatedTerminal(taskName, cwd, workspaceHome, {
      args: flatArgs.length > 0 ? flatArgs : undefined,
    });
    return;
  }

  const task = new vscode.Task(
    { type: BTM_TASK_TYPE, task: taskName },
    vscode.TaskScope.Global,
    taskName,
    'Bash Task Master'
  );
  task.execution = createBtmShellExecution(taskName, cwd, {
    args: flatArgs.length > 0 ? flatArgs : undefined,
  });
  await vscode.tasks.executeTask(task);
}

async function runBtmTask(
  taskName: string,
  cwd: string,
  folder: vscode.WorkspaceFolder,
  opts?: { subcommand?: string; withOptionalArgs?: boolean }
): Promise<void> {
  const help = getBtmTaskHelp(cwd, taskName);
  let required: BtmArg[] = [];
  let optional: BtmArg[] = [];
  const withOptionalArgs = opts?.withOptionalArgs ?? true;

  if (help) {
    if (opts?.subcommand !== undefined) {
      const sub = help.subcommands.find((s) => s.name === opts!.subcommand);
      if (sub) {
        required = sub.required;
        optional = sub.optional;
      }
    } else {
      required = help.required;
      optional = withOptionalArgs ? help.optional : [];
    }
  }

  const requiredArgs = await promptRequiredArgs(required);
  if (requiredArgs === undefined) return;
  const optionalArgs = await promptOptionalArgs(optional);
  const flatArgs = [...requiredArgs, ...optionalArgs];

  if (useDedicatedTerminal()) {
    runInDedicatedTerminal(taskName, cwd, folder.uri.fsPath, {
      subcommand: opts?.subcommand,
      args: flatArgs.length > 0 ? flatArgs : undefined,
    });
    return;
  }

  const task = new vscode.Task(
    { type: BTM_TASK_TYPE, task: taskName },
    folder,
    opts?.subcommand ? `${taskName} ${opts.subcommand}` : taskName,
    'Bash Task Master'
  );
  task.execution = createBtmShellExecution(taskName, cwd, {
    subcommand: opts?.subcommand,
    args: flatArgs.length > 0 ? flatArgs : undefined,
  });
  await vscode.tasks.executeTask(task);
}

async function runBtmTaskGlobal(
  taskName: string,
  cwd: string,
  opts?: { subcommand?: string; withOptionalArgs?: boolean }
): Promise<void> {
  const help = getBtmTaskHelp(cwd, taskName);
  let required: BtmArg[] = [];
  let optional: BtmArg[] = [];
  const withOptionalArgs = opts?.withOptionalArgs ?? true;

  if (help) {
    if (opts?.subcommand !== undefined) {
      const sub = help.subcommands.find((s) => s.name === opts!.subcommand);
      if (sub) {
        required = sub.required;
        optional = sub.optional;
      }
    } else {
      required = help.required;
      optional = withOptionalArgs ? help.optional : [];
    }
  }

  const requiredArgs = await promptRequiredArgs(required);
  if (requiredArgs === undefined) return;
  const optionalArgs = await promptOptionalArgs(optional);
  const flatArgs = [...requiredArgs, ...optionalArgs];

  if (useDedicatedTerminal()) {
    const workspaceHome = getWorkspaceHome();
    runInDedicatedTerminal(taskName, cwd, workspaceHome, {
      subcommand: opts?.subcommand,
      args: flatArgs.length > 0 ? flatArgs : undefined,
    });
    return;
  }

  const task = new vscode.Task(
    { type: BTM_TASK_TYPE, task: taskName },
    vscode.TaskScope.Global,
    opts?.subcommand ? `${taskName} ${opts.subcommand}` : taskName,
    'Bash Task Master'
  );
  task.execution = createBtmShellExecution(taskName, cwd, {
    subcommand: opts?.subcommand,
    args: flatArgs.length > 0 ? flatArgs : undefined,
  });
  await vscode.tasks.executeTask(task);
}

async function runBtmSubcommandFromTree(
  node: BtmSubcommandNode,
  opts?: { withOptionalArgs?: boolean }
): Promise<void> {
  const { required, optional } = node.subcommand;
  const requiredArgs = await promptRequiredArgs(required);
  if (requiredArgs === undefined) return;
  const optionalArgs = opts?.withOptionalArgs ? await promptOptionalArgs(optional) : [];
  const flatArgs = [...requiredArgs, ...optionalArgs];

  if (useDedicatedTerminal()) {
    const workspaceHome = (node.isGlobal || node.isModule) ? getWorkspaceHome() : node.folder.uri.fsPath;
    runInDedicatedTerminal(node.taskName, node.btmCwd, workspaceHome, {
      subcommand: node.subcommandName,
      args: flatArgs.length > 0 ? flatArgs : undefined,
    });
    return;
  }

  const scope = (node.isGlobal || node.isModule) ? vscode.TaskScope.Global : node.folder;
  const task = new vscode.Task(
    { type: BTM_TASK_TYPE, task: node.taskName },
    scope,
    `${node.taskName} ${node.subcommandName}`,
    'Bash Task Master'
  );
  task.execution = createBtmShellExecution(node.taskName, node.btmCwd, {
    subcommand: node.subcommandName,
    args: flatArgs.length > 0 ? flatArgs : undefined,
  });
  await vscode.tasks.executeTask(task);
}

class BtmTaskProvider implements vscode.TaskProvider<vscode.Task> {
  provideTasks(): vscode.Task[] | Thenable<vscode.Task[]> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return [];
    }
    return Promise.all(
      folders.map(async (workspaceFolder) => {
        const btmCwd = await getBtmCwdForFolder(workspaceFolder);
        const names = listBtmTasks(btmCwd);
        return names.map((taskName) => {
          const task = new vscode.Task(
            { type: BTM_TASK_TYPE, task: taskName },
            workspaceFolder,
            taskName,
            'Bash Task Master'
          );
          task.execution = createBtmShellExecution(taskName, btmCwd);
          return task;
        });
      })
    ).then((arrays) => arrays.flat());
  }

  resolveTask(_task: vscode.Task): vscode.Task | undefined {
    return undefined;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const taskProvider = new BtmTaskProvider();
  context.subscriptions.push(
    vscode.tasks.registerTaskProvider(BTM_TASK_TYPE, taskProvider)
  );

  const treeProvider = new BtmTasksTreeProvider();
  context.subscriptions.push(
    vscode.window.createTreeView('btm.tasks', {
      treeDataProvider: treeProvider,
      showCollapseAll: true,
    })
  );

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((t) => {
      if (t.name === BTM_TERMINAL_NAME) _btmTerminalSourced = false;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('btm.refresh', () => treeProvider.refresh())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runTaskFromTree', (node: BtmTaskNode) => {
      if (node?.kind === 'task') void runBtmTaskNoSubcommand(node.taskName, node.btmCwd, node.folder, { withOptionalArgs: false });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runTaskFromTreeClick', (node: BtmTaskNode) => {
      if (node?.kind === 'task' && shouldRunOnClick(node)) void runBtmTaskNoSubcommand(node.taskName, node.btmCwd, node.folder, { withOptionalArgs: false });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runTaskFromTreeWithArgs', (node: BtmTaskNode) => {
      if (node?.kind === 'task') void runBtmTaskNoSubcommand(node.taskName, node.btmCwd, node.folder, { withOptionalArgs: true });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runTaskFromTreeWithArgsClick', (node: BtmTaskNode) => {
      if (node?.kind === 'task' && shouldRunOnClick(node)) void runBtmTaskNoSubcommand(node.taskName, node.btmCwd, node.folder, { withOptionalArgs: true });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runSubcommandFromTree', (node: BtmSubcommandNode) => {
      if (node?.kind === 'subcommand') void runBtmSubcommandFromTree(node, { withOptionalArgs: false });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runSubcommandFromTreeClick', (node: BtmSubcommandNode) => {
      if (node?.kind === 'subcommand' && shouldRunOnClick(node)) void runBtmSubcommandFromTree(node, { withOptionalArgs: false });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runSubcommandFromTreeWithArgs', (node: BtmSubcommandNode) => {
      if (node?.kind === 'subcommand') void runBtmSubcommandFromTree(node, { withOptionalArgs: true });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runSubcommandFromTreeWithArgsClick', (node: BtmSubcommandNode) => {
      if (node?.kind === 'subcommand' && shouldRunOnClick(node)) void runBtmSubcommandFromTree(node, { withOptionalArgs: true });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runGlobalTaskFromTree', (node: BtmTaskNode) => {
      if (node?.kind === 'task' && node?.isGlobal) void runBtmTaskNoSubcommandGlobal(node.taskName, node.btmCwd, { withOptionalArgs: false });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runGlobalTaskFromTreeClick', (node: BtmTaskNode) => {
      if (node?.kind === 'task' && node?.isGlobal && shouldRunOnClick(node)) void runBtmTaskNoSubcommandGlobal(node.taskName, node.btmCwd, { withOptionalArgs: false });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runGlobalTaskFromTreeWithArgs', (node: BtmTaskNode) => {
      if (node?.kind === 'task' && node?.isGlobal) void runBtmTaskNoSubcommandGlobal(node.taskName, node.btmCwd, { withOptionalArgs: true });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runGlobalTaskFromTreeWithArgsClick', (node: BtmTaskNode) => {
      if (node?.kind === 'task' && node?.isGlobal && shouldRunOnClick(node)) void runBtmTaskNoSubcommandGlobal(node.taskName, node.btmCwd, { withOptionalArgs: true });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runGlobalSubcommandFromTree', (node: BtmSubcommandNode) => {
      if (node?.kind === 'subcommand' && node?.isGlobal) void runBtmSubcommandFromTree(node, { withOptionalArgs: false });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runGlobalSubcommandFromTreeClick', (node: BtmSubcommandNode) => {
      if (node?.kind === 'subcommand' && node?.isGlobal && shouldRunOnClick(node)) void runBtmSubcommandFromTree(node, { withOptionalArgs: false });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runGlobalSubcommandFromTreeWithArgs', (node: BtmSubcommandNode) => {
      if (node?.kind === 'subcommand' && node?.isGlobal) void runBtmSubcommandFromTree(node, { withOptionalArgs: true });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runGlobalSubcommandFromTreeWithArgsClick', (node: BtmSubcommandNode) => {
      if (node?.kind === 'subcommand' && node?.isGlobal && shouldRunOnClick(node)) void runBtmSubcommandFromTree(node, { withOptionalArgs: true });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runModuleTaskFromTree', (node: BtmTaskNode) => {
      if (node?.kind === 'task' && node?.isModule) void runBtmTaskNoSubcommandGlobal(node.taskName, node.btmCwd, { withOptionalArgs: false });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runModuleTaskFromTreeClick', (node: BtmTaskNode) => {
      if (node?.kind === 'task' && node?.isModule && shouldRunOnClick(node)) void runBtmTaskNoSubcommandGlobal(node.taskName, node.btmCwd, { withOptionalArgs: false });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runModuleTaskFromTreeWithArgs', (node: BtmTaskNode) => {
      if (node?.kind === 'task' && node?.isModule) void runBtmTaskNoSubcommandGlobal(node.taskName, node.btmCwd, { withOptionalArgs: true });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runModuleTaskFromTreeWithArgsClick', (node: BtmTaskNode) => {
      if (node?.kind === 'task' && node?.isModule && shouldRunOnClick(node)) void runBtmTaskNoSubcommandGlobal(node.taskName, node.btmCwd, { withOptionalArgs: true });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runModuleSubcommandFromTree', (node: BtmSubcommandNode) => {
      if (node?.kind === 'subcommand' && node?.isModule) void runBtmSubcommandFromTree(node, { withOptionalArgs: false });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runModuleSubcommandFromTreeClick', (node: BtmSubcommandNode) => {
      if (node?.kind === 'subcommand' && node?.isModule && shouldRunOnClick(node)) void runBtmSubcommandFromTree(node, { withOptionalArgs: false });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runModuleSubcommandFromTreeWithArgs', (node: BtmSubcommandNode) => {
      if (node?.kind === 'subcommand' && node?.isModule) void runBtmSubcommandFromTree(node, { withOptionalArgs: true });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runModuleSubcommandFromTreeWithArgsClick', (node: BtmSubcommandNode) => {
      if (node?.kind === 'subcommand' && node?.isModule && shouldRunOnClick(node)) void runBtmSubcommandFromTree(node, { withOptionalArgs: true });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('btm.runTask', async () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        void vscode.window.showInformationMessage('No workspace folder open.');
        return;
      }
      type RunEntry = vscode.QuickPickItem & {
        taskName: string;
        subcommand?: string;
        btmCwd: string;
        folder?: vscode.WorkspaceFolder;
        isGlobal?: boolean;
      };
      const entries: RunEntry[] = [];
      for (const folder of folders) {
        const btmCwd = await getBtmCwdForFolder(folder);
        const names = listBtmTasks(btmCwd);
        for (const taskName of names) {
          const help = getBtmTaskHelp(btmCwd, taskName);
          entries.push({
            label: taskName,
            description: folder.name,
            taskName,
            btmCwd,
            folder,
          });
          if (help?.subcommands.length) {
            for (const sub of help.subcommands) {
              entries.push({
                label: `${taskName} ${sub.name}`,
                description: folder.name,
                taskName,
                subcommand: sub.name,
                btmCwd,
                folder,
              });
            }
          }
        }
      }
      const workspaceCwd = entries[0]?.btmCwd ?? folders[0].uri.fsPath;
      const globalNames = listBtmTasksGlobal(workspaceCwd);
      for (const taskName of globalNames) {
        const help = getBtmTaskHelp(workspaceCwd, taskName);
        entries.push({
          label: taskName,
          description: 'Global',
          taskName,
          btmCwd: workspaceCwd,
          isGlobal: true,
        });
        if (help?.subcommands.length) {
          for (const sub of help.subcommands) {
            entries.push({
              label: `${taskName} ${sub.name}`,
              description: 'Global',
              taskName,
              subcommand: sub.name,
              btmCwd: workspaceCwd,
              isGlobal: true,
            });
          }
        }
      }
      if (entries.length === 0) {
        void vscode.window.showInformationMessage('No BTM tasks found in this workspace.');
        return;
      }
      const picked = await vscode.window.showQuickPick(entries, {
        placeHolder: 'Select a task to run',
        matchOnDescription: true,
      });
      if (!picked) return;
      if (picked.isGlobal) {
        await runBtmTaskGlobal(picked.taskName, picked.btmCwd, {
          subcommand: picked.subcommand,
          withOptionalArgs: true,
        });
        return;
      }
      if (picked.subcommand !== undefined && picked.folder) {
        const help = getBtmTaskHelp(picked.btmCwd, picked.taskName);
        const sub = help?.subcommands.find((s) => s.name === picked.subcommand);
        if (sub) {
          await runBtmTask(picked.taskName, picked.btmCwd, picked.folder, {
            subcommand: picked.subcommand,
            withOptionalArgs: true,
          });
        }
      } else if (picked.folder) {
        await runBtmTask(picked.taskName, picked.btmCwd, picked.folder, { withOptionalArgs: true });
      }
    })
  );
}

export function deactivate(): void {}
