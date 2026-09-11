import { assert, assertEquals } from "@std/assert";

// Behavioral test for the model-variants.ts disabled-filter.
//
// Executes the ACTUAL filter logic the installer injects: at test runtime it
// reads install.sh (read-only), extracts the `old` anchor and `new`
// replacement of the agy-bridge-mask-v1 patch, applies the same
// single-replacement transformation to a fixture harness built on the
// upstream unpatched loop shape, runs the patched copy via deno, and asserts
// the output is declared-only. No repo file and no global file is modified —
// everything happens in a temp dir. If the installer patch drifts, extraction
// fails loudly instead of silently testing stale logic.

// --- Fixture: masked map with {disabled:true} entries (live v4 shape) ---
const FIXTURE_MODELS = {
  "auto-ro-gemini-3.1-pro": {
    reasoning_options: ["high", "low"],
    variants: {
      high: { reasoningEffort: "high" },
      low: { reasoningEffort: "low" },
      medium: { disabled: true },
    },
  },
  "auto-ro-gemini-3.7-flash": {
    reasoning_options: ["high", "low", "medium"],
    variants: {
      high: { reasoningEffort: "high" },
      medium: { reasoningEffort: "medium" },
      low: { reasoningEffort: "low" },
    },
  },
  "auto-ro-claude-sonnet-4-6": { variants: {} },
};

const HARNESS_HEAD = `const providerList: any[] = [{ id: "agy-bridge", models: __FIXTURE__ }];
const variants: Record<string, Record<string, string[]>> = {};
for (const prov of providerList) {
  for (const [modelId, model] of Object.entries(prov.models ?? {})) {
    const m = model as any;
`;
const HARNESS_TAIL = `
  }
}
console.log(JSON.stringify(variants));
`;

async function loadPatchBlocks(): Promise<{ oldBlock: string; newBlock: string }> {
  const installSh = new URL("../install.sh", import.meta.url);
  const text = await Deno.readTextFile(installSh);
  const oldMatch = text.match(/old = """([\s\S]*?)"""/);
  const newMatch = text.match(/new = """([\s\S]*?)"""/);
  assert(oldMatch?.[1], "installer patch `old` anchor not found in install.sh — patch drifted?");
  assert(newMatch?.[1], "installer patch `new` replacement not found in install.sh — patch drifted?");
  assert(
    newMatch[1].includes("agy-bridge-mask-v1"),
    "installer `new` block lost the agy-bridge-mask-v1 marker — patch drifted?",
  );
  return { oldBlock: oldMatch[1], newBlock: newMatch[1] };
}

async function buildPatchedHarness(): Promise<string> {
  const { oldBlock, newBlock } = await loadPatchBlocks();
  // Fixture harness built on the upstream unpatched loop shape...
  const unpatched = HARNESS_HEAD.replace("__FIXTURE__", JSON.stringify(FIXTURE_MODELS)) +
    oldBlock + HARNESS_TAIL;
  assert(unpatched.includes(oldBlock), "fixture does not contain the installer `old` anchor");
  // ...then the same transformation the installer applies: single old -> new replacement.
  const patched = unpatched.replace(oldBlock, newBlock);
  assert(!patched.includes(oldBlock), "replacement did not consume the `old` anchor");
  assert(patched.includes("agy-bridge-mask-v1"), "patched harness lost the mask marker");
  return patched;
}

async function runCode(code: string): Promise<Record<string, Record<string, string[]>>> {
  const dir = await Deno.makeTempDir({ prefix: "mask-filter-" });
  try {
    const file = `${dir}/harness.ts`;
    await Deno.writeTextFile(file, code);
    const cmd = new Deno.Command(Deno.execPath(), {
      args: ["run", file],
      stdout: "piped",
      stderr: "piped",
    });
    const { code: exitCode, stdout, stderr } = await cmd.output();
    assert(exitCode === 0, `harness exited ${exitCode}: ${new TextDecoder().decode(stderr)}`);
    return JSON.parse(new TextDecoder().decode(stdout));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

async function runHarness(loopBody: string): Promise<Record<string, Record<string, string[]>>> {
  const code = HARNESS_HEAD.replace("__FIXTURE__", JSON.stringify(FIXTURE_MODELS)) +
    loopBody + HARNESS_TAIL;
  return await runCode(code);
}

Deno.test("disabled-filter: patched loop emits declared-only picker rows", async () => {
  const result = await runCode(await buildPatchedHarness());
  const rows = result["agy-bridge"];
  assertEquals(rows["auto-ro-gemini-3.1-pro"], ["high", "low"]);
  assertEquals(rows["auto-ro-gemini-3.7-flash"], ["high", "low", "medium"]);
  assertEquals("auto-ro-claude-sonnet-4-6" in rows, false);
});

Deno.test("disabled-filter: unpatched loop leaks medium (proves the filter does the work)", async () => {
  const { oldBlock } = await loadPatchBlocks();
  const result = await runHarness(oldBlock);
  const rows = result["agy-bridge"];
  // Upstream behavior unions every variant key, including masked generics.
  assertEquals(rows["auto-ro-gemini-3.1-pro"], ["high", "low", "medium"]);
});
