# Voice Briefs

Last updated: July 12, 2026

Voice Briefs are the Phase 10 post-launch feature train item after Household Sharing. They turn the latest first-look or weekly coaching brief into a short spoken script for native iOS text-to-speech playback.

## Product Surface

- The iOS Brief tab loads the latest voice brief for premium users.
- Playback uses `expo-speech`, so no generated audio files are stored or streamed.
- Playback events are recorded for started and completed listens.
- Free users keep the normal written brief and see that voice playback is a Coach feature.

## API

All generation/playback routes require an authenticated premium user.

- `GET /api/voice-brief/latest` finds the latest weekly brief, falls back to first-look, creates a voice script if needed, and returns it.
- `POST /api/voice-briefs/:id/events` records `started` and `completed` playback events.

The generated script is deterministic from the existing guarded insight. It does not send extra data to an external TTS provider.

## Data Model

`voice_briefs` stores:

- user id
- source insight id
- script
- intro/summary/action/closing segments
- estimated duration seconds
- play count
- completed timestamp

Rows cascade with the user or source insight.

## Privacy

Voice Briefs reuse existing coaching brief text and claims. They do not expose raw transactions, bank credentials, linked account payloads, or a new third-party processor. Text-to-speech runs on device through iOS.

## Admin Metrics

`GET /api/admin/metrics` includes:

- generated voice briefs
- completed voice briefs
- average voice brief duration

The admin console renders these as the Voice Brief metrics row.

## Validation

Covered by `apps/api/src/test/phase10.test.ts`:

- free users are premium-gated
- premium users get an idempotent voice script from the latest brief
- generated scripts stay within the 90-second target
- playback started/completed events update the ledger
- export includes voice brief rows
- admin metrics report voice brief adoption
