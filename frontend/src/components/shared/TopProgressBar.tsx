import { useEffect, useState } from 'react';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';

// Quick requests finish before this, so the bar only appears when there's a real wait.
const SHOW_DELAY_MS = 250;

/**
 * Thin animated bar pinned to the top of the window while any data is loading
 * or saving - including background refreshes, which otherwise happen silently
 * behind content that's already on screen.
 */
function TopProgressBar() {
  const busy = useIsFetching() + useIsMutating() > 0;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!busy) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [busy]);

  return (
    <div className={`top-progress${visible ? ' on' : ''}`} role="progressbar" aria-hidden={!visible} aria-label="Loading">
      <span />
    </div>
  );
}

export default TopProgressBar;
