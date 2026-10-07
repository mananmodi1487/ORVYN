import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * Pinning and archiving are schema changes, so the
 * migration is pinned structurally, in the same
 * spirit as usage-signing.test.ts: the statements
 * that matter are *which columns are added, which
 * indexes back them, and that re-running the file
 * is safe*.
 */

const sql = readFileSync(
  new URL(
    "../../supabase/migrations/20261007000000_conversation_pin_archive.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("the pin and archive migration", () => {
  it("adds both timestamps as nullable", () => {
    // null is the default state: not pinned, not
    // archived. A NOT NULL column would force every
    // existing row to be rewritten with a value.
    assert.match(
      sql,
      /add column if not exists pinned_at timestamptz null/,
    );
    assert.match(
      sql,
      /add column if not exists archived_at timestamptz null/,
    );
  });

  it("is idempotent", () => {
    // Every mutating statement is guarded, so a
    // re-run — a fresh database, a partially
    // applied migration, or a database that
    // already ran the file — ends at the same
    // state instead of failing halfway.
    const statements = sql
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => statement !== "");
    assert.ok(statements.length > 0, "the migration must have statements");
    for (const statement of statements) {
      if (/^(alter table|create index)/i.test(statement)) {
        assert.match(
          statement,
          /if not exists/i,
          `every mutating statement must be guarded:\n${statement}`,
        );
      }
    }
  });

  it("keeps every index user-scoped", () => {
    // The indexes back the sidebar's ordering and
    // filtering, and both lead with user_id so a
    // plan for one user's rows never reaches
    // another user's ordering.
    const indexes = sql.match(/create index if not exists[\s\S]*?;/gi) ?? [];
    assert.equal(indexes.length, 2, "the sidebar needs its two indexes");
    for (const index of indexes) {
      assert.match(index, /on public\.conversations/);
      assert.match(index, /\(user_id,/, "the index must lead with user_id");
    }
  });

  it("indexes the archived filter and the pinned ordering separately", () => {
    // The partial predicates match the two queries
    // the list runs: active rows for the list, and
    // pinned rows for the leading segment.
    assert.match(sql, /where archived_at is null/i);
    assert.match(sql, /where pinned_at is not null/i);
  });

  it("changes no policy and grants nothing", () => {
    // Ownership stays enforced by the existing
    // `conversations_update_own` policy, which
    // already covers these columns: RLS isolation
    // is preserved by not touching it.
    assert.ok(
      !/create policy|drop policy|alter policy|revoke|grant/i.test(sql),
      "the migration must not touch policies or grants",
    );
  });
});
