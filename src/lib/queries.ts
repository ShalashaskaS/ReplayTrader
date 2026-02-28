import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';

export interface OHLCCandle {
    time: number; // unix timestamp in seconds
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

/**
 * Create the historical_data table for storing ingested OHLC data.
 */
export async function createHistoricalTable(
    conn: AsyncDuckDBConnection
): Promise<void> {
    await conn.query(`
    CREATE OR REPLACE TABLE historical_data (
      timestamp BIGINT NOT NULL,
      open      DOUBLE NOT NULL,
      high      DOUBLE NOT NULL,
      low       DOUBLE NOT NULL,
      close     DOUBLE NOT NULL,
      volume    DOUBLE DEFAULT 0
    )
  `);
}

/**
 * Insert an array of parsed candle rows into historical_data.
 * Uses a prepared statement for speed + batch insert.
 */
export async function insertCandles(
    conn: AsyncDuckDBConnection,
    candles: OHLCCandle[]
): Promise<void> {
    if (candles.length === 0) return;

    // Build a batch insert via VALUES for speed
    const BATCH_SIZE = 5000;
    for (let i = 0; i < candles.length; i += BATCH_SIZE) {
        const batch = candles.slice(i, i + BATCH_SIZE);
        const values = batch
            .map(
                (c) =>
                    `(${c.time}, ${c.open}, ${c.high}, ${c.low}, ${c.close}, ${c.volume})`
            )
            .join(',\n');
        await conn.query(`INSERT INTO historical_data VALUES ${values}`);
    }
}

/**
 * Query all candles with timestamp <= currentTimestamp.
 * Returns OHLC data sorted by time ASC — perfect for lightweight-charts.
 */
export async function queryCandles(
    conn: AsyncDuckDBConnection,
    currentTimestamp: number
): Promise<OHLCCandle[]> {
    const result = await conn.query(`
    SELECT
      timestamp AS time,
      open,
      high,
      low,
      close,
      volume
    FROM historical_data
    WHERE timestamp <= ${currentTimestamp}
    ORDER BY timestamp ASC
  `);
    return arrowToCandles(result);
}

/**
 * Aggregate M1 candles into higher timeframes on-the-fly.
 * intervalSeconds: e.g. 300 for 5m, 900 for 15m, 3600 for 1H, etc.
 */
export async function queryAggregatedCandles(
    conn: AsyncDuckDBConnection,
    currentTimestamp: number,
    intervalSeconds: number
): Promise<OHLCCandle[]> {
    const result = await conn.query(`
    SELECT
      CAST(FLOOR(CAST(timestamp AS DOUBLE) / ${intervalSeconds}) * ${intervalSeconds} AS BIGINT) AS time,
      FIRST(open ORDER BY timestamp ASC)  AS open,
      MAX(high)    AS high,
      MIN(low)     AS low,
      LAST(close ORDER BY timestamp ASC)  AS close,
      SUM(volume)  AS volume
    FROM historical_data
    WHERE timestamp <= ${currentTimestamp}
    GROUP BY time
    ORDER BY time ASC
  `);
    return arrowToCandles(result);
}

/**
 * Get all unique timestamps sorted ASC (used to build the replay timeline).
 */
export async function getAllTimestamps(
    conn: AsyncDuckDBConnection
): Promise<number[]> {
    const result = await conn.query(`
    SELECT DISTINCT timestamp
    FROM historical_data
    ORDER BY timestamp ASC
  `);

    const timestamps: number[] = [];
    const col = result.getChildAt(0);
    if (col) {
        for (let i = 0; i < col.length; i++) {
            timestamps.push(Number(col.get(i)));
        }
    }
    return timestamps;
}

/**
 * Get total row count in historical_data.
 */
export async function getRowCount(
    conn: AsyncDuckDBConnection
): Promise<number> {
    const result = await conn.query(
        `SELECT COUNT(*) AS cnt FROM historical_data`
    );
    const col = result.getChildAt(0);
    return col ? Number(col.get(0)) : 0;
}

// ─── Helpers ────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function arrowToCandles(table: any): OHLCCandle[] {
    const candles: OHLCCandle[] = [];
    const numRows = table.numRows;

    const timeCol = table.getChildAt(0);
    const openCol = table.getChildAt(1);
    const highCol = table.getChildAt(2);
    const lowCol = table.getChildAt(3);
    const closeCol = table.getChildAt(4);
    const volCol = table.getChildAt(5);

    for (let i = 0; i < numRows; i++) {
        candles.push({
            time: Number(timeCol.get(i)),
            open: Number(openCol.get(i)),
            high: Number(highCol.get(i)),
            low: Number(lowCol.get(i)),
            close: Number(closeCol.get(i)),
            volume: Number(volCol.get(i)),
        });
    }
    return candles;
}
