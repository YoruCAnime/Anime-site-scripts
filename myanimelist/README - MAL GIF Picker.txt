MAL GIF & Picture Picker  (mal-gif-picker.user.js, v1.0.2, 2026-11-18)
======================================================================

A GIF button in every MyAnimeList editor: forum posts, private messages, comment replies (Reply on a profile or
Com-to-Com page), clubs, blog. It is the AniList GIF Picker, writing MAL's codes. Tampermonkey, myanimelist.net only.

THE BUTTON
  - Big MAL editor (the one with B I U ... and the Edit / Preview tabs): "GIF" at the end of its toolbar.
  - Plain comment boxes: a small "GIF" button under the box.
  - Alt+G while typing in a box opens it too.

IN THE PICKER
  - GIF: Tenor + Safebooru.   Picture: Safebooru + Konachan.net (safe pictures only).   YouTube: search, watch, add.
  - Tap one = its code goes into your text:  [img]link[/img]   /   [yt]video id[/yt]
  - Size: Original, or a width (150 ... 800 px, Custom). A width is written as [img=WIDTHxHEIGHT], the form MAL's
    own picture button writes; the height follows the picture's shape.
  - Spoiler, Centre, Pick several (side by side or under each other), Keep open after adding.
  - Upload (arrow button): your own GIF / picture / video goes into YOUR public GitHub repo and its link is added.
    First time: the picker asks for the repo and a token once (the same kind as in the AniList picker; Tampermonkey
    keeps each script's settings apart, so it has to be typed in here once more). "Your uploads" lists what is
    already in the repo: tap to add it again.
  - A video file becomes a clickable link: MAL has no player for video files (YouTube does get MAL's player).
  - A picture that does not load from its site is refused, so no broken pictures in a post.

SEE IT BEFORE POSTING
  Under every box a strip "In your post:" shows the pictures and YouTube videos that are in your text, small, as you
  type or paste. A red "Does not load" note = that link is not a picture people will see. The big editor also has
  MAL's own Preview tab for the whole post.

INSTALL
  With Tampermonkey installed, open this link and press Install:
  https://raw.githubusercontent.com/YoruCAnime/Anime-site-scripts/main/myanimelist/mal-gif-picker.user.js
  Reload your MAL tabs. Later versions arrive by themselves.
  It works next to MAL Paste Codes (pasting a link makes the code) and MAL DMs.

NEW IN 1.0.2
  - Uploads: when GitHub says no for a moment although your token is fine, the file is sent again by itself
    (after 6 s, then 12 s) instead of the wrong "The token is not allowed to write" message.

NOT TRIED YET
  Sized pictures ([img=WxH]) as MAL shows them after posting; uploads from this script; MAL's phone layout.
