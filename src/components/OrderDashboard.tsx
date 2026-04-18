'use client';

import { useState, useMemo } from 'react';
import { useSystem, OrderInfo } from '@/store';
import { ArrowUpDown, ArrowUp, ArrowDown, Filter } from 'lucide-react';

type OrderRow = OrderInfo & { created_at?: string; price?: number };

type SortKey = keyof OrderRow;
type SortDir = 'asc' | 'desc';

const STATUS_COLORS: Record<string, { bg: string; text: string; pulse?: boolean }> = {
  filled:   { bg: 'bg-[var(--green-dim)]', text: 'text-[var(--green)]' },
  open:     { bg: 'bg-[var(--cyan-dim)]',    text: 'text-[var(--cyan)]' },
  new:      { bg: 'bg-[var(--cyan-dim)]',    text: 'text-[var(--cyan)]' },
  partially_filled: { bg: 'bg-[var(--amber-dim)]', text: 'text-[var(--amber)]' },
  rejected: { bg: 'bg-[var(--red-dim)]',     text: 'text-[var(--red)]' },
  stuck:    { bg: 'bg-[var(--red-dim)]',     text: 'text-[var(--red)]', pulse: true },
  canceled: { bg: 'bg-[var(--bg-elevated)]', text: 'text-[var(--text-muted)]' },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_COLORS[status.toLowerCase()] || { bg: 'bg-[var(--bg-elevated)]', text: 'text-[var(--text-muted)]' };
  const label = status.toUpperCase().replace(/_/g, ' ');
  return (
    <span className={`${config.bg} ${config.text} text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${config.pulse ? 'animate-pulse' : ''}`}>
      {label}
    </span>
  );
}

type ColumnDef = {
  key: SortKey;
  label: string;
  width: string;
  align: 'left' | 'right' | 'center';
};

const COLUMNS: ColumnDef[] = [
  { key: 'order_id', label: 'ID', width: 'w-20', align: 'left' },
  { key: 'symbol',   label: 'SYM', width: 'w-14', align: 'left' },
  { key: 'side',     label: 'SIDE', width: 'w-12', align: 'center' },
  { key: 'quantity', label: 'QTY', width: 'w-16', align: 'right' },
  { key: 'price',    label: 'PRICE', width: 'w-20', align: 'right' },
  { key: 'status',   label: 'STS', width: 'w-20', align: 'center' },
  { key: 'venue',    label: 'VENUE', width: 'w-14', align: 'center' },
  { key: 'created_at',label: 'TIME', width: 'w-20', align: 'left' },
];

export default function OrderDashboard() {
  const { orders } = useSystem();
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filterSymbol, setFilterSymbol] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterVenue, setFilterVenue] = useState('');

  const filteredAndSorted = useMemo(() => {
    let filtered = [...orders] as OrderRow[];

    if (filterSymbol) {
      filtered = filtered.filter(o => o.symbol.toLowerCase().includes(filterSymbol.toLowerCase()));
    }
    if (filterStatus) {
      filtered = filtered.filter(o => o.status.toLowerCase().includes(filterStatus.toLowerCase()));
    }
    if (filterVenue) {
      filtered = filtered.filter(o => o.venue.toLowerCase().includes(filterVenue.toLowerCase()));
    }

    filtered.sort((a, b) => {
      let aVal: any = a[sortKey];
      let bVal: any = b[sortKey];

      if (sortKey === 'quantity' || sortKey === 'price') {
        aVal = Number(aVal) || 0;
        bVal = Number(bVal) || 0;
      } else {
        aVal = String(aVal ?? '');
        bVal = String(bVal ?? '');
      }

      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [orders, sortKey, sortDir, filterSymbol, filterStatus, filterVenue]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ colKey }: { colKey: SortKey }) => {
    if (sortKey !== colKey) return <ArrowUpDown size={10} className="opacity-0 group-hover:opacity-30" />;
    return sortDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />;
  };

  const timeCell = (o: OrderRow) => {
    if (!o.created_at) return '—';
    try {
      const d = new Date(o.created_at);
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    } catch {
      return o.created_at;
    }
  };

  return (
    <div className="h-full flex flex-col bg-[var(--bg-base)]">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--border-dim)] flex items-center justify-between shrink-0">
        <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
          Order Dashboard — {filteredAndSorted.length} order(s)
        </span>
      </div>

      {/* Filter row */}
      <div className="px-3 py-1.5 border-b border-[var(--border-dim)] flex items-center gap-2 shrink-0 bg-[var(--bg-surface)]">
        <Filter size={10} className="text-[var(--text-dim)] shrink-0" />
        <input
          className="input-base !text-[10px] !py-1 !px-2 !w-20 !font-mono"
          placeholder="Symbol…"
          value={filterSymbol}
          onChange={e => setFilterSymbol(e.target.value)}
        />
        <input
          className="input-base !text-[10px] !py-1 !px-2 !w-24 !font-mono"
          placeholder="Status…"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
        />
        <input
          className="input-base !text-[10px] !py-1 !px-2 !w-20 !font-mono"
          placeholder="Venue…"
          value={filterVenue}
          onChange={e => setFilterVenue(e.target.value)}
        />
        {(filterSymbol || filterStatus || filterVenue) && (
          <button
            onClick={() => { setFilterSymbol(''); setFilterStatus(''); setFilterVenue(''); }}
            className="text-[9px] text-[var(--red)] hover:text-[var(--text-primary)] font-mono ml-auto"
          >
            Clear
          </button>
        )}
      </div>

      {/* Column headers */}
      <div className="flex items-center px-3 py-1 bg-[var(--bg-surface)] border-b border-[var(--border-dim)] shrink-0">
        {COLUMNS.map(col => (
          <button
            key={col.key}
            onClick={() => handleSort(col.key)}
            className={`flex items-center gap-0.5 group cursor-pointer ${col.width} text-${col.align} text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider hover:text-[var(--text-secondary)] transition-colors`}
          >
            {col.label}
            <SortIcon colKey={col.key} />
          </button>
        ))}
      </div>

      {/* Orders */}
      <div className="flex-1 overflow-y-auto">
        {filteredAndSorted.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-dim)] text-[10px] font-mono">
            No orders
          </div>
        ) : (
          filteredAndSorted.map((o: OrderInfo & { created_at?: string }) => (
            <div
              key={o.order_id}
              className="flex items-center px-3 py-1.5 hover:bg-[var(--bg-hover)] transition-colors border-b border-[var(--border-dim)]/30"
            >
              <span className={`w-20 text-[10px] font-mono text-[var(--text-secondary)] truncate`}>
                {o.order_id.split('-').slice(-1)[0]}
              </span>
              <span className={`w-14 text-[10px] font-mono font-semibold text-[var(--text-primary)]`}>
                {o.symbol}
              </span>
              <span className={`w-12 text-center text-[10px] font-mono ${
                o.side === 'buy' ? 'text-[var(--green)]' : 'text-[var(--red)]'
              }`}>
                {o.side.slice(0, 1).toUpperCase()}
              </span>
              <span className={`w-16 text-[10px] font-mono text-[var(--text-primary)] text-right`}>
                {o.quantity.toLocaleString()}
              </span>
              <span className={`w-20 text-[10px] font-mono text-[var(--text-secondary)] text-right`}>
                {o.price != null ? `$${o.price.toFixed(2)}` : 'MKT'}
              </span>
              <span className={`w-20 text-center`}>
                <StatusBadge status={o.status} />
              </span>
              <span className={`w-14 text-[10px] font-mono text-[var(--text-muted)] text-center`}>
                {o.venue}
              </span>
              <span className={`w-20 text-[10px] font-mono text-[var(--text-dim)]`}>
                {timeCell(o as any)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
