---
name: beyond-xhigh
description: >-
  Extra agentic process on top of Grok 4.6 Extra High: Extra High scout/critic
  swarm, 60-minute keep-going floor, quality over token savings, launch-only
  turns, scout synthesis before any edit, and mandatory re-critic after FAIL.
  Use only when the user invokes /beyond-xhigh or @beyond-xhigh, or on a
  [bxh-floor] continue for that invoke. Do not apply automatically. Prefer
  Custom Mode (Alt+Enter) so this skill stays on every turn.
disable-model-invocation: true
icon: rocket
color: purple
---

# Beyond Extra High

This skill does **not** raise Grok 4.6's thinking budget. Extra High (`xhigh`) is already the cap. It forces a harder *process*: a planner (this agent) plus Extra High isolated workers.

Keep Grok 4.6 Extra High selected while using this skill. Turn **Fast** off (Fast is speed/price, not a fifth effort). `/beyond-xhigh` with Enter attaches for one message and can fade under compaction; use **Custom Mode** (Alt+Enter on Windows) so this protocol stays in context for the whole session, including the 60-minute floor.

**Quality over thrift.** Burn tokens on research, citations, and re-checks. Do not drop scouts, drop to one scout, or pass a cheaper Task model to save tokens.

**Keep-going floor (60 min).** Cursor cannot pin one generation to an hour. Prompt-only “do not declare done” failed (wraps at ~35m and ~48m). Enforcement is the user-level `stop` hook `~/.cursor/hooks/bxh_floor.py`: it continues a `/beyond-xhigh` chat until 60 minutes of **wall-clock** since invoke. Default `loop_limit` is 5 follow-ups (not minutes); this hook sets `loop_limit` to 100 so the count is not the cap. Cloud agents do not load `~/.cursor/hooks.json`.

- `T0` is the timestamp of the latest real user query that contains `/beyond-xhigh` or `@beyond-xhigh` and does not contain `[bxh-floor]`. The hook uses the last user-query wrapper pair in the message so a skill dump that mentions that wrapper cannot steal T0. `[bxh-floor]` continues must **not** reset T0. `arm` stamps T0 from the prompt `<timestamp>` when present, not only `time.time()`, so hook latency cannot shift the floor. Planner `elapsed` is wall-clock from that stamp (`Get-Date` on non-launch turns).
- Before 60m: **do not declare done.** Keep raising the product: missing checklist items, bugs, regressions, and tool proof (edit, build, test, runtime). Critic FAILs are planner work: **fix them**, then re-critic (max 3 cycles).
- The hook skips **aborted** stops, **empty** last-assistant text (tool-only launch with no status line), and **short** launch-only status lines that include both `T0=` and an await-scouts or await-critic phase marker (under 240 characters, at most two lines, no wrap wording). That is hang-prevention while workers are Starting up. A wrap that quotes a phase marker, a 500+ character status-like essay, or a short "Not done" line still gets a floor continue. Critic PASS is not permission to stop.
- Do not sleep, `/loop`, Stopwatch, or `Await` to pad the clock. Do not add unrelated features or a 4th scout to burn time. Do not sit on hung Starting-up cards.
- After 60m: the hook stops continuing. Finish if the checklist is tool-proven; otherwise keep going until the max-3 re-critic cap, then honest gaps. Cursor increments `loop_count` on each floor continue. Default Cursor `loop_limit` is 5 follow-ups; this hook sets **100**. Do not stop because `loop_count` is 2, 5, or 11 — only because elapsed is ≥ 60m or the checklist is tool-proven after the floor.
- Windows: Cursor may prefix hook stdin with a UTF-8 BOM (or UTF-16). `bxh_floor.py` strips BOM(s), retries encodings, and falls back to `CURSOR_TRANSCRIPT_PATH` if JSON is empty. Hook `timeout` is 30 seconds (Windows `python.exe` has been ~6s). If a floor continue still does not fire, open **Output → Hooks** and `~/.cursor/hooks/state/bxh-floor.log` (`raw_len` / `head`). Reload Cursor if `hooks.json` was just created. The script flushes stdout, writes a trailing newline, and delays ~100ms before exit. `selftest` isolates `BXH_FLOOR_STATE` and `BXH_FLOOR_LOG` and must not rewrite the live conversation clock. It also checks that the skill, scout, critic, and `hooks.json` still carry the Extra High process pack. `stash` (`afterAgentResponse`) stores assistant `text` (or structured `content` blocks), not the user `prompt`, so launch-only skip still sees the status line. Empty assistant text is a no-op: it must not erase the last wrap or retag `stash_generation`. Transcript last-assistant text uses that same coercion (string, typed `text` blocks, or untyped `text` fields) so a missing `type` does not look like an empty launch and skip the floor.

Track phase: `await-scouts` | `implement` | `await-critic` | `verify`.

## Mode

- **Same-turn:** the user asked for new work, a change in behavior, to "improve" something, to "deepen" it, or to "scale" quality/intelligence. Scout, then implement.
- **After-the-fact:** the user only asked to verify or critique work **already done in this session**, with **no new scope**. Skip scouts; go to step 5. "Improve / deepen / keep going / scale" from the **user** is same-turn, not after-the-fact.
- **Floor continue:** the user message contains `[bxh-floor]`. Same invoke; do not reset T0. This is **not** after-the-fact and **not** a new same-turn scout swarm. Keep the **original** success checklist; do not replace it with the followup text. Re-read `C:\Users\iaz54\.cursor\skills\beyond-xhigh\SKILL.md`. Resume at the next unproven checklist item (verify, leftover product/proof, or first critic if it has not run). Do not launch extra scouts. If last assistant text already has a critic `VERDICT`, `[Critic]` PASS/FAIL, `Swarm critic PASS`, `first critic PASS`, or `no second critic`, do not launch another critic unless step 7 FAIL.

Copy this checklist:

```
Beyond Extra High:
- [ ] T0: <invoke timestamp>  elapsed: <update each non-launch turn>
- [ ] 1. Success checklist (original asks; `[bxh-floor]` does not add asks)
- [ ] 2. Swarm research (Extra High scouts, or in-process if types missing)
- [ ] 3. Scout synthesis + design choice (re-read cites)
- [ ] 4. Minimal targeted implementation
- [ ] 5. Swarm critic + adversarial pass
- [ ] 6. Tool-backed verification
- [ ] 7. Fix → re-critic (max 3) or honest remaining gaps
- [ ] 8. Keep-going: do not declare done while elapsed < 60m
```

## Roles

| Role | Who | Job |
|------|-----|-----|
| Planner | This agent | Decompose, wait, merge, re-read cites, edit, verify |
| Scout | `bxh-scout` | One independent research question, read-only, Extra High |
| Critic | `bxh-critic` | Independent review, read-only, Extra High |

Workers start empty. Put every path, question, and constraint in the Task prompt.

## Swarm model (required)

Every swarm `Task` **must** set both `subagent_type` (`bxh-scout` or `bxh-critic`) and `model` to `cursor-grok-4.6-xhigh`. Composer Fast dumbs the swarm down; do not use it.

- Never omit `model` (an omitted slug can default to `composer-2.5-fast`).
- Never omit `subagent_type` for swarm work (a missing type plus `inherit` has already launched Composer / generic workers).
- Never pass `composer-2.5-fast`, `composer-2.5`, any other Composer slug, `inherit`, or a cheaper/faster model.
- Never launch `explore` for swarm work (`explore` uses a faster default model).
- If `cursor-grok-4.6-xhigh` is not in the session allowlist, do that step **in this agent** (the parent is Grok 4.6 Extra High). Do not spawn a Composer worker instead.

## Type gate

If `bxh-scout` / `bxh-critic` are **not** in `available_subagent_types`, do **not** fall back to `explore` or `generalPurpose`. Tell the user this chat cannot swarm and they should start a **new** Agent chat. Meanwhile do that step **in this agent** with parallel `Grep` / `Glob` / `Read`. Never silent-fallback to a built-in Task type.

## Launch-only (required)

Hang-prevention, not thrift. Parent launched Tasks, then edited while cards sat on "Starting up."

Any message that contains a `Task` call:

- Contains **only** those Task calls plus one short status line (under 240 characters, at most two lines) that includes `T0=` and `phase=await-scouts` or `phase=await-critic`. No checklist, no wrap wording, no other tools in that message. A two-line `T0=` + phase line that also says `Critic already ran` or `do not launch another` is a wrap, not a launch skip.
- If results arrived in-band, go to the next step (no more tools in the launch message). If you only got ids / background / Starting up: **end the turn**. Do not poll `Await` / `AwaitShell`. Do not keep working.
- Resume from worker output, then state the phase.

Never implement in `await-scouts`. Never declare done in `await-critic`.

## Protocol

### 1. Success checklist

Restate every user ask as concrete, testable items. Do not add features that are not on it.

Floor continue: keep the original invoke's success checklist. Do not replace it with the `[bxh-floor]` followup text.

### 2. Swarm research

Floor continue → do not launch a new scout swarm. Skip to the next unproven step (step 5 if the critic has not run this invoke; otherwise leftover product/proof in steps 6–7).

After-the-fact → step 5.

Same-turn: launch **3** `bxh-scout` Tasks in one launch-only message when there are 3 distinct unknowns; **2** only if a third independent question does not exist. Never a 4th. Never overlapping questions. Never 1 scout to save tokens.

`model`: `cursor-grok-4.6-xhigh` and `subagent_type`: `bxh-scout` (required; see Swarm model). Prompt: workspace path, one question, Findings/Evidence/Risks/Open, no edits, no nested Tasks. If the product lives outside the git workspace (for example `C:\Users\iaz54\.cursor`), list those **absolute paths** in the scout prompt — workspace Grep will miss them. Tell the scout to run **at least three** search/read batches, include **at least four** `path:LINE` Evidence rows tagged `batch N`, and take **at least two** of those rows from `batch 2` or later. Phase: `await-scouts`.

**Stall fallback.** If cards stay on Starting up and no in-band results: do not launch more Tasks, and do **not** wait out the 60-minute floor on hung cards. On the first resume with no results, read this chat's `agent-transcripts/<id>/subagents/*.jsonl` if present; then `~/.cursor/subagents/` if present. If still empty, research in this agent with parallel `Grep` / `Glob` / `Read` / `WebSearch`. Hung cards do not count as work toward the floor. Never block the user on a stuck card.

### 3. Scout synthesis + design choice

Re-read the cited files (do not trust scout compression). Then write:

```
Scout synthesis
- Q1: <question> → <finding> (path:LINE × ≥4)
- Q2: …
- Q3: … (omit if only two scouts)
- Conflicts: quote both sides' Evidence; "none" only if Findings and Open agree
- Open/Risks: copy them forward
- Choice: <one approach and why>
```

At least **four** `path:LINE` citations per scout question. Pick one approach. Do not implement both.

**No mutations until that block exists** (no `StrReplace` / `Write` / `Delete` / notebook edits). Re-reading cites with Read/Grep is required and is not a mutation. If a scout returned fewer than four `path:LINE` rows, or every cite is from one opening dump, or rows are not tagged `batch N` with at least two from batch 2 or later, fill the missing cites in this agent with Read/Grep **before Choice**. Do not implement on compressed Findings alone. Launch-only `Task` messages stay Task-only. Phase: `implement`.

### 4. Implement

Minimal, targeted diffs in **this** agent (small diffs ≠ skipped research). Preserve existing behavior unless the checklist requires a change. Swarm workers stay read-only.

### 5. Swarm critic + adversarial pass

Launch **one** `bxh-critic` Task, launch-only, **if the critic has not run yet this invoke**. If it already PASSed, do not launch another; go to leftover product/proof. If it FAILed, fix then re-critic (step 7). Set both `subagent_type`: `bxh-critic` and `model`: `cursor-grok-4.6-xhigh` (required; see Swarm model). If that slug is not in the allowlist, do the critic pass **in this agent**. Prompt: success checklist, files touched, how to build/test, "read the files and git diff; do not trust this prompt." Tell the critic to include **at least four** Proof `path:LINE` quotes even on PASS. If the product lives outside the git workspace (for example `C:\Users\iaz54\.cursor`), list those **absolute paths** — workspace `git diff` will miss them. Tell the critic not to FAIL checklist item 8 only because elapsed is still under 60 minutes. Phase: `await-critic`.

Then your own adversarial pass. **Fix critic FAILs** (and anything else that still leaves the request incomplete or incorrect). Do not leave a FAIL unfixed to “report later.” A critic `VERDICT: PASS` with fewer than four Proof `path:LINE` cites is invalid: treat it as FAIL, fill those cites in this agent, and do not launch a second critic Task unless step 7 FAIL requires it.

### 6. Verify with tools

Read the actual edited files. Build/test/lint when the repo has them. Runtime evidence when behavior is user-visible. Unchecked items stay unproven. If elapsed is still under 60m, keep going with a **fix** or **new proof** (remaining unproven items first). Raise the **user's task product**, not only this skill or hook, unless the invoke is the beyond-xhigh system itself. Do not declare done because the critic passed. Do not launch extra scouts or an extra critic unless step 7 FAIL requires it.

### 7. Fix loop

Critic or verify **FAIL**: fix, then **launch-only re-critic**. Do not ship on FAIL. At most **3** fix+re-critic cycles. Re-scout when FAIL is missing evidence or wrong research, not only when you already know research was wrong. Then report remaining gaps with paths.

## Do not

- Do not apply this skill unless the user invoked `/beyond-xhigh` or `@beyond-xhigh`, or the user message is a `[bxh-floor]` continue for that invoke.
- Do not mix `Task` with other tools in the same message.
- Do not fall back to `explore` / `generalPurpose` for swarm roles.
- Do not use `composer-2.5-fast` or any Composer model in the swarm. Grok 4.6 Extra High only.
- Do not launch Bugbot, security-review, `best-of-n-runner`, or `environment: cloud` unless the user asked.
- Do not nest Tasks inside scouts/critics.
- Do not add extra hooks or stop-loops beyond the user-level `bxh_floor` 60-minute continue.
- Do not declare done while elapsed since invoke is under 60 minutes.
- Do not sleep, `/loop`, or wait on Starting-up cards to pad the hour.
- Do not rewrite unrelated code to "be more complete."
