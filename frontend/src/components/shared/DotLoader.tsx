interface DotLoaderProps {
  size?: number;
  className?: string;
}

/** Six-dot ring that tilts in 3D, matching the login button loader. */
function DotLoader({ size = 18, className }: DotLoaderProps) {
  return (
    <span
      className={className ? `dot-loader ${className}` : 'dot-loader'}
      style={{ fontSize: size }}
      aria-hidden
    >
      <span>
        {Array.from({ length: 6 }, (_, i) => (
          <i key={i} style={{ ['--i' as string]: i }} />
        ))}
      </span>
    </span>
  );
}

export default DotLoader;
