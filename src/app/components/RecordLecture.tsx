"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, Square } from "lucide-react";
import { countWords } from "@/lib/text/chunking";

/* Minimal typings for the Web Speech API (not in TypeScript's DOM lib everywhere). */
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => SpeechRecognitionLike;

function getRecognition(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const subscribe = () => () => {};

interface Props {
  transcript: string;
  onTranscriptChange: (text: string) => void;
}

/** Live lecture transcription with the browser's built-in speech recognition. */
export default function RecordLecture({ transcript, onTranscriptChange }: Props) {
  const supported = useSyncExternalStore(subscribe, () => getRecognition() !== null, () => false);
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const wantRef = useRef(false);
  const textRef = useRef(transcript);

  useEffect(() => {
    textRef.current = transcript;
  }, [transcript]);

  useEffect(() => () => {
    wantRef.current = false;
    recRef.current?.stop();
  }, []);

  const start = () => {
    const Ctor = getRecognition();
    if (!Ctor) return;
    setError(null);
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (e) => {
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      if (finalText.trim()) {
        const next = `${textRef.current}${textRef.current && !textRef.current.endsWith(" ") ? " " : ""}${finalText.trim()}`;
        textRef.current = next;
        onTranscriptChange(next);
      }
      setInterim(interimText);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return; // restarts on end
      wantRef.current = false;
      setRecording(false);
      setError(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "Microphone access was blocked. Allow it in your browser's address bar, then try again."
          : e.error === "network"
            ? "Speech recognition needs an internet connection in this browser."
            : "Recording stopped unexpectedly. Press Record to continue.",
      );
    };
    rec.onend = () => {
      setInterim("");
      // Browsers stop after a pause; keep going until the student presses Stop.
      if (wantRef.current) {
        try {
          rec.start();
        } catch {
          wantRef.current = false;
          setRecording(false);
        }
      } else {
        setRecording(false);
      }
    };
    recRef.current = rec;
    wantRef.current = true;
    try {
      rec.start();
      setRecording(true);
    } catch {
      setError("Couldn't start recording. Try again.");
    }
  };

  const stop = () => {
    wantRef.current = false;
    recRef.current?.stop();
    setRecording(false);
  };

  if (!supported) {
    return (
      <p className="rounded-md border border-line bg-subtle px-3 py-3 text-sm text-muted">
        Live recording needs Chrome, Edge or Safari. You can still paste a transcript or upload a subtitle file.
      </p>
    );
  }

  const words = countWords(transcript);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {recording ? (
          <button type="button" onClick={stop} className="btn btn-danger">
            <Square className="size-3.5 fill-current" /> Stop recording
          </button>
        ) : (
          <button type="button" onClick={start} className="btn btn-secondary">
            <Mic className="size-4 text-bad" /> {transcript ? "Continue recording" : "Record lecture"}
          </button>
        )}
        {recording && (
          <span className="flex items-center gap-2 text-sm text-bad">
            <span className="size-2 animate-pulse rounded-full bg-bad" /> Listening…
          </span>
        )}
        <span className="ml-auto text-xs text-faint tabular-nums">{words.toLocaleString()} words</span>
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
          {error}
        </p>
      )}
      <textarea
        aria-label="Lecture transcript"
        value={interim ? `${transcript} ${interim}` : transcript}
        onChange={(e) => onTranscriptChange(e.target.value)}
        readOnly={recording}
        rows={6}
        placeholder="The transcript appears here as the lecturer speaks. You can edit it afterwards."
        className="field font-serif leading-relaxed"
      />
      <p className="text-xs text-faint">Uses your browser&apos;s speech recognition. In Chrome, audio is processed by Google&apos;s speech service.</p>
    </div>
  );
}
