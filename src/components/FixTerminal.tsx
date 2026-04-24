'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useSystem, OrderInfo, SessionInfo } from '@/store';
import { Terminal, Copy } from 'lucide-react';

// ── FIX Tag mapping ────────────────────────────────────────────────

const FIX_TAGS: Record<string, string> = {
  '8': 'BeginString', '9': 'BodyLength', '35': 'MsgType', '49': 'SenderCompID',
  '56': 'TargetCompID', '34': 'MsgSeqNum', '52': 'SendingTime', '11': 'ClOrdID',
  '55': 'Symbol', '54': 'Side', '38': 'OrderQty', '40': 'OrdType',
  '44': 'Price', '59': 'TimeInForce', '10': 'Checksum', '100': 'ExDestination',
  '207': 'SecurityExchange', '167': 'SecurityType', '1': 'Account',
  '15': 'Currency', '60': 'TransactTime', '21': 'HandlInst',
  '22': 'SecurityIDSource', '48': 'SecurityID', '109': 'OrderQty2',
  '110': 'MinQty', '111': 'MaxFloor', '126': 'ExpireDate',
  '150': 'ExecType', '39': 'OrderStatus', '37': 'OrderID',
  '41': 'OrigClOrdID', '151': 'LeavesQty', '14': 'CumQty',
  '31': 'LastPx', '32': 'LastQty', '6': 'AvgPx',
  '103': 'OrdRejReason', '58': 'Text', '33': 'SequenceNumber',
  '581': 'AccountType', '200': 'MaturityMonthYear', '202': 'StrikePrice',
  '205': 'MaturityDay', '423': 'PriceType',
  '432': 'ExpireDateTime', '218': 'SecurityAltID',
};

const MSG_TYPE_NAMES: Record<string, string> = {
  'A': 'Logon', '0': 'Heartbeat', '1': 'TestRequest', '2': 'ResendRequest',
  '3': 'Reject', '4': 'SequenceReset', '5': 'Logout',
  'D': 'NewOrderSingle', 'F': 'OrderCancelRequest', 'G': 'CancelReplaceRequest',
  '8': 'ExecutionReport', '9': 'OrderCancelReject',
  'V': 'MarketDataRequest', 'W': 'MarketDataSnapshot', 'X': 'MarketDataIncremental',
  'Y': 'MarketDataRequestReject', 'AG': 'AllocationInstruction',
};

const SIDE_NAMES: Record<string, string> = { '1': 'BUY', '2': 'SELL' };
const ORD_TYPE_NAMES: Record<string, string> = { '1': 'MARKET', '2': 'LIMIT', '3': 'STOP' };
const TIF_NAMES: Record<string, string> = { '0': 'DAY', '1': 'GTC', '2': 'OPG', '3': 'IOC', '4': 'FOK' };


// -- Known log paths (for shortcuts and confidence indicators) --
const LOG_PATHS: Record<string, string> = {
  'NYSE': '/opt/fix/logs/NYSE-PROD-01.log',
  'ARCA': '/opt/fix/logs/ARCA-PROD-01.log',
  'BATS': '/opt/fix/logs/BATS-PROD-01.log',
  'NASDAQ': '/opt/fix/logs/NASDAQ-PROD-01.log',
  'TSX': '/opt/fix/logs/TSX-PROD-01.log',
  'LSE': '/opt/fix/logs/LSE-PROD-01.log',
};

const LOG_SHORTCUTS: Array<{ label: string; cmd: string; desc: string }> = [
  { label: 'View NYSE Logs', cmd: 'tail /opt/fix/logs/NYSE-PROD-01.log 50', desc: 'Last 50 lines from NYSE session' },
  { label: 'Check Sequences', cmd: 'grep MsgSeqNum /opt/fix/logs/*.log', desc: 'Find sequence gaps across venues' },
  { label: 'Order Flow', cmd: 'grep 35=D /opt/fix/logs/NYSE-PROD-01.log', desc: 'New orders and exec reports' },
  { label: 'Error Search', cmd: 'grep reject /opt/fix/logs/*.log', desc: 'Find rejects and errors' },
  { label: 'Logon History', cmd: 'grep 35=A /opt/fix/logs/*.log', desc: 'Session logon events' },
  { label: 'Heartbeat Check', cmd: 'grep 35=0 /opt/fix/logs/*.log', desc: 'Heartbeat messages' },
];

// ── Terminal Line types ────────────────────────────────────────────

interface TerminalLine {
  type: 'output' | 'error' | 'header' | 'success';
  text: string;
  timestamp: number;
}

export default function FixTerminal() {
  const { sessions, orders, callTool, startScenario, available_scenarios: available } = useSystem();
  const [lines, setLines] = useState<TerminalLine[]>([
    { type: 'header', text: '╔══════════════════════════════════════════════════════╗', timestamp: Date.now() },
    { type: 'header', text: '║              FIX-MCP  Terminal v1.0                  ║', timestamp: Date.now() },
    { type: 'header', text: '╚══════════════════════════════════════════════════════╝', timestamp: Date.now() },
    { type: 'output', text: 'FIX configs: /opt/fix/config/   Logs: /opt/fix/logs/', timestamp: Date.now() },
    { type: 'output', text: 'Sessions:    /opt/fix/sessions/  Data: /var/lib/fix/', timestamp: Date.now() },
    { type: 'output', text: '', timestamp: Date.now() },
    { type: 'output', text: 'Type "help" for commands  |  "shortcuts" for quick log access', timestamp: Date.now() },
  ]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [isTyping, setIsTyping] = useState(false);
  const [cwd, setCwd] = useState('/opt/fix');
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll
  useEffect(() => {
    terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight, behavior: 'smooth' });
  }, [lines]);

  const addLines = useCallback((newLines: Omit<TerminalLine, 'timestamp'>[]) => {
    setLines(prev => [...prev, ...newLines.map(l => ({ ...l, timestamp: Date.now() }))]);
  }, []);

  const runCommand = useCallback(async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    addLines([{ type: 'output', text: `fix-cli> ${trimmed}` }]);
    setHistory(h => [trimmed, ...h].slice(0, 200));
    setHistoryIdx(-1);

    const parts = trimmed.split(/\s+/);
    const baseCmd = parts[0].toLowerCase();

    try {
      if (baseCmd === 'help') {
        cmdHelp();
      } else if (baseCmd === 'clear') {
        setLines([]);
      } else if (baseCmd === 'show') {
        await cmdShow(parts);
      } else if (baseCmd === 'send') {
        await cmdSend(parts);
      } else if (baseCmd === 'cancel') {
        await cmdCancel(parts);
      } else if (baseCmd === 'fix') {
        await cmdFix(parts);
      } else if (baseCmd === 'release') {
        await cmdRelease();
      } else if (baseCmd === 'heartbeat') {
        await cmdHeartbeat(parts);
      } else if (baseCmd === 'reset') {
        if (parts[1]?.toLowerCase() === 'seq') {
          await cmdResetSeq(parts);
        }
      } else if (baseCmd === 'dump') {
        await cmdDump(parts);
      } else if (baseCmd === 'parse') {
        cmdParse(parts.slice(1).join(' '));
      } else if (baseCmd === 'tail') {
        await cmdTail(parts);
      } else if (baseCmd === 'grep') {
        await cmdGrep(parts);
      } else if (baseCmd === 'scenario') {
        await cmdScenario(parts);
      } else if (baseCmd === 'status') {
        cmdStatus();
      } else if (baseCmd === 'shortcuts') {
        cmdShortcuts();
      } else if (baseCmd === 'ls') {
        cmdLs(parts);
      } else if (baseCmd === 'cat') {
        cmdCat(parts);
      } else if (baseCmd === 'cd') {
        const target = parts[1] || '/opt/fix';
        const resolved = resolvePath(target);
        setCwd(resolved);
        addLines([{ type: 'output', text: resolved }]);
      } else if (baseCmd === 'pwd') {
        addLines([{ type: 'output', text: cwd }]);
      } else if (baseCmd === 'ps') {
        cmdPs();
      } else if (baseCmd === 'sql') {
        cmdSql(parts.slice(1).join(' '));
      } else if (baseCmd === 'df') {
        cmdDf();
      } else if (baseCmd === 'whoami') {
        addLines([{ type: 'output', text: 'fix-operator' }]);
      } else if (baseCmd === 'env') {
        cmdEnv();
      } else if (baseCmd === 'history') {
        cmdHistory();
      } else {
        addLines([{ type: 'error', text: `Unknown command: ${baseCmd}. Type "help" or "shortcuts".` }]);
      }
    } catch (err: any) {
      addLines([{ type: 'error', text: `ERROR: ${err.message}` }]);
    }
  }, [addLines]);

  // ── Command implementations ────────────────────────────────────

  // Resolve relative paths against cwd
  const resolvePath = (p: string): string => {
    if (p.startsWith('/')) return p.replace(/\/$/, '');
    if (p === '..') {
      const parts = cwd.split('/');
      parts.pop();
      return parts.join('/') || '/';
    }
    if (p === '.') return cwd;
    return `${cwd}/${p}`.replace(/\/$/, '');
  };

  const cmdShortcuts = () => {
    addLines([
      { type: 'header', text: '┌─ Quick Log Shortcuts ──────────────────────────────────────────┐' },
    ]);
    for (const sc of LOG_SHORTCUTS) {
      addLines([
        { type: 'output', text: `  [${sc.label}]` },
        { type: 'success', text: `    $ ${sc.cmd}` },
        { type: 'output', text: `    ${sc.desc}` },
        { type: 'output', text: '' },
      ]);
    }
    addLines([
      { type: 'header', text: '─ Log Locations ────────────────────────────────────────────────' },
    ]);
    for (const [venue, logPath] of Object.entries(LOG_PATHS)) {
      addLines([{ type: 'output', text: `  ${venue.padEnd(8)} ${logPath}` }]);
    }
    addLines([
      { type: 'output', text: '' },
      { type: 'output', text: '  Config:    /opt/fix/config/sessions.xml' },
      { type: 'output', text: '  State:     /var/lib/fix/state/' },
      { type: 'output', text: '  Seqnums:   /var/lib/fix/state/seqnums/' },
      { type: 'header', text: '└───────────────────────────────────────────────────────────────┘' },
    ]);
  };

  const cmdLs = (parts: string[]) => {
    const dir = parts[1] || cwd;
    const now = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const date = new Date().toISOString().split('T')[0];
    const venueNames = Object.keys(LOG_PATHS);
    const mockDirs: Record<string, string[]> = {
      '/opt/fix': ['config/', 'logs/', 'sessions/', 'bin/', 'lib/'],
      '/opt/fix/logs': [...venueNames.map(v => `${v}-PROD-01.log`), ...venueNames.map(v => `${v}-PROD-01_${now}.log`), `fix-gateway_${now}.log`, `fix-sre-copilot_${now}.log`, 'archive/'],
      '/opt/fix/config': ['sessions.xml', 'venues.json', 'routing-rules.json', 'risk-limits.json', 'interlisted-map.json', 'sor-config.json', 'sla-thresholds.json'],
      '/opt/fix/sessions': venueNames.map(v => `${v}-PROD-01/`),
      '/opt/fix/bin': ['fix-gateway', 'fix-oms', 'fix-sor', 'fix-monitor', 'fix-replay'],
      '/opt/fix/lib': ['libfix42.so', 'libfix44.so', 'libquickfix.so', 'libssl.so.3'],
      '/var/lib/fix': ['state/', 'seqnums/', 'snapshots/', 'refdata/'],
      '/var/lib/fix/state': ['session-state.db', 'order-cache.db', 'routing-state.json', 'venue-priorities.json'],
      '/var/lib/fix/seqnums': venueNames.map(v => `${v}-PROD-01.seq`),
      '/var/lib/fix/refdata': ['symbols.csv', 'cusip-map.csv', 'interlisted.json', `corporate-actions-${date}.json`],
      '/var/log/fix': ['sessions/', 'gateway/', 'audit/', 'sor/'],
    };
    // Add per-session directories
    for (const v of venueNames) {
      mockDirs[`/opt/fix/sessions/${v}-PROD-01`] = ['session.cfg', 'store/', 'logs/', `seqnums.dat`];
    }
    const resolved = resolvePath(dir);
    const entries = mockDirs[resolved] || [`(no such directory: ${resolved})`];
    addLines([{ type: 'header', text: `ls ${resolved}` }]);
    for (const e of entries) {
      const isDir = e.endsWith('/');
      addLines([{ type: isDir ? 'header' : 'output', text: `  ${e}` }]);
    }
    addLines([{ type: 'output', text: `  (${new Date().toLocaleTimeString()})` }]);
  };

  const cmdCat = (parts: string[]) => {
    const raw = parts[1];
    if (!raw) { addLines([{ type: 'error', text: 'Usage: cat <FILE>' }]); return; }
    const file = resolvePath(raw);

    // Static config files
    const staticFiles: Record<string, string> = {
      '/opt/fix/config/sessions.xml': `<?xml version="1.0" encoding="UTF-8"?>\n<sessions>\n  <session id="NYSE-PROD-01" venue="NYSE" fix="4.2" host="nyse-fix-gw.prod" port="5001" sender="FIRM_A" target="NYSE" hb_int="30" />\n  <session id="ARCA-PROD-01" venue="ARCA" fix="4.2" host="arca-fix-gw.prod" port="5002" sender="FIRM_A" target="ARCA" hb_int="30" />\n  <session id="BATS-PROD-01" venue="BATS" fix="4.4" host="bats-fix-gw.prod" port="5003" sender="FIRM_A" target="BATS" hb_int="15" />\n  <session id="NASDAQ-PROD-01" venue="NASDAQ" fix="4.2" host="nasdaq-fix-gw.prod" port="5004" sender="FIRM_A" target="NASDAQ" hb_int="30" />\n  <session id="TSX-PROD-01" venue="TSX" fix="4.2" host="tsx-fix-gw.prod" port="5005" sender="FIRM_A" target="TSX" hb_int="30" />\n  <session id="LSE-PROD-01" venue="LSE" fix="4.4" host="lse-fix-gw.prod" port="5006" sender="FIRM_A" target="LSE" hb_int="15" />\n</sessions>`,
      '/opt/fix/config/venues.json': JSON.stringify({ venues: Object.keys(LOG_PATHS).map(v => ({ id: v, status: 'active', priority: 1, gateway: `${v.toLowerCase()}-fix-gw.prod`, port: 5001 + Object.keys(LOG_PATHS).indexOf(v) })) }, null, 2),
      '/opt/fix/config/risk-limits.json': JSON.stringify({ max_order_qty: 50000, max_notional: 5000000, max_orders_per_second: 100, restricted_symbols: ['GME','AMC'], sla_breach_minutes: { institutional: 15, retail: 60 } }, null, 2),
      '/opt/fix/config/routing-rules.json': JSON.stringify({ default_route: 'SOR', sor_algorithm: 'latency_weighted', venue_priority: ['NYSE','ARCA','BATS','IEX','NASDAQ'], listing_venue_override: true, dark_pool_enabled: false }, null, 2),
      '/opt/fix/config/interlisted-map.json': JSON.stringify({ mappings: [{ canonical: 'RY', venues: { NYSE: 'RY', TSX: 'RY.TO' }}, { canonical: 'AAPL', venues: { NYSE: 'AAPL', TSX: 'AAPL.TO' }}, { canonical: 'BP', venues: { NYSE: 'BP', LSE: 'BP.L' }}] }, null, 2),
      '/opt/fix/config/sla-thresholds.json': JSON.stringify({ institutional: { max_latency_ms: 10, max_fill_time_min: 15, max_slippage_bps: 150 }, retail: { max_latency_ms: 50, max_fill_time_min: 60, max_slippage_bps: 500 } }, null, 2),
      '/opt/fix/config/sor-config.json': JSON.stringify({ algorithm: 'latency_weighted', rebalance_interval_ms: 5000, min_venue_score: 0.3, degraded_penalty: 0.8, down_penalty: 0.0 }, null, 2),
    };

    // Check static files first
    const fc = staticFiles[file];
    if (fc) {
      addLines([
        { type: 'header', text: `cat ${file}` },
        { type: 'output', text: `File: ${file}  (${new Date().toLocaleTimeString()})` },
        { type: 'header', text: '\u2500'.repeat(60) },
        { type: 'success', text: fc },
      ]);
      return;
    }

    // Dynamic: log files → generate realistic FIX log lines
    if (file.includes('/logs/') && file.endsWith('.log')) {
      const venue = file.match(/([A-Z]+)-PROD/)?.[1] || 'NYSE';
      const logLines = generateFixLog(venue, 20);
      addLines([
        { type: 'header', text: `cat ${file}` },
        { type: 'output', text: `File: ${file}  (${new Date().toLocaleTimeString()})` },
        { type: 'header', text: '\u2500'.repeat(70) },
        { type: 'success', text: logLines },
      ]);
      return;
    }

    // Dynamic: seqnum files
    if (file.endsWith('.seq')) {
      const venue = file.match(/([A-Z]+)-PROD/)?.[1] || 'NYSE';
      const s = sessions.find(x => x.venue === venue);
      const seq = s ? `sent=${12450 + Math.floor(Math.random() * 100)} recv=${12450 + Math.floor(Math.random() * 100)}` : 'sent=0 recv=0';
      addLines([{ type: 'header', text: `cat ${file}` }, { type: 'success', text: seq }]);
      return;
    }

    // Dynamic: session config files
    if (file.includes('/sessions/') && file.endsWith('session.cfg')) {
      const venue = file.match(/([A-Z]+)-PROD/)?.[1] || 'NYSE';
      const cfg = `[DEFAULT]\nConnectionType=initiator\nReconnectInterval=30\nSenderCompID=FIRM_A\nTargetCompID=${venue}\nHeartBtInt=30\nStartTime=00:00:00\nEndTime=23:59:59\nUseDataDictionary=Y\nDataDictionary=FIX42.xml\nFileStorePath=/var/lib/fix/state/${venue}-PROD-01/\nFileLogPath=/opt/fix/logs/`;
      addLines([{ type: 'header', text: `cat ${file}` }, { type: 'success', text: cfg }]);
      return;
    }

    // Dynamic: state files
    if (file === '/var/lib/fix/state/routing-state.json') {
      const rs = JSON.stringify({ active_routes: sessions.filter(s => s.status === 'active').map(s => s.venue), degraded: sessions.filter(s => s.status === 'degraded').map(s => s.venue), down: sessions.filter(s => s.status === 'down').map(s => s.venue), last_rebalance: new Date().toISOString() }, null, 2);
      addLines([{ type: 'header', text: `cat ${file}` }, { type: 'success', text: rs }]);
      return;
    }

    addLines([{ type: 'error', text: `cat: ${file}: No such file or directory` }]);
  };

  // Generate realistic FIX log lines — scenario-aware
  const generateFixLog = (venue: string, count: number): string => {
    const session = sessions.find((s: SessionInfo) => s.venue === venue);
    const venueOrders = orders.filter((o: OrderInfo) => o.venue === venue);
    const isDown = session?.status === 'down';
    const isDegraded = session?.status === 'degraded';
    const symbols = Array.from(new Set(venueOrders.map(o => o.symbol).concat(['AAPL', 'MSFT', 'TSLA', 'NVDA', 'GOOGL', 'META', 'AMZN', 'AMD'])));

    const lines: string[] = [];
    const baseTime = new Date();

    for (let i = 0; i < count; i++) {
      const t = new Date(baseTime.getTime() - (count - i) * 1500);
      const ts = `${t.toISOString().split('T')[0].replace(/-/g, '')}-${t.toTimeString().split(' ')[0]}.${String(t.getMilliseconds()).padStart(3, '0')}`;
      const seq = 12400 + i;
      const sym = symbols[Math.floor(Math.random() * symbols.length)];

      // Scenario-aware message generation
      let level = 'INFO';
      let msgType = '35=0'; // Heartbeat default
      let msgName = 'Heartbeat';

      if (isDown) {
        const downMsgs = [
          { tag: '35=5', name: 'Logout', level: 'WARN' },
          { tag: '35=3', name: 'Reject', level: 'ERROR' },
          { tag: '35=2', name: 'ResendRequest', level: 'WARN' },
          { tag: '35=A', name: 'Logon', level: 'INFO' },
        ];
        const dm = downMsgs[Math.floor(Math.random() * downMsgs.length)];
        msgType = dm.tag;
        msgName = dm.name;
        level = dm.level;
      } else if (isDegraded) {
        const degMsgs = [
          { tag: '35=0', name: 'Heartbeat', level: 'WARN' },
          { tag: '35=1', name: 'TestRequest', level: 'WARN' },
          { tag: '35=3', name: 'Reject', level: 'WARN' },
          { tag: '35=8', name: 'ExecutionReport', level: 'INFO' },
        ];
        const dm = degMsgs[Math.floor(Math.random() * degMsgs.length)];
        msgType = dm.tag;
        msgName = dm.name;
        level = dm.level;
      } else {
        const normalMsgs = [
          { tag: '35=0', name: 'Heartbeat', level: 'INFO' },
          { tag: '35=8', name: 'ExecutionReport', level: 'INFO' },
          { tag: '35=D', name: 'NewOrderSingle', level: 'INFO' },
          { tag: '35=A', name: 'Logon', level: 'INFO' },
        ];
        const nm = normalMsgs[Math.floor(Math.random() * normalMsgs.length)];
        msgType = nm.tag;
        msgName = nm.name;
        level = nm.level;
      }

      // Add stuck-order related messages if applicable
      const stuckHere = venueOrders.filter(o => o.status === 'stuck');
      if (stuckHere.length > 0 && Math.random() > 0.7) {
        const stuck = stuckHere[Math.floor(Math.random() * stuckHere.length)];
        msgType = '35=3';
        msgName = 'Reject';
        level = 'ERROR';
        lines.push(`${ts} ${level.padEnd(5)} [${venue}-PROD-01] ${msgName} 8=FIX.4.2|9=178|${msgType}|34=${seq}|49=FIRM_A|56=${venue}|52=${ts}|55=${stuck.symbol}|54=${stuck.side === 'buy' ? '1' : '2'}|38=${stuck.quantity}|103=99|58=Venue unreachable|10=${String(Math.floor(Math.random()*256)).padStart(3,'0')}|`);
        continue;
      }

      const msg = `8=FIX.4.2|9=${140+Math.floor(Math.random()*80)}|${msgType}|34=${seq}|49=FIRM_A|56=${venue}|52=${ts}|55=${sym}|54=${Math.random()>0.5?'1':'2'}|38=${Math.floor(Math.random()*5000)+100}|10=${String(Math.floor(Math.random()*256)).padStart(3,'0')}|`;
      lines.push(`${ts} ${level.padEnd(5)} [${venue}-PROD-01] ${msgName} ${msg}`);
    }
    return lines.join('\n');
  };

  const cmdHelp = () => {
    addLines([
      { type: 'header', text: '\u250c\u2500 Available Commands \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510' },
      { type: 'output', text: '\u2502                                                              \u2502' },
      { type: 'output', text: '\u2502  Sessions                                                     \u2502' },
      { type: 'output', text: '\u2502  show sessions            \u2014 show all FIX sessions            \u2502' },
      { type: 'output', text: '\u2502  heartbeat <VENUE>       \u2014 check heartbeat for a venue       \u2502' },
      { type: 'output', text: '\u2502  reset seq <VENUE>       \u2014 reset sequence numbers            \u2502' },
      { type: 'output', text: '\u2502  dump <VENUE>            \u2014 full session diagnostics          \u2502' },
      { type: 'output', text: '\u2502                                                              \u2502' },
      { type: 'output', text: '\u2502  Orders                                                       \u2502' },
      { type: 'output', text: '\u2502  show orders             \u2014 show all orders                   \u2502' },
      { type: 'output', text: '\u2502  show orders --open      \u2014 show open orders only             \u2502' },
      { type: 'output', text: '\u2502  show orders --status X  \u2014 filter by status                  \u2502' },
      { type: 'output', text: '\u2502  show orders --venue X   \u2014 filter by venue                   \u2502' },
      { type: 'output', text: '\u2502  show orders --symbol X  \u2014 filter by symbol                  \u2502' },
      { type: 'output', text: '\u2502  send order <SYM> <SIDE> <QTY> [@PRICE] [VENUE]             \u2502' },
      { type: 'output', text: '\u2502  cancel <ORDER_ID>       \u2014 cancel an order                   \u2502' },
      { type: 'output', text: '\u2502  release stuck           \u2014 release stuck orders              \u2502' },
      { type: 'output', text: '\u2502                                                              \u2502' },
      { type: 'output', text: '\u2502  Queries                                                      \u2502' },
      { type: 'output', text: '\u2502  sql "SELECT ..."        \u2014 query orders/sessions live        \u2502' },
      { type: 'output', text: '\u2502  ps                      \u2014 list running processes            \u2502' },
      { type: 'output', text: '\u2502  df                      \u2014 disk usage                        \u2502' },
      { type: 'output', text: '\u2502  env                     \u2014 environment variables             \u2502' },
      { type: 'output', text: '\u2502  whoami                  \u2014 current user                      \u2502' },
      { type: 'output', text: '\u2502                                                              \u2502' },
      { type: 'output', text: '\u2502  Logs                                                         \u2502' },
      { type: 'output', text: '\u2502  tail <LOGFILE> [N]      \u2014 tail a log file                   \u2502' },
      { type: 'output', text: '\u2502  grep <PATTERN> <FILE>   \u2014 search logs                       \u2502' },
      { type: 'output', text: '\u2502  cat <FILE>              \u2014 view file contents                \u2502' },
      { type: 'output', text: '\u2502  ls [DIR]                \u2014 list directory                    \u2502' },
      { type: 'output', text: '\u2502                                                              \u2502' },
      { type: 'output', text: '\u2502  Scenarios                                                    \u2502' },
      { type: 'output', text: '\u2502  scenario list           \u2014 list available scenarios          \u2502' },
      { type: 'output', text: '\u2502  scenario load <NAME>    \u2014 load a scenario                   \u2502' },
      { type: 'output', text: '\u2502                                                              \u2502' },
      { type: 'output', text: '\u2502  Misc                                                         \u2502' },
      { type: 'output', text: '\u2502  parse <FIX_MSG>         \u2014 parse a FIX message               \u2502' },
      { type: 'output', text: '\u2502  shortcuts               \u2014 quick log access shortcuts        \u2502' },
      { type: 'output', text: '\u2502  status                  \u2014 full system status                \u2502' },
      { type: 'output', text: '\u2502  history                 \u2014 command history                   \u2502' },
      { type: 'output', text: '\u2502  clear                   \u2014 clear terminal                    \u2502' },
      { type: 'header', text: '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518' },
    ]);
  };

  const cmdShow = async (parts: string[]) => {
    const showWhat = parts[1]?.toLowerCase();

    if (showWhat === 'sessions') {
      const result = await callTool('check_fix_sessions', {});
      addLines([{ type: 'success', text: result }]);
      return;
    }

    if (showWhat === 'orders') {
      const args: Record<string, unknown> = {};
      if (parts.includes('--open')) args.status = 'new';
      else if (parts.includes('--status')) {
        const idx = parts.indexOf('--status');
        if (idx + 1 < parts.length) args.status = parts[idx + 1];
      }
      if (parts.includes('--venue')) {
        const idx = parts.indexOf('--venue');
        if (idx + 1 < parts.length) args.venue = parts[idx + 1].toUpperCase();
      }
      if (parts.includes('--symbol')) {
        const idx = parts.indexOf('--symbol');
        if (idx + 1 < parts.length) args.symbol = parts[idx + 1].toUpperCase();
      }

      const result = await callTool('query_orders', args);
      addLines([{ type: 'success', text: result }]);
      return;
    }

    addLines([{ type: 'error', text: `Usage: show [sessions|orders] [--open|--status X|--venue X|--symbol X]` }]);
  };

  const cmdSend = async (parts: string[]) => {
    if (parts[1] !== 'order' || parts.length < 5) {
      addLines([{ type: 'error', text: 'Usage: send order <SYM> <SIDE> <QTY> [@PRICE] [VENUE]' }]);
      return;
    }

    const symbol = parts[2].toUpperCase();
    const side = parts[3].toLowerCase();
    const qty = parseInt(parts[4]);
    const priceAndVenue = parts.slice(5);

    let price: number | undefined;
    let venue: string | undefined;

    for (const p of priceAndVenue) {
      if (p.startsWith('@')) {
        price = parseFloat(p.slice(1));
      } else if (!price) {
        price = parseFloat(p);
      } else {
        venue = p.toUpperCase();
      }
    }

    if (!['buy', 'sell'].includes(side) || isNaN(qty)) {
      addLines([{ type: 'error', text: 'Invalid side (buy/sell) or quantity.' }]);
      return;
    }

    const orderType = price ? 'limit' : 'market';
    const args: Record<string, unknown> = {
      symbol, side, quantity: qty, order_type: orderType, client_name: 'FIRM_A',
    };
    if (price !== undefined) args.price = price;
    if (venue) args.venue = venue;

    const result = await callTool('send_order', args);
    addLines([{ type: 'success', text: result }]);
  };

  const cmdCancel = async (parts: string[]) => {
    if (parts.length < 2) {
      addLines([{ type: 'error', text: 'Usage: cancel <ORDER_ID>' }]);
      return;
    }
    const result = await callTool('cancel_replace', { order_id: parts[1], action: 'cancel' });
    addLines([{ type: 'success', text: result }]);
  };

  const cmdFix = async (parts: string[]) => {
    if (parts.length < 2) {
      addLines([{ type: 'error', text: 'Usage: fix <VENUE>' }]);
      return;
    }
    const result = await callTool('fix_session_issue', { venue: parts[1].toUpperCase(), action: 'reconnect' });
    addLines([{ type: 'success', text: result }]);
  };

  const cmdRelease = async () => {
    const result = await callTool('release_stuck_orders', {});
    addLines([{ type: 'success', text: result }]);
  };

  const cmdHeartbeat = async (parts: string[]) => {
    if (parts.length < 2) {
      // Show all heartbeats
      if (sessions.length === 0) {
        addLines([{ type: 'header', text: 'No active sessions.' }]);
        return;
      }
      addLines([{ type: 'header', text: 'FIX Session Heartbeats' }, { type: 'header', text: '─'.repeat(50) }]);
      for (const s of sessions) {
        const statusIcon = s.status === 'active' ? '●' : s.status === 'degraded' ? '◐' : '○';
        const color = s.status === 'active' ? 'var(--green)' : s.status === 'degraded' ? 'var(--amber)' : 'var(--red)';
        addLines([{
          type: 'output',
          text: `  ${statusIcon} ${s.venue.padEnd(10)}  ${(s.latency_ms ?? 0).toFixed(0)}ms  status=${s.status}`,
        }]);
      }
      return;
    }

    const venue = parts[1].toUpperCase();
    try {
      const result = await callTool('session_heartbeat', { venue });
      addLines([{ type: 'success', text: `Heartbeat ${venue}: ${result}` }]);
    } catch {
      // Fallback: search locally
      const session = sessions.find(s => s.venue === venue);
      if (session) {
        addLines([{ type: 'success', text: `Heartbeat ${venue}: status=${session.status}, latency=${session.latency_ms}ms` }]);
      } else {
        addLines([{ type: 'error', text: `No session found for ${venue}` }]);
      }
    }
  };

  const cmdResetSeq = async (parts: string[]) => {
    if (parts.length < 3) {
      addLines([{ type: 'error', text: 'Usage: reset seq <VENUE>' }]);
      return;
    }
    try {
      const result = await callTool('reset_sequence', { venue: parts[2].toUpperCase() });
      addLines([{ type: 'success', text: result }]);
    } catch {
      const result = await callTool('fix_session_issue', { venue: parts[2].toUpperCase(), action: 'reset_sequence' });
      addLines([{ type: 'success', text: result }]);
    }
  };

  const cmdDump = async (parts: string[]) => {
    if (parts.length < 2) {
      addLines([{ type: 'error', text: 'Usage: dump <VENUE>' }]);
      return;
    }
    const venue = parts[1].toUpperCase();
    try {
      const result = await callTool('dump_session_state', { venue });
      addLines([{ type: 'success', text: result }]);
    } catch {
      // Fallback: build from local data
      const session = sessions.find(s => s.venue === venue);
      const venueOrders = orders.filter((o: OrderInfo) => o.venue === venue);
      if (!session) {
        addLines([{ type: 'error', text: `No session found for ${venue}` }]);
        return;
      }
      addLines([
        { type: 'header', text: `SESSION DUMP: ${venue}` },
        { type: 'header', text: '─'.repeat(60) },
        { type: 'output', text: `  Venue:          ${session.venue}` },
        { type: 'output', text: `  Status:         ${session.status}` },
        { type: 'output', text: `  Latency:        ${(session as any).latency_ms ?? '—'} ms` },
        { type: 'output', text: `  Session ID:     ${(session as any).session_id ?? '—'}` },
        { type: 'output', text: `  Orders @ venue: ${venueOrders.length}` },
      ]);
    }
  };

  const cmdParse = (rawMsg: string) => {
    if (!rawMsg) {
      addLines([{ type: 'error', text: 'Usage: parse <RAW_FIX_MESSAGE>' }]);
      addLines([{ type: 'output', text: 'Example: parse 8=FIX.4.2|9=178|35=D|34=2|49=FIRM|56=EXCH' }]);
      return;
    }

    // Split on pipe or SOH
    const segments = rawMsg.split(/[|\x01]/);
    const fields: Array<{ tag: string; name: string; value: string }> = [];

    for (const seg of segments) {
      const eqIdx = seg.indexOf('=');
      if (eqIdx === -1) continue;
      const tag = seg.slice(0, eqIdx);
      const value = seg.slice(eqIdx + 1);
      const name = FIX_TAGS[tag] || `Tag${tag}`;

      // Decode special values
      let displayValue = value;
      if (tag === '35') displayValue = MSG_TYPE_NAMES[value] || value;
      if (tag === '54') displayValue = SIDE_NAMES[value] || value;
      if (tag === '40') displayValue = ORD_TYPE_NAMES[value] || value;
      if (tag === '59') displayValue = TIF_NAMES[value] || value;

      fields.push({ tag, name, value: displayValue });
    }

    if (fields.length === 0) {
      addLines([{ type: 'error', text: 'No valid FIX fields parsed.' }]);
      return;
    }

    addLines([{ type: 'header', text: 'PARSED FIX MESSAGE' }, { type: 'header', text: '─'.repeat(65) }]);
    for (const f of fields) {
      addLines([{
        type: 'output',
        text: `  ${f.tag.padStart(3)}  ${f.name.padEnd(22)}  ${f.value}`,
      }]);
    }
  };

  const cmdTail = async (parts: string[]) => {
    const file = parts[1];
    const lines = parseInt(parts[2] || '20');
    if (!file) {
      addLines([{ type: 'error', text: 'Usage: tail <LOGFILE> [N]' }]);
      return;
    }
    const resolved = resolvePath(file);
    const venue = resolved.match(/([A-Z]+)-PROD/)?.[1] || 'NYSE';
    const logContent = generateFixLog(venue, lines);
    addLines([
      { type: 'header', text: `TAIL ${resolved} (last ${lines} lines)` },
      { type: 'success', text: logContent },
    ]);
  };

  const cmdGrep = async (parts: string[]) => {
    const pattern = parts[1];
    const file = parts[2];
    if (!pattern || !file) {
      addLines([{ type: 'error', text: 'Usage: grep <PATTERN> <FILE|GLOB>' }]);
      return;
    }

    // Resolve file path
    const resolved = resolvePath(file);

    // Determine which venues to search
    const venueNames = Object.keys(LOG_PATHS);
    let venues: string[] = [];
    if (resolved.includes('*')) {
      // Glob: grep pattern /opt/fix/logs/*.log → all venues
      venues = venueNames;
    } else {
      const match = resolved.match(/([A-Z]+)-PROD/);
      venues = match ? [match[1]] : venueNames.slice(0, 2);
    }

    // Generate log lines and filter case-insensitively
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, 'i');
    } catch {
      regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }

    const allMatches: string[] = [];
    for (const v of venues) {
      const logContent = generateFixLog(v, 40);
      for (const line of logContent.split('\n')) {
        if (regex.test(line)) allMatches.push(line);
      }
    }

    if (allMatches.length > 0) {
      const shown = allMatches.slice(0, 25);
      addLines([
        { type: 'header', text: `GREP '${pattern}' in ${file} — ${allMatches.length} matches` },
        { type: 'success', text: shown.join('\n') },
      ]);
      if (allMatches.length > 25) {
        addLines([{ type: 'output', text: `  ... and ${allMatches.length - 25} more (use tail for recent)` }]);
      }
    } else {
      addLines([{ type: 'error', text: `GREP '${pattern}' in ${file} — no matches` }]);
    }
  };

  const cmdScenario = async (parts: string[]) => {
    const sub = parts[1]?.toLowerCase();

    if (sub === 'list') {
      if (available.length === 0) {
        // Fallback: use known scenario names
        const knowns = ['morning_triage', 'venue_degradation_1030', 'open_volatility_0930'];
        addLines([{ type: 'header', text: 'Available Scenarios' }, { type: 'header', text: '─'.repeat(40) }]);
        for (const n of knowns) {
          addLines([{ type: 'output', text: `  • ${n}` }]);
        }
      } else {
        addLines([{ type: 'header', text: 'Available Scenarios' }, { type: 'header', text: '─'.repeat(40) }]);
        for (const s of available as any[]) {
          addLines([{ type: 'output', text: `  • ${s.name}${s.is_algo ? ' ⚡' : ''}` }]);
        }
      }
      return;
    }

    if (sub === 'load') {
      const name = parts[2];
      if (!name) {
        addLines([{ type: 'error', text: 'Usage: scenario load <NAME>' }]);
        return;
      }
      await startScenario(name);
      addLines([{ type: 'success', text: `Scenario "${name}" loaded.` }]);
      return;
    }

    addLines([{ type: 'error', text: 'Usage: scenario [list|load <NAME>]' }]);
  };

  const cmdStatus = () => {
    const activeSessions = sessions.filter((s: SessionInfo) => s.status === 'active').length;
    const downSessions = sessions.filter((s: SessionInfo) => s.status === 'down').length;
    const openOrders = orders.filter((o: OrderInfo) => !['filled', 'canceled', 'rejected'].includes(o.status)).length;
    const stuckOrders = orders.filter((o: OrderInfo) => o.status === 'stuck').length;

    addLines([
      { type: 'header', text: 'SYSTEM STATUS' },
      { type: 'header', text: '\u2500'.repeat(60) },
      { type: 'output', text: `  FIX Sessions:    ${activeSessions}/${sessions.length} active, ${downSessions} down` },
      { type: 'output', text: `  Open Orders:     ${openOrders} (${stuckOrders} stuck)` },
      { type: 'output', text: '' },
      { type: 'header', text: '  Venue Details:' },
    ]);
    for (const s of sessions) {
      const icon = s.status === 'active' ? '\u25cf' : s.status === 'degraded' ? '\u25d0' : '\u25cb';
      const logFile = LOG_PATHS[s.venue] || `/opt/fix/logs/${s.venue}-PROD-01.log`;
      addLines([{
        type: s.status === 'active' ? 'success' : s.status === 'degraded' ? 'output' : 'error',
        text: `    ${icon} ${s.venue.padEnd(8)} ${String((s.latency_ms ?? 0).toFixed(0) + 'ms').padEnd(8)} log: ${logFile}`,
      }]);
    }
    addLines([
      { type: 'output', text: '' },
      { type: 'header', text: '  Filesystem:' },
      { type: 'output', text: '    Config:    /opt/fix/config/sessions.xml' },
      { type: 'output', text: '    Logs:      /opt/fix/logs/' },
      { type: 'output', text: '    State:     /var/lib/fix/state/' },
      { type: 'output', text: '    Sequences: /var/lib/fix/state/seqnums/' },
      { type: 'output', text: '' },
      { type: 'output', text: `  Last checked: ${new Date().toLocaleTimeString()}` },
      { type: 'output', text: '  Source: /api/status + /api/events' },
    ]);
  };

  // ── New commands: ps, sql, df, env, history ──

  const cmdPs = () => {
    const procs = [
      { pid: 101, name: 'fix-gateway', user: 'fix-operator', cpu: '2.4%', mem: '128M', status: 'active' },
      { pid: 102, name: 'fix-oms-engine', user: 'fix-operator', cpu: '1.8%', mem: '256M', status: 'active' },
      { pid: 103, name: 'fix-sor-router', user: 'fix-operator', cpu: '1.2%', mem: '64M', status: 'active' },
      { pid: 104, name: 'fix-monitor', user: 'fix-operator', cpu: '0.4%', mem: '32M', status: 'active' },
      { pid: 105, name: 'fix-replay', user: 'fix-operator', cpu: '0.1%', mem: '16M', status: 'idle' },
      { pid: 201, name: 'postgres', user: 'postgres', cpu: '3.2%', mem: '512M', status: 'active' },
      { pid: 202, name: 'redis-server', user: 'redis', cpu: '0.8%', mem: '64M', status: 'active' },
      { pid: 301, name: 'nginx', user: 'www-data', cpu: '0.2%', mem: '24M', status: 'active' },
    ];
    addLines([
      { type: 'header', text: '  PID   PROCESS          USER         CPU    MEM     STATUS' },
      { type: 'header', text: '\u2500'.repeat(70) },
    ]);
    for (const p of procs) {
      addLines([{ type: 'output', text: `  ${String(p.pid).padEnd(5)} ${p.name.padEnd(16)} ${p.user.padEnd(12)} ${p.cpu.padEnd(6)} ${p.mem.padEnd(7)} ${p.status}` }]);
    }
    addLines([{ type: 'output', text: '' }, { type: 'output', text: `  ${procs.length} processes running` }]);
  };

  const cmdSql = (query: string) => {
    if (!query) {
      addLines([
        { type: 'error', text: 'Usage: sql "<QUERY>"' },
        { type: 'output', text: 'Examples:' },
        { type: 'output', text: '  sql "SELECT * FROM orders WHERE status = \'stuck\'"' },
        { type: 'output', text: '  sql "SELECT venue, COUNT(*) FROM orders GROUP BY venue"' },
        { type: 'output', text: '  sql "SELECT * FROM sessions WHERE status != \'active\'"' },
      ]);
      return;
    }
    const q = query.toLowerCase().trim();

    // Parse simple SQL-ish queries against in-memory data
    if (q.includes('from orders')) {
      let filtered = [...orders];
      if (q.includes("where")) {
        if (q.includes("status") && (q.includes("stuck") || q.includes("'stuck'") || q.includes('"stuck"'))) {
          filtered = filtered.filter((o) => o.status === 'stuck');
        } else if (q.includes("status") && (q.includes("new") || q.includes("'new'") || q.includes('"new"'))) {
          filtered = filtered.filter((o) => o.status === 'new');
        } else if (q.includes("venue")) {
          const match = query.match(/venue\s*=\s*['"]?([A-Z]+)['"]?/i);
          if (match) filtered = filtered.filter((o) => o.venue === match[1]);
        } else if (q.includes("symbol")) {
          const match = query.match(/symbol\s*=\s*['"]?([A-Z]+)['"]?/i);
          if (match) filtered = filtered.filter((o) => o.symbol === match[1]);
        }
      }
      if (q.includes('count(*)')) {
        addLines([{ type: 'success', text: `COUNT\n${filtered.length}` }]);
        return;
      }
      const cols = q.includes('*') ? ['order_id', 'symbol', 'side', 'quantity', 'status', 'venue', 'client_name'] : ['order_id', 'symbol', 'status'];
      const header = cols.map((c) => c.toUpperCase().padEnd(c === 'order_id' ? 20 : c === 'client_name' ? 18 : 10)).join(' ');
      addLines([{ type: 'header', text: header }, { type: 'header', text: '\u2500'.repeat(header.length) }]);
      for (const o of filtered.slice(0, 30)) {
        const row = cols.map((c) => {
          const val = (o as any)[c] ?? '';
          return String(val).padEnd(c === 'order_id' ? 20 : c === 'client_name' ? 18 : 10);
        }).join(' ');
        addLines([{ type: 'output', text: row }]);
      }
      if (filtered.length > 30) {
        addLines([{ type: 'output', text: `  ... and ${filtered.length - 30} more rows` }]);
      }
      addLines([{ type: 'output', text: `  ${filtered.length} row(s)` }]);
      return;
    }

    if (q.includes('from sessions')) {
      let filtered = [...sessions];
      if (q.includes("where") && q.includes("status") && q.includes("!='active'")) {
        filtered = filtered.filter((s) => s.status !== 'active');
      }
      const header = 'VENUE      STATUS     LATENCY  SESSION_ID';
      addLines([{ type: 'header', text: header }, { type: 'header', text: '\u2500'.repeat(header.length) }]);
      for (const s of filtered) {
        addLines([{ type: 'output', text: `  ${s.venue.padEnd(10)} ${s.status.padEnd(10)} ${String(s.latency_ms ?? 0).padEnd(8)} ${s.session_id ?? 'N/A'}` }]);
      }
      addLines([{ type: 'output', text: `  ${filtered.length} row(s)` }]);
      return;
    }

    addLines([{ type: 'error', text: 'Supported tables: orders, sessions' }, { type: 'output', text: 'Try: sql "SELECT * FROM orders WHERE status = \'stuck\'"' }]);
  };

  const cmdDf = () => {
    addLines([
      { type: 'header', text: 'Filesystem      Size  Used  Avail  Use%  Mounted on' },
      { type: 'header', text: '\u2500'.repeat(65) },
      { type: 'output', text: '  /dev/sda1      500G  120G  380G   24%  /' },
      { type: 'output', text: '  /dev/sda2      200G   45G  155G   23%  /opt/fix' },
      { type: 'output', text: '  /dev/sdb1      1.0T  310G  690G   31%  /var/lib/fix' },
      { type: 'output', text: '  tmpfs           32G  2.1G   30G    7%  /tmp' },
    ]);
  };

  const cmdEnv = () => {
    addLines([
      { type: 'header', text: 'Environment Variables' },
      { type: 'header', text: '\u2500'.repeat(50) },
      { type: 'output', text: '  FIX_HOME=/opt/fix' },
      { type: 'output', text: '  FIX_CONFIG=/opt/fix/config' },
      { type: 'output', text: '  FIX_LOGS=/opt/fix/logs' },
      { type: 'output', text: '  FIX_VERSION=4.2' },
      { type: 'output', text: '  VENUES=NYSE,ARCA,BATS,IEX,NASDAQ' },
      { type: 'output', text: '  SOR_ALGORITHM=latency_weighted' },
      { type: 'output', text: '  SLA_INSTITUTIONAL_MIN=15' },
      { type: 'output', text: '  SLA_RETAIL_MIN=60' },
      { type: 'output', text: '  HEARTBEAT_INTERVAL=30' },
      { type: 'output', text: '  RECONNECT_INTERVAL=30' },
      { type: 'output', text: '  USER=fix-operator' },
      { type: 'output', text: '  SHELL=/bin/bash' },
      { type: 'output', text: '  PATH=/opt/fix/bin:/usr/local/bin:/usr/bin:/bin' },
    ]);
  };

  const cmdHistory = () => {
    if (history.length === 0) {
      addLines([{ type: 'output', text: 'No commands in history.' }]);
      return;
    }
    addLines([{ type: 'header', text: 'Command History' }, { type: 'header', text: '\u2500'.repeat(40) }]);
    for (let i = history.length - 1; i >= 0; i--) {
      addLines([{ type: 'output', text: `  ${String(history.length - i).padStart(3)}  ${history[i]}` }]);
    }
  };

  // ── Input handling ──

  const handleInput = (e: React.FormEvent) => {
    e.preventDefault();
    if (isTyping) return;
    runCommand(input);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0 && historyIdx < history.length - 1) {
        const newIdx = historyIdx + 1;
        setHistoryIdx(newIdx);
        setInput(history[newIdx]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx > 0) {
        const newIdx = historyIdx - 1;
        setHistoryIdx(newIdx);
        setInput(history[newIdx]);
      } else {
        setHistoryIdx(-1);
        setInput('');
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const cmds = ['show', 'send', 'cancel', 'fix', 'release', 'heartbeat', 'reset', 'dump', 'parse', 'tail', 'grep', 'scenario', 'status', 'help', 'clear', 'shortcuts', 'ls', 'cat', 'pwd', 'ps', 'sql', 'df', 'whoami', 'env', 'history'];
      const partial = input.trim().toLowerCase();
      if (partial) {
        const match = cmds.find(c => c.startsWith(partial));
        if (match) setInput(match + ' ');
      }
    }
  };

  const lineColor = (type: TerminalLine['type']) => {
    switch (type) {
      case 'error': return 'text-[var(--red)]';
      case 'header': return 'text-[var(--cyan)]';
      case 'success': return 'text-[var(--green)]';
      default: return 'text-[var(--text-primary)]';
    }
  };

  return (
    <div
      className="h-full flex flex-col bg-[#050810] border border-[var(--border-dim)] rounded-lg overflow-hidden cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {/* Terminal header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-surface)] border-b border-[var(--border-dim)] shrink-0">
        <div className="flex items-center gap-1.5">
          <Terminal size={11} className="text-[var(--cyan)]" />
          <span className="text-[9px] font-mono text-[var(--text-muted)]">FIX-MCP Terminal</span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            const text = lines.map(l => l.text).join('\n');
            navigator.clipboard.writeText(text);
          }}
          className="p-1 rounded hover:bg-[var(--bg-hover)]"
          title="Copy all output"
        >
          <Copy size={10} className="text-[var(--text-dim)]" />
        </button>
      </div>

      {/* Terminal output */}
      <div ref={terminalRef} className="flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-[1.6]">
        {lines.map((line, i) => (
          <div key={i} className={`${lineColor(line.type)} whitespace-pre-wrap break-words`}>
            {line.text}
          </div>
        ))}
      </div>

      {/* Shortcut bar */}
      <div className="flex items-center gap-1 px-2 py-1 bg-[#030610] border-t border-[var(--border-dim)] overflow-x-auto shrink-0">
        {LOG_SHORTCUTS.slice(0, 4).map((sc, i) => (
          <button key={i} onClick={() => runCommand(sc.cmd)}
            className="shrink-0 px-1.5 py-0.5 rounded text-[8px] font-mono bg-[var(--bg-surface)] border border-[var(--border-dim)] text-[var(--text-dim)] hover:text-[var(--cyan)] hover:border-[var(--cyan)]/30 transition-colors"
            title={sc.desc}>
            {sc.label}
          </button>
        ))}
        <button onClick={() => runCommand('shortcuts')}
          className="shrink-0 px-1.5 py-0.5 rounded text-[8px] font-mono bg-[var(--bg-surface)] border border-[var(--border-dim)] text-[var(--text-dim)] hover:text-[var(--amber)] hover:border-[var(--amber)]/30 transition-colors"
          title="Show all shortcuts">
          More...
        </button>
      </div>

      {/* Input line */}
      <div className="flex items-center px-3 py-2 bg-[#030610] border-t border-[var(--border-dim)] shrink-0">
        <span className="text-[var(--cyan)] font-mono text-[11px] mr-1 shrink-0 select-none">{cwd === '/opt/fix' ? '' : cwd.split('/').pop() + '/'}</span>
        <span className="text-[var(--green)] font-mono text-[11px] mr-1.5 shrink-0 select-none">fix-cli&gt;</span>
        <form onSubmit={handleInput} className="flex-1 flex items-center">
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-[var(--text-primary)] font-mono text-[11px] outline-none caret-[var(--cyan)]"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            autoComplete="off"
            spellCheck={false}
          />
        </form>
      </div>
    </div>
  );
}
