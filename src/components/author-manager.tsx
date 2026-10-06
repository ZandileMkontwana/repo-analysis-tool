"use client";

import { useState, type FormEvent } from "react";
import { Search, Unlink, UserRoundCheck, Users } from "lucide-react";
import type { AuthorGroupRow, AuthorRow } from "@/lib/types";
import { EmptyState, ErrorNotice, Loading, number } from "./ui";
import { requestJson, useResource } from "./use-resource";

type Payload = { authors: AuthorRow[]; groups: AuthorGroupRow[] };

export function AuthorManager({
  repoId,
  filters,
  onChanged,
}: {
  repoId: string;
  filters: string;
  onChanged: () => void;
}) {
  const endpoint = `/api/repos/${encodeURIComponent(repoId)}/authors${filters ? `?${filters}` : ""}`;
  const { data, error, loading, reload } = useResource<Payload>(endpoint);
  const [selected, setSelected] = useState<number[]>([]);
  const [label, setLabel] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const authors = data?.authors || [];
  const groups = data?.groups || [];
  const visible = authors.filter((a) =>
    `${a.name} ${a.email} ${a.groupLabel || ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  async function merge(event: FormEvent) {
    event.preventDefault();
    setMutationError("");
    if (selected.length < 2)
      return setMutationError("Select at least two identities to merge.");
    setBusy(true);
    try {
      await requestJson(`/api/repos/${encodeURIComponent(repoId)}/authors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorIds: selected, label: label.trim() }),
      });
      setSelected([]);
      setLabel("");
      reload();
      onChanged();
    } catch (e) {
      setMutationError(
        e instanceof Error ? e.message : "Could not merge identities.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function unmerge(groupId: number) {
    setMutationError("");
    setBusy(true);
    try {
      await requestJson(
        `/api/repos/${encodeURIComponent(repoId)}/authors?groupId=${groupId}`,
        { method: "DELETE" },
      );
      reload();
      onChanged();
    } catch (e) {
      setMutationError(
        e instanceof Error ? e.message : "Could not unmerge this group.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="author-layout">
      <section className="panel author-picker">
        <div className="panel-heading">
          <div>
            <h2>
              Author identities <span className="count">{authors.length}</span>
            </h2>
            <p className="muted">
              Select duplicate identities that belong to the same person.
            </p>
          </div>
          <label className="search-box">
            <Search size={16} />
            <input
              type="search"
              aria-label="Search author identities"
              placeholder="Find an identity…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        {error && <ErrorNotice message={error} retry={reload} />}
        {loading && <Loading label="Loading author identities…" />}
        {data && (
          <div className="identity-list">
            {visible.map((author) => (
              <label
                key={author.id}
                className={`identity-row ${selected.includes(author.id) ? "selected" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(author.id)}
                  disabled={busy}
                  onChange={(e) =>
                    setSelected((old) =>
                      e.target.checked
                        ? [...old, author.id]
                        : old.filter((id) => id !== author.id),
                    )
                  }
                />
                <span className="avatar">
                  {author.name.slice(0, 2).toUpperCase()}
                </span>
                <span>
                  <strong>{author.name}</strong>
                  <small>{author.email}</small>
                </span>
                <span className="identity-meta">
                  {number(author.commitsInSet || 0)} commits
                  {author.groupLabel && <small>{author.groupLabel}</small>}
                </span>
              </label>
            ))}
          </div>
        )}
        {data && !visible.length && (
          <EmptyState title="No identities found">
            <p>Try another name or email address.</p>
          </EmptyState>
        )}
      </section>
      <aside>
        <form className="panel merge-card" onSubmit={merge}>
          <UserRoundCheck size={24} />
          <span className="eyebrow">MERGE IDENTITIES</span>
          <h2>Treat duplicates as one author</h2>
          <p className="muted">
            Merging changes reporting only. Git history and imported commits
            remain untouched.
          </p>
          <label>
            <span>Group label</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Alex Smith"
            />
          </label>
          <div className="selection-count">
            <Users size={15} /> {selected.length} selected
          </div>
          {mutationError && <ErrorNotice message={mutationError} />}
          <button
            className="button primary"
            type="submit"
            disabled={busy || selected.length < 2}
          >
            Merge selected identities
          </button>
        </form>
        <section className="panel group-list">
          <div className="panel-heading">
            <div>
              <h2>Saved groups</h2>
              <p className="muted">Applied to rankings and filters.</p>
            </div>
          </div>
          {!groups.length ? (
            <p className="group-empty">
              No manual groups yet. Git’s .mailmap identities are already
              applied during import.
            </p>
          ) : (
            groups.map((group) => (
              <div className="group-row" key={group.id}>
                <div>
                  <strong>{group.label}</strong>
                  <span>{group.members.length} identities</span>
                </div>
                <button
                  className="icon-button"
                  disabled={busy}
                  onClick={() => void unmerge(group.id)}
                  title="Unmerge this group"
                  aria-label={`Unmerge ${group.label}`}
                >
                  <Unlink size={15} />
                </button>
              </div>
            ))
          )}
        </section>
      </aside>
    </div>
  );
}
