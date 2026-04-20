"""Scenario engine: loads JSON scenario files and populates OMS, FIXSessionManager,
and ReferenceDataStore with pre-seeded demo state."""

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

from fix_mcp.engine.oms import OMS, Order
from fix_mcp.engine.fix_sessions import FIXSessionManager, FIXSession
from fix_mcp.engine.reference import (
    ReferenceDataStore,
    Symbol,
    CorporateAction,
    Venue,
    Client,
)
from fix_mcp.engine.algos import AlgoEngine, AlgoOrder


def _rebase_today(ts: str) -> str:
    """Replace the date portion of an ISO-8601 timestamp with today's date.

    Scenario JSON files use hardcoded dates (e.g. 2026-03-28). When a scenario
    is loaded we rebase all order timestamps to today so SLA timers start fresh
    and the pre-market check doesn't immediately show 2,000-minute breaches.
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    # Replace the leading date (YYYY-MM-DD) portion, keep the time part
    return re.sub(r"^\d{4}-\d{2}-\d{2}", today, ts)


_REL_TS_RE = re.compile(r"^-(\d+)([smh])$")


def resolve_relative_timestamp(value, now=None):
    """Convert a relative timestamp like ``"-90s"`` / ``"-5m"`` / ``"-2h"`` to
    an absolute ISO-8601 string.  Passes non-matching strings and ``None``
    through unchanged.

    Args:
        value: The value to resolve.  If it matches the pattern ``-<n><unit>``
            where unit is ``s``, ``m``, or ``h``, it is converted.  Otherwise
            it is returned as-is.
        now: Optional ``datetime`` to treat as "now"; defaults to
            ``datetime.now(timezone.utc)``.

    Returns:
        An ISO-8601 string or the original value unchanged.
    """
    if not isinstance(value, str):
        return value
    m = _REL_TS_RE.match(value)
    if m:
        n = int(m.group(1))
        unit = m.group(2)
        seconds = {"s": 1, "m": 60, "h": 3600}[unit] * n
        base = now or datetime.now(timezone.utc)
        return (base - timedelta(seconds=seconds)).isoformat()
    if value.startswith("-"):
        raise ValueError(
            f"Unrecognized relative timestamp {value!r}. "
            "Expected format: -<n>s / -<n>m / -<n>h (e.g., '-90s', '-5m', '-2h')."
        )
    return value


class ScenarioEngine:
    """Loads a named scenario from JSON and returns populated engine objects.

    The engine resolves all paths relative to *config_dir*, which defaults
    to the ``config/`` directory inside the installed package tree.  For
    development layouts (running directly from the repo) the default resolves
    to ``fix-mcp-server/config/``.

    Args:
        config_dir: Absolute or relative path to the config root directory.
            If ``None``, defaults to ``config/`` relative to the package root.
    """

    def __init__(self, config_dir: Optional[str] = None) -> None:
        if config_dir is not None:
            self.config_dir = Path(config_dir)
        else:
            package_root = Path(__file__).resolve().parents[1]
            candidate_dirs = [
                package_root / "config",
                package_root.parent.parent / "config",
            ]
            for candidate in candidate_dirs:
                if candidate.exists():
                    self.config_dir = candidate
                    break
            else:
                self.config_dir = candidate_dirs[0]
        # Populated by load_scenario(); access via engine.algo_engine
        self.algo_engine: AlgoEngine = AlgoEngine()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def load_scenario(
        self, scenario_name: str, market_data_hub=None
    ) -> tuple[OMS, FIXSessionManager, ReferenceDataStore]:
        """Load a named scenario and return fully populated engine objects.

        Reads:
        - ``config/scenarios/{scenario_name}.json`` — sessions + orders
        - ``config/venues.json`` — venue reference data
        - ``config/clients.json`` — client reference data
        - ``config/reference_data.json`` — symbols + corporate actions

        Args:
            scenario_name: Scenario filename without the ``.json`` extension,
                e.g. ``"morning_triage"``.

        Returns:
            A 3-tuple of ``(OMS, FIXSessionManager, ReferenceDataStore)``,
            each pre-populated with the scenario's data.

        Raises:
            FileNotFoundError: If any required JSON file is missing.
            json.JSONDecodeError: If a JSON file is malformed.
            KeyError: If required fields are absent in the JSON data.
        """
        scenario_path = self.config_dir / "scenarios" / f"{scenario_name}.json"
        venues_path = self.config_dir / "venues.json"
        clients_path = self.config_dir / "clients.json"
        ref_data_path = self.config_dir / "reference_data.json"

        scenario_data = self._read_json(scenario_path)
        venues_data = self._read_json(venues_path)
        clients_data = self._read_json(clients_path)
        ref_data = self._read_json(ref_data_path)

        oms = OMS()
        session_mgr = FIXSessionManager()
        ref_store = ReferenceDataStore()

        self._load_venues(ref_store, venues_data)
        self._load_clients(ref_store, clients_data)
        self._load_reference_data(ref_store, ref_data)
        self._load_sessions(session_mgr, scenario_data.get("sessions", []))
        self._load_orders(oms, scenario_data.get("orders", []), ref_store)

        self.algo_engine = AlgoEngine()
        self._load_algo_orders(
            self.algo_engine, scenario_data.get("algo_orders", []), ref_store
        )

        self._apply_injections(market_data_hub, scenario_data.get("injections", []))

        return oms, session_mgr, ref_store

    # ------------------------------------------------------------------
    # Private loaders
    # ------------------------------------------------------------------

    def _apply_injections(self, market_data_hub, injections: list) -> None:
        """Apply scenario injections to runtime objects.

        Currently handles ``type: "market_data.delay"`` which calls
        ``market_data_hub.delay_venue(venue, delay_ms)``.  Unknown injection
        types are silently skipped.

        Args:
            market_data_hub: The :class:`MarketDataHub` instance, or ``None``
                if no hub is available.
            injections: List of injection dicts from the scenario JSON.
        """
        if not injections or market_data_hub is None:
            return
        for inj in injections:
            itype = inj.get("type")
            args = inj.get("args", {})
            if itype == "market_data.delay":
                venue = args["venue"]
                delay_ms = int(args["delay_ms"])
                market_data_hub.delay_venue(venue, delay_ms)
            else:
                logger.warning("Unknown injection type %r — skipping", itype)

    def _load_reference_data(
        self, ref_store: ReferenceDataStore, data: dict
    ) -> None:
        """Populate *ref_store* with symbols and corporate actions.

        Args:
            ref_store: The :class:`ReferenceDataStore` to populate.
            data: Parsed content of ``reference_data.json``.
        """
        for sym_data in data.get("symbols", []):
            symbol = Symbol(
                symbol=sym_data["symbol"],
                cusip=sym_data["cusip"],
                name=sym_data["name"],
                listing_exchange=sym_data["listing_exchange"],
                lot_size=sym_data.get("lot_size", 100),
                tick_size=sym_data.get("tick_size", 0.01),
                status=sym_data.get("status", "active"),
                corporate_actions=[],
            )
            ref_store.add_symbol(symbol)

        for ca_data in data.get("corporate_actions", []):
            action = CorporateAction(
                action_id=ca_data["action_id"],
                action_type=ca_data["action_type"],
                effective_date=ca_data["effective_date"],
                old_symbol=ca_data.get("old_symbol"),
                new_symbol=ca_data.get("new_symbol"),
                ratio=ca_data.get("ratio"),
                description=ca_data.get("description", ""),
            )
            ref_store.add_corporate_action(action)

            # Link the corporate action reference onto the old symbol if present.
            if action.old_symbol:
                sym = ref_store.get_symbol(action.old_symbol)
                if sym is not None and action.action_id not in sym.corporate_actions:
                    sym.corporate_actions.append(action.action_id)

    def _load_venues(
        self, ref_store: ReferenceDataStore, data: list
    ) -> None:
        """Populate *ref_store* with venue objects.

        Args:
            ref_store: The :class:`ReferenceDataStore` to populate.
            data: Parsed content of ``venues.json`` (a list of venue dicts).
        """
        for v in data:
            venue = Venue(
                name=v["name"],
                mic_code=v["mic_code"],
                full_name=v["full_name"],
                supported_order_types=v.get("supported_order_types", []),
                trading_hours=v.get("trading_hours", ""),
                pre_market=v.get("pre_market", ""),
                fix_version=v.get("fix_version", "FIX.4.2"),
            )
            ref_store.add_venue(venue)

    def _load_clients(
        self, ref_store: ReferenceDataStore, data: list
    ) -> None:
        """Populate *ref_store* with client objects.

        Args:
            ref_store: The :class:`ReferenceDataStore` to populate.
            data: Parsed content of ``clients.json`` (a list of client dicts).
        """
        for c in data:
            client = Client(
                client_id=c["client_id"],
                name=c["name"],
                tier=c["tier"],
                sla_minutes=c.get("sla_minutes"),
                active=c.get("active", True),
            )
            ref_store.add_client(client)

    def _load_sessions(
        self, session_mgr: FIXSessionManager, sessions: list
    ) -> None:
        """Populate *session_mgr* with :class:`FIXSession` objects.

        Args:
            session_mgr: The :class:`FIXSessionManager` to populate.
            sessions: List of session dicts from the scenario JSON.
        """
        for s in sessions:
            session = FIXSession(
                venue=s["venue"],
                session_id=s["session_id"],
                sender_comp_id=s["sender_comp_id"],
                target_comp_id=s["target_comp_id"],
                fix_version=s.get("fix_version", "FIX.4.2"),
                status=s.get("status", "active"),
                last_sent_seq=s.get("last_sent_seq", 1),
                last_recv_seq=s.get("last_recv_seq", 1),
                expected_recv_seq=s.get("expected_recv_seq", 1),
                last_heartbeat=s.get("last_heartbeat"),
                latency_ms=s.get("latency_ms", 5),
                host=s.get("host", ""),
                port=s.get("port", 0),
                error=s.get("error"),
                connected_since=s.get("connected_since"),
                ack_delay_ms=int(s.get("ack_delay_ms", 0)),
            )
            session_mgr.add_session(session)

    def _load_orders(
        self,
        oms: OMS,
        orders: list,
        ref_store: ReferenceDataStore,
    ) -> None:
        """Populate *oms* with :class:`Order` objects.

        Institutional status is set from the order JSON directly.  When the
        JSON does not supply ``is_institutional``, it is inferred by looking
        up the client in *ref_store* and checking whether their tier is
        ``"institutional"``.

        Args:
            oms: The :class:`OMS` to populate.
            orders: List of order dicts from the scenario JSON.
            ref_store: Used for client-tier look-ups when ``is_institutional``
                is absent from the order dict.
        """
        for o in orders:
            # Resolve institutional flag: prefer explicit JSON value, then
            # fall back to client tier in ref_store.
            if "is_institutional" in o:
                is_institutional = bool(o["is_institutional"])
            else:
                client = ref_store.get_client(o.get("client_name", ""))
                is_institutional = (
                    client is not None and client.tier == "institutional"
                )

            # Resolve SLA minutes: prefer explicit JSON value, then look up
            # the client's configured SLA.
            if o.get("sla_minutes") is not None:
                sla_minutes = int(o["sla_minutes"])
            else:
                client = ref_store.get_client(o.get("client_name", ""))
                sla_minutes = client.sla_minutes if client is not None else None

            order = Order(
                order_id=o["order_id"],
                cl_ord_id=o["cl_ord_id"],
                symbol=o["symbol"],
                cusip=o.get("cusip", ""),
                side=o["side"],
                quantity=int(o["quantity"]),
                order_type=o["order_type"],
                venue=o["venue"],
                client_name=o["client_name"],
                created_at=_rebase_today(o["created_at"]),
                updated_at=_rebase_today(o.get("updated_at", o["created_at"])),
                filled_quantity=int(o.get("filled_quantity", 0)),
                price=float(o["price"]) if o.get("price") is not None else None,
                status=o.get("status", "new"),
                fix_messages=list(o.get("fix_messages", [])),
                flags=list(o.get("flags", [])),
                is_institutional=is_institutional,
                sla_minutes=sla_minutes,
                pending_since=resolve_relative_timestamp(o.get("pending_since")),
                stuck_reason=o.get("stuck_reason"),
            )
            oms.add_order(order)

    def _load_algo_orders(
        self,
        algo_engine: AlgoEngine,
        algo_orders: list,
        ref_store: ReferenceDataStore,
    ) -> None:
        """Populate *algo_engine* with :class:`AlgoOrder` objects from scenario JSON."""
        for a in algo_orders:
            if "is_institutional" in a:
                is_institutional = bool(a["is_institutional"])
            else:
                client = ref_store.get_client(a.get("client_name", ""))
                is_institutional = client is not None and client.tier == "institutional"

            if a.get("sla_minutes") is not None:
                sla_minutes = int(a["sla_minutes"])
            else:
                client = ref_store.get_client(a.get("client_name", ""))
                sla_minutes = client.sla_minutes if client is not None else None

            algo = AlgoOrder(
                algo_id=a["algo_id"],
                client_name=a["client_name"],
                symbol=a["symbol"],
                cusip=a.get("cusip", ""),
                side=a["side"],
                total_qty=int(a["total_qty"]),
                algo_type=a["algo_type"],
                start_time=a["start_time"],
                venue=a["venue"],
                created_at=a.get("created_at", a["start_time"]),
                updated_at=a.get("updated_at", a["start_time"]),
                end_time=a.get("end_time"),
                pov_rate=float(a["pov_rate"]) if a.get("pov_rate") is not None else None,
                total_slices=int(a.get("total_slices", 0)),
                completed_slices=int(a.get("completed_slices", 0)),
                executed_qty=int(a.get("executed_qty", 0)),
                avg_px=float(a["avg_px"]) if a.get("avg_px") is not None else None,
                arrival_px=float(a["arrival_px"]) if a.get("arrival_px") is not None else None,
                benchmark_px=float(a["benchmark_px"]) if a.get("benchmark_px") is not None else None,
                schedule_pct=float(a.get("schedule_pct", 0.0)),
                execution_pct=float(a.get("execution_pct", 0.0)),
                status=a.get("status", "running"),
                flags=list(a.get("flags", [])),
                child_order_ids=list(a.get("child_order_ids", [])),
                is_institutional=is_institutional,
                sla_minutes=sla_minutes,
                notes=a.get("notes", ""),
                md_freshness_gate_ms=a.get("md_freshness_gate_ms"),
            )
            algo_engine.add_algo(algo)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _read_json(path: Path) -> dict | list:
        """Read and parse a JSON file.

        Args:
            path: Filesystem path to the JSON file.

        Returns:
            Parsed JSON content (dict or list).

        Raises:
            FileNotFoundError: If *path* does not exist.
            json.JSONDecodeError: If *path* is not valid JSON.
        """
        if not path.exists():
            raise FileNotFoundError(
                f"Required config file not found: {path}"
            )
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
