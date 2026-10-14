# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

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
