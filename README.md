# consumption-bar

A [Claude Code](https://claude.com/claude-code) mod: what this session is spending, in a card above the prompt. It replaces a status line that showed the same figures.

```
╭────────────────────────────────────────────────────────────────────╮
│ ◆ consumption                  Fable 5.1 [high] · $1.23 · +120/-34 │
│ 5h █████░░░░░░░░   42%  resets in 2h10m   📈 █████████░░░░   71%   │
│ 7d ██░░░░░░░░░░░   18%  resets in 3d04h   📈 █████░░░░░░░░   35%   │
╰────────────────────────────────────────────────────────────────────╯
```

- **Header**: the model, its effort level once a request reports one, the session cost, and the lines added/removed by `Edit` and `Write` this session (subagents included).
- **One bar per rate-limit window** (5h, 7d, then any other the plan reports): a percent badge that turns yellow at 75% and red at 90%, and a countdown to the reset that moves every minute.
- **Forecast** (blue bar and badge, after the countdown): the percent the window should reach by its reset. The projection blends your usual pace, learned from the peaks of past windows, with the current window's own rate, which takes over as the window runs. Hidden when the row is too narrow. When no forecast can be computed (for instance right after a window reset, when the countdown reads "now"), the column stays in place as an empty gray bar with a `--%` badge so the rows keep lining up.
- Off a subscription there are no windows, so only the header shows. The card hides while a survey is open and when the terminal is too narrow.

It draws no context window: pair it with the `context-bar` mod (from the `claude-code-mods` marketplace), which stays right above the prompt, under this card.

## Install

```sh
claude plugin marketplace add <this repo>
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

## License

MIT, see [LICENSE](LICENSE).
