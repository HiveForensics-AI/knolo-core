'use client';

import { useState } from 'react';

export default function Home() {
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function sendMessage(event) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || loading) return;

    setError('');
    setLoading(true);
    const nextMessages = [...messages, { role: 'user', content: trimmed }];
    setMessages(nextMessages);
    setMessage('');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error || 'Request failed');
        return;
      }

      setMessages([
        ...nextMessages,
        {
          role: 'assistant',
          content: payload.answer,
          hits: payload.hits,
        },
      ]);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container">
      <h1>KnoLo Starter Chat</h1>
      <p>Ask a question about the local files in <code>/docs</code>.</p>

      <div className="messages">
        {messages.map((item, idx) => (
          <article key={idx} className={`message ${item.role}`}>
            <strong>{item.role === 'user' ? 'You' : 'Assistant'}</strong>
            <p>{item.content}</p>

            {item.role === 'assistant' && item.hits?.length > 0 && (
              <section className="sources">
                <h3>Sources</h3>
                <ul>
                  {item.hits.map((hit, hitIndex) => (
                    <li key={`${idx}-${hitIndex}`}>
                      <details>
                        <summary>
                          {hit.title} {hit.path ? `(${hit.path})` : ''} — score {hit.score.toFixed(3)}
                        </summary>
                        <p>{hit.snippet}</p>
                      </details>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </article>
        ))}
      </div>

      {error && <p className="error">{error}</p>}

      <form onSubmit={sendMessage} className="composer">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What do these docs cover?"
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Thinking...' : 'Send'}
        </button>
      </form>
    </main>
  );
}
