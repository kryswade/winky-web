# Winky Community beta

A Discord/Telegram-style social for your wrist (Zepp OS 3.x, Amazfit Balance + round/square/band).

## Features
- Accounts: register/login with nickname + 6-digit PIN (PIN stored only as SHA-256 hash)
- 🌐 Global chat — **text only**
- 💬 Direct messages (request/accept, block/unblock, unread badges) — text E2E encrypted, images + audio
- 👥 Group chats (create, invite, members, rename, leave) — text E2E encrypted, images + audio
- Images (🖼️) and voice (🎤) sent from the web client; viewed/played on the watch
- Encrypted keybag: DM/group text keys survive reinstall (recovered at login via PIN)
- Custom on-screen keyboard (QWERTY + T9 + numeric), crown + swipe scroll, all icons

## Media architecture (fast + stable)
- Media are stored UNENCRYPTED (decrypting big base64 on the Balance rebooted it).
- The chat list loads only `kind` + id for media (never the huge base64) → fast lists.
- On tap, the Side Service fetches that single message over HTTPS and returns it →
  the watch writes the file and shows the image / plays the MP3.

## Setup
1. Supabase: run `sql/schema.sql` (fresh) or `sql/patch.sql` (upgrade).
2. Put Project URL + anon key in `shared/config.js` (watch) and in the web HTML.
3. `npm i -g @zeppos/zeus-cli && npm install && zeus dev`
4. Regenerate icons/avatars any time with `python tools/gen_assets.py`.
