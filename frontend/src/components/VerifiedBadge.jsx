import React from "react";
import { FiCheck } from "react-icons/fi";

function VerifiedBadge({ className = "" }) {
  return (
    <span
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white align-middle ${className}`}
      title="Verified profile"
      aria-label="Verified profile"
    >
      <FiCheck className="h-3 w-3 stroke-[3]" />
    </span>
  );
}

export default VerifiedBadge;
