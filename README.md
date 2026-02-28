# Bash Task Master – VSCode / Cursor extension

Run [Bash Task Master](https://github.com/hppr-dev/bash-task-master) (BTM) tasks from the editor.

## Requirements

- **Bash Task Master** must be installed and the `task` command available on your PATH (typically by sourcing the BTM install script so the `task` function is defined in your shell).
- Open a workspace that contains a BTM tasks file (e.g. `tasks.sh`). The extension activates when it finds `**/tasks.sh` in the workspace.

## Features

- **Run Task** lists all BTM tasks for the workspace (`task list -a`) and lets you run any of them. Tasks run in the integrated terminal with the correct working directory so BTM finds your project’s tasks file.

## Development

```bash
npm install
npm run compile
```

Then open this folder in VSCode/Cursor and press **F5** to launch an Extension Development Host. Open another folder that has a `tasks.sh` and use **Run Task** to try the extension.

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
