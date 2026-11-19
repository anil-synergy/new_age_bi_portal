import { useCallback, useRef, useState } from 'react';
import WaveIcon from './components/WaveIcon';

const THEMES = ['auto', 'light', 'dark'];

export default function App() {
  const [mode, setMode] = useState('auto'); // page theme: auto | light | dark
  const [size, setSize] = useState(360);
  const [loop, setLoop] = useState(4000);
  const [dissolve, setDissolve] = useState(2400);
  const [log, setLog] = useState([]);
  const iconRef = useRef(null);

  const note = useCallback(
    (msg) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${msg}`, ...l].slice(0, 6)),
    [],
  );

  const applyMode = (m) => {
    setMode(m);
    if (m === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', m);
  };

  return (
    <main className="demo">
      <header>
        <h1>WaveIcon</h1>
        <p>Click any single line to dissolve it right-to-left; click it again to restore.</p>
      </header>

      <section className="stage checker">
        <WaveIcon
          ref={iconRef}
          size={size}
          loopDuration={loop}
          dissolveDuration={dissolve}
          label="Three flowing luminous wave lines"
          onDissolveStart={(i) => note(`line ${i + 1}: dissolve start`)}
          onDissolveEnd={(i) => note(`line ${i + 1}: dissolve end`)}
          onRestoreStart={(i) => note(`line ${i + 1}: restore start`)}
          onRestoreEnd={(i) => note(`line ${i + 1}: restore end`)}
        />
      </section>

      <section className="controls">
        <div className="row" role="group" aria-label="Page theme">
          {THEMES.map((t) => (
            <button key={t} className={mode === t ? 'on' : ''} onClick={() => applyMode(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="row">
          <button onClick={() => iconRef.current?.dissolve()}>Dissolve all</button>
          <button onClick={() => iconRef.current?.restore()}>Restore all</button>
          <button onClick={() => iconRef.current?.replay()}>Replay all</button>
        </div>
        <label>
          Size {size}px
          <input type="range" min="120" max="520" value={size} onChange={(e) => setSize(+e.target.value)} />
        </label>
        <label>
          Loop {loop}ms
          <input type="range" min="1000" max="10000" step="500" value={loop} onChange={(e) => setLoop(+e.target.value)} />
        </label>
        <label>
          Dissolve {dissolve}ms
          <input type="range" min="600" max="6000" step="200" value={dissolve} onChange={(e) => setDissolve(+e.target.value)} />
        </label>
        <ol className="log" aria-live="polite">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      </section>

      <section className="multi">
        <h2>Multiple instances (unique SVG ids)</h2>
        <div className="checker multi-row">
          <WaveIcon size={140} theme="light" label="Light waves" />
          <WaveIcon size={140} theme="dark" label="Dark waves" defaultDissolved={[false, true, false]} />
          <WaveIcon size={140} loopDuration={6000} dissolveDuration={1600} label="Slow waves" />
        </div>
        <p className="hint">Left forces light, middle forces dark (its middle line starts dissolved), right follows the page theme.</p>
      </section>
    </main>
  );
}
