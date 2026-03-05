# elpaseo-voice-core

Private local voice-core backend for realtime voice orchestration behind `elpaseo-twilio-edge-relay`.

## Scope (v0)

- WebSocket endpoint: `GET /ws`
- Health endpoint: `GET /healthz`
- Accepts relay events:
  - `session-start`
  - `twilio-media`
  - `session-stop`
- Emits basic `session-ack` response

This is the initial scaffold for duplex/barge-in work.

## Run locally

```bash
npm start
```

## Environment

- `VOICE_CORE_HOST` (default `127.0.0.1`)
- `VOICE_CORE_PORT` (default `6060`)
- `VOICE_CORE_BEARER_TOKEN` (optional bearer auth for `/ws`)

## Next implementation milestones

1. Add VAD and barge-in detector from inbound `twilio-media` frames
2. Emit control messages (`bargein.detected`, `playback.stop`)
3. Stream assistant audio back (`type: "audio"`, mulaw payload)
4. Add metrics/tracing for latency + interruptions
