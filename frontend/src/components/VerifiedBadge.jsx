import React from "react";

function VerifiedBadge({ className = "" }) {
  return (
    <span
      className={`inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full bg-[#1d9bf0] text-white align-middle shadow-[0_0_0_1px_rgba(255,255,255,0.12)] ${className}`}
      title="Verified profile"
      aria-label="Verified profile"
    >
      <svg
        viewBox="0 0 12 12"
        className="h-[10px] w-[10px]"
        aria-hidden="true"
      >
        <path
          d="M3.2 6.2 5.1 8l3.7-4"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    </span>
  );
}

export default VerifiedBadge;
