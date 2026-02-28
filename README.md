# Bash Task Master – VSCode / Cursor extension

Run [Bash Task Master](https://github.com/hppr-dev/bash-task-master) (BTM) tasks from the editor.

## Requirements

- **Bash Task Master** must be installed (e.g. via the [install script](https://hppr.dev/install-btm.sh)). The extension discovers BTM using `TASK_MASTER_HOME` if set, otherwise `~/.task-master`.
- Open a workspace that contains a BTM tasks file (`tasks.sh` or `.tasks.sh`). The extension activates when it finds either in the workspace.

## How it works

- **Listing tasks** – The extension uses `task +s list -a --json` (silent + JSON) to get task names, falling back to plain `task list` output if JSON is not available. Tasks are discovered by invoking `bash` and sourcing `$TASK_MASTER_HOME/task-runner.sh`. If no workspace folder contains a tasks file, or BTM is not installed, no tasks are shown.
- **Task metadata** – The extension uses `task +s help <name> --json` for machine-readable task metadata (description, required/optional arguments, subcommands). When you run a task, you can choose a subcommand (if any) and be prompted for required and optional arguments.
- **Running tasks** – When you run a task, the extension executes it in the integrated terminal (without silent mode so you see normal output). The working directory is set to the folder that contains the tasks file (or the workspace folder root if none is found).

## Usage

- **Bash Task Master view** – In the Explorer sidebar, open the **Bash Task Master** view to see workspace folders and their BTM tasks. Expand a task to see its description, required/optional arguments, and subcommands. Right‑click a task and choose **Run Task** to run it; you can then pick a subcommand (if any) and enter required/optional arguments.
- **BTM: Run Task** – Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`), run **BTM: Run Task**, pick a task, then optionally a subcommand and any required or optional arguments.
- **Terminal → Run Task** – BTM tasks also appear in the generic **Run Task** list; select one to run it.

## Features

- **Run Task** lists all BTM tasks for every workspace folder (`task list -a` per folder) and lets you run any of them. Multi-root workspaces are supported; each folder's tasks are scoped to that folder and run with the correct working directory.

## Development

```bash
npm install
npm run compile
```

Then open this folder in VSCode/Cursor and press **F5** to launch an Extension Development Host. Open another folder that has a `tasks.sh` or `.tasks.sh` and use the **Bash Task Master** view or **BTM: Run Task** to try the extension.

## Submodule

When cloning the main [bash-task-master](https://github.com/hppr-dev/bash-task-master) repo, use:

```bash
git clone --recurse-submodules https://github.com/hppr-dev/bash-task-master.git
```

or after a plain clone:

```bash
git submodule update --init --recursive
```

to include this extension.
