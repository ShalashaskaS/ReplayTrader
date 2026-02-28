'use client';

interface DrawingToolbarProps {
    activeTool: 'cursor' | 'hline' | 'trendline' | 'eraser';
    onToolSelect: (tool: 'cursor' | 'hline' | 'trendline' | 'eraser') => void;
    activeColor: string;
    onColorChange: (color: string) => void;
    onClearAll: () => void;
}

const COLORS = ['#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#a855f7', '#ffffff'];

const TOOLS = [
    { id: 'cursor' as const, icon: '↖', label: 'Select' },
    { id: 'hline' as const, icon: '⎯', label: 'Horizontal Line' },
    { id: 'trendline' as const, icon: '╱', label: 'Trend Line' },
    { id: 'eraser' as const, icon: '🗑', label: 'Clear All Drawings' },
];

export default function DrawingToolbar({
    activeTool,
    onToolSelect,
    activeColor,
    onColorChange,
    onClearAll,
}: DrawingToolbarProps) {
    return (
        <div className="drawing-toolbar" id="drawing-toolbar">
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
            <div className="drawing-color-picker">
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
