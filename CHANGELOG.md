# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 1.1.1 - 2026-10-28

### Changed
- The ` · ` separator now also sits between the model name/effort badge and the 🎚️ model limit; it is absent when no model limit is shown.
- The model name is shown as `Fable 5.1` instead of the raw id `claude-fable-5-1`: ids of the form `claude-<family>-<major>-<minor>` are formatted, anything else is shown as-is.

## 1.1.0 - 2026-10-28

### Added
- A per-model limit (`🎚️ 46%`) after the effort badge, shown only when the active model has one (today: Fable). Read through the host, refreshed at most once a minute, silently absent without a first-party login, on a gateway, or on error.

### Changed
- The forecast bar and its badge turn red at 90% and above (blue below).

### Fixed
- The forecast and usage badges are capped at 100%.

## 1.0.1 - 2026-10-14

### Fixed
- The effort badge updates as soon as `/effort <level>` runs, not on the next message.

### Changed
- README redesigned: screenshot, badges, feature and colour tables; the proof-of-concept status-line note is gone.

## 1.0.0 - 2026-10-14

No behaviour change.

### Added
- Six tests for the remaining hook paths: model refresh on `turn.start`, denied/error tool results, usage failure, yellow badge, width boundary, effort colours.
- This changelog.
- CI workflow: validate and test on push.
- Manifest fields `license`, `homepage`, `repository`, `keywords`.
- README documents persistence, pace, thresholds and hiding rules.

### Changed
- Version 1.0.0.

## 0.1.6 - 2026-10-14
- Hide the card when nothing is measured yet (no windows, no cost, e.g. after `/clear`).

## 0.1.5 - 2026-10-14
- 📈 before the forecast bar (gray when no forecast), tighter reset gap.

## 0.1.4 - 2026-10-14
- Blue forecast bar per window, blending the window's own rate with a pace learned from the last 8 finished windows (store key `pace`, default 50%).

## 0.1.3 - 2026-10-13
- Persist effort and line counts across restarts.

## 0.1.2 - 2026-10-13
- Header emoji.

## 0.1.1 - 2026-10-13
- Header separator, effort colours, green cost.

## 0.1.0 - 2026-10-13
- Initial release: the status line as a mod above the prompt.
