import { useEffect, useState, type FormEvent } from 'react';

import {
  fetchFixtureBytes,
  queryAndResolve,
  verifyAndMount,
  type DemoHit,
  type MountedImage,
  type Verification,
} from './knowledgeImage';
import './App.css';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function App() {
  const [image, setImage] = useState<MountedImage | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DemoHit[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isLoadingFixture, setIsLoadingFixture] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadFixture() {
      try {
        const bytes = await fetchFixtureBytes();
        const mounted = verifyAndMount(bytes);

        if (active) {
          setImage(mounted.image);
          setVerification(mounted.verification);
        }
      } catch (loadError) {
        if (active) {
          setError(errorMessage(loadError));
        }
      } finally {
        if (active) {
          setIsLoadingFixture(false);
        }
      }
    }

    void loadFixture();

    return () => {
      active = false;
    };
  }, []);

  async function handleUpload() {
    if (!selectedFile) return;

    setIsVerifying(true);
    setError(null);

    try {
      const bytes = new Uint8Array(await selectedFile.arrayBuffer());
      const mounted = verifyAndMount(bytes);

      setImage(mounted.image);
      setVerification(mounted.verification);
      setResults([]);
      setHasSearched(false);
    } catch (uploadError) {
      setError(errorMessage(uploadError));
    } finally {
      setIsVerifying(false);
    }
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!image || !query.trim()) return;

    setIsSearching(true);
    setError(null);
    setResults([]);
    setHasSearched(false);

    try {
      setResults(queryAndResolve(image, query));
      setHasSearched(true);
    } catch (searchError) {
      setError(errorMessage(searchError));
    } finally {
      setIsSearching(false);
    }
  }

  const busy = isLoadingFixture || isVerifying;

  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">Local V5 demo</p>
        <h1>Knowledge Image Explorer</h1>
        <p>
          Verify a Knowledge Image, search its chunks, and inspect source
          snippets. Verification checks image integrity; it does not prove that
          the content is true.
        </p>
      </header>

      <section className="panel" aria-labelledby="image-heading">
        <div className="panel-heading">
          <h2 id="image-heading">Image</h2>
          <span className={`badge ${image ? 'good' : 'idle'}`}>
            {isLoadingFixture
              ? 'Loading fixture'
              : image
                ? 'Mounted'
                : 'No image'}
          </span>
        </div>

        {image && verification ? (
          <dl className="details">
            <div>
              <dt>Integrity</dt>
              <dd>Verified</dd>
            </div>
            <div>
              <dt>State root</dt>
              <dd className="digest">{verification.stateRoot}</dd>
            </div>
            <div>
              <dt>Objects</dt>
              <dd>{image.objects.length}</dd>
            </div>
          </dl>
        ) : (
          <p className="muted">
            {isLoadingFixture
              ? 'Loading and verifying the bundled fixture...'
              : 'Upload a valid V5 image to begin.'}
          </p>
        )}

        <div className="upload-row">
          <label htmlFor="image-upload">Upload a V5 image</label>
          <input
            id="image-upload"
            type="file"
            onChange={(event) => {
              setSelectedFile(event.currentTarget.files?.[0] ?? null);
              setError(null);
            }}
          />
          <button
            type="button"
            onClick={() => void handleUpload()}
            disabled={!selectedFile || busy}
          >
            {isVerifying ? 'Verifying...' : 'Verify and mount'}
          </button>
        </div>
      </section>

      <section className="panel" aria-labelledby="search-heading">
        <div className="panel-heading">
          <h2 id="search-heading">Search chunks</h2>
          <span className="badge">{results.length} results</span>
        </div>

        <form className="search-form" onSubmit={handleSearch}>
          <label htmlFor="query">Search terms</label>
          <div className="search-row">
            <input
              id="query"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Try: arming"
            />
            <button
              type="submit"
              disabled={!image || !query.trim() || isSearching}
            >
              {isSearching ? 'Searching...' : 'Search'}
            </button>
          </div>
        </form>

        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {isSearching ? <p role="status">Searching the mounted image...</p> : null}

        {results.length > 0 ? (
          <ol className="results">
            {results.map((result) => (
              <li className="result" key={result.objectId}>
                <div className="result-source">
                  <strong>{result.sourceTitle}</strong>
                  <span>{result.sourcePath}</span>
                </div>
                <p>{result.snippet}</p>
              </li>
            ))}
          </ol>
        ) : hasSearched && !isSearching ? (
          <p className="empty">No matching chunks found.</p>
        ) : !isSearching ? (
          <p className="muted">Search results will appear here.</p>
        ) : null}
      </section>
    </main>
  );
}

export default App;
