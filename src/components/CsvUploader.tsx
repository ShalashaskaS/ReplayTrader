'use client';

import { useState, useRef, useCallback } from 'react';
import type { OHLCCandle } from '@/lib/queries';

interface CsvUploaderProps {
    onDataLoaded: (candles: OHLCCandle[], fileName?: string) => void;
}

// Format detectors
interface ColumnMapping {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    timestampFormat: 'unix_auto' | 'unix_s' | 'unix_ms' | 'unix_us' | 'iso' | 'stooq' | 'histdata';
}

function detectFormat(headers: string[]): ColumnMapping | null {
    const lower = headers.map((h) => h.trim().toLowerCase().replace(/[<>"]/g, ''));

    // Binance: open_time, open, high, low, close, volume, ...
    if (lower.includes('open_time') || (lower[0] === 'open_time')) {
        return {
            timestamp: lower.indexOf('open_time') >= 0 ? lower.indexOf('open_time') : 0,
            open: findCol(lower, ['open']),
            high: findCol(lower, ['high']),
            low: findCol(lower, ['low']),
            close: findCol(lower, ['close']),
            volume: findCol(lower, ['volume']),
            timestampFormat: 'unix_ms',
        };
    }

    // Stooq: Date, Open, High, Low, Close, Volume
    if (lower.includes('date') && lower.includes('open')) {
        return {
            timestamp: lower.indexOf('date'),
            open: findCol(lower, ['open']),
            high: findCol(lower, ['high']),
            low: findCol(lower, ['low']),
            close: findCol(lower, ['close']),
            volume: findCol(lower, ['volume', 'vol']),
            timestampFormat: 'stooq',
        };
    }

    // HistData: <DTYYYYMMDD>;<TICKTIME>;<OPEN>;<HIGH>;<LOW>;<CLOSE>;<VOL>
    if (lower.includes('dtyyyymmdd') || lower.includes('date') || lower[0].includes('dt')) {
        return {
            timestamp: 0,
            open: findCol(lower, ['open']) >= 0 ? findCol(lower, ['open']) : 2,
            high: findCol(lower, ['high']) >= 0 ? findCol(lower, ['high']) : 3,
            low: findCol(lower, ['low']) >= 0 ? findCol(lower, ['low']) : 4,
            close: findCol(lower, ['close']) >= 0 ? findCol(lower, ['close']) : 5,
            volume: findCol(lower, ['vol', 'volume']) >= 0 ? findCol(lower, ['vol', 'volume']) : 6,
            timestampFormat: 'histdata',
        };
    }

    // Generic fallback: try to match common names
    const ts = findCol(lower, ['timestamp', 'time', 'datetime', 'date']);
    const op = findCol(lower, ['open']);
    const hi = findCol(lower, ['high']);
    const lo = findCol(lower, ['low']);
    const cl = findCol(lower, ['close']);
    const vo = findCol(lower, ['volume', 'vol']);

    if (ts >= 0 && op >= 0 && hi >= 0 && lo >= 0 && cl >= 0) {
        return {
            timestamp: ts, open: op, high: hi, low: lo, close: cl,
            volume: vo >= 0 ? vo : -1,
            timestampFormat: 'iso',
        };
    }

    // Binance raw format (no header, 12 columns): open_time,O,H,L,C,V,close_time,...
    // Also handles generic positional (0=ts, 1=O, 2=H, 3=L, 4=C, 5=V)
    if (lower.length >= 5) {
        return {
            timestamp: 0, open: 1, high: 2, low: 3, close: 4,
            volume: lower.length > 5 ? 5 : -1,
            timestampFormat: 'unix_auto',
        };
    }

    return null;
}

function findCol(headers: string[], names: string[]): number {
    for (const name of names) {
        const idx = headers.findIndex((h) => h === name || h.endsWith(name));
        if (idx >= 0) return idx;
    }
    return -1;
}

function parseTimestamp(value: string, fmt: ColumnMapping['timestampFormat']): number {
    switch (fmt) {
        case 'unix_auto': {
            // Auto-detect based on magnitude:
            // seconds:      10 digits (1_000_000_000 - 9_999_999_999)
            // milliseconds: 13 digits
            // microseconds: 16 digits
            const n = Number(value);
            if (n > 1e15) return Math.floor(n / 1_000_000);  // microseconds
            if (n > 1e12) return Math.floor(n / 1_000);       // milliseconds
            return n;                                          // seconds
        }
        case 'unix_s':
            return Number(value);
        case 'unix_us':
            return Math.floor(Number(value) / 1_000_000);
        case 'unix_ms':
            return Math.floor(Number(value) / 1000);
        case 'iso':
            return Math.floor(new Date(value).getTime() / 1000);
        case 'stooq': {
            // Format: YYYY-MM-DD or YYYYMMDD
            const cleaned = value.replace(/-/g, '');
            const y = parseInt(cleaned.slice(0, 4));
            const m = parseInt(cleaned.slice(4, 6)) - 1;
            const d = parseInt(cleaned.slice(6, 8));
            return Math.floor(new Date(y, m, d).getTime() / 1000);
        }
        case 'histdata': {
            // Format: YYYYMMDD or YYYYMMDD HHMMSS
            const parts = value.trim().split(/\s+/);
            const dateStr = parts[0].replace(/-/g, '');
            const y = parseInt(dateStr.slice(0, 4));
            const m = parseInt(dateStr.slice(4, 6)) - 1;
            const d = parseInt(dateStr.slice(6, 8));
            if (parts.length > 1) {
                const timeStr = parts[1].replace(/:/g, '');
                const hh = parseInt(timeStr.slice(0, 2));
                const mm = parseInt(timeStr.slice(2, 4));
                const ss = timeStr.length >= 6 ? parseInt(timeStr.slice(4, 6)) : 0;
                return Math.floor(new Date(y, m, d, hh, mm, ss).getTime() / 1000);
            }
            return Math.floor(new Date(y, m, d).getTime() / 1000);
        }
        default:
            return Number(value);
    }
}

export default function CsvUploader({ onDataLoaded }: CsvUploaderProps) {
    const [status, setStatus] = useState<string>('');
    const [rowCount, setRowCount] = useState<number>(0);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const processFile = useCallback(
        async (file: File) => {
            setIsLoading(true);
            setStatus('Reading file...');

            try {
                const text = await file.text();
                const delimiter = text.includes(';') && !text.includes(',') ? ';' : ',';
                const lines = text.split(/\r?\n/).filter((l) => l.trim());

                if (lines.length < 2) {
                    setStatus('Error: file is empty or has no data rows.');
                    setIsLoading(false);
                    return;
                }

                const headers = lines[0].split(delimiter);
                const mapping = detectFormat(headers);

                if (!mapping) {
                    setStatus('Error: unable to detect CSV format.');
                    setIsLoading(false);
                    return;
                }

                setStatus(`Detected format: ${mapping.timestampFormat}. Parsing ${lines.length - 1} rows...`);

                // Check if first row is purely numeric (no header)
                const firstDataRow = lines[0].split(delimiter);
                const hasHeader = isNaN(Number(firstDataRow[0]));
                const startIdx = hasHeader ? 1 : 0;

                const candles: OHLCCandle[] = [];
                for (let i = startIdx; i < lines.length; i++) {
                    const cols = lines[i].split(delimiter);
                    if (cols.length < 5) continue;

                    const ts = parseTimestamp(cols[mapping.timestamp], mapping.timestampFormat);
                    const open = parseFloat(cols[mapping.open]);
                    const high = parseFloat(cols[mapping.high]);
                    const low = parseFloat(cols[mapping.low]);
                    const close = parseFloat(cols[mapping.close]);
                    const volume = mapping.volume >= 0 ? parseFloat(cols[mapping.volume]) || 0 : 0;

                    if (isNaN(ts) || isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) continue;

                    candles.push({ time: ts, open, high, low, close, volume });
                }

                // Sort by timestamp ASC
                candles.sort((a, b) => a.time - b.time);

                setRowCount(candles.length);
                setStatus(`✓ Loaded ${candles.length.toLocaleString()} candles from "${file.name}"`);
                onDataLoaded(candles, file.name.replace(/\.[^/.]+$/, ''));
            } catch (err) {
                setStatus(`Error: ${(err as Error).message}`);
            } finally {
                setIsLoading(false);
            }
        },
        [onDataLoaded]
    );

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            setIsDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) processFile(file);
        },
        [processFile]
    );

    const handleFileSelect = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (file) processFile(file);
        },
        [processFile]
    );

    return (
        <div className="csv-uploader">
            <h3 className="uploader-title">📂 Data Source</h3>

            <div
                className={`drop-zone ${isDragOver ? 'drag-over' : ''} ${isLoading ? 'loading' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                id="csv-drop-zone"
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.txt"
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                    id="csv-file-input"
                />
                {isLoading ? (
                    <div className="drop-zone-content">
                        <div className="spinner" />
                        <span>Processing...</span>
                    </div>
                ) : (
                    <div className="drop-zone-content">
                        <span className="drop-icon">⬆</span>
                        <span>Drop CSV or click to browse</span>
                        <span className="drop-hint">Binance · Stooq · HistData</span>
                    </div>
                )}
            </div>

            {status && (
                <div className={`upload-status ${status.startsWith('Error') ? 'error' : 'success'}`}>
                    {status}
                </div>
            )}

            {rowCount > 0 && (
                <div className="upload-stats">
                    <span className="stat-label">Candles:</span>
                    <span className="stat-value">{rowCount.toLocaleString()}</span>
                </div>
            )}
        </div>
    );
}
