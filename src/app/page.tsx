'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import CsvUploader from '@/components/CsvUploader';
import ReplayControls from '@/components/ReplayControls';
import TimeframeSelector from '@/components/TimeframeSelector';
import {
  useReplayEngine,
  ReplayContext,
} from '@/lib/replayEngine';
import { getConnection } from '@/lib/duckdb';
import {
  createHistoricalTable,
  insertCandles,
  getAllTimestamps,
  queryCandles,
  queryAggregatedCandles,
  type OHLCCandle,
} from '@/lib/queries';

// Dynamic import for Chart (no SSR — depends on browser APIs)
const Chart = dynamic(() => import('@/components/Chart'), { ssr: false });

export default function Home() {
  const replay = useReplayEngine();
  const [visibleCandles, setVisibleCandles] = useState<OHLCCandle[]>([]);
  const [timeframe, setTimeframe] = useState(60); // default 1m = 60s
  const [dataLoaded, setDataLoaded] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);

  // Handle CSV data loaded → insert into DuckDB → initialize replay
  const handleDataLoaded = useCallback(
    async (candles: OHLCCandle[]) => {
      setIsInitializing(true);
      try {
        const conn = await getConnection();
        await createHistoricalTable(conn);
        await insertCandles(conn, candles);
        const timestamps = await getAllTimestamps(conn);
        replay.initialize(timestamps);
        setDataLoaded(true);
      } catch (err) {
        console.error('Failed to initialize DuckDB:', err);
      } finally {
        setIsInitializing(false);
      }
    },
    [replay]
  );

  // Query visible candles when currentTimestamp or timeframe changes
  useEffect(() => {
    if (!dataLoaded || replay.currentTimestamp === null) return;

    let cancelled = false;

    (async () => {
      try {
        const conn = await getConnection();
        let candles: OHLCCandle[];

        if (timeframe === 60) {
          // Base timeframe — no aggregation needed
          candles = await queryCandles(conn, replay.currentTimestamp!);
        } else {
          candles = await queryAggregatedCandles(
            conn,
            replay.currentTimestamp!,
            timeframe
          );
        }

        if (!cancelled) {
          setVisibleCandles(candles);
        }
      } catch (err) {
        console.error('Query error:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [replay.currentTimestamp, timeframe, dataLoaded]);

  // Memoize the context value
  const replayContextValue = useMemo(() => replay, [replay]);

  return (
    <ReplayContext.Provider value={replayContextValue}>
      <div className="app-layout">
        {/* ─── Sidebar ──────────────────────────────────────────── */}
        <aside className="sidebar">
          <div className="app-logo">
            <span className="logo-icon">📈</span>
            <h1>ReplayTrader</h1>
            <span className="app-version">v0.1.0</span>
          </div>

          <CsvUploader onDataLoaded={handleDataLoaded} />

          {isInitializing && (
            <div className="upload-status success">
              ⏳ Initializing DuckDB engine...
            </div>
          )}

          {/* Keyboard Shortcuts Help */}
          <div className="sidebar-section">
            <h4 className="section-title">⌨️ Shortcuts</h4>
            <div className="keyboard-shortcuts">
              <div className="shortcut-item">
                <span>Forward 1</span>
                <span className="shortcut-key">→</span>
              </div>
              <div className="shortcut-item">
                <span>Back 1</span>
                <span className="shortcut-key">←</span>
              </div>
              <div className="shortcut-item">
                <span>Forward 10</span>
                <span className="shortcut-key">Shift + →</span>
              </div>
              <div className="shortcut-item">
                <span>Back 10</span>
                <span className="shortcut-key">Shift + ←</span>
              </div>
              <div className="shortcut-item">
                <span>Play / Pause</span>
                <span className="shortcut-key">Space</span>
              </div>
              <div className="shortcut-item">
                <span>Reset</span>
                <span className="shortcut-key">Home</span>
              </div>
            </div>
          </div>

          {/* Attribution */}
          <div
            style={{
              marginTop: 'auto',
              fontSize: '0.65rem',
              color: 'var(--text-muted)',
              lineHeight: 1.4,
            }}
          >
            Charts by{' '}
            <a
              href="https://www.tradingview.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--accent)' }}
            >
              TradingView
            </a>
            {' '}· Powered by DuckDB
          </div>
        </aside>

        {/* ─── Main Chart Area ──────────────────────────────────── */}
        <main className="main-area">
          <div className="chart-header">
            <TimeframeSelector
              activeTimeframe={timeframe}
              onSelect={setTimeframe}
            />
          </div>
          <div className="chart-area">
            {dataLoaded ? (
              <Chart candles={visibleCandles} />
            ) : (
              <div className="chart-placeholder">
                <span className="placeholder-icon">📊</span>
                <p>Upload a CSV file to start replaying</p>
              </div>
            )}
          </div>
        </main>

        {/* ─── Bottom Controls ──────────────────────────────────── */}
        <div className="controls-area">
          <ReplayControls />
        </div>
      </div>
    </ReplayContext.Provider>
  );
}
