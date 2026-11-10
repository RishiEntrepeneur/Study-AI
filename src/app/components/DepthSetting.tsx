"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setProjectTier } from "../actions/library";
import type { ContextTier } from "@/lib/types";
import TierToggle from "./TierToggle";

export default function DepthSetting({ projectId, tier }: { projectId: string; tier: ContextTier }) {
  const router = useRouter();
  const [value, setValue] = useState(tier);
  const [, start] = useTransition();
  return (
    <div>
      <TierToggle
        value={value}
        onChange={(next) => {
          setValue(next);
          start(async () => {
            await setProjectTier(projectId, next);
            router.refresh();
          });
        }}
      />
      <p className="mt-2 text-xs text-faint">Applies to anything you create or regenerate from now on.</p>
    </div>
  );
}
