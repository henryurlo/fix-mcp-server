"""FIX Protocol tag constants and value enumerations."""


class FIXTags:
    """FIX Protocol tag number constants."""

    # Standard header tags
    BeginString: int = 8
    BodyLength: int = 9
    MsgType: int = 35
    SenderCompID: int = 49
    TargetCompID: int = 56
    MsgSeqNum: int = 34
    SendingTime: int = 52
    CheckSum: int = 10

    # Session message types (value of tag 35)
    class MsgTypes:
        Heartbeat: str = "0"
        Logon: str = "A"
        Logout: str = "5"
        ResendRequest: str = "2"
        SequenceReset: str = "4"

        # Application message types
        NewOrderSingle: str = "D"
        OrderCancelRequest: str = "F"
        OrderCancelReplaceRequest: str = "G"
        ExecutionReport: str = "8"

    # Order tags
    ClOrdID: int = 11
    OrigClOrdID: int = 41
    Symbol: int = 55
    Side: int = 54
    OrderQty: int = 38
    OrdType: int = 40
    Price: int = 44
    StopPx: int = 99
    ExDestination: int = 100
    HandlInst: int = 21
    TransactTime: int = 60
    TimeInForce: int = 59

    # ExecutionReport tags
    OrderID: int = 37
    ExecID: int = 17
    ExecType: int = 150
    OrdStatus: int = 39
    LeavesQty: int = 151
    CumQty: int = 14
    AvgPx: int = 6

    # ResendRequest tags
    BeginSeqNo: int = 7
    EndSeqNo: int = 16

    # SequenceReset tags
    NewSeqNo: int = 36
    GapFillFlag: int = 123

    # Side values
    class SideValues:
        BUY: str = "1"
        SELL: str = "2"

    # OrdType values
    class OrdTypeValues:
        MARKET: str = "1"
        LIMIT: str = "2"
        STOP: str = "3"
        STOP_LIMIT: str = "4"

    # OrdStatus values
    class OrdStatusValues:
        NEW: str = "0"
        PARTIALLY_FILLED: str = "1"
        FILLED: str = "2"
        CANCELED: str = "4"
        REJECTED: str = "8"
        PENDING_CANCEL: str = "6"

    # ExecType values
    class ExecTypeValues:
        NEW: str = "0"
        PARTIAL_FILL: str = "1"
        FILL: str = "2"
        CANCELED: str = "4"
        REJECTED: str = "8"
        PENDING_CANCEL: str = "6"

    # HandlInst values
    class HandlInstValues:
        AUTO_PRIVATE: str = "1"
        AUTO_PUBLIC: str = "2"
        MANUAL: str = "3"

    # TimeInForce values
    class TimeInForceValues:
        DAY: str = "0"
        GTC: str = "1"
        IOC: str = "3"
        FOK: str = "4"


# Human-readable tag name mapping: tag number -> descriptive name
TAG_NAMES: dict[int, str] = {
    # Standard header
    8: "BeginString",
    9: "BodyLength",
    35: "MsgType",
    49: "SenderCompID",
    56: "TargetCompID",
    34: "MsgSeqNum",
    52: "SendingTime",
    10: "CheckSum",
    # Order tags
    11: "ClOrdID",
    41: "OrigClOrdID",
    55: "Symbol",
    54: "Side",
    38: "OrderQty",
    40: "OrdType",
    44: "Price",
    99: "StopPx",
    100: "ExDestination",
    21: "HandlInst",
    60: "TransactTime",
    59: "TimeInForce",
    # ExecutionReport tags
    37: "OrderID",
    17: "ExecID",
    150: "ExecType",
    39: "OrdStatus",
    151: "LeavesQty",
    14: "CumQty",
    6: "AvgPx",
    # ResendRequest tags
    7: "BeginSeqNo",
    16: "EndSeqNo",
    # SequenceReset tags
    36: "NewSeqNo",
    123: "GapFillFlag",
}
