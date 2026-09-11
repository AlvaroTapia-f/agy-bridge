import { assert } from "@std/assert";

// PR4 task 4.1 RED: docs/model-contract.md must document the v4 explicit
// variant-masking contract (enabled declared, disabled generics, version 4).
// Each test asserts a distinct contract element so a partial doc update
// still fails until the whole contract is documented.

const docUrl = new URL("./model-contract.md", import.meta.url);

async function readContract(): Promise<string> {
  return await Deno.readTextFile(docUrl);
}

Deno.test("4.1 masking contract: version 4 declared, v3 wording gone", async () => {
  const doc = await readContract();
  assert(
    doc.includes("MODEL_MAP_VERSION = 4"),
    "contract must declare MODEL_MAP_VERSION = 4",
  );
  assert(
    !doc.includes("MODEL_MAP_VERSION = 3"),
    "stale v3 version line must be replaced",
  );
});

Deno.test("4.1 masking contract: disabled generics and reasoning_options", async () => {
  const doc = await readContract();
  assert(
    doc.includes("{disabled: true}") || doc.includes("{disabled:true}"),
    "contract must document the {disabled: true} masked shape",
  );
  assert(
    doc.includes("reasoning_options"),
    "contract must document the reasoning_options declared-truth carrier",
  );
  assert(
    doc.includes("GENERIC_EFFORTS"),
    "contract must name the GENERIC_EFFORTS set (high, medium, low)",
  );
});

Deno.test("4.1 masking contract: worked example plus downstream filter", async () => {
  const doc = await readContract();
  assert(
    doc.includes("gemini-3.1-pro"),
    "contract must carry the gemini-3.1-pro worked example (high/low declared, medium masked)",
  );
  assert(
    doc.includes("model-variants.ts"),
    "contract must describe the downstream model-variants.ts disabled filter",
  );
});
