'use client';

interface TimeframeSelectorProps {
    activeTimeframe: number;
    onSelect: (intervalSeconds: number) => void;
}

const TIMEFRAMES = [
    { label: '1m', seconds: 60 },
    { label: '5m', seconds: 300 },
    { label: '15m', seconds: 900 },
    { label: '1H', seconds: 3600 },
    { label: '4H', seconds: 14400 },
    { label: '1D', seconds: 86400 },
];

export default function TimeframeSelector({
    activeTimeframe,
    onSelect,
}: TimeframeSelectorProps) {
    return (
        <div className="timeframe-selector" id="timeframe-selector">
            {TIMEFRAMES.map((tf) => (
                <button
                    key={tf.seconds}
                    className={`tf-btn ${activeTimeframe === tf.seconds ? 'active' : ''}`}
                    onClick={() => onSelect(tf.seconds)}
                    id={`tf-${tf.label.toLowerCase()}`}
                >
                    {tf.label}
                </button>
            ))}
        </div>
    );
}
