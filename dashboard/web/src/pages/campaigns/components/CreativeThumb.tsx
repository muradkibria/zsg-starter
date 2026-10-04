// A creative's thumbnail from /api/creatives/:id/thumb, falling back to a
// neutral tile with the ad's initials when there's no thumbnail to show.

import { useState } from "react";
import clsx from "clsx";
import { api } from "@/lib/api";

function initialsOf(name: string): string {
  const words = name
    .replace(/^(cv|_)\s*-?\s*/i, "")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length > 1 && !/^(v\d+|final|ad|advert)$/i.test(w));
  return (words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || name.slice(0, 2).toUpperCase()).slice(0, 2);
}

export function CreativeThumb({
  id,
  name,
  className,
  size = "md",
}: {
  id: string | null | undefined;
  name: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  const box = size === "sm" ? "h-9 w-12 text-[11px]" : size === "lg" ? "h-[72px] w-24 text-base" : "h-12 w-16 text-xs";
  return (
    <span className={clsx("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-ink font-display font-semibold text-white/85", box, className)}>
      {id && !failed ? (
        <img
          src={api.href(`/creatives/${id}/thumb`)}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <span aria-hidden="true">{initialsOf(name)}</span>
      )}
    </span>
  );
}
