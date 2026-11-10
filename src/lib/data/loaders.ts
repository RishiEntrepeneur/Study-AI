import "server-only";

import { cache } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "../auth/dal";
import { getEngine } from "../ai/engine";
import { getProjectBundle } from "./projects";
import type { GenerationStatusView } from "../types";

/** Load a project for the signed-in user once per request (layout and page share it). */
export const loadProject = cache(async (projectId: string) => {
  const user = await requireUser();
  const engine = getEngine();
  await engine.ensureStarted();
  const bundle = await getProjectBundle(user.id, projectId);
  if (!bundle) notFound();
  const statuses: GenerationStatusView[] = bundle.generations.map((g) => ({
    id: g.id,
    type: g.type,
    status: g.status,
    error: g.error,
    hasContent: Boolean(g.content),
    progress: engine.progress(g.id),
  }));
  return { user, ...bundle, statuses };
});
