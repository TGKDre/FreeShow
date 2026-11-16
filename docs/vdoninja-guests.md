# VDO.Ninja remote guests into Grace City Presenter

VDO.Ninja (AGPL-3.0, free, self-hostable) carries remote guest video over WebRTC. This is how a
remote person (preacher, choir member, missionary, panelist) gets into the service as a feed GCP can
show and the GoStream can switch to.

## Why VDO.Ninja over jit.si for individuals
Both are free and self-hostable. VDO.Ninja is built for one-feed-per-person into a mixer (OBS/FreeShow)
with stable per-guest stream IDs, so each guest becomes a separate capture source you can place solo.
Jitsi is best for the group tile. Use VDO.Ninja for individual feeds, Jitsi for the group grid.

## The three links (from docs.vdo.ninja/advanced-settings)
- Publish (guest): `?room=ROOM&push=STREAMID&label=Name` - the guest opens this and sends their camera.
- View (capture): `?room=ROOM&view=STREAMID&solo&cleanoutput&label=Name` - a clean, single-guest feed.
- Director: `?director=ROOM` - your control room to mute, arrange, and manage guests.
- Group: `?room=ROOM&scene&cleanoutput` - all room guests mixed into one layout (tile/grid) as a single source.
- Optional: `&password=...` on every link to lock the room.

The generator tool `docs/vdoninja/vdoninja-guests.html` (open it in any browser on the tech box) turns a
list of guest names into every link above, with copy buttons. Point its "base URL" at your own instance
when self-hosting.

## Getting a VDO.Ninja feed INTO GCP
GCP (the FreeShow fork) has NDI input and device-capture input, but no native WebRTC ingest. The reliable
bridge is OBS on the tech box:
1. Each guest's capture URL goes into its own OBS Browser Source (`&solo&cleanoutput`, 1920x1080).
   The group scene URL goes into a separate Browser Source for the tile feed.
2. OBS outputs each source over NDI (DistroAV / obs-ndi plugin) or OBS Virtual Camera.
3. In GCP add an NDI input (or a camera capture) for each feed and place it full-screen, as a lower
   third, or route it out to the GoStream input.

This keeps GCP and OBS each doing what they do best, and the guests never touch GCP directly.

## Self-hosting
1. `git clone https://github.com/steveseguin/vdo.ninja`, host the static site on the OCI VM or any
   web host (Cloudflare Pages works).
2. Run a TURN server (coturn) for guests behind strict NAT; point the instance at it.
3. Set the tool's base URL to your instance. Nothing else changes.

## Test plan (run on the Windows test PC, never the live church PC mid-service)
- One guest on mobile data pushes; confirm the solo capture URL shows them clean in OBS within 2s.
- Confirm audio rides the same feed and is in sync.
- Add a second guest; confirm the group scene tiles both and the individual solo feeds still work.
- Measure end-to-end latency from guest wave to OBS (expect roughly 0.3 to 0.7s over the internet).
- Confirm NDI from OBS into GCP keeps lip sync and does not drop when OBS is under load.

## Limits / honest notes
- WebRTC latency is not zero. This is for watchable live video, not for a musician playing in time with
  the room.
- The uplink matters: a guest on weak WiFi will look bad no matter how good the rig is. Ask guests to be
  wired or on strong WiFi, and to close other apps.
- Deep native ingestion (WebRTC straight into GCP without OBS) is a larger build; the OBS-to-NDI bridge
  is the pragmatic, proven path to ship first.
