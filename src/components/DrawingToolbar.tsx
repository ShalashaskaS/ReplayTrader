'use client';

import type { DrawingTool } from './Chart';

interface DrawingToolbarProps {
    activeTool: DrawingTool;
    onToolSelect: (tool: DrawingTool) => void;
    activeColor: string;
    onColorChange: (color: string) => void;
    onClearAll: () => void;
    vertical?: boolean;
}

const COLORS = ['#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#ffffff'];

const TOOLS: { id: DrawingTool; icon: string; label: string }[] = [
    { id: 'cursor', icon: '↖', label: 'Select (Esc)' },
    { id: 'hline', icon: '⎯', label: 'Horizontal Line' },
    { id: 'trendline', icon: '╱', label: 'Trend Line' },
    { id: 'rect', icon: '▭', label: 'Rectangle Zone' },
    { id: 'eraser', icon: '🗑', label: 'Clear All' },
];

export default function DrawingToolbar({
    activeTool,
    onToolSelect,
    activeColor,
    onColorChange,
    onClearAll,
    vertical = false,
}: DrawingToolbarProps) {
    return (
        <div className={`drawing-toolbar ${vertical ? 'vertical' : ''}`} id="drawing-toolbar">
            {TOOLS.map((tool) => (
                <button
                    key={tool.id}
                    className={`drawing-tool-btn ${activeTool === tool.id ? 'active' : ''}`}
                    onClick={() => {
                        if (tool.id === 'eraser') {
                            onClearAll();
                        } else {
                            onToolSelect(tool.id);
                        }
                    }}
                    title={tool.label}
                    id={`tool-${tool.id}`}
                >
                    {tool.icon}
                </button>
            ))}
            <div className={`drawing-color-picker ${vertical ? 'vertical' : ''}`}>
                {COLORS.map((c) => (
                    <button
                        key={c}
                        className={`color-swatch ${activeColor === c ? 'active' : ''}`}
                        style={{ backgroundColor: c }}
                        onClick={() => onColorChange(c)}
                        title={c}
                    />
                ))}
            </div>
        </div>
    );
}
