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
    type IPriceLine,
} from 'lightweight-charts';
import type { OHLCCandle } from '@/lib/queries';

export interface DrawingPoint {
    time: number;
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
    sessionId?: string;
    syncTimestamp?: number | null;
    onCrosshairTime?: (time: number | null) => void;
    paneId?: string;
}

export default function Chart({
    candles,
    autoFit = true,
    activeDrawingTool = 'cursor',
    drawings = [],
    drawingColor = '#f59e0b',
    onDrawingAdd,
    sessionId = 'default',
    syncTimestamp,
    onCrosshairTime,
    paneId,
}: ChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    const priceLinesRef = useRef<IPriceLine[]>([]);
    const pendingPointRef = useRef<DrawingPoint | null>(null);
    const isSyncingRef = useRef(false);

    // OHLC info overlay state
    const [ohlcInfo, setOhlcInfo] = useState<{
        open: number; high: number; low: number; close: number;
        volume: number; change: number; changePercent: number; isUp: boolean;
    } | null>(null);

    // Refs to avoid stale closures
    const activeToolRef = useRef(activeDrawingTool);
    const drawingColorRef = useRef(drawingColor);
    const onDrawingAddRef = useRef(onDrawingAdd);
    const sessionIdRef = useRef(sessionId);
    const drawingsRef = useRef(drawings);
    const onCrosshairTimeRef = useRef(onCrosshairTime);
    const paneIdRef = useRef(paneId);

    useEffect(() => { activeToolRef.current = activeDrawingTool; }, [activeDrawingTool]);
    useEffect(() => { drawingColorRef.current = drawingColor; }, [drawingColor]);
    useEffect(() => { onDrawingAddRef.current = onDrawingAdd; }, [onDrawingAdd]);
    useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
    useEffect(() => { drawingsRef.current = drawings; }, [drawings]);
    useEffect(() => { onCrosshairTimeRef.current = onCrosshairTime; }, [onCrosshairTime]);
    useEffect(() => { paneIdRef.current = paneId; }, [paneId]);

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

        for (const d of allDrawings) {
            if (d.type === 'trendline' && d.points.length === 2) {
                const x1 = timeScale.timeToCoordinate(d.points[0].time as Time);
                const y1 = series.priceToCoordinate(d.points[0].price);
                const x2 = timeScale.timeToCoordinate(d.points[1].time as Time);
                const y2 = series.priceToCoordinate(d.points[1].price);
                if (x1 === null || y1 === null || x2 === null || y2 === null) continue;

                ctx.beginPath();
                ctx.strokeStyle = d.color;
                ctx.lineWidth = 2;
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();

                // Small circles at endpoints
                [{ x: x1, y: y1 }, { x: x2, y: y2 }].forEach(p => {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
                    ctx.fillStyle = d.color;
                    ctx.fill();
                });
            } else if (d.type === 'rect' && d.points.length === 2) {
                const x1 = timeScale.timeToCoordinate(d.points[0].time as Time);
                const y1 = series.priceToCoordinate(d.points[0].price);
                const x2 = timeScale.timeToCoordinate(d.points[1].time as Time);
                const y2 = series.priceToCoordinate(d.points[1].price);
                if (x1 === null || y1 === null || x2 === null || y2 === null) continue;

                ctx.fillStyle = d.color + '22';
                ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
                ctx.strokeStyle = d.color;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([]);
                ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
            }
        }

        // Pending point indicator
        if (pendingPointRef.current) {
            const tool = activeToolRef.current;
            if (tool === 'trendline' || tool === 'rect') {
                const px = timeScale.timeToCoordinate(pendingPointRef.current.time as Time);
                const py = series.priceToCoordinate(pendingPointRef.current.price);
                if (px !== null && py !== null) {
                    ctx.beginPath();
                    ctx.arc(px, py, 5, 0, Math.PI * 2);
                    ctx.fillStyle = drawingColorRef.current;
                    ctx.fill();
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
        }
    }, []);

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

        // Crosshair sync + OHLC info
        chart.subscribeCrosshairMove((param) => {
            if (isSyncingRef.current) return;
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

        // Redraw canvas on scroll/zoom
        chart.timeScale().subscribeVisibleTimeRangeChange(() => {
            requestAnimationFrame(redrawCanvas);
        });

        // Click handler for drawings
        chart.subscribeClick((param) => {
            if (!param.point || !candleSeriesRef.current) return;

            const tool = activeToolRef.current;
            const color = drawingColorRef.current;
            const addFn = onDrawingAddRef.current;
            const sid = sessionIdRef.current;

            if (tool !== 'hline' && tool !== 'trendline' && tool !== 'rect') return;
            if (!addFn) return;

            const price = candleSeries.coordinateToPrice(param.point.y);
            if (price === null) return;

            let time = param.time as number | undefined;
            if (!time) {
                const ct = chart.timeScale().coordinateToTime(param.point.x);
                if (ct !== null) time = ct as number;
            }

            if (tool === 'hline') {
                addFn({
                    type: 'hline',
                    points: [{ time: time || 0, price: price as number }],
                    color, sessionId: sid,
                });
                // Don't switch to cursor — keep tool active
            } else if ((tool === 'trendline' || tool === 'rect') && time) {
                const pt: DrawingPoint = { time, price: price as number };
                if (!pendingPointRef.current) {
                    pendingPointRef.current = pt;
                    requestAnimationFrame(redrawCanvas);
                } else {
                    addFn({
                        type: tool,
                        points: [pendingPointRef.current, pt],
                        color, sessionId: sid,
                    });
                    pendingPointRef.current = null;
                    // Keep tool active for next drawing
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
            candleSeriesRef.current.setData(candleData);
            volumeSeriesRef.current.setData(volumeData);
        } catch (e) {
            console.error('Chart setData error:', e);
        }

        if (autoFit && chartRef.current) {
            chartRef.current.timeScale().fitContent();
        }
        requestAnimationFrame(redrawCanvas);
    }, [candles, autoFit, redrawCanvas]);

    // Render price lines for hlines + redraw canvas for trend/rect
    useEffect(() => {
        if (!candleSeriesRef.current) return;
        const series = candleSeriesRef.current;

        priceLinesRef.current.forEach(pl => {
            try { series.removePriceLine(pl); } catch { /* ok */ }
        });
        priceLinesRef.current = [];

        const hlines = drawings.filter(d => d.type === 'hline' && d.sessionId === sessionId);
        hlines.forEach(d => {
            const pl = series.createPriceLine({
                price: d.points[0].price, color: d.color,
                lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: '',
            });
            priceLinesRef.current.push(pl);
        });

        // Always redraw canvas for trend lines and rects
        requestAnimationFrame(redrawCanvas);
    }, [drawings, sessionId, redrawCanvas]);

    const handleFitContent = useCallback(() => {
        chartRef.current?.timeScale().fitContent();
    }, []);

    const isDrawing = activeDrawingTool === 'hline' || activeDrawingTool === 'trendline' || activeDrawingTool === 'rect';

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
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
