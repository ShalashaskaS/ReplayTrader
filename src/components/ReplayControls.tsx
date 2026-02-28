'use client';

import { useEffect, useCallback } from 'react';
import { useReplayContext } from '@/lib/replayEngine';

export default function ReplayControls() {
    const {
        currentIndex,
        isPlaying,
        playSpeed,
        currentTimestamp,
        progress,
        totalCandles,
        stepForward,
        stepBackward,
        play,
        pause,
        togglePlay,
        setIndex,
        setSpeed,
        reset,
    } = useReplayContext();

    // Format timestamp for display
    const formatTimestamp = useCallback((ts: number | null) => {
        if (ts === null) return '--';
        const d = new Date(ts * 1000);
        return d.toISOString().replace('T', ' ').slice(0, 19);
    }, []);

    // Keyboard shortcuts
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            // Ignore if user is typing in an input
            if (
                e.target instanceof HTMLInputElement ||
                e.target instanceof HTMLTextAreaElement
            )
                return;

            switch (e.key) {
                case 'ArrowRight':
                    e.preventDefault();
                    if (e.shiftKey) stepForward(10);
                    else stepForward(1);
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    if (e.shiftKey) stepBackward(10);
                    else stepBackward(1);
                    break;
                case ' ':
                    e.preventDefault();
                    togglePlay();
                    break;
                case 'Home':
                    e.preventDefault();
                    reset();
                    break;
            }
        };

        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [stepForward, stepBackward, togglePlay, reset]);

    const speedOptions = [
        { label: '0.25x', value: 800 },
        { label: '0.5x', value: 500 },
        { label: '1x', value: 300 },
        { label: '2x', value: 150 },
        { label: '5x', value: 60 },
        { label: '10x', value: 30 },
    ];

    return (
        <div className="replay-controls" id="replay-controls">
            {/* Transport buttons */}
            <div className="controls-row">
                <div className="transport-buttons">
                    <button
                        className="ctrl-btn"
                        onClick={reset}
                        title="Reset (Home)"
                        id="btn-reset"
                    >
                        ⏮
                    </button>
                    <button
                        className="ctrl-btn"
                        onClick={() => stepBackward(10)}
                        title="Back 10 (Shift+←)"
                        id="btn-back10"
                    >
                        ◀◀
                    </button>
                    <button
                        className="ctrl-btn"
                        onClick={() => stepBackward(1)}
                        title="Back 1 (←)"
                        id="btn-back1"
                    >
                        ◀
                    </button>
                    <button
                        className={`ctrl-btn play-btn ${isPlaying ? 'playing' : ''}`}
                        onClick={isPlaying ? pause : play}
                        title="Play/Pause (Space)"
                        id="btn-play"
                    >
                        {isPlaying ? '⏸' : '▶'}
                    </button>
                    <button
                        className="ctrl-btn"
                        onClick={() => stepForward(1)}
                        title="Forward 1 (→)"
                        id="btn-fwd1"
                    >
                        ▶
                    </button>
                    <button
                        className="ctrl-btn"
                        onClick={() => stepForward(10)}
                        title="Forward 10 (Shift+→)"
                        id="btn-fwd10"
                    >
                        ▶▶
                    </button>
                </div>

                {/* Speed selector */}
                <div className="speed-selector">
                    <label>Speed:</label>
                    <select
                        value={playSpeed}
                        onChange={(e) => setSpeed(Number(e.target.value))}
                        id="speed-select"
                    >
                        {speedOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Info display */}
                <div className="replay-info">
                    <span className="info-timestamp">{formatTimestamp(currentTimestamp)}</span>
                    <span className="info-position">
                        {currentIndex + 1} / {totalCandles || 0}
                    </span>
                </div>
            </div>

            {/* Progress bar */}
            <div className="progress-bar-container">
                <input
                    type="range"
                    min={0}
                    max={Math.max(totalCandles - 1, 0)}
                    value={currentIndex}
                    onChange={(e) => setIndex(Number(e.target.value))}
                    className="progress-slider"
                    id="progress-slider"
                />
                <div
                    className="progress-fill"
                    style={{ width: `${progress}%` }}
                />
            </div>
        </div>
    );
}
