'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
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
  const [showUploader, setShowUploader] = useState(true);

  // Drawing state
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [activeTool, setActiveTool] = useState<'cursor' | 'hline' | 'trendline' | 'eraser'>('cursor');
  const [drawingColor, setDrawingColor] = useState('#f59e0b');

  // Load drawings from localStorage on mount
  useEffect(() => {
    setDrawings(loadDrawings());
  }, []);

  const activeSessionId = dataSessions.activeSessionId ?? 'default';

  // Load DuckDB data when active session changes
  const loadSessionIntoDB = useCallback(async (candles: OHLCCandle[]) => {
    setIsInitializing(true);
    try {
      const conn = await getConnection();
      await createHistoricalTable(conn);
      await insertCandles(conn, candles);
      const timestamps = await getAllTimestamps(conn);
      replay.initialize(timestamps);
    } catch (err) {
      console.error('Failed to initialize DuckDB:', err);
    } finally {
      setIsInitializing(false);
    }
  }, [replay]);

  // Handle CSV data loaded → create new session
  const handleDataLoaded = useCallback(
    async (candles: OHLCCandle[], fileName?: string) => {
      const name = fileName || `Dataset ${dataSessions.sessions.length + 1}`;
      dataSessions.addSession(name, candles);
      setShowUploader(false);
      await loadSessionIntoDB(candles);
    },
    [dataSessions, loadSessionIntoDB]
  );

  // When active session changes, reload its candles into DuckDB
  useEffect(() => {
    const session = dataSessions.activeSession;
    if (session && session.candles.length > 0) {
      loadSessionIntoDB(session.candles);
      setShowUploader(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSessions.activeSessionId]);

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
    setActiveTool('cursor'); // Return to cursor after drawing
  }, []);

  const handleClearDrawings = useCallback(() => {
    const updated = clearSessionDrawings(activeSessionId);
    setDrawings(updated);
  }, [activeSessionId]);

  // Tab handlers
  const handleTabNew = useCallback(() => {
    setShowUploader(true);
  }, []);

  const handleTabClose = useCallback((id: string) => {
    dataSessions.removeSession(id);
    if (dataSessions.sessions.length <= 1) {
      setShowUploader(true);
    }
  }, [dataSessions]);

  const handleTabSelect = useCallback((id: string) => {
    dataSessions.switchSession(id);
  }, [dataSessions]);

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
            <span className="app-version">v0.2.0</span>
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
            onNew={handleTabNew}
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
