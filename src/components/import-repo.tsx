"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  FileArchive,
  Link2,
  LoaderCircle,
  Upload,
  X,
} from "lucide-react";
import { ErrorNotice, number } from "./ui";
import { requestJson } from "./use-resource";

export function ImportRepo({
  onCreated,
  onClose,
}: {
  onCreated: (id: number) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"url" | "zip">("url");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | undefined>();
  const [dragging, setDragging] = useState(false);
  const request = useRef<XMLHttpRequest | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
      controller.current?.abort();
    },
    [],
  );

  function chooseFile(candidate?: File) {
    setError("");
    setFile(null);
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith(".zip"))
      return setError(
        "Choose a .zip archive containing the repository and its .git directory.",
      );
    if (!candidate.size)
      return setError("This archive is empty. Choose a different file.");
    if (candidate.size > 4 * 1024 ** 3)
      return setError("This archive exceeds the 4 GB upload limit.");
    setFile(candidate);
  }

  function upload(archive: File): Promise<{ id: number }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      request.current = xhr;
      xhr.open("POST", "/api/repos/upload");
      xhr.responseType = "json";
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable)
          setUploadPct(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300 && xhr.response?.id)
          resolve(xhr.response);
        else
          reject(
            new Error(
              xhr.response?.error ||
                `Upload failed (${xhr.status}). Please try again.`,
            ),
          );
      };
      xhr.onerror = () =>
        reject(
          new Error(
            "Upload interrupted. Check that the local server is running.",
          ),
        );
      xhr.onabort = () => reject(new Error("Upload canceled."));
      const body = new FormData();
      body.append("file", archive);
      xhr.send(body);
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (mode === "zip" && !file) return setError("Choose a ZIP archive first.");
    if (mode === "url" && !url.trim())
      return setError("Enter a repository URL first.");
    setBusy(true);
    setUploadPct(undefined);
    controller.current = new AbortController();
    try {
      const result =
        mode === "zip"
          ? await upload(file!)
          : await requestJson<{ id: number }>("/api/repos", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: url.trim() }),
              signal: controller.current.signal,
            });
      onCreated(result.id);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not import this repository.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel import-panel" aria-labelledby="import-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">BRING YOUR CODE</span>
          <h2 id="import-title">Add a repository</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close import form"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <div className="import-layout">
        <form onSubmit={submit} aria-busy={busy}>
          <div className="segmented" role="group" aria-label="Import method">
            <button
              type="button"
              aria-pressed={mode === "url"}
              disabled={busy}
              onClick={() => {
                setMode("url");
                setError("");
              }}
            >
              <Link2 size={16} /> Clone URL
            </button>
            <button
              type="button"
              aria-pressed={mode === "zip"}
              disabled={busy}
              onClick={() => {
                setMode("zip");
                setError("");
              }}
            >
              <FileArchive size={16} /> Upload ZIP
            </button>
          </div>
          {mode === "url" ? (
            <div className="field">
              <label htmlFor="repo-url">Repository URL</label>
              <input
                id="repo-url"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={url}
                disabled={busy}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repository.git"
                required
              />
              <p className="field-hint">
                Use a public Git URL, or a repository your local Git client can
                access.
              </p>
            </div>
          ) : (
            <div className="field">
              <label
                className={`drop-zone ${dragging ? "dragging" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!busy) setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (!busy) chooseFile(e.dataTransfer.files[0]);
                }}
              >
                <input
                  type="file"
                  accept=".zip,application/zip"
                  aria-label="Repository ZIP archive"
                  disabled={busy}
                  onChange={(e) => chooseFile(e.target.files?.[0])}
                />
                <Upload size={26} />
                <strong>
                  {file ? file.name : "Drop your ZIP here, or browse files"}
                </strong>
                <span>
                  {file
                    ? `${number(file.size / 1024 ** 2)} MB · Ready to upload`
                    : "Include the hidden .git directory · Up to 4 GB"}
                </span>
              </label>
              <p className="field-hint">
                GitHub’s “Download ZIP” does not include Git history and cannot
                be analyzed.
              </p>
            </div>
          )}
          {error && <ErrorNotice message={error} />}
          {busy && mode === "zip" && (
            <div className="import-progress" role="status">
              <div className="progress-caption">
                <span>
                  {uploadPct === 100
                    ? "Upload complete · Preparing archive…"
                    : "Uploading archive…"}
                </span>
                <span>{uploadPct !== undefined && `${uploadPct}%`}</span>
              </div>
              <progress
                max={100}
                value={uploadPct}
                aria-label="ZIP upload progress"
              />
            </div>
          )}
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <ArrowRight size={16} />
            )}
            {busy ? "Starting import…" : "Import repository"}
          </button>
        </form>
        <aside className="import-explainer">
          <span className="eyebrow">FROM HISTORY TO INSIGHT</span>
          <ol>
            <li>
              <span>01</span>
              <div>
                <strong>Bring in a repository</strong>
                <p>Clone its full history or upload a local archive.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Let Git do the analysis</strong>
                <p>Changes are indexed once and stored locally.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Explore every layer</strong>
                <p>
                  Go from repository totals to directories and individual files.
                </p>
              </div>
            </li>
          </ol>
        </aside>
      </div>
    </section>
  );
}
