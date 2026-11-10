"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { createFolder, editFolder } from "../actions/library";
import { FOLDER_COLOR_HEX, FOLDER_COLOR_NAMES } from "@/lib/folderColors";
import Dialog from "./Dialog";
import Spinner from "./Spinner";

interface Props {
  open: boolean;
  onClose: () => void;
  /** When set, the dialog edits this folder instead of creating one. */
  folder?: { id: string; name: string; color: string };
}

export default function NewFolderDialog({ open, onClose, folder }: Props) {
  const router = useRouter();
  const [name, setName] = useState(folder?.name ?? "");
  const [color, setColor] = useState(folder?.color ?? "blue");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      if (folder) {
        const res = await editFolder(folder.id, name, color);
        if (!res.ok) return setError(res.error ?? "Couldn't save the folder.");
        onClose();
        router.refresh();
      } else {
        const res = await createFolder(name, color);
        if (!res.ok || !res.id) return setError(res.error ?? "Couldn't create the folder.");
        setName("");
        onClose();
        router.push(`/folders/${res.id}`);
      }
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={folder ? "Edit folder" : "New folder"}
      description={folder ? undefined : "Use one folder per class or subject."}
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="folder-name" className="label">
            Name
          </label>
          <input
            id="folder-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="e.g. Biology 101"
            className="field"
          />
        </div>
        <fieldset>
          <legend className="label">Colour</legend>
          <div className="flex gap-2">
            {FOLDER_COLOR_NAMES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={c}
                aria-pressed={color === c}
                className="grid size-7 place-items-center rounded-full ring-offset-2 ring-offset-surface transition aria-pressed:ring-2 aria-pressed:ring-ink/40"
                style={{ backgroundColor: FOLDER_COLOR_HEX[c] }}
              >
                {color === c && <Check className="size-3.5 text-white" />}
              </button>
            ))}
          </div>
        </fieldset>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={pending || !name.trim()} className="btn btn-primary">
            {pending && <Spinner />}
            {folder ? "Save" : "Create folder"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
