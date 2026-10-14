# consumption-bar

A [Claude Code](https://claude.com/claude-code) mod: what this session is spending, in a card above the prompt. It replaces a status line that showed the same figures.

```
╭────────────────────────────────────────────────────────────────────╮
│ ◆ consumption                  Fable 5.1 [high] · $1.23 · +120/-34 │
│ 5h █████░░░░░░░░   42%  resets in 2h10m   📈 █████████░░░░   71%   │
│ 7d ██░░░░░░░░░░░   18%  resets in 3d04h   📈 █████░░░░░░░░   35%   │
╰────────────────────────────────────────────────────────────────────╯
```

- **Header**: the model, its effort level once a request reports one (low gray, medium blue, high yellow, xhigh orange `#ff9e64`, max red, anything else gray), the session cost, and the lines added/removed by `Edit` and `Write` this session (subagents included).
- **One bar per rate-limit window** (5h, 7d, then any other the plan reports): a percent badge that turns yellow at 75% and red at 90%, and a countdown to the reset that moves every minute.
- **Forecast** (blue bar and badge, after the countdown): the percent the window should reach by its reset. The projection blends your usual pace (the median peak of the last 8 finished windows, shared across sessions under store key `pace`; 50% at reset until one finishes) with the current window's own rate, which takes over as the window runs. Hidden when it would get fewer than 10 cells. When no forecast can be computed (for instance right after a window reset, when the countdown reads "now"), the column stays in place as an empty gray bar with a `--%` badge so the rows keep lining up.
- **Persistence**: effort and line counts survive restarts and resumes, saved under a per-session store key (`s:<session start>`); keys older than 7 days are pruned.
- **Hidden** when nothing is measured yet (no windows and no cost, e.g. right after `/clear`), while a survey is open, and when the prompt body is narrower than 24 columns (20 inside the border). With a cost but no windows only the header shows.
- **Fail-soft**: engine errors are swallowed; the card shows less rather than breaking the prompt.

It draws no context window: pair it with the `context-bar` mod (from the `claude-code-mods` marketplace), which stays right above the prompt, under this card.

## Install

```sh
claude plugin marketplace add https://github.com/epommier/cm-consumption-bar
claude plugin install consumption-bar@cm-consumption-bar
```

## Try it without installing

```sh
claude --plugin-dir mods/consumption-bar
```

## Develop

```sh
claude plugin validate mods/consumption-bar
claude plugin test mods/consumption-bar
```

Inside a running Claude session the tests may refuse to run; use `CLAUDE_CONFIG_DIR=$(mktemp -d) claude plugin test mods/consumption-bar`. CI runs validate and test on every push.

## License

MIT, see [LICENSE](LICENSE).
