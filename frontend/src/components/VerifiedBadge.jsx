import React from "react";

function VerifiedBadge({ className = "" }) {
  return (
    <span
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center align-middle ${className}`}
      title="Verified profile"
      aria-label="Verified profile"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-full w-full drop-shadow-[0_1px_2px_rgba(0,0,0,0.2)]"
        aria-hidden="true"
      >
        <path
          d="m12 1.35 2.05 1.95 2.78-.48 1.15 2.58 2.58 1.15-.48 2.78L22.03 12l-1.95 2.67.48 2.78-2.58 1.15-1.15 2.58-2.78-.48L12 22.65 9.95 20.7l-2.78.48-1.15-2.58-2.58-1.15.48-2.78L1.97 12l1.95-2.67-.48-2.78L6.02 5.4l1.15-2.58 2.78.48L12 1.35Z"
          fill="#1597f4"
        />
        <path
          d="m7.4 12.35 3.1 3.1 6.25-6.55"
          fill="none"
          stroke="white"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.7"
        />
      </svg>
    </span>
  );
}

export default VerifiedBadge;
