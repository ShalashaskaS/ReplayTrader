'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import CsvUploader from '@/components/CsvUploader';
import ReplayControls from '@/components/ReplayControls';
import TimeframeSelector from '@/components/TimeframeSelector';
import TabBar from '@/components/TabBar';
import DrawingToolbar from '@/components/DrawingToolbar';
import {
  useReplayEngine,
  ReplayContext,
} from '@/lib/replayEngine';
import { useDataSessions } from '@/lib/useDataSessions';
import { getConnection } from '@/lib/duckdb';
import {
  createHistoricalTable,
  insertCandles,
  getAllTimestamps,
  queryCandles,
  queryAggregatedCandles,
  type OHLCCandle,
} from '@/lib/queries';
import {
  loadDrawings,
  addDrawing as addDrawingToStore,
  generateDrawingId,
  clearSessionDrawings,
} from '@/lib/drawingManager';
import type { Drawing } from '@/components/Chart';

// Dynamic import for Chart (no SSR — depends on browser APIs)
const Chart = dynamic(() => import('@/components/Chart'), { ssr: false });

export default function Home() {
  const replay = useReplayEngine();
  const dataSessions = useDataSessions();
  const [visibleCandles, setVisibleCandles] = useState<OHLCCandle[]>([]);
  const [timeframe, setTimeframe] = useState(60);
  const [isInitializing, setIsInitializing] = useState(false);

  // Drawing state
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [activeTool, setActiveTool] = useState<'cursor' | 'hline' | 'trendline' | 'eraser'>('cursor');
  const [drawingColor, setDrawingColor] = useState('#f59e0b');

  // Use refs to avoid stale closures in callbacks
  const replayRef = useRef(replay);
  const dataSessionsRef = useRef(dataSessions);
  useEffect(() => { replayRef.current = replay; }, [replay]);
  useEffect(() => { dataSessionsRef.current = dataSessions; }, [dataSessions]);

  // Load drawings from localStorage on mount
  useEffect(() => {
    setDrawings(loadDrawings());
  }, []);

  const activeSessionId = dataSessions.activeSessionId ?? 'default';

  // Load candles into DuckDB and initialize replay
  const loadSessionIntoDB = useCallback(async (candles: OHLCCandle[]) => {
    setIsInitializing(true);
    try {
      const conn = await getConnection();
      await createHistoricalTable(conn);
      await insertCandles(conn, candles);
      const timestamps = await getAllTimestamps(conn);
      // Use ref to avoid stale closure on replay.initialize
      replayRef.current.initialize(timestamps);
    } catch (err) {
      console.error('Failed to initialize DuckDB:', err);
    } finally {
      setIsInitializing(false);
    }
  }, []);

  // Handle CSV data loaded → create new session
  const handleDataLoaded = useCallback(
    async (candles: OHLCCandle[], fileName?: string) => {
      // Use ref to get current sessions count
      const sessions = dataSessionsRef.current.sessions;
      const name = fileName || `Dataset ${sessions.length + 1}`;
      dataSessionsRef.current.addSession(name, candles);
      await loadSessionIntoDB(candles);
    },
    [loadSessionIntoDB]
  );

  // When active session changes, reload its candles into DuckDB
  const prevSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    // Skip the initial mount or when it hasn't actually changed
    if (dataSessions.activeSessionId === prevSessionIdRef.current) return;
    prevSessionIdRef.current = dataSessions.activeSessionId;

    const session = dataSessions.activeSession;
    if (session && session.candles.length > 0) {
      loadSessionIntoDB(session.candles);
    }
  }, [dataSessions.activeSessionId, dataSessions.activeSession, loadSessionIntoDB]);

  const dataLoaded = dataSessions.activeSession !== null && !isInitializing;

  // Query visible candles when currentTimestamp or timeframe changes
  useEffect(() => {
    if (!dataLoaded || replay.currentTimestamp === null) return;

    let cancelled = false;

    (async () => {
      try {
        const conn = await getConnection();
        let candles: OHLCCandle[];

        if (timeframe === 60) {
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

  // Drawing handlers
  const handleDrawingAdd = useCallback((drawing: Omit<Drawing, 'id'>) => {
    const full: Drawing = { ...drawing, id: generateDrawingId() };
    const updated = addDrawingToStore(full);
    setDrawings(updated);
    setActiveTool('cursor');
  }, []);

  const handleClearDrawings = useCallback(() => {
    const updated = clearSessionDrawings(activeSessionId);
    setDrawings(updated);
  }, [activeSessionId]);

  // Tab handlers
  const handleTabClose = useCallback((id: string) => {
    dataSessionsRef.current.removeSession(id);
  }, []);

  const handleTabSelect = useCallback((id: string) => {
    dataSessionsRef.current.switchSession(id);
  }, []);

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
            <span className="app-version">v0.2.1</span>
          </div>

          <CsvUploader onDataLoaded={handleDataLoaded} />

          {isInitializing && (
            <div className="upload-status success">
              ⏳ Initializing DuckDB engine...
            </div>
          )}

          {/* Drawing Tools */}
          {dataLoaded && (
            <div className="sidebar-section">
              <h4 className="section-title">🖊️ Drawing Tools</h4>
              <DrawingToolbar
                activeTool={activeTool}
                onToolSelect={setActiveTool}
                activeColor={drawingColor}
                onColorChange={setDrawingColor}
                onClearAll={handleClearDrawings}
              />
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

          {/* Tab Bar */}
          <TabBar
            sessions={dataSessions.sessions}
            activeSessionId={dataSessions.activeSessionId}
            onSelect={handleTabSelect}
            onClose={handleTabClose}
            onNew={() => {/* CsvUploader is always visible in sidebar */ }}
          />

          <div className="chart-area">
            {dataLoaded ? (
              <Chart
                candles={visibleCandles}
                autoFit={true}
                activeDrawingTool={activeTool}
                drawings={drawings}
                drawingColor={drawingColor}
                onDrawingAdd={handleDrawingAdd}
                sessionId={activeSessionId}
              />
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
