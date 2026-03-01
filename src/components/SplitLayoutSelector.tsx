'use client';

interface SplitLayoutSelectorProps {
    layout: string;
    onLayoutChange: (layout: string) => void;
}

const LAYOUTS = [
    { id: '1', icon: '☐', label: 'Single' },
    { id: '1x2', icon: '⬒', label: '2 Horizontal' },
    { id: '2x2', icon: '⊞', label: '2×2 Grid' },
];

export default function SplitLayoutSelector({ layout, onLayoutChange }: SplitLayoutSelectorProps) {
    return (
        <div className="split-layout-selector">
            {LAYOUTS.map((l) => (
                <button
                    key={l.id}
                    className={`split-layout-btn ${layout === l.id ? 'active' : ''}`}
                    onClick={() => onLayoutChange(l.id)}
                    title={l.label}
                >
                    {l.icon}
                </button>
            ))}
        </div>
    );
}
