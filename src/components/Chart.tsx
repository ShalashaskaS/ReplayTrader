'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import {
    createChart,
    CandlestickSeries,
    HistogramSeries,
    type IChartApi,
    type ISeriesApi,
    type CandlestickData,
    type HistogramData,
    ColorType,
    type Time,
    type LogicalRange,
    type IPriceLine,
} from 'lightweight-charts';
import type { OHLCCandle } from '@/lib/queries';

export interface DrawingPoint {
    time: number;
    logical?: number;
    price: number;
}

export type DrawingType = 'hline' | 'trendline' | 'rect';

export interface Drawing {
    id: string;
    type: DrawingType;
    points: DrawingPoint[];
    color: string;
    sessionId: string;
}

export type DrawingTool = 'cursor' | 'hline' | 'trendline' | 'rect' | 'eraser';

interface ChartProps {
    candles: OHLCCandle[];
    autoFit?: boolean;
    activeDrawingTool?: DrawingTool | null;
    drawings?: Drawing[];
    drawingColor?: string;
    onDrawingAdd?: (drawing: Omit<Drawing, 'id'>) => void;
    onDrawingRemove?: (id: string) => void;
    onDrawingUpdate?: (drawing: Drawing) => void;
    sessionId?: string;
    syncTimestamp?: number | null;
    onCrosshairTime?: (time: number | null) => void;
    paneId?: string;
    initialLogicalRange?: LogicalRange | null;
    onLogicalRangeChange?: (range: LogicalRange | null) => void;
}

// Helper: distance between point and line segment
function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
    const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

export default function Chart({
    candles,
    autoFit = true,
    activeDrawingTool = 'cursor',
    drawings = [],
    drawingColor = '#f59e0b',
    onDrawingAdd,
    onDrawingRemove,
    onDrawingUpdate,
    sessionId = 'default',
    syncTimestamp,
    onCrosshairTime,
    paneId,
    initialLogicalRange,
    onLogicalRangeChange,
}: ChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    const priceLinesRef = useRef<IPriceLine[]>([]);

    const isSyncingRef = useRef(false);

    // OHLC info overlay state
    const [ohlcInfo, setOhlcInfo] = useState<{
        open: number; high: number; low: number; close: number;
        volume: number; change: number; changePercent: number; isUp: boolean;
    } | null>(null);

    // Interactive Drawing Refs
    const pendingPointRef = useRef<DrawingPoint | null>(null);
    const mousePosRef = useRef<{ x: number, y: number, time: number, price: number } | null>(null);

    // Selection State
    const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);

    // Refs to avoid stale closures
    const activeToolRef = useRef(activeDrawingTool);
    const drawingColorRef = useRef(drawingColor);
    const onDrawingAddRef = useRef(onDrawingAdd);
    const onDrawingRemoveRef = useRef(onDrawingRemove);
    const onDrawingUpdateRef = useRef(onDrawingUpdate);
    const sessionIdRef = useRef(sessionId);
    const drawingsRef = useRef(drawings);
    const onCrosshairTimeRef = useRef(onCrosshairTime);
    const selectedDrawingIdRef = useRef(selectedDrawingId);
    const onLogicalRangeChangeRef = useRef(onLogicalRangeChange);
    const isFirstRenderRef = useRef(true);

    useEffect(() => { activeToolRef.current = activeDrawingTool; }, [activeDrawingTool]);
    useEffect(() => { drawingColorRef.current = drawingColor; }, [drawingColor]);
    useEffect(() => { onDrawingAddRef.current = onDrawingAdd; }, [onDrawingAdd]);
    useEffect(() => { onDrawingRemoveRef.current = onDrawingRemove; }, [onDrawingRemove]);
    useEffect(() => { onDrawingUpdateRef.current = onDrawingUpdate; }, [onDrawingUpdate]);
    useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
    useEffect(() => { drawingsRef.current = drawings; }, [drawings]);
    useEffect(() => { onCrosshairTimeRef.current = onCrosshairTime; }, [onCrosshairTime]);
    useEffect(() => { selectedDrawingIdRef.current = selectedDrawingId; }, [selectedDrawingId]);
    useEffect(() => { onLogicalRangeChangeRef.current = onLogicalRangeChange; }, [onLogicalRangeChange]);

    // Canvas drawing function
    const redrawCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        const chart = chartRef.current;
        const series = candleSeriesRef.current;
        if (!canvas || !chart || !series) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const rect = canvas.parentElement?.getBoundingClientRect();
        if (!rect) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, rect.width, rect.height);

        const sid = sessionIdRef.current;
        const allDrawings = drawingsRef.current.filter(d => d.sessionId === sid);
        const timeScale = chart.timeScale();
        const selId = selectedDrawingIdRef.current;

        // Render persisted drawings
        for (const d of allDrawings) {
            const isSel = d.id === selId;

            if (d.type === 'trendline' && d.points.length === 2) {
                const p1 = d.points[0], p2 = d.points[1];
                let x1 = p1.logical !== undefined ? timeScale.logicalToCoordinate(p1.logical as any) : timeScale.timeToCoordinate(p1.time as Time);
                let x2 = p2.logical !== undefined ? timeScale.logicalToCoordinate(p2.logical as any) : timeScale.timeToCoordinate(p2.time as Time);
                const y1 = series.priceToCoordinate(p1.price);
                const y2 = series.priceToCoordinate(p2.price);

                if (x1 === null || y1 === null || x2 === null || y2 === null) continue;

                ctx.beginPath();
                ctx.strokeStyle = d.color;
                ctx.lineWidth = isSel ? 3 : 2;
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();

                if (isSel) {
                    [{ x: x1, y: y1 }, { x: x2, y: y2 }].forEach(p => {
                        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
                        ctx.fillStyle = '#fff'; ctx.fill();
                        ctx.lineWidth = 2; ctx.strokeStyle = d.color; ctx.stroke();
                    });
                }
            } else if (d.type === 'rect' && d.points.length === 2) {
                const p1 = d.points[0], p2 = d.points[1];
                let x1 = p1.logical !== undefined ? timeScale.logicalToCoordinate(p1.logical as any) : timeScale.timeToCoordinate(p1.time as Time);
                let x2 = p2.logical !== undefined ? timeScale.logicalToCoordinate(p2.logical as any) : timeScale.timeToCoordinate(p2.time as Time);
                const y1 = series.priceToCoordinate(p1.price);
                const y2 = series.priceToCoordinate(p2.price);

                if (x1 === null || y1 === null || x2 === null || y2 === null) continue;

                const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
                const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);

                ctx.fillStyle = d.color + '22';
                ctx.fillRect(minX, minY, maxX - minX, maxY - minY);

                ctx.strokeStyle = d.color;
                ctx.lineWidth = isSel ? 2.5 : 1.5;
                ctx.setLineDash([]);
                ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);

                if (isSel) {
                    [{ x: x1, y: y1 }, { x: x2, y: y2 }].forEach(p => {
                        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
                        ctx.fillStyle = '#fff'; ctx.fill();
                        ctx.lineWidth = 2; ctx.strokeStyle = d.color; ctx.stroke();
                    });
                }
            }
        }

        // Render LIVE PREVIEW while drawing
        if (pendingPointRef.current && mousePosRef.current) {
            const tool = activeToolRef.current;
            const pt = pendingPointRef.current;
            const px1 = pt.logical !== undefined ? timeScale.logicalToCoordinate(pt.logical as any) : timeScale.timeToCoordinate(pt.time as Time);
            const py1 = series.priceToCoordinate(pt.price);
            const px2 = mousePosRef.current.x; // use true mouse coordinate for fluid preview
            const py2 = mousePosRef.current.y;

            if (px1 !== null && py1 !== null) {
                const color = drawingColorRef.current;

                if (tool === 'trendline') {
                    ctx.beginPath();
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 2;
                    ctx.setLineDash([5, 5]); // dashed for preview
                    ctx.moveTo(px1, py1);
                    ctx.lineTo(px2, py2);
                    ctx.stroke();
                    ctx.setLineDash([]); // reset
                } else if (tool === 'rect') {
                    const minX = Math.min(px1, px2), maxX = Math.max(px1, px2);
                    const minY = Math.min(py1, py2), maxY = Math.max(py1, py2);

                    ctx.fillStyle = color + '22';
                    ctx.fillRect(minX, minY, maxX - minX, maxY - minY);

                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([5, 5]);
                    ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
                    ctx.setLineDash([]); // reset
                }

                // pending point anchor
                ctx.beginPath(); ctx.arc(px1, py1, 5, 0, Math.PI * 2);
                ctx.fillStyle = color; ctx.fill();
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
            }
        }
    }, []);

    // Deselect / clear pending on Escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setSelectedDrawingId(null);
                pendingPointRef.current = null;
                redrawCanvas();
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDrawingIdRef.current) {
                const remFn = onDrawingRemoveRef.current;
                if (remFn) {
                    remFn(selectedDrawingIdRef.current);
                    setSelectedDrawingId(null);
                }
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [redrawCanvas]);

    // Initialize chart
    useEffect(() => {
        if (!containerRef.current) return;

        const chart = createChart(containerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: '#0a0e17' },
                textColor: '#d1d4dc',
            },
            grid: {
                vertLines: { color: '#1a1e2e' },
                horzLines: { color: '#1a1e2e' },
            },
            crosshair: {
                mode: 0,
                vertLine: { color: '#6366f1', width: 1, style: 2 },
                horzLine: { color: '#6366f1', width: 1, style: 2 },
            },
            rightPriceScale: {
                borderColor: '#2a2e3e',
                scaleMargins: { top: 0.1, bottom: 0.25 },
            },
            timeScale: {
                borderColor: '#2a2e3e',
                timeVisible: true,
                secondsVisible: false,
            },
            handleScroll: {
                pressedMouseMove: true,
            }
        });

        const candleSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#22c55e', downColor: '#ef4444',
            borderDownColor: '#ef4444', borderUpColor: '#22c55e',
            wickDownColor: '#ef4444', wickUpColor: '#22c55e',
        });

        const volumeSeries = chart.addSeries(HistogramSeries, {
            priceFormat: { type: 'volume' },
            priceScaleId: '',
        });
        volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

        chartRef.current = chart;
        candleSeriesRef.current = candleSeries;
        volumeSeriesRef.current = volumeSeries;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                chart.applyOptions({ width, height });
            }
            requestAnimationFrame(redrawCanvas);
        });
        resizeObserver.observe(containerRef.current);

        // Crosshair sync + OHLC info + Live Preview Pos
        chart.subscribeCrosshairMove((param) => {
            if (isSyncingRef.current) return;

            // Track mouse for live preview
            if (param.point && param.time) {
                const price = candleSeries.coordinateToPrice(param.point.y);
                if (price !== null) {
                    mousePosRef.current = {
                        x: param.point.x, y: param.point.y,
                        time: param.time as number, price: price
                    };
                }
            } else {
                mousePosRef.current = null;
            }

            const fn = onCrosshairTimeRef.current;
            if (fn) {
                fn(param.time ? (param.time as number) : null);
            }

            // Read OHLC data from the hovered candle
            if (param.time && param.seriesData) {
                const candleData = param.seriesData.get(candleSeries) as CandlestickData<Time> | undefined;
                if (candleData && 'open' in candleData) {
                    const change = candleData.close - candleData.open;
                    const changePercent = candleData.open !== 0 ? (change / candleData.open) * 100 : 0;
                    const volData = param.seriesData.get(volumeSeries) as HistogramData<Time> | undefined;
                    setOhlcInfo({
                        open: candleData.open, high: candleData.high,
                        low: candleData.low, close: candleData.close,
                        volume: volData && 'value' in volData ? volData.value : 0,
                        change, changePercent,
                        isUp: candleData.close >= candleData.open,
                    });
                }
            } else {
                setOhlcInfo(null);
            }

            requestAnimationFrame(redrawCanvas);
        });

        // Redraw canvas and emit logical range on scroll/zoom
        chart.timeScale().subscribeVisibleTimeRangeChange(() => {
            requestAnimationFrame(redrawCanvas);
        });

        chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
            const fn = onLogicalRangeChangeRef.current;
            if (fn) fn(range);
        });

        // Click handler for drawings AND selection
        chart.subscribeClick((param) => {
            if (!param.point || !candleSeriesRef.current) return;

            const tool = activeToolRef.current;

            // --- HIT DETECTION FOR SELECTION ---
            if (tool === 'cursor') {
                const px = param.point.x;
                const py = param.point.y;
                const timeScale = chart.timeScale();
                const sid = sessionIdRef.current;
                const allDrawings = drawingsRef.current.filter(d => d.sessionId === sid);

                let hitId: string | null = null;
                const HIT_TOLERANCE = 8; // pixels

                // Reverse so top-most is hit first
                for (let i = allDrawings.length - 1; i >= 0; i--) {
                    const d = allDrawings[i];

                    if (d.type === 'hline' && d.points.length > 0) {
                        const y = candleSeries.priceToCoordinate(d.points[0].price);
                        if (y !== null && Math.abs(py - y) <= HIT_TOLERANCE) { hitId = d.id; break; }
                    } else if (d.type === 'trendline' && d.points.length === 2) {
                        const p1 = d.points[0], p2 = d.points[1];
                        let x1 = p1.logical !== undefined ? timeScale.logicalToCoordinate(p1.logical as any) : timeScale.timeToCoordinate(p1.time as Time);
                        let x2 = p2.logical !== undefined ? timeScale.logicalToCoordinate(p2.logical as any) : timeScale.timeToCoordinate(p2.time as Time);
                        const y1 = candleSeries.priceToCoordinate(p1.price);
                        const y2 = candleSeries.priceToCoordinate(p2.price);
                        if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
                            if (distToSegment(px, py, x1, y1, x2, y2) <= HIT_TOLERANCE) { hitId = d.id; break; }
                        }
                    } else if (d.type === 'rect' && d.points.length === 2) {
                        const p1 = d.points[0], p2 = d.points[1];
                        let x1 = p1.logical !== undefined ? timeScale.logicalToCoordinate(p1.logical as any) : timeScale.timeToCoordinate(p1.time as Time);
                        let x2 = p2.logical !== undefined ? timeScale.logicalToCoordinate(p2.logical as any) : timeScale.timeToCoordinate(p2.time as Time);
                        const y1 = candleSeries.priceToCoordinate(p1.price);
                        const y2 = candleSeries.priceToCoordinate(p2.price);
                        if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
                            const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
                            const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
                            // hit if inside the rect or on border
                            if (px >= minX && px <= maxX && py >= minY && py <= maxY) { hitId = d.id; break; }
                        }
                    }
                }
                setSelectedDrawingId(hitId);
                requestAnimationFrame(redrawCanvas);
                return;
            }

            // --- DRAWING LOGIC ---
            const color = drawingColorRef.current;
            const addFn = onDrawingAddRef.current;
            const sid = sessionIdRef.current;

            if (tool !== 'hline' && tool !== 'trendline' && tool !== 'rect') return;
            if (!addFn) return;

            const price = candleSeries.coordinateToPrice(param.point.y);
            if (price === null) return;

            // allow drawing beyond data by mapping physical coordinate to logical index
            const logical = param.logical ?? chart.timeScale().coordinateToLogical(param.point.x);
            let time = param.time as number | undefined;

            if (!time && logical !== null) {
                const ct = chart.timeScale().coordinateToTime(param.point.x);
                if (ct !== null && typeof ct === 'number') {
                    time = ct;
                } else {
                    time = 0; // fallback if true time extrapolation fails
                }
            }

            if (logical === null) return; // Completely out of bounds

            if (tool === 'hline') {
                addFn({
                    type: 'hline',
                    points: [{ time: time || 0, logical: logical as number, price: price as number }],
                    color, sessionId: sid,
                });
                setSelectedDrawingId(null);
            } else if ((tool === 'trendline' || tool === 'rect') && logical !== null) {
                const clickPt: DrawingPoint = { time: time || 0, logical: logical as number, price: price as number };

                if (!pendingPointRef.current) {
                    // Stage 1: Place anchor point
                    pendingPointRef.current = clickPt;
                    setSelectedDrawingId(null);
                    requestAnimationFrame(redrawCanvas);
                } else {
                    // Stage 2: Finish drawing
                    addFn({
                        type: tool,
                        points: [pendingPointRef.current, clickPt],
                        color, sessionId: sid,
                    });
                    pendingPointRef.current = null;
                    requestAnimationFrame(redrawCanvas);
                }
            }
        });

        return () => {
            resizeObserver.disconnect();
            chart.remove();
            chartRef.current = null;
            candleSeriesRef.current = null;
            volumeSeriesRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Reset pending point on tool change
    useEffect(() => {
        pendingPointRef.current = null;
        redrawCanvas();
    }, [activeDrawingTool, redrawCanvas]);

    // Sync crosshair from other panes
    useEffect(() => {
        if (!chartRef.current || !candleSeriesRef.current) return;
        if (syncTimestamp === null || syncTimestamp === undefined) return;

        isSyncingRef.current = true;
        try {
            chartRef.current.setCrosshairPosition(
                0, // will show vertical line at time
                syncTimestamp as Time,
                candleSeriesRef.current
            );
        } catch { /* ignore if time not in range */ }
        isSyncingRef.current = false;
    }, [syncTimestamp]);

    // Update data with deduplication
    useEffect(() => {
        if (!candleSeriesRef.current || !volumeSeriesRef.current) return;
        if (candles.length === 0) return;

        const seen = new Map<number, OHLCCandle>();
        for (const c of candles) {
            if (!isFinite(c.time) || !isFinite(c.open) || !isFinite(c.high) ||
                !isFinite(c.low) || !isFinite(c.close) || c.time <= 0) continue;
            seen.set(c.time, c);
        }

        const deduped = Array.from(seen.values()).sort((a, b) => a.time - b.time);
        if (deduped.length === 0) return;

        const candleData: CandlestickData<Time>[] = deduped.map(c => ({
            time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close,
        }));
        const volumeData: HistogramData<Time>[] = deduped.map(c => ({
            time: c.time as Time, value: c.volume || 0,
            color: c.close >= c.open ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)',
        }));

        try {
            // Save current logical range and data length before mutating series
            const currentRange = chartRef.current?.timeScale().getVisibleLogicalRange();
            const prevDataLength = candleSeriesRef.current.data().length;

            candleSeriesRef.current.setData(candleData);
            volumeSeriesRef.current.setData(volumeData);

            // Restore logical range OR apply initial logical range OR autoFit on first render
            if (currentRange) {
                const addedBars = candleData.length - prevDataLength;
                // If user was viewing the very latest candles (within 2 candles of edge), auto-scroll to track new data
                if (addedBars > 0 && currentRange.to >= prevDataLength - 2) {
                    chartRef.current?.timeScale().setVisibleLogicalRange({
                        from: currentRange.from + addedBars,
                        to: currentRange.to + addedBars,
                    });
                } else {
                    // User was looking at history: keep viewport static
                    chartRef.current?.timeScale().setVisibleLogicalRange(currentRange);
                }
            } else if (isFirstRenderRef.current) {
                if (initialLogicalRange) {
                    chartRef.current?.timeScale().setVisibleLogicalRange(initialLogicalRange);
                } else if (autoFit) {
                    chartRef.current?.timeScale().fitContent();
                }
                isFirstRenderRef.current = false;
            }
        } catch (e) {
            console.error('Chart setData error:', e);
        }

        requestAnimationFrame(redrawCanvas);
    }, [candles, autoFit, initialLogicalRange, redrawCanvas]);

    // Render price lines for hlines + redraw canvas for trend/rect
    useEffect(() => {
        if (!candleSeriesRef.current) return;
        const series = candleSeriesRef.current;
        const selId = selectedDrawingId;

        priceLinesRef.current.forEach(pl => {
            try { series.removePriceLine(pl); } catch { /* ok */ }
        });
        priceLinesRef.current = [];

        const hlines = drawings.filter(d => d.type === 'hline' && d.sessionId === sessionId);
        hlines.forEach(d => {
            const isSel = d.id === selId;
            const pl = series.createPriceLine({
                price: d.points[0].price, color: d.color,
                lineWidth: isSel ? 3 : 2, lineStyle: 2, axisLabelVisible: true, title: '',
            });
            priceLinesRef.current.push(pl);
        });

        // Always redraw canvas for trend lines and rects
        requestAnimationFrame(redrawCanvas);
    }, [drawings, sessionId, selectedDrawingId, redrawCanvas]);

    const handleFitContent = useCallback(() => {
        chartRef.current?.timeScale().fitContent();
    }, []);

    const isDrawing = activeDrawingTool === 'hline' || activeDrawingTool === 'trendline' || activeDrawingTool === 'rect';

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%', outline: 'none' }} tabIndex={0}>
            {/* OHLC Info Overlay */}
            {ohlcInfo && (
                <div className="ohlc-overlay">
                    <span className="ohlc-label">O</span>
                    <span className={ohlcInfo.isUp ? 'ohlc-up' : 'ohlc-down'}>{ohlcInfo.open.toFixed(2)}</span>
                    <span className="ohlc-label">H</span>
                    <span className={ohlcInfo.isUp ? 'ohlc-up' : 'ohlc-down'}>{ohlcInfo.high.toFixed(2)}</span>
                    <span className="ohlc-label">L</span>
                    <span className={ohlcInfo.isUp ? 'ohlc-up' : 'ohlc-down'}>{ohlcInfo.low.toFixed(2)}</span>
                    <span className="ohlc-label">C</span>
                    <span className={ohlcInfo.isUp ? 'ohlc-up' : 'ohlc-down'}>{ohlcInfo.close.toFixed(2)}</span>
                    <span className={`ohlc-change ${ohlcInfo.isUp ? 'ohlc-up' : 'ohlc-down'}`}>
                        {ohlcInfo.change >= 0 ? '+' : ''}{ohlcInfo.change.toFixed(2)} ({ohlcInfo.changePercent >= 0 ? '+' : ''}{ohlcInfo.changePercent.toFixed(2)}%)
                    </span>
                    <span className="ohlc-sep">│</span>
                    <span className="ohlc-label">Vol</span>
                    <span className="ohlc-vol">{ohlcInfo.volume.toFixed(2)}</span>
                </div>
            )}
            <div
                ref={containerRef}
                style={{
                    width: '100%', height: '100%', minHeight: '150px',
                    cursor: isDrawing ? 'crosshair' : 'default',
                }}
            />
            <canvas
                ref={canvasRef}
                style={{
                    position: 'absolute', top: 0, left: 0,
                    width: '100%', height: '100%',
                    pointerEvents: 'none', zIndex: 5,
                }}
            />
            <button className="chart-fit-btn" onClick={handleFitContent} title="Fit to screen">⊞</button>
        </div>
    );
}
