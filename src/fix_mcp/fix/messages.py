"""FIX Message Builder — generates authentic FIX 4.2 messages.

All public methods return a dict with three keys:

* ``"raw"``       — pipe-delimited FIX string (``|`` as SOH substitute)
* ``"formatted"`` — human-readable tag-per-line representation
* ``"fields"``    — ``dict[int, str]`` of every tag present in the message
"""

import uuid
from datetime import datetime
from typing import Optional

from fix_mcp.fix.protocol import (
    calculate_body_length,
    calculate_checksum,
    format_fix_timestamp,
)
from fix_mcp.fix.tags import TAG_NAMES, FIXTags


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_SOH = "\x01"
_PIPE = "|"

# Maps friendly venue names to ISO 10383 MIC codes.
_VENUE_MIC: dict[str, str] = {
    "NYSE": "XNYS",
    "ARCA": "ARCX",
    "BATS": "BATS",
    "IEX": "IEXG",
}

# Human-readable names for MsgType values (tag 35).
_MSG_TYPE_NAMES: dict[str, str] = {
    "0": "Heartbeat",
    "A": "Logon",
    "5": "Logout",
    "2": "ResendRequest",
    "4": "SequenceReset",
    "D": "NewOrderSingle",
    "F": "OrderCancelRequest",
    "G": "OrderCancelReplaceRequest",
    "8": "ExecutionReport",
}


# ---------------------------------------------------------------------------
# Builder
# ---------------------------------------------------------------------------


class FIXMessageBuilder:
    """Builds well-formed FIX 4.2 messages.

    Args:
        sender_comp_id: Value for tag 49 (SenderCompID).
        target_comp_id: Value for tag 56 (TargetCompID).
        session_manager: Optional object exposing a ``next_seq() -> int``
                         method.  When provided its sequence counter is used;
                         otherwise every message is numbered ``1``.
    """

    def __init__(
        self,
        sender_comp_id: str,
        target_comp_id: str,
        session_manager=None,
    ) -> None:
        self.sender_comp_id = sender_comp_id
        self.target_comp_id = target_comp_id
        self.session_manager = session_manager

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _next_seq(self) -> int:
        """Return the next outbound sequence number."""
        if self.session_manager is not None:
            return self.session_manager.next_seq()
        return 1

    @staticmethod
    def _venue_to_mic(venue: Optional[str]) -> Optional[str]:
        """Convert a friendly venue name to its MIC code.

        If *venue* is already a known MIC (value in ``_VENUE_MIC``) it is
        returned unchanged.  If it matches a known friendly name, the
        corresponding MIC is returned.  Otherwise the value is returned as-is
        so that callers can pass raw MIC codes directly.

        Args:
            venue: Friendly venue name, e.g. ``"NYSE"``, or ``None``.

        Returns:
            MIC code string, or ``None`` if *venue* was ``None``.
        """
        if venue is None:
            return None
        upper = venue.upper()
        return _VENUE_MIC.get(upper, upper)

    @staticmethod
    def _format_price(price: float) -> str:
        """Format a price value as a FIX-compatible string."""
        return f"{price:.6f}".rstrip("0").rstrip(".")

    @staticmethod
    def _generate_exec_id() -> str:
        """Generate a unique execution ID."""
        return f"EXEC-{uuid.uuid4().hex[:12].upper()}"

    # ------------------------------------------------------------------
    # Core assembly
    # ------------------------------------------------------------------

    def _build_message(
        self,
        msg_type: str,
        fields: dict[int, str],
        venue: Optional[str] = None,  # noqa: ARG002  (reserved for future use)
    ) -> dict:
        """Assemble a complete FIX 4.2 message.

        Steps
        -----
        1. Build the body — tag 35 through the last application field — as a
           SOH-delimited string.
        2. Calculate ``BodyLength`` (tag 9) from the body byte count.
        3. Prepend tags 8 and 9 to form the full pre-checksum string.
        4. Calculate ``CheckSum`` (tag 10) over the full string.
        5. Append tag 10 to finalise the wire message.

        The *fields* dict must **not** include tags 8, 9, 35, 34, 49, 52, 56,
        or 10 — these are all managed here.

        Args:
            msg_type: FIX MsgType value (tag 35), e.g. ``"D"``.
            fields:   ``dict[int, str]`` of application / session body tags.
            venue:    Currently unused; reserved for per-venue FIX version
                      selection.

        Returns:
            A dict with keys ``"raw"`` (pipe-delimited string),
            ``"formatted"`` (human-readable multi-line string), and
            ``"fields"`` (``dict[int, str]`` of every tag in the message).
        """
        seq = self._next_seq()
        timestamp = format_fix_timestamp()

        # Standard header fields that appear in the body-length calculation
        # (i.e. everything after tag 8= and 9=).
        header_body_fields: dict[int, str] = {
            FIXTags.MsgType: msg_type,
            FIXTags.SenderCompID: self.sender_comp_id,
            FIXTags.TargetCompID: self.target_comp_id,
            FIXTags.MsgSeqNum: str(seq),
            FIXTags.SendingTime: timestamp,
        }

        # Merge header body fields with application fields.  Header fields
        # come first; application fields follow in iteration order.
        body_fields: dict[int, str] = {**header_body_fields, **fields}

        # Build the SOH-delimited body string (35= through last field).
        body_str = "".join(f"{tag}={value}{_SOH}" for tag, value in body_fields.items())

        body_length = calculate_body_length(body_str)

        # Build the full message prefix (8= and 9= are excluded from checksum
        # according to the spec — they ARE included in the byte stream that
        # the checksum covers, so we build the complete pre-checksum string).
        prefix = f"8=FIX.4.2{_SOH}9={body_length}{_SOH}"
        pre_checksum = prefix + body_str

        checksum = calculate_checksum(pre_checksum)
        raw_soh = pre_checksum + f"10={checksum}{_SOH}"

        # Build pipe-delimited version for human consumption
        raw_pipe = raw_soh.replace(_SOH, _PIPE)

        # Collect all fields for the return dict (ordered for readability)
        all_fields: dict[int, str] = {
            FIXTags.BeginString: "FIX.4.2",
            FIXTags.BodyLength: str(body_length),
            **body_fields,
            FIXTags.CheckSum: checksum,
        }

        formatted = self._format_message(all_fields)

        return {
            "raw": raw_pipe,
            "formatted": formatted,
            "fields": all_fields,
        }

    @staticmethod
    def _format_message(fields: dict[int, str]) -> str:
        """Render *fields* as a human-readable multi-line string.

        Format per line::

            {tag:<3} ({name:<20}) = {value}

        For tag 35 (MsgType) the message-type name is appended to the value.

        Args:
            fields: Ordered dict of tag-number -> value.

        Returns:
            Multi-line string.
        """
        lines: list[str] = []
        for tag, value in fields.items():
            name = TAG_NAMES.get(tag, f"Tag{tag}")
            if tag == FIXTags.MsgType:
                type_name = _MSG_TYPE_NAMES.get(value, value)
                display_value = f"{value} ({type_name})"
            else:
                display_value = value
            lines.append(f"{tag:<3} ({name:<20}) = {display_value}")
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Public message constructors
    # ------------------------------------------------------------------

    def build_new_order_single(
        self,
        cl_ord_id: str,
        symbol: str,
        side: str,
        quantity: int,
        order_type: str,
        venue: str,
        price: Optional[float] = None,
        stop_px: Optional[float] = None,
    ) -> dict:
        """Build a New Order Single (MsgType D).

        Args:
            cl_ord_id:  Client order ID (tag 11).
            symbol:     Instrument ticker (tag 55).
            side:       ``"1"`` (buy) or ``"2"`` (sell) (tag 54).
            quantity:   Order quantity (tag 38).
            order_type: ``"1"`` market, ``"2"`` limit, ``"3"`` stop
                        (tag 40).
            venue:      Destination venue name or MIC code (tag 100).
            price:      Limit price — required when *order_type* is
                        ``"2"`` (tag 44).
            stop_px:    Stop price — required when *order_type* is
                        ``"3"`` (tag 99).

        Returns:
            Message dict with ``"raw"``, ``"formatted"``, and ``"fields"``.
        """
        fields: dict[int, str] = {
            FIXTags.ClOrdID: cl_ord_id,
            FIXTags.HandlInst: "1",
            FIXTags.Symbol: symbol.upper(),
            FIXTags.Side: str(side),
            FIXTags.TransactTime: format_fix_timestamp(),
            FIXTags.OrderQty: str(quantity),
            FIXTags.OrdType: str(order_type),
        }
        if price is not None:
            fields[FIXTags.Price] = self._format_price(price)
        if stop_px is not None:
            fields[FIXTags.StopPx] = self._format_price(stop_px)
        mic = self._venue_to_mic(venue)
        if mic is not None:
            fields[FIXTags.ExDestination] = mic
        return self._build_message(FIXTags.MsgTypes.NewOrderSingle, fields, venue)

    def build_order_cancel_request(
        self,
        cl_ord_id: str,
        orig_cl_ord_id: str,
        symbol: str,
        side: str,
        quantity: int,
        venue: str,
    ) -> dict:
        """Build an Order Cancel Request (MsgType F).

        Args:
            cl_ord_id:       New client order ID for the cancel (tag 11).
            orig_cl_ord_id:  Original client order ID being cancelled
                             (tag 41).
            symbol:          Instrument ticker (tag 55).
            side:            ``"1"`` or ``"2"`` (tag 54).
            quantity:        Original order quantity (tag 38).
            venue:           Destination venue (tag 100).

        Returns:
            Message dict.
        """
        mic = self._venue_to_mic(venue)
        fields: dict[int, str] = {
            FIXTags.OrigClOrdID: orig_cl_ord_id,
            FIXTags.ClOrdID: cl_ord_id,
            FIXTags.Symbol: symbol.upper(),
            FIXTags.Side: str(side),
            FIXTags.TransactTime: format_fix_timestamp(),
            FIXTags.OrderQty: str(quantity),
        }
        if mic is not None:
            fields[FIXTags.ExDestination] = mic
        return self._build_message(FIXTags.MsgTypes.OrderCancelRequest, fields, venue)

    def build_order_cancel_replace(
        self,
        cl_ord_id: str,
        orig_cl_ord_id: str,
        symbol: str,
        side: str,
        quantity: int,
        venue: str,
        price: Optional[float] = None,
        new_symbol: Optional[str] = None,
    ) -> dict:
        """Build an Order Cancel/Replace Request (MsgType G).

        Args:
            cl_ord_id:       New client order ID (tag 11).
            orig_cl_ord_id:  Original client order ID (tag 41).
            symbol:          Current instrument ticker (tag 55), unless
                             *new_symbol* overrides it.
            side:            ``"1"`` or ``"2"`` (tag 54).
            quantity:        Revised order quantity (tag 38).
            venue:           Destination venue (tag 100).
            price:           Revised limit price (tag 44), optional.
            new_symbol:      If provided, replaces *symbol* as tag 55.

        Returns:
            Message dict.
        """
        effective_symbol = (new_symbol or symbol).upper()
        mic = self._venue_to_mic(venue)
        fields: dict[int, str] = {
            FIXTags.OrigClOrdID: orig_cl_ord_id,
            FIXTags.ClOrdID: cl_ord_id,
            FIXTags.HandlInst: "1",
            FIXTags.Symbol: effective_symbol,
            FIXTags.Side: str(side),
            FIXTags.TransactTime: format_fix_timestamp(),
            FIXTags.OrderQty: str(quantity),
            FIXTags.OrdType: "2" if price is not None else "1",
        }
        if price is not None:
            fields[FIXTags.Price] = self._format_price(price)
        if mic is not None:
            fields[FIXTags.ExDestination] = mic
        return self._build_message(
            FIXTags.MsgTypes.OrderCancelReplaceRequest, fields, venue
        )

    def build_resend_request(self, begin_seq: int, end_seq: int) -> dict:
        """Build a Resend Request (MsgType 2).

        Args:
            begin_seq: First sequence number to resend (tag 7).
            end_seq:   Last sequence number to resend (tag 16).  Use
                       ``0`` to request all messages from *begin_seq*
                       onward (open-ended resend).

        Returns:
            Message dict.
        """
        fields: dict[int, str] = {
            FIXTags.BeginSeqNo: str(begin_seq),
            FIXTags.EndSeqNo: str(end_seq),
        }
        return self._build_message(FIXTags.MsgTypes.ResendRequest, fields)

    def build_sequence_reset(
        self, new_seq: int, gap_fill: bool = False
    ) -> dict:
        """Build a Sequence Reset (MsgType 4).

        Args:
            new_seq:   The sequence number the receiver should expect next
                       (tag 36).
            gap_fill:  When ``True``, sets GapFillFlag (tag 123) to ``"Y"``,
                       indicating this reset covers a gap in the sequence
                       stream rather than a hard reset.

        Returns:
            Message dict.
        """
        fields: dict[int, str] = {
            FIXTags.NewSeqNo: str(new_seq),
        }
        if gap_fill:
            fields[FIXTags.GapFillFlag] = "Y"
        return self._build_message(FIXTags.MsgTypes.SequenceReset, fields)

    def build_logon(self, heartbeat_interval: int = 30) -> dict:
        """Build a Logon message (MsgType A).

        Args:
            heartbeat_interval: HeartBtInt in seconds (tag 108).
                                Defaults to 30.  EncryptMethod (tag 98)
                                is always set to ``"0"`` (no encryption).

        Returns:
            Message dict.
        """
        fields: dict[int, str] = {
            98: "0",    # EncryptMethod = no encryption
            108: str(heartbeat_interval),
        }
        return self._build_message(FIXTags.MsgTypes.Logon, fields)

    def build_execution_report(
        self,
        order_id: str,
        cl_ord_id: str,
        exec_type: str,
        ord_status: str,
        symbol: str,
        side: str,
        quantity: int,
        filled_qty: int,
        leaves_qty: int,
        avg_px: float = 0.0,
    ) -> dict:
        """Build an Execution Report (MsgType 8).

        Args:
            order_id:   Broker/exchange assigned order ID (tag 37).
            cl_ord_id:  Client order ID (tag 11).
            exec_type:  Execution type code (tag 150), e.g. ``"0"`` (new),
                        ``"1"`` (partial fill), ``"2"`` (fill), ``"4"``
                        (canceled).
            ord_status: Order status code (tag 39).
            symbol:     Instrument ticker (tag 55).
            side:       ``"1"`` (buy) or ``"2"`` (sell) (tag 54).
            quantity:   Total order quantity (tag 38).
            filled_qty: Cumulative filled quantity (tag 14).
            leaves_qty: Remaining open quantity (tag 151).
            avg_px:     Volume-weighted average fill price (tag 6).
                        Defaults to ``0.0``.

        Returns:
            Message dict.
        """
        exec_id = self._generate_exec_id()
        fields: dict[int, str] = {
            FIXTags.OrderID: order_id,
            FIXTags.ExecID: exec_id,
            FIXTags.ExecType: str(exec_type),
            FIXTags.OrdStatus: str(ord_status),
            FIXTags.Symbol: symbol.upper(),
            FIXTags.Side: str(side),
            FIXTags.OrderQty: str(quantity),
            FIXTags.CumQty: str(filled_qty),
            FIXTags.LeavesQty: str(leaves_qty),
            FIXTags.AvgPx: self._format_price(avg_px),
            FIXTags.ClOrdID: cl_ord_id,
            FIXTags.TransactTime: format_fix_timestamp(),
        }
        return self._build_message(FIXTags.MsgTypes.ExecutionReport, fields)
