#!/usr/bin/env python3
"""Assert that V2 actually surfaces the agy-bridge effort variants.

V1 lost these silently: the effort ladder lived in a config-side map that the
runtime never merged into the picker. In V2 the plugin is the only source of the
catalog, so if `variants` does not come out the other end the picker is empty and
nothing tells the user why. That makes this the assert that matters.

Reads a `/api/model` response on argv[1]; exits non-zero and explains on stderr.
Every expectation here was measured against opencode v2.0.20.
"""

import json
import sys

PROVIDER = "agy-bridge"
REASONING_FIELD = "reasoning_content"
EXPECTED_CONTEXT = 200000
EXPECTED_OUTPUT = 32000

# (model, expected variant id, expected settings.reasoningEffort)
# "thinking" is the one that maps to the non-enumerated "max" effort, so it is
# the canary for the whole reasoningEffort round-trip.
EXPECTED = [
    ("auto-ro-claude-opus-4-6", "thinking", "max"),
    ("auto-rw-claude-opus-4-6", "thinking", "max"),
    ("auto-ro-gemini-3.7-flash", "high", "high"),
    ("auto-ro-gemini-3.7-flash", "medium", "medium"),
    ("auto-ro-gemini-3.7-flash", "low", "low"),
    ("auto-rw-gemini-3.8-flash", "high", "high"),
    ("auto-rw-gpt-oss-120b", "medium", "medium"),
]

failures = []


def fail(msg):
    failures.append(msg)
    print("  VARIANT-FAIL: %s" % msg, file=sys.stderr)


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else None
    if not path:
        print("usage: assert-v2-variants.py <model-api.json>", file=sys.stderr)
        return 2
    try:
        with open(path, encoding="utf-8") as fh:
            payload = json.load(fh)
    except (OSError, ValueError) as exc:
        print("  VARIANT-FAIL: cannot read %s: %s" % (path, exc), file=sys.stderr)
        return 1

    models = payload.get("data")
    if not isinstance(models, list):
        print("  VARIANT-FAIL: /api/model returned no data array (got %r)"
              % type(models).__name__, file=sys.stderr)
        return 1

    ours = {m["id"]: m for m in models if m.get("providerID") == PROVIDER}
    if not ours:
        fail("no %s models in the /api/model response (%d models total)"
             % (PROVIDER, len(models)))
        return 1

    by_id = {m: ours[m] for m, _, _ in EXPECTED if m in ours}
    for model_id, _, _ in EXPECTED:
        if model_id not in ours:
            fail("model %s is missing from the catalog" % model_id)

    for model_id, variant_id, effort in EXPECTED:
        model = by_id.get(model_id)
        if model is None:
            continue
        variants = {v.get("id"): v for v in (model.get("variants") or [])}
        variant = variants.get(variant_id)
        if variant is None:
            fail("%s has no variant %r (has: %s)"
                 % (model_id, variant_id, sorted(variants) or "none"))
            continue
        got = (variant.get("settings") or {}).get("reasoningEffort")
        if got != effort:
            fail("%s variant %r carries reasoningEffort %r, expected %r"
                 % (model_id, variant_id, got, effort))
            continue
        print("  variant ok: %s [%s] -> reasoningEffort=%s"
              % (model_id, variant_id, got))

    # compatibility.reasoningField: the bridge speaks reasoning_content, not the
    # OpenAI default "reasoning". V2 reads it off Model.Info.
    for model_id, model in by_id.items():
        field = (model.get("compatibility") or {}).get("reasoningField")
        if field != REASONING_FIELD:
            fail("%s has compatibility.reasoningField=%r, expected %r"
                 % (model_id, field, REASONING_FIELD))

    # capabilities / limit must survive, or the picker misreports what the
    # bridge can actually do.
    for model_id, model in by_id.items():
        caps = model.get("capabilities") or {}
        if caps.get("tools") is not True:
            fail("%s lost capabilities.tools" % model_id)
        if "text" not in (caps.get("output") or []):
            fail("%s lost capabilities.output=text" % model_id)
        limit = model.get("limit") or {}
        if limit.get("context") != EXPECTED_CONTEXT:
            fail("%s limit.context=%r, expected %r"
                 % (model_id, limit.get("context"), EXPECTED_CONTEXT))
        if limit.get("output") != EXPECTED_OUTPUT:
            fail("%s limit.output=%r, expected %r"
                 % (model_id, limit.get("output"), EXPECTED_OUTPUT))

    if not by_id:
        return 1

    sample = by_id[sorted(by_id)[0]]
    print("  model sample: %s" % json.dumps(
        {k: sample.get(k) for k in
         ("id", "compatibility", "capabilities", "limit", "variants")},
        sort_keys=True))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
