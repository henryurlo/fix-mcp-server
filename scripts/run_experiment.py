#!/usr/bin/env python3
"""
Dashboard experiment runner - validates scenarios, steps, and UI.
Outputs results as JSON for logging.
"""
import json
import sys
import time
import urllib.request

BASE = "http://localhost:8000"


def api(path, data=None):
    url = f"{BASE}{path}"
    method = "GET"
    body = None
    if data is not None:
        method = "POST"
        body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"} if body else {})
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        return json.loads(resp.read()), None
    except Exception as e:
        return None, str(e)


def load_scenarios():
    result, err = api("/api/status")
    if err:
        return [], f"Cannot reach API: {err}"
    return result.get("available_scenarios", []), None


def get_scenario(name):
    return api(f"/api/scenario/{name}")


def reset_scenario(name):
    return api("/api/reset", {"scenario": name})


def call_tool(tool, args=None):
    return api("/api/tool", {"tool": tool, "arguments": args or {}})


def run_scenario(scenario_name):
    """Run all steps of a scenario sequentially, measure success."""
    results = {"name": scenario_name, "steps": [], "errors": [], "total_seconds": 0}
    t0 = time.time()

    # Load scenario
    ctx, err = get_scenario(scenario_name)
    if err:
        results["errors"].append(f"Cannot load scenario: {err}")
        results["total_seconds"] = time.time() - t0
        return results

    # Reset to start fresh
    reset_scenario(scenario_name)

    steps = ctx.get("runbook", {}).get("steps", [])
    success_criteria = ctx.get("runbook", {}).get("success_criteria", [])

    for step in steps:
        step_result = {
            "step": step.get("step"),
            "title": step.get("title", ""),
            "tool": step.get("tool", ""),
            "success": False,
            "output": "",
            "error": "",
        }
        st = time.time()
        out, err = call_tool(step["tool"], step.get("tool_args", step.get("args", {})))
        elapsed = time.time() - st
        step_result["elapsed_seconds"] = round(elapsed, 2)

        if err:
            step_result["error"] = err
        else:
            step_result["success"] = True
            step_result["output"] = str(out.get("output", ""))[:500] if out else ""

        results["steps"].append(step_result)

    results["total_seconds"] = round(time.time() - t0, 2)
    passed = sum(1 for s in results["steps"] if s["success"])
    total = len(results["steps"])
    results["passed"] = passed
    results["total_steps"] = total
    results["score"] = round(passed / total, 3) if total > 0 else 0

    return results


def run_all():
    scenarios, err = load_scenarios()
    if err:
        print(json.dumps({"error": err}))
        sys.exit(1)

    all_results = []
    for sc in scenarios:
        print(f"\n--- {sc['name']} ---", flush=True)
        r = run_scenario(sc["name"])
        all_results.append(r)
        status = "PASS" if r["score"] >= 1.0 else f"FAIL ({r['passed']}/{r['total_steps']})"
        print(f"  {status} - {r['total_seconds']}s", flush=True)
        for s in r["steps"]:
            sym = "✓" if s["success"] else "✗"
            print(f"    {sym} Step #{s['step']}: {s['title']} ({s['elapsed_seconds']}s){' -> ' + s['error'] if s['error'] else ''}", flush=True)

    # Summary
    total_score = sum(r["score"] for r in all_results) / len(all_results) if all_results else 0
    print(f"\n=== Summary ===")
    print(f"Scenarios: {len(all_results)}")
    print(f"Average Score: {total_score:.3f}")

    # Write results file
    with open("experiment_results.json", "w") as f:
        json.dump({"scenarios": all_results, "average_score": round(total_score, 3)}, f, indent=2)
    print("Results written to experiment_results.json")


if __name__ == "__main__":
    run_all()
