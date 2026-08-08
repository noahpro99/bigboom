import { siMatrix } from "simple-icons";

interface MatrixIconProps {
  size?: number;
  className?: string;
}

export function MatrixIcon({ size = 20, className }: MatrixIconProps) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-label="Matrix"
    >
      <path d={siMatrix.path} />
    </svg>
  );
}
