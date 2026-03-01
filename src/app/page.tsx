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

const DEFAULT_PANE_TFS: Record<string, number[]> = {
  '1': [60],
  '1x2': [60, 300],
  '2x2': [60, 300, 3600, 86400],
};

interface TabSettings {
  splitLayout: string;
  paneTimeframes: number[];
}

export default function Home() {
  const replay = useReplayEngine();
  const dataSessions = useDataSessions();
  const [isInitializing, setIsInitializing] = useState(false);

  // Per-tab settings (split layout + pane timeframes)
  const tabSettingsRef = useRef<Record<string, TabSettings>>({});
  const [splitLayout, setSplitLayout] = useState('1');
  const [paneTimeframes, setPaneTimeframes] = useState<number[]>([60]);

  // Per-pane candle data
  const [paneCandles, setPaneCandles] = useState<Record<number, OHLCCandle[]>>({});

  // Crosshair sync across panes
  const [syncTime, setSyncTime] = useState<number | null>(null);
  const syncSourceRef = useRef<string | null>(null);

  // Drawing state
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [activeTool, setActiveTool] = useState<DrawingTool>('cursor');
  const [drawingColor, setDrawingColor] = useState('#f59e0b');

  // Refs to avoid stale closures
  const replayRef = useRef(replay);
  const dataSessionsRef = useRef(dataSessions);
  useEffect(() => { replayRef.current = replay; }, [replay]);
  useEffect(() => { dataSessionsRef.current = dataSessions; }, [dataSessions]);

  useEffect(() => { setDrawings(loadDrawings()); }, []);

  const activeSessionId = dataSessions.activeSessionId ?? 'default';

  // Session index tracking
  const sessionIndexMap = useRef<Record<string, number>>({});

  // Save current tab settings before switching
  const saveTabSettings = useCallback(() => {
    const sid = dataSessionsRef.current.activeSessionId;
    if (sid) {
      tabSettingsRef.current[sid] = { splitLayout, paneTimeframes: [...paneTimeframes] };
    }
  }, [splitLayout, paneTimeframes]);

  // Handle split layout change — save for current tab
  const handleLayoutChange = useCallback((layout: string) => {
    setSplitLayout(layout);
    const tfs = DEFAULT_PANE_TFS[layout] || [60];
    setPaneTimeframes(tfs);
  }, []);

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

  // Handle CSV loaded
  const handleDataLoaded = useCallback(
    async (candles: OHLCCandle[], fileName?: string) => {
      const sessions = dataSessionsRef.current.sessions;
      const name = fileName || `Dataset ${sessions.length + 1}`;
      dataSessionsRef.current.addSession(name, candles);
      await loadSessionIntoDB(candles);
    },
    [loadSessionIntoDB]
  );

  // Tab switching — save old settings, restore new tab's settings
  const prevSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (dataSessions.activeSessionId === prevSessionIdRef.current) return;

    // Save old tab's settings + replay index
    if (prevSessionIdRef.current) {
      sessionIndexMap.current[prevSessionIdRef.current] = replayRef.current.currentIndex;
      tabSettingsRef.current[prevSessionIdRef.current] = {
        splitLayout,
        paneTimeframes: [...paneTimeframes],
      };
    }
    prevSessionIdRef.current = dataSessions.activeSessionId;

    // Restore new tab's settings
    if (dataSessions.activeSessionId && tabSettingsRef.current[dataSessions.activeSessionId]) {
      const saved = tabSettingsRef.current[dataSessions.activeSessionId];
      setSplitLayout(saved.splitLayout);
      setPaneTimeframes(saved.paneTimeframes);
    }

    const session = dataSessions.activeSession;
    if (session && session.candles.length > 0) {
      const savedIndex = dataSessions.activeSessionId
        ? sessionIndexMap.current[dataSessions.activeSessionId] ?? 0
        : 0;
      loadSessionIntoDB(session.candles, savedIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSessions.activeSessionId, dataSessions.activeSession, loadSessionIntoDB]);

  const dataLoaded = dataSessions.activeSession !== null && !isInitializing;

  // Query candles for each pane
  useEffect(() => {
    if (!dataLoaded || replay.currentTimestamp === null) return;
    let cancelled = false;

    (async () => {
      try {
        const conn = await getConnection();
        const results: Record<number, OHLCCandle[]> = {};
        for (let i = 0; i < paneTimeframes.length; i++) {
          const tf = paneTimeframes[i];
          results[i] = tf === 60
            ? await queryCandles(conn, replay.currentTimestamp!)
            : await queryAggregatedCandles(conn, replay.currentTimestamp!, tf);
        }
        if (!cancelled) setPaneCandles(results);
      } catch (err) {
        console.error('Query error:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [replay.currentTimestamp, paneTimeframes, dataLoaded]);

  // Drawing handlers — tool stays active (no auto-switch to cursor)
  const handleDrawingAdd = useCallback((drawing: Omit<Drawing, 'id'>) => {
    const full: Drawing = { ...drawing, id: generateDrawingId() };
    const updated = addDrawingToStore(full);
    setDrawings(updated);
    // Don't auto-switch to cursor — let user keep drawing
  }, []);

  const handleClearDrawings = useCallback(() => {
    const updated = clearSessionDrawings(activeSessionId);
    setDrawings(updated);
  }, [activeSessionId]);

  // Tab handlers
  const handleTabClose = useCallback((id: string) => {
    saveTabSettings();
    dataSessionsRef.current.removeSession(id);
  }, [saveTabSettings]);

  const handleTabSelect = useCallback((id: string) => {
    saveTabSettings();
    dataSessionsRef.current.switchSession(id);
  }, [saveTabSettings]);

  const handleTabNew = useCallback(() => {
    saveTabSettings();
    const current = dataSessionsRef.current.activeSession;
    if (current) {
      dataSessionsRef.current.addSession(current.name + ' (copy)', current.candles);
    }
  }, [saveTabSettings]);

  // Pane timeframe change
  const handlePaneTimeframeChange = useCallback((paneIndex: number, tf: number) => {
    setPaneTimeframes(prev => {
      const next = [...prev];
      next[paneIndex] = tf;
      return next;
    });
  }, []);

  // Crosshair sync handler — when one pane moves, others follow
  const handleCrosshairTime = useCallback((paneKey: string, time: number | null) => {
    syncSourceRef.current = paneKey;
    setSyncTime(time);
  }, []);

  // Escape key to switch back to cursor
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveTool('cursor');
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const replayContextValue = useMemo(() => replay, [replay]);
  const paneCount = splitLayout === '1' ? 1 : splitLayout === '1x2' ? 2 : 4;

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
        {/* Vertical Drawing Toolbar */}
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

        <div className="main-content">
          {/* Top Bar */}
          <div className="top-bar">
            <div className="top-bar-left">
              <span className="app-title">📈 ReplayTrader</span>
              <span className="app-version-badge">v0.3.1</span>
            </div>
            <div className="top-bar-center">
              <SplitLayoutSelector
                layout={splitLayout}
                onLayoutChange={handleLayoutChange}
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

          {/* Chart Grid */}
          <div className="chart-grid" style={gridStyle}>
            {dataLoaded ? (
              Array.from({ length: paneCount }).map((_, idx) => {
                const paneKey = `pane-${idx}`;
                return (
                  <div key={paneKey} className="chart-pane">
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
                        paneId={paneKey}
                        syncTimestamp={syncSourceRef.current !== paneKey ? syncTime : null}
                        onCrosshairTime={(t) => handleCrosshairTime(paneKey, t)}
                      />
                    </div>
                  </div>
                );
              })
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
