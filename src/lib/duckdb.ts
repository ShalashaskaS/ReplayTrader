import * as duckdb from '@duckdb/duckdb-wasm';

let dbInstance: duckdb.AsyncDuckDB | null = null;
let dbConnection: duckdb.AsyncDuckDBConnection | null = null;
let initPromise: Promise<duckdb.AsyncDuckDB> | null = null;

/**
 * Initialize DuckDB-WASM as a lazy singleton.
 * WASM + worker files are served from /duckdb/ in public/.
 */
export async function getDuckDB(): Promise<duckdb.AsyncDuckDB> {
    if (dbInstance) return dbInstance;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
            mvp: {
                mainModule: '/duckdb/duckdb-mvp.wasm',
                mainWorker: '/duckdb/duckdb-browser-mvp.worker.js',
            },
            eh: {
                mainModule: '/duckdb/duckdb-eh.wasm',
                mainWorker: '/duckdb/duckdb-browser-eh.worker.js',
            },
        };

        const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);

        const worker = new Worker(bundle.mainWorker!);
        const logger = new duckdb.ConsoleLogger();
        const db = new duckdb.AsyncDuckDB(logger, worker);
        await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

        dbInstance = db;
        return db;
    })();

    return initPromise;
}

/**
 * Get a reusable connection to DuckDB.
 */
export async function getConnection(): Promise<duckdb.AsyncDuckDBConnection> {
    if (dbConnection) return dbConnection;
    const db = await getDuckDB();
    dbConnection = await db.connect();
    return dbConnection;
}

/**
 * Reset the database (useful when loading new data).
 */
export async function resetDB(): Promise<void> {
    if (dbConnection) {
        await dbConnection.close();
        dbConnection = null;
    }
    if (dbInstance) {
        await dbInstance.terminate();
        dbInstance = null;
        initPromise = null;
    }
}
