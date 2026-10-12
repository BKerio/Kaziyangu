import { useEffect, useState } from 'react';

// Keep in sync with the phone breakpoint in index.css (sidebar becomes a drawer).
const MOBILE_QUERY = '(max-width: 859px)';

export function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const on = () => setMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
}
