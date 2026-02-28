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

export interface Drawing {
    id: string;
    type: 'hline' | 'trendline';
    points: DrawingPoint[];
    color: string;
    sessionId: string;
}

interface ChartProps {
    candles: OHLCCandle[];
    autoFit?: boolean;
    activeDrawingTool?: 'cursor' | 'hline' | 'trendline' | 'eraser' | null;
    drawings?: Drawing[];
    drawingColor?: string;
    onDrawingAdd?: (drawing: Omit<Drawing, 'id'>) => void;
    onDrawingRemove?: (id: string) => void;
    sessionId?: string;
}

export default function Chart({
    candles,
    autoFit = true,
    activeDrawingTool = 'cursor',
    drawings = [],
    drawingColor = '#f59e0b',
    onDrawingAdd,
    onDrawingRemove,
    sessionId = 'default',
}: ChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    const priceLinesRef = useRef<IPriceLine[]>([]);
    const pendingPointRef = useRef<DrawingPoint | null>(null);

    // Use refs to avoid stale closures in the chart click handler
    const activeToolRef = useRef(activeDrawingTool);
    const drawingColorRef = useRef(drawingColor);
    const onDrawingAddRef = useRef(onDrawingAdd);
    const sessionIdRef = useRef(sessionId);

    // Keep refs in sync with props
    useEffect(() => { activeToolRef.current = activeDrawingTool; }, [activeDrawingTool]);
    useEffect(() => { drawingColorRef.current = drawingColor; }, [drawingColor]);
    useEffect(() => { onDrawingAddRef.current = onDrawingAdd; }, [onDrawingAdd]);
    useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

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
            }
        });
        resizeObserver.observe(containerRef.current);

        // Chart click handler — uses refs to avoid stale closure
        chart.subscribeClick((param) => {
            if (!param.time || !param.point || !candleSeriesRef.current) return;

            const tool = activeToolRef.current;
            const color = drawingColorRef.current;
            const addFn = onDrawingAddRef.current;
            const sid = sessionIdRef.current;

            if (tool !== 'hline' && tool !== 'trendline') return;
            if (!addFn) return;

            const price = candleSeries.coordinateToPrice(param.point.y);
            if (price === null) return;

            const clickPoint: DrawingPoint = {
                time: param.time as number,
                price: price as number,
            };

            if (tool === 'hline') {
                addFn({
                    type: 'hline',
                    points: [clickPoint],
                    color,
                    sessionId: sid,
                });
            } else if (tool === 'trendline') {
                if (!pendingPointRef.current) {
                    pendingPointRef.current = clickPoint;
                } else {
                    addFn({
                        type: 'trendline',
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
    }, []);

    // Reset pending point when tool changes
    useEffect(() => {
        pendingPointRef.current = null;
    }, [activeDrawingTool]);

    // Update data when candles change
    useEffect(() => {
        if (!candleSeriesRef.current || !volumeSeriesRef.current) return;
        if (candles.length === 0) return;

        const candleData: CandlestickData<Time>[] = candles.map((c) => ({
            time: c.time as Time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
        }));

        const volumeData: HistogramData<Time>[] = candles.map((c) => ({
            time: c.time as Time,
            value: c.volume,
            color: c.close >= c.open ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)',
        }));

        candleSeriesRef.current.setData(candleData);
        volumeSeriesRef.current.setData(volumeData);

        // Auto-fit after data update
        if (autoFit && chartRef.current) {
            chartRef.current.timeScale().fitContent();
        }
    }, [candles, autoFit]);

    // Render horizontal lines as price lines
    useEffect(() => {
        if (!candleSeriesRef.current) return;

        const series = candleSeriesRef.current;

        // Remove old price lines
        priceLinesRef.current.forEach((pl) => {
            try { series.removePriceLine(pl); } catch { /* already removed */ }
        });
        priceLinesRef.current = [];

        // Create new price lines for hline drawings in this session
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
    }, [drawings, sessionId]);

    const handleFitContent = useCallback(() => {
        if (chartRef.current) {
            chartRef.current.timeScale().fitContent();
        }
    }, []);

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <div
                ref={containerRef}
                id="chart-container"
                style={{
                    width: '100%',
                    height: '100%',
                    minHeight: '400px',
                    cursor: activeDrawingTool === 'hline' || activeDrawingTool === 'trendline'
                        ? 'crosshair'
                        : 'default',
                }}
            />
            <button
                className="chart-fit-btn"
                onClick={handleFitContent}
                title="Fit bars to screen"
                id="chart-fit-button"
            >
                ⊞
            </button>
        </div>
    );
}
