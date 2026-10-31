# Precision corpus

A pile of real repos kept to test the checker itself. Nothing here affects what
`agbar check` does - delete this folder and every command behaves identically.
Its only job is to tell the maintainer when a rule change made the tool noisier.

The rules are hand-written heuristics, and a heuristic is a guess about what bad code
looks like. Unit tests prove a rule works on examples written to make it work; only
real code written by people who never heard of this tool shows where it is wrong.
That is the whole value: on their first run, nine unseen repos exposed five false
positives the 407 unit tests all missed.

## Use

```sh
cp corpus/repos.example.txt corpus/repos.txt   # then add your own projects
npm run build && npm run corpus -- --update    # write the baseline (judge it first!)
npm run corpus                                 # after any rule change; exits 1 on any diff
```

A `+` line is a new complaint: open that file and decide whether it is a real
problem or the rule got sloppy. A `-` line is a complaint that vanished: confirm you
fixed a false alarm rather than going blind to something real. Once every `+` has a
verdict from the source, `--update` accepts the new state.

## Why repos.txt and baseline.txt are gitignored

`baseline.txt` lines are `repo severity rule file:line` - never the matched text, so
no password or key is ever written here. But "this private repo has hardcoded
credentials at this exact line" is still a map to the secret, and `repos.txt` leaks
local paths and project names. Both stay on the machine that wrote them.

## Measurement vs. regression

These two are not the same job, and conflating them produces a flattering number:

- **Measurement** needs repos the rules have *never* seen. Judge every finding from
  the source; precision is true findings over all findings. The nine public repos
  scored 84% (27/32) on their first run.
- **Regression** is what this baseline does, forever. Once a repo's false positives
  have been fixed, the rules are shaped by that repo and it can no longer measure
  anything - it can only tell you when something moved.

So a fresh honest number always costs fresh repos. See the maintainer notes for the held-out
history and the root causes fixed so far.
