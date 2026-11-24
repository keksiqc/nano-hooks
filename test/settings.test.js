import { describe, expect, it } from "vitest";

import { resolveSettings } from "../src/settings.js";

describe("resolveSettings", () => {
  it("starts from the defaults", () => {
    expect(resolveSettings()).toEqual({
      allowEmpty: false,
      bail: false,
      parallel: true,
      restage: true,
    });
  });

  it("lets a later layer win and skips settings that are undefined", () => {
    const settings = resolveSettings(
      { bail: true, parallel: false },
      { parallel: undefined, restage: false },
    );

    expect(settings).toEqual({ allowEmpty: false, bail: true, parallel: false, restage: false });
  });

  it("ignores keys that are not settings", () => {
    expect(resolveSettings({ preserveUnused: true })).not.toHaveProperty("preserveUnused");
  });
});
