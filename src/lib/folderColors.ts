/** Notebook-cover colours for folders (shared by server and client). */
export const FOLDER_COLOR_HEX: Record<string, string> = {
  blue: "#4263eb",
  green: "#2b8a3e",
  amber: "#e67700",
  rose: "#d6336c",
  violet: "#7048e8",
  slate: "#6c757d",
};

export const FOLDER_COLOR_NAMES = Object.keys(FOLDER_COLOR_HEX);

export function folderHex(color: string | null | undefined): string {
  return FOLDER_COLOR_HEX[color ?? ""] ?? FOLDER_COLOR_HEX.blue;
}
