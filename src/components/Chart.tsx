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
    const pendingPointRef = useRef<DrawingPoint | null>(null);
    const [showFitButton, setShowFitButton] = useState(true);

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

        // Chart click handler for drawings
        chart.subscribeClick((param) => {
            if (!param.time || !param.point || !candleSeriesRef.current) return;

            const price = candleSeries.coordinateToPrice(param.point.y);
            if (price === null) return;

            const clickPoint: DrawingPoint = {
                time: param.time as number,
                price: price as number,
            };

            if (activeDrawingTool === 'hline' && onDrawingAdd) {
                onDrawingAdd({
                    type: 'hline',
                    points: [clickPoint],
                    color: drawingColor,
                    sessionId,
                });
            } else if (activeDrawingTool === 'trendline' && onDrawingAdd) {
                if (!pendingPointRef.current) {
                    pendingPointRef.current = clickPoint;
                } else {
                    onDrawingAdd({
                        type: 'trendline',
                        points: [pendingPointRef.current, clickPoint],
                        color: drawingColor,
                        sessionId,
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
    }, [activeDrawingTool]);

    // Update data when candles change
    const updateChart = useCallback(() => {
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

    useEffect(() => {
        updateChart();
    }, [updateChart]);

    // Render horizontal lines as price lines
    useEffect(() => {
        if (!candleSeriesRef.current) return;

        // Remove all existing price lines
        const series = candleSeriesRef.current;
        // We need to track and recreate them
        const currentDrawings = drawings.filter((d) => d.sessionId === sessionId);

        // Clear all price lines by removing and re-adding
        // lightweight-charts doesn't have removeAllPriceLines, so we track them
        const hlines = currentDrawings.filter((d) => d.type === 'hline');

        // Create price lines for horizontal drawings
        hlines.forEach((d) => {
            series.createPriceLine({
                price: d.points[0].price,
                color: d.color,
                lineWidth: 2,
                lineStyle: 2, // dashed
                axisLabelVisible: true,
                title: '',
            });
        });

        // For trend lines we need markers (simplified approach)
        // Full trend line primitives would require the plugin API

        return () => {
            // Remove price lines on cleanup
            // Note: we recreate on every drawings change
        };
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
            {showFitButton && (
                <button
                    className="chart-fit-btn"
                    onClick={handleFitContent}
                    title="Fit bars to screen"
                    id="chart-fit-button"
                >
                    ⊞
                </button>
            )}
        </div>
    );
}
