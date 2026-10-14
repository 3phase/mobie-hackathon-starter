# Project documentation

Use this folder for project specifications, architecture, package documentation and implementation plans.

## Start here

- [mobie architecture slides](architecture/mobie-architecture-slides.html): the components, accounts, ride flow and open decisions. Open in a browser. Use the arrow keys to navigate, N for notes and F for full screen.
- [mobie starter package guide](packages/mobie-hackathon-starter.md): code responsibilities, setup and links to the supplied API documentation.

## Structure

```text
docs/
  README.md
  specs/                  User behavior, requirements and acceptance criteria
  architecture/           System design, diagrams and architecture decisions
  packages/               Setup and reference documentation for code packages
  implementation-plans/   Sequenced delivery work, dependencies and validation
```

| Folder | What belongs here |
| --- | --- |
| [Specifications](specs/README.md) | What the system must do and how we judge completion. |
| [Architecture](architecture/README.md) | How components connect, where state lives and why we choose a design. |
| [Packages](packages/README.md) | How to run, configure and work on each code package. |
| [Implementation plans](implementation-plans/README.md) | How we will deliver a change, in what order and with which checks. |

## Conventions

Use descriptive lowercase filenames with hyphens, such as `voice-ride-booking.md` or `address-matcher.md`. Use Markdown for text and HTML when an interactive deck or document layout helps.

Specifications and plans should identify their status and link to the related architecture and packages. Mark proposed behavior clearly and record unresolved decisions beside the affected design. Keep credentials and personal test data out of documentation.

All shared documentation lives in this repository. Edit these files through the same branches and pull requests as the implementation.

## Supplied starter references

- [API endpoints and payloads](api.md)
- [Authentication](authentication.md)
- [Challenge requirements](challenge.md)
- [Postman collection](postman_collection.json)

Keep these references in their existing locations and link to them from designs and package guides instead of maintaining competing copies.
