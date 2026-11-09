# Stratum

A 3D card-stacking territory game for the browser, built with [three.js](https://threejs.org/).
Play **solo against AI opponents** or **online with friends** (2–4 players), with AI available to fill empty seats.

Stratum is an original design in the overlapping-card genre. Players lay domino-shaped cards onto a
shared grid, stacking them on top of each other to build territory and bury their rivals.

## Tutorial

New players can pick **Play the tutorial** from the main menu. It's an interactive, 9-step game against a
scripted "Tutor" opponent that teaches one rule per step: the first card, touching, burying, flat
placement, stone, and scoring. Each step checks that your move actually practises that rule. The
tutorial runs fully in the browser, so it works on the GitHub Pages build too.

## Rules

Each card has two halves. A half is either **your colour**, your colour with a **gem**, or neutral **stone**.

1. On your turn, play one card from your 3-card hand, then draw. Each player has a 12-card deck.
2. The first card must cover the centre square. Every later card must **overlap** or **touch** a card on the board.
3. Cards must lie **flat**: both halves land on stacks of equal height. Stacks max out at **3** cards.
4. You can't completely cover a single card (both halves directly over the same card).

When nobody can play, only the **top** of each stack counts:

- **1 point** per square in your largest orthogonally connected group
- **2 points** per visible gem of yours

Ties go to whoever has more visible squares.

## Controls

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Select card | Click a card or press `1`–`3` | Tap a card |
| Place | Hover the board, click | Tap to preview, then tap **Place** (or tap the same square again) |
| Rotate | Click the selected card again, its ⟳ badge, `R` / `Shift+R`, Shift+scroll | Tap the selected card again or its ⟳ badge |
| Camera | Right-drag to orbit, scroll to zoom | Two-finger gestures |
| Show a player's largest group | Hover their row in the scoreboard | |
| Mute / unmute | `M` | 🔊 button |

## Sound and music

All audio is synthesized live with the Web Audio API, so there are no audio files.

- **Music:** original generative ambient music in D major: a slow four-chord pad progression with
  randomised plucked notes and bells. A bassline is added during games, and the arrangement relaxes on the
  game-over screen.
- **Effects:** card landings (pitched by stack height, with an extra crunch when you bury a rival
  and a chime for gems), card select, rotate, invalid move, your-turn chime, tutorial steps and
  win/lose jingles.
- **Controls:** the 🔊 button sets music and effects volume separately. **M** mutes everything.
  Settings are saved in the browser. Audio starts after your first click (browser autoplay rules)
  and pauses when the tab is hidden.

## Running it

Requires Node.js 20+.

```bash
npm install
npm run dev      # game server on :3000 + Vite dev server on :5173 (open http://localhost:5173)
```

Production:

```bash
npm run build    # bundles the client into dist/
npm start        # serves dist/ and the multiplayer WebSocket on PORT (default 3000)
```

Run the tests with `npm test`.

Solo games run entirely in the browser. Online play needs the Node server, so deploy to any host
that supports long-lived WebSocket connections (Fly.io, Render, Railway, a VPS, etc.).

## Project layout

```
shared/engine.js   rules engine (pure JS, used by client and server)
shared/ai.js       AI opponents: easy / normal / hard
server/index.js    static file server + WebSocket rooms (authoritative)
src/scene.js       three.js board, cards, placement preview, animations
src/art.js         card face artwork (canvas), player colours and symbols
src/controllers.js LocalController (solo) and NetController (online) behind one interface
src/audio.js       synthesized sound effects and generative music (Web Audio API)
src/tutorial.js    TutorialController: scripted step-by-step lessons against "Tutor"
src/main.js        menus, lobby, HUD and input
test/              node:test suite for the engine and AI
```

### Multiplayer notes

- The host creates a room and shares the 4-letter code or invite link (`?room=CODE`).
- The host can add AI players (easy/normal/hard) or remove players in the lobby.
- If a player disconnects, reloading the page reclaims their seat. If they stay away for 30 seconds,
  an AI plays their turns until they return. A player who chooses to leave is replaced by an AI.
- The server validates every move with the shared engine, and each client only sees its own hand.
