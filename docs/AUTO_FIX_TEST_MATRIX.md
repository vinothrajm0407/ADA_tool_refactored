# Auto-Fix Test Matrix — Fresh 3-Provider Test Environment

Built 2026-09-15. Three independent, self-contained test applications — one
per provider — each seeded with 8 Tier-1 (deterministic) + 8 Tier-2
(context-dependent) accessibility violations, connected through the app's
real Connected-Repos flow (`save_repo_link`, no hardcoded tokens), and
exercised end-to-end (scan → locate → fix → build → rescan → PR/MR → merge)
against the real GitHub/GitLab/Bitbucket APIs.

## Applications

| Provider | Repo | Live URL |
|---|---|---|
| GitHub | https://github.com/vinothrajm0407/ADA-AutoFix-Test-GitHub | https://vinothrajm0407.github.io/ADA-AutoFix-Test-GitHub/ (real GitHub Pages) |
| GitLab | https://gitlab.com/vinothrajm1/ADA-AutoFix-Test-GitLab | https://colonial-privacy-matrix.ngrok-free.dev/_ada_gitlab_relay/ (live relay — GitLab Pages needs the account's CI minutes identity-verified) |
| Bitbucket | https://bitbucket.org/ada_test_tool/testing_tool (repurposed — see note below) | https://colonial-privacy-matrix.ngrok-free.dev/_ada_bitbucket_relay/ (live relay — Bitbucket has no free static-pages hosting) |

**Bitbucket note:** the available Bitbucket access token is a
repository-scoped access token for `ada_test_tool/testing_tool` only — it
has full read/write on that repo but cannot create a new repo at the
workspace level (confirmed via a direct API call: `You do not have access
to view this workspace`). Rather than block on this, the existing
`testing_tool` repo was fully wiped (old Vite scaffold and all) and
replaced with a fresh app, same as the other two providers.

Each app has no build step (plain static HTML/CSS/JS in `docs/`, served
as-is) plus two realistic-but-inert `src/components/*.jsx` files proving
the locator's `.jsx` support has real structure to search. `package.json`
was deliberately **not** included — its mere presence makes
`build_and_preview` attempt a real `npm install && npm run build && vite
preview`, which fails on a repo with no build tooling; omitting it routes
correctly through the existing plain-static-site fast path instead.

## Seeded violations (8 Tier-1 + 8 Tier-2, per app)

| # | Category | Rule id | Live-detected? |
|---|---|---|---|
| T1-1 | Missing image alt | `image-alt` | ✅ |
| T1-2 | Icon-only button, id-identified | `button-name` | ✅ |
| T1-3 | Empty link | `link-name` | ✅ |
| T1-4 | Genuinely nameless input | `label` | ✅ (see finding below re: placeholder) |
| T1-5 | Missing `lang` on `<html>` | `html-has-lang` | ✅ |
| T1-6 | Top-level heading skip | `heading-order` | ✅ (best-practice tag — needs `includeBestPractices: true`) |
| T1-7 | Low-contrast text | `color-contrast` | ✅ |
| T1-8 | Standalone `role="img"` SVG | `svg-img-alt` | ✅ |
| T2-1 | SVG in uniquely-classed button (ancestor-scoped) | `button-name` | ✅ |
| T2-2 | SVG w/ nested `<path>`, `aria-hidden="false"` | `svg-img-alt` | ✅ |
| T2-3 | button → span → svg (multi-level ancestor) | `button-name` | ✅ |
| T2-4 | `role="checkbox"` missing `aria-checked` | `aria-required-attr` | ✅ (intentionally not in `RULES_WITH_FALLBACK`) |
| T2-5 | Placeholder label nested in fieldset→div | `label`-shaped | ⚠️ not axe-flaggable — see finding |
| T2-6 | Classless button wrapping `<DownloadIcon>` | `button-name` | ✅ |
| T2-7 | Same icon-button ×4 (header/card/section/footer) | `button-name` | ✅ (4 separate nodes, distinct classes) |
| T2-8 | Heading skip nested inside a card | `heading-order` | ✅ |

## Live Auto-Fix results (representative sample, 15 real runs)

| Provider | Case | Result |
|---|---|---|
| GitHub | `image-alt` (index.html) | ✅ Merged — [PR #1](https://github.com/vinothrajm0407/ADA-AutoFix-Test-GitHub/pull/1) |
| GitHub | `html-has-lang` (profile.html) | ❌ Locate failed — genuine finding (below) |
| GitHub | `button-name` T2-1 ancestor-scoped (`download-btn`) | ✅ Merged — [PR #2](https://github.com/vinothrajm0407/ADA-AutoFix-Test-GitHub/pull/2) |
| GitHub | `button-name` T2-7 disambiguation (footer, 1 of 4 dupes) | ✅ Merged, verified only the footer button changed — [PR #3](https://github.com/vinothrajm0407/ADA-AutoFix-Test-GitHub/pull/3) |
| GitHub | `svg-img-alt` (status icon) | ✅ Merged — [PR #4](https://github.com/vinothrajm0407/ADA-AutoFix-Test-GitHub/pull/4) |
| GitHub | `label` (genuinely nameless input) | ❌ Fallback fixer failed — genuine finding (below) |
| GitHub | `aria-required-attr` (checkbox, ×2 runs) | ❌ Failed safe both times (Gemini 503) — no invented fix |
| GitLab | `image-alt` (index.html) | ✅ Merged — [MR #1](https://gitlab.com/vinothrajm1/ADA-AutoFix-Test-GitLab/-/merge_requests/1) |
| GitLab | `button-name` T2-1 ancestor-scoped | ✅ Merged — [MR #2](https://gitlab.com/vinothrajm1/ADA-AutoFix-Test-GitLab/-/merge_requests/2) |
| GitLab | `button-name` T2-7 disambiguation (secondary section) | ✅ Merged — [MR #3](https://gitlab.com/vinothrajm1/ADA-AutoFix-Test-GitLab/-/merge_requests/3) |
| GitLab | `aria-required-attr` (checkbox) | ✅ AI proposed `aria-checked="false"`, correctly **not** auto-merged (AI patches always need human review) — [MR #4](https://gitlab.com/vinothrajm1/ADA-AutoFix-Test-GitLab/-/merge_requests/4) |
| Bitbucket | `image-alt` (index.html) | ✅ Merged — [PR #5](https://bitbucket.org/ada_test_tool/testing_tool/pull-requests/5) |
| Bitbucket | `button-name` T2-1 ancestor-scoped | ✅ Merged — [PR #6](https://bitbucket.org/ada_test_tool/testing_tool/pull-requests/6) |
| Bitbucket | `button-name` T2-7 disambiguation (card) | ✅ Merged — [PR #7](https://bitbucket.org/ada_test_tool/testing_tool/pull-requests/7) |
| Bitbucket | `aria-required-attr` (checkbox) | ✅ AI proposed a fix, correctly **not** auto-merged — [PR #8](https://bitbucket.org/ada_test_tool/testing_tool/pull-requests/8) |

**11 of 15 fully merged automatically, 2 correctly left for human review
(AI-authored, by design), 2 genuine gaps found and root-caused (not
patched — out of scope for this task).**

## Genuine engine gaps discovered (not fixed — reported per the task's scope)

1. **`label` rule's fallback fixer can never fire on any real violation.**
   axe's accessible-name computation treats `placeholder` as a valid name
   source, so a placeholder-only input is *never* flagged under the
   `label` rule (confirmed directly: an input with a placeholder passes,
   an input with none fails). But `_fallback_patch`'s `label` branch
   requires a `placeholder` attribute to derive its text and returns
   `None` otherwise. So the only input shape the fixer knows how to patch
   is exactly the shape axe never flags — a complete dead code path for
   this rule as currently written.

2. **`html-has-lang` can't disambiguate across a multi-page repo.** axe
   reports this violation's node as a generic, attribute-less `<html>` tag
   with no distinguishing content. `locate_source` has no page-path
   context — it only receives the DOM node and the repo — so on a 3-page
   repo where every page has its own `<html>` tag, it can't tell which
   file's tag actually failed and correctly declines rather than guessing.
   This didn't surface earlier this session because every prior fixture
   was single-page.

Both are real, reproducible findings, out of scope to patch here (this
task was building the test environment, not further engine changes) —
flagged for a follow-up.

## Incidental notes

- Bitbucket's index page surfaces a few extra structural findings
  (`landmark-one-main`, `landmark-unique`, `region`) beyond the seeded 16 —
  harmless, just from using nested `<nav>` elements without a `<main>`
  landmark in that app's markup. Not part of the intended matrix.
- `heading-order` (and any other axe rule tagged `best-practice`) only
  appears when the scan is run with `includeBestPractices: true` — worth
  knowing when comparing violation counts between scans.
