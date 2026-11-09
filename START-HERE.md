# Give ongoing AI work a visible home

Harbour helps you see recurring responsibilities, individual runs and the work that needs a human decision. The original project is by geekforbrains; this repository is a fork. Keep the [upstream README](README.md) and its attribution as the main software reference.

A useful first goal is small: **Show me what an assistant was asked to do, what actually happened, and what is waiting for me.**

## Ask your coding assistant

> Help me turn one recurring responsibility into a clear job brief. Define its inputs, expected result and the point where it should ask me for help before enabling a schedule.

> Explain how Harbour distinguishes a scheduled job from a run that completed, failed or is waiting. Use the current source and docs rather than promising that an agent has finished work.

> Help me prepare a private setup for one agent and one reviewed job. Keep credentials in the application's secret settings and show which permissions and services are needed before anything runs.

## Follow one responsibility through the system

1. Write down the responsibility and the result you expect.
2. Attach the approved reference documents and required account settings.
3. Review how an agent or workflow will pick up a run.
4. Inspect its activity and final state; handle a waiting run as a decision, not a completed task.

Harbour's agents poll for work. A configured agent or a scheduled job is therefore different from proof that an external task has succeeded. External services still require their own authorized accounts and credentials.

## Explore the existing guides

- [Getting started](docs/guides/getting-started.md)
- [Jobs and runs](docs/concepts/jobs-and-runs.md)
- [Shared context](docs/concepts/shared-context.md)
- [Captain, the in-browser assistant workspace](docs/concepts/captain.md)
- [Full documentation index](docs/README.md)

This fork also contains a LinkedIn bridge. Review that module's session handling and the actions it can perform separately before enabling it. Do not infer provider approval, account protection or completed outreach from the presence of an extension or an approved draft.

No runner, schedule, message or external action was started while preparing this guide.
