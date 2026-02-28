'use client';

import type { Drawing } from '@/components/Chart';

const STORAGE_KEY = 'replaytrader-drawings';

/**
 * Load all drawings from localStorage.
 */
export function loadDrawings(): Drawing[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

/**
 * Save all drawings to localStorage.
 */
function saveDrawings(drawings: Drawing[]): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(drawings));
    } catch {
        // storage full or unavailable
    }
}

/**
 * Add a drawing and persist.
 */
export function addDrawing(drawing: Drawing): Drawing[] {
    const all = loadDrawings();
    all.push(drawing);
    saveDrawings(all);
    return all;
}

/**
 * Remove a drawing by id and persist.
 */
export function removeDrawing(id: string): Drawing[] {
    const all = loadDrawings().filter((d) => d.id !== id);
    saveDrawings(all);
    return all;
}

/**
 * Get drawings for a specific session.
 */
export function getDrawingsForSession(sessionId: string): Drawing[] {
    return loadDrawings().filter((d) => d.sessionId === sessionId);
}

/**
 * Remove all drawings for a session.
 */
export function clearSessionDrawings(sessionId: string): Drawing[] {
    const all = loadDrawings().filter((d) => d.sessionId !== sessionId);
    saveDrawings(all);
    return all;
}

/**
 * Generate a unique drawing ID.
 */
export function generateDrawingId(): string {
    return `d_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
