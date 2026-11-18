MAL DMs  (mal-dms.user.js, v1.2.1, 2026-11-18)
===============================================

NEW IN 1.2.1
  - On GitHub now; Tampermonkey updates it from there by itself.

NEW IN 1.2.0
  - New messages are found about 20 s after they arrive, ALSO when MAL is a tab in the background (before, only
    the tab you were looking at checked, so a message could sit for hours). One MAL tab does the checking.
  - When MAL is not the page in front: a Windows notification (friend + start of the message; click it to open
    that chat) and the unread number in the tab's title, e.g. "(1) MyAnimeList". Switch: ... in the list.
  - The nya plays from any MAL tab: if the tab that found the message may not make sound (never clicked since it
    loaded), another MAL tab plays it.
  - "Failed to fetch" is gone: a request MAL did not answer is tried again quietly (3 tries); a message only
    shows after three checks in a row failed, and it clears by itself.
  - Limits: MAL must be open in some tab; a tab the browser has put to sleep (memory saver) checks nothing until
    you open it (it then checks at once).

NEW IN 1.1.0
  - Move it: drag the blue top bar anywhere. Resize it: drag any edge or corner. Place and size are remembered.
    The arrows button (or ... > "Put the chat back in the corner") puts it back.
  - Nya: the quiet AniList DMs "nya" plays when a new message arrives (only one tab plays it). ... in the list:
    on / off, volume (15 % to start), Play to hear it.
  - Remove a chat: hover it in the list and press x. Nothing is deleted on MAL; the chat comes back by itself when
    that person writes again (or type their name in the box at the top).
  - Fixed: a new message could go missing until the next check when two checks overlapped.

NEW IN 1.0.1
  - Fixed: every message showed only its short start with "…" (a pasted picture showed as just "…"). MAL's message
    pages have their own number, different from the list's; the script asked for the wrong one. The messages are
    read again once after updating.

Your MyAnimeList private messages as chats, like AniList DMs: a round chat button bottom right on every MAL page.
Click it: one chat per friend (their picture, last message, red number for unread). Click a friend: the whole
conversation, MAL's Inbox and Sent Messages merged in time order, yours on the right.

INSTALL
  With Tampermonkey installed, open this link and press Install:
  https://raw.githubusercontent.com/YoruCAnime/Anime-site-scripts/main/myanimelist/mal-dms.user.js
  Reload your MAL tabs. Later versions arrive by themselves.

WRITING
  - Enter sends, Shift+Enter = new line (change it under ... in the list).
  - Toolbar: B, I, S, Spoiler, Link, Img, YT, Centre, Quote, GIF (Tenor search, click one to add it), emojis,
    eye = live preview on / off. Ctrl+B / Ctrl+I.
  - AniList codes work: img(link) / img220(link), youtube(link), ~!spoiler!~, ~~~centre~~~, [text](link),
    **bold**, ~~strike~~, webm(link) (MAL has no video player: it becomes a link). They are turned into MAL's
    own codes when the message is sent.
  - Pasting a picture / GIF link or a YouTube link makes it a picture / player by itself.
  - Hover a message: Reply (quotes it; select words first to quote only those), Copy.
  - What you typed is kept per chat.

MAL'S 30 SECONDS
  MAL allows one message every 30 s. The Send button counts down. Press Send anyway: the message waits as a dashed
  bubble ("Sends in 12 s") and goes out by itself; more messages typed meanwhile join it as one. "Take back" puts
  it back in the box. If MAL refuses a message, the text comes back into the box.

HOW IT TALKS TO MAL
  - Reading = MAL's own Inbox / Sent pages and message pages, with your login (no password or key anywhere).
    First start reads 5 pages of each (100 messages); "Look for older messages on MAL" in a chat reads further back.
  - Opening a chat marks its unread messages as read on MAL (it opens them, like clicking them).
  - Sending = MAL's own send form, filled in and its own Send button pressed in a hidden frame, so MAL's own
    checks run exactly as on the site. As a reply to their newest message (MAL writes "re: subject" itself);
    your own subject line: ... in the chat.
  - New messages: checked every 20 s by one MAL tab, also in the background.
  - PC layout only (MAL's phone pages are built differently).

NOT TRIED YET
  A real message to a real person (the test uses a pretend MAL). Emojis: MAL may not keep every emoji.

TEST (offline, sends nothing)
  The offline test (a pretend MAL, 39 checks) is kept with the author, not in the repo.
