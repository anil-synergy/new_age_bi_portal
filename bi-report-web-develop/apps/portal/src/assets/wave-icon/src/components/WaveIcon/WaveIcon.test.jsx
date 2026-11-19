import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { StrictMode, createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WaveIcon from './WaveIcon';
import { PALETTES } from './waveConfig';

beforeEach(() => {
  vi.useFakeTimers();
  window.matchMedia = vi.fn().mockImplementation((q) => ({
    matches: false,
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-theme');
});

describe('WaveIcon', () => {
  it('renders exactly three primary waves', () => {
    const { container } = render(<WaveIcon />);
    expect(container.querySelectorAll('.wi-core')).toHaveLength(3);
    expect(container.querySelectorAll('.wi-hit')).toHaveLength(3);
  });

  it('keeps SVG ids unique across instances and resolves every reference', () => {
    const { container } = render(
      <>
        <WaveIcon />
        <WaveIcon />
      </>,
    );
    const ids = [...container.querySelectorAll('[id]')].map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    const html = container.innerHTML;
    for (const [, ref] of html.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(ref);
    for (const [, ref] of html.matchAll(/href="#([^"]+)"/g)) expect(ids).toContain(ref);
  });

  it('never uses #333869 in dark mode and leads with it in light mode', () => {
    const dark = render(<WaveIcon theme="dark" />);
    expect(dark.container.innerHTML.toLowerCase()).not.toContain('333869');
    expect(JSON.stringify(PALETTES.dark).toLowerCase()).not.toContain('333869');
    dark.unmount();
    const light = render(<WaveIcon theme="light" />);
    expect(light.container.innerHTML.toLowerCase()).toContain('333869');
    expect(light.container.innerHTML.toLowerCase()).toContain('1f9cd8');
  });

  it('follows the page theme when auto', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const { container } = render(<WaveIcon />);
    expect(container.firstChild.dataset.theme).toBe('dark');
  });

  it('dissolves only the clicked line, then restores it, firing callbacks with the line index', () => {
    const calls = [];
    const { container } = render(
      <WaveIcon
        dissolveDuration={1000}
        onDissolveStart={(i) => calls.push(`ds${i}`)}
        onDissolveEnd={(i) => calls.push(`de${i}`)}
        onRestoreStart={(i) => calls.push(`rs${i}`)}
        onRestoreEnd={(i) => calls.push(`re${i}`)}
      />,
    );
    const lines = [...container.querySelectorAll('.wi-line')];
    expect(lines).toHaveLength(3);
    fireEvent.click(lines[1]);
    expect(lines.map((l) => l.dataset.phase)).toEqual(['playing', 'dissolving', 'playing']);
    act(() => vi.advanceTimersByTime(1100));
    expect(lines.map((l) => l.dataset.phase)).toEqual(['playing', 'dissolved', 'playing']);
    fireEvent.click(lines[1]);
    expect(lines[1].dataset.phase).toBe('restoring');
    act(() => vi.advanceTimersByTime(1100));
    expect(lines[1].dataset.phase).toBe('playing');
    expect(calls).toEqual(['ds1', 'de1', 'rs1', 're1']);
  });

  it('supports keyboard activation per line', () => {
    const { container } = render(<WaveIcon dissolveDuration={500} />);
    const line = container.querySelectorAll('.wi-line')[0];
    fireEvent.keyDown(line, { key: 'Enter' });
    expect(line.dataset.phase).toBe('dissolving');
  });

  it('queues a click made mid-transition instead of glitching', () => {
    const { container } = render(<WaveIcon dissolveDuration={1000} />);
    const line = container.querySelector('.wi-line');
    fireEvent.click(line);
    act(() => vi.advanceTimersByTime(300));
    fireEvent.click(line); // wants to restore; must wait for the dissolve to settle
    expect(line.dataset.phase).toBe('dissolving');
    act(() => vi.advanceTimersByTime(800));
    expect(line.dataset.phase).toBe('restoring');
  });

  it('supports imperative replay and per-line controlled mode', () => {
    const ref = createRef();
    const { container, rerender } = render(<WaveIcon ref={ref} dissolveDuration={500} />);
    const phases = () => [...container.querySelectorAll('.wi-line')].map((l) => l.dataset.phase);
    act(() => ref.current.replay(2));
    act(() => vi.advanceTimersByTime(600));
    expect(phases()).toEqual(['playing', 'playing', 'restoring']);
    act(() => vi.advanceTimersByTime(600));
    expect(phases()).toEqual(['playing', 'playing', 'playing']);

    rerender(<WaveIcon ref={ref} dissolveDuration={500} dissolved={[true, false, true]} />);
    act(() => vi.advanceTimersByTime(600));
    expect(phases()).toEqual(['dissolved', 'playing', 'dissolved']);
  });

  it('survives StrictMode and starts dissolved when asked', () => {
    const { container } = render(
      <StrictMode>
        <WaveIcon defaultDissolved={[false, true, false]} />
      </StrictMode>,
    );
    expect([...container.querySelectorAll('.wi-line')].map((l) => l.dataset.phase)).toEqual([
      'playing',
      'dissolved',
      'playing',
    ]);
  });

  it('exposes accessibility semantics', () => {
    const { container, rerender } = render(<WaveIcon label="Waves" />);
    expect(container.firstChild.getAttribute('aria-label')).toBe('Waves');
    const btn = container.querySelector('[role="button"]');
    expect(btn.getAttribute('aria-label')).toBe('Wave line 1');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    rerender(<WaveIcon label="Waves" interactive={false} />);
    expect(container.querySelector('[role="button"]')).toBeNull();
    rerender(<WaveIcon decorative />);
    expect(container.firstChild.getAttribute('aria-hidden')).toBe('true');
  });

  it('forces reduced motion and shortens the transition', () => {
    const { container } = render(<WaveIcon reducedMotion dissolveDuration={5000} />);
    expect(container.firstChild.dataset.reduced).toBe('true');
    const line = container.querySelector('.wi-line');
    fireEvent.click(line);
    act(() => vi.advanceTimersByTime(500));
    expect(line.dataset.phase).toBe('dissolved');
  });

  it('derives 30fps step counts from the loop duration', () => {
    const { container } = render(<WaveIcon loopDuration={4000} />);
    expect(container.firstChild.style.getPropertyValue('--wi-steps')).toBe('120');
  });
});
