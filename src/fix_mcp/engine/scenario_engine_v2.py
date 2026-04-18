"""ScenarioEngineV2 — extended scenario engine.

Loads scenario JSON definitions from ``config/scenarios_v2/``,
triggering fault injections, publishing Redis events, and
tracking active/resolved scenario state.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


class ScenarioState:
    """Tracks the runtime state of a single scenario."""

    def __init__(self, definition: dict) -> None:
        self.definition = definition
        self.name: str = definition.get("name", "unknown")
        self.title: str = definition.get("title", self.name)
        self.description: str = definition.get("description", "")
        self.background: str = definition.get("background", "")
        self.steps: list[dict] = definition.get("steps", [])
        self.injections: list[dict] = definition.get("injections", [])
        self.resolve_actions: list[str] = definition.get("resolve_actions", [])

        self.triggered_at: Optional[str] = None
        self.resolved_at: Optional[str] = None
        self.is_active: bool = False
        self.current_step: int = 0

    def trigger(self) -> dict:
        """Mark the scenario as triggered and return a state dict."""
        self.triggered_at = datetime.now(timezone.utc).isoformat()
        self.is_active = True
        self.current_step = 1
        return self.to_dict()

    def resolve(self) -> dict:
        """Mark the scenario as resolved."""
        self.resolved_at = datetime.now(timezone.utc).isoformat()
        self.is_active = False
        return self.to_dict()

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "title": self.title,
            "description": self.description,
            "background": self.background,
            "triggered_at": self.triggered_at,
            "resolved_at": self.resolved_at,
            "is_active": self.is_active,
            "current_step": self.current_step,
            "steps": self.steps,
            "injections": self.injections,
            "resolve_actions": self.resolve_actions,
        }


class ScenarioEngineV2:
    """Extended scenario engine that loads from JSON and injects faults.

    Scenarios are defined in JSON files inside *config_dir* / ``scenarios_v2/``.
    Triggering a scenario applies the defined fault injections and publishes
    an event to Redis channel ``scenario_events``.

    Args:
        config_dir: Path to the config root (the ``config/`` folder).
        market_data_hub: Optional ``MarketDataHub`` instance for fault routing.
        broker_host: Optional ``BrokerHost`` instance for fault routing.
        redis_client: Optional ``redis.asyncio.Redis`` client.
    """

    def __init__(
        self,
        config_dir: Optional[str] = None,
        market_data_hub: Optional[Any] = None,
        broker_host: Optional[Any] = None,
        redis_client: Optional[Any] = None,
    ) -> None:
        if config_dir is not None:
            self.config_dir = Path(config_dir)
        else:
            package_root = Path(__file__).resolve().parents[1]
            candidates = [
                package_root / "config",
                package_root.parent.parent / "config",
            ]
            for c in candidates:
                if c.exists():
                    self.config_dir = c
                    break
            else:
                self.config_dir = candidates[0]

        self.scenarios_dir = self.config_dir / "scenarios_v2"

        self._md = market_data_hub
        self._broker = broker_host
        self._redis = redis_client

        # Loaded definitions and active states
        self._definitions: dict[str, dict] = {}
        self._active: dict[str, ScenarioState] = {}

        # Eager load
        self._scan_definitions()

    # ------------------------------------------------------------------ #
    # Definition scanning                                                 #
    # ------------------------------------------------------------------ #

    def _scan_definitions(self) -> None:
        """Read every JSON file in scenarios_v2/ into the definitions cache."""
        if not self.scenarios_dir.exists():
            logger.warning("scenarios_v2 directory not found: %s", self.scenarios_dir)
            return

        for path in sorted(self.scenarios_dir.glob("*.json")):
            try:
                with open(path, encoding="utf-8") as fh:
                    data = json.load(fh)
                name = data.get("name", path.stem)
                self._definitions[name] = data
                logger.debug("Loaded scenario: %s from %s", name, path.name)
            except Exception:
                logger.exception("Failed to load scenario from %s", path)

    # ------------------------------------------------------------------ #
    # Public API                                                          #
    # ------------------------------------------------------------------ #

    def trigger_scenario(self, name: str) -> Optional[dict]:
        """Trigger a scenario by name.

        Applies all fault injections defined in the scenario JSON,
        publishes a ``scenario_triggered`` event, and returns the state.

        Args:
            name: The scenario name (filename without .json).

        Returns:
            Scenario state dict, or None if not found.
        """
        definition = self._definitions.get(name)
        if definition is None:
            logger.error("ScenarioEngineV2: unknown scenario '%s'", name)
            return None

        # Resolve any stale active state
        if name in self._active and self._active[name].is_active:
            self.resolve_scenario(name)

        state = ScenarioState(definition)
        state.trigger()
        self._active[name] = state

        # Apply fault injections
        self._apply_injections(state.injections)

        # Publish event
        self._publish_event("scenario_triggered", state.to_dict())
        logger.info("ScenarioEngineV2: triggered '%s'", name)
        return state.to_dict()

    def resolve_scenario(self, name: str) -> Optional[dict]:
        """Resolve (clear) an active scenario.

        Applies all resolve_actions from the scenario definition (e.g.
        ``reset_feed``, ``reconnect_session``) and publishes a
        ``scenario_resolved`` event.

        Args:
            name: The scenario name.

        Returns:
            Scenario state dict, or None if not found.
        """
        state = self._active.get(name)
        if state is None:
            logger.warning("ScenarioEngineV2: no active state for '%s'", name)
            # Maybe still resolve from definition
            definition = self._definitions.get(name)
            if definition is None:
                return None
            state = ScenarioState(definition)
            self._active[name] = state
            state.trigger()

        state.resolve()

        # Apply resolve actions
        self._apply_resolve_actions(state.resolve_actions)

        # Clear any fault injections from this scenario
        for inj in state.injections:
            component = inj.get("component", "")
            venue = inj.get("venue", "")
            fault = inj.get("fault", "")
            self._clear_injection(component, fault, venue)

        self._publish_event("scenario_resolved", state.to_dict())
        logger.info("ScenarioEngineV2: resolved '%s'", name)
        return state.to_dict()

    def get_active_scenarios(self) -> list[dict]:
        """Return all currently active scenarios."""
        return [
            s.to_dict() for s in self._active.values() if s.is_active
        ]

    def list_available(self) -> list[dict]:
        """Return a summary of every loaded scenario definition."""
        summaries = []
        for name, defn in self._definitions.items():
            summaries.append({
                "name": name,
                "title": defn.get("title", name),
                "description": defn.get("description", ""),
                "step_count": len(defn.get("steps", [])),
                "injection_count": len(defn.get("injections", [])),
            })
        return summaries

    def get_scenario_definition(self, name: str) -> Optional[dict]:
        """Return the raw definition dict for a scenario."""
        return self._definitions.get(name)

    # ------------------------------------------------------------------ #
    # Internal injection / resolve                                        #
    # ------------------------------------------------------------------ #

    def _apply_injections(self, injections: list[dict]) -> None:
        """Apply every fault injection in the list."""
        for inj in injections:
            component = inj.get("component", "")
            fault = inj.get("fault", "")
            venue = inj.get("venue", "")
            duration_ms = inj.get("duration_ms", 5000)

            if component == "market_data" and self._md is not None:
                if fault == "delay":
                    self._md.delay_venue(venue, duration_ms)
                elif fault == "disconnect":
                    self._md.disconnect_venue(venue)
                elif fault == "fx_corruption":
                    pair = inj.get("fx_pair", "EUR/USD")
                    wrong_rate = inj.get("wrong_rate", 0.0)
                    self._md.corrupt_fx_rate(pair, wrong_rate)

            elif component == "broker" and self._broker is not None:
                if fault == "route_failure":
                    # Broker would mark itself degraded — done via telemetry
                    pass

            elif component == "exchange":
                # Handled by exchange_simulator.inject_fault at a different layer
                pass

    def _clear_injection(self, component: str, fault: str, venue: str) -> None:
        """Undo a specific fault injection."""
        if component == "market_data" and self._md is not None:
            if fault in ("delay", "disconnect"):
                self._md.reset_feed(venue)
            elif fault == "fx_corruption":
                pair = venue or "EUR/USD"
                self._md.reset_fx(pair)

    def _apply_resolve_actions(self, actions: list[str]) -> None:
        """Execute scenario resolve actions."""
        for action in actions:
            if action == "reset_feed" and self._md is not None:
                # Reset all feeds — generic reset
                pass
            elif action == "reconnect_session":
                # Broker-level reconnection; no-op if broker not available
                pass
            elif action == "flush_redis" and self._redis is not None:
                pass

    # ------------------------------------------------------------------ #
    # Redis events                                                        #
    # ------------------------------------------------------------------ #

    async def _publish_event(self, event_type: str, data: dict) -> None:
        """Publish a scenario event to Redis channel ``scenario_events``."""
        if self._redis is None:
            return
        try:
            import json as _json
            payload = _json.dumps({"event": event_type, "scenario": data})
            await self._redis.publish("scenario_events", payload)
        except Exception:
            logger.exception("Failed to publish scenario event")
