# Research: sanitizar-repo — repository sanitation evidence (revision 3)

> Language: English (neutral technical register per Language Domain Contract).

## gentle-ai.sdd-research/v1

```yaml
schema: gentle-ai.sdd-research/v1
revision: 3
change: sanitizar-repo
project: agy-bridge
outcome: done
```

### 1. Retained selected request (pre-source-access)

- Change: `sanitizar-repo` (slug `sanitizar-repo` used for all file paths).
- Workspace (authoritative): `/home/alvaro/Projects/agy-bridge`.
- Original intent (Spanish, retained verbatim for recovery):
  "Quiero sanitizar completamente el repo. entiendo que hoy en dia hay varias cosas duplicadas y logica vieja o redundante. Quiero que exploremos a fondo el repo para dejarlo saneado en todos los aspectos"
- Canonical desired content (retained before any source access):
  Auditable external evidence for the selected research lanes derived from
  `openspec/changes/sanitizar-repo/exploration.md`, specifically:
  (a) Deno plugin self-contained vs shared-import patterns;
  (b) minimal installer fallback policy (Deno sync vs inline Python fallback);
  (c) spec-consistency practices for active specs vs archived history.
- Exploration baseline retained:
  Triple model/catalog duplication, installer overreach, stale 7/14 vs 8/16
  references, lint 44 findings, missing HTTP/SSE/process coverage.
- This retention was recorded before any evidence-source access and before any
  write, per the research execution contract. It is the canonical content for
  any future retry; no surviving store may be used to derive replacement
  content after a one-sided failure.
- Revision lineage: revision 1 (`blocked`, denied grants) retained above
  unchanged as canonical intent; revision 2 (`blocked`, denied grants) is a
  prior explicit retry against the same retained intent; revision 3 is a new
  explicit retry against the same retained intent after the global
  `agent.sdd-research` permission fix, not content derived from any surviving
  store.

### 2. Research questions (selected lanes)

1. What is the auditable external guidance for Deno/OpenCode plugin
   self-contained vs shared-import patterns applicable to the
   `plugins/agy-bridge.ts` vs `plugins/agy-bridge-helpers.ts` duplication?
2. What is the auditable external guidance for a minimal installer fallback
   policy (hard Deno prerequisite vs deliberately minimal emergency Python
   path) applicable to `install.sh` and `scripts/sync-models.ts`?
3. What is the auditable external guidance for spec-consistency practices
   (active specs vs immutable archived history) applicable to the stale
   7/14 vs current 8/16 discrepancy?

### 3. Admission and observed exact grants

- Required capability contract: `gentle-ai.sdd-research-capability/v1`.
- Requested evidence classes for the selected lanes: `documentation`, `open-web`.
- Declared runtime capability for this retry:
  ```yaml
  schema: gentle-ai.sdd-research-capability/v1
  change: sanitizar-repo
  project: agy-bridge
  grants:
    documentation:
      - context7_resolve-library-id
      - context7_query-docs
    open-web:
      - webfetch
      - websearch
  ```
- Verification rule applied: only exact declared grants for `documentation` or
  `open-web` admit evidence. Persistence-tool access, generic MCP access,
  filenames, Bash availability, inherited unnamed tools, or the mere presence
  of documentation/web tool names in the runtime declaration were not inferred
  as evidence capability. Unsupported or undeclared classes deny admission.
- Admission decision: **granted** for both requested classes.
  - `documentation`: admitted via `context7_resolve-library-id`,
    `context7_query-docs`.
  - `open-web`: admitted via `webfetch`, `websearch`.
- Collection note: `websearch` is admitted but returned `401 POST
  https://search.parallel.ai/mcp` on all three lane queries at execution time.
  No `websearch` excerpt is claimed. All `open-web` excerpts below were
  collected via the admitted `webfetch` tool. No unadmitted tool contributed
  evidence.
- Consequence: proceed to source collection; map every validated claim to
  source IDs; outcome eligible for `done` if every question is supported.

### 4. Sources

```yaml
sources:
  - id: S1
    class: documentation
    title: OpenCode Plugins — Use a plugin / Create a plugin / Dependencies
    publisher: OpenCode Docs (opencode.ai)
    url: https://opencode.ai/docs/plugins
    accessed_at: "2026-09-07"
  - id: S2
    class: documentation
    title: Deno Docs — Modules (ECMAScript modules, imports, import maps)
    publisher: Deno Docs (docs.deno.com)
    url: https://docs.deno.com/runtime/fundamentals/modules/
    accessed_at: "2026-09-07"
  - id: S3
    class: documentation
    title: Deno Docs — Bundling (deno bundle, self-contained application file)
    publisher: Deno Docs (docs.deno.com)
    url: https://docs.deno.com/runtime/reference/bundling/
    accessed_at: "2026-09-07"
  - id: S4
    class: documentation
    title: Deno Docs — deno compile (self-contained executable)
    publisher: Deno Docs (docs.deno.com)
    url: https://docs.deno.com/runtime/reference/cli/compile/
    accessed_at: "2026-09-07"
  - id: S5
    class: documentation
    title: Deno Docs — Installation (single binary, PATH, verification)
    publisher: Deno Docs (docs.deno.com)
    url: https://docs.deno.com/runtime/getting_started/installation/
    accessed_at: "2026-09-07"
  - id: S6
    class: documentation
    title: Deno Docs — Lint/format include/exclude scoping via deno.json
    publisher: Deno Docs (denoland/docs via Context7)
    url: https://github.com/denoland/docs/blob/main/runtime/reference/deno_json.md
    accessed_at: "2026-09-07"
  - id: S7
    class: open-web
    title: Architectural Decision Records (ADRs) — decision log practice
    publisher: adr.github.io (ADR GitHub organization)
    url: https://adr.github.io/
    accessed_at: "2026-09-07"
  - id: S8
    class: open-web
    title: Keep a Changelog 1.0.0 — curated changelog practice
    publisher: keepachangelog.com (Olivier Lacan)
    url: https://keepachangelog.com/en/1.0.0/
    accessed_at: "2026-09-07"
```

- S1 excerpt (open-web verified via `webfetch`, corroborated via Context7
  `/websites/opencode_ai_plugins`): "Place JavaScript or TypeScript files in
  the plugin directory. `.opencode/plugins/` - Project-level plugins ...
  Files in these directories are automatically loaded at startup." /
  "Local plugins are loaded directly from the plugin directory." / "Local
  plugins and custom tools can use external npm packages. Add a package.json
  to your config directory ... OpenCode runs `bun install` at startup ...
  Your plugins and tools can then import them."
- S2 excerpt (open-web verified via `webfetch`, corroborated via Context7
  `/denoland/docs`): "Deno uses ECMAScript modules as its primary module
  system ... You share code between files with standard `import` and `export`
  statements and run it directly, with no bundler or build step." / "With
  ECMAScript modules, local import specifiers must always include the full
  file extension." / Centralize remote modules with the `imports` field
  (import map) in `deno.json`.
- S3 excerpt: "The `deno bundle` command outputs a single JavaScript file
  with all dependencies." / "Above invocation produces a single `bundle.js`
  file that contains all the dependencies, resulting in a self-contained
  application file" / "To produce a standalone binary rather than a
  JavaScript file, use `deno compile`, which can also bundle and minify its
  input."
- S4 excerpt (corroborated via Context7 `/denoland/docs` compile snippets):
  "Compiles the given script into a self contained executable." / "This
  allows distribution of a Deno application to systems that do not have Deno
  installed. Under the hood, it bundles a slimmed down version of the Deno
  runtime along with your JavaScript or TypeScript code." / "`--bundle`
  ... Bundle the entrypoint with esbuild before embedding, instead of
  shipping the whole node_modules tree."
- S5 excerpt: "Deno is a single binary executable with no external
  dependencies." / "To test your installation, run `deno --version`." /
  "If `deno --version` reports `command not found`, the install directory
  isn't on your `PATH` yet ... Open a new terminal window or restart your
  shell so the updated `PATH` is picked up."
- S6 excerpt (via Context7 `/denoland/docs`): "Specify files to include and
  exclude from linting by configuring the 'lint' section in your deno.json"
  / "`exclude` ... Specify directories in the top-level 'exclude' array to
  prevent them from being processed by Deno commands like fmt, lint, and
  type checking." / Example excludes `dist/`, `src/testdata/`,
  `src/generated/**`.
- S7 excerpt: "An Architectural Decision Record (ADR) captures a single AD
  and its rationale" / "The collection of ADRs created and maintained in a
  project constitute its decision log."
- S8 excerpt: "A changelog is a file which contains a curated,
  chronologically ordered list of notable changes for each version of a
  project." / "Keep an `Unreleased` section at the top to track upcoming
  changes." / "Types of changes: Added, Changed, Deprecated, Removed,
  Fixed, Security" / "Should you ever rewrite a changelog? Sure. There are
  always good reasons to improve a changelog." (see Contradictions).

### 5. Validated claims

```yaml
claims:
  - id: C1
    question: 1
    statement: OpenCode local plugins load directly from the plugin directory at startup; shared helper imports outside that directory are not free — external packages require an explicit package.json plus bun install at startup.
    sources: [S1]
  - id: C2
    question: 1
    statement: Deno shared imports use standard ESM import/export with explicit file extensions and optional deno.json import-map centralization; a shared helper module is technically standard but the installed-plugin resolution path must be proven.
    sources: [S2]
  - id: C3
    question: 1
    statement: Deno bundle and deno compile are the audited self-contained distribution paths (single JS file with all dependencies; single executable with slimmed runtime), supporting a generated self-contained plugin artifact as an alternative to hand-maintained duplication.
    sources: [S3, S4]
  - id: C4
    question: 2
    statement: Deno is distributed as a single binary with no external dependencies, which supports declaring Deno a hard installer prerequisite.
    sources: [S5]
  - id: C5
    question: 2
    statement: Installer availability checks must verify deno --version and PATH propagation (shell reload may be required); a fallback that silently papers over a missing Deno contradicts documented install behavior.
    sources: [S5]
  - id: C6
    question: 2
    statement: A self-contained compiled/bundled artifact removes the target-machine Deno requirement; removing the inline Python emergency path is only justified after proving the hard-prerequisite policy or switching to such an artifact.
    sources: [S4, S3]
  - id: C7
    question: 3
    statement: Architecture decisions should be captured as single-decision records with rationale, maintained as a decision log — supporting active-spec currency plus preserved history rather than silent overwrites.
    sources: [S7]
  - id: C8
    question: 3
    statement: Human-facing change history should be curated, chronologically ordered per version with an Unreleased section and grouped change types (Added/Changed/Deprecated/Removed/Fixed/Security) — supporting delta-spec reconciliation of the 8/16 contract without rewriting archives.
    sources: [S8]
  - id: C9
    question: 3
    statement: Deno hygiene gates support explicit include/exclude scoping in deno.json (including top-level exclude from fmt/lint/type-check) — supporting exclusion of archived OpenSpec artifacts from mass-format/lint passes.
    sources: [S6]
```

### 6. Contradictions, uncertainty, freshness

- Contradictions:
  - S8 vs archive immutability: Keep a Changelog explicitly permits rewriting
    ("Should you ever rewrite a changelog? Sure."), which contradicts a
    strict "never touch history" reading. Resolution for this change:
    immutability of `openspec/changes/archive/**` is a product/convention
    choice (already stated in `exploration.md`), not an externally mandated
    invariant. Active specs and README may be corrected; archives stay
    immutable by local convention.
  - No contradiction between S1/S2/S3/S4: shared ESM imports are standard
    (S2) and self-contained bundle/compile is supported (S3/S4); the choice
    is a compatibility tradeoff, not a correctness conflict. S1 constrains
    the tradeoff: local-load is direct, cross-directory/shared resolution
    needs explicit packaging proof.
- Uncertainty:
  - Low for Q1 mechanics (S1+S2+S3+S4 converge): both patterns exist; the
    open point is product/compatibility (installed-plugin resolution), not
    external guidance.
  - Medium for Q2 scope: S4/S5 justify either a hard Deno prerequisite or a
    minimal emergency fallback, but "minimal" has no external byte limit —
    the proposer must define what the Python path is allowed to do (grouped
    ids only, no feature parity) and its failure semantics.
  - Medium for Q3 wording: S7/S8 support the active-vs-history split, but no
    external source names the 8-base/16-id contract; that contract must be
    verified against current code, not cited as externally validated.
- Freshness:
  - S1 fetched 2026-09-07; page footer "Last updated: Sep 7, 2026".
  - S2/S3/S4/S5 fetched 2026-09-07; Deno pages show "Last updated on June
    17–July 9, 2026" variants; compile page August 6, 2026. All current
    within ~3 months.
  - S6 via Context7 reflects current `denoland/docs` main; no version pin
    beyond `main`.
  - S7/S8 fetched 2026-09-07; S8 is versioned 1.0.0 (2017) with 1.1.0 noted
    available — practice stable, not stale.
  - `websearch` unavailability (401) is recorded as a transport freshness
    gap, not an evidence gap: no claim depends on `websearch`.
- Local exploration input (`exploration.md`) was used only to define lanes
  and retain intent. It is not cited as external evidence and carries no
  source ID.

### 7. Product choices (non-authoritative, separate from evidence)

No product decisions are confirmed. The following remain explicitly pending
and MUST NOT be treated as evidence-backed:

- Pending: whether the installed plugin must stay self-contained (generated
  bundle artifact favored by S3/S4) or may import a shared helper module
  (permitted by S2, constrained by S1 load semantics). Requires an
  installed-plugin smoke test before consolidation.
- Pending: whether the inline Python fallback stays as a deliberately
  minimal emergency path (allowed grouped-ids-only scope, explicit failure
  semantics) or is removed behind a hard Deno prerequisite (supported by
  S5). Requires explicit prerequisite policy plus `deno --version`/PATH
  verification (S5).
- Pending: which active artifacts adopt the 8-base/16-id contract and how
  README and installer wording are reconciled without touching archives
  (S7/S8 support the process; the contract itself needs code verification).
  Archive immutability is a local convention, not an external mandate (see
  Contradictions).

The orchestrator owns product discovery. No automatic choice is recorded.

---

## gentle-ai.sdd-preproposal/v1 (revision 3)

```yaml
schema: gentle-ai.sdd-preproposal/v1
revision: 3
change: sanitizar-repo
project: agy-bridge
exploration:
  reference: openspec/changes/sanitizar-repo/exploration.md
  outcome: ready-for-proposal-local-only
research:
  request: external evidence for plugin packaging, installer fallback policy, spec-consistency practices
  classes: [documentation, open-web]
  admission: granted
  outcome: done
  evidence_refs:
    openspec: openspec/changes/sanitizar-repo/research.md
    engram: none
decisions: pending
proposal_ready: false
```

- Store mode observed for this write: `openspec`.
- OpenSpec evidence reference: `openspec/changes/sanitizar-repo/research.md`
  (this file, revision 3, done).
- Engram evidence reference: none (no Engram write performed in `openspec`
  mode; no `sdd/sanitizar-repo/research` or `sdd/sanitizar-repo/preproposal`
  topic was created or modified).
- `proposal_ready` is `false` because decisions are `pending`. Selected
  research is `done` with valid references and a ready OpenSpec store, but
  readiness additionally requires confirmed decisions per the research
  lifecycle. The proposer MUST NOT be invoked until the orchestrator completes
  product discovery and confirms the three pending choices above.
- Recovery note: retained intent and canonical desired content in section 1
  remain the authority for any future retry. Never derive retry content from
  a surviving store after a one-sided failure.

## Recovery (no re-entry required for evidence; product discovery required)

Evidence collection is complete (`done`). The orchestrator should run grouped
product discovery for the three pending choices (plugin packaging, fallback
policy, 8/16 reconciliation scope), persist confirmed decisions, then invoke
`sdd-propose`. No further `sdd-research` retry is needed unless lanes change.
