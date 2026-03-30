"""FIX Protocol core logic: checksum, body length, sequence management, parsing."""

from datetime import datetime, timezone
from typing import Optional


def calculate_checksum(message_body: str) -> str:
    """Calculate the standard FIX checksum for a message body.

    The checksum is the sum of ASCII values of every byte in the message
    (from tag 8 through the final field before tag 10), modulo 256,
    zero-padded to 3 digits.

    Args:
        message_body: The complete message string from tag 8= through the last
                      field before tag 10=, with SOH (\\x01) as the delimiter.

    Returns:
        A 3-digit zero-padded string, e.g. "087".
    """
    total: int = sum(ord(ch) for ch in message_body)
    return f"{total % 256:03d}"


def calculate_body_length(message_body: str) -> int:
    """Calculate the FIX BodyLength (tag 9) value.

    BodyLength counts every byte from tag 35= through the end of the last
    field before tag 10=.  Tags 8=, 9=, and 10= are excluded.

    Each field occupies len("tag=value") + 1 bytes (the trailing SOH).

    Args:
        message_body: The portion of the FIX message starting at tag 35=,
                      with SOH (\\x01) as the field delimiter.

    Returns:
        Total byte count as an integer.
    """
    return len(message_body.encode("ascii"))


def format_fix_timestamp(dt: Optional[datetime] = None) -> str:
    """Format a datetime as a FIX UTC timestamp string.

    Args:
        dt: The datetime to format.  If None, ``datetime.utcnow()`` is used.

    Returns:
        A string in the form "YYYYMMDD-HH:MM:SS.mmm".
    """
    if dt is None:
        dt = datetime.now(timezone.utc).replace(tzinfo=None)
    milliseconds: int = dt.microsecond // 1000
    return dt.strftime("%Y%m%d-%H:%M:%S") + f".{milliseconds:03d}"


def parse_fix_message(raw: str) -> dict[str, str]:
    """Parse a FIX message into a dictionary of tag -> value pairs.

    Accepts both pipe-delimited (``|``) and SOH-delimited (``\\x01``) messages.

    Args:
        raw: The raw FIX message string.

    Returns:
        An ordered ``dict`` mapping tag numbers (as strings) to their values.
        Tags that appear more than once in the message will have their last
        value retained.
    """
    # Normalise delimiter: replace pipe with SOH so a single code path handles both
    normalised: str = raw.replace("|", "\x01")

    result: dict[str, str] = {}
    for field in normalised.split("\x01"):
        field = field.strip()
        if not field:
            continue
        separator_index: int = field.find("=")
        if separator_index == -1:
            # Malformed field — skip it
            continue
        tag: str = field[:separator_index]
        value: str = field[separator_index + 1:]
        result[tag] = value

    return result


class SequenceManager:
    """Manages FIX message sequence numbers.

    Sequence numbers start at 1 by default and increment by 1 with each
    call to :meth:`next_seq`.
    """

    def __init__(self, initial_seq: int = 1) -> None:
        """Initialise the manager with a starting sequence number.

        Args:
            initial_seq: The first sequence number to issue.  Defaults to 1.
        """
        self._seq: int = initial_seq

    def next_seq(self) -> int:
        """Return the current sequence number and advance the counter.

        Returns:
            The sequence number to use for the next outbound message.
        """
        seq: int = self._seq
        self._seq += 1
        return seq

    def current(self) -> int:
        """Return the current sequence number without advancing the counter.

        Returns:
            The sequence number that will be issued by the next call to
            :meth:`next_seq`.
        """
        return self._seq

    def reset(self, new_seq: int = 1) -> None:
        """Reset the sequence counter to *new_seq*.

        Args:
            new_seq: The value to reset to.  Defaults to 1.
        """
        self._seq = new_seq

    def set(self, seq: int) -> None:
        """Set the sequence counter to an arbitrary value.

        Args:
            seq: The exact sequence number to set.
        """
        self._seq = seq
