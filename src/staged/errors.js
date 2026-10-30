// Based on nano-staged (MIT) https://github.com/usmanyunusov/nano-staged
const MESSAGES = {
  noConfig: () => "No staged tasks configured. Add a *staged* section to your nano-hooks config.",
  noFileConfig: (path) => `Staged config file *${path}* is not found.`,
  invalidConfig: () => "Staged config is invalid.",
  noGitRepo: () => "Not a git repository.",
  noFiles: (type) => `No ${type} files found.`,
  noMatchingFiles: () => "No files match any configured task.",
};

export class NanoStagedError extends Error {
  constructor(type, ...args) {
    super(MESSAGES[type](...args));
    this.name = "NanoStagedError";
    this.type = type;
  }
}

export class TaskRunnerError extends Error {
  constructor(errors) {
    super(errors);
    this.name = "TaskRunnerError";
  }
}
