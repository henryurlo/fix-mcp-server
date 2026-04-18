# Claude Code Instructions — FIX-MCP Simulation Ecosystem Build

Read /data/.openclaw/workspace/SPEC.md first for full context. Your job is to build the new simulation ecosystem components for the FIX-MCP project.

## IMPORTANT RULES
1. Read SPEC.md before writing any code
2. Work in /data/.openclaw/workspace/fix-mcp-server/
3. All new code goes in src/fix_mcp/engine/
4. Follow existing code style (imports, naming, threading patterns from existing files)
5. Keep the MCP server (server.py) and REST API (api.py) working — don't break existing tools
6. Write real, working code — no stubs or placeholders
7. After building each component, verify it imports cleanly

## PHASE 1 — Build these components:

### A) exchange_sim.py — asyncio FIX engine simulator per venue
File: src/fix_mcp/engine/exchange_sim.py

- Class: ExchangeSimulator
- Implements FIX 4.2 subset: Logon(A), Heartbeat(A), NewOrderSingle(D), ExecutionReport(8), MarketDataSnapshot(W), Logout(F)
- Each exchange runs on a unique port (9001+, configurable via __init__)
- Generates realistic bid/ask quotes for configured symbols using a simple price model with random walk
- Accepts FIX connections (asyncio TCP server using asyncio.start_server)
- Emits market data updates at configurable intervals (default 100ms per symbol)
- Supports fault injection: delay (hold messages), disconnect (close connections), corrupt (flip bytes)
- Exposes: start(), stop(), inject_fault(fault_type, params), get_status()

Price model: base price from config, tick_size=0.01, spread=0.01-0.05, random walk ±0.05%

### B) broker_host.py — central FIX broker
File: src/fix_mcp/engine/broker_host.py

- Class: BrokerHost
- FIX acceptor for client connections on port 8001
- FIX initiator connections to each exchange simulator (ExchangeSimulator)
- Smart order router: routes to venue with best price (lowest ask for buy, highest bid for sell)
- Interlisted name resolver using InterlistResolver (you'll build this too)
- Maintains OMS state (integrates with existing OMS class from oms.py)
- Publishes events to Redis pub/sub channel 'broker_events'
- Exposes: start(), stop(), route_order(order), get_broker_status()

### C) market_data.py — market data hub with fault injection
File: src/fix_mcp/engine/market_data.py

- Class: MarketDataHub
- Generates realistic price ticks for all symbols (using same price model as ExchangeSimulator)
- Maintains order book depth simulation (bid/ask with 5 levels each)
- FX rate feed: CAD/USD, GBP/USD, EUR/USD, PEN/USD
- Fault injection methods:
  - delay_venue(venue, delay_ms)
  - disconnect_venue(venue)
  - corrupt_fx_rate(pair, wrong_rate)
  - reset_feed(venue)
- Methods: subscribe(venue), get_quote(symbol), get_fx_rate(pair), get_all_quotes()
- Publishes quotes to Redis channel 'market_data'

### D) interlist.py — interlisted security mapping
File: src/fix_mcp/engine/interlist.py

- Class: InterlistResolver
- Preloaded with known interlistings (hardcoded in __init__):
  - AAPL ↔ AAPL.TO
  - RY ↔ RY.TO ↔ RY.B
  - TD ↔ TD.TO
  - BP ↔ BP.L ↔ BPA.L
  - SHELL ↔ SHEL.L
  - GOOG ↔ GOOG.TO
  - AMZN ↔ AMZN.TO
- Methods:
  - resolve(symbol, target_venue) → canonical symbol for that venue
  - get_venuemap(symbol) → dict mapping venues to symbols
  - is_interlisted(symbol) → bool

### E) telemetry.py — telemetry collector
File: src/fix_mcp/engine/telemetry.py

- Class: TelemetryCollector
- Polls all engines for: heartbeat age (seconds since last hb), sequence numbers, latency (ms), message rates (msgs/sec)
- Stores current metrics in Redis (hash key 'telemetry:current')
- Methods: get_snapshot() → dict of all metrics, get_engine_health(engine_name)
- Thread-safe (uses threading.Lock like existing code)

### F) scenario_engine_v2.py — extended scenario engine
File: src/fix_mcp/engine/scenario_engine_v2.py

- Class: ScenarioEngineV2
- Loads scenario JSON files from config/scenarios_v2/
- Scenario JSON schema:
```json
{
  "name": "scenario_id",
  "title": "Human Readable Title",
  "description": "What this simulates",
  "background": "Business context for the SRE/LLM",
  "steps": [{"step": 1, "action": "...", "expected_state": "..."}],
  "injections": [{"component": "market_data", "fault": "delay", "venue": "XNYS", "duration_ms": 30000}],
  "resolve_actions": ["reset_feed", "reconnect_session"]
}
```
- Methods:
  - trigger_scenario(name) → injects faults, publishes Redis event, returns scenario state
  - resolve_scenario(name) → clears faults, publishes resolution
  - get_active_scenarios() → list of active scenario objects
  - list_available() → all scenario definitions (summary)
- Publishes to Redis channel 'scenario_events'
- Integrates with MarketDataHub, BrokerHost

### G) New scenario JSON files
Create directory: config/scenarios_v2/

Create these JSON files (one per new scenario):
- market_data_delay.json
- market_data_disconnect.json
- fx_feed_corruption.json
- interlisted_name_mismatch.json
- exchange_session_drop.json
- broker_routing_failure.json
- auth_storm.json
- latency_spike.json

Each should follow the schema in F. Be specific about fault parameters.

### H) Update docker-compose.yml
- Add broker_host service (port 8001, depends on redis, postgres)
- Add market_data service (port 8002, depends on redis)
- All new services use the same Python image
- Set environment: FIX_MCP_CONFIG_DIR=/app/config

## VERIFICATION
After building, run:
```
cd /data/.openclaw/workspace/fix-mcp-server && python -c "from fix_mcp.engine import exchange_sim, broker_host, market_data, interlist, telemetry, scenario_engine_v2; print('All imports OK')"
```

If import errors, fix them. Do NOT leave broken imports.

## STYLE
- Use asyncio for I/O, threading.Lock for thread-safe shared state
- Use type hints (Python 3.11+)
- Docstrings on all public methods
- No external dependencies beyond what's already in pyproject.toml
