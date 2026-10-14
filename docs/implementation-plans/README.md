# Implementation plans

Store delivery plans here, with one file per feature or coordinated change. Link each plan to its specification, architecture and affected packages.

A useful plan identifies its status, intended outcome, dependencies, ordered tasks, validation and completion criteria. Keep unresolved prerequisites visible and distinguish planned tasks from completed work.

## mobie delivery sequence

The [architecture deck](../architecture/mobie-architecture-slides.html#slide-12) proposes four stages:

1. Prove passenger login, ride search, request submission and driver approval with known coordinates.
2. Configure Fonio, its callable number, the tunnel and assistant tools.
3. Add address matching and compare outcomes with the direct lookup baseline.
4. Run organizer scenarios and two additional challenging rides for the demonstration.

Detailed implementation plans have not been written yet. Suitable filenames include `voice-booking-integration.md` and `address-matcher.md`.
