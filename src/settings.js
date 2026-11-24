/**
 * The true or false settings of `staged`. Each one has a default, a command line flag that sets
 * the opposite of the default, and the texts that the schema and the help show.
 */
export const STAGED_SETTINGS = {
  allowEmpty: {
    default: false,
    flag: "--allow-empty",
    flagHelp: "Allow empty commits",
    description: "Allow a commit that becomes empty after running staged tasks.",
  },
  bail: {
    default: false,
    flag: "--bail",
    flagHelp: "Stop after the first failing command",
    description: "Stop running staged tasks after the first command fails.",
  },
  parallel: {
    default: true,
    flag: "--no-parallel",
    flagHelp: "Run the patterns one after the other",
    description: "Run tasks for different staged patterns concurrently.",
  },
  restage: {
    default: true,
    flag: "--no-restage",
    flagHelp: "Leave the changes of the commands out of the commit",
    description: "Stage the changes made by staged tasks.",
  },
};

export const SETTING_NAMES = Object.keys(STAGED_SETTINGS);

/**
 * The value of every setting. Each layer, from the first to the last, overrides the one before
 * it, and the defaults come first. A layer skips a setting that is `undefined`.
 */
export function resolveSettings(...layers) {
  const settings = {};
  for (const name of SETTING_NAMES) {
    settings[name] =
      layers.findLast((layer) => layer?.[name] !== undefined)?.[name] ??
      STAGED_SETTINGS[name].default;
  }
  return settings;
}
