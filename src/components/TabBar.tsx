'use client';

import type { Session } from '@/lib/useDataSessions';

interface TabBarProps {
    sessions: Session[];
    activeSessionId: string | null;
    onSelect: (id: string) => void;
    onClose: (id: string) => void;
    onNew: () => void;
}

export default function TabBar({
    sessions,
    activeSessionId,
    onSelect,
    onClose,
    onNew,
}: TabBarProps) {
    if (sessions.length === 0) return null;

    return (
        <div className="tab-bar" id="tab-bar">
            {sessions.map((s) => (
                <div
                    key={s.id}
                    className={`tab-item ${s.id === activeSessionId ? 'active' : ''}`}
                    onClick={() => onSelect(s.id)}
                    title={s.name}
                >
                    <span className="tab-name">{s.name}</span>
                    <button
                        className="tab-close"
                        onClick={(e) => {
                            e.stopPropagation();
                            onClose(s.id);
                        }}
                        title="Close tab"
                    >
                        ×
                    </button>
                </div>
            ))}
            <button className="tab-add" onClick={onNew} title="Load new CSV" id="tab-add-btn">
                +
            </button>
        </div>
    );
}
