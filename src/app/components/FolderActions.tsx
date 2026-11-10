"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { removeFolder } from "../actions/library";
import Dialog from "./Dialog";
import NewFolderDialog from "./NewFolderDialog";
import Spinner from "./Spinner";

export default function FolderActions({ folder }: { folder: { id: string; name: string; color: string; projectCount: number } }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const remove = (deleteProjects: boolean) =>
    start(async () => {
      setError(null);
      const res = await removeFolder(folder.id, deleteProjects);
      if (res && !res.ok) setError(res.error ?? "Couldn't delete the folder.");
    });

  return (
    <div className="flex gap-2">
      <button type="button" onClick={() => setEditing(true)} className="btn btn-secondary btn-sm">
        <Pencil className="size-3.5" /> Edit
      </button>
      <button type="button" onClick={() => setDeleting(true)} className="btn btn-ghost btn-sm text-bad hover:bg-bad-soft hover:text-bad">
        <Trash2 className="size-3.5" /> Delete
      </button>

      <NewFolderDialog key={`${folder.name}-${folder.color}`} open={editing} onClose={() => setEditing(false)} folder={folder} />

      <Dialog open={deleting} onClose={() => setDeleting(false)} title={`Delete “${folder.name}”?`}>
        <p className="text-sm text-muted">
          {folder.projectCount > 0
            ? `It contains ${folder.projectCount} project${folder.projectCount === 1 ? "" : "s"}. You can keep them (they'll move to "No folder") or delete them too.`
            : "This folder is empty."}
        </p>
        {error && <p className="mt-3 text-sm text-bad">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => setDeleting(false)} className="btn btn-ghost">
            Cancel
          </button>
          {folder.projectCount > 0 && (
            <button type="button" disabled={pending} onClick={() => remove(true)} className="btn btn-danger">
              Delete folder and projects
            </button>
          )}
          <button type="button" disabled={pending} onClick={() => remove(false)} className="btn btn-primary">
            {pending && <Spinner />}
            {folder.projectCount > 0 ? "Delete folder, keep projects" : "Delete folder"}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
