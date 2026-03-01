'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import CsvUploader from '@/components/CsvUploader';
import ReplayControls from '@/components/ReplayControls';
import TabBar from '@/components/TabBar';
import DrawingToolbar from '@/components/DrawingToolbar';
import SplitLayoutSelector from '@/components/SplitLayoutSelector';
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
import type { Drawing, DrawingTool } from '@/components/Chart';

const Chart = dynamic(() => import('@/components/Chart'), { ssr: false });

const TIMEFRAME_LABELS: Record<number, string> = {
  60: '1m', 300: '5m', 900: '15m', 3600: '1H', 14400: '4H', 86400: '1D',
};

const DEFAULT_PANE_TIMEFRAMES: Record<string, number[]> = {
  '1': [60],
  '1x2': [60, 300],
  '2x2': [60, 300, 3600, 86400],
};

export default function Home() {
  const replay = useReplayEngine();
  const dataSessions = useDataSessions();
  const [isInitializing, setIsInitializing] = useState(false);
  const [splitLayout, setSplitLayout] = useState('1');

  // Per-pane candle data (indexed by pane index)
  const [paneCandles, setPaneCandles] = useState<Record<number, OHLCCandle[]>>({});
  const [paneTimeframes, setPaneTimeframes] = useState<number[]>([60]);

  // Drawing state
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [activeTool, setActiveTool] = useState<DrawingTool>('cursor');
  const [drawingColor, setDrawingColor] = useState('#f59e0b');

  // Refs to avoid stale closures
  const replayRef = useRef(replay);
  const dataSessionsRef = useRef(dataSessions);
  useEffect(() => { replayRef.current = replay; }, [replay]);
  useEffect(() => { dataSessionsRef.current = dataSessions; }, [dataSessions]);

  // Load drawings on mount
  useEffect(() => {
    setDrawings(loadDrawings());
  }, []);

  const activeSessionId = dataSessions.activeSessionId ?? 'default';

  // Session index tracking
  const sessionIndexMap = useRef<Record<string, number>>({});

  // When split layout changes, set default timeframes
  useEffect(() => {
    const tfs = DEFAULT_PANE_TIMEFRAMES[splitLayout] || [60];
    setPaneTimeframes(tfs);
  }, [splitLayout]);

  // Load candles into DuckDB
  const loadSessionIntoDB = useCallback(async (candles: OHLCCandle[], restoreIndex?: number) => {
    setIsInitializing(true);
    try {
      const conn = await getConnection();
      await createHistoricalTable(conn);
      await insertCandles(conn, candles);
      const timestamps = await getAllTimestamps(conn);
      replayRef.current.initialize(timestamps, restoreIndex);
    } catch (err) {
      console.error('Failed to initialize DuckDB:', err);
    } finally {
      setIsInitializing(false);
    }
  }, []);

  // Handle CSV data loaded
  const handleDataLoaded = useCallback(
    async (candles: OHLCCandle[], fileName?: string) => {
      const sessions = dataSessionsRef.current.sessions;
      const name = fileName || `Dataset ${sessions.length + 1}`;
      dataSessionsRef.current.addSession(name, candles);
      await loadSessionIntoDB(candles);
    },
    [loadSessionIntoDB]
  );

  // Tab switching
  const prevSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (dataSessions.activeSessionId === prevSessionIdRef.current) return;
    if (prevSessionIdRef.current) {
      sessionIndexMap.current[prevSessionIdRef.current] = replayRef.current.currentIndex;
    }
    prevSessionIdRef.current = dataSessions.activeSessionId;
    const session = dataSessions.activeSession;
    if (session && session.candles.length > 0) {
      const savedIndex = dataSessions.activeSessionId
        ? sessionIndexMap.current[dataSessions.activeSessionId] ?? 0
        : 0;
      loadSessionIntoDB(session.candles, savedIndex);
    }
  }, [dataSessions.activeSessionId, dataSessions.activeSession, loadSessionIntoDB]);

  const dataLoaded = dataSessions.activeSession !== null && !isInitializing;

  // Query candles for each pane when timestamp or timeframes change
  useEffect(() => {
    if (!dataLoaded || replay.currentTimestamp === null) return;
    let cancelled = false;

    (async () => {
      try {
        const conn = await getConnection();
        const results: Record<number, OHLCCandle[]> = {};

        for (let i = 0; i < paneTimeframes.length; i++) {
          const tf = paneTimeframes[i];
          if (tf === 60) {
            results[i] = await queryCandles(conn, replay.currentTimestamp!);
          } else {
            results[i] = await queryAggregatedCandles(conn, replay.currentTimestamp!, tf);
          }
        }

        if (!cancelled) {
          setPaneCandles(results);
        }
      } catch (err) {
        console.error('Query error:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [replay.currentTimestamp, paneTimeframes, dataLoaded]);

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

  const handleTabNew = useCallback(() => {
    // Clone current session into a new tab
    const current = dataSessionsRef.current.activeSession;
    if (current) {
      const name = current.name + ' (copy)';
      dataSessionsRef.current.addSession(name, current.candles);
    }
  }, []);

  // Pane timeframe change
  const handlePaneTimeframeChange = useCallback((paneIndex: number, tf: number) => {
    setPaneTimeframes(prev => {
      const next = [...prev];
      next[paneIndex] = tf;
      return next;
    });
  }, []);

  const replayContextValue = useMemo(() => replay, [replay]);

  // Calculate pane count
  const paneCount = splitLayout === '1' ? 1 : splitLayout === '1x2' ? 2 : 4;

  // Grid style for split layout
  const gridStyle = useMemo(() => {
    switch (splitLayout) {
      case '1x2': return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' };
      case '2x2': return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' };
      default: return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };
    }
  }, [splitLayout]);

  return (
    <ReplayContext.Provider value={replayContextValue}>
      <div className="app-layout-tv">
        {/* ─── Left Drawing Toolbar (vertical, TradingView style) ──── */}
        {dataLoaded && (
          <div className="left-toolbar">
            <DrawingToolbar
              activeTool={activeTool}
              onToolSelect={setActiveTool}
              activeColor={drawingColor}
              onColorChange={setDrawingColor}
              onClearAll={handleClearDrawings}
              vertical
            />
          </div>
        )}

        {/* ─── Main Content ─────────────────────────────────────────── */}
        <div className="main-content">
          {/* Top Bar */}
          <div className="top-bar">
            <div className="top-bar-left">
              <span className="app-title">📈 ReplayTrader</span>
              <span className="app-version-badge">v0.3</span>
            </div>
            <div className="top-bar-center">
              <SplitLayoutSelector
                layout={splitLayout}
                onLayoutChange={setSplitLayout}
              />
            </div>
            <div className="top-bar-right">
              <CsvUploader onDataLoaded={handleDataLoaded} />
            </div>
          </div>

          {/* Tab Bar */}
          <TabBar
            sessions={dataSessions.sessions}
            activeSessionId={dataSessions.activeSessionId}
            onSelect={handleTabSelect}
            onClose={handleTabClose}
            onNew={handleTabNew}
          />

          {/* Charts Grid */}
          <div className="chart-grid" style={gridStyle}>
            {dataLoaded ? (
              Array.from({ length: paneCount }).map((_, idx) => (
                <div key={idx} className="chart-pane">
                  <div className="pane-header">
                    {[60, 300, 900, 3600, 14400, 86400].map(tf => (
                      <button
                        key={tf}
                        className={`tf-btn ${paneTimeframes[idx] === tf ? 'active' : ''}`}
                        onClick={() => handlePaneTimeframeChange(idx, tf)}
                      >
                        {TIMEFRAME_LABELS[tf]}
                      </button>
                    ))}
                  </div>
                  <div className="pane-chart">
                    <Chart
                      candles={paneCandles[idx] || []}
                      autoFit={true}
                      activeDrawingTool={activeTool}
                      drawings={drawings}
                      drawingColor={drawingColor}
                      onDrawingAdd={handleDrawingAdd}
                      sessionId={activeSessionId}
                      label={TIMEFRAME_LABELS[paneTimeframes[idx]] || '1m'}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="chart-placeholder">
                <span className="placeholder-icon">📊</span>
                <p>Upload a CSV file to start replaying</p>
              </div>
            )}
          </div>

          {/* Bottom Controls */}
          {dataLoaded && (
            <div className="controls-area">
              <ReplayControls />
            </div>
          )}
        </div>
      </div>
    </ReplayContext.Provider>
  );
}
