# Fonio voice platform decision

Status: Accepted
Date: 14 October 2026

## Context

The mobility demonstration needs a German phone assistant that collects trip details, clarifies locations and calls the starter's location, ride search and booking endpoints during a conversation.

## Decision

Use Fonio as the voice platform, as selected by the project owner. Configure a German assistant and a callable number. Connect its API tools to the starter through the public ngrok HTTPS origin.

The starter remains responsible for mobie passenger authentication and upstream API requests. It uses one test passenger account per process. The driver offers and approves rides through the staging app.

## Consequences

- Fonio account access, the assistant and the number must be available before the first live phone test. Confirm any organizer-provided access or credits.
- Configure API tools for location lookup, ride search and confirmed request submission. Verify the required Bearer header, JSON payloads and dynamic ride ID against the team's Fonio setup.
- Keep passenger trip selection and consent within the call. Submit a booking request only after explicit agreement to the selected trip.
- A real phone call and API tool execution remain to be verified. Platform selection does not establish integration readiness.

## Alternatives considered

Earlier preparation proposed ElevenLabs. The mobility implementation will use Fonio following the project owner's choice. No comparative performance benchmark has been completed.

## References

- [Architecture slides](mobie-architecture-slides.html)
- [Starter package guide](../packages/mobie-hackathon-starter.md)
- [Fonio API request tools](https://www.fonio.ai/de/news-cool-stuff/api-requests-mit-fonio---so-funktionierts-schritt-fur-schritt/)
