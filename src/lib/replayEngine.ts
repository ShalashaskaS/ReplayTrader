'use client';

import {
    createContext,
    useContext,
    useCallback,
    useRef,
    useEffect,
} from 'react';
import { useState } from 'react';

// ─── Types ─────────────────────────────────────────────────────────

export interface ReplayState {
    timestamps: number[];
    currentIndex: number;
    isPlaying: boolean;
    playSpeed: number; // ms per candle
}

export interface ReplayActions {
    initialize: (timestamps: number[]) => void;
    stepForward: (n?: number) => void;
    stepBackward: (n?: number) => void;
    play: () => void;
    pause: () => void;
    togglePlay: () => void;
    setIndex: (i: number) => void;
    setSpeed: (ms: number) => void;
    reset: () => void;
}

export interface ReplayEngine extends ReplayState, ReplayActions {
    currentTimestamp: number | null;
    progress: number; // 0–100
    totalCandles: number;
}

// ─── Context ───────────────────────────────────────────────────────

export const ReplayContext = createContext<ReplayEngine | null>(null);

export function useReplayContext(): ReplayEngine {
    const ctx = useContext(ReplayContext);
    if (!ctx)
        throw new Error('useReplayContext must be used within ReplayProvider');
    return ctx;
}

// ─── Hook ──────────────────────────────────────────────────────────

export function useReplayEngine(): ReplayEngine {
    const [timestamps, setTimestamps] = useState<number[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playSpeed, setPlaySpeed] = useState(300);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const totalCandles = timestamps.length;
    const currentTimestamp =
        totalCandles > 0 ? timestamps[currentIndex] : null;
    const progress = totalCandles > 0 ? (currentIndex / (totalCandles - 1)) * 100 : 0;

    const clearPlayInterval = useCallback(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    }, []);

    const initialize = useCallback((ts: number[]) => {
        setTimestamps(ts);
        setCurrentIndex(0);
        setIsPlaying(false);
    }, []);

    const stepForward = useCallback(
        (n = 1) => {
            setCurrentIndex((prev) => Math.min(prev + n, totalCandles - 1));
        },
        [totalCandles]
    );

    const stepBackward = useCallback((n = 1) => {
        setCurrentIndex((prev) => Math.max(prev - n, 0));
    }, []);

    const pause = useCallback(() => {
        setIsPlaying(false);
        clearPlayInterval();
    }, [clearPlayInterval]);

    const play = useCallback(() => {
        setIsPlaying(true);
    }, []);

    const togglePlay = useCallback(() => {
        setIsPlaying((prev) => !prev);
    }, []);

    const setIndex = useCallback(
        (i: number) => {
            setCurrentIndex(Math.max(0, Math.min(i, totalCandles - 1)));
        },
        [totalCandles]
    );

    const setSpeed = useCallback((ms: number) => {
        setPlaySpeed(ms);
    }, []);

    const reset = useCallback(() => {
        pause();
        setCurrentIndex(0);
    }, [pause]);

    // Auto-play interval
    useEffect(() => {
        clearPlayInterval();
        if (isPlaying && totalCandles > 0) {
            intervalRef.current = setInterval(() => {
                setCurrentIndex((prev) => {
                    if (prev >= totalCandles - 1) {
                        setIsPlaying(false);
                        return prev;
                    }
                    return prev + 1;
                });
            }, playSpeed);
        }
        return clearPlayInterval;
    }, [isPlaying, playSpeed, totalCandles, clearPlayInterval]);

    return {
        timestamps,
        currentIndex,
        isPlaying,
        playSpeed,
        currentTimestamp,
        progress,
        totalCandles,
        initialize,
        stepForward,
        stepBackward,
        play,
        pause,
        togglePlay,
        setIndex,
        setSpeed,
        reset,
    };
}
