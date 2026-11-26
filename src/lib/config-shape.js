/** Hook names from githooks(5). */
export const VALID_HOOKS = [
  "applypatch-msg",
  "pre-applypatch",
  "post-applypatch",
  "pre-commit",
  "pre-merge-commit",
  "prepare-commit-msg",
  "commit-msg",
  "post-commit",
  "pre-rebase",
  "post-checkout",
  "post-merge",
  "pre-push",
  "reference-transaction",
  "pre-auto-gc",
  "post-rewrite",
  "sendemail-validate",
  "fsmonitor-watchman",
  "post-index-change",
];

export const STAGED_OPTIONS = {
  allowEmpty: {
    default: false,
    description: "Allow a commit that becomes empty after running staged tasks.",
  },
  bail: {
    default: false,
    description: "Stop running staged tasks after the first command fails.",
  },
  parallel: {
    default: true,
    description: "Run tasks for different staged patterns concurrently.",
  },
  restage: {
    default: true,
    description: "Stage the changes made by staged tasks.",
  },
};

const NON_BLANK = /\S/u;
export const MIN_COMMANDS = 1;

export const isNonBlankString = (value) => typeof value === "string" && NON_BLANK.test(value);

const command = { type: "string", pattern: NON_BLANK.source };
const commandList = { $ref: "#/$defs/commandList" };

/** Configuration shape shared by runtime validation and editor schema generation. */
export const CONFIG_SHAPE = {
  type: "object",
  additionalProperties: false,
  properties: {
    $schema: { ...command, description: "Schema path or URL for editor validation." },
    options: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...Object.fromEntries(
          Object.entries(STAGED_OPTIONS).map(([name, option]) => [
            name,
            { type: typeof option.default, description: option.description },
          ]),
        ),
        preserveUnused: {
          description: "Keep all unused managed hooks, or keep the listed hooks.",
          anyOf: [{ type: "boolean" }, { type: "array", items: { enum: VALID_HOOKS } }],
        },
      },
    },
    hooks: {
      type: "object",
      description: "Commands to run for each Git hook.",
      additionalProperties: false,
      properties: Object.fromEntries(VALID_HOOKS.map((name) => [name, commandList])),
    },
    staged: {
      type: "object",
      description:
        "Commands to run on staged files matching each glob. nano-hooks checks glob syntax when loading the configuration.",
      minProperties: 1,
      propertyNames: { minLength: 1 },
      additionalProperties: commandList,
    },
  },
  $defs: {
    commandList: {
      anyOf: [command, { type: "array", minItems: MIN_COMMANDS, items: command }],
    },
  },
};
