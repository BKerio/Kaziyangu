import AppLoader from '@/components/shared/AppLoader';

interface PageLoaderProps {
  /** Minimum height of the loading area, so the layout doesn't jump when content arrives. */
  height?: number;
  /** Short line under the spinner; also announced to screen readers. */
  label?: string;
  size?: number;
}

/** The app's spinner centred in a block - the standard placeholder while a page or section loads. */
function PageLoader({ height = 200, label = 'Loading…', size = 30 }: PageLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        minHeight: height,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        color: 'var(--red)',
      }}
    >
      <AppLoader size={size} />
      {label && <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--muted)' }}>{label}</span>}
    </div>
  );
}

export default PageLoader;
