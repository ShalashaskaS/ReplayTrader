'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { OHLCCandle } from '@/lib/queries';

export interface Session {
    id: string;
    name: string;
    candles: OHLCCandle[];
}

const SESSIONS_KEY = 'replaytrader-sessions';

function generateId(): string {
    return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Persist session metadata (without candle data to avoid localStorage limits)
function loadSessionMeta(): { id: string; name: string }[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(SESSIONS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveSessionMeta(sessions: { id: string; name: string }[]): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    } catch {
        // storage full
    }
}

// Session candle data stored separately with IndexedDB-like key
function saveSessionCandles(id: string, candles: OHLCCandle[]): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(`rt-candles-${id}`, JSON.stringify(candles));
    } catch {
        // For very large datasets, this will fail — that's expected
        console.warn('Could not persist candle data (localStorage limit)');
    }
}

function loadSessionCandles(id: string): OHLCCandle[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(`rt-candles-${id}`);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function removeSessionCandles(id: string): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(`rt-candles-${id}`);
}

export function useDataSessions() {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const initializedRef = useRef(false);

    // Load persisted sessions on mount
    useEffect(() => {
        if (initializedRef.current) return;
        initializedRef.current = true;

        const meta = loadSessionMeta();
        if (meta.length > 0) {
            const loaded: Session[] = meta.map((m) => ({
                ...m,
                candles: loadSessionCandles(m.id),
            })).filter((s) => s.candles.length > 0);

            if (loaded.length > 0) {
                setSessions(loaded);
                setActiveSessionId(loaded[0].id);
            }
        }
    }, []);

    const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

    const addSession = useCallback((name: string, candles: OHLCCandle[]): string => {
        const id = generateId();
        const newSession: Session = { id, name, candles };

        setSessions((prev) => {
            const updated = [...prev, newSession];
            saveSessionMeta(updated.map((s) => ({ id: s.id, name: s.name })));
            return updated;
        });
        saveSessionCandles(id, candles);
        setActiveSessionId(id);
        return id;
    }, []);

    const removeSession = useCallback((id: string) => {
        setSessions((prev) => {
            const updated = prev.filter((s) => s.id !== id);
            saveSessionMeta(updated.map((s) => ({ id: s.id, name: s.name })));

            // If removing active session, switch to first remaining
            if (id === activeSessionId) {
                setActiveSessionId(updated.length > 0 ? updated[0].id : null);
            }
            return updated;
        });
        removeSessionCandles(id);
    }, [activeSessionId]);

    const switchSession = useCallback((id: string) => {
        setActiveSessionId(id);
    }, []);

    return {
        sessions,
        activeSession,
        activeSessionId,
        addSession,
        removeSession,
        switchSession,
    };
}
