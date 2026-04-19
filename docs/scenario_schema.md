# Scenario JSON Schema v2

All scenario JSON files in `config/scenarios/` follow this schema.

## Required Fields (existing)

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Scenario filename slug (e.g. `"morning_triage"`) |
| `description` | string | Detailed scenario description seen by operator and injected into copilot context |
| `sessions` | array | FIX session states for this scenario |
| `orders` | array | Pre-seeded orders with flags |

## Required Fields (v2 additions)

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Human-readable title for UI display |
| `severity` | string | `"low"`, `"medium"`, `"high"`, or `"critical"` |
| `estimated_minutes` | integer | Estimated time for an experienced operator to resolve |
| `categories` | array | Tags: `"session"`, `"orders"`, `"reference_data"`, `"algo"`, `"market_data"`, `"regulatory"` |
| `difficulty` | string | `"beginner"`, `"intermediate"`, or `"advanced"` |
| `simulated_time` | string | ISO-8601 timestamp of simulated scenario start |

## Runbook (v2)

| Field | Type | Description |
|-------|------|-------------|
| `runbook.narrative` | string | Rich scene-setter injected into the AI copilot system prompt |
| `runbook.steps[]` | array | Ordered diagnostic/fix steps (see step schema below) |

### Step Schema

| Field | Type | Description |
|-------|------|-------------|
| `step` | integer | Step number |
| `title` | string | Short action label |
| `narrative` | string | Why this step matters, what to look for |
| `tool` | string | MCP tool name to invoke |
| `tool_args` | object | Arguments to pass to the tool |
| `expected` | string | What success looks like |

## Hints (v2)

| Field | Type | Description |
|-------|------|-------------|
| `hints.key_problems[]` | array | 1-3 sentence descriptions of the core problems |
| `hints.flag_meanings` | object | Map of flag_name → what it means and what to do |
| `hints.diagnosis_path` | string | First thing the operator should check |
| `hints.common_mistakes[]` | array | Things operators commonly do wrong in this scenario |

## Success Criteria (v2)

| Field | Type | Description |
|-------|------|-------------|
| `success_criteria[]` | array | Conditions that must be true for the scenario to be considered resolved |

## Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `algo_orders` | array | Pre-seeded algo orders (for algo scenarios) |
| `corporate_actions` | array | Corporate actions active in this scenario |
| `symbols` | array | Additional symbols beyond the base reference data |
