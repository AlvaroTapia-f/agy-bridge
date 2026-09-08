import { assertEquals } from "@std/assert";
import {
  buildModelMap as helpersBuildModelMap,
  FALLBACK_MODELS,
  groupBases as helpersGroupBases,
} from "./agy-bridge-helpers.ts";

// Import from bundled plugins/agy-bridge.ts
import {
  buildModelMap as bundleBuildModelMap,
  FALLBACK_MODELS as bundleFallbackModels,
  groupBases as bundleGroupBases,
} from "./agy-bridge.ts";

import bundleText from "./agy-bridge.ts" with { type: "text" };

Deno.test("Task 3.3 Parity: bundle exports match helpers exports on FALLBACK_MODELS", () => {
  // Parity on FALLBACK_MODELS constants
  assertEquals([...bundleFallbackModels], [...FALLBACK_MODELS]);

  // Parity on groupBases
  const helpersGrouped = helpersGroupBases(FALLBACK_MODELS);
  const bundleGrouped = bundleGroupBases(FALLBACK_MODELS);

  assertEquals(bundleGrouped.size, helpersGrouped.size);
  for (const [k, v] of helpersGrouped.entries()) {
    assertEquals(bundleGrouped.get(k), v);
  }

  // Parity on buildModelMap
  const helpersMap = helpersBuildModelMap(helpersGrouped);
  const bundleMap = bundleBuildModelMap(bundleGrouped);
  assertEquals(bundleMap, helpersMap);
});

Deno.test("Task 3.3 Triangulation: parity holds on custom dynamic slugs with multiple passes", () => {
  const dynamicSlugs = [
    "custom-3.8-flash-ultra",
    "custom-3.8-flash-extreme",
    "custom-singleton",
    "custom-3.9-pro-ultra",
    "custom-3.9-pro-max",
  ];

  const helpersGrouped = helpersGroupBases(dynamicSlugs);
  const bundleGrouped = bundleGroupBases(dynamicSlugs);

  assertEquals(bundleGrouped.size, helpersGrouped.size);
  for (const [k, v] of helpersGrouped.entries()) {
    assertEquals(bundleGrouped.get(k), v);
  }

  const helpersMap = helpersBuildModelMap(helpersGrouped);
  const bundleMap = bundleBuildModelMap(bundleGrouped);
  assertEquals(bundleMap, helpersMap);
});

Deno.test("Task 3.4 Drift test: bundle contains @ts-nocheck and GENERATED banner and matches helpers", () => {
  const hasTsNoCheck = bundleText.startsWith("// @ts-nocheck");
  const hasGeneratedBanner = bundleText.includes(
    "GENERATED FILE — DO NOT EDIT DIRECTLY",
  );
  const hasSourceOfTruth = bundleText.includes(
    "Source of truth: plugins/agy-bridge-helpers.ts",
  );

  assertEquals(hasTsNoCheck, true, "Bundle must start with // @ts-nocheck");
  assertEquals(
    hasGeneratedBanner,
    true,
    "Bundle must contain GENERATED banner",
  );
  assertEquals(
    hasSourceOfTruth,
    true,
    "Bundle must reference helpers source of truth",
  );
});
