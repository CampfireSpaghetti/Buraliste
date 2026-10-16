import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Toast } from '../../src/ui/Toast';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Toast', () => {
  it('un nouveau message repart pour 5 s complètes', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    const { rerender } = render(<Toast message="A" onDone={onDone} />);
    vi.advanceTimersByTime(4500);
    rerender(<Toast message="B" onDone={onDone} />);
    vi.advanceTimersByTime(1000);
    expect(onDone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4100);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
