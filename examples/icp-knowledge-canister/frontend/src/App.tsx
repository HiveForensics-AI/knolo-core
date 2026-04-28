import { useEffect, useState, type FormEvent } from 'react';

import { getClientConfig, getKnoloActor, type HitDto, type Opt, type PackInfo } from './canister';
import './app.css';

function readOpt<T>(value: Opt<T>): T | undefined {
  return value[0];
}

function formatCount(value: Opt<bigint>): string {
  const count = readOpt(value);
  return count === undefined ? '--' : count.toString();
}

function formatScore(score: number): string {
  return score.toFixed(3);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const clientConfig = getClientConfig();

export default function App() {
  const [packInfo, setPackInfo] = useState<PackInfo | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HitDto[]>([]);
  const [isPackLoading, setIsPackLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [lastQuery, setLastQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadPackInfo() {
      try {
        const actor = await getKnoloActor();
        const nextPackInfo = await actor.pack_info();
        if (!active) {
          return;
        }

        setPackInfo(nextPackInfo);
        setError(null);
      } catch (nextError) {
        if (!active) {
          return;
        }

        setError(formatError(nextError));
      } finally {
        if (active) {
          setIsPackLoading(false);
        }
      }
    }

    void loadPackInfo();

    return () => {
      active = false;
    };
  }, []);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    setIsSearching(true);
    setHasSearched(true);
    setLastQuery(trimmedQuery);
    setError(null);

    try {
      const actor = await getKnoloActor();
      const nextResults = await actor.search(trimmedQuery, 5);
      setResults(nextResults);
    } catch (nextError) {
      setResults([]);
      setError(formatError(nextError));
    } finally {
      setIsSearching(false);
    }
  }

  const packLoaded = packInfo?.loaded ?? false;
  const searchDisabled = isPackLoading || isSearching || !packLoaded || !query.trim();

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Direct browser client</p>
          <h1>Knolo ICP Search</h1>
          <p className="hero-copy">
            Query the `knolo_knowledge` canister straight from the browser with `@dfinity/agent`.
          </p>
        </div>
        <dl className="connection-card">
          <div>
            <dt>Replica</dt>
            <dd>{clientConfig.host}</dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>{clientConfig.network}</dd>
          </div>
          <div>
            <dt>Canister</dt>
            <dd>{clientConfig.canisterId ?? 'Not configured'}</dd>
          </div>
        </dl>
      </section>

      <section className="panel-grid">
        <article className="panel">
          <div className="panel-header">
            <h2>Pack status</h2>
            <span className={`badge ${packLoaded ? 'loaded' : 'idle'}`}>
              {isPackLoading ? 'Checking...' : packLoaded ? 'Loaded' : 'Idle'}
            </span>
          </div>

          {isPackLoading ? (
            <p className="muted">Checking pack status...</p>
          ) : packLoaded && packInfo ? (
            <dl className="stats-grid">
              <div>
                <dt>Label</dt>
                <dd>{readOpt(packInfo.label) ?? '--'}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>{readOpt(packInfo.version)?.toString() ?? '--'}</dd>
              </div>
              <div>
                <dt>Docs</dt>
                <dd>{formatCount(packInfo.docs)}</dd>
              </div>
              <div>
                <dt>Blocks</dt>
                <dd>{formatCount(packInfo.blocks)}</dd>
              </div>
              <div>
                <dt>Terms</dt>
                <dd>{formatCount(packInfo.terms)}</dd>
              </div>
            </dl>
          ) : (
            <p className="empty-state">No pack loaded</p>
          )}
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>Search</h2>
            <span className="badge neutral">Top 5 hits</span>
          </div>

          <form className="search-form" onSubmit={handleSearch}>
            <label className="search-label" htmlFor="search-input">
              Search query
            </label>
            <div className="search-row">
              <input
                id="search-input"
                className="search-input"
                type="search"
                value={query}
                placeholder="Try alpha beta"
                onChange={(event) => setQuery(event.target.value)}
              />
              <button className="search-button" type="submit" disabled={searchDisabled}>
                {isSearching ? 'Searching...' : 'Search'}
              </button>
            </div>
          </form>

          {!packLoaded && !isPackLoading ? (
            <p className="muted">
              Load a `.knolo` pack into the canister first, then the browser client can query it.
            </p>
          ) : null}

          {error ? <p className="error-box">{error}</p> : null}
        </article>
      </section>

      <section className="panel results-panel">
        <div className="panel-header">
          <h2>Results</h2>
          <span className="badge neutral">{results.length} items</span>
        </div>

        {results.length > 0 ? (
          <ol className="results-list">
            {results.map((result) => (
              <li className="result-card" key={`${result.block_id.toString()}-${result.score}`}>
                <div className="result-meta">
                  <span>Source: {readOpt(result.source) ?? 'Unknown'}</span>
                  <span>Namespace: {readOpt(result.namespace) ?? '--'}</span>
                  <span>Score: {formatScore(result.score)}</span>
                </div>
                <p className="result-text">{result.text}</p>
              </li>
            ))}
          </ol>
        ) : hasSearched ? (
          <p className="empty-state">No matches for "{lastQuery}".</p>
        ) : (
          <p className="muted">Run a search to inspect canister results here.</p>
        )}
      </section>
    </main>
  );
}
