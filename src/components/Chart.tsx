'use client';

import { useRef, useEffect, useCallback } from 'react';
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
    onDrawingRemove?: (id: string) => void;
    sessionId?: string;
    visibleRange?: { from: number; to: number } | null;
    onVisibleRangeChange?: (range: { from: number; to: number } | null) => void;
    syncTime?: number | null; // For crosshair sync across panes
    onCrosshairMove?: (time: number | null) => void;
    label?: string; // Timeframe label shown on pane
}

export default function Chart({
    candles,
    autoFit = true,
    activeDrawingTool = 'cursor',
    drawings = [],
    drawingColor = '#f59e0b',
    onDrawingAdd,
    sessionId = 'default',
    visibleRange = null,
    onVisibleRangeChange,
    syncTime = null,
    onCrosshairMove,
    label,
}: ChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    const priceLinesRef = useRef<IPriceLine[]>([]);
    const pendingPointRef = useRef<DrawingPoint | null>(null);

    // Refs to avoid stale closures
    const activeToolRef = useRef(activeDrawingTool);
    const drawingColorRef = useRef(drawingColor);
    const onDrawingAddRef = useRef(onDrawingAdd);
    const sessionIdRef = useRef(sessionId);
    const drawingsRef = useRef(drawings);
    const onCrosshairMoveRef = useRef(onCrosshairMove);

    useEffect(() => { activeToolRef.current = activeDrawingTool; }, [activeDrawingTool]);
    useEffect(() => { drawingColorRef.current = drawingColor; }, [drawingColor]);
    useEffect(() => { onDrawingAddRef.current = onDrawingAdd; }, [onDrawingAdd]);
    useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
    useEffect(() => { drawingsRef.current = drawings; }, [drawings]);
    useEffect(() => { onCrosshairMoveRef.current = onCrosshairMove; }, [onCrosshairMove]);

    // Draw trend lines and rectangles on canvas overlay
    const redrawCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        const chart = chartRef.current;
        const series = candleSeriesRef.current;
        if (!canvas || !chart || !series) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Match canvas size to container
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        ctx.clearRect(0, 0, rect.width, rect.height);

        const sid = sessionIdRef.current;
        const currentDrawings = drawingsRef.current.filter(d => d.sessionId === sid);

        const timeScale = chart.timeScale();

        for (const d of currentDrawings) {
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
            } else if (d.type === 'rect' && d.points.length === 2) {
                const x1 = timeScale.timeToCoordinate(d.points[0].time as Time);
                const y1 = series.priceToCoordinate(d.points[0].price);
                const x2 = timeScale.timeToCoordinate(d.points[1].time as Time);
                const y2 = series.priceToCoordinate(d.points[1].price);

                if (x1 === null || y1 === null || x2 === null || y2 === null) continue;

                // Semi-transparent fill
                const hex = d.color;
                ctx.fillStyle = hex + '22';
                ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));

                // Border
                ctx.strokeStyle = d.color;
                ctx.lineWidth = 1.5;
                ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
            }
        }

        // Draw pending point indicator
        if (pendingPointRef.current) {
            const tool = activeToolRef.current;
            if (tool === 'trendline' || tool === 'rect') {
                const px = timeScale.timeToCoordinate(pendingPointRef.current.time as Time);
                const py = series.priceToCoordinate(pendingPointRef.current.price);
                if (px !== null && py !== null) {
                    ctx.beginPath();
                    ctx.arc(px, py, 4, 0, Math.PI * 2);
                    ctx.fillStyle = drawingColorRef.current;
                    ctx.fill();
                }
            }
        }
    }, []);

    // Initialize chart once
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
            upColor: '#22c55e',
            downColor: '#ef4444',
            borderDownColor: '#ef4444',
            borderUpColor: '#22c55e',
            wickDownColor: '#ef4444',
            wickUpColor: '#22c55e',
        });

        const volumeSeries = chart.addSeries(HistogramSeries, {
            priceFormat: { type: 'volume' },
            priceScaleId: '',
        });

        volumeSeries.priceScale().applyOptions({
            scaleMargins: { top: 0.8, bottom: 0 },
        });

        chartRef.current = chart;
        candleSeriesRef.current = candleSeries;
        volumeSeriesRef.current = volumeSeries;

        // Handle resize
        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                chart.applyOptions({ width, height });
                redrawCanvas();
            }
        });
        resizeObserver.observe(containerRef.current);

        // Crosshair sync — emit time on move
        chart.subscribeCrosshairMove((param) => {
            const fn = onCrosshairMoveRef.current;
            if (fn) {
                fn(param.time ? (param.time as number) : null);
            }
            redrawCanvas();
        });

        // Redraw on visible range change (scroll, zoom)
        chart.timeScale().subscribeVisibleTimeRangeChange(() => {
            redrawCanvas();
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
                const coordTime = chart.timeScale().coordinateToTime(param.point.x);
                if (coordTime !== null) time = coordTime as number;
            }

            if (tool === 'hline') {
                addFn({
                    type: 'hline',
                    points: [{ time: time || 0, price: price as number }],
                    color,
                    sessionId: sid,
                });
            } else if ((tool === 'trendline' || tool === 'rect') && time) {
                const clickPoint: DrawingPoint = { time, price: price as number };
                if (!pendingPointRef.current) {
                    pendingPointRef.current = clickPoint;
                    redrawCanvas();
                } else {
                    addFn({
                        type: tool,
                        points: [pendingPointRef.current, clickPoint],
                        color,
                        sessionId: sid,
                    });
                    pendingPointRef.current = null;
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

    // Reset pending point when tool changes
    useEffect(() => {
        pendingPointRef.current = null;
        redrawCanvas();
    }, [activeDrawingTool, redrawCanvas]);

    // Update data when candles change — with deduplication and validation
    useEffect(() => {
        if (!candleSeriesRef.current || !volumeSeriesRef.current) return;
        if (candles.length === 0) return;

        // Deduplicate by time (keep last occurrence) and validate
        const seen = new Map<number, OHLCCandle>();
        for (const c of candles) {
            if (!isFinite(c.time) || !isFinite(c.open) || !isFinite(c.high) ||
                !isFinite(c.low) || !isFinite(c.close) || c.time <= 0) {
                continue;
            }
            seen.set(c.time, c);
        }

        const deduped = Array.from(seen.values()).sort((a, b) => a.time - b.time);
        if (deduped.length === 0) return;

        const candleData: CandlestickData<Time>[] = deduped.map((c) => ({
            time: c.time as Time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
        }));

        const volumeData: HistogramData<Time>[] = deduped.map((c) => ({
            time: c.time as Time,
            value: c.volume || 0,
            color: c.close >= c.open ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)',
        }));

        try {
            candleSeriesRef.current.setData(candleData);
            volumeSeriesRef.current.setData(volumeData);
        } catch (e) {
            console.error('Chart setData error:', e);
        }

        if (visibleRange && chartRef.current) {
            try {
                chartRef.current.timeScale().setVisibleRange({
                    from: visibleRange.from as Time,
                    to: visibleRange.to as Time,
                });
            } catch {
                chartRef.current.timeScale().fitContent();
            }
        } else if (autoFit && chartRef.current) {
            chartRef.current.timeScale().fitContent();
        }

        // Redraw canvas overlays after data update
        setTimeout(redrawCanvas, 50);
    }, [candles, autoFit, visibleRange, redrawCanvas]);

    // Render hlines as price lines
    useEffect(() => {
        if (!candleSeriesRef.current) return;
        const series = candleSeriesRef.current;

        priceLinesRef.current.forEach((pl) => {
            try { series.removePriceLine(pl); } catch { /* ok */ }
        });
        priceLinesRef.current = [];

        const hlines = drawings.filter((d) => d.type === 'hline' && d.sessionId === sessionId);
        hlines.forEach((d) => {
            const pl = series.createPriceLine({
                price: d.points[0].price,
                color: d.color,
                lineWidth: 2,
                lineStyle: 2,
                axisLabelVisible: true,
                title: '',
            });
            priceLinesRef.current.push(pl);
        });

        // Redraw canvas for trend lines and rects
        setTimeout(redrawCanvas, 50);
    }, [drawings, sessionId, redrawCanvas]);

    // Sync crosshair from another pane
    useEffect(() => {
        if (!chartRef.current || !candleSeriesRef.current || syncTime === null || syncTime === undefined) return;
        // We don't call setCrosshairPosition because it's tricky
        // Instead rely on the shared time-axis approach
    }, [syncTime]);

    const handleFitContent = useCallback(() => {
        if (chartRef.current) {
            chartRef.current.timeScale().fitContent();
        }
    }, []);

    const toolsWithCrosshair = ['hline', 'trendline', 'rect'];

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            {label && (
                <div className="chart-pane-label">{label}</div>
            )}
            <div
                ref={containerRef}
                id="chart-container"
                style={{
                    width: '100%',
                    height: '100%',
                    minHeight: '200px',
                    cursor: toolsWithCrosshair.includes(activeDrawingTool || '')
                        ? 'crosshair'
                        : 'default',
                }}
            />
            <canvas
                ref={canvasRef}
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                    zIndex: 5,
                }}
            />
            <button
                className="chart-fit-btn"
                onClick={handleFitContent}
                title="Fit bars to screen"
            >
                ⊞
            </button>
        </div>
    );
}
